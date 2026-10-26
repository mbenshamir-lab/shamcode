'use strict';

// En dessous de ce seuil, la dictée est déjà une consigne courte : la résumer
// ajouterait de la latence sans rien condenser.
const MIN_CHARS_TO_CONDENSE = 40;

const SYSTEM_PROMPT =
  'Tu reçois la transcription brute d\'une dictée vocale (hésitations, répétitions, ' +
  'phrases inachevées possibles). Reformule-la en une consigne claire et concise qui ' +
  'conserve l\'idée principale et les détails utiles (noms de fichiers, valeurs, contraintes). ' +
  'Garde la même langue. N\'ajoute aucune information. ' +
  'Réponds UNIQUEMENT par le texte reformulé, sans guillemets ni commentaire.';

/**
 * Condense une dictée transcrite en une consigne claire via le LLM actif.
 * Toujours un texte exploitable en sortie : si le LLM échoue ou répond vide,
 * on retombe sur la transcription brute plutôt que de perdre la dictée.
 *
 * @param {string} raw — transcription brute
 * @param {(messages: object[], options?: object) => Promise<string>} llmGenerate
 * @returns {Promise<{ text: string, condensed: boolean }>}
 */
async function condenseDictation(raw, llmGenerate) {
  const text = String(raw || '').trim();
  if (!text) return { text: '', condensed: false };
  if (text.length < MIN_CHARS_TO_CONDENSE || typeof llmGenerate !== 'function') {
    return { text, condensed: false };
  }
  try {
    const out = await llmGenerate(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: text },
      ],
      { temperature: 0.2, maxTokens: 400 },
    );
    const cleaned = String(out || '').trim().replace(/^["«]\s*|\s*["»]$/g, '');
    if (!cleaned) return { text, condensed: false };
    return { text: cleaned, condensed: true };
  } catch {
    return { text, condensed: false };
  }
}

module.exports = { condenseDictation, MIN_CHARS_TO_CONDENSE };
