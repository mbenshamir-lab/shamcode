'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// ── Extraire les fonctions pures depuis agent.js ──────────────────────────────
const agentSrc = require('fs').readFileSync(
  path.join(__dirname, '../src/harness/agent.js'), 'utf8'
);

// _windowMessages (signature étendue : (messages, stateBlock, opts))
const wmMatch = agentSrc.match(/function _windowMessages\(messages, stateBlock = '', opts = \{\}\) \{([\s\S]*?)\n\}/);
assert.ok(wmMatch, '_windowMessages introuvable');

// _windowTailStart (signature étendue : (msgCount, opts))
const wtMatch = agentSrc.match(/function _windowTailStart\(msgCount, opts = \{\}\) \{([\s\S]*?)\n\}/);
assert.ok(wtMatch, '_windowTailStart introuvable');

const WINDOW_KEEP_PAIRS = 10;
const WINDOW_THRESHOLD  = 26;

const moduleCode = `
  const WINDOW_KEEP_PAIRS = ${WINDOW_KEEP_PAIRS};
  const WINDOW_THRESHOLD  = ${WINDOW_THRESHOLD};

  function _windowMessages(messages, stateBlock = '', opts = {}) { ${wmMatch[1]} }
  function _windowTailStart(msgCount, opts = {}) { ${wtMatch[1]} }

  module.exports = { _windowMessages, _windowTailStart };
`;
const m = new module.constructor();
m._compile(moduleCode, 'agent-fns.js');
const { _windowMessages, _windowTailStart } = m.exports;

// ── Fix 1 : _windowMessages injecte une note quand la fenêtre est active ──────
describe('_windowMessages — note de troncature', () => {

  it('ne modifie pas si messages ≤ WINDOW_THRESHOLD', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    const out  = _windowMessages(msgs);
    assert.equal(out.length, msgs.length, 'aucun changement');
    assert.ok(!out.some(m => m.content?.includes('Note système')), 'pas de note');
  });

  it('injecte une note quand messages > WINDOW_THRESHOLD', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    const out  = _windowMessages(msgs);
    assert.ok(out.some(m => m.content?.includes('Note système')), 'note présente');
  });

  it('conserve head (2 premiers) + note + tail (20 derniers)', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    const out  = _windowMessages(msgs);
    assert.equal(out[0].content, 'msg0', 'premier message conservé');
    assert.equal(out[1].content, 'msg1', 'deuxième message conservé');
    // tail = 20 derniers = msg10 à msg29
    const tail = out.filter(m => !m.content?.includes('Note système')).slice(2);
    assert.equal(tail[0].content, 'msg10', 'début de la tail correct');
    assert.equal(tail[tail.length - 1].content, 'msg29', 'fin de la tail correcte');
  });

  it('porte l\'état de tâche dans la note quand il est fourni', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    const state = 'ÉTAT DE LA TÂCHE\nFichiers lus : src/a.js';
    const out = _windowMessages(msgs, state);
    const note = out.find(m => m.content?.includes('Note système'));
    assert.ok(note, 'note présente');
    assert.ok(note.content.includes('ÉTAT DE LA TÂCHE'), 'état injecté dans la note');
    assert.ok(note.content.includes('src/a.js'), 'contenu de l\'état conservé');
  });

});

// ── Fix 1 : _windowTailStart — calcul correct ─────────────────────────────────
describe('_windowTailStart', () => {

  it('retourne 0 si messages ≤ WINDOW_THRESHOLD', () => {
    assert.equal(_windowTailStart(20), 0);
    assert.equal(_windowTailStart(26), 0);
  });

  it('retourne une valeur > 0 si messages > WINDOW_THRESHOLD', () => {
    const start = _windowTailStart(30);
    assert.ok(start > 0, `doit être > 0 (got ${start})`);
  });

  it('étapes cachées à tailStart sont considérées expirées', () => {
    // 30 messages → tailStart = (30 - 2 - 20) / 2 = 4
    const tailStart = _windowTailStart(30);
    assert.equal(tailStart, 4, 'tailStart = 4');
    // Une lecture à l'étape 3 < 4 → expirée
    assert.ok(3 <= tailStart, 'étape 3 expirée');
    // Une lecture à l'étape 5 > 4 → encore dans la fenêtre
    assert.ok(5 > tailStart, 'étape 5 encore présente');
  });

});

// ── Fix 2 : invalidation batch_replace dans agent.js ─────────────────────────
describe('batch_replace invalide _readCache — présence dans agent.js', () => {

  it('clear() du cache est appelé après BATCH_REPLACE', () => {
    assert.ok(
      agentSrc.includes('TOOLS.BATCH_REPLACE') && agentSrc.includes('_readCache.clear()'),
      'batch_replace doit vider le cache'
    );
  });

});

// ── Fix 3 : BLOC_INTROUVABLE hint contextuel ───────────────────────────────────
const fsSrc = require('fs').readFileSync(
  path.join(__dirname, '../src/harness/tools/fs.js'), 'utf8'
);

describe('BLOC_INTROUVABLE — hint contextuel', () => {

  it('le hint cherche la première ligne de old_string (code présent)', () => {
    assert.ok(
      fsSrc.includes('firstLine') && fsSrc.includes('matchIdx'),
      'logique de recherche de firstLine absente de fs.js'
    );
  });

  it('retourne un hint basé sur la zone détectée si matchIdx >= 0', () => {
    assert.ok(
      fsSrc.includes('zone détectée'),
      'message "zone détectée" absent'
    );
  });

  it('fallback sur 20 premières lignes si aucune ligne trouvée', () => {
    assert.ok(
      fsSrc.includes('Début du fichier (20 lignes)'),
      'fallback 20 lignes absent'
    );
  });

});

// ── Fix 4 : RAG store flush() ─────────────────────────────────────────────────
const storeSrc = require('fs').readFileSync(
  path.join(__dirname, '../src/harness/rag/store.js'), 'utf8'
);

describe('RAG store — flush() séparé de upsert()', () => {

  it('upsert() ne contient plus save() comme appel effectif', () => {
    // Extraire le corps de upsert sans les commentaires
    const upsertMatch = storeSrc.match(/upsert\(entry\) \{([\s\S]*?)\},/);
    assert.ok(upsertMatch, 'upsert introuvable');
    // Supprimer les commentaires avant de chercher save()
    const bodyNoComments = upsertMatch[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!bodyNoComments.includes('save()'), 'save() ne doit pas être appelé dans upsert()');
  });

  it('flush() existe et appelle save()', () => {
    assert.ok(storeSrc.includes('flush()'), 'flush() absent du store');
    const flushMatch = storeSrc.match(/flush\(\) \{([\s\S]*?)\},/);
    assert.ok(flushMatch, 'flush() introuvable');
    assert.ok(flushMatch[1].includes('save()'), 'flush() doit appeler save()');
  });

  it('agent.js appelle ragStore.flush() après indexProject', () => {
    assert.ok(
      agentSrc.includes('ragStore.flush()'),
      'ragStore.flush() absent de agent.js'
    );
  });

});
