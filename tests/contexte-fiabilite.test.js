'use strict';
/**
 * Non-régression du lot contexte : classement RAG, index à jour, budget rempli,
 * sorties longues, commandes non bloquantes.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'contexte-fiabilite-'));
process.env.APPDATA = tmpBase; // sessions et index RAG isolés

const { tokenize }     = require('../src/harness/rag/embedder');
const { lexicalScores } = require('../src/harness/rag/lexical');
const { createStore }  = require('../src/harness/rag/store');
const { indexProject, ragStoreId } = require('../src/harness/rag/indexer');
const { retrieveRelevant } = require('../src/harness/rag/retrieve');
const { buildContext } = require('../src/harness/context/builder');
const { findRelevantFiles } = require('../src/harness/tools/find-relevant');
const { runAgent }     = require('../src/harness/agent');
const { runCommand }   = require('../src/harness/tools/run-command');
const { runShell }     = require('../src/harness/tools/shell');
const { runTests }     = require('../src/harness/tools/test-runner');

let counter = 0;
function project(files) {
  const dir = path.join(tmpBase, `p${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function indexed(files) {
  const dir = project(files);
  const store = createStore(`s${counter}`);
  indexProject(dir, store);
  return { dir, store };
}

const seenBy = (steps) => {
  const seen = [];
  const queue = [...steps];
  const llm = async (messages) => {
    seen.push(String(messages.at(-1).content));
    const next = queue.shift();
    return next ? JSON.stringify(next) : '{"tool":"finish","args":{"summary":"fin"}}';
  };
  return { seen, llm };
};

after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

describe('RAG — classement', () => {
  it('découpe les identifiants camelCase et snake_case', () => {
    const tokens = tokenize('extractToolCall max_parse_retries');
    for (const t of ['extract', 'tool', 'call', 'parse', 'retries']) assert.ok(tokens.includes(t), t);
  });

  it('le score lexical ne confond pas deux termes distincts', () => {
    const scores = lexicalScores([
      { path: 'a.js', content: 'paiement '.repeat(10) },
      { path: 'b.js', content: 'livraison '.repeat(10) },
    ], ['paiement']);
    assert.equal(scores[0], 1);
    assert.equal(scores[1], 0);
  });

  it('retrouve un fichier par son nom', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `// ligne de remplissage ${i}`).join('\n');
    const { store } = indexed({
      'src/facturation.js': `${filler}\nfunction a() {}\n`,
      'src/autre.js':       `${filler}\nfunction b() {}\n`,
    });
    const [first] = await retrieveRelevant(store, 'corrige la facturation', { topK: 2 });
    assert.equal(first.path, 'src/facturation.js');
  });

  it('un très court extrait ne devance pas le fichier qui contient la réponse', async () => {
    const answer = Array.from({ length: 30 }, (_, i) => `  total += prix[${i}]; // calcul du total`).join('\n');
    const { store } = indexed({
      'src/court.js': 'const total = 0;\n',
      'src/panier.js': `function somme() {\n${answer}\n}\n`,
    });
    const [first] = await retrieveRelevant(store, 'calcul du total', { topK: 2 });
    assert.equal(first.path, 'src/panier.js');
  });
});

describe('RAG — priorité au code source', () => {
  const body = Array.from({ length: 30 }, () => 'calcul de la remise client').join('\n');
  const files = { 'src/remise.js': `function f() {\n${body}\n}\n`, 'tests/remise.test.js': body, 'docs/remise.md': body };

  it('le code passe devant les tests et la documentation', async () => {
    const { store } = indexed(files);
    const [first] = await retrieveRelevant(store, 'calcul de la remise', { topK: 3 });
    assert.equal(first.path, 'src/remise.js');
  });

  it('les tests reprennent leur place quand la tâche en parle', async () => {
    const { store } = indexed(files);
    const results = await retrieveRelevant(store, 'test du calcul de la remise', { topK: 3 });
    const docs  = results.find(r => r.path === 'docs/remise.md');
    const tests = results.find(r => r.path === 'tests/remise.test.js');
    assert.ok(tests.score > docs.score);
  });
});

describe('RAG — index à jour', () => {
  it('oublie un fichier supprimé', () => {
    const { dir, store } = indexed({ 'a.js': 'function a() {}\n', 'b.js': 'function b() {}\n' });
    fs.unlinkSync(path.join(dir, 'a.js'));
    indexProject(dir, store);
    assert.deepEqual([...store.paths()], ['b.js']);
  });

  it('oublie la fin d\'un fichier raccourci', () => {
    const blocks = Array.from({ length: 6 }, (_, i) => `function f${i}() {}`).join('\n');
    const { dir, store } = indexed({ 'a.js': blocks });
    fs.writeFileSync(path.join(dir, 'a.js'), 'function seule() {}\n');
    indexProject(dir, store);
    assert.equal(store.all().length, 1);
  });

  it('n\'indexe ni les lockfiles ni les fixtures', () => {
    const { store } = indexed({
      'a.js': 'function a() {}\n',
      'package-lock.json': '{}\n',
      'tests/fixtures/f.js': 'function f() {}\n',
    });
    assert.deepEqual([...store.paths()], ['a.js']);
  });

  it('find_relevant_files réutilise l\'index versionné de l\'agent', async () => {
    const dir = project({ 'src/facturation.js': 'function facturation() {}\n' });
    const r = await findRelevantFiles({ task: 'facturation' }, dir);
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(tmpBase, 'code-harness', 'rag', `${ragStoreId(dir)}.json`)));
  });
});

describe('contexte — budget', () => {
  const chunk = (file, i, score = 0.5, extra = {}) => ({
    path: file, startLine: i, endLine: i, content: `${file} extrait ${i} `.repeat(100), score, ...extra,
  });
  const storeOf = (chunks) => ({ all: () => chunks, search: (vec, k) => chunks.slice(0, k) });
  const shown = (context, file) => (context.match(new RegExp(`### ${file}`, 'g')) || []).length;
  const dir = project({ 'a.js': 'x\n' });

  it('dépasse cinq extraits pour remplir le budget', async () => {
    const chunks = Array.from({ length: 12 }, (_, i) => chunk(`f${i}.js`, i));
    const context = await buildContext({ task: 'tâche', projectRoot: dir, ragStore: storeOf(chunks), maxChars: 12000 });
    assert.ok((context.match(/### /g) || []).length > 5);
    assert.ok(context.length > 8000, `${context.length} car.`);
  });

  it('limite un même fichier quand d\'autres sont disponibles', async () => {
    const chunks = [...Array.from({ length: 6 }, (_, i) => chunk('gros.js', i)),
      ...Array.from({ length: 6 }, (_, i) => chunk(`f${i}.js`, i))];
    const context = await buildContext({ task: 'tâche', projectRoot: dir, ragStore: storeOf(chunks), maxChars: 12000 });
    assert.equal(shown(context, 'gros.js'), 2);
  });

  it('un seul fichier peut occuper tout le budget', async () => {
    const chunks = Array.from({ length: 8 }, (_, i) => chunk('seul.js', i));
    const context = await buildContext({ task: 'tâche', projectRoot: dir, ragStore: storeOf(chunks), maxChars: 12000 });
    assert.ok(shown(context, 'seul.js') > 2);
  });

  it('écarte les extraits sans rapport', async () => {
    const context = await buildContext({ task: 'tâche', projectRoot: dir, ragStore: storeOf([chunk('zero.js', 1, 0)]), maxChars: 12000 });
    assert.equal(shown(context, 'zero.js'), 0);
  });
});

describe('sorties longues', () => {
  it('read_file tronqué indique la ligne où reprendre', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `ligne numero ${i + 1} ${'x'.repeat(30)}`);
    const dir = project({ 'gros.txt': lines.join('\n') });
    const { seen, llm } = seenBy([{ tool: 'read_file', args: { path: 'gros.txt' } }]);
    await runAgent({ task: 't', projectRoot: dir, config: {}, llmGenerate: llm });
    const next = Number(seen[1].match(/"start_line\\?": (\d+)/)?.[1]);
    assert.ok(next > 1 && next < 400, seen[1].slice(-200));
    // La ligne de reprise peut être coupée : c'est la précédente qui doit être complète
    assert.ok(seen[1].includes(`ligne numero ${next - 1} ${'x'.repeat(30)}`), 'aucune ligne ne doit manquer à la reprise');
  });

  it('une sortie de tests réussie garde son bilan final', async () => {
    const dir = project({
      'package.json': '{"name":"x","scripts":{"test":"node t.js"}}',
      't.js': 'console.log("detail ".repeat(5000)); console.log("BILAN pass 42");',
    });
    const { seen, llm } = seenBy([{ tool: 'run_tests', args: {} }]);
    await runAgent({ task: 't', projectRoot: dir, config: {}, llmGenerate: llm });
    assert.ok(seen[1].includes('BILAN pass 42'));
  });
});

describe('commandes non bloquantes', () => {
  const wait = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;

  it('laisse tourner la boucle d\'événements', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 20);
    await runCommand(wait(500), { cwd: tmpBase, timeout: 10000 });
    clearInterval(timer);
    assert.ok(ticks >= 5, `${ticks} tours seulement`);
  });

  it('rapporte le code de sortie et la sortie', async () => {
    const r = await runCommand('node -e "console.log(1); process.exit(3)"', { cwd: tmpBase, timeout: 10000 });
    assert.equal(r.code, 3);
    assert.ok(r.stdout.includes('1'));
  });

  it('arrête une commande qui dépasse le délai', async () => {
    const start = Date.now();
    const r = await runCommand(wait(20000), { cwd: tmpBase, timeout: 300 });
    assert.equal(r.timedOut, true);
    assert.ok(Date.now() - start < 10000);
  });

  it('une commande qui lit stdin ne reste pas bloquée', async () => {
    const r = await runCommand('node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.log(\'fin\'))"',
      { cwd: tmpBase, timeout: 8000 });
    assert.equal(r.timedOut, false);
  });

  it('le Stop arrête run_shell et ses processus enfants', async () => {
    const abort = new AbortController();
    const start = Date.now();
    setTimeout(() => abort.abort(), 200);
    const r = await runShell({ command: wait(20000) }, tmpBase, { enableShell: true, _signal: abort.signal });
    assert.equal(r.error, 'ANNULÉ');
    assert.ok(Date.now() - start < 10000);
  });

  it('un Stop déjà demandé empêche run_tests de démarrer', async () => {
    const abort = new AbortController();
    abort.abort();
    const dir = project({ 'package.json': '{"scripts":{"test":"node -e 0"}}' });
    const r = await runTests({}, dir, { signal: abort.signal });
    assert.equal(r.error, 'ANNULÉ');
  });

  it('run_shell transmet le code et stderr d\'un échec', async () => {
    const r = await runShell({ command: 'node -e "process.stderr.write(\'cassé\'); process.exit(1)"' }, tmpBase, { enableShell: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 1);
    assert.ok(r.error.includes('cassé'));
  });
});
