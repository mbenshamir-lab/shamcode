const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { makeGuard }   = require('../src/harness/safety/path-guard');
const { batchReplace } = require('../src/harness/tools/batch-replace');

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-batch-'));
  // Quelques fichiers de test
  fs.writeFileSync(path.join(d, 'a.js'),   'const foo = 1;\nconst bar = foo + 1;\n');
  fs.writeFileSync(path.join(d, 'b.js'),   'function foo() { return 42; }\n');
  fs.writeFileSync(path.join(d, 'c.txt'),  'foo est une variable\n');
  fs.writeFileSync(path.join(d, 'd.json'), '{ "name": "foo" }\n');
  return d;
}

// ── cas limites ───────────────────────────────────────────────────────────────

test('batch_replace — pattern manquant → PATTERN_MANQUANT', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = batchReplace({}, guard, root);
  assert.ok(!r.ok);
  assert.equal(r.error, 'PATTERN_MANQUANT');
});

test('batch_replace — regex invalide → REGEX_INVALIDE', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = batchReplace({ pattern: '(unclosed' }, guard, root);
  assert.ok(!r.ok);
  assert.ok(r.error.startsWith('REGEX_INVALIDE'), `Attendu REGEX_INVALIDE, reçu : ${r.error}`);
});

test('batch_replace — 0 match → results vide', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = batchReplace({ pattern: 'INEXISTANT_xyz987' }, guard, root);
  assert.ok(r.ok);
  assert.equal(r.files_matched, 0);
  assert.equal(r.total_replacements, 0);
  assert.equal(r.results.length, 0);
});

// ── dry_run ───────────────────────────────────────────────────────────────────

test('batch_replace — dry_run:true liste les fichiers sans les modifier', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const before = fs.readFileSync(path.join(root, 'a.js'), 'utf8');

  const r = batchReplace({ pattern: 'foo', replacement: 'bar', dry_run: true }, guard, root);
  assert.ok(r.ok, `Erreur inattendue : ${r.error}`);
  assert.equal(r.dry_run, true);
  assert.equal(r.files_modified, 0, 'dry_run ne doit pas modifier de fichiers');
  assert.ok(r.files_matched >= 1, 'Doit détecter au moins un fichier avec "foo"');
  assert.ok(r.total_replacements >= 1);

  // Les fichiers ne doivent pas avoir changé
  const after = fs.readFileSync(path.join(root, 'a.js'), 'utf8');
  assert.equal(after, before, 'Le fichier a.js ne doit pas avoir été modifié en dry_run');
});

// ── remplacement réel ─────────────────────────────────────────────────────────

test('batch_replace — remplace dans plusieurs fichiers .js', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const r = batchReplace({ pattern: 'foo', replacement: 'baz', ext: '.js' }, guard, root);
  assert.ok(r.ok, `Erreur inattendue : ${r.error}`);
  assert.ok(r.files_modified >= 2, `Attendu ≥2 fichiers modifiés, reçu ${r.files_modified}`);
  assert.ok(r.total_replacements >= 3, `Attendu ≥3 remplacements (foo dans a.js + b.js)`);

  // Vérifier le contenu des fichiers modifiés
  const aContent = fs.readFileSync(path.join(root, 'a.js'), 'utf8');
  assert.ok(aContent.includes('baz'), 'a.js doit contenir "baz" après remplacement');
  assert.ok(!aContent.includes('foo'), 'a.js ne doit plus contenir "foo"');

  // c.txt ne doit pas avoir été touché (filtre ext .js)
  const cContent = fs.readFileSync(path.join(root, 'c.txt'), 'utf8');
  assert.ok(cContent.includes('foo'), 'c.txt ne doit pas être modifié (ext != .js)');
});

test('batch_replace — results contient le chemin relatif et le count', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const r = batchReplace({ pattern: 'foo', replacement: 'qux', ext: '.js' }, guard, root);
  assert.ok(r.ok);
  for (const item of r.results) {
    assert.ok(typeof item.path === 'string', 'path doit être une string');
    assert.ok(!path.isAbsolute(item.path), `chemin absolu détecté : ${item.path}`);
    assert.ok(item.count >= 1, 'count doit être ≥1');
  }
});
