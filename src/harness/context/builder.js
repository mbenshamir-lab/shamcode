/**
 * Assemble le contexte injecté dans le prompt système de l'agent.
 * Combine : arborescence, chunks RAG, symboles du fichier cible.
 */

const path = require('path');
const { buildTree }     = require('./tree');
const { symbolSummary } = require('./symbols');
const { trimToBudget }  = require('./trimmer');
const { MAX_CONTEXT_CHARS: DEFAULT_BUDGET } = require('../../shared/constants');

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
      const chunks = await retrieveRelevant(ragStore, task, { topK: 5, projectRoot });
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
