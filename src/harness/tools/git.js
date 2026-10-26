const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GIT_TIMEOUT = 5000; // 5s max par commande git

/**
 * Vérifie qu'un dossier .git existe dans le projectRoot ou un parent.
 */
function _hasGit(projectRoot) {
  let dir = projectRoot;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function _run(cmd, cwd) {
  return execSync(cmd, { cwd, timeout: GIT_TIMEOUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * git_status — retourne les fichiers modifiés/ajoutés/supprimés.
 * Lecture seule. Jamais de modification du repo.
 */
async function gitStatus(args, guard, projectRoot) {
  if (!_hasGit(projectRoot)) return { ok: false, error: 'GIT_NOT_FOUND' };
  try {
    const raw = _run('git status --porcelain', projectRoot);
    const files = raw.split('\n').filter(Boolean).map(line => ({
      status: line.slice(0, 2).trim(),
      path:   line.slice(3).trim(),
    }));
    const branch = _run('git branch --show-current', projectRoot);
    return { ok: true, branch, files };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

/**
 * git_diff — diff d'un fichier ou du repo entier.
 * Lecture seule. Limité à 4000 caractères.
 */
async function gitDiff(args, guard, projectRoot) {
  if (!_hasGit(projectRoot)) return { ok: false, error: 'GIT_NOT_FOUND' };
  try {
    const target = args.path ? args.path : '';
    // path-guard si un fichier est spécifié
    if (args.path) {
      try { guard(args.path); } catch (e) { return { ok: false, error: e.message }; }
    }
    const raw = _run(`git diff -- ${target}`, projectRoot);
    const diff = raw.slice(0, 4000);
    return { ok: true, diff, truncated: raw.length > 4000 };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

/**
 * git_create_branch — crée et bascule sur une nouvelle branche.
 * Requiert enableGitWrite dans la config.
 *
 * @param {{ name: string, from?: string }} args
 * @param {Function} guard
 * @param {string} projectRoot
 * @param {object} config
 */
async function gitCreateBranch({ name, from }, guard, projectRoot, config = {}) {
  if (!config.enableGitWrite) return { ok: false, error: 'GIT_WRITE_DÉSACTIVÉ — activez enableGitWrite dans les paramètres' };
  if (!name || typeof name !== 'string') return { ok: false, error: 'BRANCH_NAME_MANQUANT' };
  // Valider le nom : pas d'espaces, pas de caractères dangereux
  if (!/^[\w\-./]+$/.test(name)) return { ok: false, error: 'BRANCH_NAME_INVALIDE' };
  if (!_hasGit(projectRoot)) return { ok: false, error: 'GIT_NOT_FOUND' };
  try {
    const base = (from && /^[\w\-./]+$/.test(from)) ? from : '';
    _run(`git checkout -b ${name}${base ? ' ' + base : ''}`, projectRoot);
    return { ok: true, branch: name };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

/**
 * git_commit — stage les fichiers listés (ou tout le projet) et crée un commit.
 * Requiert enableGitWrite dans la config.
 *
 * @param {{ message: string, paths?: string[] }} args
 * @param {Function} guard
 * @param {string} projectRoot
 * @param {object} config
 */
async function gitCommit({ message, paths }, guard, projectRoot, config = {}) {
  if (!config.enableGitWrite) return { ok: false, error: 'GIT_WRITE_DÉSACTIVÉ — activez enableGitWrite dans les paramètres' };
  if (!message || typeof message !== 'string') return { ok: false, error: 'COMMIT_MESSAGE_MANQUANT' };
  if (message.length > 500) return { ok: false, error: 'COMMIT_MESSAGE_TROP_LONG' };
  if (!_hasGit(projectRoot)) return { ok: false, error: 'GIT_NOT_FOUND' };
  try {
    if (paths && Array.isArray(paths) && paths.length > 0) {
      // Valider chaque chemin via guard avant de le passer à git
      for (const p of paths) {
        try { guard(p); } catch (e) { return { ok: false, error: `CHEMIN_HORS_PROJET: ${p}` }; }
      }
      const safeList = paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
      _run(`git add -- ${safeList}`, projectRoot);
    } else {
      _run('git add -A', projectRoot);
    }
    // Message entre guillemets simples, escaped
    const safeMsg = message.replace(/'/g, "'\\''");
    _run(`git commit -m '${safeMsg}'`, projectRoot);
    const hash = _run('git rev-parse --short HEAD', projectRoot);
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

module.exports = { gitStatus, gitDiff, gitCreateBranch, gitCommit };
