'use strict';
/**
 * Non-régression du lot de fiabilité de la boucle agent : chaque test reproduit un défaut
 * observé (sortie d'échec perdue, code altéré, succès fictif, cache périmé…).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fiabilite-'));
process.env.APPDATA = tmpBase; // sessions et index RAG isolés

// agent.js déstructure ces fonctions à son chargement : les espions passent avant le require
const browser = require('../src/harness/tools/browser');
const lsp     = require('../src/harness/tools/lsp');
const disposals = { browser: 0, lsp: 0 };
browser.disposeBrowser = async () => { disposals.browser++; };
lsp.disposeLsp         = async () => { disposals.lsp++; };

const { extractToolCall } = require('../src/harness/parser');
const { runAgent }        = require('../src/harness/agent');
const { LlmRouter }       = require('../src/harness/llm/router');
const { makeGuard }       = require('../src/harness/safety/path-guard');
const { replaceCode }     = require('../src/harness/tools/fs');
const { _extractAllToolCalls } = require('../src/harness/tools/fix-loop');
const { _keepEnds }       = require('../src/harness/tools/test-runner');
const { orchestrate }     = require('../src/harness/tools/orchestrate');

let counter = 0;
function project(files) {
  const dir = path.join(tmpBase, `p${++counter}`);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

/** LLM rejouant un script ; `seen` reçoit les messages de chaque appel. */
function scripted(steps, seen = []) {
  const queue = [...steps];
  return async (messages) => {
    seen.push(messages);
    const next = queue.shift();
    if (next === undefined) return '{"tool":"finish","args":{"summary":"fin"}}';
    return typeof next === 'string' ? next : JSON.stringify(next);
  };
}

const lastUser = (messages) => String(messages.filter(m => m.role === 'user').pop().content);

const failingTests = {
  'package.json': '{"name":"x","scripts":{"test":"node t.js"}}',
  't.js': 'console.log("FAIL src/cart.js:42 expected 10 got 12"); process.exit(1);',
};

after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

describe('parser — le contenu valide reste intact', () => {
  const write = (content) => JSON.stringify({ tool: 'write_file', args: { path: 'a', content } });

  it('accepte un content contenant des fences markdown', () => {
    const content = '# T\n```js\nconst a = 1;\n```\n';
    assert.equal(extractToolCall(write(content)).args.content, content);
  });

  it('accepte des fences dans le content derrière du texte libre', () => {
    const content = '```js\nx\n```';
    assert.equal(extractToolCall(`Voici :\n${write(content)}`).args.content, content);
  });

  it('ne retire pas une virgule située dans une chaîne', () => {
    const content = 'const a = [1, 2, ];\nconst b = {x: 1, };';
    assert.equal(extractToolCall(write(content)).args.content, content);
  });

  it('préserve aussi les chaînes quand le JSON doit être réparé', () => {
    const r = extractToolCall('{"tool":"write_file","args":{"content":"[1, ]",},}');
    assert.equal(r.args.content, '[1, ]');
  });

  it('répare toujours les retours à la ligne littéraux des petits modèles', () => {
    const r = extractToolCall('{"tool":"write_file","args":{"content":"a\nb",}}');
    assert.equal(r.args.content, 'a\nb');
  });

  it('extrait toujours un appel dans une fence précédée de texte avec accolades', () => {
    const r = extractToolCall('Utilise {x} :\n```json\n{"tool":"read_file","args":{"path":"a"}}\n```');
    assert.equal(r.tool, 'read_file');
  });

  it('fix_loop ne retire pas non plus une virgule située dans une chaîne', () => {
    const [call] = _extractAllToolCalls(JSON.stringify({ tool: 'write_file', args: { content: '[1, ]' } }));
    assert.equal(call.args.content, '[1, ]');
  });
});

describe('replace_code — motifs $ dans new_string', () => {
  for (const [label, content, old_string] of [
    ['exact',       "const X = 1;\nconst tail = 'FIN';\n", 'const X = 1;'],
    ['CRLF',        'a\r\nconst X = 1;\r\nb\r\n',          'a\nconst X = 1;'],
    ['fuzzy',       'const X = 1;   \nb\n',                'const X = 1;\nb'],
  ]) {
    it(`insère $' littéralement (${label})`, async () => {
      const dir = project({ 'a.js': content });
      const r = await replaceCode({ path: 'a.js', old_string, new_string: "s = '$' + n; $& $`" }, makeGuard(dir), {}, () => {});
      assert.equal(r.ok, true);
      const written = fs.readFileSync(path.join(dir, 'a.js'), 'utf8');
      assert.ok(written.includes("s = '$' + n; $& $`"), written);
    });
  }
});

describe('boucle agent — information transmise au modèle', () => {
  it('la sortie des tests en échec atteint le modèle', async () => {
    const seen = [];
    await runAgent({ task: 't', projectRoot: project(failingTests), config: {},
      llmGenerate: scripted([{ tool: 'run_tests', args: {} }], seen) });
    const message = lastUser(seen[1]);
    assert.ok(message.includes('TESTS_ÉCHOUÉS'), message);
    assert.ok(message.includes('src/cart.js:42 expected 10 got 12'), message);
  });

  it('le hint de BLOC_INTROUVABLE atteint le modèle', async () => {
    const seen = [];
    await runAgent({ task: 't', projectRoot: project({ 'a.js': 'const vraie = 1;\n' }), config: {},
      llmGenerate: scripted([{ tool: 'replace_code', args: { path: 'a.js', old_string: 'absent', new_string: 'x' } }], seen) });
    assert.ok(lastUser(seen[1]).includes('const vraie = 1;'));
  });

  it('une sortie longue garde son début et sa fin dans la limite', () => {
    const cut = _keepEnds(`DEBUT${'x'.repeat(20000)}FIN`, 6000);
    assert.ok(cut.length <= 6000);
    assert.ok(cut.startsWith('DEBUT'));
    assert.ok(cut.endsWith('FIN'));
  });

  it('une relecture après modification par le shell renvoie le contenu réel', async () => {
    const seen = [];
    const dir = project({ 'a.js': 'V1\n' });
    await runAgent({ task: 't', projectRoot: dir, config: { enableShell: true }, llmGenerate: scripted([
      { tool: 'read_file', args: { path: 'a.js' } },
      { tool: 'run_shell', args: { command: 'node -e "require(\'fs\').writeFileSync(\'a.js\',\'V2\')"' } },
      { tool: 'read_file', args: { path: 'a.js' } },
    ], seen) });
    assert.ok(lastUser(seen[3]).includes('V2'));
  });

  it('une relecture sans changement reste économisée', async () => {
    const seen = [];
    await runAgent({ task: 't', projectRoot: project({ 'a.js': 'V1\n' }), config: {}, llmGenerate: scripted([
      { tool: 'read_file', args: { path: 'a.js' } },
      { tool: 'read_file', args: { path: 'a.js' } },
    ], seen) });
    assert.ok(lastUser(seen[2]).includes('déjà lu'));
  });
});

describe('finish — preuve attestée par la trace', () => {
  const write = { tool: 'write_file', args: { path: 'a.js', content: 'neuf' } };
  const read  = { tool: 'read_file', args: { path: 'a.js' } };
  const finish = (checks) => ({ tool: 'finish', args: { summary: 'ok', checks } });
  const testPass = [{ kind: 'test', command: 'npm test', result: 'pass' }];
  const passing = { 'a.js': 'x\n', 'package.json': '{"scripts":{"test":"node -e 0"}}' };

  async function run(script, files = passing) {
    const events = [];
    const result = await runAgent({ task: 't', projectRoot: project(files), config: {},
      llmGenerate: scripted(script), onEvent: e => events.push(e) });
    return { result, rejected: events.filter(e => e.type === 'finish_rejected').length, events };
  }

  it('refuse un test déclaré mais jamais lancé', async () => {
    const { rejected } = await run([write, finish(testPass), finish(testPass)]);
    assert.equal(rejected, 1);
  });

  it('refuse un test lancé avant la dernière modification', async () => {
    const { rejected } = await run([{ tool: 'run_tests', args: {} }, write, finish(testPass), finish(testPass)]);
    assert.equal(rejected, 1);
  });

  it('accepte un test réellement lancé après la modification', async () => {
    const { result, rejected } = await run([write, { tool: 'run_tests', args: {} }, finish(testPass)]);
    assert.equal(rejected, 0);
    assert.equal(result.unverified, undefined);
  });

  it('refuse un fichier cité mais jamais relu', async () => {
    const { rejected } = await run([write, finish([{ kind: 'file', path: 'a.js' }]), finish([{ kind: 'file', path: 'a.js' }])]);
    assert.equal(rejected, 1);
  });

  it('accepte une relecture écrite sous une autre forme de chemin', async () => {
    const { rejected } = await run([write, { tool: 'read_file', args: { path: './a.js' } }, finish([{ kind: 'file', path: '.\\a.js' }])]);
    assert.equal(rejected, 0);
  });

  it('accepte un fichier supprimé, qui ne peut plus être relu', async () => {
    const { rejected } = await run([{ tool: 'delete_file', args: { path: 'a.js' } }, finish([{ kind: 'file', path: 'a.js' }])]);
    assert.equal(rejected, 0);
  });

  it('signale une fin acceptée sans preuve après la relance', async () => {
    const { result, events } = await run([write, finish(testPass), finish(testPass)]);
    assert.equal(result.ok, true);
    assert.equal(result.unverified, true);
    assert.ok(events.some(e => e.type === 'note_user' && e.level === 'warn'));
  });
});

describe('sous-agents', () => {
  const failingLlm = (seen) => {
    let calls = 0;
    const llm = async (messages) => {
      calls++;
      if (messages.some(m => String(m.content).includes('ROLE SPÉCIALISÉ'))) throw new Error('HTTP 500');
      if (calls === 1) return JSON.stringify(seen.spawn);
      seen.parent = lastUser(messages);
      return '{"tool":"finish","args":{"summary":"fin"}}';
    };
    return llm;
  };

  for (const [label, spawn] of [
    ['spawn_agent',    { tool: 'spawn_agent', args: { role: 'analyzer', task: 'analyse' } }],
    ['spawn_parallel', { tool: 'spawn_parallel', args: { agents: [{ role: 'analyzer', task: 'analyse' }] } }],
  ]) {
    it(`${label} : un échec du sous-agent est transmis au parent`, async () => {
      const seen = { spawn };
      const llm = failingLlm(seen);
      await runAgent({ task: 't', projectRoot: project({ 'a.js': 'x\n' }), config: { _llmGenerate: llm }, llmGenerate: llm });
      assert.ok(seen.parent.startsWith('Erreur outil'), seen.parent);
      assert.ok(seen.parent.includes('LLM_ERREUR'), seen.parent);
    });
  }

  it('orchestrate : un échec de phase est transmis avec un code d\'erreur', async () => {
    const llm = async () => { throw new Error('HTTP 500'); };
    const r = await orchestrate({ objective: 'o', phases: [{ agents: [{ role: 'analyzer', task: 't' }] }] },
      { _llmGenerate: llm }, () => {}, project({ 'a.js': 'x\n' }));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'ORCHESTRATION_ÉCHOUÉE');
    assert.ok(r.summary.includes('LLM_ERREUR'));
  });
});

describe('fin de run — ressources et session', () => {
  before(() => { disposals.browser = 0; disposals.lsp = 0; });

  it('un sous-agent ne ferme ni le navigateur ni le LSP partagés', async () => {
    await runAgent({ task: 't', projectRoot: project({ 'a.js': 'x\n' }), config: { _subAgent: true },
      llmGenerate: scripted([]) });
    assert.deepEqual(disposals, { browser: 0, lsp: 0 });
  });

  it('l\'agent principal les ferme, y compris sur erreur LLM', async () => {
    const result = await runAgent({ task: 't', projectRoot: project({ 'a.js': 'x\n' }), config: {},
      llmGenerate: async () => { throw new Error('HTTP 500'); } });
    assert.deepEqual(disposals, { browser: 1, lsp: 1 });
    assert.ok(result.sessionId, 'session identifiée');
    const sessions = path.join(tmpBase, 'code-harness', 'sessions');
    const files = fs.readdirSync(sessions).map(f => fs.readFileSync(path.join(sessions, f), 'utf8'));
    assert.ok(files.some(f => f.includes('LLM_ERREUR')), 'échec persisté en session');
  });
});

describe('router — annulation', () => {
  const engines = (calls) => {
    const make = (name, fail) => ({ factory: () => ({
      isReady: async () => ({ ready: true }),
      generate: async () => {
        calls.push(name);
        if (fail) throw fail;
        return 'réponse';
      },
    }) });
    return (fail) => ({ a: make('a', fail), b: make('b', null) });
  };

  it('ne sollicite pas le moteur suivant après un Stop', async () => {
    const calls = [];
    const abort = new AbortController();
    abort.abort();
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await assert.rejects(
      new LlmRouter(['a', 'b'], engines(calls)(err), {}).generate([], { signal: abort.signal }),
      { name: 'AbortError' },
    );
    assert.deepEqual(calls, ['a']);
  });

  it('bascule toujours sur le moteur suivant après une panne', async () => {
    const calls = [];
    const out = await new LlmRouter(['a', 'b'], engines(calls)(new Error('HTTP 500')), {}).generate([], {});
    assert.equal(out, 'réponse');
    assert.deepEqual(calls, ['a', 'b']);
  });
});
