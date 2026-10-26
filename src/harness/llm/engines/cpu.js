'use strict';
/**
 * CpuEngine — inférence locale via node-llama-cpp (llama.cpp, CPU/GPU natif).
 * Nécessite un fichier GGUF configuré dans config.modelPath.
 * Pas de WebGPU requis, fonctionne entièrement en mode natif Node.js.
 *
 * L'import de node-llama-cpp est ESM-only (top-level await) → on passe
 * par import() dynamique depuis ce module CommonJS.
 * L'argument _importFn permet d'injecter un mock dans les tests.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { LlmEngine } = require('../base');

// Nombre de threads CPU disponibles (laisse 1 libre pour le reste du système)
const CPU_THREADS = Math.max(1, os.cpus().length - 1);

// Taille de contexte : doit couvrir le prompt système (outils + RAG) + conversation
const CTX_SIZE = 8192;

class CpuEngine extends LlmEngine {
  /**
   * @param {{ modelPath?: string }} config
   * @param {Function|null} _importFn  - injectée dans les tests pour mocker node-llama-cpp
   */
  constructor(config, _importFn = null) {
    super();
    this.modelPath = config.modelPath || '';
    this._importFn = _importFn;
    // _ctx contient { llama, model, context, LlamaChatSession }
    // Le contexte KV est créé une seule fois et réutilisé à chaque appel.
    this._ctx = null;
  }

  /** Charge llama + modèle + contexte KV une seule fois, réutilise ensuite. */
  async _ensureLoaded() {
    if (this._ctx) return this._ctx;
    const mod = this._importFn
      ? await this._importFn()
      : await import('node-llama-cpp');
    const { getLlama, LlamaChatSession } = mod;
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: this.modelPath });
    // Allocation du KV cache unique — coûteuse, ne faire qu'une fois.
    const context = await model.createContext({ contextSize: CTX_SIZE, threads: CPU_THREADS });
    this._ctx = { llama, model, context, LlamaChatSession };
    return this._ctx;
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {{ temperature?: number, onToken?: Function, onUsage?: Function }} options
   * @returns {Promise<string>}
   */
  async generate(messages, options = {}) {
    if (!this.modelPath) throw new Error('CPU_NO_MODEL_PATH');

    const { context, LlamaChatSession } = await this._ensureLoaded();
    const sequence = context.getSequence();

    // Séparer le message système des autres
    const systemMsg = messages.find(m => m.role === 'system')?.content;
    const nonSystem = messages.filter(m => m.role !== 'system');

    // Session créée à chaque appel (légère) — réutilise le contexte KV existant.
    const session = new LlamaChatSession({
      contextSequence: sequence,
      ...(systemMsg ? { systemPrompt: systemMsg } : {}),
    });

    // Reconstituer l'historique (tous sauf le dernier message user)
    const lastUserIdx = nonSystem.map(m => m.role).lastIndexOf('user');
    const history = nonSystem.slice(0, lastUserIdx).map(m => ({
      type: m.role === 'user' ? 'user' : 'model',
      ...(m.role === 'user'
        ? { text: m.content }
        : { response: [m.content] }),
    }));
    if (history.length > 0) {
      await session.reloadHistory(history);
    }

    // Générer pour le dernier message user
    const lastUserMsg = nonSystem[lastUserIdx]?.content || '';
    const result = await session.prompt(lastUserMsg, {
      ...(typeof options.onToken === 'function' ? { onTextChunk: options.onToken } : {}),
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
    });

    if (typeof options.onUsage === 'function') {
      options.onUsage({ inputTokens: 0, outputTokens: Math.ceil(result.length / 4) });
    }

    return result;
  }

  async isReady() {
    if (!this.modelPath) {
      return { ready: false, error: 'Chemin du modèle non configuré' };
    }
    if (!fs.existsSync(this.modelPath)) {
      return { ready: false, error: `Fichier modèle introuvable : ${this.modelPath}` };
    }
    return { ready: true, info: `CpuEngine → ${path.basename(this.modelPath)}` };
  }

  async dispose() {
    if (this._ctx?.context) {
      try { await this._ctx.context.dispose?.(); } catch { /* ignore */ }
    }
    if (this._ctx?.model) {
      try { await this._ctx.model.dispose?.(); } catch { /* ignore */ }
    }
    if (this._ctx?.llama) {
      try { await this._ctx.llama.dispose?.(); } catch { /* ignore */ }
    }
    this._ctx = null;
  }
}

module.exports = { CpuEngine };
