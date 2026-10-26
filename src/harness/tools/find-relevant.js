/**
 * Outil find_relevant_files : suggère les fichiers les plus pertinents pour une tâche donnée.
 * Utilise l'index RAG existant (bag-of-words TF-normalisé) pour scorer les fichiers
 * par similarité cosinus avec la description de la tâche.
 * Retourne une liste ordonnée de chemins relatifs avec leur score.
 */

const crypto = require('crypto');
const { createStore } = require('../rag/store');
const { retrieveRelevant } = require('../rag/retrieve');
const { indexProject } = require('../rag/indexer');

const MAX_FILES = 10;

/**
 * Déduplique les chemins de fichiers et additionne leurs scores.
 * @param {Array<{ path: string, score: number, content: string }>} chunks
 * @returns {Array<{ path: string, score: number }>}
 */
function _aggregateByFile(chunks) {
  const map = new Map();
  for (const chunk of chunks) {
    const p = chunk.path || chunk.filePath;
    if (!p) continue;
    const prev = map.get(p) || { path: p, score: 0, chunks: 0 };
    map.set(p, { path: p, score: prev.score + (chunk.score ?? chunk.similarity ?? 0), chunks: prev.chunks + 1 });
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES)
    .map(({ path: p, score, chunks }) => ({ path: p, score: Math.round(score * 1000) / 1000, chunks }));
}

/**
 * Trouve les fichiers les plus pertinents pour une tâche.
 *
 * @param {{ task: string, top_k?: number }} args
 * @param {string} projectRoot
 * @returns {{ ok, files?: Array<{path, score, chunks}>, error? }}
 */
async function findRelevantFiles({ task, top_k }, projectRoot) {
  if (!task || typeof task !== 'string') return { ok: false, error: 'TASK_MANQUANTE' };
  if (!projectRoot) return { ok: false, error: 'PROJET_NON_DÉFINI' };

  const topK = Math.min(top_k ?? 20, 50); // on récupère plus de chunks pour bien couvrir les fichiers

  try {
    const storeId = crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 12);
    const ragStore = createStore(storeId);

    // S'assurer que le projet est indexé (incrémental — rapide si déjà à jour)
    indexProject(projectRoot, ragStore);
    ragStore.flush();

    const chunks = await retrieveRelevant(ragStore, task, { topK });
    if (!chunks || chunks.length === 0) {
      return { ok: true, files: [], hint: 'Index vide ou aucun fichier correspondant. Lance une nouvelle tâche pour indexer le projet.' };
    }

    const files = _aggregateByFile(chunks);
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

module.exports = { findRelevantFiles };
