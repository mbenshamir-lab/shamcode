/**
 * Outil find_symbol : cherche une définition de fonction/classe/variable
 * par nom dans les fichiers source du projet.
 * Retourne les correspondances avec chemin relatif et numéro de ligne.
 */

const fs   = require('fs');
const path = require('path');
const { getIgnore } = require('../safety/harnessignore');

const SUPPORTED_EXTS = new Set(['.js', '.ts', '.py', '.rs', '.go', '.java', '.cs', '.rb', '.php']);
const MAX_MATCHES    = 20;
const MAX_FILES      = 500;

// Patterns de détection de symboles par extension (groupe 1 = nom du symbole)
const PATTERNS = {
  '.js':  [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, /^(?:export\s+)?class\s+(\w+)/gm, /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm],
  '.ts':  [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, /^(?:export\s+)?class\s+(\w+)/gm, /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/gm],
  '.py':  [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm],
  '.rs':  [/^(?:pub\s+)?fn\s+(\w+)/gm, /^(?:pub\s+)?struct\s+(\w+)/gm, /^(?:pub\s+)?enum\s+(\w+)/gm],
  '.go':  [/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/gm, /^type\s+(\w+)\s+struct/gm],
  '.java':[/^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm, /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/gm],
  '.cs':  [/(?:public|private|protected|internal)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm, /class\s+(\w+)/gm],
  '.rb':  [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm],
  '.php': [/function\s+(\w+)/gm, /class\s+(\w+)/gm],
};

/** Retourne le numéro de ligne (1-indexé) d'un offset dans une chaîne. */
function _lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Extrait les symboles d'un contenu source avec leur numéro de ligne. */
function _symbolsWithLines(content, ext) {
  const patterns = PATTERNS[ext];
  if (!patterns) return [];
  const seen   = new Set();
  const result = [];
  for (const regex of patterns) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        result.push({ name, line: _lineOf(content, m.index) });
      }
    }
  }
  return result;
}

/**
 * Recherche un symbole par nom dans le projet.
 *
 * @param {{ name: string, path?: string, exact?: boolean }} args
 *   name  : nom recherché (partiel insensible à la casse par défaut)
 *   path  : sous-dossier à inspecter (défaut '.')
 *   exact : si true, correspondance exacte (sensible à la casse)
 * @param {Function} guard
 * @param {string}   projectRoot
 * @returns {{ ok, matches: { path, line, name }[], files_scanned, truncated? }}
 */
function findSymbol({ name, path: subPath = '.', exact = false }, guard, projectRoot = '') {
  if (!name) return { ok: false, error: 'FIND_SYMBOL_SANS_NOM' };

  const needle = exact ? name : name.toLowerCase();
  const ignore = projectRoot ? getIgnore(projectRoot) : null;
  const matches = [];
  let filesScanned = 0;

  function _walk(relDir) {
    if (matches.length >= MAX_MATCHES || filesScanned >= MAX_FILES) return;
    let abs;
    try { abs = guard(relDir); } catch { return; }
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES || filesScanned >= MAX_FILES) break;
      const rel = path.join(relDir, entry.name).replace(/\\/g, '/');
      if (ignore && ignore.isIgnored(entry.isDirectory() ? rel + '/' : rel)) continue;

      if (entry.isDirectory()) {
        _walk(rel);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        filesScanned++;
        let content;
        try { content = fs.readFileSync(guard(rel), 'utf8'); } catch { continue; }

        const syms = _symbolsWithLines(content, ext);
        for (const sym of syms) {
          if (matches.length >= MAX_MATCHES) break;
          const haystack = exact ? sym.name : sym.name.toLowerCase();
          if (exact ? haystack === needle : haystack.includes(needle)) {
            matches.push({ path: rel, line: sym.line, name: sym.name });
          }
        }
      }
    }
  }

  try {
    _walk(subPath);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const truncated = matches.length >= MAX_MATCHES || filesScanned >= MAX_FILES;
  return { ok: true, matches, files_scanned: filesScanned, ...(truncated ? { truncated: true } : {}) };
}

module.exports = { findSymbol };
