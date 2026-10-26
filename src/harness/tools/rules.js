const crypto = require('crypto');

/**
 * Ajoute une règle personnalisée dans la config de l'agent.
 * La règle sera injectée dans chaque prompt système dès la prochaine tâche.
 */
async function addRule(args, config) {
  const text = typeof args?.text === 'string' ? args.text.trim() : '';
  if (!text) return { ok: false, error: 'RÈGLE_TEXTE_MANQUANT' };
  // name : label court (sinon : premiers 40 caractères du texte)
  const name = (typeof args?.name === 'string' && args.name.trim())
    ? args.name.trim()
    : text.slice(0, 40) + (text.length > 40 ? '…' : '');

  const rules = Array.isArray(config.customRules) ? [...config.customRules] : [];
  const rule  = { id: crypto.randomUUID(), name, text, enabled: true };
  rules.push(rule);

  if (typeof config.saveConfig === 'function') {
    await config.saveConfig({ customRules: rules });
  }

  return { ok: true, rule };
}

/**
 * Supprime une règle personnalisée (par son texte exact ou son id).
 */
async function deleteRule(args, config) {
  const { id, text } = args || {};
  if (!id && !text) return { ok: false, error: 'RÈGLE_ID_OU_TEXTE_REQUIS' };

  const rules   = Array.isArray(config.customRules) ? [...config.customRules] : [];
  const updated = id
    ? rules.filter(r => r.id !== id)
    : rules.filter(r => r.text !== text);

  if (updated.length === rules.length) return { ok: false, error: 'RÈGLE_NON_TROUVÉE' };

  if (typeof config.saveConfig === 'function') {
    await config.saveConfig({ customRules: updated });
  }

  return { ok: true, deleted: rules.length - updated.length };
}

/**
 * Installe un skill (module de comportement nommé).
 * Un skill a un nom, une description, et un systemPrompt injecté dans chaque session.
 */
async function installSkill(args, config) {
  const name         = typeof args?.name         === 'string' ? args.name.trim()         : '';
  const description  = typeof args?.description  === 'string' ? args.description.trim()  : '';
  const systemPrompt = typeof args?.system_prompt === 'string' ? args.system_prompt.trim() : '';
  if (!name) return { ok: false, error: 'SKILL_NOM_MANQUANT' };

  const skills = Array.isArray(config.customSkills) ? [...config.customSkills] : [];
  // Empêcher les doublons par nom
  if (skills.some(s => s.name === name)) return { ok: false, error: 'SKILL_DÉJÀ_INSTALLÉ' };

  const skill = { id: crypto.randomUUID(), name, description, systemPrompt, enabled: true };
  skills.push(skill);

  if (typeof config.saveConfig === 'function') {
    await config.saveConfig({ customSkills: skills });
  }

  return { ok: true, skill };
}

/**
 * Désinstalle un skill (par son nom ou son id).
 */
async function removeSkill(args, config) {
  const { id, name } = args || {};
  if (!id && !name) return { ok: false, error: 'SKILL_ID_OU_NOM_REQUIS' };

  const skills  = Array.isArray(config.customSkills) ? [...config.customSkills] : [];
  const updated = id
    ? skills.filter(s => s.id !== id)
    : skills.filter(s => s.name !== name);

  if (updated.length === skills.length) return { ok: false, error: 'SKILL_NON_TROUVÉ' };

  if (typeof config.saveConfig === 'function') {
    await config.saveConfig({ customSkills: updated });
  }

  return { ok: true, deleted: skills.length - updated.length };
}

module.exports = { addRule, deleteRule, installSkill, removeSkill };
