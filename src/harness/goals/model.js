'use strict';

/**
 * Modèle d'objectif persistant.
 *
 * Un objectif est créé pour UNE tâche : il porte la demande utilisateur (source),
 * des critères vérifiables, un plan, des décisions et un budget. Il n'est `done`
 * que lorsque tous les critères ont une preuve — c'est le gate de `finish`.
 */

const crypto = require('crypto');

const MAX_CRITERIA   = 8;
const MAX_CONSTRAINTS = 6;
const CRITERION_MAX  = 160;
const OBJECTIVE_MAX  = 200;
const SOURCE_MAX     = 300;

const DEFAULT_BUDGET = Object.freeze({
  maxSteps:   30,
  maxFiles:   8,
  maxNewDeps: 0,
  maxReplans: 2,
});

/** Identifiant lisible et unique : g-YYYYMMDD-xxxxxx. */
function newGoalId() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `g-${day}-${crypto.randomBytes(3).toString('hex')}`;
}

function _text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function _normalizeBudget(raw, fallbackSteps) {
  const budget = { ...DEFAULT_BUDGET, ...(fallbackSteps ? { maxSteps: fallbackSteps } : {}) };
  if (!raw || typeof raw !== 'object') return budget;

  // Le modèle ne peut pas s'octroyer un budget illimité : les plafonds du projet
  // (config.maxSteps) et les bornes dures restent prioritaires.
  const ceiling = {
    maxSteps:   Math.min(fallbackSteps || DEFAULT_BUDGET.maxSteps, 50),
    maxFiles:   20,
    maxReplans: 3,
  };
  for (const key of ['maxSteps', 'maxFiles', 'maxReplans']) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) {
      budget[key] = Math.min(Math.floor(value), ceiling[key]);
    }
  }
  // Toute dépendance exige une décision D2 : ce budget n'est pas négociable par l'outil.
  budget.maxNewDeps = 0;
  return budget;
}

/**
 * Valide et normalise les critères fournis par le modèle.
 * Un critère sans vérification machine est refusé : pas de « done » déclaratif.
 * @returns {{ ok: true, criteria: object[] } | { ok: false, error: string }}
 */
function normalizeCriteria(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'GOAL_SANS_CRITERE — fournis au moins un critère vérifiable' };
  }
  if (raw.length > MAX_CRITERIA) {
    return { ok: false, error: `GOAL_TROP_DE_CRITERES: ${raw.length} > ${MAX_CRITERIA}` };
  }

  const criteria = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `CRITERE_${i + 1}_INVALIDE` };
    }
    const text = _text(item.text, CRITERION_MAX);
    if (!text) return { ok: false, error: `CRITERE_${i + 1}_SANS_TEXTE` };

    const verify = item.verify;
    if (!verify || typeof verify !== 'object') {
      return { ok: false, error: `CRITERE_${i + 1}_SANS_VERIFICATION — { kind: "test|file|command", ... }` };
    }
    const kind = String(verify.kind || '').toLowerCase();
    if (!['file', 'test', 'command'].includes(kind)) {
      return { ok: false, error: `CRITERE_${i + 1}_TYPE_INCONNU: ${verify.kind}` };
    }

    const target = kind === 'file'
      ? _text(verify.path, 200)
      : _text(verify.command, 200);
    if (!target) {
      return {
        ok: false,
        error: kind === 'file'
          ? `CRITERE_${i + 1}: path requis pour une vérification "file"`
          : `CRITERE_${i + 1}: command requis pour une vérification "${kind}"`,
      };
    }

    criteria.push({
      id: `c${i + 1}`,
      text,
      verify: kind === 'file' ? { kind, path: target } : { kind, command: target },
      status: 'pending',
      evidence: null,
    });
  }
  return { ok: true, criteria };
}

/**
 * Construit un objectif validé.
 * @param {{ objective: string, source: string, criteria: object[], constraints?: string[], budget?: object, projectRoot: string, maxSteps?: number }} input
 * @returns {{ ok: true, goal: object } | { ok: false, error: string }}
 */
function createGoal(input = {}) {
  const objective = _text(input.objective, OBJECTIVE_MAX);
  if (!objective) return { ok: false, error: 'GOAL_SANS_OBJECTIF' };

  const source = _text(input.source, SOURCE_MAX);
  if (!source) return { ok: false, error: 'GOAL_SANS_SOURCE — cite la demande utilisateur' };

  const criteriaResult = normalizeCriteria(input.criteria);
  if (!criteriaResult.ok) return criteriaResult;

  const constraints = Array.isArray(input.constraints)
    ? input.constraints.map(c => _text(c, 140)).filter(Boolean).slice(0, MAX_CONSTRAINTS)
    : [];

  const now = new Date().toISOString();
  return {
    ok: true,
    goal: {
      version: 1,
      id: newGoalId(),
      projectRoot: input.projectRoot || null,
      sessionId: input.sessionId || null,
      objective,
      source,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      criteria: criteriaResult.criteria,
      constraints,
      plan: [],
      decisions: [],
      attempts: [],
      replans: 0,
      budget: _normalizeBudget(input.budget, input.maxSteps),
    },
  };
}

function pendingCriteria(goal) {
  if (!goal || !Array.isArray(goal.criteria)) return [];
  return goal.criteria.filter(c => c.status !== 'met');
}

function allCriteriaMet(goal) {
  return !!goal && Array.isArray(goal.criteria) && goal.criteria.length > 0
    && goal.criteria.every(c => c.status === 'met');
}

/** Bloc compact injecté dans le prompt et renvoyé à l'agent après chaque action. */
function goalSummary(goal, { maxLength = 700 } = {}) {
  if (!goal) return '';
  const met = goal.criteria.filter(c => c.status === 'met').length;
  const remaining = goal.criteria.filter(c => c.status !== 'met');
  const shown = remaining.slice(0, 3).map(c => `[ ] ${c.id} ${c.text}`);
  if (remaining.length > 3) shown.push(`… +${remaining.length - 3} critère(s)`);
  const decisions = goal.decisions.length
    ? `Décisions : ${goal.decisions.length} (dernière ${goal.decisions[goal.decisions.length - 1].class} : ${goal.decisions[goal.decisions.length - 1].choice})`
    : 'Décisions : aucune';

  const lines = [
    `Objectif : ${goal.objective}`,
    `Critères : ${met}/${goal.criteria.length} prouvés`,
    ...shown,
    `Budget : ${goal.budget.maxSteps} étapes max · ${goal.budget.maxFiles} fichiers · ${goal.budget.maxNewDeps} dépendance(s) · ${goal.replans}/${goal.budget.maxReplans} réplans`,
    decisions,
  ];
  return lines.join('\n').slice(0, maxLength);
}

module.exports = {
  DEFAULT_BUDGET,
  MAX_CRITERIA,
  createGoal,
  goalSummary,
  newGoalId,
  normalizeCriteria,
  allCriteriaMet,
  pendingCriteria,
};
