/**
 * Outil batch_replace — remplace un pattern regex dans tous les fichiers du projet.
 * backup automatique avant chaque écriture.
 */

const fs   = require('fs');
const path = require('path');
const { snapshot } = require('../safety/backup');
const { getIgnore } = require('../safety/harnessignore');

const MAX_FILES        = 100;
const MAX_REPLACEMENTS = 1000;
const MAX_FILE_SIZE    = 512 * 1024;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv',
]);

const DEFAULT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php',
  '.html', '.css', '.scss', '.json', '.yaml', '.yml',
  '.md', '.txt', '.sh', '.bat', '.ps1',
  '.c', '.cpp', '.h', '.hpp',
]);

function _walkFiles(dir, extFilter, ignore, projectRoot, files) {
  if (files.length >= MAX_FILES) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const e of entries) {
    if (files.length >= MAX_FILES) break;

    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const sub    = path.join(dir, e.name);
      const relSub = path.relative(projectRoot, sub).replace(/\\/g, '/');
      if (ignore && ignore.isIgnored(relSub + '/')) continue;
      _walkFiles(sub, extFilter, ignore, projectRoot, files);
      continue;
    }

    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (extFilter) {
      if (ext !== extFilter) continue;
    } else if (!DEFAULT_EXTENSIONS.has(ext)) {
      continue;
    }

    const absPath = path.join(dir, e.name);
    const relPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');
    if (ignore && ignore.isIgnored(relPath)) continue;
    files.push({ absPath, relPath });
  }
}

/**
 * @param {{ pattern: string, replacement?: string, path?: string, ext?: string, dry_run?: boolean }} args
 * @param {Function} guard
 * @param {string}   projectRoot
 */
function batchReplace(
  { pattern, replacement = '', path: subPath = '.', ext, dry_run = false } = {},
  guard,
  projectRoot = '',
) {
  if (!pattern) return { ok: false, error: 'PATTERN_MANQUANT' };

  let regex;
  try { regex = new RegExp(pattern, 'g'); }
  catch (e) { return { ok: false, error: `REGEX_INVALIDE: ${e.message}` }; }

  let startDir;
  try {
    startDir = subPath && subPath !== '.' ? guard(subPath) : (projectRoot || '.');
  } catch (e) { return { ok: false, error: e.message }; }

  const extFilter = ext
    ? (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
    : null;

  const ignore = projectRoot ? getIgnore(projectRoot) : null;
  const files  = [];
  _walkFiles(startDir, extFilter, ignore, startDir, files);

  const results = [];
  let totalReplacements = 0;
  let truncated = false;

  for (const { absPath, relPath } of files) {
    if (totalReplacements >= MAX_REPLACEMENTS) { truncated = true; break; }

    let content;
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      content = fs.readFileSync(absPath, 'utf8');
    } catch { continue; }

    // Compter les occurrences (regex séparée pour éviter d'affecter lastIndex)
    const countRegex = new RegExp(pattern, 'g');
    const countMatches = content.match(countRegex);
    if (!countMatches || countMatches.length === 0) continue;

    const count = countMatches.length;
    totalReplacements += count;

    if (dry_run) {
      results.push({ path: relPath, count });
    } else {
      const newContent = content.replace(new RegExp(pattern, 'g'), replacement);
      snapshot(absPath);
      fs.writeFileSync(absPath, newContent, 'utf8');
      results.push({ path: relPath, count, modified: true });
    }
  }

  return {
    ok: true,
    files_modified:     dry_run ? 0 : results.length,
    files_matched:      results.length,
    total_replacements: totalReplacements,
    results,
    dry_run:   dry_run   || undefined,
    truncated: truncated || undefined,
  };
}

module.exports = { batchReplace };
