const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { getProjectInfo } = require('../src/harness/tools/project-info');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-projinfo-'));
}

// ── package.json ──────────────────────────────────────────────────────────────

test('getProjectInfo — package.json complet → info node', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'mon-projet',
    version: '1.2.3',
    description: 'Un projet test',
    main: 'src/index.js',
    scripts: { test: 'node --test', start: 'node src/index.js', build: 'tsc' },
    dependencies:    { express: '^4.18.2', lodash: '^4.17.21' },
    devDependencies: { jest: '^29.0.0' },
  }));

  const r = getProjectInfo({}, root);
  assert.ok(r.ok);
  assert.equal(r.info.type,    'node');
  assert.equal(r.info.name,    'mon-projet');
  assert.equal(r.info.version, '1.2.3');
  assert.ok(r.info.scripts.test, 'scripts.test doit être présent');
  assert.ok(r.info.dependencies.includes('express'));
  assert.equal(r.info.dependenciesCount,    2);
  assert.equal(r.info.devDependenciesCount, 1);
});

test('getProjectInfo — package.json minimal (pas de scripts ni deps) → ok', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'minimal' }));

  const r = getProjectInfo({}, root);
  assert.ok(r.ok);
  assert.equal(r.info.name, 'minimal');
  assert.equal(r.info.dependenciesCount, 0);
});

test('getProjectInfo — package.json invalide → erreur PARSE_ERREUR', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), 'PAS DU JSON {{{');

  const r = getProjectInfo({}, root);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PARSE_ERREUR'));
});

// ── Cargo.toml ────────────────────────────────────────────────────────────────

test('getProjectInfo — Cargo.toml → info rust', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'Cargo.toml'), [
    '[package]',
    'name = "my-crate"',
    'version = "0.3.1"',
    'edition = "2021"',
    '',
    '[dependencies]',
    'serde = "1.0"',
    'tokio = { version = "1", features = ["full"] }',
  ].join('\n'));

  const r = getProjectInfo({}, root);
  assert.ok(r.ok);
  assert.equal(r.info.type,    'rust');
  assert.equal(r.info.name,    'my-crate');
  assert.equal(r.info.version, '0.3.1');
  assert.equal(r.info.edition, '2021');
});

// ── go.mod ────────────────────────────────────────────────────────────────────

test('getProjectInfo — go.mod → info go', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'go.mod'), [
    'module github.com/user/myapp',
    '',
    'go 1.21',
    '',
    'require (',
    '    github.com/gin-gonic/gin v1.9.1',
    '    golang.org/x/sync v0.5.0',
    ')',
  ].join('\n'));

  const r = getProjectInfo({}, root);
  assert.ok(r.ok);
  assert.equal(r.info.type,      'go');
  assert.equal(r.info.module,    'github.com/user/myapp');
  assert.equal(r.info.goVersion, '1.21');
  assert.ok(r.info.dependenciesCount >= 2);
});

// ── Python ────────────────────────────────────────────────────────────────────

test('getProjectInfo — requirements.txt → info python', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'requirements.txt'), [
    '# dépendances',
    'flask==2.3.0',
    'requests>=2.28',
    'pydantic',
  ].join('\n'));

  const r = getProjectInfo({}, root);
  assert.ok(r.ok);
  assert.equal(r.info.type, 'python');
  assert.ok(r.info.dependenciesCount >= 3);
});

// ── Cas limites ────────────────────────────────────────────────────────────────

test('getProjectInfo — dossier vide → PROJET_NON_RECONNU', () => {
  const root = tmpDir();
  const r = getProjectInfo({}, root);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PROJET_NON_RECONNU'));
});

test('getProjectInfo — sans projectRoot → GET_PROJECT_INFO_SANS_PROJET', () => {
  const r = getProjectInfo({}, '');
  assert.ok(!r.ok);
  assert.equal(r.error, 'GET_PROJECT_INFO_SANS_PROJET');
});

// ── Projet harness réel ───────────────────────────────────────────────────────

test('getProjectInfo — projet harness réel → lit package.json correct', () => {
  const root = path.resolve(__dirname, '..');
  const r = getProjectInfo({}, root);
  assert.ok(r.ok, `Attendu ok, erreur : ${r.error}`);
  assert.equal(r.info.type,    'node');
  assert.equal(r.info.name,    'code-harness');
  assert.ok(r.info.scripts.test, 'scripts.test doit être présent');
});
