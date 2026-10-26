/**
 * Extrait les symboles (fonctions, classes) d'un fichier source.
 * Regex par langage — suffisant pour donner au LLM un aperçu rapide.
 */

const fs   = require('fs');
const path = require('path');

// Patterns par extension : chaque regex capture le nom du symbole en groupe 1
const PATTERNS = {
  '.js':   [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, /^(?:export\s+)?class\s+(\w+)/gm, /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm],
  '.ts':   [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, /^(?:export\s+)?class\s+(\w+)/gm, /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/gm],
  '.py':   [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm],
  '.rs':   [/^(?:pub\s+)?fn\s+(\w+)/gm, /^(?:pub\s+)?struct\s+(\w+)/gm, /^(?:pub\s+)?enum\s+(\w+)/gm],
  '.go':   [/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/gm, /^type\s+(\w+)\s+struct/gm],
  '.java': [/^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm, /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/gm],
  '.cs':   [/(?:public|private|protected|internal)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm, /class\s+(\w+)/gm],
  '.rb':   [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm],
  '.php':  [/function\s+(\w+)/gm, /class\s+(\w+)/gm],
};

/**
 * Extrait les symboles d'un fichier source.
 * @param {string} absPath - Chemin absolu du fichier
 * @returns {{ name: string, type: 'function'|'class'|'symbol' }[]}
 */
function extractSymbols(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const patterns = PATTERNS[ext];
  if (!patterns) return [];

  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }

  const seen    = new Set();
  const symbols = [];

  for (const regex of patterns) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        symbols.push({ name });
      }
    }
  }

  return symbols;
}

/**
 * Retourne une string courte listant les symboles (pour le contexte LLM).
 * @param {string} absPath
 * @returns {string}
 */
function symbolSummary(absPath) {
  const syms = extractSymbols(absPath);
  if (syms.length === 0) return '';
  return `Symboles : ${syms.map(s => s.name).join(', ')}`;
}

module.exports = { extractSymbols, symbolSummary };
