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

  it('ask_user et plan ne comptent ni pour ni contre', async () => {
    const { result } = await run(n => (n <= 12 ? { tool: 'plan', args: { objective: `o${n}`, goals: [], steps: [] } } : null));
    assert.equal(result.ok, true);
  });
});
