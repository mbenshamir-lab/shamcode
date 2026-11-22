'use strict';

// Politique de prompt selon le moteur (ADR-033) : le cloud garde le prompt complet,
// le local reçoit un prompt/contexte/historique plus courts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveModelPolicy } = require('../src/harness/prompts/model-policy');
const { buildSystemPrompt } = require('../src/harness/prompts/system');

const APP = fs.readFileSync(path.join(__dirname, '../src/harness/agent.js'), 'utf8');

test('model-policy — cloud : prompt complet, aucun rabotage', () => {
  const p = resolveModelPolicy({ engine: 'gemini', model: 'gemini-3.5-flash' });
  assert.equal(p.id, 'cloud');
  assert.equal(p.profile, 'standard');
  assert.equal(p.ragTopK, 5);
  assert.equal(p.agentsMaxChars, 4000);
  assert.equal(p.historyKeepPairs, 10);
  assert.equal(p.maxTokens, 4096);
});

test('model-policy — local 1.5B/3B : profil minimal et budget réduit', () => {
  const p = resolveModelPolicy({ engine: 'webllm', model: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC' });
  assert.equal(p.id, 'local-small');
  assert.equal(p.profile, 'minimal');
  assert.equal(p.ragTopK, 3);
  assert.equal(p.agentsMaxChars, 2000);
  assert.equal(p.historyKeepPairs, 6);
  assert.equal(p.maxTokens, 1024);
});

test('model-policy — local 7B : prompt minimal mais budget local', () => {
  const p = resolveModelPolicy({ engine: 'cpu', model: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' });
  assert.equal(p.id, 'local');
  assert.equal(p.profile, 'minimal');
  assert.equal(p.ragTopK, 4);
  assert.equal(p.maxTokens, 2048);
});

test('model-policy — l\'échappatoire explicite reste respectée sur le cloud', () => {
  const p = resolveModelPolicy({ engine: 'claude', model: 'claude-haiku-4-5', explicit: 'minimal' });
  assert.equal(p.profile, 'minimal');
  assert.equal(p.id, 'cloud', 'le budget cloud ne doit pas être réduit pour autant');
  assert.equal(p.maxTokens, 4096);
});

test('model-policy — le prompt minimal est plus court que le standard', () => {
  const tools = ['read_file', 'write_file', 'replace_code', 'run_tests', 'finish', 'plan', 'goal'];
  const standard = buildSystemPrompt(tools, '', { profile: 'standard', autonomyLevel: 'assisted' });
  const minimal  = buildSystemPrompt(tools, '', { profile: 'minimal',  autonomyLevel: 'assisted' });
  assert.ok(minimal.length < standard.length, `${minimal.length} vs ${standard.length}`);
});

test('model-policy — l\'agent applique la politique (RAG, AGENTS, historique, maxTokens)', () => {
  for (const marker of [
    'resolveModelPolicy',
    'topK: modelPolicy.ragTopK',
    'modelPolicy.agentsMaxChars',
    'modelPolicy.historyKeepPairs',
    'maxTokens:   modelPolicy.maxTokens',
  ]) {
    assert.ok(APP.includes(marker), `${marker} absent de agent.js`);
  }
});
