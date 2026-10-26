/**
 * Scratchpad : zone de notes temporaires de l'agent entre ses étapes.
 * Permet au LLM de "se souvenir" d'un détail sans le répéter dans chaque message.
 * Persisté dans la session (champ scratchpad).
 *
 * Usage dans l'agent :
 *   const pad = createScratchpad();
 *   pad.set('fichier_cible', 'src/utils.js');
 *   pad.append('notes', 'fonction add() à ligne 12');
 *   const block = pad.toContextBlock();  // injecté dans le prompt
 */

/**
 * Crée un scratchpad en mémoire.
 * @returns {{ set, get, append, clear, toContextBlock, toJSON, fromJSON }}
 */
function createScratchpad() {
  const notes = {};

  return {
    /**
     * Stocke une valeur.
     * @param {string} key
     * @param {string} value
     */
    set(key, value) {
      notes[key] = String(value);
    },

    /** @param {string} key */
    get(key) {
      return notes[key] ?? null;
    },

    /**
     * Ajoute du texte à une note existante (ou la crée).
     * @param {string} key
     * @param {string} text
     */
    append(key, text) {
      notes[key] = notes[key] ? `${notes[key]}\n${text}` : text;
    },

    /** @param {string} key */
    delete(key) {
      delete notes[key];
    },

    clearAll() {
      for (const k of Object.keys(notes)) delete notes[k];
    },

    /**
     * Sérialise en bloc de contexte lisible par le LLM.
     * @returns {string}
     */
    toContextBlock() {
      const entries = Object.entries(notes);
      if (entries.length === 0) return '';
      const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
      return `## Notes de l'agent\n${lines}`;
    },

    /** Sérialise pour persistance JSON. */
    toJSON() {
      return { ...notes };
    },

    /** Restaure depuis JSON. */
    fromJSON(data = {}) {
      for (const k of Object.keys(notes)) delete notes[k];
      for (const [k, v] of Object.entries(data)) notes[k] = v;
    },
  };
}

module.exports = { createScratchpad };
