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

module.exports = { LlmEngine };
