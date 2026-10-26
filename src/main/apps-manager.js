'use strict';

/**
 * AppsManager — registre en mémoire des applications connectées.
 * Ping périodique (HEAD HTTP) pour maintenir le statut en temps réel.
 * Exposé via IPC → renderer (badge vert/rouge dans le panneau Apps).
 */

const http  = require('http');
const https = require('https');

const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS  = 5_000;

class AppsManager {
  /**
   * @param {(apps: AppEntry[]) => void} onUpdate — appelé après chaque changement
   */
  constructor(onUpdate) {
    this._apps     = new Map(); // urlKey → AppEntry
    this._onUpdate = onUpdate || (() => {});
    this._timer    = null;
  }

  // ── API publique ─────────────────────────────────────────────────────────────

  register(rawUrl, name) {
    const key = _key(rawUrl);
    if (!key) return;
    if (this._apps.has(key)) {
      // Déjà présent : on déclenche juste un nouveau ping
      this._pingOne(key);
      return;
    }
    this._apps.set(key, {
      url:        rawUrl,
      name:       name || _shortName(rawUrl),
      status:     'pending',
      lastCheck:  null,
      latency_ms: null,
    });
    this._pingOne(key);
    this._notify();
  }

  suspend(rawUrl) {
    const entry = this._apps.get(_key(rawUrl));
    if (entry && entry.status !== 'suspended') {
      entry.status = 'suspended';
      this._notify();
    }
  }

  resume(rawUrl) {
    const key   = _key(rawUrl);
    const entry = this._apps.get(key);
    if (entry) {
      entry.status = 'pending';
      this._pingOne(key);
      this._notify();
    }
  }

  remove(rawUrl) {
    if (this._apps.delete(_key(rawUrl))) this._notify();
  }

  getAll() {
    return [...this._apps.values()];
  }

  async pingAll() {
    await Promise.all([...this._apps.keys()].map(k => this._pingOne(k)));
  }

  startPeriodicPing() {
    if (this._timer) return;
    this._timer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref(); // ne bloque pas la fermeture
  }

  stopPeriodicPing() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Interne ──────────────────────────────────────────────────────────────────

  async _pingOne(key) {
    const entry = this._apps.get(key);
    if (!entry || entry.status === 'suspended') return;

    const start = Date.now();
    const ok    = await _headRequest(entry.url);

    entry.latency_ms = Date.now() - start;
    entry.lastCheck  = new Date().toISOString();
    entry.status     = ok ? 'active' : 'error';
    this._notify();
  }

  _notify() {
    this._onUpdate(this.getAll());
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _key(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function _shortName(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname !== '/' ? u.pathname.slice(0, 18) : '';
    return `${u.hostname}${u.port ? ':' + u.port : ''}${path}`;
  } catch {
    return rawUrl.slice(0, 30);
  }
}

function _headRequest(url) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve(false); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'HEAD', timeout: PING_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { AppsManager };
