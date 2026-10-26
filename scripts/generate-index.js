'use strict';
/**
 * Génère docs/CODE_INDEX.md : liste de toutes les fonctions/classes publiques
 * exportées par les modules CommonJS de src/, avec leur signature JSDoc et
 * leur position (fichier:ligne).
 *
 * Usage : node scripts/generate-index.js
 * Ou    : npm run index
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SRC_DIR   = path.join(ROOT, 'src');
const OUT_FILE  = path.join(ROOT, 'docs', 'CODE_INDEX.md');

// Dossiers à ignorer complètement
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

// renderer-hidden est ESM pur — module.exports inexistant, on l'ignore
const SKIP_PATHS = ['src/renderer-hidden'];

// ── Utilitaires ──────────────────────────────────────────────────────────────

/** Marche récursive dans dir, retourne les chemins absolus des .js */
function walkJs(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJs(abs, results);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(abs);
    }
  }
  return results;
}

/**
 * Extrait les noms exportés depuis module.exports = { ... } ou
 * module.exports = { name1, name2, ... }.
 * Gère les exports multilignes.
 */
function extractExportNames(src) {
  // Cherche module.exports = { ... } en tenant compte du multilignes
  const match = src.match(/module\.exports\s*=\s*\{([^}]*)\}/s);
  if (!match) return [];

  return match[1]
    .split(',')
    .map(s => {
      // "  name " ou "  name: alias " → on veut la clé (ce qui est dans l'objet)
      const part = s.trim();
      // Ignorer les commentaires inline
      if (!part || part.startsWith('//')) return null;
      // "key: value" → prendre "key"
      const colonIdx = part.indexOf(':');
      const name = colonIdx !== -1 ? part.slice(0, colonIdx).trim() : part;
      return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : null;
    })
    .filter(Boolean);
}

/**
 * Pour un nom exporté, trouve la ligne de définition dans le tableau de lignes.
 * Cherche : function name(, async function name(, class name, const name =, let name =
 */
function findDefinitionLine(lines, name) {
  const patterns = [
    new RegExp(`^\\s*(?:async\\s+)?function\\s+${name}\\s*[\\(({]`),
    new RegExp(`^\\s*class\\s+${name}\\s*[{(]`),
    new RegExp(`^\\s*(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?function`),
    new RegExp(`^\\s*(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?\\(`),
    new RegExp(`^\\s*(?:const|let|var)\\s+${name}\\s*=\\s*class`),
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) return i; // 0-indexed
    }
  }
  return -1;
}

/**
 * Extrait le bloc JSDoc (/** ... *\/) immédiatement au-dessus de lineIdx.
 * Ignore les lignes vides entre le JSDoc et la définition.
 * Retourne null si aucun JSDoc trouvé.
 */
function extractJsDoc(lines, lineIdx) {
  // Remonter en sautant les lignes vides et les décorateurs simples
  let i = lineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;

  if (i < 0 || !lines[i].trim().endsWith('*/')) return null;

  // Remonter jusqu'au /**
  const endIdx = i;
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  if (i < 0) return null;

  return lines.slice(i, endIdx + 1)
    .map(l => l.trim())
    .join('\n');
}

/**
 * Extrait la signature d'une fonction/classe depuis la ligne de définition.
 * Retourne une version courte (une ligne) sans le corps.
 */
function extractSignature(lines, lineIdx, name) {
  const line = lines[lineIdx].trim();

  // Pour les classes, retourner juste "class Name"
  if (/^class\s/.test(line)) {
    const m = line.match(/^(class\s+\w+(?:\s+extends\s+\w+)?)/);
    return m ? m[1] : line;
  }

  // Pour les fonctions, collecter jusqu'au premier { ou ) + {
  let sig = '';
  let depth = 0;
  let collecting = false;

  for (let i = lineIdx; i < Math.min(lineIdx + 8, lines.length); i++) {
    const l = lines[i].trim();
    sig += (sig ? ' ' : '') + l;

    for (const ch of l) {
      if (ch === '(') { depth++; collecting = true; }
      if (ch === ')') { depth--; }
    }

    // On a refermé tous les parenthèses → signature complète
    if (collecting && depth === 0) break;
  }

  // Retirer uniquement le { final qui ouvre le corps de la fonction/classe.
  // Ne pas toucher les { intérieurs (destructuring, valeurs par défaut `= {}`).
  sig = sig.replace(/\s*\{$/, '').trim();
  // Tronquer si trop long
  if (sig.length > 120) sig = sig.slice(0, 117) + '...';
  return sig;
}

// ── Analyse d'un fichier ─────────────────────────────────────────────────────

function analyzeFile(absPath) {
  const relPath = path.relative(ROOT, absPath).replace(/\\/g, '/');

  // Ignorer les chemins exclus
  for (const skip of SKIP_PATHS) {
    if (relPath.startsWith(skip)) return null;
  }

  let src;
  try {
    src = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }

  // Ignorer les fichiers sans module.exports (ESM, HTML loaders, etc.)
  if (!src.includes('module.exports')) return null;

  const exportNames = extractExportNames(src);
  if (exportNames.length === 0) return null;

  const lines = src.split('\n');
  const entries = [];

  for (const name of exportNames) {
    const lineIdx = findDefinitionLine(lines, name);
    if (lineIdx === -1) continue;

    const jsdoc = extractJsDoc(lines, lineIdx);
    const sig   = extractSignature(lines, lineIdx, name);

    entries.push({
      name,
      sig,
      line: lineIdx + 1, // 1-indexed
      jsdoc,
    });
  }

  if (entries.length === 0) return null;

  // Trier par numéro de ligne
  entries.sort((a, b) => a.line - b.line);

  return { relPath, entries };
}

// ── Formatage Markdown ───────────────────────────────────────────────────────

function formatEntry(entry, relPath) {
  const anchor = `${relPath}:${entry.line}`;
  let out = `### \`${entry.name}\` — [${relPath}:${entry.line}](${relPath})\n\n`;
  out += `\`\`\`js\n${entry.sig}\n\`\`\`\n`;

  if (entry.jsdoc) {
    // Extraire les premières lignes de description (avant @param)
    const descLines = entry.jsdoc
      .split('\n')
      .filter(l => !l.startsWith('/**') && !l.startsWith('*/') && !l.startsWith('* @'))
      .map(l => l.replace(/^\s*\*\s?/, ''))
      .filter(l => l.trim());

    if (descLines.length > 0) {
      out += `\n> ${descLines.join(' ')}\n`;
    }

    // Extraire les @param
    const params = entry.jsdoc
      .split('\n')
      .filter(l => l.includes('@param'))
      .map(l => l.replace(/^\s*\*\s?/, '').trim());

    if (params.length > 0) {
      out += '\n' + params.map(p => `- ${p}`).join('\n') + '\n';
    }
  }

  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const files  = walkJs(SRC_DIR);
  const modules = files
    .map(analyzeFile)
    .filter(Boolean)
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const totalFunctions = modules.reduce((n, m) => n + m.entries.length, 0);
  const now = new Date().toISOString().slice(0, 10);

  let md = `# CODE_INDEX — Fonctions publiques exportées\n\n`;
  md += `> Généré le ${now} par \`npm run index\`.\n`;
  md += `> **${totalFunctions} symboles** dans **${modules.length} modules**.\n`;
  md += `> Ne pas modifier manuellement — régénérer avec \`npm run index\`.\n\n`;
  md += `---\n\n`;

  // Table des matières
  md += `## Table des matières\n\n`;
  for (const mod of modules) {
    const anchor = mod.relPath.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    md += `- [${mod.relPath}](#${anchor}) (${mod.entries.length})\n`;
  }
  md += `\n---\n\n`;

  // Contenu par module
  for (const mod of modules) {
    const anchor = mod.relPath.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    md += `## ${mod.relPath}\n\n`;
    for (const entry of mod.entries) {
      md += formatEntry(entry, mod.relPath) + '\n';
    }
    md += '---\n\n';
  }

  // Créer docs/ si nécessaire
  const docsDir = path.join(ROOT, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(OUT_FILE, md, 'utf8');
  console.log(`✓ ${OUT_FILE}`);
  console.log(`  ${totalFunctions} symboles · ${modules.length} modules`);
}

main();
