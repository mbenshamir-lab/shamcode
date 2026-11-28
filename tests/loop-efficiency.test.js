'use strict';
/**
 * Efficacité de la boucle : une tâche qui n'avance pas doit être coupée vite, une
 * exploration ou un travail réel ne doit jamais l'être. Voir ADR-039.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-eff-'));
process.env.APPDATA = tmpBase;
const { runAgent } = require('../src/harness/agent');
after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

let counter = 0;
function project(files = { 'a.js': 'const x = 1;\n', 'b.js': 'b\n' }) {
  const dir = path.join(tmpBase, `p${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
  return dir;
}

async function run(next, files) {
  const seen = [];
  let calls = 0;
  const result = await runAgent({
    task: 't', projectRoot: project(files), config: { maxSteps: 50 },
    llmGenerate: async (messages) => {
      seen.push(String(messages.at(-1).content));
      return JSON.stringify(next(++calls) ?? { tool: 'finish', args: { summary: 'fin' } });
    },
  });
  return { result, calls, seen };
}

describe('stagnation — la boucle qui n\'avance pas est coupée', () => {
  it('échecs répétés aux arguments variables', async () => {
    const { result, calls } = await run(n => ({ tool: 'replace_code', args: { path: 'a.js', old_string: `absent ${n}`, new_string: 'y' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 12, `${calls} appels`);
  });

  it('cycle entre deux appels', async () => {
    const { result, calls } = await run(n => (n % 2 ? { tool: 'list_dir', args: { path: '.' } } : { tool: 'read_file', args: { path: 'b.js' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 16, `${calls} appels`);
  });

  it('recherches sans effet', async () => {
    const { result, calls } = await run(n => ({ tool: 'search_grep', args: { pattern: `x${n}`, path: '.' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 12, `${calls} appels`);
  });

  it('tests verts relancés sans rien changer, malgré une durée différente à chaque fois', async () => {
    const files = { 'package.json': '{"scripts":{"test":"node t.js"}}', 't.js': 'console.log("ok " + Math.random() + " ms")' };
    const { result, calls } = await run(() => ({ tool: 'run_tests', args: {} }), files);
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 12, `${calls} appels`);
  });

  it('notes écrites et relues en alternance', async () => {
    const { result, calls } = await run(n => ({ tool: 'scratchpad', args: n % 2 ? { action: 'set', key: 'k', value: 'v' } : { action: 'get', key: 'k' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 14, `${calls} appels`);
  });

  it('attente d\'un service alternée avec la lecture d\'une note', async () => {
    const { result, calls } = await run(n => (n % 2
      ? { tool: 'check_service', args: { port: 9, timeout: 100 } }
      : { tool: 'scratchpad', args: { action: 'get', key: 'k' } }));
    assert.equal(result.error, 'STAGNATION_DÉTECTÉE');
    assert.ok(calls <= 24, `${calls} appels`);
  });

  it('avertit le modèle avant d\'arrêter, en nommant le dernier échec', async () => {
    const { seen } = await run(n => ({ tool: 'replace_code', args: { path: 'a.js', old_string: `absent ${n}`, new_string: 'y' } }));
    const warned = seen.filter(s => s.includes('STAGNATION'));
    assert.equal(warned.length, 1);
    assert.ok(warned[0].includes('replace_code'), warned[0]);
  });
});

describe('stagnation — le vrai travail n\'est jamais coupé', () => {
  it('explorer de nombreux fichiers neufs est un progrès', async () => {
    const files = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}.js`, `// ${i}\n`]));
    const { result, calls } = await run(n => (n <= 15 ? { tool: 'read_file', args: { path: `f${n - 1}.js` } } : null), files);
    assert.equal(result.ok, true);
    assert.equal(calls, 16);
  });

  it('une écriture réussie remet le compteur à zéro', async () => {
    const bad = n => ({ tool: 'replace_code', args: { path: 'a.js', old_string: `absent ${n}`, new_string: 'y' } });
    const good = n => ({ tool: 'write_file', args: { path: `n${n}.txt`, content: String(n) } });
    // 8 échecs, une écriture, 8 échecs : jamais 10 d'affilée
    const { result } = await run(n => (n === 9 ? good(n) : n <= 17 ? bad(n) : null));
    assert.equal(result.ok, true);
  });

  it('retester après chaque nouveau contenu reste un progrès', async () => {
    const files = { 'package.json': '{"scripts":{"test":"node t.js"}}', 't.js': 'console.log("ok")', 'a.js': 'v0' };
    const { result } = await run(n => (n > 30 ? null : n % 2
      ? { tool: 'write_file', args: { path: 'a.js', content: `v${n}` } }
      : { tool: 'run_tests', args: {} }), files);
    assert.equal(result.ok, true, result.error);
  });

  it('ask_user et plan ne comptent ni pour ni contre', async () => {
    const { result } = await run(n => (n <= 12 ? { tool: 'plan', args: { objective: `o${n}`, goals: [], steps: [] } } : null));
    assert.equal(result.ok, true);
  });
});

describe('lecture groupée — read_file { paths }', () => {
  const files = { 'a.js': 'const a = 1;\n', 'b.js': 'const b = 2;\n', 'c.js': 'const c = 3;\n' };

  it('lire trois fichiers coûte un seul appel LLM', async () => {
    const { result, calls, seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: ['a.js', 'b.js', 'c.js'] } } : null), files);
    assert.equal(result.ok, true);
    assert.equal(calls, 2); // la lecture, puis finish
    for (const name of ['a.js', 'b.js', 'c.js']) assert.ok(seen[1].includes(`=== ${name}`), seen[1].slice(0, 200));
    assert.ok(seen[1].includes('const c = 3;'));
  });

  it('une lecture groupée après écriture vaut preuve de relecture', async () => {
    const script = [
      { tool: 'write_file', args: { path: 'a.js', content: 'neuf' } },
      { tool: 'read_file', args: { paths: ['a.js', 'b.js'] } },
      { tool: 'finish', args: { summary: 'ok', checks: [{ kind: 'file', path: 'a.js' }] } },
    ];
    const events = [];
    const result = await runAgent({ task: 't', projectRoot: project(files), config: {}, onEvent: e => events.push(e),
      llmGenerate: (() => { let i = 0; return async () => JSON.stringify(script[i++]); })() });
    assert.equal(result.ok, true);
    assert.equal(events.filter(e => e.type === 'finish_rejected').length, 0);
  });

  it('un fichier absent n\'annule pas les autres', async () => {
    const { seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: ['a.js', 'absent.js'] } } : null), files);
    assert.ok(seen[1].includes('const a = 1;'));
    assert.ok(seen[1].includes('absent.js — ERREUR'));
  });

  it('un chemin hors du projet reste refusé par le guard', async () => {
    const { seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: ['../../etc/passwd'] } } : null), files);
    assert.ok(seen[1].includes('AUCUN_FICHIER_LU'), seen[1].slice(0, 300));
  });

  it('plus de 8 chemins : refus explicite', async () => {
    const many = Array.from({ length: 9 }, (_, i) => `f${i}.js`);
    const { seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: many } } : null), files);
    assert.ok(seen[1].includes('TROP_DE_FICHIERS'), seen[1].slice(0, 300));
  });

  it('chaque fichier reçoit sa part : un gros fichier n\'avale pas les suivants', async () => {
    const big = { 'big.js': 'x'.repeat(30000), 'small.js': 'PETIT_FICHIER\n' };
    const { seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: ['big.js', 'small.js'] } } : null), big);
    assert.ok(seen[1].includes('PETIT_FICHIER'), 'le second fichier doit rester visible');
    assert.ok(seen[1].includes('tronqué'));
  });

  it('paths vide ou mal typé : erreur claire, pas de plantage', async () => {
    const { seen } = await run(n => (n === 1 ? { tool: 'read_file', args: { paths: [] } } : null), files);
    assert.ok(/ARGUMENT_MANQUANT|PATHS_VIDE/.test(seen[1]), seen[1].slice(0, 300));
  });
});
