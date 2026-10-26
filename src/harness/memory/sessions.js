/**
 * Gestion des sessions de l'agent.
 * Chaque session = un fichier JSON dans data/sessions/.
 *
 * Format : { id, createdAt, projectRoot, task, steps, result, scratchpad }
 *
 * Rétention : les sessions les plus anciennes sont supprimées
 * quand la limite (défaut 100) est dépassée.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

function getSessionsDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'code-harness', 'sessions');
}

/**
 * Crée une nouvelle session et la persiste sur disque.
 * @param {{ task: string, projectRoot: string }} opts
 * @returns {{ id: string, path: string, session: object }}
 */
function createSession({ task, projectRoot }) {
  const id        = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();
  const session   = { id, createdAt, projectRoot, task, steps: [], result: null, scratchpad: '' };

  const dir = getSessionsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  _write(filePath, session);

  return { id, path: filePath, session };
}

/**
 * Met à jour une session existante (steps, result, scratchpad).
 * @param {string} sessionPath
 * @param {Partial<object>} updates
 */
function updateSession(sessionPath, updates) {
  try {
    const current = _read(sessionPath);
    const updated = { ...current, ...updates };
    _write(sessionPath, updated);
    return updated;
  } catch {
    return null;
  }
}

/**
 * Charge une session depuis son id.
 * @param {string} id
 * @returns {object|null}
 */
function loadSession(id) {
  const filePath = path.join(getSessionsDir(), `${id}.json`);
  return _read(filePath);
}

/**
 * Liste toutes les sessions, triées par date décroissante.
 * @returns {{ id, createdAt, task, projectRoot, result }[]}
 */
function listSessions() {
  const dir = getSessionsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const s = _read(path.join(dir, f));
        if (!s) return null;
        return { id: s.id, createdAt: s.createdAt, task: s.task, projectRoot: s.projectRoot, result: s.result };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}

/**
 * Supprime les sessions excédentaires (les plus anciennes).
 * @param {number} maxSessions
 */
function applyRetention(maxSessions = 100) {
  const dir = getSessionsDir();
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);    // plus ancien en premier

    if (files.length > maxSessions) {
      for (const { file } of files.slice(0, files.length - maxSessions)) {
        try { fs.unlinkSync(path.join(dir, file)); } catch { /* ignoré */ }
      }
    }
  } catch { /* ignoré */ }
}

function _write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function _read(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

module.exports = { createSession, updateSession, loadSession, listSessions, applyRetention };
