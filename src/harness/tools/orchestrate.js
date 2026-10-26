// Outil orchestrate — objectif global découpé en phases séquentielles ou parallèles.
// Chaque phase lance 1..N sous-agents ; le résumé de la phase N-1 est injecté
// dans la tâche de la phase N pour garder le fil conducteur.
// runAgent est requis en lazy pour éviter la dépendance circulaire (agent → tools/index → orchestrate → agent).

const { PROFILES } = require('../agents/profiles');
const { createSharedBus } = require('./message-bus');
const { _buildSubContext } = require('./spawn');

const MAX_PHASES = 6;
const MAX_AGENTS_PER_PHASE = 4;

/**
 * Valide la structure { objective, phases } avant tout lancement.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function _validatePlan(objective, phases) {
  if (!objective || typeof objective !== 'string' || !objective.trim()) {
    return { ok: false, error: 'ORCHESTRATE_OBJECTIF_REQUIS' };
  }
  if (!Array.isArray(phases) || phases.length === 0) {
    return { ok: false, error: 'ORCHESTRATE_PHASES_REQUISES' };
  }
  if (phases.length > MAX_PHASES) {
    return { ok: false, error: `ORCHESTRATE_TROP_DE_PHASES: ${phases.length} > ${MAX_PHASES}` };
  }

  const available = Object.keys(PROFILES).join(', ');
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i] || {};
    const agents = phase.agents;
    const mode = phase.mode === 'parallel' ? 'parallel' : 'sequential';

    if (!Array.isArray(agents) || agents.length === 0) {
      return { ok: false, error: `ORCHESTRATE_PHASE_${i + 1}_SANS_AGENT` };
    }
    if (agents.length > MAX_AGENTS_PER_PHASE) {
      return { ok: false, error: `ORCHESTRATE_PHASE_${i + 1}_TROP_D_AGENTS: ${agents.length} > ${MAX_AGENTS_PER_PHASE}` };
    }
    if (mode === 'sequential' && agents.length > 1) {
      return { ok: false, error: `ORCHESTRATE_PHASE_${i + 1}_SEQUENTIEL_MULTI_AGENT` };
    }

    for (const { role, task } of agents) {
      if (!PROFILES[role]) {
        return { ok: false, error: `ROLE_INCONNU: "${role}". Rôles disponibles : ${available}` };
      }
      if (!task) {
        return { ok: false, error: `ORCHESTRATE_PHASE_${i + 1}_AGENT_SANS_TACHE` };
      }
    }
  }

  return { ok: true };
}

/**
 * Prépare la tâche d'une phase en y préfixant le récapitulatif des phases précédentes.
 */
function _withContext(task, objective, previous) {
  if (previous.length === 0) {
    return `Objectif global : ${objective}\n\n${task}`;
  }
  const recap = previous
    .map(p => `- Phase ${p.index} (${p.mode}) : ${p.summary}`)
    .join('\n');
  return `Objectif global : ${objective}\n\nTravail déjà réalisé :\n${recap}\n\nTa tâche : ${task}`;
}

/**
 * Lance un sous-agent et retourne un résultat normalisé (jamais de throw).
 */
async function _runOne({ role, task }, phaseIndex, config, onEvent, projectRoot, llmGenerate) {
  const profile = PROFILES[role];
  onEvent({
    type: 'sub_agent_start', role, label: profile.label, color: profile.color, task,
    phase: phaseIndex,
  });

  const { subConfig, subOnEvent, modifiedFiles } = _buildSubContext(role, task, config, onEvent);

  try {
    const { runAgent } = require('../agent');
    const result = await runAgent({
      task,
      projectRoot,
      config: subConfig,
      signal: config._signal,
      llmGenerate,
      onEvent: subOnEvent,
    });
    const files = [...modifiedFiles];
    onEvent({ type: 'sub_agent_done', role, label: profile.label, color: profile.color, result, modifiedFiles: files, phase: phaseIndex });
    return { ok: true, role, summary: result.summary || 'Sous-tâche terminée.', modifiedFiles: files };
  } catch (err) {
    const result = { ok: false, error: err.message };
    onEvent({ type: 'sub_agent_done', role, label: profile.label, color: profile.color, result, modifiedFiles: [], phase: phaseIndex });
    return { ok: false, role, error: err.message, modifiedFiles: [] };
  }
}

/**
 * Exécute une phase (séquentielle ou parallèle) et retourne ses résultats.
 */
async function _runPhase(phase, phaseIndex, objective, previous, config, onEvent, projectRoot, llmGenerate) {
  const mode = phase.mode === 'parallel' ? 'parallel' : 'sequential';
  const agents = phase.agents.map(({ role, task }) => ({ role, task: _withContext(task, objective, previous) }));

  onEvent({
    type: 'orchestration_phase_start',
    phase: phaseIndex,
    mode,
    roles: phase.agents.map(a => a.role),
    totalPhases: null,
  });

  const results = mode === 'parallel'
    ? await Promise.all(agents.map(a => _runOne(a, phaseIndex, config, onEvent, projectRoot, llmGenerate)))
    : [await _runOne(agents[0], phaseIndex, config, onEvent, projectRoot, llmGenerate)];

  return results;
}

/**
 * @param {{ objective: string, phases: Array<{mode?: 'sequential'|'parallel', agents: Array<{role: string, task: string}>}> }} args
 * @param {object}   config
 * @param {Function} onEvent
 * @param {string}   projectRoot
 */
async function orchestrate({ objective, phases } = {}, config, onEvent, projectRoot) {
  const valid = _validatePlan(objective, phases);
  if (!valid.ok) return valid;

  const llmGenerate = config._llmGenerate;
  if (!llmGenerate) return { ok: false, error: 'LLM_NON_INJECTABLE_SOUS_AGENT' };

  // Bus partagé : les sous-agents de phases différentes peuvent se laisser des messages.
  const sharedConfig = config._sharedBus
    ? config
    : { ...config, _sharedBus: createSharedBus() };

  onEvent({ type: 'orchestration_start', objective, totalPhases: phases.length });

  const previous = [];
  const allFiles = new Set();
  let allOk = true;

  for (let i = 0; i < phases.length; i++) {
    const phaseIndex = i + 1;
    const phase = phases[i];
    const mode = phase.mode === 'parallel' ? 'parallel' : 'sequential';

    const results = await _runPhase(phase, phaseIndex, objective, previous, sharedConfig, onEvent, projectRoot, llmGenerate);

    const ok = results.every(r => r.ok);
    if (!ok) allOk = false;
    for (const r of results) {
      for (const f of r.modifiedFiles || []) allFiles.add(f);
    }

    const summary = results.map(r => r.ok ? `${r.role} : ${r.summary}` : `${r.role} : ÉCHEC — ${r.error}`).join(' | ');
    previous.push({ index: phaseIndex, mode, summary });

    onEvent({
      type: 'orchestration_phase_done',
      phase: phaseIndex,
      mode,
      ok,
      summary,
      totalPhases: phases.length,
    });

    // Une phase en échec interrompt la suite : les phases suivantes
    // dépendent implicitement du travail précédent.
    if (!ok) break;
  }

  const modifiedFiles = [...allFiles];
  const overview = previous.map(p => `Phase ${p.index} (${p.mode}) : ${p.summary}`).join('\n');

  onEvent({ type: 'orchestration_done', ok: allOk, executedPhases: previous.length, totalPhases: phases.length, modifiedFiles });

  return {
    ok: allOk,
    objective,
    executedPhases: previous.length,
    totalPhases: phases.length,
    summary: overview || 'Aucune phase exécutée.',
    modifiedFiles,
  };
}

module.exports = { orchestrate };
