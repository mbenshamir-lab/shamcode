'use strict';

// Moteur d'objectifs (ADR-031) : modèle, store, politique de décision, outil et
// intégration dans la boucle (gate de finish).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Le harness écrit sessions/objectifs sous APPDATA : isoler avant tout require.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-goal-data-'));
process.env.APPDATA = DATA_DIR;
process.env.HARNESS_DATA_DIR = path.join(DATA_DIR, 'code-harness');

const {
  createGoal,
  goalSummary,
  pendingCriteria,
} = require('../src/harness/goals/model');
const {
  archiveActiveGoal,
  loadActiveGoal,
  loadGoal,
  saveGoal,
} = require('../src/harness/goals/store');
const {
  canDecideAlone,
  evaluateGoalCompletion,
  validateDecision,
} = require('../src/harness/goals/policy');
const { goalTool } = require('../src/harness/tools/goal');
const { runAgent } = require('../src/harness/agent');

function tmpProject(name = 'projet') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harness-${name}-`));
  return root;
}

function goalInput(root, overrides = {}) {
  return {
    objective: 'Ajouter l\'export CSV',
    source: '« je veux exporter mes sessions en CSV »',
    projectRoot: root,
    criteria: [{ text: 'fichier export.js créé', verify: { kind: 'file', path: 'src/export.js' } }],
    ...overrides,
  };
}

// ── Modèle ────────────────────────────────────────────────────────────────────

test('goal model — refuse sans objectif, sans source, sans critère', () => {
  const root = tmpProject();
  assert.equal(createGoal(goalInput(root, { objective: '' })).error, 'GOAL_SANS_OBJECTIF');
  assert.equal(createGoal(goalInput(root, { source: '' })).error, 'GOAL_SANS_SOURCE — cite la demande utilisateur');
  assert.equal(createGoal(goalInput(root, { criteria: [] })).error, 'GOAL_SANS_CRITERE — fournis au moins un critère vérifiable');
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal model — refuse un critère sans vérification machine', () => {
  const root = tmpProject();
  const r = createGoal(goalInput(root, { criteria: [{ text: 'ça marche' }] }));
  assert.ok(!r.ok);
  assert.match(r.error, /SANS_VERIFICATION/);

  const bad = createGoal(goalInput(root, {
    criteria: [{ text: 'x', verify: { kind: 'file' } }],
  }));
  assert.ok(!bad.ok);
  assert.match(bad.error, /path requis/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal model — objectif valide + résumé compact', () => {
  const root = tmpProject();
  const r = createGoal(goalInput(root));
  assert.ok(r.ok);
  assert.equal(r.goal.status, 'active');
  assert.equal(r.goal.criteria[0].id, 'c1');
  assert.equal(pendingCriteria(r.goal).length, 1);
  const summary = goalSummary(r.goal);
  assert.ok(summary.includes('export CSV'));
  assert.ok(summary.includes('Critères : 0/1'));
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Store ─────────────────────────────────────────────────────────────────────

test('goal store — écriture, lecture, objectif actif, archivage', () => {
  const root = tmpProject();
  const { goal } = createGoal(goalInput(root));

  saveGoal(root, goal);
  const file = path.join(root, '.harness', 'goals', `${goal.id}.json`);
  assert.ok(fs.existsSync(file), 'fichier objectif attendu');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).id, goal.id);
  assert.equal(loadGoal(root, goal.id).objective, goal.objective);
  assert.equal(loadActiveGoal(root).id, goal.id);

  archiveActiveGoal(root, 'test');
  assert.equal(loadActiveGoal(root), null, 'un objectif archivé n\'est plus actif');
  assert.equal(loadGoal(root, goal.id).status, 'abandoned');
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Politique ─────────────────────────────────────────────────────────────────

test('goal policy — autonomie assisted/auto/off', () => {
  assert.equal(canDecideAlone('off', 'D0'), false);
  assert.equal(canDecideAlone('assisted', 'D0'), true);
  assert.equal(canDecideAlone('assisted', 'D1'), true);
  assert.equal(canDecideAlone('assisted', 'D2'), false);
  assert.equal(canDecideAlone('auto', 'D2'), true);
  assert.equal(canDecideAlone('auto', 'D3'), false);
});

test('goal policy — décision D2 refusée sans accord, acceptée avec approved', async () => {
  const root = tmpProject();
  const { goal } = createGoal(goalInput(root));
  saveGoal(root, goal);

  const event = [];
  const refused = await goalTool({
    action: 'decide', class: 'D2', question: 'Ajouter une dépendance ?',
    choice: 'non', rationale: 'zéro dépendance',
  }, { autonomyLevel: 'assisted' }, root, (e) => event.push(e));
  assert.ok(!refused.ok);
  assert.match(refused.error, /DECISION_D2_NON_AUTORISEE/);

  const accepted = await goalTool({
    action: 'decide', class: 'D2', question: 'Ajouter une dépendance ?',
    choice: 'csv-stringify', rationale: 'demandé et validé par l\'utilisateur', approved: true,
  }, { autonomyLevel: 'assisted' }, root, (e) => event.push(e));
  assert.ok(accepted.ok);
  assert.equal(accepted.goal.decisions.length, 1);
  assert.ok(event.some(e => e.type === 'goal_decision'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal policy — gate : critère non prouvé, preuve non tracée, budget', () => {
  const root = tmpProject();
  const { goal } = createGoal(goalInput(root));
  const pending = evaluateGoalCompletion(goal, { trace: [], filesChanged: 1, steps: 3 });
  assert.ok(!pending.ok);
  assert.match(pending.reason, /non prouvé/);

  goal.criteria[0].status = 'met';
  goal.criteria[0].evidence = { kind: 'file', path: 'src/export.js' };
  const untraced = evaluateGoalCompletion(goal, { trace: [], filesChanged: 1, steps: 3 });
  assert.ok(!untraced.ok);
  assert.match(untraced.reason, /absente de la trace/);

  const trace = [{ tool: 'read_file', args: { path: 'src/export.js' }, result: { ok: true } }];
  assert.ok(evaluateGoalCompletion(goal, { trace, filesChanged: 1, steps: 3 }).ok);

  const overBudget = evaluateGoalCompletion(goal, { trace, filesChanged: 99, steps: 3 });
  assert.ok(!overBudget.ok);
  assert.match(overBudget.reason, /budget de fichiers/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal policy — package.json sans décision D2 bloque la clôture', () => {
  const root = tmpProject();
  const { goal } = createGoal(goalInput(root));
  goal.criteria[0].status = 'met';
  goal.criteria[0].evidence = { kind: 'file', path: 'src/export.js' };
  const trace = [
    { tool: 'read_file', args: { path: 'src/export.js' }, result: { ok: true } },
    { tool: 'write_file', args: { path: 'package.json' }, result: { ok: true } },
  ];
  const blocked = evaluateGoalCompletion(goal, { trace, filesChanged: 2, steps: 4 });
  assert.ok(!blocked.ok);
  assert.match(blocked.reason, /décision D2/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal policy — validation des décisions', () => {
  assert.ok(!validateDecision({ class: 'D9' }).ok);
  assert.ok(!validateDecision({ class: 'D1' }).ok);
  const ok = validateDecision({
    class: 'D1', question: 'Où mettre le module ?', choice: 'src/export.js', rationale: 'colocalisé',
  });
  assert.ok(ok.ok);
  assert.equal(ok.decision.class, 'D1');
});

// ── Outil ────────────────────────────────────────────────────────────────────

test('goal tool — cycle set → status → close, et refus de close incomplet', async () => {
  const root = tmpProject();
  const events = [];
  const onEvent = (e) => events.push(e);
  const config = { autonomyLevel: 'assisted' };

  const set = await goalTool({
    action: 'set',
    objective: 'Exporter les sessions',
    source: '« exporte mes sessions »',
    criteria: [{ text: 'export.js créé', verify: { kind: 'file', path: 'src/export.js' } }],
  }, config, root, onEvent);
  assert.ok(set.ok, set.error);
  assert.ok(set.block.includes('Exporter les sessions'));

  const early = await goalTool({ action: 'close', summary: 'fini' }, config, root, onEvent);
  assert.ok(!early.ok);
  assert.match(early.error, /GOAL_INCOMPLET/);

  const status = await goalTool({
    action: 'status', criterion_id: 'c1', status: 'met',
    evidence: { kind: 'file', path: 'src/export.js' },
  }, config, root, onEvent);
  assert.ok(status.ok, status.error);

  const close = await goalTool({ action: 'close', summary: 'export livré' }, config, root, onEvent);
  assert.ok(close.ok, close.error);
  assert.equal(close.goal.status, 'done');
  assert.ok(events.some(e => e.type === 'goal_created'));
  assert.ok(events.some(e => e.type === 'goal_done'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('goal tool — block, get, et désactivation', async () => {
  const root = tmpProject();
  const config = { autonomyLevel: 'assisted' };
  await goalTool({
    action: 'set', objective: 'X', source: '« X »',
    criteria: [{ text: 'f', verify: { kind: 'file', path: 'f.js' } }],
  }, config, root, () => {});

  const block = await goalTool({ action: 'block', reason: 'info manquante' }, config, root, () => {});
  assert.ok(block.ok);
  assert.equal(block.goal.status, 'blocked');
  assert.equal(loadActiveGoal(root), null);

  const off = await goalTool({ action: 'get' }, { autonomyLevel: 'off' }, root, () => {});
  assert.ok(!off.ok);
  assert.match(off.error, /GOAL_DESACTIVE/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Intégration boucle ───────────────────────────────────────────────────────

test('agent — objectif d\'une session précédente archivé au démarrage', async () => {
  const root = tmpProject('agent-scope');
  const { goal } = createGoal(goalInput(root, { sessionId: 'session-precedente' }));
  saveGoal(root, goal);

  const events = [];
  const result = await runAgent({
    task: 'Dis bonjour',
    llmGenerate: async () => JSON.stringify({ tool: 'finish', args: { summary: 'bonjour' } }),
    projectRoot: root,
    config: { autonomyLevel: 'assisted', maxSteps: 3 },
    onEvent: (e) => events.push(e),
  });

  assert.ok(result.ok);
  assert.ok(!result.goal, 'aucun objectif ne doit être rattaché à la nouvelle session');
  assert.ok(events.some(e => e.type === 'goal_finish_rejected') === false);
  const archived = loadGoal(root, goal.id);
  assert.equal(archived.status, 'abandoned');
  fs.rmSync(root, { recursive: true, force: true });
});

test('agent — objectif bloqué : finish autorisé sans preuve', async () => {
  const root = tmpProject('agent-blocked');
  const script = [
    { tool: 'goal', args: {
      action: 'set', objective: 'Faire X', source: '« fais X »',
      criteria: [{ text: 'X fait', verify: { kind: 'file', path: 'x.js' } }],
    } },
    { tool: 'goal', args: { action: 'block', reason: 'information manquante' } },
    { tool: 'finish', args: { summary: 'Bloqué : information manquante.' } },
  ];
  let index = 0;
  const events = [];
  const result = await runAgent({
    task: 'Fais X',
    llmGenerate: async () => JSON.stringify(script[Math.min(index++, script.length - 1)]),
    projectRoot: root,
    config: { autonomyLevel: 'assisted', maxSteps: 6 },
    onEvent: (e) => events.push(e),
  });

  assert.ok(result.ok, result.error);
  assert.equal(result.goal.status, 'blocked');
  assert.ok(!events.some(e => e.type === 'goal_finish_rejected'), 'un objectif bloqué ne doit pas être re-nudgé');
  fs.rmSync(root, { recursive: true, force: true });
});

test('agent — objectif actif : finish refusé sans preuve, puis clôture', async () => {
  const root = tmpProject('agent-goal');
  fs.mkdirSync(path.join(root, 'src'));

  const script = [
    { tool: 'goal', args: {
      action: 'set', objective: 'Créer export.js', source: '« crée export.js »',
      criteria: [{ text: 'export.js créé', verify: { kind: 'file', path: 'src/export.js' } }],
    } },
    { tool: 'write_file', args: { path: 'src/export.js', content: 'module.exports = 1;\n' } },
    { tool: 'read_file', args: { path: 'src/export.js' } },
    { tool: 'finish', args: { summary: 'fait', checks: [{ kind: 'file', path: 'src/export.js' }] } },
    { tool: 'goal', args: {
      action: 'status', criterion_id: 'c1', status: 'met',
      evidence: { kind: 'file', path: 'src/export.js' },
    } },
    { tool: 'goal', args: { action: 'close', summary: 'export prêt' } },
    { tool: 'finish', args: { summary: 'fait', checks: [{ kind: 'file', path: 'src/export.js' }] } },
  ];
  let index = 0;
  const llmGenerate = async () => {
    const call = script[Math.min(index, script.length - 1)];
    index += 1;
    return JSON.stringify(call);
  };

  const events = [];
  const result = await runAgent({
    task: 'Crée src/export.js',
    llmGenerate,
    projectRoot: root,
    config: { autonomyLevel: 'assisted', maxSteps: 12, backupBeforeWrite: false },
    onEvent: (e) => events.push(e),
  });

  assert.ok(result.ok, result.error);
  assert.equal(result.goal.status, 'done');
  assert.ok(events.some(e => e.type === 'goal_finish_rejected'), 'le finish sans preuve doit être refusé');
  assert.ok(events.some(e => e.type === 'goal_done'));
  fs.rmSync(root, { recursive: true, force: true });
});
