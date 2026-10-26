const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { makeGuard } = require('../src/harness/safety/path-guard');
const { snapshot }  = require('../src/harness/safety/backup');
const { diffFile }  = require('../src/harness/tools/diff-file');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-diff-'));
}

// ── cas limites ───────────────────────────────────────────────────────────────

test('diff_file — sans path → DIFF_SANS_CHEMIN', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = diffFile({}, guard);
  assert.ok(!r.ok);
  assert.equal(r.error, 'DIFF_SANS_CHEMIN');
});

test('diff_file — chemin hors projet → erreur PATH_GUARD', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = diffFile({ path: '../../etc/passwd' }, guard);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

test('diff_file — aucun backup → AUCUN_BACKUP_TROUVÉ', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // Fichier avec un nom improbable, aucun backup existant
  const r = diffFile({ path: 'improbable-xyz987.js' }, guard);
  assert.ok(!r.ok);
  assert.ok(
    r.error.includes('AUCUN_BACKUP_TROUVÉ') || r.error.includes('FICHIER_INTROUVABLE'),
    `Attendu AUCUN_BACKUP_TROUVÉ ou FICHIER_INTROUVABLE, reçu : ${r.error}`,
  );
});

// ── diff réel après backup + modification ─────────────────────────────────────

test('diff_file — retourne added/removed corrects après modification', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const absPath  = path.join(root, 'cible.js');
  const original = 'ligne A\nligne B\nligne C\n';
  const modified = 'ligne A\nligne X\nligne C\nligne D\n';

  fs.writeFileSync(absPath, original);
  snapshot(absPath);           // crée le backup de l'original
  fs.writeFileSync(absPath, modified);  // modifie le fichier

  const r = diffFile({ path: 'cible.js' }, guard);
  assert.ok(r.ok, `diffFile a échoué : ${r.error}`);
  assert.ok(typeof r.added   === 'number');
  assert.ok(typeof r.removed === 'number');
  // "ligne B" supprimée, "ligne X" + "ligne D" ajoutées
  assert.ok(r.removed >= 1, `Attendu ≥1 suppression, reçu ${r.removed}`);
  assert.ok(r.added   >= 1, `Attendu ≥1 ajout,       reçu ${r.added}`);
  assert.ok(Array.isArray(r.diff_lines));
  assert.ok(r.diff_lines.length > 0);
  // Au moins une ligne marquée '+' et une '-'
  assert.ok(r.diff_lines.some(d => d.type === '+'), 'Doit avoir au moins une ligne +');
  assert.ok(r.diff_lines.some(d => d.type === '-'), 'Doit avoir au moins une ligne -');
  assert.ok(typeof r.backup_from === 'string', 'backup_from doit être un timestamp string');
});

test('diff_file — fichier identique → 0 added, 0 removed', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const absPath = path.join(root, 'identique.js');
  const content = 'function hello() { return 42; }\n';

  fs.writeFileSync(absPath, content);
  snapshot(absPath);
  // Pas de modification → fichier identique au backup

  const r = diffFile({ path: 'identique.js' }, guard);
  assert.ok(r.ok, `diffFile a échoué : ${r.error}`);
  assert.equal(r.added,   0, 'Aucun ajout attendu');
  assert.equal(r.removed, 0, 'Aucune suppression attendue');
});
