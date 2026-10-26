#!/usr/bin/env node
'use strict';

/**
 * Code Harness CLI — lance l'agent en mode terminal.
 * Usage : harness "ma tâche" [--project <dir>] [--max-steps N] [--shell]
 */

const path = require('path');
const readline = require('readline');

const { runAgent } = require('../src/harness/agent');
const { OpenAiCompatEngine } = require('../src/harness/llm/engines/openai-compat');
const { GeminiEngine }       = require('../src/harness/llm/engines/gemini');
const { ClaudeEngine }       = require('../src/harness/llm/engines/claude');
const { loadCliConfig, CLI_CONFIG_PATH } = require('../src/cli/config-loader');
const {
  printHeader, printStep, printResult, printToken,
  printFinish, printError, printInfo, printAskUser,
} = require('../src/cli/output');

// ── Parsing des arguments ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { task: null, project: process.cwd(), maxSteps: 25, shell: false, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h')     { opts.help = true; }
    else if (a === '--project' || a === '-p') { opts.project = argv[++i]; }
    else if (a === '--max-steps')         { opts.maxSteps = parseInt(argv[++i], 10) || 25; }
    else if (a === '--shell')             { opts.shell = true; }
    else if (!a.startsWith('--'))         { positional.push(a); }
  }
  if (positional.length) opts.task = positional.join(' ');
  return opts;
}

function printHelp(configPath) {
  console.log(`
${'\x1b[1m'}Code Harness CLI${'\x1b[0m'} — agent de code local

${'\x1b[33m'}Usage :${'\x1b[0m'}
  harness "<tâche>" [options]

${'\x1b[33m'}Options :${'\x1b[0m'}
  --project <dir>    Dossier du projet  (défaut : répertoire courant)
  --max-steps <n>    Nombre max d'étapes (défaut : 25)
  --shell            Activer run_shell
  --help, -h         Afficher cette aide

${'\x1b[33m'}Configuration :${'\x1b[0m'}
  Variables d'environnement (priorité) :
    HARNESS_API_KEY    Clé API
    HARNESS_ENGINE     Moteur : openai-compat | gemini | claude
    HARNESS_MODEL      Modèle (ex : gemini-2.0-flash)
    HARNESS_BASE_URL   URL de base (pour openai-compat)

  Fichier : ${configPath}
    {
      "engine": "openai-compat",
      "apiKey": "sk-...",
      "baseUrl": "https://codecraftapi.com/v1",
      "model": "gemini-2.0-flash"
    }

${'\x1b[33m'}Exemples :${'\x1b[0m'}
  harness "Ajoute des tests pour src/utils.js"
  harness "Corrige le bug dans auth.js" --project /mon/projet
  harness "Explique l'architecture" --max-steps 5
`);
}

// ── Entrée utilisateur interactive (ask_user) ─────────────────────────────────

function askUserCli(question, suggestions) {
  printAskUser(question, suggestions);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\x1b[36m> \x1b[0m', (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

// ── Point d'entrée principal ──────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { printHelp(CLI_CONFIG_PATH); process.exit(0); }

  if (!opts.task) {
    printError('Tâche manquante.');
    printHelp(CLI_CONFIG_PATH);
    process.exit(1);
  }

  const cfg = loadCliConfig();
  if (!cfg || !cfg.apiKey) {
    printError('Aucune clé API configurée.');
    printInfo(`\nCrée ${CLI_CONFIG_PATH} ou définis HARNESS_API_KEY.`);
    printInfo('Lance harness --help pour plus de détails.');
    process.exit(1);
  }

  // Construire le moteur LLM selon le type
  let engine;
  switch (cfg.engine) {
    case 'gemini':
      engine = new GeminiEngine({ apiKey: cfg.apiKey, model: cfg.model });
      break;
    case 'claude':
      engine = new ClaudeEngine({ apiKey: cfg.apiKey, model: cfg.model });
      break;
    default: // openai-compat
      engine = new OpenAiCompatEngine({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
  }

  const projectRoot = path.resolve(opts.project);
  printHeader(projectRoot);

  // Gestion des tokens streamed (affichage en temps réel puis nettoyage de ligne)
  let _streaming = false;

  const result = await runAgent({
    task:        opts.task,
    llmGenerate: (msgs, options) => engine.generate(msgs, options),
    projectRoot,
    config: {
      maxSteps:    opts.maxSteps,
      enableShell: opts.shell,
      // ask_user interactif dans le terminal
      requestUserInput: askUserCli,
    },
    onEvent(ev) {
      switch (ev.type) {
        case 'llm_token':
          if (!_streaming) { process.stdout.write('\x1b[90m'); _streaming = true; }
          printToken(ev.token);
          break;
        case 'tool_call':
          if (_streaming) { process.stdout.write('\x1b[0m\n'); _streaming = false; }
          printStep(ev.step, ev.tool, ev.args);
          break;
        case 'tool_result':
          printResult(ev.result);
          break;
        case 'finish':
          if (_streaming) { process.stdout.write('\x1b[0m\n'); _streaming = false; }
          printFinish(ev.summary);
          break;
        default: break;
      }
    },
  });

  if (!result.ok) {
    printError(result.error || 'Échec inconnu');
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { printError(e.message); process.exit(1); });
