/**
 * Score lexical BM25 calculé sur le contenu des chunks.
 *
 * Complète les vecteurs hachés : dans 256 seaux, des centaines de termes se télescopent et
 * deux chunks sans mot commun peuvent sembler proches. Ici les termes sont comparés
 * exactement ; le coût reste négligeable car le calcul n'a lieu qu'une fois par tâche.
 */

const path = require('path');
const { tokenize } = require('./embedder');

const K1 = 1.2;
const B  = 0.75;

/** Le nom de base compte double : il dit souvent mieux le rôle du fichier que son contenu. */
function _chunkTerms(chunk) {
  const base = path.basename(chunk.path, path.extname(chunk.path));
  return tokenize(`${chunk.path} ${base} ${base} ${chunk.content}`);
}

/**
 * @param {{ path: string, content: string }[]} chunks
 * @param {string[]} terms  termes de la requête
 * @returns {number[]} scores normalisés entre 0 et 1, dans l'ordre de `chunks`
 */
function lexicalScores(chunks, terms) {
  const queryTerms = new Set(terms);
  const docs = chunks.map((chunk) => {
    const counts = new Map();
    const tokens = _chunkTerms(chunk);
    for (const token of tokens) {
      if (queryTerms.has(token)) counts.set(token, (counts.get(token) || 0) + 1);
    }
    return { counts, length: tokens.length };
  });

  const n = docs.length;
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / (n || 1);
  const df = new Map();
  for (const { counts } of docs) {
    for (const term of counts.keys()) df.set(term, (df.get(term) || 0) + 1);
  }

  const scores = docs.map(({ counts, length }) => {
    let score = 0;
    for (const [term, tf] of counts) {
      const idf = Math.log(1 + (n - df.get(term) + 0.5) / (df.get(term) + 0.5));
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * length / (avgLength || 1)));
    }
    return score;
  });

  const max = Math.max(0, ...scores);
  return max > 0 ? scores.map(s => s / max) : scores;
}

module.exports = { lexicalScores };
