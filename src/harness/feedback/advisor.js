/**
 * Advisor de feedback — génère un résumé des préférences utilisateur
 * à partir de l'historique des approbations/rejets.
 * Ce résumé est injecté dans le prompt système pour guider l'agent.
 */

'use strict';

const path = require('path');

const MIN_ENTRIES_FOR_SUMMARY = 3; // Sous ce seuil : pas assez de signal

/**
 * Calcule les extensions les plus fréquentes dans un sous-ensemble d'entrées.
 *
 * @param {{ path: string }[]} entries
 * @param {number} top
 * @returns {string}
 */
function _topExtensions(entries, top = 3) {
  const counts = {};
  for (const e of entries) {
    const ext = path.extname(e.path || '') || '(aucune)';
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([ext, n]) => `${ext}(${n})`)
    .join(', ');
}

/**
 * Construit un résumé textuel des préférences d'approbation de l'utilisateur.
 * Retourne une chaîne vide si l'historique est trop court.
 *
 * @param {{ ts: number, path: string, action: string, approved: boolean }[]} entries
 * @returns {string}
 */
function buildFeedbackSummary(entries) {
  if (!Array.isArray(entries) || entries.length < MIN_ENTRIES_FOR_SUMMARY) return '';

  const approved  = entries.filter(e => e.approved);
  const rejected  = entries.filter(e => !e.approved);
  const total     = entries.length;
  const approveRate = Math.round((approved.length / total) * 100);

  const lines = [
    `Sur ${total} décisions récentes : ${approved.length} approuvées (${approveRate}%), ${rejected.length} rejetées.`,
  ];

  if (approved.length > 0) {
    lines.push(`Fichiers fréquemment approuvés : ${_topExtensions(approved)}.`);
  }
  if (rejected.length > 0) {
    lines.push(`Fichiers fréquemment rejetés : ${_topExtensions(rejected)}.`);
  }

  // Détecter les actions rejetées fréquemment
  const rejectedActions = {};
  for (const e of rejected) {
    if (e.action) rejectedActions[e.action] = (rejectedActions[e.action] || 0) + 1;
  }
  const worstAction = Object.entries(rejectedActions).sort((a, b) => b[1] - a[1])[0];
  if (worstAction && worstAction[1] >= 2) {
    lines.push(`Action souvent rejetée : "${worstAction[0]}" (${worstAction[1]} fois) — préférer une approche plus ciblée.`);
  }

  if (approveRate < 60) {
    lines.push('Conseil : l\'utilisateur rejette souvent les modifications — être plus conservateur et utiliser replace_code plutôt que write_file.');
  }

  return lines.join('\n');
}

module.exports = { buildFeedbackSummary };
