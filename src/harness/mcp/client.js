'use strict';
/**
 * Client MCP minimaliste — supporte deux transports :
 *   • stdio  : spawn d'un processus local, JSON-RPC sur stdin/stdout
 *   • http   : POST JSON-RPC vers une URL distante (+ Bearer token optionnel)
 *
 * N'importe JAMAIS electron — conforme à la règle harness.
 */

const { spawn }    = require('child_process');
const readline     = require('readline');
const http         = require('http');
const https        = require('https');
const { URL }      = require('url');
const EventEmitter = require('events');

const MCP_PROTOCOL_VERSION = '2024-11-05';

class McpClient extends EventEmitter {
  /**
   * @param {object} connector  - config du connecteur (type, url, args, auth)
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=15000]
   */
  constructor(connector, opts = {}) {
    super();
    this._connector  = connector;
    this._timeout    = opts.timeoutMs ?? 15000;
    this._nextId     = 1;
    this._pending    = new Map();   // id → { resolve, reject, timer }
    this._tools      = [];
    this._ready      = false;
    this._disposed   = false;

    // stdio uniquement
    this._proc  = null;
    this._rl    = null;
  }

  // ── Connexion ─────────────────────────────────────────────────────────────

  /** Démarre la connexion (initialize + tools/list). */
  async connect() {
    if (this._connector.type === 'stdio') {
      await this._connectStdio();
    } else {
      await this._connectHttp();
    }
    await this._handshake();
    this._tools = await this._discoverTools();
    this._ready = true;
    return this._tools;
  }

  /** Outils découverts après connect(). */
  get tools() { return this._tools; }

  // ── Transport stdio ───────────────────────────────────────────────────────

  _connectStdio() {
    return new Promise((resolve, reject) => {
      const { url: cmd, args = [] } = this._connector;

      // args peut être un tableau ou une chaîne multiligne séparée par \n
      const argList = Array.isArray(args)
        ? args
        : String(args).split('\n').map(s => s.trim()).filter(Boolean);

      const [bin, ...rest] = cmd.trim().split(/\s+/);
      const allArgs = [...rest, ...argList];

      this._proc = spawn(bin, allArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this._proc.on('error', err => {
        this.emit('error', err);
        this._rejectAll(`Processus MCP: ${err.message}`);
        reject(err);
      });

      this._rl = readline.createInterface({ input: this._proc.stdout });
      this._rl.on('line', line => this._handleLine(line));

      this._proc.stderr?.on('data', data => {
        this.emit('stderr', data.toString());
      });

      // Prêt dès que le processus est démarré
      resolve();
    });
  }

  _send(payload) {
    if (this._connector.type === 'stdio') {
      this._proc.stdin.write(JSON.stringify(payload) + '\n');
    }
    // HTTP : géré dans _request()
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      clearTimeout(timer);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else resolve(msg.result ?? null);
    }
  }

  // ── Transport HTTP ────────────────────────────────────────────────────────

  _connectHttp() {
    // Pas de connexion persistante — chaque appel est un POST indépendant
    return Promise.resolve();
  }

  async _requestHttp(payload) {
    const { url, auth } = this._connector;
    const parsed  = new URL(url);
    const useHttps = parsed.protocol === 'https:';
    const body    = JSON.stringify(payload);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (auth) headers['Authorization'] = `Bearer ${auth}`;

    return new Promise((resolve, reject) => {
      const lib = useHttps ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port:     parsed.port || (useHttps ? 443 : 80),
          path:     parsed.pathname + (parsed.search || ''),
          method:   'POST',
          headers,
        },
        res => {
          let raw = '';
          res.on('data', d => { raw += d; });
          res.on('end', () => {
            try {
              const msg = JSON.parse(raw);
              if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
              else resolve(msg.result ?? null);
            } catch (e) {
              reject(new Error(`Réponse MCP non-JSON : ${raw.slice(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Timeout MCP HTTP (${this._timeout}ms)`));
      }, this._timeout);
      req.on('close', () => clearTimeout(timer));
      req.write(body);
      req.end();
    });
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────

  _request(method, params = {}) {
    const id = this._nextId++;
    if (this._connector.type === 'http') {
      const payload = { jsonrpc: '2.0', id, method, params };
      return this._requestHttp(payload);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout MCP stdio (${this._timeout}ms) — méthode: ${method}`));
      }, this._timeout);

      this._pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  _notify(method, params = {}) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  // ── Protocole MCP ─────────────────────────────────────────────────────────

  async _handshake() {
    await this._request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities:    {},
      clientInfo:      { name: 'code-harness', version: '1.0' },
    });
    this._notify('notifications/initialized');
  }

  async _discoverTools() {
    try {
      const result = await this._request('tools/list');
      return result?.tools ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Appelle un outil MCP.
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<{ ok: boolean, content?: string, error?: string }>}
   */
  async callTool(toolName, args = {}) {
    if (this._disposed) return { ok: false, error: 'CLIENT_DISPOSE' };
    try {
      const result = await this._request('tools/call', { name: toolName, arguments: args });

      // Normaliser la réponse MCP → format harness { ok, content }
      const contents = result?.content ?? [];
      const isError  = result?.isError === true;

      const text = contents
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      if (isError) return { ok: false, error: text || 'Erreur MCP sans détail' };
      return { ok: true, content: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Nettoyage ─────────────────────────────────────────────────────────────

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._rejectAll('Client MCP disposé');
    if (this._rl) { try { this._rl.close(); } catch {} }
    if (this._proc) {
      try { this._proc.stdin?.end(); } catch {}
      try { this._proc.kill('SIGTERM'); } catch {}
    }
  }

  _rejectAll(reason) {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this._pending.clear();
  }
}

module.exports = { McpClient };
