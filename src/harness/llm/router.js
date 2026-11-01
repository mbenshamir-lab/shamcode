/**
 * Router LLM — chaîne de fallback entre moteurs.
 *
 * Stratégie : essaie le primaire, puis les fallbacks dans l'ordre.
 * Chaque moteur passe d'abord par isReady() avant generate().
 * Si tous échouent, retourne la dernière erreur.
 *
 * @example
 *   const router = new LlmRouter(['openai-compat', 'gemini', 'claude'], registry, config);
 *   const text = await router.generate(messages);
 */

// Pannes passagères : un quota ou une surcharge se résout en quelques secondes, alors
// qu'une 400 ou une 401 échouera à l'identique et doit passer au moteur suivant.
const TRANSIENT_ERROR = /_HTTP_(429|500|502|503|504|529)\b|fetch failed|ECONNRESET|ETIMEDOUT/;
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_RETRY_AFTER_MS = 30000; // au-delà, mieux vaut basculer que figer la tâche

/** Attente interrompue par le Stop de l'utilisateur. */
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('ANNULÉ')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error('ANNULÉ')); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class LlmRouter {
  /**
   * @param {string[]} chain      - Noms des moteurs dans l'ordre de priorité
   * @param {object}   registry   - { [name]: { factory } }
   * @param {object}   config     - Config complète (model.engines.*)
   * @param {object}   [bridges]  - { webllm: bridge } pour les moteurs qui en ont besoin
   */
  constructor(chain, registry, config, bridges = {}) {
    this.chain     = chain;
    this.registry  = registry;
    this.config    = config;
    this.bridges   = bridges;
    this._instances = {};
    this._sleep     = _sleep;
  }

  /** Génère avec un moteur, en réessayant sur panne passagère. */
  async _generateWithRetry(inst, messages, options) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await inst.generate(messages, options);
      } catch (err) {
        const delay = err.retryAfter ? err.retryAfter * 1000 : RETRY_DELAYS_MS[attempt];
        const retry = attempt < RETRY_DELAYS_MS.length && delay <= MAX_RETRY_AFTER_MS
          && TRANSIENT_ERROR.test(err.message) && !options.signal?.aborted;
        if (!retry) throw err;
        await this._sleep(delay, options.signal);
      }
    }
  }

  /** Obtient (ou crée) l'instance d'un moteur. */
  _getInstance(name) {
    if (this._instances[name]) return this._instances[name];

    const entry = this.registry[name];
    if (!entry || !entry.factory) return null;

    const engineCfg = this.config?.model?.engines?.[name] || {};
    const bridge    = this.bridges[name] || null;
    const inst      = entry.factory(engineCfg, bridge);
    this._instances[name] = inst;
    return inst;
  }

  /**
   * Génère un texte en essayant les moteurs dans l'ordre.
   * @param {object[]} messages
   * @param {object}   [options]
   * @returns {Promise<string>}
   */
  async generate(messages, options = {}) {
    const errors = [];

    for (const name of this.chain) {
      const inst = this._getInstance(name);
      if (!inst) {
        errors.push(`${name}: moteur inconnu ou sans factory`);
        continue;
      }

      try {
        const { ready, error: notReadyErr } = await inst.isReady();
        if (!ready) {
          errors.push(`${name}: ${notReadyErr || 'non prêt'}`);
          continue;
        }
        // Injecter le nom du moteur dans le callback onUsage
        const wrappedOpts = options.onUsage
          ? { ...options, onUsage: (u) => options.onUsage({ ...u, engine: name }) }
          : options;
        return await this._generateWithRetry(inst, messages, wrappedOpts);
      } catch (err) {
        // Stop utilisateur : ce n'est pas une panne, le moteur suivant ne doit pas repartir
        if (options.signal?.aborted || err.name === 'AbortError' || err.message === 'ANNULÉ') throw err;
        errors.push(`${name}: ${err.message}`);
      }
    }

    throw new Error(`Tous les moteurs ont échoué :\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  /** Vérifie les statuts de tous les moteurs de la chaîne. */
  async statusAll() {
    const out = {};
    for (const name of this.chain) {
      const inst = this._getInstance(name);
      if (!inst) { out[name] = { ready: false, error: 'non disponible' }; continue; }
      try { out[name] = await inst.isReady(); }
      catch (e) { out[name] = { ready: false, error: e.message }; }
    }
    return out;
  }

  async disposeAll() {
    for (const inst of Object.values(this._instances)) {
      try { await inst.dispose(); } catch { /* ignoré */ }
    }
    this._instances = {};
  }
}

module.exports = { LlmRouter };
