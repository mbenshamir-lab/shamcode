'use strict';

/**
 * Politique de prompt et de contexte selon le moteur qui va générer.
 *
 * Principe : le prompt complet reste la référence pour les modèles cloud. Un modèle
 * local (WebLLM ou GGUF) reçoit un prompt plus court, un RAG plus petit, un historique
 * plus court et une limite de génération plus basse — jamais l'inverse : le cloud
 * n'est pas dégradé pour compenser un petit modèle.
 *
 * Le choix est fait par l'agent au démarrage, à partir de `config.model.primary` et
 * du modèle configuré pour ce moteur. `config.promptProfile` reste une échappatoire.
 */

const { isLocalEngine, isSmallModel } = require('../context/budget');

const CLOUD = Object.freeze({
  id:           'cloud',
  profile:      'standard',
  ragTopK:      5,
  agentsMaxChars: 4000,
  historyKeepPairs: 10,
  maxTokens:    4096,
  compactTools: false,
});

const LOCAL = Object.freeze({
  id:           'local',
  profile:      'minimal',
  ragTopK:      4,
  agentsMaxChars: 3000,
  historyKeepPairs: 8,
  maxTokens:    2048,
  compactTools: true,
});

const LOCAL_SMALL = Object.freeze({
  id:           'local-small',
  profile:      'minimal',
  ragTopK:      3,
  agentsMaxChars: 2000,
  historyKeepPairs: 6,
  maxTokens:    1024,
  compactTools: true,
});

/**
 * @param {{ engine?: string, model?: string, explicit?: string }} opts
 * @returns {{ id: string, profile: 'minimal'|'standard', ragTopK: number, agentsMaxChars: number, historyKeepPairs: number, maxTokens: number, compactTools: boolean }}
 */
function resolveModelPolicy({ engine, model, explicit } = {}) {
  const forced = explicit === 'minimal' || explicit === 'standard' ? explicit : null;

  if (!isLocalEngine(engine)) {
    return { ...CLOUD, profile: forced || 'standard' };
  }
  return {
    ...(isSmallModel(model) ? LOCAL_SMALL : LOCAL),
    ...(forced ? { profile: forced } : {}),
  };
}

module.exports = { resolveModelPolicy, CLOUD, LOCAL, LOCAL_SMALL };
