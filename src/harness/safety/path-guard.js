const path = require('path');
const fs = require('fs');

/**
 * Crée un garde-fou FS pour un projectRoot donné.
 * La fonction retournée résout un chemin relatif en absolu
 * et lève une erreur si le chemin sort du projet ou est un symlink sortant.
 *
 * @param {string} projectRoot - Chemin absolu du dossier projet
 * @returns {(relPath: string) => string} safe — lève si hors projet
 */
function makeGuard(projectRoot) {
  const root = path.resolve(projectRoot);

  return function safe(relPath) {
    const abs = path.resolve(root, relPath);

    // Refus si hors PROJECT_ROOT
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error(`PATH_GUARD: chemin hors projet — ${abs}`);
    }

    // Refus si symlink sortant
    try {
      const real = fs.realpathSync(abs);
      if (!real.startsWith(root + path.sep) && real !== root) {
        throw new Error(`PATH_GUARD: symlink sortant détecté — ${abs} → ${real}`);
      }
    } catch (e) {
      // Le fichier n'existe pas encore (write_file) : pas de symlink à vérifier
      if (e.code !== 'ENOENT') throw e;
    }

    return abs;
  };
}

module.exports = { makeGuard };
