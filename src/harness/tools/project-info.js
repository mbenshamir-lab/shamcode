/**
 * Outil get_project_info : retourne les métadonnées structurées du projet.
 * Lit package.json, Cargo.toml, go.mod ou pyproject.toml selon ce qui est présent.
 * Évite au LLM d'avoir à parser ces fichiers à la main.
 */

const fs   = require('fs');
const path = require('path');

const MAX_DEPS_SHOWN = 15; // nombre de dépendances remontées au LLM

/**
 * @param {object} _args  - ignoré (aucun paramètre requis)
 * @param {string} projectRoot
 * @returns {{ ok, info: object }}
 */
function getProjectInfo(_args, projectRoot) {
  if (!projectRoot) return { ok: false, error: 'GET_PROJECT_INFO_SANS_PROJET' };

  // ── npm / Node.js ────────────────────────────────────────────────────────────
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps    = Object.keys(pkg.dependencies    || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      const info = {
        type:        'node',
        name:        pkg.name        || '(sans nom)',
        version:     pkg.version     || '0.0.0',
        description: pkg.description || '',
        main:        pkg.main        || 'index.js',
        scripts:     pkg.scripts     || {},
        dependencies:       deps.slice(0, MAX_DEPS_SHOWN),
        devDependencies:    devDeps.slice(0, MAX_DEPS_SHOWN),
        dependenciesCount:  deps.length,
        devDependenciesCount: devDeps.length,
        engines: pkg.engines || {},
      };
      return { ok: true, info };
    } catch (e) {
      return { ok: false, error: `PARSE_ERREUR package.json: ${e.message}` };
    }
  }

  // ── Rust / Cargo ─────────────────────────────────────────────────────────────
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const raw  = fs.readFileSync(cargoPath, 'utf8');
      const name    = (raw.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || '(inconnu)';
      const version = (raw.match(/^version\s*=\s*"([^"]+)"/m) || [])[1] || '0.0.0';
      const edition = (raw.match(/^edition\s*=\s*"([^"]+)"/m) || [])[1] || '';
      const depMatches = [...raw.matchAll(/^(\w[\w-]*)\s*=/gm)].map(m => m[1]).filter(n => !['name','version','edition','authors','description','license','repository'].includes(n));
      return { ok: true, info: { type: 'rust', name, version, edition, dependencies: depMatches.slice(0, MAX_DEPS_SHOWN), dependenciesCount: depMatches.length } };
    } catch (e) {
      return { ok: false, error: `PARSE_ERREUR Cargo.toml: ${e.message}` };
    }
  }

  // ── Go ───────────────────────────────────────────────────────────────────────
  const goModPath = path.join(projectRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    try {
      const raw     = fs.readFileSync(goModPath, 'utf8');
      const module  = (raw.match(/^module\s+(\S+)/m) || [])[1] || '(inconnu)';
      const goVer   = (raw.match(/^go\s+(\S+)/m) || [])[1] || '';
      const requires = [...raw.matchAll(/^\s+(\S+)\s+v[\w.+-]+/gm)].map(m => m[1]);
      return { ok: true, info: { type: 'go', module, goVersion: goVer, dependencies: requires.slice(0, MAX_DEPS_SHOWN), dependenciesCount: requires.length } };
    } catch (e) {
      return { ok: false, error: `PARSE_ERREUR go.mod: ${e.message}` };
    }
  }

  // ── Python (pyproject.toml) ───────────────────────────────────────────────
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const raw     = fs.readFileSync(pyprojectPath, 'utf8');
      const name    = (raw.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || '(inconnu)';
      const version = (raw.match(/^version\s*=\s*"([^"]+)"/m) || [])[1] || '';
      const deps    = [...raw.matchAll(/^\s+"([\w][\w.-]+)/gm)].map(m => m[1]);
      return { ok: true, info: { type: 'python', name, version, dependencies: deps.slice(0, MAX_DEPS_SHOWN), dependenciesCount: deps.length } };
    } catch (e) {
      return { ok: false, error: `PARSE_ERREUR pyproject.toml: ${e.message}` };
    }
  }

  // ── Python (requirements.txt) ────────────────────────────────────────────
  const reqPath = path.join(projectRoot, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const lines = fs.readFileSync(reqPath, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'));
      return { ok: true, info: { type: 'python', name: path.basename(projectRoot), dependencies: lines.slice(0, MAX_DEPS_SHOWN), dependenciesCount: lines.length } };
    } catch (e) {
      return { ok: false, error: `PARSE_ERREUR requirements.txt: ${e.message}` };
    }
  }

  return { ok: false, error: 'PROJET_NON_RECONNU — aucun package.json, Cargo.toml, go.mod ou pyproject.toml trouvé' };
}

module.exports = { getProjectInfo };
