const fs = require('fs');
const path = require('path');
const os = require('os');

function getBackupDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'code-harness', 'backups');
}

const BACKUP_DIR = getBackupDir();

/**
 * Copie un fichier dans le dossier de backup avant modification.
 * Ne fait rien si le fichier n'existe pas encore.
 * Applique une rétention : garde au plus maxBackups snapshots (les plus récents).
 *
 * @param {string} absPath   - Chemin absolu du fichier à sauvegarder
 * @param {number} [maxBackups=50]
 * @returns {{ ok: boolean, dest?: string, error?: string }}
 */
function snapshot(absPath, maxBackups = 50) {
  if (!fs.existsSync(absPath)) return { ok: true, skipped: true };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, ts, path.basename(absPath));

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Rétention : supprimer les plus anciens si > maxBackups
  try {
    const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort(); // ISO timestamp tri lexicographique = tri chronologique

    if (entries.length > maxBackups) {
      const toDelete = entries.slice(0, entries.length - maxBackups);
      for (const dir of toDelete) {
        fs.rmSync(path.join(BACKUP_DIR, dir), { recursive: true, force: true });
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

module.exports = { snapshot };
