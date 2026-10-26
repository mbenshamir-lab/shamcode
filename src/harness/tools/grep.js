const fs   = require('fs');
const path = require('path');
const { getIgnore } = require('../safety/harnessignore');

const MAX_MATCHES = 50;
const MAX_FILE_SIZE = 512 * 1024; // 512 Ko — skip les gros fichiers binaires

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache',
  'data', '__pycache__', '.venv', 'venv',
]);

const DEFAULT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php',
  '.html', '.css', '.scss', '.json', '.yaml', '.yml',
  '.md', '.txt', '.sh', '.bat', '.ps1', '.env',
  '.c', '.cpp', '.h', '.hpp',
]);

/**
 * Recherche un pattern (string ou regex) dans les fichiers du projet.
 * @param {{ pattern: string, path?: string, ext?: string }} args
 * @param {Function} guard - path-guard
 * @param {string}   projectRoot - Optionnel, pour appliquer .harnessignore
 */
async function searchGrep(args, guard, projectRoot = '') {
  if (!args.pattern) return { ok: false, error: 'PATTERN_MANQUANT' };
  const contextLines = Math.min(Math.max(0, args.context_lines ?? 0), 5);

  let regex;
  try {
    regex = new RegExp(args.pattern, 'i');
  } catch {
    // Pas une regex valide → recherche littérale
    regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  // Dossier de départ (path-guard appliqué)
  let startDir;
  try {
    startDir = args.path ? guard(args.path) : guard('.');
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Filtre d'extension optionnel (ex : ".js" ou "js")
  let extFilter = null;
  if (args.ext) {
    extFilter = args.ext.startsWith('.') ? args.ext.toLowerCase() : `.${args.ext.toLowerCase()}`;
  }

  // Racine de référence pour les chemins relatifs dans les résultats
  const relRoot = projectRoot || startDir;
  const ignore  = projectRoot ? getIgnore(projectRoot) : null;
  const matches = [];
  _walk(startDir, regex, extFilter, matches, ignore, projectRoot, relRoot, contextLines);

  return { ok: true, matches };
}

/** Retourne les lignes de contexte autour d'un match (index 0-based). */
function _context(lines, idx, n) {
  const from = Math.max(0, idx - n);
  const to   = Math.min(lines.length - 1, idx + n);
  return lines.slice(from, to + 1).map((l, i) => ({
    line:  from + i + 1,
    text:  l.slice(0, 200),
    match: from + i === idx,
  }));
}

function _walk(dir, regex, extFilter, matches, ignore, projectRoot, relRoot, contextLines = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (matches.length >= MAX_MATCHES) return;

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        const sub = path.join(dir, entry.name);
        if (ignore && projectRoot) {
          const rel = path.relative(projectRoot, sub).replace(/\\/g, '/');
          if (ignore.isIgnored(rel + '/')) continue;
        }
        _walk(sub, regex, extFilter, matches, ignore, projectRoot, relRoot, contextLines);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (extFilter) {
      if (ext !== extFilter) continue;
    } else if (!DEFAULT_EXTENSIONS.has(ext)) {
      continue;
    }

    const filePath = path.join(dir, entry.name);
    // Toujours exposer un chemin relatif au LLM — compatible avec read_file / replace_code
    const relPath  = path.relative(relRoot, filePath).replace(/\\/g, '/');

    // Skip les fichiers ignorés par .harnessignore
    if (ignore && ignore.isIgnored(relPath)) continue;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      const lines   = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const entry = { path: relPath, line: i + 1, text: lines[i].trim().slice(0, 200) };
          if (contextLines > 0) entry.context = _context(lines, i, contextLines);
          matches.push(entry);
          if (matches.length >= MAX_MATCHES) return;
        }
      }
    } catch { /* fichier illisible → skip */ }
  }
}

module.exports = { searchGrep };
