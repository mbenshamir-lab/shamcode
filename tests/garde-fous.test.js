'use strict';
/**
 * Non-régression des garde-fous de la boucle : détection de boucle, plafond de coût,
 * preuve par fichier et limites de résultat selon le moteur.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-fous-'));
process.env.APPDATA = tmpBase;

const { runAgent } = require('../src/harness/agent');
const { resolveResultLimit, CLOUD_RESULT_CHARS } = require('../src/harness/context/budget');
const { MAX_RESULT_CHARS, MAX_TASK_TOKENS } = require('../src/shared/constants');

after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

let counter = 0;
function project(files = { 'a.js': 'x\n' }) {
  const dir = path.join(tmpBase, `p${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

/** Exécute un script d'appels ; `next(n)` fournit l'appel de l'étape n, ou null pour finir. */
async function run(next, { files, config = {} } = {}) {
  const events = [];
  const seen = [];
  let n = 0;
  const result = await runAgent({
    task: 't',
    projectRoot: project(files),
    config: { maxSteps: 30, ...config },
    onEvent: e => events.push(e),
    llmGenerate: async (messages, options) => {
      seen.push(String(messages.at(-1).content));
      const call = next(++n, options);
      return JSON.stringify(call ?? { tool: 'finish', args: { summary: 'fin' } });
    },
  });
  return { result, events, seen, calls: n };
}

const notes = (events, level) => events.filter(e => e.type === 'note_user' && e.level === level);

describe('détection de boucle', () => {
  const same = { tool: 'read_file', args: { path: 'absent.js' } };

  it('avertit le modèle à la troisième répétition', async () => {
    const { seen } = await run(n => (n <= 3 ? same : null));
    assert.ok(seen[3].includes('BOUCLE'), seen[3]);
    assert.ok(!seen[2].includes('BOUCLE'));
  });

  it('arrête la tâche si le modèle s\'entête', async () => {
    const { result, events, calls } = await run(() => same);
    assert.equal(result.error, 'BOUCLE_DÉTECTÉE');
    assert.equal(calls, 8);
    assert.ok(result.sessionId);
    assert.equal(notes(events, 'error').length, 1);
  });

  it('un changement d\'approche remet le compteur à zéro', async () => {
    const other = { tool: 'list_dir', args: { path: '.' } };
    const { result } = await run(n => (n > 21 ? null : n % 3 === 0 ? other : same));
    assert.equal(result.ok, true);
  });

  it('même appel mais résultat différent : pas une boucle', async () => {
    const dir = project();
    let n = 0;
    const result = await runAgent({ task: 't', projectRoot: dir, config: { maxSteps: 30 }, llmGenerate: async () => {
      n++;
      if (n > 10) return '{"tool":"finish","args":{"summary":"fin"}}';
      fs.writeFileSync(path.join(dir, `f${n}.txt`), 'x'); // le listing change à chaque appel
      return JSON.stringify({ tool: 'list_dir', args: { path: '.' } });
    } });
    assert.equal(result.ok, true);
  });

  it('l\'attente d\'un service n\'est pas une boucle', async () => {
    const poll = { tool: 'list_processes', args: {} };
    const { result, seen } = await run(n => (n <= 12 ? poll : null));
    assert.equal(result.ok, true);
    assert.ok(!seen.some(s => s.includes('BOUCLE')));
  });
});

describe('plafond de coût', () => {
  const usage = (input, cached = 0) => (n, options) => {
    options.onUsage({ inputTokens: input, cachedTokens: cached, outputTokens: 0 });
    return { tool: 'list_dir', args: { path: '.', depth: n } };
  };

  it('prévient à 80 % puis arrête au plafond', async () => {
    const { result, events, seen, calls } = await run(usage(100), { config: { maxTaskTokens: 500 } });
    assert.equal(result.error, 'PLAFOND_TOKENS_ATTEINT');
    assert.equal(calls, 5);
    assert.equal(notes(events, 'warn').length, 1);
    assert.ok(seen.some(s => s.includes('BUDGET')));
  });

  it('le cache n\'entame pas le budget', async () => {
    const { result } = await run((n, o) => (n > 10 ? null : usage(1000, 1000)(n, o)), { config: { maxTaskTokens: 500 } });
    assert.equal(result.ok, true);
  });

  it('zéro désactive le plafond', async () => {
    const { result } = await run((n, o) => (n > 10 ? null : usage(1e6)(n, o)), { config: { maxTaskTokens: 0 } });
    assert.equal(result.ok, true);
  });

  it('les sous-agents consomment le même budget que leur parent', async () => {
    const config = { maxTaskTokens: 500 };
    const spawn = { tool: 'spawn_agent', args: { role: 'analyzer', task: 'analyse' } };
    let n = 0;
    const llm = async (messages, options) => {
      n++;
      options.onUsage?.({ inputTokens: 200, outputTokens: 0 });
      const sub = messages.some(m => String(m.content).includes('ROLE SPÉCIALISÉ'));
      if (sub) return JSON.stringify({ tool: 'list_dir', args: { path: '.', depth: n } });
      return JSON.stringify(n === 1 ? spawn : { tool: 'list_dir', args: { path: '.', depth: n } });
    };
    const result = await runAgent({ task: 't', projectRoot: project(), config: { ...config, _llmGenerate: llm }, llmGenerate: llm });
    assert.equal(result.error, 'PLAFOND_TOKENS_ATTEINT');
    assert.ok(n <= 4, `${n} appels pour un plafond de 3`);
  });

  it('le plafond par défaut est actif', () => {
    assert.ok(MAX_TASK_TOKENS > 0);
  });
});

describe('preuve de finish par fichier', () => {
  const write = file => ({ tool: 'write_file', args: { path: file, content: 'neuf' } });
  const read  = file => ({ tool: 'read_file', args: { path: file } });
  const finish = checks => ({ tool: 'finish', args: { summary: 'ok', checks } });
  const cited = [{ kind: 'file', path: 'a.js' }, { kind: 'file', path: 'b.js' }];

  async function steps(script, files) {
    const queue = [...script];
    const { events, result } = await run(() => queue.shift(), { files });
    return { rejected: events.filter(e => e.type === 'finish_rejected'), result };
  }

  it('tous les fichiers écrits sont attestés par le serveur, sans relecture du modèle', async () => {
    const { rejected } = await steps([write('a.js'), write('b.js'), finish(cited)]);
    assert.equal(rejected.length, 0);
  });

  it('tous les fichiers relus : accepté', async () => {
    const { rejected } = await steps([write('a.js'), write('b.js'), read('a.js'), read('b.js'), finish(cited)]);
    assert.equal(rejected.length, 0);
  });

  it('un test passé couvre tous les fichiers', async () => {
    const pkg = { 'package.json': '{"scripts":{"test":"node -e 0"}}' };
    const pass = [{ kind: 'test', command: 'npm test', result: 'pass' }];
    const { rejected } = await steps([write('a.js'), write('b.js'), { tool: 'run_tests', args: {} }, finish(pass)], pkg);
    assert.equal(rejected.length, 0);
  });

  it('un fichier déplacé n\'a pas à être relu', async () => {
    const { rejected } = await steps([
      { tool: 'move_file', args: { path: 'a.js', dest: 'c.js' } },
      finish([{ kind: 'file', path: 'c.js' }]),
    ]);
    assert.equal(rejected.length, 0);
  });
});

describe('limites de résultat selon le moteur', () => {
  it('petite limite en local, grande sur le cloud', () => {
    assert.equal(resolveResultLimit({ engine: 'webllm' }), MAX_RESULT_CHARS);
    assert.equal(resolveResultLimit({ engine: 'cpu' }), MAX_RESULT_CHARS);
    assert.equal(resolveResultLimit({ engine: 'claude' }), CLOUD_RESULT_CHARS);
    assert.equal(resolveResultLimit({ engine: 'openai-compat' }), CLOUD_RESULT_CHARS);
  });

  it('moteur inconnu : limite prudente', () => {
    assert.equal(resolveResultLimit({}), MAX_RESULT_CHARS);
  });

  it('un réglage explicite prime', () => {
    assert.equal(resolveResultLimit({ engine: 'claude', explicit: 1000 }), 1000);
  });

  const big = { 'gros.txt': Array.from({ length: 300 }, (_, i) => `ligne ${i} ${'x'.repeat(40)}`).join('\n') };
  const reading = n => (n === 1 ? { tool: 'read_file', args: { path: 'gros.txt' } } : null);

  it('un modèle cloud lit en une fois ce qu\'un modèle local doit paginer', async () => {
    const cloud = await run(reading, { files: big, config: { model: { primary: 'claude', engines: {} } } });
    const local = await run(reading, { files: big, config: { model: { primary: 'webllm', engines: {} } } });
    assert.ok(!cloud.seen[1].includes('tronqué'), 'cloud complet');
    assert.ok(local.seen[1].includes('tronqué'), 'local paginé');
  });
});
