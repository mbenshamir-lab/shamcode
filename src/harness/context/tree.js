/**
 * Génère une arborescence textuelle filtrée du projet.
 * Ignore les dossiers inutiles pour ne pas polluer le contexte LLM.
 */

const fs   = require('fs');
const path = require('path');
const { getIgnore } = require('../safety/harnessignore');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '__pycache__',
  '.next', '.nuxt', 'out', 'coverage', '.cache', '.vscode', '.idea',
  'vendor', '.yarn', '.pnp',
]);

const IGNORE_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.jpg', '.jpeg', '.png',
  '.gif', '.webp', '.ico', '.svg', '.ttf', '.woff', '.woff2', '.mp4',
  '.zip', '.tar', '.gz', '.lock',
]);

/**
 * Construit une arborescence ASCII du projet.
 * @param {string} root       - Chemin absolu de la racine
 * @param {{ maxDepth?: number, maxEntries?: number }} opts
 * @returns {string}
 */
function buildTree(root, { maxDepth = 4, maxEntries = 200 } = {}) {
  let count = 0;
  const lines = [path.basename(root) + '/'];
  const ignore = getIgnore(root);

  function walk(dir, prefix, depth) {
    if (depth > maxDepth || count >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Dossiers d'abord, puis fichiers, tri alpha
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
      if (count >= maxEntries) { lines.push(prefix + '└── ...'); break; }
      const e    = entries[i];
      const last = i === entries.length - 1;
      const ext  = path.extname(e.name).toLowerCase();

      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        const relDir = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
        if (ignore.isIgnored(relDir + '/')) continue;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}/`);
        count++;
        walk(path.join(dir, e.name), prefix + (last ? '    ' : '│   '), depth + 1);
      } else {
        if (IGNORE_EXTENSIONS.has(ext)) continue;
        const relFile = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
        if (ignore.isIgnored(relFile)) continue;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}`);
        count++;
      }
    }
  }

  walk(root, '', 1);
  return lines.join('\n');
}

module.exports = { buildTree };
