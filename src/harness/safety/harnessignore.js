/**
 * Lecture et application du fichier `.harnessignore` à la racine du projet.
 * Syntaxe simplifiée (sous-ensemble .gitignore) :
 *   - Lignes vides et commentaires (#) ignorés
 *   - Patterns avec glob simple : * (tout sauf /), ** (tout), ? (un char)
 *   - Préfixe / = ancré à la racine du projet
 *   - Suffixe / = dossier uniquement
 *   - Préfixe ! = annule la règle précédente (non supporté — ignoré silencieusement)
 *
 * Usage :
 *   const ignore = loadHarnessIgnore(projectRoot);
 *   ignore.isIgnored('src/secret.env')  // → true/false (chemin relatif POSIX)
 */

const fs   = require('fs');
const path = require('path');

const CANDIDATES = ['.harnessignore', '.harness-ignore'];

/**
 * Convertit un pattern .gitignore simplifié en RegExp.
 * @param {string} pattern
 * @returns {RegExp}
 */
function _patternToRegex(pattern) {
  let p = pattern;

  // Dossier uniquement (suffixe /) — on ajoute un match sur préfixe
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  // Ancrée à la racine si commence par /
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);

  // Échapper les caractères spéciaux RegExp sauf * et ?
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // ** → match n'importe quel chemin
  p = p.replace(/\*\*/g, '￾');
  // * → tout sauf /
  p = p.replace(/\*/g, '[^/]*');
  // ? → un caractère sauf /
  p = p.replace(/\?/g, '[^/]');
  // Restaurer **
  p = p.replace(/￾/g, '.*');

  // Ancrage : si ancré, doit commencer depuis la racine
  // Sinon, peut apparaître n'importe où dans le chemin
  const prefix = anchored ? '^' : '(^|.*/)';
  // Si dirOnly, le chemin doit correspondre à ce dossier ou être sous ce dossier
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';

  return new RegExp(`${prefix}${p}${suffix}`);
}

/**
 * Charge le fichier .harnessignore depuis la racine du projet.
 * Retourne un objet avec isIgnored(relPath).
 *
 * @param {string} projectRoot - Chemin absolu de la racine
 * @returns {{ isIgnored: (relPath: string) => boolean, patterns: string[], loaded: boolean }}
 */
function loadHarnessIgnore(projectRoot) {
  let raw = '';
  let loaded = false;

  for (const name of CANDIDATES) {
    try {
      const p = path.join(projectRoot, name);
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf8');
        loaded = true;
        break;
      }
    } catch { /* ignoré */ }
  }

  const patterns = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));

  const regexes = patterns.map(_patternToRegex);

  function isIgnored(relPath) {
    // Normaliser les séparateurs → POSIX
    const normalized = relPath.replace(/\\/g, '/');
    return regexes.some(re => re.test(normalized));
  }

  return { isIgnored, patterns, loaded };
}

// Cache par projectRoot : { ignore, mtime }
// Recharge automatiquement si le fichier .harnessignore a été modifié.
const _cache = new Map();

/**
 * Version mise en cache de loadHarnessIgnore.
 * Recharge si le fichier a changé depuis la dernière lecture.
 *
 * @param {string} projectRoot
 * @returns {{ isIgnored: (relPath: string) => boolean, patterns: string[], loaded: boolean }}
 */
function getIgnore(projectRoot) {
  let currentMtime = 0;
  for (const name of CANDIDATES) {
    try {
      const p = path.join(projectRoot, name);
      const stat = fs.statSync(p);
      currentMtime = stat.mtimeMs;
      break;
    } catch { /* absent */ }
  }

  const cached = _cache.get(projectRoot);
  if (cached && cached.mtime === currentMtime) return cached.ignore;

  const ignore = loadHarnessIgnore(projectRoot);
  _cache.set(projectRoot, { ignore, mtime: currentMtime });
  return ignore;
}

module.exports = { loadHarnessIgnore, getIgnore };
