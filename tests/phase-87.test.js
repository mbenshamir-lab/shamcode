/**
 * Phase 87 — Fix-loop mode
 * Tests : fix-loop.js (helpers + logique), constantes, dispatch, agent, settings UI
 */

'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

const ROOT = path.resolve(__dirname, '..');

// ── 1. _extractAllToolCalls ──────────────────────────────────────────────────

test('_extractAllToolCalls — un seul outil', () => {
  const { _extractAllToolCalls } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const text = '{"tool":"replace_code","args":{"path":"src/foo.js","old_string":"x","new_string":"y"}}';
  const calls = _extractAllToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'replace_code');
});

test('_extractAllToolCalls — plusieurs outils', () => {
  const { _extractAllToolCalls } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const text = `
    {"tool":"replace_code","args":{"path":"a.js","old_string":"x","new_string":"y"}}
    {"tool":"write_file","args":{"path":"b.js","content":"hello"}}
  `;
  const calls = _extractAllToolCalls(text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, 'replace_code');
  assert.equal(calls[1].tool, 'write_file');
});

test('_extractAllToolCalls — JSON invalide ignoré', () => {
  const { _extractAllToolCalls } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const text = 'not json at all {"tool":"write_file","args":{}}';
  const calls = _extractAllToolCalls(text);
  assert.equal(calls.length, 1);
});

test('_extractAllToolCalls — objet sans "tool" ignoré', () => {
  const { _extractAllToolCalls } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const text = '{"foo":"bar"} {"tool":"replace_code","args":{}}';
  const calls = _extractAllToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'replace_code');
});

test('_extractAllToolCalls — texte vide retourne []', () => {
  const { _extractAllToolCalls } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  assert.deepEqual(_extractAllToolCalls(''), []);
  assert.deepEqual(_extractAllToolCalls(null), []);
});

// ── 2. _summarizeFailures ────────────────────────────────────────────────────

test('_summarizeFailures — extrait les lignes d\'échec', () => {
  const { _summarizeFailures } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const output = 'ok line\nFAIL: test1\nok line2\nError: assertion failed\n';
  const summary = _summarizeFailures(output);
  assert.ok(summary.includes('FAIL'));
  assert.ok(summary.includes('Error'));
  assert.ok(!summary.includes('ok line'));
});

test('_summarizeFailures — sortie vide', () => {
  const { _summarizeFailures } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  assert.ok(_summarizeFailures('').length > 0);
  assert.ok(_summarizeFailures(null).length > 0);
});

// ── 3. fixLoop — validation sans LLM ────────────────────────────────────────

test('fixLoop — retourne LLM_NON_INJECTABLE sans _llmGenerate', async () => {
  const { fixLoop } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const r = await fixLoop({}, () => {}, '/project', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'LLM_NON_INJECTABLE');
});

test('fixLoop — retourne PROJET_MANQUANT sans projectRoot', async () => {
  const { fixLoop } = require(path.join(ROOT, 'src/harness/tools/fix-loop.js'));
  const r = await fixLoop({}, () => {}, '', { _llmGenerate: async () => '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'PROJET_MANQUANT');
});

test('fixLoop — succès immédiat si tests passent déjà', async () => {
  // Mock runTests via config (test avec projectRoot qui a npm test réel → trop lent)
  // On injecte un faux runTests via monkey-patch du cache
  const modPath = path.join(ROOT, 'src/harness/tools/fix-loop.js');
  const trPath  = path.join(ROOT, 'src/harness/tools/test-runner.js');

  // Backup du module original
  const origTr = require.cache[require.resolve(trPath)];

  // Mock : runTests retourne exitCode=0 (tests passent)
  require.cache[require.resolve(trPath)] = {
    id: require.resolve(trPath),
    filename: require.resolve(trPath),
    loaded: true,
    exports: { runTests: async () => ({ ok: true, exitCode: 0, stdout: 'pass 5', runner: 'npm' }) },
  };
  // Purge fix-loop pour recharger avec mock
  delete require.cache[require.resolve(modPath)];

  const { fixLoop: fl } = require(modPath);
  const r = await fl({}, () => {}, '/project', { _llmGenerate: async () => '' });

  assert.equal(r.ok, true);
  assert.equal(r.fixed, false);
  assert.equal(r.iterations, 0);

  // Restaurer
  if (origTr) require.cache[require.resolve(trPath)] = origTr;
  else delete require.cache[require.resolve(trPath)];
  delete require.cache[require.resolve(modPath)];
});

test('fixLoop — AUCUN_OUTIL_SUGGÉRÉ si LLM répond vide', async () => {
  const modPath = path.join(ROOT, 'src/harness/tools/fix-loop.js');
  const trPath  = path.join(ROOT, 'src/harness/tools/test-runner.js');
  const origTr  = require.cache[require.resolve(trPath)];

  // Mock : tests échouent
  require.cache[require.resolve(trPath)] = {
    id: require.resolve(trPath), filename: require.resolve(trPath), loaded: true,
    exports: { runTests: async () => ({ ok: false, exitCode: 1, stdout: 'FAIL: test1', runner: 'npm' }) },
  };
  delete require.cache[require.resolve(modPath)];

  const { fixLoop: fl } = require(modPath);
  const r = await fl(
    { max_iterations: 1 },
    () => {}, '/project',
    { _llmGenerate: async () => 'no json here' },
  );

  assert.equal(r.ok, false);
  assert.equal(r.error, 'AUCUN_OUTIL_SUGGÉRÉ');

  if (origTr) require.cache[require.resolve(trPath)] = origTr;
  else delete require.cache[require.resolve(trPath)];
  delete require.cache[require.resolve(modPath)];
});

test('fixLoop — LLM_DÉCLARE_NON_CORRIGEABLE si finish dans les outils', async () => {
  const modPath = path.join(ROOT, 'src/harness/tools/fix-loop.js');
  const trPath  = path.join(ROOT, 'src/harness/tools/test-runner.js');
  const origTr  = require.cache[require.resolve(trPath)];

  require.cache[require.resolve(trPath)] = {
    id: require.resolve(trPath), filename: require.resolve(trPath), loaded: true,
    exports: { runTests: async () => ({ ok: false, exitCode: 1, stdout: 'FAIL', runner: 'npm' }) },
  };
  delete require.cache[require.resolve(modPath)];

  const { fixLoop: fl } = require(modPath);
  const r = await fl(
    { max_iterations: 1 },
    () => {}, '/project',
    { _llmGenerate: async () => '{"tool":"finish","args":{"summary":"unfixable"}}' },
  );

  assert.equal(r.ok, false);
  assert.equal(r.error, 'LLM_DÉCLARE_NON_CORRIGEABLE');

  if (origTr) require.cache[require.resolve(trPath)] = origTr;
  else delete require.cache[require.resolve(trPath)];
  delete require.cache[require.resolve(modPath)];
});

// ── 4. Constante ─────────────────────────────────────────────────────────────

test('constante FIX_LOOP', () => {
  const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
  assert.equal(TOOLS.FIX_LOOP, 'fix_loop');
});

// ── 5. Dispatch ──────────────────────────────────────────────────────────────

test('dispatch — case FIX_LOOP présent dans index.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/index.js'), 'utf8');
  assert.ok(src.includes('case TOOLS.FIX_LOOP:'),  'case FIX_LOOP absent');
  assert.ok(src.includes("require('./fix-loop')"), 'import fix-loop absent');
});

// ── 6. Agent ─────────────────────────────────────────────────────────────────

test('agent — description fix_loop dans allToolDefs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes('fix_loop'), 'description fix_loop absente');
  assert.ok(src.includes('enableFixLoop'), 'garde enableFixLoop absente');
});

test('agent — fix_loop ajouté si enableFixLoop:true', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes("config.enableFixLoop") && src.includes("'fix_loop'"), 'push fix_loop absent');
});

// ── 7. Settings HTML ─────────────────────────────────────────────────────────

test('settings.html — toggle sm-enable-fix-loop présent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('sm-enable-fix-loop'), 'id sm-enable-fix-loop absent');
  assert.ok(html.includes('sm-fix-loop-config'),  'id sm-fix-loop-config absent');
  assert.ok(html.includes('sm-fix-loop-max-iter'), 'champ max-iter absent');
});

test('settings.html — sm-fix-loop-config démarre caché (sm-hidden)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('id="sm-fix-loop-config" class="sm-hidden"'),
            'sm-fix-loop-config doit avoir la classe sm-hidden');
});

// ── 8. Settings JS ───────────────────────────────────────────────────────────

test('settings.js — lit enableFixLoop et fixLoopMaxIterations depuis cfg', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('enableFixLoop'),        'enableFixLoop absent');
  assert.ok(src.includes('fixLoopMaxIterations'), 'fixLoopMaxIterations absent');
  assert.ok(src.includes('sm-fix-loop-max-iter'), 'sm-fix-loop-max-iter absent');
});

test('settings.js — helper _smToggleFixLoopConfig défini', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('function _smToggleFixLoopConfig'), '_smToggleFixLoopConfig absent');
  assert.ok(src.includes('sm-fix-loop-config'),              'référence sm-fix-loop-config absente');
});

test('settings.js — handler change persiste enableFixLoop', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes("_autoSave({ enableFixLoop:"), '_autoSave enableFixLoop absent');
});

test('settings.js — handler change persiste fixLoopMaxIterations', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes("_autoSave({ fixLoopMaxIterations:"), '_autoSave fixLoopMaxIterations absent');
});
