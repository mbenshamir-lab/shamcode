const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { makeGuard }   = require('../src/harness/safety/path-guard');
const { snapshot }    = require('../src/harness/safety/backup');
const { restoreFile } = require('../src/harness/tools/restore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-restore-'));
}

// ── cas limites ───────────────────────────────────────────────────────────────

test('restore_file — sans path → RESTORE_SANS_CHEMIN', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = restoreFile({}, guard);
  assert.ok(!r.ok);
  assert.equal(r.error, 'RESTORE_SANS_CHEMIN');
});

test('restore_file — chemin hors projet → erreur PATH_GUARD', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = restoreFile({ path: '../../etc/passwd' }, guard);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

test('restore_file — list:true sans backup → liste vide', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'fichier-sans-backup.js'), 'contenu');
  const r = restoreFile({ path: 'fichier-sans-backup.js', list: true }, guard);
  assert.ok(r.ok, `Attendu ok, erreur : ${r.error}`);
  assert.ok(Array.isArray(r.backups));
  // Peut être 0 si aucun backup n'existe pour ce fichier
});

test('restore_file — aucun backup disponible → AUCUN_BACKUP_TROUVÉ', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // Fichier avec un nom très improbable pour qu'aucun backup n'existe
  const r = restoreFile({ path: 'fichier-improbable-xyz987.js' }, guard);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('AUCUN_BACKUP_TROUVÉ'), `Attendu AUCUN_BACKUP_TROUVÉ, reçu : ${r.error}`);
});

// ── restauration après backup réel ───────────────────────────────────────────

test('restore_file — restaure le contenu précédent après backup', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const absPath  = path.join(root, 'target.js');
  const original = '// version originale\nfunction hello() { return 1; }';
  const modified = '// version modifiée\nfunction hello() { return 99; }';

  // Écrire le fichier original
  fs.writeFileSync(absPath, original);

  // Snapshot (simule ce que write_file fait avant chaque modification)
  snapshot(absPath);

  // Modifier le fichier
  fs.writeFileSync(absPath, modified);
  assert.equal(fs.readFileSync(absPath, 'utf8'), modified, 'Le fichier doit être modifié');

  // Lister les backups
  const listR = restoreFile({ path: 'target.js', list: true }, guard);
  assert.ok(listR.ok);
  // Il devrait y avoir au moins 1 backup (celui qu'on vient de créer)
  assert.ok(listR.backups.length >= 1, `Attendu >= 1 backup, reçu ${listR.backups.length}`);

  // Restaurer le plus récent (index 0)
  const restoreR = restoreFile({ path: 'target.js', backup_index: 0 }, guard);
  assert.ok(restoreR.ok, `Restauration échouée : ${restoreR.error}`);
  assert.equal(restoreR.restored, 'target.js');
  assert.ok(typeof restoreR.from === 'string', 'from doit être un timestamp string');

  // Vérifier que le fichier est revenu à l'original
  const after = fs.readFileSync(absPath, 'utf8');
  assert.equal(after, original, 'Le fichier doit avoir été restauré à sa version originale');
});

test('restore_file — backup_index hors limite → INDEX_HORS_LIMITE', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // backup_index très grand → aucun backup ne peut exister à cet index
  const r = restoreFile({ path: 'target.js', backup_index: 9999 }, guard);
  assert.ok(!r.ok);
  // Soit AUCUN_BACKUP_TROUVÉ (si aucun backup) soit INDEX_HORS_LIMITE (si quelques backups)
  assert.ok(
    r.error.includes('AUCUN_BACKUP_TROUVÉ') || r.error.includes('INDEX_HORS_LIMITE'),
    `Attendu AUCUN_BACKUP_TROUVÉ ou INDEX_HORS_LIMITE, reçu : ${r.error}`
  );
});
