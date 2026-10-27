/**
 * Embedder MVP : bag-of-words à dimension fixe (hashing trick).
 *
 * Pourquoi une dimension fixe : l'implémentation précédente utilisait un vocabulaire
 * global dont la taille grandissait pendant l'indexation. Les vecteurs de deux chunks
 * n'avaient donc pas la même longueur, et `cosineSim` renvoie 0 dès que les longueurs
 * diffèrent — le RAG ne classait plus rien (mesuré : similarités toutes nulles, top-5
 * = premiers chunks parcourus). Haver les termes dans un espace de taille constante
 * rend les vecteurs comparables entre eux, entre tâches et entre sessions.
 *
 * L'augmentation du format du vecteur est volontairement signalée par EMBEDDER_VERSION :
 * les stores persistés avec l'ancien encodage doivent être réindexés, pas relus.
 */

// Une version par changement de format — entre dans l'identifiant du store RAG.
const EMBEDDER_VERSION = 3;

// Compromis taille/qualité : 256 seaux limitent les collisions de hachage tout en
// gardant un vecteur compact dans le JSON du store (les chunks se comptent en milliers).
const VECTOR_DIM = 256;

// Mots vides français + anglais à ignorer.
// Les mots interrogatifs et de liaison français sont indispensables ici : dans une
// question (« où est calculé le total ? »), ils pesaient autant que le terme porteur
// de sens et faisaient gagner un court README contre le fichier de code.
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en', 'à', 'au',
  'que', 'qui', 'quoi', 'dont', 'où', 'quand', 'comment', 'pourquoi', 'quel', 'quelle',
  'quels', 'quelles', 'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'pas',
  'plus', 'moins', 'mais', 'ou', 'si', 'son', 'sa', 'ses', 'leur', 'leurs', 'elle',
  'elles', 'il', 'ils', 'nous', 'vous', 'je', 'tu', 'on', 'ce', 'cet', 'cette', 'ces',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'fait', 'faire', 'être', 'avoir', 'est',
  'sont', 'était', 'étaient', 'ont', 'déjà', 'encore', 'aussi', 'très', 'tout', 'tous',
  'toute', 'toutes', 'même', 'bien', 'peu', 'beaucoup', 'car', 'donc', 'alors', 'comme',
  'cela', 'ceci', 'celui', 'celle', 'ne', 'non', 'oui', 'moi', 'toi', 'lui', 'eux',
  'notre', 'votre', 'nos', 'vos', 'chaque', 'autre', 'autres', 'après', 'avant',
  'depuis', 'pendant', 'entre', 'vers', 'chez', 'selon', 'malgré',
  'the', 'a', 'an', 'is', 'in', 'of', 'to', 'and', 'for', 'with', 'this',
  'that', 'it', 'or', 'not', 'be', 'by', 'on', 'at', 'as', 'are', 'was',
  'from', 'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'null', 'true',
  'false', 'undefined', 'import', 'export', 'require', 'module',
]);

/**
 * Tokenise un texte en mots significatifs.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_À-ɏ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Hash FNV-1a 32 bits — déterministe, réparti, sans dépendance.
 * @param {string} str
 * @returns {number}
 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Encode un texte en vecteur dense de longueur fixe (TF sublinéaire, normalisé L2).
 * @param {string} text
 * @returns {number[]} vecteur de VECTOR_DIM valeurs
 */
function encode(text) {
  const vec = new Array(VECTOR_DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    vec[fnv1a(token) % VECTOR_DIM] += 1;
  }

  // TF sublinéaire : un terme répété 10 fois n'est pas 10 fois plus important
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    if (vec[i] > 0) {
      vec[i] = 1 + Math.log(vec[i]);
      norm += vec[i] * vec[i];
    }
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;

  // Arrondi : allège nettement le JSON du store sans changer le classement
  for (let i = 0; i < VECTOR_DIM; i++) {
    if (vec[i] !== 0) vec[i] = Math.round((vec[i] / norm) * 1e4) / 1e4;
  }
  return vec;
}

module.exports = { encode, tokenize, EMBEDDER_VERSION, VECTOR_DIM };
