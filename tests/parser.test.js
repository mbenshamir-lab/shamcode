const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractToolCall } = require('../src/harness/parser');

test('extractToolCall — JSON valide direct', () => {
  const r = extractToolCall('{"tool":"read_file","args":{"path":"utils.py"}}');
  assert.equal(r.tool, 'read_file');
  assert.deepEqual(r.args, { path: 'utils.py' });
});

test('extractToolCall — JSON avec fences ```json', () => {
  const r = extractToolCall('Voici ma réponse :\n```json\n{"tool":"list_dir","args":{"path":"src"}}\n```');
  assert.equal(r.tool, 'list_dir');
});

test('extractToolCall — JSON avec fences ``` sans type', () => {
  const r = extractToolCall('```\n{"tool":"finish","args":{"summary":"ok"}}\n```');
  assert.equal(r.tool, 'finish');
});

test('extractToolCall — JSON avec texte avant/après', () => {
  const r = extractToolCall('Je vais lire le fichier. {"tool":"read_file","args":{"path":"a.js"}} Voilà.');
  assert.equal(r.tool, 'read_file');
});

test('extractToolCall — virgules traînantes réparées', () => {
  const r = extractToolCall('{"tool":"write_file","args":{"path":"x.js","content":"hello",},}');
  assert.equal(r.tool, 'write_file');
  assert.equal(r.error, undefined);
});

test('extractToolCall — JSON tronqué → erreur JSON_INVALIDE', () => {
  const r = extractToolCall('{"tool":"read_file","args":{"path"');
  assert.ok(r.error, 'doit retourner une erreur');
  assert.ok(r.error.startsWith('JSON_INVALIDE') || r.error === 'JSON_INTROUVABLE');
});

test('extractToolCall — objet sans "tool" → erreur OUTIL_MANQUANT', () => {
  const r = extractToolCall('{"action":"read","args":{}}');
  assert.equal(r.error, 'OUTIL_MANQUANT');
});

test('extractToolCall — args absent → defaults to {}', () => {
  const r = extractToolCall('{"tool":"list_dir"}');
  assert.deepEqual(r.args, {});
});

test('extractToolCall — chaîne vide → erreur VIDE', () => {
  const r = extractToolCall('');
  assert.equal(r.error, 'VIDE');
});
