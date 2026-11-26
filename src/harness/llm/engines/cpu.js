'use strict';
/**
 * CpuEngine — inférence locale via node-llama-cpp (llama.cpp, CPU/GPU natif).
 * Nécessite un fichier GGUF configuré dans config.modelPath.
 * Pas de WebGPU requis, fonctionne entièrement en mode natif Node.js.
 *
 * L'import de node-llama-cpp est ESM-only (top-level await) → on passe
 * par import() dynamique depuis ce module CommonJS.
 * L'argument _importFn permet d'injecter un mock dans les tests.
 *
 * Performance (ADR-033) : une session de chat PERSISTANTE réutilise le cache KV
 * entre les étapes de l'agent. Sans elle, chaque étape refaisait le préfill complet
 * du prompt (system + historique), ce qui domine le temps sur un PC moyen.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const logger = require('../../logger');
const { LlmEngine } = require('../base');

// Nombre de threads par défaut : laisse un cœur au système. `config.cpuThreads`
// permet de forcer la valeur (cœurs physiques) sur les machines hyperthreadées.
const DEFAULT_THREADS = Math.max(1, Math.min(8, os.cpus().length - 1));

class CpuEngine extends LlmEngine {
  /**
   * @param {{ modelPath?: string, cpuThreads?: number, cpuContextSize?: number, cpuBatchSize?: number, cpuFlashAttention?: boolean, cpuGpuLayers?: string|number, cpuKvType?: string }} config
   * @param {Function|null} _importFn  - injectée dans les tests pour mocker node-llama-cpp
   */
  constructor(config, _importFn = null) {
    super();
    this.modelPath = config.modelPath || '';
    this._importFn = _importFn;

    this.contextSize    = Number(config.cpuContextSize) || 4096;
    this.threads        = Number(config.cpuThreads) || DEFAULT_THREADS;
    this.batchSize      = Number(config.cpuBatchSize) || 256;
    this.flashAttention = config.cpuFlashAttention === false ? false : 'auto';
    this.gpuLayers      = config.cpuGpuLayers ?? 'auto';
    this.kvType         = config.cpuKvType || 'Q8_0';

    // _ctx contient { llama, model, context, LlamaChatSession }
    // La session et l'historique sont conservés pour réutiliser le cache KV.
    this._ctx = null;
    this._session = null;
    this._history = null;       // messages envoyés + réponse assistant
    this._systemPrompt = null;
    this._sequence = null;      // unique séquence du contexte, partagée par les sessions
    this._queue = Promise.resolve();
  }

  /** Charge llama + modèle + contexte KV une seule fois, réutilise ensuite. */
  async _ensureLoaded() {
    if (this._ctx) return this._ctx;
    const mod = this._importFn
      ? await this._importFn()
      : await import('node-llama-cpp');
    const { getLlama, LlamaChatSession } = mod;
    // Journalisation llama.cpp vers notre logger fichier, jamais vers console :
    // dans une app Electron détachée, console.warn peut lever EPIPE et tuer le main.
    const llama = await getLlama({
      gpu: 'auto',
      logLevel: 'error',
      logger: (_level, message) => {
        try { logger.info('llama', String(message).slice(0, 500)); } catch { /* ignore */ }
      },
    });
    const model = await llama.loadModel({
      modelPath: this.modelPath,
      gpuLayers: this.gpuLayers,
      useMmap: true,
      // KV cache quantifié : moins de RAM, souvent plus rapide sur CPU.
      ...(this.kvType ? {
        experimentalDefaultContextKvCacheKeyType: this.kvType,
        experimentalDefaultContextKvCacheValueType: this.kvType,
      } : {}),
    });
    // Allocation du KV cache unique — coûteuse, ne faire qu'une fois.
    const context = await model.createContext({
      contextSize: this.contextSize,
      threads: this.threads,
      batchSize: this.batchSize,
      flashAttention: this.flashAttention,
    });
    this._ctx = { llama, model, context, LlamaChatSession };
    return this._ctx;
  }

  /** (Re)crée la session de chat — utilisé au premier appel ou si l'historique diverge. */
  _resetSession(systemPrompt) {
    if (this._session?.dispose) {
      try { this._session.dispose(); } catch { /* déjà libérée */ }
    }
    const { context, LlamaChatSession } = this._ctx;
    // Le contexte n'a qu'une séquence, libérée de façon asynchrone : on la réutilise
    this._sequence ??= context.getSequence();
    this._session = new LlamaChatSession({
      contextSequence: this._sequence,
      ...(systemPrompt ? { systemPrompt } : {}),
      autoDisposeSequence: false,
    });
    this._systemPrompt = systemPrompt || '';
    this._history = null;
  }

  static _sameMessage(a, b) {
    return !!a && !!b && a.role === b.role && String(a.content ?? '') === String(b.content ?? '');
  }

  /** Vrai si `history` est un préfixe exact de `messages`. */
  static _isPrefix(history, messages) {
    if (!Array.isArray(history) || history.length === 0 || history.length > messages.length) return false;
    for (let i = 0; i < history.length; i++) {
      if (!CpuEngine._sameMessage(history[i], messages[i])) return false;
    }
    return true;
  }

  static _chars(messages) {
    return messages.reduce((n, m) => n + String(m?.content ?? '').length, 0);
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {{ temperature?: number, onToken?: Function, onUsage?: Function, maxTokens?: number }} options
   * @returns {Promise<string>}
   */
  generate(messages, options = {}) {
    // Une seule session : des sous-agents parallèles doivent passer l'un après l'autre
    const run = this._queue.then(() => this._generate(messages, options));
    this._queue = run.catch(() => {});
    return run;
  }

  async _generate(messages, options) {
    if (!this.modelPath) throw new Error('CPU_NO_MODEL_PATH');
    if (options.signal?.aborted) throw new Error('ANNULÉ');

    const ctx = await this._ensureLoaded();
    if (!ctx) throw new Error('CPU_CONTEXTE_INDISPONIBLE');

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const nonSystem = messages.filter(m => m.role !== 'system');
    const lastUserIdx = nonSystem.map(m => m.role).lastIndexOf('user');
    const lastUserMsg = nonSystem[lastUserIdx]?.content || '';

    const promptOpts = {
      ...(typeof options.onToken === 'function' ? { onTextChunk: options.onToken } : {}),
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...(Number.isFinite(options.maxTokens) ? { maxTokens: options.maxTokens } : {}),
      ...(options.signal ? { signal: options.signal } : {}), // Stop de l'utilisateur
    };

    // Réutiliser la session seulement si le prompt système est identique, que
    // l'historique connu est un préfixe exact, et que le contexte reste raisonnable.
    const canExtend = !!this._session
      && this._systemPrompt === systemMsg
      && CpuEngine._isPrefix(this._history, messages)
      && CpuEngine._chars(this._history) < this.contextSize * 3
      && messages.slice(this._history.length).every(m => m.role === 'user');

    let result;
    try {
      if (canExtend) {
        const delta = messages.slice(this._history.length);
        for (const msg of delta) {
          result = await this._session.prompt(String(msg.content ?? ''), promptOpts);
        }
      } else {
        this._resetSession(systemMsg);
        const history = nonSystem.slice(0, lastUserIdx).map(m => ({
          type: m.role === 'user' ? 'user' : 'model',
          ...(m.role === 'user' ? { text: m.content } : { response: [m.content] }),
        }));
        if (history.length > 0) {
          // La session neuve porte déjà le message système : l'historique s'ajoute après
          this._session.setChatHistory([...this._session.getChatHistory(), ...history]);
        }
        result = await this._session.prompt(lastUserMsg, promptOpts);
      }
    } catch (err) {
      this._history = null; // état de la session inconnu : ne pas la prolonger
      throw err;
    }

    if (typeof result !== 'string') result = String(result ?? '');
    this._history = [...messages, { role: 'assistant', content: result }];

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
    if (this._session?.dispose) {
      try { this._session.dispose(); } catch { /* ignore */ }
    }
    this._session = null;
    this._history = null;
    this._sequence = null;      // libérée avec le contexte
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
