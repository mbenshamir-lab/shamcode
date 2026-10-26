/**
 * WebLlmEngine — moteur local via IPC vers le renderer caché.
 * Aucun réseau, confidentialité totale.
 *
 * ipcBridge est injecté depuis le main process :
 *   { sendRequest(messages, options) → Promise<string> }
 */

const { LlmEngine } = require('../base');

class WebLlmEngine extends LlmEngine {
  /**
   * @param {object}   config
   * @param {object}   ipcBridge   - { sendRequest, isReady }
   */
  constructor(config, ipcBridge = null) {
    super();
    this.model     = config.model || 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC';
    this.ipcBridge = ipcBridge;
  }

  async generate(messages, options = {}) {
    if (!this.ipcBridge) throw new Error('WEBLLM_NO_BRIDGE');
    return this.ipcBridge.sendRequest(messages, options);
  }

  async isReady() {
    if (!this.ipcBridge) return { ready: false, error: 'WebLLM bridge non initialisé' };
    try {
      const ready = await this.ipcBridge.isReady();
      if (ready) return { ready: true, info: `WebLlmEngine → ${this.model}` };
      // Aucune erreur remontée = le renderer caché n'a pas encore répondu
      // (téléchargement du modèle en cours) : le dire, au lieu de « Modèle non chargé ».
      const reason = this.ipcBridge.getError?.() || 'modèle local en cours de chargement (WebGPU requis)';
      return { ready: false, error: reason };
    } catch (e) {
      return { ready: false, error: e.message };
    }
  }
}

module.exports = { WebLlmEngine };
