const path = require('path');
const fs = require('fs');

/**
 * Un modèle écrit souvent « <nom-du-projet>/fichier » alors que la racine EST ce dossier
 * (observé en session réelle : `DOCUM/images_guide.md` → `DOCUM\DOCUM\images_guide.md`).
 * Retourne le chemin sans ce préfixe, ou null s'il ne commence pas par le nom de la racine.
 *
 * @param {string} root
 * @param {string} relPath
 * @returns {string|null}
 */
function _withoutRootPrefix(root, relPath) {
  const base = path.basename(root);
  if (!base) return null;
  const normalized = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  const lower = normalized.toLowerCase();
  if (lower === base.toLowerCase()) return '.';
  if (!lower.startsWith(`${base.toLowerCase()}/`)) return null;
  return normalized.slice(base.length + 1);
}

/**
 * Chemin réel de `abs`, ou de son premier ancêtre existant.
 * @param {string} abs
 * @returns {string|null}
 */
function _realOfExisting(abs) {
  let current = abs;
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      // Lien cassé : une écriture créerait sa cible, hors du projet peut-être
      if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`PATH_GUARD: lien cassé — ${current}`);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

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
    let abs = path.resolve(root, relPath);

    // Chemin doublé (« racine/racine/fichier ») : on ne corrige que si le chemin
    // demandé n'existe pas et que la variante sans préfixe existe réellement.
    if (!fs.existsSync(abs)) {
      const stripped = _withoutRootPrefix(root, relPath);
      if (stripped) {
        const alternative = path.resolve(root, stripped);
        if (fs.existsSync(alternative)) abs = alternative;
      }
    }

    // Refus si hors PROJECT_ROOT
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error(`PATH_GUARD: chemin hors projet — ${abs}`);
    }

    // Refus si symlink sortant. Un fichier à créer n'a pas de chemin réel, mais l'un de
    // ses dossiers parents peut être un lien : on résout donc le premier ancêtre existant.
    // La racine est résolue elle aussi, un projet pouvant être ouvert via un lien.
    const real = _realOfExisting(abs);
    const realRoot = _realOfExisting(root);
    // Racine inexistante : l'ancêtre trouvé est au-dessus d'elle, aucun lien à suivre
    if (real && fs.existsSync(root) && !real.startsWith(realRoot + path.sep) && real !== realRoot) {
      throw new Error(`PATH_GUARD: symlink sortant détecté — ${abs} → ${real}`);
    }

    return abs;
  };
}

module.exports = { makeGuard };
