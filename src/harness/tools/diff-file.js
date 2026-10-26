/**
 * Outil diff_file — compare le fichier courant avec son backup.
 * Utilise LCS pour produire un diff ligne par ligne.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

function _getBackupDir() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'code-harness', 'backups');
}

/**
 * LCS-based diff entre deux tableaux de lignes.
 * Limité à 500 lignes chacun pour éviter O(n²) sur de gros fichiers.
 * Retourne [{ type: '+' | '-' | '=', text }]
 */
function _diff(oldLines, newLines) {
  const MAX = 500;
  const a = oldLines.slice(0, MAX);
  const b = newLines.slice(0, MAX);
  const m = a.length, n = b.length;

  // Tableau DP
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Retrace
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: '=', text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: '+', text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: '-', text: a[i - 1] });
      i--;
    }
  }
  return result;
}

const MAX_DIFF_LINES = 200;

function diffFile({ path: relPath, backup_index = 0 } = {}, guard) {
  if (!relPath) return { ok: false, error: 'DIFF_SANS_CHEMIN' };

  let absPath;
  try { absPath = guard(relPath); } catch (e) { return { ok: false, error: e.message }; }

  const basename    = path.basename(absPath);
  const backupDir   = _getBackupDir();

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
  } catch { /* APPDATA inaccessible — liste vide */ }

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
    diff_lines:  diffResult.slice(0, MAX_DIFF_LINES),
    truncated,
  };
}

module.exports = { diffFile };
