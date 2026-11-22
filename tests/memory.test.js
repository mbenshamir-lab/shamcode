const { test, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

// Pointer les sessions vers un dossier temporaire pour les tests
const TMP_DIR = path.join(os.tmpdir(), `harness-test-sessions-${Date.now()}`);
process.env.APPDATA = TMP_DIR;

const { createSession, updateSession, loadSession, listSessions, applyRetention } = require('../src/harness/memory/sessions');
const { createScratchpad } = require('../src/harness/memory/scratchpad');

// ── Sessions ──────────────────────────────────────────────────────────────────

test('sessions — createSession retourne un id et persiste sur disque', () => {
  const { id, path: p, session } = createSession({ task: 'test task', projectRoot: '/tmp/proj' });
  assert.ok(id, 'id présent');
  assert.ok(fs.existsSync(p), 'fichier créé');
  assert.equal(session.task, 'test task');
});

test('sessions — updateSession met à jour le fichier', () => {
  const { path: p } = createSession({ task: 'update test', projectRoot: '/tmp' });
  const updated = updateSession(p, { result: { ok: true, summary: 'done' } });
  assert.deepEqual(updated.result, { ok: true, summary: 'done' });
  const reloaded = loadSession(updated.id);
  assert.equal(reloaded?.result?.summary, 'done');
});

test('sessions — loadSession retourne null pour un id inconnu', () => {
  const s = loadSession('id-qui-nexiste-pas');
  assert.equal(s, null);
});

test('sessions — listSessions retourne les sessions créées', () => {
  createSession({ task: 'list test 1', projectRoot: '/tmp' });
  createSession({ task: 'list test 2', projectRoot: '/tmp' });
  const list = listSessions();
  assert.ok(list.length >= 2, 'au moins 2 sessions');
  assert.ok(list[0].createdAt >= list[1].createdAt, 'ordre décroissant');
});

test('sessions — applyRetention supprime les plus anciennes', () => {
  // Créer 5 sessions supplémentaires puis appliquer rétention à 3
  for (let i = 0; i < 5; i++) createSession({ task: `retention-${i}`, projectRoot: '/tmp' });
  const _before = listSessions().length; // compte avant rétention — non utilisé dans l'assert
  applyRetention(3);
  const after = listSessions().length;
  assert.ok(after <= 3, `rétention appliquée (${after} <= 3)`);
});

// ── Scratchpad ────────────────────────────────────────────────────────────────

test('scratchpad — set/get', () => {
  const pad = createScratchpad();
  pad.set('key', 'value');
  assert.equal(pad.get('key'), 'value');
});

test('scratchpad — append cumule les notes', () => {
  const pad = createScratchpad();
  pad.append('notes', 'line1');
  pad.append('notes', 'line2');
  assert.ok(pad.get('notes').includes('line1'));
  assert.ok(pad.get('notes').includes('line2'));
});

test('scratchpad — toContextBlock produit un bloc lisible', () => {
  const pad = createScratchpad();
  pad.set('fichier', 'src/utils.js');
  const block = pad.toContextBlock();
  assert.ok(block.includes('fichier'));
  assert.ok(block.includes('src/utils.js'));
});

test('scratchpad — toJSON / fromJSON round-trip', () => {
  const pad1 = createScratchpad();
  pad1.set('a', '1');
  pad1.set('b', '2');
  const json = pad1.toJSON();

  const pad2 = createScratchpad();
  pad2.fromJSON(json);
  assert.equal(pad2.get('a'), '1');
  assert.equal(pad2.get('b'), '2');
});

test('scratchpad — get clé absente retourne null', () => {
  const pad = createScratchpad();
  assert.equal(pad.get('absent'), null);
});

test('sessions — disque non inscriptible → session en mémoire, pas d\'exception', () => {
  const blocked = path.join(TMP_DIR, 'fichier-bloquant');
  fs.writeFileSync(blocked, 'x', 'utf8');
  const previous = process.env.HARNESS_DATA_DIR;
  process.env.HARNESS_DATA_DIR = blocked;
  try {
    const r = createSession({ task: 'test', projectRoot: TMP_DIR });
    assert.equal(r.path, null, 'aucune persistance attendue');
    assert.ok(r.session && r.session.steps, 'la session en mémoire doit rester utilisable');
    assert.ok(r.id, 'un id reste disponible pour la trace');
  } finally {
    if (previous === undefined) delete process.env.HARNESS_DATA_DIR;
    else process.env.HARNESS_DATA_DIR = previous;
    fs.rmSync(blocked, { force: true });
  }
});

// Nettoyage
after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignoré */ }
});
