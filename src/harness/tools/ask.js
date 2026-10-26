// Outil ask_user — pause l'agent et attend une réponse de l'utilisateur.
// À utiliser AVANT d'écrire du code si la tâche est ambiguë ou incomplète.

/**
 * @param {{ question: string, context?: string, suggestions?: string[] }} args
 * @param {object}   config
 * @param {Function} onEvent
 */
async function askUser({ question, context = '', suggestions = [] }, config, onEvent) {
  if (!question) return { ok: false, error: 'ASK_SANS_QUESTION' };

  // Mode test / sans UI : réponse simulée pour ne pas bloquer les tests
  if (!config.requestUserInput) {
    onEvent({ type: 'ask_user', question, context, suggestions });
    return { ok: true, answer: suggestions[0] ?? '(pas de réponse interactive — mode test)' };
  }

  const answer = await config.requestUserInput({ question, context, suggestions });
  // false = approbation annulée (agent:cancel déclenché pendant l'attente)
  if (answer === false) return { ok: false, error: 'ANNULÉ' };
  return { ok: true, answer };
}

module.exports = { askUser };
