/**
 * Outil restore_file : restaure un fichier depuis un backup existant.
 * Les backups sont créés automatiquement avant chaque écriture/suppression/déplacement.
 * Permet à l'agent d'annuler ses propres modifications.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { snapshot } = require('../safety/backup');

function getBackupDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'code-harness', 'backups');
}

/**
 * Liste ou restaure un fichier depuis ses backups.
 *
 * @param {{ path: string, list?: boolean, backup_index?: number }} args
 *   path         : chemin relatif du fichier à restaurer
 *   list         : si true, retourne la liste des backups disponibles sans restaurer
 *   backup_index : index du backup à restaurer (0 = le plus récent, défaut 0)
 * @param {Function} guard
 * @returns {{ ok, restored?, from?, backups? }}
 */
function restoreFile({ path: relPath, list = false, backup_index = 0 }, guard) {
  if (!relPath) return { ok: false, error: 'RESTORE_SANS_CHEMIN' };

  // Valider que le chemin cible est dans le projet
  let absPath;
  try { absPath = guard(relPath); } catch (e) { return { ok: false, error: e.message }; }

  const BACKUP_DIR = getBackupDir();
  const basename   = path.basename(relPath);

  // Lister tous les backups du fichier (les plus récents en premier)
  let backups = [];
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return list
        ? { ok: true, path: relPath, backups: [] }
        : { ok: false, error: `AUCUN_BACKUP_TROUVÉ pour ${relPath}` };
    }

    const dirs = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse(); // plus récent en premier

    for (const dir of dirs) {
      const candidate = path.join(BACKUP_DIR, dir, basename);
      if (fs.existsSync(candidate)) {
        try {
          const stat = fs.statSync(candidate);
          backups.push({ index: backups.length, timestamp: dir, size: stat.size });
        } catch { /* entrée inaccessible → skip */ }
      }
    }
  } catch (e) {
    return { ok: false, error: `ERREUR_LECTURE_BACKUPS: ${e.message}` };
  }

  if (list) {
    return { ok: true, path: relPath, backups };
  }

  if (backups.length === 0) {
    return { ok: false, error: `AUCUN_BACKUP_TROUVÉ pour ${relPath}` };
  }

  if (backup_index >= backups.length) {
    return {
      ok:    false,
      error: `INDEX_HORS_LIMITE: backup_index ${backup_index} demandé, seulement ${backups.length} backup(s) disponible(s)`,
    };
  }

  const chosen     = backups[backup_index];
  const backupPath = path.join(BACKUP_DIR, chosen.timestamp, basename);

  // Snapshot de l'état actuel avant restauration — la restauration est elle-même annulable
  if (fs.existsSync(absPath)) {
    snapshot(absPath);
  }

  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.copyFileSync(backupPath, absPath);
  } catch (e) {
    return { ok: false, error: `ERREUR_RESTAURATION: ${e.message}` };
  }

  return { ok: true, restored: relPath, from: chosen.timestamp, backup_index };
}

module.exports = { restoreFile };
