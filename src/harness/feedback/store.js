/**
 * Store de feedback — enregistre les décisions d'approbation/rejet de l'utilisateur.
 * Format : JSON Lines, un objet par ligne, dans {projectRoot}/.harness/feedback.jsonl
 * Limite : 200 entrées (les plus anciennes sont purgées à l'écriture).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_ENTRIES   = 200;
const HARNESS_DIR   = '.harness';
const FEEDBACK_FILE = 'feedback.jsonl';

/** Retourne le chemin absolu du fichier de feedback pour un projet. */
function _feedbackPath(projectRoot) {
  return path.join(projectRoot, HARNESS_DIR, FEEDBACK_FILE);
}

/**
 * Enregistre une décision d'approbation ou de rejet.
 *
 * @param {{ projectRoot: string, path?: string, action?: string, approved: boolean, reason?: string }} entry
 */
function recordFeedback({ projectRoot, path: filePath = '', action = '', approved, reason = '' }) {
  if (!projectRoot) return;
  const line = JSON.stringify({
    ts:       Date.now(),
    path:     filePath,
    action,
    approved: !!approved,
    ...(reason ? { reason } : {}),
  });

  try {
    const dir = path.join(projectRoot, HARNESS_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fp = _feedbackPath(projectRoot);
    const existing = fs.existsSync(fp)
      ? fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean)
      : [];

    const pruned = [...existing, line].slice(-MAX_ENTRIES);
    fs.writeFileSync(fp, pruned.join('\n') + '\n', 'utf8');
  } catch { /* feedback non bloquant */ }
}

/**
 * Charge les N dernières entrées de feedback.
 *
 * @param {string} projectRoot
 * @param {number} [limit=50]
 * @returns {{ ts, path, action, approved, reason? }[]}
 */
function loadFeedback(projectRoot, limit = 50) {
  if (!projectRoot) return [];
  try {
    const fp = _feedbackPath(projectRoot);
    if (!fs.existsSync(fp)) return [];
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch { return []; }
}

module.exports = { recordFeedback, loadFeedback, _feedbackPath };
