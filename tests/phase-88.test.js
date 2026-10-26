/**
 * Phase 88 — Feedback learning
 * Tests : store.js, advisor.js, agent intégration, settings UI
 */

'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const ROOT = path.resolve(__dirname, '..');

// ── 1. store.js — recordFeedback / loadFeedback ───────────────────────────────

test('recordFeedback — crée le fichier si absent', () => {
  const { recordFeedback, loadFeedback, _feedbackPath } = require(path.join(ROOT, 'src/harness/feedback/store.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fb-'));
  recordFeedback({ projectRoot: tmp, path: 'src/foo.js', action: 'write_file', approved: true });
  assert.ok(fs.existsSync(_feedbackPath(tmp)));
  const entries = loadFeedback(tmp);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'src/foo.js');
  assert.equal(entries[0].approved, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('recordFeedback — plusieurs entrées', () => {
  const { recordFeedback, loadFeedback } = require(path.join(ROOT, 'src/harness/feedback/store.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fb-'));
  recordFeedback({ projectRoot: tmp, path: 'a.js', action: 'replace_code', approved: true });
  recordFeedback({ projectRoot: tmp, path: 'b.ts', action: 'write_file',   approved: false });
  recordFeedback({ projectRoot: tmp, path: 'c.js', action: 'replace_code', approved: true });
  const entries = loadFeedback(tmp);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].approved, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('recordFeedback — silencieux si projectRoot vide', () => {
  const { recordFeedback } = require(path.join(ROOT, 'src/harness/feedback/store.js'));
  assert.doesNotThrow(() => recordFeedback({ projectRoot: '', path: 'x.js', approved: true }));
});

test('loadFeedback — retourne [] si fichier absent', () => {
  const { loadFeedback } = require(path.join(ROOT, 'src/harness/feedback/store.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fb-'));
  const entries = loadFeedback(tmp);
  assert.deepEqual(entries, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('loadFeedback — respecte la limite', () => {
  const { recordFeedback, loadFeedback } = require(path.join(ROOT, 'src/harness/feedback/store.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fb-'));
  for (let i = 0; i < 10; i++) {
    recordFeedback({ projectRoot: tmp, path: `f${i}.js`, action: 'write_file', approved: i % 2 === 0 });
  }
  const entries = loadFeedback(tmp, 4);
  assert.equal(entries.length, 4);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── 2. advisor.js — buildFeedbackSummary ─────────────────────────────────────

test('buildFeedbackSummary — retourne "" si moins de 3 entrées', () => {
  const { buildFeedbackSummary } = require(path.join(ROOT, 'src/harness/feedback/advisor.js'));
  assert.equal(buildFeedbackSummary([]), '');
  assert.equal(buildFeedbackSummary([{ path: 'a.js', approved: true }]), '');
  assert.equal(buildFeedbackSummary([{ path: 'a.js', approved: true }, { path: 'b.js', approved: false }]), '');
});

test('buildFeedbackSummary — résumé avec ≥ 3 entrées', () => {
  const { buildFeedbackSummary } = require(path.join(ROOT, 'src/harness/feedback/advisor.js'));
  const entries = [
    { path: 'src/a.js', action: 'replace_code', approved: true },
    { path: 'src/b.js', action: 'write_file',   approved: false },
    { path: 'src/c.ts', action: 'replace_code', approved: true },
    { path: 'src/d.ts', action: 'replace_code', approved: true },
  ];
  const summary = buildFeedbackSummary(entries);
  assert.ok(summary.length > 0, 'résumé vide');
  assert.ok(summary.includes('décisions'), 'mention "décisions" absente');
});

test('buildFeedbackSummary — mentionne action souvent rejetée', () => {
  const { buildFeedbackSummary } = require(path.join(ROOT, 'src/harness/feedback/advisor.js'));
  const entries = [
    { path: 'a.js', action: 'write_file', approved: false },
    { path: 'b.js', action: 'write_file', approved: false },
    { path: 'c.js', action: 'write_file', approved: false },
    { path: 'd.js', action: 'replace_code', approved: true },
    { path: 'e.js', action: 'replace_code', approved: true },
  ];
  const summary = buildFeedbackSummary(entries);
  assert.ok(summary.includes('write_file'), 'action rejetée absente du résumé');
});

test('buildFeedbackSummary — conseil si taux approbation < 60%', () => {
  const { buildFeedbackSummary } = require(path.join(ROOT, 'src/harness/feedback/advisor.js'));
  const entries = Array.from({ length: 10 }, (_, i) => ({
    path: `f${i}.js`, action: 'write_file', approved: i < 3,
  }));
  const summary = buildFeedbackSummary(entries);
  assert.ok(summary.includes('conservateur'), 'conseil conservateur absent');
});

test('buildFeedbackSummary — retourne "" si null/undefined', () => {
  const { buildFeedbackSummary } = require(path.join(ROOT, 'src/harness/feedback/advisor.js'));
  assert.equal(buildFeedbackSummary(null), '');
  assert.equal(buildFeedbackSummary(undefined), '');
});

// ── 3. system.js — injection feedbackSummary ─────────────────────────────────

test('buildSystemPrompt — injecte feedbackSummary si fourni', () => {
  const { buildSystemPrompt } = require(path.join(ROOT, 'src/harness/prompts/system.js'));
  const prompt = buildSystemPrompt([], '', { feedbackSummary: 'TEST_FEEDBACK_SIGNAL' });
  assert.ok(prompt.includes('TEST_FEEDBACK_SIGNAL'), 'feedbackSummary absent du prompt');
  assert.ok(prompt.includes('APPRENTISSAGE'), 'section APPRENTISSAGE absente');
});

test('buildSystemPrompt — pas de section feedback si feedbackSummary vide', () => {
  const { buildSystemPrompt } = require(path.join(ROOT, 'src/harness/prompts/system.js'));
  const prompt = buildSystemPrompt([], '', { feedbackSummary: '' });
  assert.ok(!prompt.includes('APPRENTISSAGE'), 'section APPRENTISSAGE présente sans données');
});

// ── 4. agent.js — imports + enableFeedbackLearning ───────────────────────────

test('agent.js — importe recordFeedback et buildFeedbackSummary', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes('recordFeedback'),       'recordFeedback absent de agent.js');
  assert.ok(src.includes('buildFeedbackSummary'), 'buildFeedbackSummary absent de agent.js');
});

test('agent.js — wrap requestApproval si enableFeedbackLearning', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes('enableFeedbackLearning'), 'enableFeedbackLearning absent');
  assert.ok(src.includes('config.requestApproval'), 'wrap requestApproval absent');
  assert.ok(src.includes('feedbackSummary'),         'feedbackSummary non passé au prompt');
});

// ── 5. Settings HTML ──────────────────────────────────────────────────────────

test('settings.html — toggle sm-enable-feedback-learning présent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('sm-enable-feedback-learning'), 'toggle absent');
  assert.ok(html.includes('Feedback learning'),           'label absent');
});

// ── 6. Settings JS ────────────────────────────────────────────────────────────

test('settings.js — lit et persiste enableFeedbackLearning', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('enableFeedbackLearning'),        'enableFeedbackLearning absent');
  assert.ok(src.includes('sm-enable-feedback-learning'),   'id sm-enable-feedback-learning absent');
  assert.ok(src.includes("_autoSave({ enableFeedbackLearning:"), '_autoSave absent');
});
