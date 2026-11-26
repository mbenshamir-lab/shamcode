const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataDir } = require('../../shared/data-dir');

function getBackupDir() {
  return path.join(getDataDir(), 'backups');
}

/**
 * Clé de stockage d'un fichier : hash de son chemin absolu.
 * Deux projets qui ont tous les deux un `src/app.js` ne partagent donc plus le même
 * dossier de backups — restore_file ne peut plus restaurer le fichier d'un autre projet.
 * @param {string} absPath
 * @returns {string} 16 caractères hexadécimaux
 */
function fileKey(absPath) {
  const normalized = path.resolve(absPath).replace(/\\/g, '/');
  const keyed = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return crypto.createHash('sha1').update(keyed).digest('hex').slice(0, 16);
}

/**
 * Copie un fichier dans le dossier de backup avant modification.
 * Ne fait rien si le fichier n'existe pas encore.
 * Applique une rétention : garde au plus maxBackups snapshots (les plus récents)
 * pour ce fichier précis.
 *
 * @param {string} absPath   - Chemin absolu du fichier à sauvegarder
 * @param {number} [maxBackups=50]
 * @returns {{ ok: boolean, dest?: string, error?: string }}
 */
function snapshot(absPath, maxBackups = 50) {
  if (!fs.existsSync(absPath)) return { ok: true, skipped: true };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(getBackupDir(), fileKey(absPath));
  let dest = path.join(dir, ts, path.basename(absPath));
  // Deux écritures dans la même milliseconde : la seconde écraserait l'original sauvegardé.
  // Le suffixe numéroté reste trié après l'horodatage nu.
  for (let n = 1; fs.existsSync(dest); n++) {
    dest = path.join(dir, `${ts}-${String(n).padStart(3, '0')}`, path.basename(absPath));
  }

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Rétention : supprimer les plus anciens si > maxBackups
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort(); // ISO timestamp tri lexicographique = tri chronologique

    const keep = Math.max(1, Number(maxBackups) || 50); // jamais supprimer le snapshot créé
    if (entries.length > keep) {
      const toDelete = entries.slice(0, entries.length - keep);
      for (const d of toDelete) {
        fs.rmSync(path.join(dir, d), { recursive: true, force: true });
      }
    }
  } catch (e) {
    // Rétention non bloquante : on ignore les erreurs (dossier vide, permissions)
    if (e.code !== 'ENOENT') {
      // log silencieux via logger si disponible
    }
  }

  return { ok: true, dest };
}

/**
 * Sauvegarde exigée avant d'écraser un fichier : sans copie de secours, on n'écrit pas.
 * @param {string} absPath
 * @param {{ backupBeforeWrite?: boolean, maxBackups?: number }} [config]
 * @returns {{ ok: false, error: string } | null} un refus, ou null si la voie est libre
 */
function backupBeforeWrite(absPath, config = {}) {
  if (config.backupBeforeWrite === false) return null;
  const saved = snapshot(absPath, config.maxBackups);
  return saved.ok ? null : { ok: false, error: `BACKUP_ÉCHOUÉ: ${saved.error}` };
}

module.exports = { snapshot, backupBeforeWrite, fileKey, getBackupDir };
