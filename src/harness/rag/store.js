/**
 * Stockage JSON des chunks RAG (MVP).
 * Persisté dans %APPDATA%/code-harness/rag-<hash>.json.
 * v2 : SQLite via better-sqlite3.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

function getRagDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'code-harness', 'rag');
}

/**
 * Crée un store JSON simple.
 * @param {string} storeId  - Identifiant unique (ex: hash du projectRoot)
 */
function createStore(storeId) {
  const dir      = getRagDir();
  const filePath = path.join(dir, `${storeId}.json`);

  // Charge depuis le disque ou initialise un store vide
  let data = { chunks: {} };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    data = { chunks: {} };
  }

  function save() {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); } catch { /* ignoré */ }
  }

  return {
    /**
     * Insère ou met à jour un chunk (sans persistance immédiate).
     * Appeler flush() après avoir terminé toutes les insertions.
     * @param {{ id, path, startLine, endLine, content, hash, vector }} entry
     */
    upsert(entry) {
      data.chunks[entry.id] = entry;
      // Pas de save() ici — flush() appelé une seule fois après indexation
    },

    /**
     * Persiste le store sur disque.
     * À appeler explicitement après une séquence d'upsert().
     */
    flush() {
      save();
    },

    /**
     * Retourne tous les chunks.
     * @returns {object[]}
     */
    all() {
      return Object.values(data.chunks);
    },

    /**
     * Vérifie si un fichier est inchangé (hash identique).
     * @param {string} filePath
     * @param {string} hash
     */
    isUnchanged(filePath, hash) {
      return Object.values(data.chunks).some(c => c.path === filePath && c.hash === hash);
    },

    /**
     * Recherche les top-k chunks les plus proches d'un vecteur de requête.
     * Similarité cosinus.
     * @param {number[]} queryVector
     * @param {number}   topK
     * @returns {object[]}
     */
    search(queryVector, topK = 5) {
      const chunks = Object.values(data.chunks).filter(c => c.vector);
      if (chunks.length === 0) return [];

      // IDF calculé sur le corpus : un terme présent dans presque tous les chunks
      // (ou un seau saturé par collisions) pèse moins qu'un terme rare. Sans cette
      // pondération, un court document contenant les mots de la question devance le
      // fichier qui contient la réponse.
      const df = new Map();
      for (const c of chunks) {
        for (let i = 0; i < c.vector.length; i++) {
          if (c.vector[i] !== 0) df.set(i, (df.get(i) || 0) + 1);
        }
      }
      const n = chunks.length;
      const weights = new Float64Array(queryVector.length);
      for (let i = 0; i < weights.length; i++) {
        weights[i] = Math.log(1 + n / (df.get(i) || 1));
      }

      const scored = chunks.map(c => ({
        ...c,
        score: cosineSim(queryVector, c.vector, weights),
      }));

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}

/**
 * Similarité cosinus, avec pondération optionnelle par dimension (IDF).
 * @param {number[]} a
 * @param {number[]} b
 * @param {Float64Array|number[]} [weights] poids par dimension
 */
function cosineSim(a, b, weights = null) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    const w  = weights ? weights[i] : 1;
    const av = a[i] * w;
    const bv = b[i] * w;
    dot   += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = { createStore };
