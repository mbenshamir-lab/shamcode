'use strict';

/**
 * Outil `goal` — objectif persistant d'une tâche.
 *
 * Actions :
 *   set    — crée l'objectif (objectif + source + critères vérifiables)
 *   status — met à jour un critère avec une PREUVE (test, fichier, commande)
 *   decide — journalise une décision D0–D3 (D2/D3 selon le niveau d'autonomie)
 *   plan   — remplace le plan (compte une réplanification)
 *   close  — clôt l'objectif si tous les critères sont prouvés
 *   block  — déclare l'objectif bloqué (raison obligatoire)
 *   get    — relit l'objectif actif
 *
 * L'outil ne lève jamais : il retourne `{ ok: false, error }`.
 */

const {
  createGoal,
  goalSummary,
  pendingCriteria,
} = require('../goals/model');
const {
  loadActiveGoal,
  archiveActiveGoal,
  saveGoal,
} = require('../goals/store');
const {
  canDecideAlone,
  normalizeLevel,
  validateDecision,
} = require('../goals/policy');

const PLAN_MAX_STEPS = 12;

function _level(config) {
  return normalizeLevel(config?.autonomyLevel || 'assisted');
}

function _requireActive(projectRoot) {
  const goal = loadActiveGoal(projectRoot);
  if (!goal) return { error: 'GOAL_AUCUN_OBJECTIF_ACTIF — crée-le avec { "action": "set", ... }' };
  return { goal };
}

function _validateEvidence(criterion, evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, error: `GOAL_PREUVE_REQUISE — { kind: "test|file|command", ... } pour ${criterion.id}` };
  }
  if (evidence.kind !== criterion.verify.kind) {
    return { ok: false, error: `GOAL_PREUVE_TYPE: attendu ${criterion.verify.kind}, reçu ${evidence.kind}` };
  }
  if (criterion.verify.kind === 'file') {
    if (String(evidence.path || '') !== criterion.verify.path) {
      return { ok: false, error: `GOAL_PREUVE_CHEMIN: attendu ${criterion.verify.path}, reçu ${evidence.path || '(vide)'}` };
    }
    return { ok: true, evidence: { kind: 'file', path: evidence.path, at: new Date().toISOString() } };
  }
  if (String(evidence.command || '') !== criterion.verify.command) {
    return { ok: false, error: `GOAL_PREUVE_COMMANDE: attendu ${criterion.verify.command}, reçu ${evidence.command || '(vide)'}` };
  }
  if (evidence.kind === 'test' && String(evidence.result || '').toLowerCase() !== 'pass') {
    return { ok: false, error: `GOAL_TEST_NON_VERT — result doit valoir "pass" pour ${criterion.id}` };
  }
  return {
    ok: true,
    evidence: {
      kind: evidence.kind,
      command: evidence.command,
      ...(evidence.result ? { result: String(evidence.result).slice(0, 20) } : {}),
      at: new Date().toISOString(),
    },
  };
}

function _set(args, config, projectRoot, onEvent) {
  const built = createGoal({
    objective: args.objective,
    source: args.source,
    criteria: args.criteria,
    constraints: args.constraints,
    budget: args.budget,
    projectRoot,
    maxSteps: config?.maxSteps,
    sessionId: config?._sessionId,
  });
  if (!built.ok) return built;

  archiveActiveGoal(projectRoot, 'remplacé par un nouvel objectif');
  saveGoal(projectRoot, built.goal);
  onEvent({ type: 'goal_created', goal: built.goal });
  return { ok: true, goal: built.goal, block: goalSummary(built.goal), notify: true };
}

function _status(args, projectRoot, onEvent) {
  const { goal, error } = _requireActive(projectRoot);
  if (error) return { ok: false, error };

  const criterion = goal.criteria.find(c => c.id === String(args.criterion_id || ''));
  if (!criterion) {
    return {
      ok: false,
      error: `GOAL_CRITERE_INCONNU: ${args.criterion_id || '(vide)'} — critères : ${goal.criteria.map(c => c.id).join(', ')}`,
    };
  }

  const status = String(args.status || '').toLowerCase();
  if (!['met', 'failed'].includes(status)) {
    return { ok: false, error: 'GOAL_STATUT_INVALIDE — "met" ou "failed"' };
  }

  if (status === 'met') {
    const checked = _validateEvidence(criterion, args.evidence);
    if (!checked.ok) return checked;
    criterion.status = 'met';
    criterion.evidence = checked.evidence;
  } else {
    criterion.status = 'failed';
    criterion.evidence = null;
    goal.attempts.push({
      at: new Date().toISOString(),
      criterion: criterion.id,
      note: String(args.note || 'échec').slice(0, 200),
    });
  }

  saveGoal(projectRoot, goal);
  onEvent({ type: 'goal_updated', goal });
  return { ok: true, goal, block: goalSummary(goal) };
}

function _decide(args, config, projectRoot, onEvent) {
  const { goal, error } = _requireActive(projectRoot);
  if (error) return { ok: false, error };

  const checked = validateDecision(args);
  if (!checked.ok) return checked;

  const level = _level(config);
  const decision = checked.decision;
  if (!canDecideAlone(level, decision.class) && decision.approved !== true) {
    return {
      ok: false,
      error: decision.class === 'D3'
        ? 'DECISION_D3_RESERVEE_UTILISATEUR — demande explicitement l\'accord (ask_user), puis rappelle avec "approved": true'
        : 'DECISION_D2_NON_AUTORISEE — niveau assisted : fais valider par l\'utilisateur (plan/ask_user) puis rappelle avec "approved": true',
    };
  }

  goal.decisions.push(decision);
  saveGoal(projectRoot, goal);
  onEvent({ type: 'goal_decision', goal, decision });
  return { ok: true, goal, block: goalSummary(goal) };
}

function _plan(args, projectRoot, onEvent) {
  const { goal, error } = _requireActive(projectRoot);
  if (error) return { ok: false, error };

  const steps = Array.isArray(args.steps)
    ? args.steps.map(s => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, PLAN_MAX_STEPS)
    : [];
  if (steps.length === 0) return { ok: false, error: 'GOAL_PLAN_SANS_ETAPE' };

  if (goal.replans >= goal.budget.maxReplans) {
    return { ok: false, error: `GOAL_PLANS_EPUISES: ${goal.replans}/${goal.budget.maxReplans} — passe à l'action ou bloque l'objectif` };
  }

  goal.replans += 1;
  goal.plan = steps.map((text, i) => ({ id: `s${i + 1}`, text, status: 'todo' }));
  saveGoal(projectRoot, goal);
  onEvent({ type: 'goal_updated', goal });
  return { ok: true, goal, block: goalSummary(goal) };
}

function _close(args, projectRoot, onEvent) {
  const { goal, error } = _requireActive(projectRoot);
  if (error) return { ok: false, error };

  const pending = pendingCriteria(goal);
  if (pending.length > 0) {
    return {
      ok: false,
      error: `GOAL_INCOMPLET — ${pending.length} critère(s) sans preuve : ${pending.map(c => `${c.id} ${c.text}`).join(' · ')}. Utilise goal status avec evidence, ou goal block.`,
    };
  }

  goal.status = 'done';
  goal.closedAt = new Date().toISOString();
  goal.outcome = String(args.summary || '').slice(0, 400) || 'objectif atteint';
  saveGoal(projectRoot, goal);
  onEvent({ type: 'goal_done', goal });
  return { ok: true, goal, block: goalSummary(goal) };
}

function _block(args, projectRoot, onEvent) {
  const { goal, error } = _requireActive(projectRoot);
  if (error) return { ok: false, error };

  const reason = String(args.reason || '').trim().slice(0, 300);
  if (!reason) return { ok: false, error: 'GOAL_BLOCK_SANS_RAISON' };

  goal.status = 'blocked';
  goal.blockReason = reason;
  goal.closedAt = new Date().toISOString();
  saveGoal(projectRoot, goal);
  onEvent({ type: 'goal_blocked', goal });
  return { ok: true, goal, block: goalSummary(goal) };
}

function _get(projectRoot) {
  const goal = loadActiveGoal(projectRoot);
  if (!goal) return { ok: false, error: 'GOAL_AUCUN_OBJECTIF_ACTIF' };
  return { ok: true, goal, block: goalSummary(goal) };
}

/**
 * @param {object} args
 * @param {object} config
 * @param {string} projectRoot
 * @param {Function} onEvent
 */
async function goalTool(args = {}, config = {}, projectRoot = '', onEvent = () => {}) {
  if (_level(config) === 'off') {
    return { ok: false, error: 'GOAL_DESACTIVE — autonomyLevel = off' };
  }
  if (!projectRoot) return { ok: false, error: 'GOAL_SANS_PROJET' };

  const action = String(args.action || 'get').toLowerCase();
  try {
    switch (action) {
      case 'set':    return _set(args, config, projectRoot, onEvent);
      case 'status': return _status(args, projectRoot, onEvent);
      case 'decide': return _decide(args, config, projectRoot, onEvent);
      case 'plan':   return _plan(args, projectRoot, onEvent);
      case 'close':  return _close(args, projectRoot, onEvent);
      case 'block':  return _block(args, projectRoot, onEvent);
      case 'get':    return _get(projectRoot);
      default:
        return { ok: false, error: `GOAL_ACTION_INCONNUE: ${action} — set, status, decide, plan, close, block, get` };
    }
  } catch (error) {
    return { ok: false, error: `GOAL_ERREUR: ${error.message}` };
  }
}

module.exports = { goalTool };
