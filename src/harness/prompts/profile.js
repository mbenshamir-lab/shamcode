'use strict';

/**
 * Profils de prompt selon le moteur (ADR-024).
 *
 * Un modèle 1,5B–3B ne tient pas 11 règles + 4 protocoles + un catalogue d'outils :
 * l'adhérence se dégrade bien avant la fenêtre de contexte. Le profil `minimal` retire
 * les sections qui supposent un modèle capable de suivre plusieurs consignes à la fois
 * (standards de qualité, directives de configuration, note_user, exemples de résumé)
 * et garde ce qui est indispensable : format JSON, plan conditionnel, relecture,
 * preuves de finish.
 *
 * Le profil par défaut est `standard` — le prompt reste identique à ce qu'il était.
 */

const { isLocalEngine, isSmallModel } = require('../context/budget');

/**
 * @param {{ engine?: string, model?: string, explicit?: string }} opts
 * @returns {'minimal'|'standard'}
 */
function resolvePromptProfile({ engine, model, explicit } = {}) {
  if (explicit === 'minimal' || explicit === 'standard') return explicit;
  if (!isLocalEngine(engine)) return 'standard';
  return isSmallModel(model) ? 'minimal' : 'standard';
}

module.exports = { resolvePromptProfile };
