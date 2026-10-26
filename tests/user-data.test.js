'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveUserDataDir, APP_DIR_NAME, MARKER_NAME } = require('../src/main/user-data');

function _tmpAppData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('userData — l\'original revendique le dossier historique', (t) => {
  const appData = _tmpAppData(t);
  const projectRoot = path.join(appData, 'HARNESS CODE');
  fs.mkdirSync(projectRoot, { recursive: true });

  const dir = resolveUserDataDir({ appData, projectRoot });

  assert.strictEqual(dir, path.join(appData, APP_DIR_NAME));
  assert.strictEqual(
    fs.readFileSync(path.join(dir, MARKER_NAME), 'utf8').trim(),
    projectRoot
  );
});

test('userData — un doublon déclaré n\'obtient jamais le dossier historique', (t) => {
  const appData = _tmpAppData(t);
  const original = path.join(appData, 'HARNESS CODE');
  const duplicate = path.join(appData, 'HARNESS CODE - Copie');
  fs.mkdirSync(original, { recursive: true });
  fs.mkdirSync(duplicate, { recursive: true });

  // Le doublon démarre en premier : il doit quand même céder l'historique.
  const dupDir = resolveUserDataDir({ appData, projectRoot: duplicate });
  const origDir = resolveUserDataDir({ appData, projectRoot: original });

  assert.notStrictEqual(dupDir, path.join(appData, APP_DIR_NAME));
  assert.strictEqual(origDir, path.join(appData, APP_DIR_NAME));
  assert.notStrictEqual(dupDir, origDir);
});

test('userData — deux projets distincts obtiennent deux dossiers', (t) => {
  const appData = _tmpAppData(t);
  const a = path.join(appData, 'projet-a');
  const b = path.join(appData, 'projet-b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });

  const dirA = resolveUserDataDir({ appData, projectRoot: a });
  const dirB = resolveUserDataDir({ appData, projectRoot: b });

  assert.notStrictEqual(dirA, dirB);
  // Deuxième appel : stable, le marqueur est déjà posé.
  assert.strictEqual(resolveUserDataDir({ appData, projectRoot: b }), dirB);
});
