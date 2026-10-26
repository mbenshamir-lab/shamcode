// Outil spawn_agent — délègue une sous-tâche à un agent spécialisé.
// Le sous-agent tourne dans une boucle runAgent isolée avec ses propres outils.
// runAgent est importé en lazy pour éviter la dépendance circulaire (agent → tools/index → spawn → agent).

const { PROFILES } = require('../agents/profiles');
const { createSharedBus } = require('./message-bus');

/**
 * Construit le subConfig et le subOnEvent communs à spawnAgent et spawnParallel.
 * Retourne aussi un collecteur modifiedFiles mis à jour par subOnEvent.
 */
function _buildSubContext(role, task, config, onEvent) {
  const profile = PROFILES[role];

  const busTools = config._sharedBus
    ? [...profile.allowedTools.filter(t => t !== 'finish'), 'post_message', 'read_messages', 'finish']
    : profile.allowedTools;

  const subConfig = {
    ...config,
    _subAgent:           true,
    _subRole:            role,
    _allowedTools:       busTools,
    _systemExtra:        profile.systemExtra,
    _sharedBus:          config._sharedBus || null,
    // Validation humaine du plan : seulement pour les rôles qui écrivent et
    // si l'appelant a fourni un callback d'approbation.
    requestPlanApproval: profile.requirePlanApproval && typeof config.requestPlanApproval === 'function'
      ? config.requestPlanApproval
      : null,
    requestApproval:     config.requestApproval,
    maxSteps:            Math.min(config.maxSteps || 25, profile.maxSteps || 15),
  };

  const modifiedFiles = new Set();
  const subOnEvent = (event) => {
    // Collecter les fichiers modifiés pour les retourner dans le résultat
    if (event.type === 'write_preview' && event.path) modifiedFiles.add(event.path);
    onEvent({ type: 'sub_agent_event', role, label: profile.label, color: profile.color, subEvent: event });
  };

  return { profile, subConfig, subOnEvent, modifiedFiles };
}

/**
 * @param {{ role: string, task: string }} args
 * @param {object}   config
 * @param {Function} onEvent
 * @param {string}   projectRoot
 */
async function spawnAgent({ role, task }, config, onEvent, projectRoot) {
  const profile = PROFILES[role];
  if (!profile) {
    const available = Object.keys(PROFILES).join(', ');
    return { ok: false, error: `ROLE_INCONNU: "${role}". Rôles disponibles : ${available}` };
  }
  if (!task) return { ok: false, error: 'SOUS_AGENT_SANS_TACHE' };

  const llmGenerate = config._llmGenerate;
  if (!llmGenerate) return { ok: false, error: 'LLM_NON_INJECTABLE_SOUS_AGENT' };

  // Lazy require — évite la dépendance circulaire à l'import
  const { runAgent } = require('../agent');

  onEvent({ type: 'sub_agent_start', role, label: profile.label, color: profile.color, task });

  const { subConfig, subOnEvent, modifiedFiles } = _buildSubContext(role, task, config, onEvent);

  try {
    const result = await runAgent({
      task,
      projectRoot,
      config: subConfig,
      signal:      config._signal,
      llmGenerate,
      onEvent:     subOnEvent,
    });
    const files = [...modifiedFiles];
    onEvent({ type: 'sub_agent_done', role, label: profile.label, color: profile.color, result, modifiedFiles: files });
    return { ok: true, role, summary: result.summary || 'Sous-tâche terminée.', modifiedFiles: files };
  } catch (err) {
    const result = { ok: false, error: err.message };
    onEvent({ type: 'sub_agent_done', role, label: profile.label, color: profile.color, result, modifiedFiles: [] });
    return { ok: false, error: err.message };
  }
}

/**
 * Lance plusieurs sous-agents en parallèle (Promise.all).
 * Tous partagent le même bus de messages — créé automatiquement si absent.
 * @param {{ agents: Array<{role: string, task: string}> }} args
 */
async function spawnParallel({ agents }, config, onEvent, projectRoot) {
  if (!Array.isArray(agents) || agents.length === 0) {
    return { ok: false, error: 'SPAWN_PARALLEL_AGENTS_REQUIS' };
  }

  const llmGenerate = config._llmGenerate;
  if (!llmGenerate) return { ok: false, error: 'LLM_NON_INJECTABLE_SOUS_AGENT' };

  // Valider tous les rôles avant de lancer quoi que ce soit
  for (const { role } of agents) {
    if (!PROFILES[role]) {
      const available = Object.keys(PROFILES).join(', ');
      return { ok: false, error: `ROLE_INCONNU: "${role}". Rôles disponibles : ${available}` };
    }
  }

  // Bus partagé automatique — tous les agents parallèles peuvent se lire
  const sharedConfig = config._sharedBus
    ? config
    : { ...config, _sharedBus: createSharedBus() };

  const { runAgent } = require('../agent');

  const promises = agents.map(({ role, task }) => {
    const profile = PROFILES[role];
    onEvent({ type: 'sub_agent_start', role, label: profile.label, color: profile.color, task });

    const { subConfig, subOnEvent, modifiedFiles } = _buildSubContext(role, task, sharedConfig, onEvent);

    return runAgent({ task, projectRoot, config: subConfig, signal: config._signal, llmGenerate, onEvent: subOnEvent })
      .then(result => {
        const files = [...modifiedFiles];
        onEvent({ type: 'sub_agent_done', role, label: profile.label, color: profile.color, result, modifiedFiles: files });
        return { ok: true, role, summary: result.summary || 'Sous-tâche terminée.', modifiedFiles: files };
      })
      .catch(err => {
        onEvent({ type: 'sub_agent_done', role, label: PROFILES[role].label, color: PROFILES[role].color, result: { ok: false, error: err.message }, modifiedFiles: [] });
        return { ok: false, role, error: err.message };
      });
  });

  const results = await Promise.all(promises);
  const allOk   = results.every(r => r.ok);
  const allFiles = [...new Set(results.flatMap(r => r.modifiedFiles || []))];

  return { ok: allOk, results, modifiedFiles: allFiles };
}

module.exports = { spawnAgent, spawnParallel, _buildSubContext };
