// Calcul et formatage de diff unifié pour affichage dans l'UI avant écriture.
// Utilise la dépendance npm "diff" (déjà dans package.json).

const { createPatch } = require('diff');

/**
 * Calcule un patch unifié entre deux contenus.
 * @param {string} oldContent
 * @param {string} newContent
 * @param {string} filename
 * @returns {string} patch unifié (format GNU diff -u)
 */
function previewDiff(oldContent, newContent, filename) {
  return createPatch(filename, oldContent, newContent, '', '', { context: 3 });
}

/**
 * Retourne des stats lisibles sur un patch.
 * @param {string} patch
 * @returns {{ additions: number, deletions: number, hunks: number }}
 */
function diffStats(patch) {
  const lines = patch.split('\n');
  let additions = 0, deletions = 0, hunks = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    else if (line.startsWith('@@')) hunks++;
  }
  return { additions, deletions, hunks };
}

/**
 * Construit un objet d'événement write_preview complet.
 * @param {string} relPath
 * @param {string} oldContent  — '' si fichier nouveau
 * @param {string} newContent
 * @returns {{ type, path, patch, stats }}
 */
function buildWritePreview(relPath, oldContent, newContent) {
  const patch = previewDiff(oldContent, newContent, relPath);
  const stats  = diffStats(patch);
  return { type: 'write_preview', path: relPath, patch, stats };
}

module.exports = { previewDiff, diffStats, buildWritePreview };
