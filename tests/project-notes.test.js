'use strict';

/**
 * Tests : mémoire persistante inter-sessions (Phase 105 — ADR-026).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-notes-'));
}

function clearModule(rel) {
  const abs = require.resolve(rel);
  delete require.cache[abs];
}

describe('project-notes — store', () => {
  let root;
  let pn;

  beforeEach(() => {
    root = tmpDir();
    clearModule('../src/harness/memory/project-notes.js');
    pn = require('../src/harness/memory/project-notes.js');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('setNote puis getNote retrouve la valeur', () => {
    pn.setNote(root, 'stack', 'Next.js + Prisma', ['tech']);
    const n = pn.getNote(root, 'stack');
    assert.equal(n.key, 'stack');
    assert.equal(n.value, 'Next.js + Prisma');
    assert.deepEqual(n.tags, ['tech']);
  });

  test('setNote écrase une clé existante', () => {
    pn.setNote(root, 'stack', 'v1');
    pn.setNote(root, 'stack', 'v2');
    const n = pn.getNote(root, 'stack');
    assert.equal(n.value, 'v2');
    assert.equal(pn.listNotes(root).filter(x => x.key === 'stack').length, 1);
  });

  test('getNote retourne null si clé absente', () => {
    assert.equal(pn.getNote(root, 'inexistant'), null);
  });

  test('listNotes retourne toutes les notes', () => {
    pn.setNote(root, 'a', '1');
    pn.setNote(root, 'b', '2');
    const all = pn.listNotes(root);
    assert.equal(all.length, 2);
  });

  test('deleteNote supprime la note', () => {
    pn.setNote(root, 'x', 'v');
    const deleted = pn.deleteNote(root, 'x');
    assert.equal(deleted, true);
    assert.equal(pn.getNote(root, 'x'), null);
  });

  test('deleteNote retourne false si clé absente', () => {
    assert.equal(pn.deleteNote(root, 'fantome'), false);
  });

  test('persistance : les notes survivent au rechargement du module', () => {
    pn.setNote(root, 'persist', 'ok');
    clearModule('../src/harness/memory/project-notes.js');
    const pn2 = require('../src/harness/memory/project-notes.js');
    assert.equal(pn2.getNote(root, 'persist').value, 'ok');
  });

  test('retourne liste vide si dossier .harness absent', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-empty-'));
    try {
      assert.deepEqual(pn.listNotes(empty), []);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('project-notes — getRelevantNotes', () => {
  let root;
  let pn;

  beforeEach(() => {
    root = tmpDir();
    clearModule('../src/harness/memory/project-notes.js');
    pn = require('../src/harness/memory/project-notes.js');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('retourne les notes avec overlap de tokens', () => {
    pn.setNote(root, 'auth', 'JWT avec refresh token', ['securite']);
    pn.setNote(root, 'stack', 'React + Express', ['tech']);
    pn.setNote(root, 'port', '3000', ['config']);

    const results = pn.getRelevantNotes(root, 'modifier la page auth JWT', 5);
    assert.ok(results.length > 0);
    assert.equal(results[0].key, 'auth');
  });

  test('retourne [] si aucune note', () => {
    assert.deepEqual(pn.getRelevantNotes(root, 'test', 5), []);
  });

  test('plafonne à maxNotes', () => {
    for (let i = 0; i < 10; i++) pn.setNote(root, `k${i}`, `v${i}`);
    const results = pn.getRelevantNotes(root, 'test task description', 3);
    assert.ok(results.length <= 3);
  });
});

describe('project-notes — notesToContextBlock', () => {
  let pn;

  beforeEach(() => {
    clearModule('../src/harness/memory/project-notes.js');
    pn = require('../src/harness/memory/project-notes.js');
  });

  test('formate correctement', () => {
    const block = pn.notesToContextBlock([
      { key: 'stack', value: 'Next.js' },
      { key: 'port',  value: '3000' },
    ]);
    assert.ok(block.includes('## Mémoire du projet'));
    assert.ok(block.includes('stack : Next.js'));
    assert.ok(block.includes('port : 3000'));
  });

  test('retourne chaîne vide si aucune note', () => {
    assert.equal(pn.notesToContextBlock([]), '');
  });
});

describe('project-notes-tool — dispatch', () => {
  let root;
  let tool;

  beforeEach(() => {
    root = tmpDir();
    clearModule('../src/harness/memory/project-notes.js');
    clearModule('../src/harness/tools/project-notes-tool.js');
    tool = require('../src/harness/tools/project-notes-tool.js').projectNote;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('set → ok', () => {
    const r = tool({ action: 'set', key: 'api', value: '/api/v1' }, null, root);
    assert.equal(r.ok, true);
    assert.equal(r.saved, 'api');
  });

  test('get → retrouve la valeur', () => {
    tool({ action: 'set', key: 'endpoint', value: 'https://x.io' }, null, root);
    const r = tool({ action: 'get', key: 'endpoint' }, null, root);
    assert.equal(r.ok, true);
    assert.equal(r.value, 'https://x.io');
  });

  test('get clé absente → NOTE_INTROUVABLE', () => {
    const r = tool({ action: 'get', key: 'ghost' }, null, root);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'NOTE_INTROUVABLE');
  });

  test('list → retourne count', () => {
    tool({ action: 'set', key: 'a', value: '1' }, null, root);
    tool({ action: 'set', key: 'b', value: '2' }, null, root);
    const r = tool({ action: 'list' }, null, root);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
  });

  test('delete → supprime', () => {
    tool({ action: 'set', key: 'del', value: 'v' }, null, root);
    const r = tool({ action: 'delete', key: 'del' }, null, root);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, true);
  });

  test('search → retourne résultats', () => {
    tool({ action: 'set', key: 'auth', value: 'JWT' }, null, root);
    const r = tool({ action: 'search', task: 'token auth' }, null, root);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.results));
  });

  test('action inconnue → ACTION_INCONNUE', () => {
    const r = tool({ action: 'fly' }, null, root);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'ACTION_INCONNUE');
  });

  test('projectRoot absent → PROJET_NON_DÉFINI', () => {
    const r = tool({ action: 'set', key: 'x', value: 'y' }, null, null);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'PROJET_NON_DÉFINI');
  });

  test('set sans clé → CLE_MANQUANTE', () => {
    const r = tool({ action: 'set', value: 'v' }, null, root);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'CLE_MANQUANTE');
  });

  test('set sans valeur → VALEUR_MANQUANTE', () => {
    const r = tool({ action: 'set', key: 'k' }, null, root);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'VALEUR_MANQUANTE');
  });
});

describe('project-notes — validate.js schema', () => {
  test('validateArgs refuse action manquante', () => {
    clearModule('../src/harness/tools/validate.js');
    const { validateArgs } = require('../src/harness/tools/validate.js');
    const r = validateArgs('project_note', {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('action'));
  });

  test('validateArgs accepte args valides', () => {
    clearModule('../src/harness/tools/validate.js');
    const { validateArgs } = require('../src/harness/tools/validate.js');
    const r = validateArgs('project_note', { action: 'list' });
    assert.equal(r.ok, true);
  });
});

describe('project-notes — families.js CORE', () => {
  test('project_note est dans CORE', () => {
    clearModule('../src/harness/tools/families.js');
    const { CORE } = require('../src/harness/tools/families.js');
    assert.ok(CORE.includes('project_note'));
  });
});

describe('project-notes — constants.js', () => {
  test('PROJECT_NOTE défini', () => {
    clearModule('../src/shared/constants.js');
    const { TOOLS } = require('../src/shared/constants.js');
    assert.equal(TOOLS.PROJECT_NOTE, 'project_note');
  });
});
