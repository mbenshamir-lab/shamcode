/**
 * Assemble le contexte injecté dans le prompt système de l'agent.
 * Combine : arborescence, chunks RAG, symboles du fichier cible.
 */

const path = require('path');
const { buildTree }     = require('./tree');
const { symbolSummary } = require('./symbols');
const { buildCodeMap }  = require('./codemap');
const { trimToBudget }  = require('./trimmer');
const { MAX_CONTEXT_CHARS: DEFAULT_BUDGET } = require('../../shared/constants');

const RAG_CANDIDATES      = 80; // de quoi remplir le budget même avec de très courts extraits
const RAG_TOP_DIRECT      = 5;  // meilleurs extraits, servis avant ceux du graphe de dépendances
const MAX_CHUNKS_PER_FILE = 2;  // au-delà, un même fichier évince les autres pistes

/**
 * Choisit les extraits jusqu'à remplir le budget. Un nombre fixe d'extraits laissait le
 * budget à moitié vide depuis que le découpage sémantique produit des chunks courts.
 * On vise le budget total : c'est le trimmer qui arbitre entre sections, coupe l'excédent
 * et le signale au modèle.
 *
 * @param {{ path, content, score, dep_expanded? }[]} chunks  classés par pertinence
 * @param {number} maxChars
 * @returns {object[]}
 */
function _selectChunks(chunks, maxChars) {
  const direct = chunks.filter(c => c.score > 0 && !c.dep_expanded);
  const deps   = chunks.filter(c => c.dep_expanded);
  const ranked = [...direct.slice(0, RAG_TOP_DIRECT), ...deps, ...direct.slice(RAG_TOP_DIRECT)];

  const perFile = new Map();
  const selected = [];
  let used = 0;
  const take = (chunk) => {
    perFile.set(chunk.path, (perFile.get(chunk.path) || 0) + 1);
    selected.push(chunk);
    used += chunk.content.length;
  };

  for (const chunk of ranked) {
    if (used >= maxChars) break;
    if ((perFile.get(chunk.path) || 0) < MAX_CHUNKS_PER_FILE) take(chunk);
  }
  // Budget encore libre (petit projet) : la diversité n'a plus rien à protéger
  for (const chunk of ranked) {
    if (used >= maxChars) break;
    if (!selected.includes(chunk)) take(chunk);
  }
  return selected;
}

/**
 * Construit le contexte à injecter dans le prompt.
 *
 * @param {{
 *   task:        string,
 *   projectRoot: string,
 *   ragStore?:   object,       // rag/store instance (optionnel en MVP)
 *   targetFile?: string,       // chemin relatif du fichier principal de la tâche
 *   maxChars?:   number,
 * }} opts
 * @returns {string}  Bloc de contexte prêt à être inséré dans le prompt
 */
async function buildContext({ task, projectRoot, ragStore, targetFile, maxChars = DEFAULT_BUDGET }) {
  const parts = [];

  // 1. Arborescence du projet
  const tree = buildTree(projectRoot, { maxDepth: 4, maxEntries: 150 });
  const treeLines = tree.split('\n').filter(l => l.trim()).length;
  // Si le projet est vide (seulement la ligne racine), le signaler explicitement
  // pour éviter que le LLM invente du contenu.
  const treeNote = treeLines <= 1
    ? `## Arborescence du projet\n\`\`\`\n${tree}\n\`\`\`\n\n⚠️ PROJET VIDE : Aucun fichier présent sur le disque. Ne pas inventer de fichiers ou de stack technique.`
    : `## Arborescence du projet\n\`\`\`\n${tree}\n\`\`\``;
  parts.push({ type: 'tree', content: treeNote });

  try {
    const map = buildCodeMap(projectRoot);
    if (map) parts.push({ type: 'map', content: map });
  } catch { /* carte non disponible — ignorée */ }

  // 2. Symboles + graphe de dépendances du fichier cible (si spécifié)
  if (targetFile) {
    const absTarget = path.isAbsolute(targetFile)
      ? targetFile
      : path.join(projectRoot, targetFile);
    const symLine = symbolSummary(absTarget);
    const norm    = path.relative(projectRoot, absTarget).replace(/\\/g, '/');

    const lines = [];
    if (symLine) lines.push(symLine);

    try {
      const { queryFile } = require('./depgraph');
      const { imports, dependents } = queryFile(projectRoot, norm);
      if (imports.length) {
        const shown = imports.slice(0, 8);
        lines.push(`Importe : ${shown.join(', ')}${imports.length > 8 ? ` (+${imports.length - 8})` : ''}`);
      }
      if (dependents.length) {
        const shown = dependents.slice(0, 8);
        lines.push(`Importé par : ${shown.join(', ')}${dependents.length > 8 ? ` (+${dependents.length - 8})` : ''}`);
      }
    } catch { /* graphe non disponible — ignoré */ }

    if (lines.length) {
      parts.push({ type: 'symbols', content: `## Fichier cible : ${norm}\n${lines.join('\n')}` });
    }
  }

  // 3. Chunks RAG (si le store est disponible)
  if (ragStore) {
    try {
      const { retrieveRelevant } = require('../rag/retrieve');
      const chunks = _selectChunks(
        await retrieveRelevant(ragStore, task, { topK: RAG_CANDIDATES, projectRoot }),
        maxChars,
      );
      if (chunks.length > 0) {
        const ragText = chunks.map(c =>
          `### ${c.path} (lignes ${c.startLine}-${c.endLine})\n\`\`\`\n${c.content}\n\`\`\``,
        ).join('\n\n');
        parts.push({ type: 'rag', content: `## Extraits pertinents\n${ragText}` });
      }
    } catch {
      // RAG non disponible — ignoré silencieusement
    }
  }

  // 4. Notes persistantes du projet (mémoire inter-sessions)
  try {
    const { getRelevantNotes, notesToContextBlock } = require('../memory/project-notes');
    const notes = getRelevantNotes(projectRoot, task, 5);
    if (notes.length > 0) {
      parts.push({ type: 'notes', content: notesToContextBlock(notes) });
    }
  } catch { /* non disponible — ignoré silencieusement */ }

  return trimToBudget(parts, maxChars);
}

module.exports = { buildContext, DEFAULT_BUDGET };
