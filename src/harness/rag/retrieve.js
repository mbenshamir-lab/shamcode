'use strict';

/**
 * Récupère les chunks les plus pertinents pour une requête donnée.
 * Phase 104 : expansion via le graphe de dépendances (ADR-025).
 *
 * Après le top-K cosinus, pour chaque fichier retrouvé on ajoute le meilleur
 * chunk de ses imports directs (si présents dans le store). Ces chunks sont
 * marqués dep_expanded:true et reçoivent un score réduit (DEP_DISCOUNT) pour
 * ne pas détrôner les résultats directs. Plafonnés à DEP_EXTRA chunks en tout.
 *
 * Pourquoi ici et pas dans builder.js : la récupération reste un contrat unitaire
 * (requête → chunks), et les tests peuvent valider l'expansion sans simuler builder.
 */

const { encode } = require('./embedder');

const DEP_DISCOUNT   = 0.6;   // score des chunks dépendances = score_direct × 0.6
const DEP_EXTRA_MAX  = 3;     // au plus 3 chunks supplémentaires via le graphe

/**
 * Renvoie le chunk d'un fichier donné le plus similaire au vecteur de requête.
 * @param {object}   store
 * @param {string}   filePath   chemin relatif projet
 * @param {number[]} queryVec
 * @returns {object|null}
 */
function _bestChunkForFile(store, filePath, queryVec) {
  const candidates = store.all().filter(c => c.path === filePath && c.vector);
  if (candidates.length === 0) return null;
  // Produit scalaire simple : les vecteurs sont normalisés L2, équivalent au cosinus
  let best = null, bestScore = -1;
  for (const c of candidates) {
    let dot = 0;
    for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * c.vector[i];
    if (dot > bestScore) { bestScore = dot; best = c; }
  }
  return best ? { ...best, score: bestScore } : null;
}

/**
 * @param {object}   store        - Instance createStore()
 * @param {string}   task         - La tâche (requête)
 * @param {{ topK?: number, projectRoot?: string }} opts
 * @returns {{ path, startLine, endLine, content, score, dep_expanded? }[]}
 */
async function retrieveRelevant(store, task, { topK = 5, projectRoot = null } = {}) {
  const queryVec = encode(task);
  // Un vecteur nul = requête sans terme significatif
  if (queryVec.every(v => v === 0)) return [];

  const direct = store.search(queryVec, topK);

  if (!projectRoot || direct.length === 0) {
    return direct.map(({ path, startLine, endLine, content, score }) => ({
      path, startLine, endLine, content, score,
    }));
  }

  // ── Expansion via graphe de dépendances ──────────────────────────────────────
  const seenPaths = new Set(direct.map(c => c.path));
  const extra     = [];

  try {
    const { buildDepGraph } = require('../context/depgraph');
    const { deps } = buildDepGraph(projectRoot);

    outer: for (const chunk of direct) {
      for (const depPath of (deps[chunk.path] || [])) {
        if (extra.length >= DEP_EXTRA_MAX) break outer;
        if (seenPaths.has(depPath)) continue;
        const best = _bestChunkForFile(store, depPath, queryVec);
        if (best) {
          seenPaths.add(depPath);
          extra.push({ ...best, score: best.score * DEP_DISCOUNT, dep_expanded: true });
        }
      }
    }
  } catch { /* graphe non disponible — dégradation silencieuse */ }

  return [...direct, ...extra].map(({ path, startLine, endLine, content, score, dep_expanded }) => ({
    path, startLine, endLine, content, score,
    ...(dep_expanded ? { dep_expanded: true } : {}),
  }));
}

module.exports = { retrieveRelevant };
