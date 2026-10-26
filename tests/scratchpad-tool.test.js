const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createScratchpad } = require('../src/harness/memory/scratchpad');
const { useScratchpad }    = require('../src/harness/tools/scratchpad-tool');

// ── cas limites ───────────────────────────────────────────────────────────────

test('scratchpad — sans scratchpad → SCRATCHPAD_NON_DISPONIBLE', () => {
  const r = useScratchpad({ action: 'get', key: 'x' }, null);
  assert.ok(!r.ok);
  assert.equal(r.error, 'SCRATCHPAD_NON_DISPONIBLE');
});

test('scratchpad — action inconnue → ACTION_INCONNUE', () => {
  const sp = createScratchpad();
  const r = useScratchpad({ action: 'zap' }, sp);
  assert.ok(!r.ok);
  assert.equal(r.error, 'ACTION_INCONNUE');
});

test('scratchpad — set sans clé → SCRATCHPAD_SANS_CLE', () => {
  const sp = createScratchpad();
  const r = useScratchpad({ action: 'set', value: 'hello' }, sp);
  assert.ok(!r.ok);
  assert.equal(r.error, 'SCRATCHPAD_SANS_CLE');
});

test('scratchpad — get sans clé → SCRATCHPAD_SANS_CLE', () => {
  const sp = createScratchpad();
  const r = useScratchpad({ action: 'get' }, sp);
  assert.ok(!r.ok);
  assert.equal(r.error, 'SCRATCHPAD_SANS_CLE');
});

// ── opérations normales ───────────────────────────────────────────────────────

test('scratchpad — set/get round-trip', () => {
  const sp = createScratchpad();
  const setR = useScratchpad({ action: 'set', key: 'note', value: 'bonjour' }, sp);
  assert.ok(setR.ok);
  assert.equal(setR.set, 'note');

  const getR = useScratchpad({ action: 'get', key: 'note' }, sp);
  assert.ok(getR.ok);
  assert.equal(getR.value, 'bonjour');
});

test('scratchpad — append cumule + list affiche les entrées', () => {
  const sp = createScratchpad();
  useScratchpad({ action: 'set',    key: 'log', value: 'ligne1' }, sp);
  useScratchpad({ action: 'append', key: 'log', value: '\nligne2' }, sp);

  const getR = useScratchpad({ action: 'get', key: 'log' }, sp);
  assert.ok(getR.ok);
  assert.ok(getR.value.includes('ligne2'), 'append doit avoir cumulé');

  const listR = useScratchpad({ action: 'list' }, sp);
  assert.ok(listR.ok);
  assert.ok(Array.isArray(listR.entries));
  assert.ok(listR.entries.some(e => e.key === 'log'), 'log doit apparaître dans la liste');
});

test('scratchpad — get clé absente retourne null', () => {
  const sp = createScratchpad();
  const r = useScratchpad({ action: 'get', key: 'absent' }, sp);
  assert.ok(r.ok);
  assert.equal(r.value, null);
});
