/**
 * Indexe un projet : parcourt les fichiers source, découpe en chunks,
 * calcule les embeddings, persiste dans le store.
 * Incrémental : ignore les fichiers dont le hash SHA1 n'a pas changé.
 *
 * Phase 106 : chunking sémantique par frontières de déclarations de haut niveau.
 * Pour les fichiers JS/TS/Python, chaque chunk correspond à une fonction ou une classe
 * complète plutôt qu'un bloc de 60 lignes arbitraire. Fallback sur le découpage fixe
 * si le fichier ne contient pas de déclarations reconnues.
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { encode } = require('./embedder');
const { getIgnore } = require('../safety/harnessignore');

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.toml', '.env',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '__pycache__',
  '.next', 'out', 'coverage', '.cache',
]);

// Bumper quand l'algorithme de découpage change — force la réindexation des stores existants.
const CHUNKER_VERSION = 1;

const CHUNK_SIZE    = 60;  // lignes max par chunk (sémantique ou fixe)
const CHUNK_OVERLAP = 15;  // chevauchement pour le fallback fixe seulement

// ── Détection de frontières sémantiques ───────────────────────────────────────

// Lignes qui démarrent une déclaration de haut niveau en JS/TS (col 0 ou export).
// Volontairement large : rater une frontière coûte seulement un chunk un peu plus grand.
const JS_BOUNDARY = /^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function[\s*]\s*\w|class\s+\w)|^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\(|\w+\s*=>)|^module\.exports\s*[={]|^exports\.\w+\s*=/;

// Lignes qui démarrent une déclaration en Python (indentation nulle + def/class ou décorateur).
const PY_BOUNDARY = /^(?:async\s+)?def\s+\w|^class\s+\w/;

const BOUNDARY_RE = {
  '.js': JS_BOUNDARY, '.mjs': JS_BOUNDARY, '.cjs': JS_BOUNDARY,
  '.ts': JS_BOUNDARY, '.tsx': JS_BOUNDARY, '.jsx': JS_BOUNDARY,
  '.py': PY_BOUNDARY,
};

/**
 * Retourne les indices (0-based) des lignes qui démarrent une déclaration de haut niveau.
 * @param {string[]} lines
 * @param {string}   ext   extension en minuscules (ex. '.js')
 * @returns {number[]}
 */
function _findBoundaries(lines, ext) {
  const re = BOUNDARY_RE[ext];
  if (!re) return [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) out.push(i);
  }
  return out;
}

/**
 * Découpe un fichier en chunks.
 * Pour les fichiers JS/TS/Python, utilise les frontières de déclarations.
 * Fallback sur un découpage fixe (60 lignes + overlap 15) si aucune frontière détectée.
 *
 * @param {string} filePath  - Chemin relatif (pour les ids)
 * @param {string} content
 * @param {string} hash
 * @returns {{ id, path, startLine, endLine, content, hash, vector }[]}
 */
function chunkFile(filePath, content, hash) {
  const ext    = path.extname(filePath).toLowerCase();
  const lines  = content.split('\n');
  const chunks = [];
  const bounds = _findBoundaries(lines, ext);

  if (bounds.length >= 1) {
    // Segments sémantiques : chaque segment va de bounds[i] à bounds[i+1] (ou fin).
    // Si du contenu précède la première déclaration (imports, licence…), c'est le segment 0.
    const segStarts = bounds[0] > 0 ? [0, ...bounds] : [...bounds];

    for (let s = 0; s < segStarts.length; s++) {
      const segStart = segStarts[s];
      const segEnd   = s + 1 < segStarts.length ? segStarts[s + 1] : lines.length;

      // Sous-découpage si le segment est plus long que CHUNK_SIZE
      for (let i = segStart; i < segEnd;) {
        const end  = Math.min(i + CHUNK_SIZE, segEnd);
        const text = lines.slice(i, end).join('\n');
        chunks.push({
          id:        `${filePath}:${i}`,
          path:      filePath,
          startLine: i + 1,
          endLine:   end,
          content:   text,
          hash,
          vector:    encode(text),
        });
        if (end >= segEnd) break;
        i = end;  // pas d'overlap au sein d'un segment sémantique : les frontières font séparateur naturel
      }
    }
    return chunks;
  }

  // ── Fallback : découpage fixe avec overlap ─────────────────────────────────
  let start = 0;
  while (start < lines.length) {
    const end  = Math.min(start + CHUNK_SIZE, lines.length);
    const text = lines.slice(start, end).join('\n');
    chunks.push({
      id:        `${filePath}:${start}`,
      path:      filePath,
      startLine: start + 1,
      endLine:   end,
      content:   text,
      hash,
      vector:    encode(text),
    });
    if (end >= lines.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Parcourt récursivement un dossier et indexe tous les fichiers source.
 * @param {string}   root    - Chemin absolu de la racine du projet
 * @param {object}   store   - Instance createStore()
 * @param {{ onProgress?: (file: string) => void }} opts
 */
function indexProject(root, store, { onProgress } = {}) {
  let indexed = 0;
  let skipped = 0;
  const ignore = getIgnore(root);

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(fullPath);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;

      let content;
      try { content = fs.readFileSync(fullPath, 'utf8'); }
      catch { continue; }

      const hash    = crypto.createHash('sha1').update(content).digest('hex');
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (ignore.isIgnored(relPath)) { skipped++; continue; }
      if (store.isUnchanged(relPath, hash)) { skipped++; continue; }

      const chunks = chunkFile(relPath, content, hash);
      for (const c of chunks) store.upsert(c);
      indexed++;
      if (onProgress) onProgress(relPath);
    }
  }

  walk(root);
  return { indexed, skipped };
}

module.exports = { indexProject, chunkFile, _findBoundaries, CHUNKER_VERSION };
