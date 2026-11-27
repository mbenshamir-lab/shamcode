/**
 * Outil diff_file — compare le fichier courant avec son backup.
 * Utilise LCS pour produire un diff ligne par ligne.
 */

const fs   = require('fs');
const path = require('path');
const { getBackupDir, fileKey } = require('../safety/backup');
const { getIgnore } = require('../safety/harnessignore');
const { diffArrays } = require('diff');

/**
 * Diff ligne par ligne, sur le fichier entier.
 * Retourne [{ type: '+' | '-' | '=', text }]
 */
function _diff(oldLines, newLines) {
  return diffArrays(oldLines, newLines).flatMap(part => {
    const type = part.added ? '+' : part.removed ? '-' : '=';
    return part.value.map(text => ({ type, text }));
  });
}

const MAX_DIFF_LINES = 200;
const CONTEXT_LINES  = 3;

/** Sur un long diff, garde les changements et leur voisinage : les premières lignes seules les manqueraient. */
function _aroundChanges(lines) {
  if (lines.length <= MAX_DIFF_LINES) return lines;
  const keep = new Set();
  lines.forEach((line, i) => {
    if (line.type === '=') return;
    for (let j = i - CONTEXT_LINES; j <= i + CONTEXT_LINES; j++) keep.add(j);
  });
  return lines.filter((_, i) => keep.has(i)).slice(0, MAX_DIFF_LINES);
}

function diffFile({ path: relPath, backup_index = 0 } = {}, guard, projectRoot = '') {
  if (!relPath) return { ok: false, error: 'DIFF_SANS_CHEMIN' };

  let absPath;
  try { absPath = guard(relPath); } catch (e) { return { ok: false, error: e.message }; }
  if (projectRoot && getIgnore(projectRoot).isIgnored(path.relative(path.resolve(projectRoot), absPath))) {
    return { ok: false, error: 'FICHIER_IGNORÉ: ce fichier est exclu par .harnessignore' };
  }

  const basename    = path.basename(absPath);
  const backupDir   = path.join(getBackupDir(), fileKey(absPath));

  // Lister les backups disponibles (plus récent en premier)
  const backups = [];
  try {
    if (fs.existsSync(backupDir)) {
      const dirs = fs.readdirSync(backupDir).sort().reverse();
      for (const d of dirs) {
        const candidate = path.join(backupDir, d, basename);
        if (fs.existsSync(candidate)) backups.push({ timestamp: d, file: candidate });
      }
    }
  } catch { /* dossier de backups inaccessible — liste vide */ }

  if (backups.length === 0) return { ok: false, error: 'AUCUN_BACKUP_TROUVÉ' };
  if (backup_index >= backups.length) return { ok: false, error: 'INDEX_HORS_LIMITE' };

  let currentContent;
  try { currentContent = fs.readFileSync(absPath, 'utf8'); }
  catch { return { ok: false, error: 'FICHIER_INTROUVABLE' }; }

  let backupContent;
  try { backupContent = fs.readFileSync(backups[backup_index].file, 'utf8'); }
  catch { return { ok: false, error: 'BACKUP_ILLISIBLE' }; }

  const oldLines = backupContent.split('\n');
  const newLines = currentContent.split('\n');

  const diffResult = _diff(oldLines, newLines);
  const added      = diffResult.filter(d => d.type === '+').length;
  const removed    = diffResult.filter(d => d.type === '-').length;
  const truncated  = diffResult.length > MAX_DIFF_LINES || undefined;

  return {
    ok:          true,
    path:        relPath,
    backup_from: backups[backup_index].timestamp,
    added,
    removed,
    diff_lines:  _aroundChanges(diffResult),
    truncated,
  };
}

module.exports = { diffFile };
