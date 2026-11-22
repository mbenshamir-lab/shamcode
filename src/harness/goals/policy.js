'use strict';

/**
 * Politique de décision et gate de complétion d'un objectif.
 *
 * Classes de décision :
 *   D0 locale réversible      — nommage, ordre, fichier de test
 *   D1 projet réversible      — module interne, refactor local
 *   D2 structurante           — API publique, IPC, schéma, >3 modules, dépendance
 *   D3 irréversible / risquée — suppression de données, shell destructif, secret, publication
 *
 * `assisted` : D0/D1 seul, D2/D3 demandés. `auto` : D0–D2 seul, D3 demandé.
 */

const { TOOLS } = require('../../shared/constants');

const DECISION_CLASSES = {
  D0: 'locale réversible',
  D1: 'projet réversible',
  D2: 'structurante',
  D3: 'irréversible ou risquée',
};

const AUTONOMY = {
  off:      { D0: false, D1: false, D2: false, D3: false },
  assisted: { D0: true,  D1: true,  D2: false, D3: false },
  auto:     { D0: true,  D1: true,  D2: true,  D3: false },
};

const MOD_TOOLS = new Set([
  TOOLS.WRITE_FILE, TOOLS.REPLACE_CODE, TOOLS.BATCH_REPLACE,
  TOOLS.DELETE_FILE, TOOLS.MOVE_FILE,
]);

const DEPENDENCY_FILES = ['package.json', 'package-lock.json'];

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(AUTONOMY, level) ? level : 'assisted';
}

/** @returns {boolean} l'agent peut-il trancher seul cette classe ? */
function canDecideAlone(level, decisionClass) {
  const matrix = AUTONOMY[normalizeLevel(level)];
  return matrix[String(decisionClass || '').toUpperCase()] === true;
}

/**
 * Valide une décision journalisable.
 * @returns {{ ok: true, decision: object } | { ok: false, error: string }}
 */
function validateDecision(args = {}) {
  const cls = String(args.class || '').toUpperCase();
  if (!DECISION_CLASSES[cls]) {
    return { ok: false, error: `DECISION_CLASSE_INCONNUE: ${args.class || '(vide)'} — D0, D1, D2 ou D3` };
  }
  const question = String(args.question || '').trim().slice(0, 200);
  const choice = String(args.choice || '').trim().slice(0, 300);
  const rationale = String(args.rationale || '').trim().slice(0, 400);
  if (!question) return { ok: false, error: 'DECISION_SANS_QUESTION' };
  if (!choice) return { ok: false, error: 'DECISION_SANS_CHOIX' };
  if (!rationale) return { ok: false, error: 'DECISION_SANS_RAISON' };

  const alternatives = Array.isArray(args.alternatives)
    ? args.alternatives.map(a => String(a).trim().slice(0, 160)).filter(Boolean).slice(0, 4)
    : [];

  return {
    ok: true,
    decision: {
      class: cls,
      question,
      choice,
      rationale,
      alternatives,
      approved: args.approved === true,
      at: new Date().toISOString(),
    },
  };
}

function _evidenceMatchesCriterion(criterion, evidence) {
  if (!criterion || !evidence) return false;
  if (evidence.kind !== criterion.verify.kind) return false;
  if (criterion.verify.kind === 'file') return String(evidence.path) === criterion.verify.path;
  return String(evidence.command) === criterion.verify.command;
}

function _evidenceBackedByTrace(criterion, trace) {
  const evidence = criterion.evidence;
  if (!evidence) return false;

  if (evidence.kind === 'file') {
    return trace.some(t => t.tool === TOOLS.READ_FILE && t.result?.ok
      && String(t.args?.path) === String(evidence.path));
  }
  if (evidence.kind === 'test') {
    return trace.some(t => t.tool === TOOLS.RUN_TESTS && t.result?.ok);
  }
  if (evidence.kind === 'command') {
    return trace.some(t => t.tool === TOOLS.RUN_SHELL && t.result?.ok
      && String(t.args?.command) === String(evidence.command));
  }
  return false;
}

function _touchesDependencyFile(trace) {
  return trace.some(t => MOD_TOOLS.has(t.tool) && t.result?.ok
    && DEPENDENCY_FILES.some(f => String(t.args?.path || '').endsWith(f)));
}

/**
 * Vérifie qu'un objectif peut être clôturé.
 * @param {object} goal
 * @param {{ trace?: object[], filesChanged?: number, steps?: number }} ctx
 * @returns {{ ok: boolean, reason?: string, pending?: object[] }}
 */
function evaluateGoalCompletion(goal, { trace = [], filesChanged = 0, steps = 0, allowIncomplete = false } = {}) {
  if (!goal) return { ok: true };

  const pending = goal.criteria.filter(c => c.status !== 'met');
  if (pending.length > 0 && !allowIncomplete) {
    return {
      ok: false,
      pending,
      reason: `${pending.length} critère(s) non prouvé(s) : ${pending.map(c => `${c.id} ${c.text}`).join(' · ')}`,
    };
  }

  for (const criterion of goal.criteria) {
    if (!_evidenceMatchesCriterion(criterion, criterion.evidence)) {
      return { ok: false, reason: `preuve incohérente pour ${criterion.id} (attendu ${criterion.verify.kind} ${criterion.verify.path || criterion.verify.command})` };
    }
    if (!_evidenceBackedByTrace(criterion, trace)) {
      return {
        ok: false,
        reason: `preuve de ${criterion.id} absente de la trace : relis le fichier ou relance le test avant de déclarer le critère atteint`,
      };
    }
  }

  if (steps > goal.budget.maxSteps) {
    return { ok: false, reason: `budget d'étapes dépassé (${steps}/${goal.budget.maxSteps})` };
  }
  if (filesChanged > goal.budget.maxFiles) {
    return { ok: false, reason: `budget de fichiers dépassé (${filesChanged}/${goal.budget.maxFiles}) — élargis le budget via une décision D2 ou réduis le périmètre` };
  }
  if (goal.budget.maxNewDeps === 0 && _touchesDependencyFile(trace)) {
    const hasDecision = goal.decisions.some(d => d.class === 'D2');
    if (!hasDecision) {
      return { ok: false, reason: 'package.json modifié sans décision D2 journalisée (dépendance = structurant)' };
    }
  }

  return { ok: true };
}

/** Seuil d'alerte budget (70 % des étapes). */
function shouldWarnBudget(goal, steps) {
  if (!goal) return false;
  return steps >= Math.ceil(goal.budget.maxSteps * 0.7);
}

module.exports = {
  AUTONOMY,
  DECISION_CLASSES,
  canDecideAlone,
  evaluateGoalCompletion,
  normalizeLevel,
  shouldWarnBudget,
  validateDecision,
};
