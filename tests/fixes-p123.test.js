'use strict';

// Phase 123 — boucles stériles (ADR-043) : réponses inutilisables, progrès réel,
// échec répété et attente.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p123-'));
process.env.HARNESS_DATA_DIR = path.join(SANDBOX, 'data');
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const { runAgent }        = require('../src/harness/agent');
const { extractToolCall } = require('../src/harness/parser');

let _n = 0;
function project(files = {}) {
  const dir = path.join(SANDBOX, `p${++_n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries({ 'a.js': 'v0', ...files })) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

/** next(n) renvoie un appel d'outil, une réponse brute, ou rien pour terminer. */
async function run(next, { files, config = {}, signal } = {}) {
  const seen = [];
  const events = [];
  const waits = [];
  let calls = 0;
  const result = await runAgent({
    task: 't', projectRoot: project(files), signal, onEvent: e => events.push(e),
    config: { maxSteps: 50, autonomyLevel: 'off', _sleep: async ms => { waits.push(ms); }, ...config },
    llmGenerate: async (messages) => {
      seen.push(String(messages.at(-1).content));
      const out = next(++calls) ?? { tool: 'finish', args: { summary: 'fin' } };
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  });
  return { result, calls, seen, events, waits };
}

const warnings = (seen, label) => seen.filter(s => s.includes(`⚠️ ${label}`));
const read = n => ({ tool: 'read_file', args: { path: `f${n}.js` } });
const manyFiles = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i + 1}.js`, `// ${i}`]));
const write = (file, content) => ({ tool: 'write_file', args: { path: file, content } });

describe('piste 1 — réponses inutilisables', () => {
  it('arrête une réponse toujours illisible à 10 générations, après un avertissement', async () => {
    const { result, calls, seen } = await run(() => 'je réfléchis {"tool":');
    assert.equal(result.error, 'RÉPONSES_INUTILISABLES');
    assert.equal(calls, 10);
    assert.equal(warnings(seen, 'RÉPONSES INUTILISABLES').length, 1);
    assert.ok(seen[6].includes('RÉPONSES INUTILISABLES'), 'avertissement après la 6e');
    assert.match(warnings(seen, 'RÉPONSES INUTILISABLES')[0], /"tool"/);
  });

  it('tolère davantage un moteur local', async () => {
    const { result, calls } = await run(() => 'illisible', { config: { model: { primary: 'webllm' } } });
    assert.equal(result.error, 'RÉPONSES_INUTILISABLES');
    assert.equal(calls, 14);
  });

  it('compte l\'outil hors périmètre', async () => {
    const { result, calls, seen } = await run(n => write('a.js', `x${n}`), { config: { planMode: true } });
    assert.equal(result.error, 'RÉPONSES_INUTILISABLES');
    assert.equal(calls, 10);
    assert.equal(warnings(seen, 'RÉPONSES INUTILISABLES').length, 1);
  });

  it('voit une réponse sur deux inutilisable, même sans jamais deux d\'affilée', async () => {
    const { result, calls } = await run(n => (n % 2 ? read(n) : 'illisible'), { files: manyFiles });
    assert.equal(result.error, 'RÉPONSES_INUTILISABLES');
    assert.equal(calls, 20);
  });

  it('laisse travailler malgré une réponse illisible de temps en temps', async () => {
    const { result } = await run(n => (n > 40 ? null : n % 10 === 0 ? 'illisible' : read(n)), { files: manyFiles });
    assert.equal(result.ok, true, result.error);
  });

  it('nomme les clés reçues sans leurs valeurs', async () => {
    assert.deepEqual(extractToolCall('{"name":"read_file","arguments":{}}').keys, ['name', 'arguments']);
    const { seen } = await run(() => ({ name: 'valeur-privee', arguments: {} }));
    const warned = warnings(seen, 'RÉPONSES INUTILISABLES')[0];
    const advice = warned.slice(warned.indexOf('⚠️ RÉPONSES INUTILISABLES'));
    assert.match(advice, /name, arguments/);
    assert.doesNotMatch(advice, /valeur-privee/);
    const logs = path.join(process.env.HARNESS_DATA_DIR, 'logs');
    const text = fs.readdirSync(logs).map(f => fs.readFileSync(path.join(logs, f), 'utf8')).join('');
    assert.match(text, /"keys":\["name","arguments"\]/);
    assert.doesNotMatch(text, /valeur-privee/);
    assert.match(text, /"unusable_replies":10/);
  });
});

describe('piste 2 — progrès réel', () => {
  it('une écriture qui oscille entre deux contenus est une stagnation', async () => {
    const { result, calls } = await run(n => write('a.js', n % 2 ? 'A' : 'B'));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 12, `${calls} appels`);
  });

  it('un fichier déplacé en aller-retour est une stagnation', async () => {
    const { result, calls } = await run(n => ({ tool: 'move_file', args: n % 2 ? { path: 'a.js', dest: 'b.js' } : { path: 'b.js', dest: 'a.js' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 14, `${calls} appels`);
  });

  const failing = { 't.js': 'console.log("1 échec : attendu 2, reçu 1 (" + Math.random() * 90 + "ms)"); process.exit(1)' };
  const shell = { tool: 'run_shell', args: { command: 'node t.js' } };

  it('arrête le même échec malgré les modifications, durées mises à part', async () => {
    const { result, calls, seen } = await run(n => (n % 2 ? write('a.js', `essai ${n}`) : shell), { files: failing, config: { enableShell: true } });
    assert.equal(result.error, 'ÉCHEC_RÉPÉTÉ');
    assert.equal(calls, 12);
    assert.equal(warnings(seen, 'ÉCHEC RÉPÉTÉ').length, 1);
  });

  it('vaut aussi pour run_tests', async () => {
    const files = { ...failing, 'package.json': '{"scripts":{"test":"node t.js"}}' };
    const { result, calls } = await run(n => (n % 2 ? write('a.js', `essai ${n}`) : { tool: 'run_tests', args: {} }), { files });
    assert.equal(result.error, 'ÉCHEC_RÉPÉTÉ', result.error);
    assert.equal(calls, 12);
  });

  it('laisse construire plusieurs fichiers avant que le test passe', async () => {
    const files = { 't.js': 'if (!require("fs").existsSync("ok.txt")) { console.log("incomplet"); process.exit(1) }' };
    const { result } = await run((n) => {
      if (n <= 16) return n % 2 ? write(`module${n}.js`, 'x') : shell;
      if (n === 17) return write('ok.txt', 'ok');
      return n === 18 ? shell : null;
    }, { files, config: { enableShell: true } });
    assert.equal(result.ok, true, result.error);
  });

  it('ne confond pas des échecs différents', async () => {
    const files = { 't.js': 'console.log("reçu " + require("fs").readFileSync("a.js", "utf8")); process.exit(1)' };
    const { result } = await run(n => (n > 16 ? null : n % 2 ? write('a.js', `valeur ${n}`) : shell), { files, config: { enableShell: true } });
    assert.equal(result.ok, true, result.error);
  });

  it('repart de zéro quand la commande réussit', async () => {
    const files = { 't.js': 'const v = require("fs").readFileSync("a.js", "utf8"); if (!v.startsWith("vert")) { console.log("rouge"); process.exit(1) }' };
    // cinq échecs, un succès, cinq échecs
    const { result } = await run((n) => {
      if (n > 22) return null;
      if (n % 2 === 0) return shell;
      return write('a.js', n === 11 ? 'vert' : `essai ${n}`);
    }, { files, config: { enableShell: true } });
    assert.equal(result.ok, true, result.error);
  });
});

describe('piste 3 — attente', () => {
  const poll = { tool: 'check_service', args: { port: 9, timeout: 200 } };

  it('patiente de plus en plus, avertit puis arrête à la 15e consultation', async () => {
    const { result, calls, seen, waits } = await run(() => poll);
    assert.equal(result.error, 'ATTENTE_SANS_FIN');
    assert.equal(calls, 15);
    assert.deepEqual(waits.slice(0, 6), [2000, 4000, 8000, 16000, 30000, 30000]);
    assert.equal(waits.reduce((a, b) => a + b, 0), 300000);
    assert.equal(warnings(seen, 'ATTENTE').length, 1);
    const logs = path.join(process.env.HARNESS_DATA_DIR, 'logs');
    const text = fs.readdirSync(logs).map(f => fs.readFileSync(path.join(logs, f), 'utf8')).join('');
    assert.match(text, /"poll_wait_s":300/);
  });

  it('un autre outil remet l\'attente à zéro', async () => {
    const { result, waits } = await run(n => (n > 11 ? null : n === 6 ? { tool: 'list_dir', args: { path: '.' } } : poll));
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(waits, [2000, 4000, 8000, 2000, 4000, 8000]);
  });

  it('laisse attendre un serveur lent', async () => {
    const { result } = await run(n => (n <= 14 ? poll : null));
    assert.equal(result.ok, true, result.error);
  });

  it('le Stop interrompt l\'attente', async () => {
    const abort = new AbortController();
    let started = 0;
    const next = (n) => {
      // 3e consultation : le Stop arrive pendant la pause de 2 s qui la précède
      if (n === 3) { started = Date.now(); setTimeout(() => abort.abort(), 100); }
      return { tool: 'list_processes', args: {} };
    };
    const { result, events } = await run(next, { config: { _sleep: undefined }, signal: abort.signal });
    assert.equal(result.error, 'ANNULÉ');
    assert.ok(Date.now() - started < 1500, 'pause interrompue');
    assert.equal(events.filter(e => e.type === 'tool_result').length, 2, 'la consultation en attente n\'est pas lancée');
  });
});
