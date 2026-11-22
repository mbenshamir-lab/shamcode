'use strict';

// Isolation des données entre copies du projet et entre projets :
// - getDataDir() suit HARNESS_DATA_DIR (fixé par le main après app.setPath) ;
// - les backups sont indexés par chemin absolu, pas par nom de fichier ;
// - la config historique est migrée une seule fois vers le dossier propre.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDataDir } = require('../src/shared/data-dir');
const { snapshot, fileKey } = require('../src/harness/safety/backup');
const { restoreFile } = require('../src/harness/tools/restore');
const { makeGuard } = require('../src/harness/safety/path-guard');
const { migrateLegacyConfig, APP_DIR_NAME } = require('../src/main/user-data');

function tmpDir(prefix = 'harness-data-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('data-dir — HARNESS_DATA_DIR est prioritaire', () => {
  const dir = tmpDir();
  withEnv('HARNESS_DATA_DIR', dir, () => {
    assert.equal(getDataDir(), path.resolve(dir));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('data-dir — repli sur APPDATA/code-harness', () => {
  const appData = tmpDir();
  withEnv('HARNESS_DATA_DIR', undefined, () => {
    withEnv('APPDATA', appData, () => {
      assert.equal(getDataDir(), path.join(appData, APP_DIR_NAME));
    });
  });
  fs.rmSync(appData, { recursive: true, force: true });
});

test('backup — deux projets, même nom de fichier : clés différentes', () => {
  const a = tmpDir('harness-proj-a-');
  const b = tmpDir('harness-proj-b-');
  const fileA = path.join(a, 'app.js');
  const fileB = path.join(b, 'app.js');

  assert.notEqual(fileKey(fileA), fileKey(fileB), 'le chemin absolu doit saler la clé');

  fs.rmSync(a, { recursive: true, force: true });
  fs.rmSync(b, { recursive: true, force: true });
});

test('backup — restore_file ne voit que les backups de son propre projet', () => {
  const appData = tmpDir('harness-appdata-');
  const rootA = tmpDir('harness-root-a-');
  const rootB = tmpDir('harness-root-b-');
  const fileA = path.join(rootA, 'cible.js');
  const fileB = path.join(rootB, 'cible.js');

  fs.writeFileSync(fileA, 'contenu A1', 'utf8');
  fs.writeFileSync(fileB, 'contenu B1', 'utf8');

  withEnv('HARNESS_DATA_DIR', appData, () => {
    assert.ok(snapshot(fileA).ok);
    assert.ok(snapshot(fileB).ok);

    // Modifie A puis liste : un seul backup, celui de A.
    fs.writeFileSync(fileA, 'contenu A2', 'utf8');
    const listA = restoreFile({ path: 'cible.js', list: true }, makeGuard(rootA));
    assert.ok(listA.ok);
    assert.equal(listA.backups.length, 1, 'les backups de B ne doivent pas fuiter dans A');

    const restored = restoreFile({ path: 'cible.js', backup_index: 0 }, makeGuard(rootA));
    assert.ok(restored.ok, restored.error);
    assert.equal(fs.readFileSync(fileA, 'utf8'), 'contenu A1');
    assert.equal(fs.readFileSync(fileB, 'utf8'), 'contenu B1', 'B ne doit pas être touché');
  });

  for (const dir of [appData, rootA, rootB]) fs.rmSync(dir, { recursive: true, force: true });
});

test('backup — rétention appliquée par fichier', () => {
  const appData = tmpDir('harness-appdata-');
  const root = tmpDir('harness-root-');
  const file = path.join(root, 'f.js');
  fs.writeFileSync(file, 'v0', 'utf8');

  withEnv('HARNESS_DATA_DIR', appData, () => {
    for (let i = 0; i < 3; i++) snapshot(file, 2);
    const dir = path.join(appData, 'backups', fileKey(file));
    const entries = fs.readdirSync(dir).filter((e) => fs.statSync(path.join(dir, e)).isDirectory());
    assert.equal(entries.length, 2, 'maxBackups doit borner ce fichier uniquement');
  });

  for (const dir of [appData, root]) fs.rmSync(dir, { recursive: true, force: true });
});

test('user-data — migration de la config historique, une seule fois', () => {
  const appData = tmpDir('harness-mig-');
  const shared = path.join(appData, APP_DIR_NAME);
  const own = path.join(appData, `${APP_DIR_NAME}-deadbeef`);
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'config.json'), '{"projectRoot":"x"}', 'utf8');

  assert.equal(migrateLegacyConfig({ appData, userDataDir: shared }), false, 'dossier partagé : rien à faire');
  assert.equal(migrateLegacyConfig({ appData, userDataDir: own }), true);
  assert.equal(fs.readFileSync(path.join(own, 'config.json'), 'utf8'), '{"projectRoot":"x"}');

  // Deuxième appel : le fichier existe, aucune réécriture.
  fs.writeFileSync(path.join(own, 'config.json'), '{"projectRoot":"y"}', 'utf8');
  assert.equal(migrateLegacyConfig({ appData, userDataDir: own }), false);
  assert.equal(fs.readFileSync(path.join(own, 'config.json'), 'utf8'), '{"projectRoot":"y"}');

  fs.rmSync(appData, { recursive: true, force: true });
});
