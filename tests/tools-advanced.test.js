const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { searchGrep } = require('../src/harness/tools/grep');
const { gitStatus, gitDiff } = require('../src/harness/tools/git');
const { runShell } = require('../src/harness/tools/shell');
const { makeGuard } = require('../src/harness/safety/path-guard');

// ── Fixture temporaire ────────────────────────────────────────────────────────
let tmpDir;
let guard;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-adv-'));
  // Créer quelques fichiers de test
  fs.writeFileSync(path.join(tmpDir, 'hello.js'), 'function hello() {\n  return "world";\n}\nmodule.exports = hello;\n');
  fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'ligne 1\ncherche-moi ici\nligne 3\n');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.js'), 'const x = 42; // cherche-moi\n');
  guard = makeGuard(tmpDir);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── search_grep ───────────────────────────────────────────────────────────────
describe('search_grep', () => {
  it('trouve un pattern dans plusieurs fichiers', async () => {
    const r = await searchGrep({ pattern: 'cherche-moi' }, guard);
    assert.ok(r.ok);
    assert.ok(r.matches.length >= 2);
    assert.ok(r.matches.every(m => m.path && m.line > 0 && m.text));
  });

  it('filtre par extension .js', async () => {
    const r = await searchGrep({ pattern: 'cherche-moi', ext: '.js' }, guard);
    assert.ok(r.ok);
    assert.ok(r.matches.every(m => m.path.endsWith('.js')));
    // notes.txt ne doit pas apparaître
    assert.ok(r.matches.every(m => !m.path.endsWith('.txt')));
  });

  it('pattern regex fonctionne', async () => {
    const r = await searchGrep({ pattern: 'func\\w+' }, guard);
    assert.ok(r.ok);
    assert.ok(r.matches.some(m => m.text.includes('function')));
  });

  it('pattern introuvable → matches vide', async () => {
    const r = await searchGrep({ pattern: 'zz_inexistant_zz' }, guard);
    assert.ok(r.ok);
    assert.equal(r.matches.length, 0);
  });

  it('pattern manquant → erreur', async () => {
    const r = await searchGrep({}, guard);
    assert.ok(!r.ok);
    assert.equal(r.error, 'PATTERN_MANQUANT');
  });

  it('chemins de résultats sont relatifs au projectRoot', async () => {
    const r = await searchGrep({ pattern: 'cherche-moi' }, guard, tmpDir);
    assert.ok(r.ok);
    // Aucun chemin ne doit être absolu (commencer par / ou C:\)
    assert.ok(r.matches.every(m => !path.isAbsolute(m.path)), 'chemin absolu détecté dans les résultats');
    // Le fichier dans le sous-dossier doit avoir le préfixe relatif
    assert.ok(r.matches.some(m => m.path.includes('sub/')));
  });

  it('context_lines ajoute les lignes de contexte autour du match', async () => {
    const r = await searchGrep({ pattern: 'cherche-moi', context_lines: 1 }, guard, tmpDir);
    assert.ok(r.ok);
    assert.ok(r.matches.length > 0, 'Doit y avoir au moins un match');
    // Chaque match doit avoir un champ context
    const m = r.matches[0];
    assert.ok(Array.isArray(m.context), 'context doit être un tableau');
    // Au moins le match lui-même dans context
    assert.ok(m.context.some(c => c.match === true), 'Au moins une entrée doit être marquée match:true');
    // Les numéros de ligne sont croissants
    const lines = m.context.map(c => c.line);
    for (let i = 1; i < lines.length; i++) {
      assert.ok(lines[i] > lines[i - 1], 'Les numéros de ligne doivent être croissants');
    }
  });

  it('context_lines:0 (défaut) → pas de champ context', async () => {
    const r = await searchGrep({ pattern: 'cherche-moi' }, guard, tmpDir);
    assert.ok(r.ok);
    assert.ok(r.matches.length > 0);
    assert.ok(r.matches[0].context === undefined, 'context ne doit pas être présent sans context_lines');
  });
});

// ── git_status / git_diff ─────────────────────────────────────────────────────
describe('git_status', () => {
  it('retourne GIT_NOT_FOUND si pas de .git', async () => {
    const r = await gitStatus({}, guard, tmpDir);
    assert.ok(!r.ok);
    assert.equal(r.error, 'GIT_NOT_FOUND');
  });
});

describe('git_diff', () => {
  it('retourne GIT_NOT_FOUND si pas de .git', async () => {
    const r = await gitDiff({}, guard, tmpDir);
    assert.ok(!r.ok);
    assert.equal(r.error, 'GIT_NOT_FOUND');
  });
});

// ── run_shell ─────────────────────────────────────────────────────────────────
describe('run_shell', () => {
  it('refusé si enableShell false', async () => {
    const r = await runShell({ command: 'echo hi' }, tmpDir, { enableShell: false });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('SHELL_DISABLED'));
  });

  it('commande destructrice bloquée (blacklist)', async () => {
    const r = await runShell({ command: 'rm -rf /etc' }, tmpDir, { enableShell: true });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('BLOQUÉE'), `attendu BLOQUÉE, reçu: ${r.error}`);
  });

  it('commande autorisée exécutée', async () => {
    const r = await runShell({ command: 'node --version' }, tmpDir, { enableShell: true });
    assert.ok(r.ok);
    assert.ok(r.stdout.startsWith('v'));
  });

  it('commande vide refusée', async () => {
    const r = await runShell({ command: '   ' }, tmpDir, { enableShell: true });
    assert.ok(!r.ok);
    assert.equal(r.error, 'COMMANDE_VIDE');
  });
});
