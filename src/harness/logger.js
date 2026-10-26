/**
 * Logger structuré pour le harness.
 * Écrit des lignes JSON dans data/logs/harness-YYYY-MM-DD.log
 * Rotation quotidienne, rétention 7 jours par défaut.
 *
 * Usage :
 *   const log = require('./logger');
 *   log.info('ipc', 'agent:run reçu', { task: '...' });
 *   log.error('router', 'tous les moteurs KO', { error });
 */

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const LOG_DIR      = path.join(process.env.APPDATA || '', 'code-harness', 'logs');
const MAX_DAYS     = 7;
const MAX_BYTES    = 5 * 1024 * 1024; // 5 Mo max par fichier
let   _enabled     = true;            // peut être désactivé via logger.disable()

// ── Helpers ───────────────────────────────────────────────────────────────────

function _today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _logPath() {
  return path.join(LOG_DIR, `harness-${_today()}.log`);
}

/** Crée le dossier logs si absent. */
function _ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); }
  catch { /* ignoré */ }
}

/** Supprime les fichiers .log plus vieux que MAX_DAYS. */
function _rotate() {
  try {
    const cutoff = Date.now() - MAX_DAYS * 86400_000;
    const files  = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    for (const f of files) {
      const full = path.join(LOG_DIR, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* ignoré */ }
    }
  } catch { /* ignoré */ }
}

let _rotateChecked = false;

// ── Écriture ──────────────────────────────────────────────────────────────────

/**
 * Écrit une ligne de log JSON.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} module  — composant émetteur (ex: 'ipc', 'router', 'agent')
 * @param {string} message
 * @param {object} [data]
 */
function write(level, module, message, data) {
  if (!_enabled) return;

  try {
    if (!_rotateChecked) {
      _ensureDir();
      _rotate();
      _rotateChecked = true;
    }

    const logPath = _logPath();

    // Taille max atteinte → ne pas écrire (évite de bloquer)
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_BYTES) return;
    } catch { /* ignoré */ }

    const entry = {
      ts:  new Date().toISOString(),
      lvl: level,
      mod: module,
      msg: message,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Ne jamais faire planter le harness à cause des logs
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

const logger = {
  debug: (mod, msg, data) => write('debug', mod, msg, data),
  info:  (mod, msg, data) => write('info',  mod, msg, data),
  warn:  (mod, msg, data) => write('warn',  mod, msg, data),
  error: (mod, msg, data) => write('error', mod, msg, data),

  /** Enregistre un événement agent structuré (tool call, finish, erreur...). */
  event: (sessionId, stepOrEvent, data) => write('info', 'agent', `[${sessionId}] ${stepOrEvent}`, data),

  /** Désactive tous les logs (mode test ou user opt-out). */
  disable: () => { _enabled = false; },
  enable:  () => { _enabled = true; },

  /** Retourne le chemin du fichier de log du jour. */
  currentPath: () => _logPath(),
};

module.exports = logger;
