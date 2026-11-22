/**
 * Interface commune à tous les moteurs LLM.
 * Chaque moteur doit étendre cette classe.
 */
class LlmEngine {
  /** @returns {Promise<string>} texte généré */
  async generate(_messages, _options) {
    throw new Error('generate() non implémenté');
  }

  /** @returns {Promise<{ready: boolean, info?: string, error?: string}>} */
  async isReady() {
    throw new Error('isReady() non implémenté');
  }

  async dispose() {}
}

/**
 * Erreur d'une réponse HTTP non-OK. retryAfter (secondes) permet au router de respecter
 * le délai demandé par le fournisseur plutôt que de le deviner.
 * @param {string}   prefix  ex. 'CLAUDE'
 * @param {Response} res
 */
async function httpError(prefix, res) {
  const body = await res.text();
  const err  = new Error(`${prefix}_HTTP_${res.status}: ${body.slice(0, 200)}`);
  err.retryAfter = Number(res.headers?.get?.('retry-after')) || 0;
  return err;
}

module.exports = { LlmEngine, httpError };
