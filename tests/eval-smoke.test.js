const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { runEval } = require('./eval/run');

// Garde-fou de non-régression : une sélection rapide (sans run_tests) doit rester verte.
// La suite complète s'exécute avec `npm run eval`.
test('eval — sélection rapide verte et rapport exploitable', async () => {
  const report = await runEval({ only: ['recover-json', 'feature-create', 'path-guard'] });

  assert.equal(report.summary.tasks, 3);
  assert.equal(report.summary.unknown, 0, `échecs inattendus : ${report.tasks.filter(t => !t.ok).map(t => t.id).join(', ')}`);
  assert.equal(report.summary.passed, 3);

  // Le prompt système doit être mesuré et identifié
  assert.ok(report.summary.systemChars > 10000, `prompt trop petit : ${report.summary.systemChars}`);
  assert.match(report.promptHash, /^[0-9a-f]{8}$/);

  // Chaque tâche expose ses métriques
  for (const t of report.tasks) {
    assert.ok(t.metrics.steps >= 1, `${t.id} : aucune étape`);
    assert.ok(Array.isArray(t.checks) && t.checks.length > 0, `${t.id} : aucune vérification`);
  }
});

test('eval — le garde-fou hors projet est bien actif', async () => {
  const report = await runEval({ only: ['path-guard', 'approval-reject'] });
  const guard = report.tasks.find(t => t.id === 'path-guard');
  const approval = report.tasks.find(t => t.id === 'approval-reject');

  assert.ok(guard.metrics.errors.some(e => e.includes('PATH_GUARD')));
  assert.ok(approval.metrics.errors.some(e => e.includes('REJETÉ_PAR_UTILISATEUR')));
  assert.equal(approval.ok, true);
});
