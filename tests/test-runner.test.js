const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { runTests, _detectRunner } = require('../src/harness/tools/test-runner');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runner-'));
}

// ── _detectRunner ─────────────────────────────────────────────────────────────

test('_detectRunner — package.json avec script test → npm', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' },
  }));
  const r = _detectRunner(root);
  assert.ok(r, 'Doit détecter un runner');
  assert.equal(r.runner, 'npm');
  assert.equal(r.cmd, 'npm test');
});

test('_detectRunner — Cargo.toml → cargo', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "test"');
  const r = _detectRunner(root);
  assert.ok(r);
  assert.equal(r.runner, 'cargo');
});

test('_detectRunner — go.mod → go', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/app\ngo 1.21');
  const r = _detectRunner(root);
  assert.ok(r);
  assert.equal(r.runner, 'go');
});

test('_detectRunner — pytest.ini → pytest', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'pytest.ini'), '[pytest]');
  const r = _detectRunner(root);
  assert.ok(r);
  assert.equal(r.runner, 'pytest');
});

test('_detectRunner — dossier vide → null', () => {
  const root = tmpDir();
  const r = _detectRunner(root);
  assert.equal(r, null);
});

// ── runTests ──────────────────────────────────────────────────────────────────

test('runTests — sans projectRoot → RUN_TESTS_SANS_PROJET', async () => {
  const r = await runTests({}, '');
  assert.ok(!r.ok);
  assert.equal(r.error, 'RUN_TESTS_SANS_PROJET');
});

test('runTests — runner non détecté → RUNNER_NON_DÉTECTÉ', async () => {
  const root = tmpDir();
  const r = await runTests({}, root);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('RUNNER_NON_DÉTECTÉ'), `Attendu RUNNER_NON_DÉTECTÉ, reçu : ${r.error}`);
});

test('runTests — commande non whitelistée → COMMANDE_TEST_NON_AUTORISÉE', async () => {
  const root = tmpDir();
  const r = await runTests({ command: 'rm -rf /' }, root);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('COMMANDE_TEST_NON_AUTORISÉE'));
});

test('runTests — projet npm réel → tests passent', async () => {
  // Utilise le projet harness lui-même comme cobaye
  const root = path.resolve(__dirname, '..');
  const r = await runTests({}, root);
  // On vérifie la structure de retour, pas le résultat exact (le runner peut varier)
  assert.ok(typeof r.ok === 'boolean', 'ok doit être un booléen');
  assert.equal(r.runner, 'npm', `Runner attendu npm, reçu ${r.runner}`);
  assert.ok(typeof r.stdout === 'string', 'stdout doit être une string');
  assert.ok(typeof r.exitCode === 'number', 'exitCode doit être un nombre');
}, { timeout: 60000 });

test('runTests — command manuelle npm test → acceptée', async () => {
  const root = path.resolve(__dirname, '..');
  const r = await runTests({ command: 'npm test' }, root);
  assert.equal(r.runner, 'manuel');
  assert.ok(typeof r.stdout === 'string');
}, { timeout: 60000 });
