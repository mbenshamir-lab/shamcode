'use strict';

/**
 * Budget de contexte (en caractères) selon le moteur qui va consommer le prompt.
 *
 * Pourquoi : le budget était une constante par famille de moteur (2 000 pour WebLLM,
 * 12 000 sinon). Un Qwen2.5-Coder-3B et un Qwen2.5-Coder-14B n'ont pas la même
 * tolérance au contexte, et le moteur CPU (GGUF) n'était pas reconnu comme local du
 * tout. Résultat : soit un contexte vide, soit un contexte calibré pour un autre modèle.
 *
 * Les valeurs restent volontairement basses pour le local : le prompt système pèse déjà
 * ~22 000 caractères, et l'attention d'un petit modèle se dilue vite.
 */

const { DEFAULT_BUDGET } = require('./builder');

const LOCAL_ENGINES = new Set(['webllm', 'cpu']);

// 1B / 1.5B / 3B → contexte court ; au-delà (7B, 14B, inconnu) → contexte moyen
const SMALL_MODEL = /(^|[^0-9])(?:1b|1\.5b|3b)(?![0-9])/i;

const SMALL_BUDGET  = 4000;
const MEDIUM_BUDGET = 8000;

/**
 * @param {string} model nom du modèle (ex. « Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC »)
 * @returns {boolean}
 */
function isSmallModel(model) {
  return SMALL_MODEL.test(String(model || ''));
}

/**
 * @param {string} engine nom du moteur (webllm, cpu, gemini, claude, openai-compat…)
 * @returns {boolean}
 */
function isLocalEngine(engine) {
  return LOCAL_ENGINES.has(String(engine || '').toLowerCase());
}

/**
 * @param {{ engine?: string, model?: string, maxContextChars?: number }} opts
 * @returns {number} budget en caractères
 */
function resolveContextBudget({ engine, model, maxContextChars } = {}) {
  if (isLocalEngine(engine)) {
    return isSmallModel(model) ? SMALL_BUDGET : MEDIUM_BUDGET;
  }
  return Number(maxContextChars) || DEFAULT_BUDGET;
}

module.exports = { resolveContextBudget, isLocalEngine, isSmallModel, SMALL_BUDGET, MEDIUM_BUDGET };
