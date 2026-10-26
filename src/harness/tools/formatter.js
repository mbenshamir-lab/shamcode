/**
 * Outil format_file : lance prettier ou eslint --fix sur un fichier du projet.
 * Auto-détecte si le binaire est disponible (local node_modules ou global).
 * Appelé automatiquement par l'agent après write_file quand config.autoFormat: true.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FORMAT_TIMEOUT = 15000;

/**
 * Détecte quel formateur est disponible pour un fichier donné.
 * Retourne { cmd, formatter } ou null.
 */
function _detectFormatter(relPath, projectRoot) {
  const ext = path.extname(relPath).toLowerCase();
  const PRETTIER_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.html', '.md', '.yml', '.yaml'];
  const ESLINT_EXTS   = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

  // Chercher prettier local d'abord, puis global
  if (PRETTIER_EXTS.includes(ext)) {
    const localPrettier = path.join(projectRoot, 'node_modules', '.bin', 'prettier');
    if (fs.existsSync(localPrettier)) {
      return { cmd: `"${localPrettier}" --write "${relPath}"`, formatter: 'prettier' };
    }
    try {
      execSync('prettier --version', { stdio: 'ignore', timeout: 3000 });
      return { cmd: `prettier --write "${relPath}"`, formatter: 'prettier' };
    } catch { /* pas disponible */ }
  }

  // eslint --fix en fallback pour les fichiers JS/TS
  if (ESLINT_EXTS.includes(ext)) {
    const localEslint = path.join(projectRoot, 'node_modules', '.bin', 'eslint');
    if (fs.existsSync(localEslint)) {
      return { cmd: `"${localEslint}" --fix "${relPath}"`, formatter: 'eslint' };
    }
    try {
      execSync('eslint --version', { stdio: 'ignore', timeout: 3000 });
      return { cmd: `eslint --fix "${relPath}"`, formatter: 'eslint' };
    } catch { /* pas disponible */ }
  }

  return null;
}

/**
 * Formate un fichier avec prettier ou eslint --fix.
 *
 * @param {{ path: string }} args
 * @param {Function} guard
 * @param {string} projectRoot
 * @returns {{ ok, formatter?, skipped?, error? }}
 */
async function formatFile({ path: relPath }, guard, projectRoot) {
  if (!relPath) return { ok: false, error: 'CHEMIN_MANQUANT' };
  try {
    guard(relPath); // vérifie que le chemin est dans le projet
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const detected = _detectFormatter(relPath, projectRoot);
  if (!detected) {
    return { ok: true, skipped: true, reason: 'Aucun formateur disponible pour cette extension' };
  }

  try {
    execSync(detected.cmd, { cwd: projectRoot, timeout: FORMAT_TIMEOUT, stdio: 'ignore' });
    return { ok: true, formatter: detected.formatter, path: relPath };
  } catch (e) {
    // Le formatage non-bloquant : on renvoie ok:false mais l'agent peut continuer
    return { ok: false, formatter: detected.formatter, error: e.message.slice(0, 200) };
  }
}

module.exports = { formatFile, _detectFormatter };
