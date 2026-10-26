#!/usr/bin/env node
'use strict';

/**
 * ShamCode MCP Server — transport stdio, protocole MCP 2024-11-05.
 *
 * Usage depuis Claude Desktop (claude_desktop_config.json) :
 *   {
 *     "mcpServers": {
 *       "code-harness": {
 *         "command": "node",
 *         "args": ["/chemin/vers/harness/src/mcp-server/server.js", "--project", "/mon/projet"]
 *       }
 *     }
 *   }
 *
 * Le LLM client (Claude Desktop) est le moteur d'inférence.
 * Ce serveur expose uniquement les outils harness — aucune clé API requise.
 */

const path      = require('path');
const { dispatch }   = require('../harness/tools/index');
const { makeGuard }  = require('../harness/safety/path-guard');
const { TOOL_SCHEMAS } = require('./tool-schemas');
const { createScratchpad } = require('../harness/memory/scratchpad');

// ── Configuration ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  let projectRoot  = process.cwd();
  let enableDeploy = false;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--project' || argv[i] === '-p') && argv[i + 1]) {
      projectRoot = path.resolve(argv[++i]);
    }
    if (argv[i] === '--deploy') enableDeploy = true;
  }
  return { projectRoot, enableDeploy };
}

const { projectRoot, enableDeploy } = parseArgs(process.argv.slice(2));
const guard      = makeGuard(projectRoot);
const scratchpad = createScratchpad();
const config     = { _scratchpad: scratchpad, enableShell: false, enableDeploy };

// ── JSON-RPC stdio ────────────────────────────────────────────────────────────

let _buf = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  _buf += chunk;
  const lines = _buf.split('\n');
  _buf = lines.pop(); // garder l'éventuel fragment non terminé
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) handleLine(trimmed);
  }
});

process.stdin.on('end', () => process.exit(0));

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Dispatch MCP ──────────────────────────────────────────────────────────────

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch { return; } // ligne malformée ignorée

  const { id, method, params } = msg;

  // Notifications (pas de réponse attendue)
  if (id === undefined || id === null) {
    // notifications/initialized, etc. — rien à faire
    return;
  }

  switch (method) {

    case 'initialize':
      reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'code-harness', version: '0.1.0' },
        instructions: `Outils de code harness sur le projet : ${projectRoot}`,
      });
      break;

    case 'ping':
      reply(id, {});
      break;

    case 'tools/list':
      reply(id, { tools: TOOL_SCHEMAS });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const args     = params?.arguments ?? {};

      if (!toolName) { replyError(id, -32602, 'Paramètre "name" manquant'); break; }

      try {
        const result = await dispatch(toolName, args, guard, config, () => {}, projectRoot);
        const text   = JSON.stringify(result, null, 2);
        reply(id, {
          content: [{ type: 'text', text }],
          isError: !result.ok,
        });
      } catch (e) {
        reply(id, {
          content: [{ type: 'text', text: `Erreur interne : ${e.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      replyError(id, -32601, `Méthode inconnue : ${method}`);
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

// Signal de prêt sur stderr (invisible pour le client MCP, utile pour le debug)
process.stderr.write(`[code-harness] MCP server démarré — projet : ${projectRoot}\n`);
