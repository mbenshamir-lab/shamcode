'use strict';

/**
 * Graphe de dépendances statique (ADR-025).
 *
 * Pourquoi : l'agent n'avait aucune visibilité sur les relations d'importation entre
 * fichiers. Sur un grand projet, il ne savait pas quels fichiers seraient impactés par
 * une modification, ni ce qu'un fichier cible importait — il relisait tout ou devinait.
 *
 * Principe : extraction regex des imports relatifs (pas de tree-sitter, pas de binaires
 * natifs). Incrémental : SHA1 par fichier, persisté dans .harness/depgraph.json.
 * Deux maps dérivées : deps (A→ce qu'A importe) et dependents (B→qui importe B).
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { getIgnore } = require('../safety/harnessignore');

const GRAPH_VERSION  = 2;
const MAX_FILES      = 2000;
const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs']);
const TRY_EXTS       = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];

// ── Import extraction (relatifs uniquement) ───────────────────────────────────

const JS_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g,
  /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
];

const PY_PATTERNS = [
  /^from\s+(\.[\w.]*)\s+import/gm,
];

function _extractRawImports(content, ext) {
  const patterns =
    ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext) ? JS_PATTERNS :
    ext === '.py' ? PY_PATTERNS : [];
  const out = new Set();
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) out.add(m[1]);
  }
  return [...out];
}

// ── Résolution de chemin ───────────────────────────────────────────────────────

function _tryExists(absPath) {
  try { fs.accessSync(absPath, fs.constants.F_OK); return true; } catch { return false; }
}

function _resolveImport(fromAbsPath, raw, projectRoot) {
  // Python dot notation : '.foo' → './foo', '..bar' → '../bar'
  let normalized = /^\.+[a-zA-Z_]/.test(raw) ? raw.replace(/^(\.+)([a-zA-Z_])/, '$1/$2') : raw;

  const candidate = path.resolve(path.dirname(fromAbsPath), normalized);
  if (!candidate.startsWith(projectRoot)) return null;

  // Chemin exact (fichier existant)
  if (_tryExists(candidate)) {
    try { if (fs.statSync(candidate).isFile()) return path.relative(projectRoot, candidate).replace(/\\/g, '/'); }
    catch { /* stat failed */ }
  }

  // Avec extension
  for (const ext of TRY_EXTS) {
    const p = candidate + ext;
    if (_tryExists(p)) return path.relative(projectRoot, p).replace(/\\/g, '/');
  }

  // Répertoire → index
  for (const ext of TRY_EXTS) {
    const p = path.join(candidate, `index${ext}`);
    if (_tryExists(p)) return path.relative(projectRoot, p).replace(/\\/g, '/');
  }

  return null;
}

// ── Parcours des fichiers ──────────────────────────────────────────────────────

function _walkFiles(projectRoot) {
  const ignore = getIgnore(projectRoot);
  const result = [];
  let   count  = 0;

  function _walk(relDir) {
    if (count >= MAX_FILES) return;
    const absDir = relDir ? path.join(projectRoot, relDir) : projectRoot;
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (count >= MAX_FILES) break;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (relPath === '.harness' || relPath === '.git') continue;
        if (ignore && ignore.isIgnored(relPath + '/')) continue;
        _walk(relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        if (ignore && ignore.isIgnored(relPath)) continue;
        result.push({ relPath, absPath: path.join(projectRoot, relPath), ext });
        count++;
      }
    }
  }

  _walk('');
  return result;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function _graphPath(projectRoot) {
  return path.join(projectRoot, '.harness', 'depgraph.json');
}

function _loadGraph(projectRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(_graphPath(projectRoot), 'utf8'));
    if (raw.version === GRAPH_VERSION) return raw;
  } catch { /* absent ou corrompu → rebuild */ }
  return { version: GRAPH_VERSION, files: {} };
}

function _saveGraph(projectRoot, graph) {
  const p   = _graphPath(projectRoot);
  const dir = path.dirname(p);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(graph), 'utf8');
  } catch { /* non-fatal */ }
}

function _sha1(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
}

// ── Construction / mise à jour ────────────────────────────────────────────────

/**
 * Construit ou met à jour le graphe de dépendances du projet.
 * Incrémental : seuls les fichiers dont le SHA1 a changé sont re-analysés.
 *
 * @param {string} projectRoot
 * @returns {{ deps: Object, dependents: Object, fileCount: number }}
 *   deps       : { 'src/a.js': ['src/b.js'] }
 *   dependents : { 'src/b.js': ['src/a.js'] }
 */
function buildDepGraph(projectRoot) {
  const graph = _loadGraph(projectRoot);
  const files = _walkFiles(projectRoot);
  const nowKeys = new Set();
  let changed = 0;

  for (const { relPath, absPath, ext } of files) {
    nowKeys.add(relPath);
    let content;
    try { content = fs.readFileSync(absPath, 'utf8'); } catch { continue; }

    const sha1 = _sha1(content);
    if (graph.files[relPath]?.sha1 === sha1) continue;

    const rawImports = _extractRawImports(content, ext);
    const imports    = rawImports
      .map(raw => _resolveImport(absPath, raw, projectRoot))
      .filter(Boolean);

    graph.files[relPath] = { sha1, imports };
    changed++;
  }

  // Nettoyer les fichiers supprimés
  for (const relPath of Object.keys(graph.files)) {
    if (!nowKeys.has(relPath)) { delete graph.files[relPath]; changed++; }
  }

  if (changed > 0) _saveGraph(projectRoot, graph);

  // Maps dérivées
  const deps       = {};
  const dependents = {};

  for (const [relPath, info] of Object.entries(graph.files)) {
    deps[relPath] = info.imports || [];
    for (const dep of info.imports || []) {
      if (!dependents[dep]) dependents[dep] = [];
      if (!dependents[dep].includes(relPath)) dependents[dep].push(relPath);
    }
  }

  return { deps, dependents, fileCount: files.length };
}

/**
 * Retourne imports et importeurs d'un fichier (chemin relatif projet).
 * Reconstruit le graphe si nécessaire.
 *
 * @param {string} projectRoot
 * @param {string} relPath  ex. 'src/harness/agent.js'
 * @returns {{ imports: string[], dependents: string[] }}
 */
function queryFile(projectRoot, relPath) {
  const { deps, dependents } = buildDepGraph(projectRoot);
  return {
    imports:    deps[relPath]       || [],
    dependents: dependents[relPath] || [],
  };
}

module.exports = { buildDepGraph, queryFile };
