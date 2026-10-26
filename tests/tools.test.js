const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { makeGuard } = require('../src/harness/safety/path-guard');
const { readFile, writeFile, replaceCode, listDir, deleteFile, moveFile } = require('../src/harness/tools/fs');
const { findSymbol } = require('../src/harness/tools/symbols-search');

// Dossier temporaire isolé pour les tests
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  return d;
}

// ── path-guard ───────────────────────────────────────────────────────────────

test('path-guard — refuse chemin hors projet', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  assert.throws(() => guard('../../etc/passwd'), /PATH_GUARD/);
});

test('path-guard — accepte chemin dans le projet', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const abs   = guard('src/main.js');
  assert.ok(abs.startsWith(root));
});

// ── path-guard : traversal hostiles ──────────────────────────────────────────

test('path-guard — refuse chemin absolu Windows hors projet', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // Un chemin absolu Windows pointe toujours hors du projectRoot temporaire
  assert.throws(() => guard('C:\\Windows\\System32\\config'), /PATH_GUARD/);
});

test('path-guard — refuse chemin absolu Linux hors projet', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  assert.throws(() => guard('/etc/passwd'), /PATH_GUARD/);
});

test('path-guard — refuse séquence ../ mixte slash-backslash', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  assert.throws(() => guard('..\\..\\..\\outside'), /PATH_GUARD/);
});

test('path-guard — refuse chemin avec point-point imbriqué', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  assert.throws(() => guard('./src/../../../outside'), /PATH_GUARD/);
});

test('path-guard — refuse tentative de sortie via sous-dossier', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // Crée un sous-dossier réel pour s'assurer que le guard remonte bien
  fs.mkdirSync(path.join(root, 'src'));
  assert.throws(() => guard('src/../../../../../../etc/shadow'), /PATH_GUARD/);
});

test('path-guard — refuse chemin vide (chaîne vide résout vers root, pas un fichier)', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // '' résout vers root lui-même — le guard doit l'accepter (c'est le root, pas hors)
  // mais une séquence qui remonte d'un cran depuis root doit être refusée
  assert.throws(() => guard('..'), /PATH_GUARD/);
});

test('path-guard — accepte chemin avec sous-dossiers profonds dans le projet', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const abs   = guard('a/b/c/d/file.js');
  assert.ok(abs.startsWith(root));
  assert.ok(abs.includes('file.js'));
});

test('path-guard — write_file rejette un chemin traversal hostile', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = await writeFile(
    { path: '../../hors-projet.txt', content: 'injection' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

test('path-guard — read_file rejette un chemin traversal hostile', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = readFile({ path: '../../hors-projet.txt' }, guard);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

test('path-guard — replace_code rejette un chemin traversal hostile', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = await replaceCode(
    { path: '../../../etc/passwd', old_string: 'root', new_string: 'hacked' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

// ── readFile ─────────────────────────────────────────────────────────────────

test('read_file — fichier existant → contenu', () => {
  const root = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'hello.txt'), 'contenu', 'utf8');

  const r = readFile({ path: 'hello.txt' }, guard);
  assert.ok(r.ok);
  assert.equal(r.content, 'contenu');
});

test('read_file — fichier inexistant → erreur', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r     = readFile({ path: 'absent.txt' }, guard);
  assert.ok(!r.ok);
});

test('read_file — plage de lignes start_line..end_line', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'multi.txt'), 'ligne1\nligne2\nligne3\nligne4\nligne5', 'utf8');

  const r = readFile({ path: 'multi.txt', start_line: 2, end_line: 4 }, guard);
  assert.ok(r.ok, r.error);
  assert.ok(r.content.includes('ligne2'));
  assert.ok(r.content.includes('ligne4'));
  assert.ok(!r.content.includes('ligne1'), 'ligne1 hors plage');
  assert.ok(!r.content.includes('ligne5'), 'ligne5 hors plage');
  assert.equal(r.total_lines, 5);
  assert.equal(r.start_line, 2);
  assert.equal(r.end_line, 4);
});

test('read_file — start_line hors limite → erreur', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'court.txt'), 'une seule ligne', 'utf8');

  const r = readFile({ path: 'court.txt', start_line: 99 }, guard);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('START_LINE_HORS_LIMITE'));
});

test('read_file — total_lines retourné même sans plage', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'abc.txt'), 'a\nb\nc', 'utf8');

  const r = readFile({ path: 'abc.txt' }, guard);
  assert.ok(r.ok);
  assert.equal(r.total_lines, 3);
});

// ── writeFile ────────────────────────────────────────────────────────────────

test('write_file — crée le fichier et les dossiers parents', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r     = await writeFile({ path: 'sub/dir/new.txt', content: 'hello' }, guard, { backupBeforeWrite: false });

  assert.ok(r.ok);
  const content = fs.readFileSync(path.join(root, 'sub', 'dir', 'new.txt'), 'utf8');
  assert.equal(content, 'hello');
});

// ── replaceCode ──────────────────────────────────────────────────────────────

test('replace_code — bloc unique → OK', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'f.js'), 'function foo() { return 1; }', 'utf8');

  const r = await replaceCode(
    { path: 'f.js', old_string: 'return 1;', new_string: 'return 42;' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(r.ok);
  const updated = fs.readFileSync(path.join(root, 'f.js'), 'utf8');
  assert.ok(updated.includes('return 42;'));
});

test('replace_code — bloc absent → BLOC_INTROUVABLE', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'f.js'), 'function foo() {}', 'utf8');

  const r = await replaceCode(
    { path: 'f.js', old_string: 'inexistant', new_string: 'nouveau' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(!r.ok);
  assert.equal(r.error, 'BLOC_INTROUVABLE');
  // Le hint doit contenir le début du fichier pour aider le LLM à corriger son old_string
  assert.ok(r.hint, 'hint doit être présent sur BLOC_INTROUVABLE');
  assert.ok(r.hint.includes('function foo'), 'hint doit contenir le contenu du fichier');
});

test('replace_code — bloc ambigu → BLOC_AMBIGU', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'f.js'), 'x = 1; x = 1;', 'utf8');

  const r = await replaceCode(
    { path: 'f.js', old_string: 'x = 1;', new_string: 'x = 2;' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(!r.ok);
  assert.equal(r.error, 'BLOC_AMBIGU');
});

test('replace_code — fuzzy : espaces de fin de ligne → OK', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'f.js'), 'function foo() {   \n  return 1;   \n}', 'utf8');

  const r = await replaceCode(
    { path: 'f.js', old_string: 'function foo() {\n  return 1;\n}', new_string: 'function foo() {\n  return 42;\n}' },
    guard,
    { backupBeforeWrite: false },
  );
  assert.ok(r.ok);
  assert.ok(r.fuzzy === true, 'doit signaler le mode fuzzy');
  const updated = fs.readFileSync(path.join(root, 'f.js'), 'utf8');
  assert.ok(updated.includes('return 42;'));
});

// ── harnessignore ────────────────────────────────────────────────────────────

const { loadHarnessIgnore } = require('../src/harness/safety/harnessignore');

test('harnessignore — fichier absent → rien ignoré', () => {
  const root = tmpDir();
  const ignore = loadHarnessIgnore(root);
  assert.ok(!ignore.loaded);
  assert.ok(!ignore.isIgnored('src/main.js'));
});

test('harnessignore — pattern exact bloque read_file', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.harnessignore'), 'secret.env\n');
  fs.writeFileSync(path.join(root, 'secret.env'), 'KEY=123');
  const guard = makeGuard(root);
  const r = readFile({ path: 'secret.env' }, guard, root);
  assert.ok(!r.ok);
  assert.ok(r.error.includes('FICHIER_IGNORÉ'));
});

test('harnessignore — pattern *.env bloque les fichiers .env', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.harnessignore'), '*.env\n');
  const ignore = loadHarnessIgnore(root);
  assert.ok(ignore.isIgnored('production.env'));
  assert.ok(ignore.isIgnored('src/local.env'));
  assert.ok(!ignore.isIgnored('src/main.js'));
});

test('harnessignore — pattern dossier/ bloque tout le sous-arbre', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.harnessignore'), 'private/\n');
  const ignore = loadHarnessIgnore(root);
  assert.ok(ignore.isIgnored('private/keys.json'));
  assert.ok(ignore.isIgnored('private/nested/secret.txt'));
  assert.ok(!ignore.isIgnored('public/index.html'));
});

test('harnessignore — list_dir masque les entrées ignorées', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.harnessignore'), 'secret.key\n');
  fs.writeFileSync(path.join(root, 'main.js'), '');
  fs.writeFileSync(path.join(root, 'secret.key'), '');
  const guard = makeGuard(root);
  const r = listDir({ path: '.' }, guard, root);
  assert.ok(r.ok);
  assert.ok(r.items.some(i => i.name === 'main.js'));
  assert.ok(!r.items.some(i => i.name === 'secret.key'), 'secret.key doit être masqué');
});

// ── listDir ──────────────────────────────────────────────────────────────────

test('list_dir — dossier existant → items', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  fs.mkdirSync(path.join(root, 'sub'));

  const r = listDir({ path: '.' }, guard);
  assert.ok(r.ok);
  assert.ok(r.items.some(i => i.name === 'a.txt' && i.type === 'file'));
  assert.ok(r.items.some(i => i.name === 'sub'   && i.type === 'dir'));
});

test('list_dir — recursive:true liste récursivement', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'deep.js'), 'code');
  fs.writeFileSync(path.join(root, 'top.txt'), '');

  const r = listDir({ path: '.', recursive: true, depth: 3 }, guard);
  assert.ok(r.ok);
  assert.ok(r.recursive);
  assert.ok(r.items.some(i => i.path.includes('deep.js') && i.type === 'file'));
  assert.ok(r.items.some(i => i.path.includes('top.txt') && i.type === 'file'));
});

test('list_dir — recursive respecte la profondeur maximale', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  // Crée sub/level2/level3/level4/deep.txt
  const deep = path.join(root, 'sub', 'level2', 'level3', 'level4');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'deep.txt'), '');

  // depth:2 — level4/deep.txt ne doit pas apparaître
  const r = listDir({ path: '.', recursive: true, depth: 2 }, guard);
  assert.ok(r.ok);
  assert.ok(!r.items.some(i => i.path.includes('deep.txt')), 'deep.txt trop profond pour depth:2');
});

// ── deleteFile ────────────────────────────────────────────────────────────────

test('delete_file — supprime le fichier existant', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'cible.txt'), 'contenu à supprimer');

  const r = await deleteFile({ path: 'cible.txt' }, guard, { backupBeforeWrite: false });
  assert.ok(r.ok);
  assert.equal(r.deleted, 'cible.txt');
  assert.ok(!fs.existsSync(path.join(root, 'cible.txt')), 'Le fichier doit être supprimé');
});

test('delete_file — fichier inexistant → FICHIER_INTROUVABLE', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const r = await deleteFile({ path: 'absent.txt' }, guard, { backupBeforeWrite: false });
  assert.ok(!r.ok);
  assert.equal(r.error, 'FICHIER_INTROUVABLE');
});

test('delete_file — rejeté par utilisateur → fichier intact', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'garde.txt'), 'ne pas supprimer');

  const config = {
    backupBeforeWrite: false,
    requestApproval: async () => false,
  };
  const r = await deleteFile({ path: 'garde.txt' }, guard, config);
  assert.ok(!r.ok);
  assert.equal(r.error, 'REJETÉ_PAR_UTILISATEUR');
  assert.ok(fs.existsSync(path.join(root, 'garde.txt')), 'Le fichier doit être intact');
});

test('delete_file — émet write_preview avec isDelete:true', async () => {
  const root   = tmpDir();
  const guard  = makeGuard(root);
  fs.writeFileSync(path.join(root, 'cible.txt'), 'contenu');
  const events = [];

  await deleteFile({ path: 'cible.txt' }, guard, { backupBeforeWrite: false }, e => events.push(e));
  const preview = events.find(e => e.type === 'write_preview');
  assert.ok(preview, 'write_preview doit être émis');
  assert.ok(preview.isDelete, 'isDelete doit être vrai');
});

// ── moveFile ──────────────────────────────────────────────────────────────────

test('move_file — déplace le fichier vers destination', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'src.txt'), 'contenu');

  const r = await moveFile({ path: 'src.txt', dest: 'dst.txt' }, guard, { backupBeforeWrite: false });
  assert.ok(r.ok, r.error);
  assert.equal(r.moved, 'src.txt');
  assert.equal(r.dest,  'dst.txt');
  assert.ok(!fs.existsSync(path.join(root, 'src.txt')), 'source doit disparaître');
  assert.ok(fs.existsSync(path.join(root, 'dst.txt')),  'dest doit exister');
  assert.equal(fs.readFileSync(path.join(root, 'dst.txt'), 'utf8'), 'contenu');
});

test('move_file — crée les dossiers parents de la destination', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'file.js'), 'code');

  const r = await moveFile({ path: 'file.js', dest: 'sub/dir/file.js' }, guard, { backupBeforeWrite: false });
  assert.ok(r.ok, r.error);
  assert.ok(fs.existsSync(path.join(root, 'sub', 'dir', 'file.js')));
});

test('move_file — source inexistante → FICHIER_INTROUVABLE', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);

  const r = await moveFile({ path: 'absent.txt', dest: 'autre.txt' }, guard, { backupBeforeWrite: false });
  assert.ok(!r.ok);
  assert.equal(r.error, 'FICHIER_INTROUVABLE');
});

test('move_file — destination déjà existante → DESTINATION_DÉJÀ_EXISTANTE', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');

  const r = await moveFile({ path: 'a.txt', dest: 'b.txt' }, guard, { backupBeforeWrite: false });
  assert.ok(!r.ok);
  assert.equal(r.error, 'DESTINATION_DÉJÀ_EXISTANTE');
});

test('move_file — dest hors projet → rejeté par path-guard', async () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');

  // moveFile est async et attrape l'erreur de guard → retourne { ok: false, error: 'PATH_GUARD...' }
  const r = await moveFile({ path: 'a.txt', dest: '../../etc/passwd' }, guard, { backupBeforeWrite: false });
  assert.ok(!r.ok);
  assert.ok(r.error.includes('PATH_GUARD'), `Attendu PATH_GUARD, reçu : ${r.error}`);
});

test('move_file — émet write_preview avec isMove:true', async () => {
  const root   = tmpDir();
  const guard  = makeGuard(root);
  fs.writeFileSync(path.join(root, 'x.txt'), 'x');
  const events = [];

  await moveFile({ path: 'x.txt', dest: 'y.txt' }, guard, { backupBeforeWrite: false }, e => events.push(e));
  const preview = events.find(e => e.type === 'write_preview');
  assert.ok(preview, 'write_preview doit être émis');
  assert.ok(preview.isMove, 'isMove doit être vrai');
  assert.equal(preview.dest, 'y.txt');
});

// ── findSymbol ────────────────────────────────────────────────────────────────

test('find_symbol — trouve une fonction JS par nom partiel', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'utils.js'), [
    'function readFile(path) { return fs.readFileSync(path); }',
    'function writeFile(path, content) { fs.writeFileSync(path, content); }',
    'class FileManager { constructor() {} }',
  ].join('\n'));

  const r = findSymbol({ name: 'file' }, guard, root);
  assert.ok(r.ok);
  // readFile, writeFile, FileManager contiennent "file" (insensible à la casse)
  assert.ok(r.matches.length >= 2, `Attendu >= 2 matches, reçu ${r.matches.length}`);
  assert.ok(r.matches.every(m => m.line >= 1), 'Chaque match doit avoir un numéro de ligne ≥ 1');
  assert.ok(r.matches.every(m => m.path), 'Chaque match doit avoir un chemin');
});

test('find_symbol — exact:true ne retourne que la correspondance exacte', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'a.js'), [
    'function readFile() {}',
    'function readFileSync() {}',
  ].join('\n'));

  const r = findSymbol({ name: 'readFile', exact: true }, guard, root);
  assert.ok(r.ok);
  assert.equal(r.matches.length, 1, 'exact:true ne doit retourner que readFile, pas readFileSync');
  assert.equal(r.matches[0].name, 'readFile');
});

test('find_symbol — sans nom → FIND_SYMBOL_SANS_NOM', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  const r = findSymbol({}, guard, root);
  assert.ok(!r.ok);
  assert.equal(r.error, 'FIND_SYMBOL_SANS_NOM');
});

test('find_symbol — files_scanned reflète le nombre de fichiers analysés', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'a.js'),  'function foo() {}');
  fs.writeFileSync(path.join(root, 'b.js'),  'function bar() {}');
  fs.writeFileSync(path.join(root, 'c.txt'), 'function ignored() {}');  // extension non supportée

  const r = findSymbol({ name: 'foo' }, guard, root);
  assert.ok(r.ok);
  // a.js et b.js sont scannés, c.txt est ignoré
  assert.equal(r.files_scanned, 2, `Attendu 2 fichiers scannés, reçu ${r.files_scanned}`);
});

test('find_symbol — retourne le bon numéro de ligne', () => {
  const root  = tmpDir();
  const guard = makeGuard(root);
  fs.writeFileSync(path.join(root, 'lib.js'), [
    '// ligne 1',
    '// ligne 2',
    'function myTarget() {}',   // ligne 3
  ].join('\n'));

  const r = findSymbol({ name: 'myTarget', exact: true }, guard, root);
  assert.ok(r.ok);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].line, 3, `Attendu ligne 3, reçu ${r.matches[0].line}`);
});
