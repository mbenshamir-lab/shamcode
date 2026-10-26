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
        return await inst.generate(messages, wrappedOpts);
      } catch (err) {
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
