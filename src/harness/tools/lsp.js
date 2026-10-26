/**
 * Outils LSP — Language Server Protocol (JSON-RPC sur stdio).
 * Zéro dépendance npm : client JSON-RPC maison sur child_process.spawn.
 *
 * Outils exposés : lsp_hover, lsp_definition, lsp_references
 * Nécessite un serveur LSP installé localement (typescript-language-server, pylsp…).
 */

'use strict';

const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

const REQUEST_TIMEOUT_MS = 15000;

// ── Détection langue par extension ──────────────────────────────────────────

const EXT_TO_LANG = {
  '.js':  'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.ts':  'typescript', '.tsx': 'typescriptreact',
  '.py':  'python',
  '.rs':  'rust',
  '.go':  'go',
};

// Commandes par défaut (premier élément = binaire, reste = args)
const DEFAULT_SERVERS = {
  javascript:        ['typescript-language-server', ['--stdio']],
  javascriptreact:   ['typescript-language-server', ['--stdio']],
  typescript:        ['typescript-language-server', ['--stdio']],
  typescriptreact:   ['typescript-language-server', ['--stdio']],
  python:            ['pylsp', []],
  rust:              ['rust-analyzer', []],
  go:                ['gopls', ['serve']],
};

// Groupes de langues partageant le même serveur
const LANG_GROUP = {
  javascript:      'typescript',
  javascriptreact: 'typescript',
  typescript:      'typescript',
  typescriptreact: 'typescript',
  python:          'python',
  rust:            'rust',
  go:              'go',
};

// ── Conversion chemin ↔ URI ──────────────────────────────────────────────────

function _pathToUri(absPath) {
  const normalized = absPath.replace(/\\/g, '/');
  // Windows : C:/foo → file:///C:/foo
  if (/^[A-Za-z]:/.test(normalized)) return 'file:///' + normalized;
  return 'file://' + normalized;
}

function _uriToPath(uri) {
  const p = uri.replace(/^file:\/\/\/?/, '');
  // Windows : /C:/foo → C:/foo
  const clean = /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p;
  return clean.replace(/\//g, path.sep);
}

// ── LspClient ────────────────────────────────────────────────────────────────

class LspClient {
  constructor(cmd, args, rootUri) {
    this._cmd     = cmd;
    this._args    = args;
    this._rootUri = rootUri;
    this._proc    = null;
    this._buf     = '';
    this._nextId  = 1;
    this._pending = new Map();   // id → { resolve, reject, timer }
    this._opened  = new Set();   // URIs already sent didOpen
    this._ready   = false;
    this._dead    = false;
    this._initP   = null;
  }

  // ── Initialisation paresseuse ──────────────────────────────────────────────

  ensure() {
    if (this._dead)  return Promise.reject(new Error('SERVEUR_LSP_MORT'));
    if (this._ready) return Promise.resolve();
    if (!this._initP) this._initP = this._start();
    return this._initP;
  }

  async _start() {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(this._cmd, this._args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (e) {
        return reject(new Error(`SERVEUR_LSP_INTROUVABLE: ${this._cmd} — ${e.message}`));
      }

      this._proc = proc;

      proc.on('error', (e) => {
        this._dead = true;
        this._rejectAll(`SERVEUR_LSP_INTROUVABLE: ${this._cmd} — ${e.message}`);
        reject(new Error(`SERVEUR_LSP_INTROUVABLE: ${this._cmd}`));
      });

      proc.on('exit', () => {
        this._dead = true;
        this._rejectAll('SERVEUR_LSP_FERMÉ');
      });

      proc.stdout.on('data', (chunk) => this._onData(chunk));

      // Lance l'initialisation LSP
      const id = this._nextId++;
      this._pending.set(id, {
        resolve: (r) => { this._ready = true; this._notify('initialized', {}); resolve(r); },
        reject,
        timer: setTimeout(() => reject(new Error('TIMEOUT_INIT_LSP')), REQUEST_TIMEOUT_MS),
      });

      this._rawSend({
        jsonrpc: '2.0', id, method: 'initialize',
        params: {
          processId: process.pid,
          rootUri: this._rootUri,
          capabilities: {
            textDocument: {
              hover:       { contentFormat: ['plaintext', 'markdown'] },
              definition:  { linkSupport: false },
              references:  {},
              synchronization: { didOpen: true },
            },
            workspace: {},
          },
        },
      });
    });
  }

  // ── Envoi JSON-RPC ─────────────────────────────────────────────────────────

  _rawSend(msg) {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    try { this._proc.stdin.write(header + json); } catch { /* proc mort */ }
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`TIMEOUT_LSP: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timer });
      this._rawSend({ jsonrpc: '2.0', id, method, params });
    });
  }

  _notify(method, params) {
    this._rawSend({ jsonrpc: '2.0', method, params });
  }

  // ── Réception et parsing ───────────────────────────────────────────────────

  _onData(chunk) {
    this._buf += chunk.toString('utf8');
    let match;
    const re = /Content-Length: (\d+)\r\n\r\n/;
    while ((match = re.exec(this._buf)) !== null) {
      const headerEnd = match.index + match[0].length;
      const len = parseInt(match[1], 10);
      if (this._buf.length < headerEnd + len) break;
      const json = this._buf.slice(headerEnd, headerEnd + len);
      this._buf  = this._buf.slice(headerEnd + len);
      try {
        const msg = JSON.parse(json);
        if (msg.id !== undefined && msg.id !== null) {
          const p = this._pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            this._pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || 'LSP_ERREUR'));
            else p.resolve(msg.result);
          }
        }
      } catch { /* message malformé — ignoré */ }
    }
  }

  _rejectAll(reason) {
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this._pending.clear();
  }

  // ── didOpen ────────────────────────────────────────────────────────────────

  _openDoc(uri, absPath, langId) {
    if (this._opened.has(uri)) return;
    this._opened.add(uri);
    let text = '';
    try { text = fs.readFileSync(absPath, 'utf8'); } catch { /* fichier illisible */ }
    this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId: langId, version: 1, text },
    });
  }

  // ── Outils publics ─────────────────────────────────────────────────────────

  async hover(uri, absPath, langId, line, col) {
    this._openDoc(uri, absPath, langId);
    return this._request('textDocument/hover', {
      textDocument: { uri },
      position: { line, character: col },
    });
  }

  async definition(uri, absPath, langId, line, col) {
    this._openDoc(uri, absPath, langId);
    return this._request('textDocument/definition', {
      textDocument: { uri },
      position: { line, character: col },
    });
  }

  async references(uri, absPath, langId, line, col) {
    this._openDoc(uri, absPath, langId);
    return this._request('textDocument/references', {
      textDocument: { uri },
      position: { line, character: col },
      context: { includeDeclaration: true },
    });
  }

  dispose() {
    this._dead = true;
    this._rejectAll('SERVEUR_LSP_FERMÉ');
    try {
      if (this._proc) {
        this._rawSend({ jsonrpc: '2.0', id: this._nextId++, method: 'shutdown', params: null });
        this._notify('exit', null);
        setTimeout(() => { try { this._proc.kill(); } catch {} }, 500);
      }
    } catch { /* déjà mort */ }
    this._proc = null;
  }
}

// ── LspManager (singleton par session d'agent) ───────────────────────────────

let _manager = null;

function _getManager(projectRoot, config) {
  if (!_manager) _manager = new LspManager(projectRoot, config);
  return _manager;
}

class LspManager {
  constructor(projectRoot, config) {
    this._projectRoot = projectRoot;
    this._rootUri     = _pathToUri(projectRoot);
    this._config      = config;
    this._clients     = new Map();  // group → LspClient
  }

  _serverForLang(langId) {
    const group   = LANG_GROUP[langId];
    if (!group) return null;

    // Commande config utilisateur ou défaut
    const cfgCmd = this._config?.lspServers?.[group];
    let   [cmd, args] = DEFAULT_SERVERS[langId] || [null, []];
    if (cfgCmd) {
      const parts = cfgCmd.trim().split(/\s+/);
      cmd  = parts[0];
      args = parts.slice(1);
    }
    if (!cmd) return null;
    return { group, cmd, args };
  }

  async clientFor(langId) {
    const info = this._serverForLang(langId);
    if (!info) throw new Error(`PAS_DE_SERVEUR_LSP: ${langId}`);

    if (!this._clients.has(info.group)) {
      this._clients.set(info.group, new LspClient(info.cmd, info.args, this._rootUri));
    }
    const client = this._clients.get(info.group);
    await client.ensure();
    return client;
  }

  dispose() {
    for (const c of this._clients.values()) c.dispose();
    this._clients.clear();
  }
}

// ── Résolution chemin + langue ───────────────────────────────────────────────

function _resolve(args, guard, projectRoot, config) {
  const rawPath = args.path;
  if (!rawPath) return { err: 'CHEMIN_MANQUANT' };

  let absPath;
  try { absPath = guard(rawPath); }
  catch { return { err: `CHEMIN_HORS_PROJET: ${rawPath}` }; }

  const ext    = path.extname(absPath).toLowerCase();
  const langId = EXT_TO_LANG[ext];
  if (!langId) return { err: `EXTENSION_NON_SUPPORTÉE: ${ext}` };

  const line = Math.max(0, (parseInt(args.line, 10) || 1) - 1);  // 1-based → 0-based
  const col  = Math.max(0, (parseInt(args.col,  10) || 1) - 1);

  const uri = _pathToUri(absPath);
  const mgr = _getManager(projectRoot, config);

  return { absPath, langId, line, col, uri, mgr };
}

// ── lspHover ─────────────────────────────────────────────────────────────────

async function lspHover(args, guard, projectRoot, config) {
  const r = _resolve(args, guard, projectRoot, config);
  if (r.err) return { ok: false, error: r.err };

  try {
    const client = await r.mgr.clientFor(r.langId);
    const result = await client.hover(r.uri, r.absPath, r.langId, r.line, r.col);

    if (!result) return { ok: true, content: '(aucune information hover)' };

    // Extraire le contenu textuel (markdown ou plaintext)
    let content = '';
    if (typeof result.contents === 'string') {
      content = result.contents;
    } else if (result.contents?.value) {
      content = result.contents.value;
    } else if (Array.isArray(result.contents)) {
      content = result.contents.map(c => (typeof c === 'string' ? c : c.value || '')).join('\n');
    }
    return { ok: true, content: content.trim() || '(aucune information hover)' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── lspDefinition ─────────────────────────────────────────────────────────────

async function lspDefinition(args, guard, projectRoot, config) {
  const r = _resolve(args, guard, projectRoot, config);
  if (r.err) return { ok: false, error: r.err };

  try {
    const client = await r.mgr.clientFor(r.langId);
    const result = await client.definition(r.uri, r.absPath, r.langId, r.line, r.col);

    if (!result) return { ok: true, locations: [] };

    const locs = (Array.isArray(result) ? result : [result]).map((loc) => {
      const targetUri = loc.targetUri || loc.uri;
      const range     = loc.targetRange || loc.targetSelectionRange || loc.range || {};
      return {
        path: path.relative(projectRoot, _uriToPath(targetUri)).replace(/\\/g, '/'),
        line: (range.start?.line ?? 0) + 1,  // 0-based → 1-based
      };
    });
    return { ok: true, locations: locs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── lspReferences ─────────────────────────────────────────────────────────────

async function lspReferences(args, guard, projectRoot, config) {
  const r = _resolve(args, guard, projectRoot, config);
  if (r.err) return { ok: false, error: r.err };

  try {
    const client = await r.mgr.clientFor(r.langId);
    const result = await client.references(r.uri, r.absPath, r.langId, r.line, r.col);

    if (!result || !Array.isArray(result)) return { ok: true, count: 0, locations: [] };

    const locations = result.map((loc) => ({
      path: path.relative(projectRoot, _uriToPath(loc.uri)).replace(/\\/g, '/'),
      line: (loc.range?.start?.line ?? 0) + 1,
    }));
    return { ok: true, count: locations.length, locations };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Dispose global (appelé par agent.js à chaque fin de session) ──────────────

async function disposeLsp() {
  if (_manager) {
    _manager.dispose();
    _manager = null;
  }
}

module.exports = { lspHover, lspDefinition, lspReferences, disposeLsp, _pathToUri, _uriToPath };
