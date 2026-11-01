'use strict';
/**
 * Non-régression des ADR-029 à 031 : isolation de l'exécution, compaction par paliers,
 * carte du code.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-compaction-'));
process.env.APPDATA = tmpBase;

const { runCommand, safeEnv } = require('../src/harness/tools/run-command');
const { runShell, approveCommand } = require('../src/harness/tools/shell');
const { dispatch } = require('../src/harness/tools/index');
const { makeGuard } = require('../src/harness/safety/path-guard');
const { runAgent } = require('../src/harness/agent');
const { buildCodeMap } = require('../src/harness/context/codemap');
const { buildContext } = require('../src/harness/context/builder');

after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

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

describe('environnement des commandes', () => {
  function withEnv(vars, fn) {
    Object.assign(process.env, vars);
    return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(vars)) delete process.env[k]; });
  }

  it('retire les secrets et garde le reste', () => withEnv({
    ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x', GITHUB_TOKEN: 'x', DB_PASSWORD: 'x', AWS_SECRET_ACCESS_KEY: 'x',
    npm_config__authToken: 'x', BENCH_LIBRE: 'ok', TOKENIZERS_DIR: 'ok',
  }, () => {
    const env = safeEnv();
    for (const name of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD', 'AWS_SECRET_ACCESS_KEY', 'npm_config__authToken']) {
      assert.equal(env[name], undefined, name);
    }
    assert.equal(env.BENCH_LIBRE, 'ok');
    assert.equal(env.TOKENIZERS_DIR, 'ok');
    assert.ok(env.PATH || env.Path);
  }));

  it('une commande ne lit pas une clé du harness', () => withEnv({ ANTHROPIC_API_KEY: 'cle-secrete' }, async () => {
    const r = await runCommand('node -e "console.log(process.env.ANTHROPIC_API_KEY || \'absente\')"', { cwd: tmpBase, timeout: 10000 });
    assert.equal(r.stdout.trim(), 'absente');
  }));

  it('un processus d\'arrière-plan non plus', () => withEnv({ ANTHROPIC_API_KEY: 'cle-secrete' }, async () => {
    const dir = project({ 'a.txt': 'x' });
    const r = await dispatch('start_process', {
      name: `env-${Date.now()}`,
      command: 'node -e "require(\'fs\').writeFileSync(\'out.txt\', process.env.ANTHROPIC_API_KEY || \'absente\')"',
    }, makeGuard(dir), { enableShell: true }, () => {}, dir);
    assert.equal(r.ok, true);
    for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'out.txt')); i++) {
      await new Promise(res => setTimeout(res, 50));
    }
    await new Promise(res => setTimeout(res, 50));
    assert.equal(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8'), 'absente');
  }));
});

describe('approbation des commandes', () => {
  const asking = (answer) => {
    const asked = [];
    return { asked, config: { enableShell: true, requestApproval: async (p) => { asked.push(p); return answer; } } };
  };

  for (const command of ['npm test', 'git status', 'git diff src/a.js', 'npm run lint', 'node --version']) {
    it(`laisse passer : ${command}`, async () => {
      const { asked, config } = asking(false);
      assert.equal(await approveCommand(command, config), null);
      assert.equal(asked.length, 0);
    });
  }

  for (const command of ['curl https://exemple.test', 'npm test && curl x', 'npm test; rm a', 'git status | tee a', 'git status > a', 'npm install', 'git push', 'gitk', 'echo $HOME']) {
    it(`demande pour : ${command}`, async () => {
      const { asked, config } = asking(false);
      assert.deepEqual(await approveCommand(command, config), { ok: false, error: 'REJETÉ_PAR_UTILISATEUR' });
      assert.equal(asked.length, 1);
      assert.equal(asked[0].isCommand, true);
      assert.ok(asked[0].patch.includes(command));
    });
  }

  it('un refus empêche run_shell de s\'exécuter', async () => {
    const dir = project({ 'a.txt': 'x' });
    const { config } = asking(false);
    const r = await runShell({ command: 'node -e "require(\'fs\').writeFileSync(\'b.txt\',\'x\')"' }, dir, config);
    assert.equal(r.error, 'REJETÉ_PAR_UTILISATEUR');
    assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
  });

  it('un accord laisse run_shell s\'exécuter', async () => {
    const dir = project({ 'a.txt': 'x' });
    const { config } = asking(true);
    const r = await runShell({ command: 'node -e "console.log(1)"' }, dir, config);
    assert.equal(r.ok, true);
  });

  it('un refus empêche start_process de démarrer', async () => {
    const dir = project({ 'a.txt': 'x' });
    const { config } = asking(false);
    const r = await dispatch('start_process', { command: 'node -e 0' }, makeGuard(dir), config, () => {}, dir);
    assert.equal(r.error, 'REJETÉ_PAR_UTILISATEUR');
  });

  it('sans mode d\'approbation, rien n\'est demandé', async () => {
    assert.equal(await approveCommand('curl x', { enableShell: true }), null);
  });
});

describe('compaction par paliers', () => {
  /** Rejoue `steps` lectures en capturant, à chaque appel, le texte de la requête. */
  async function capture(steps, config = {}) {
    const dir = project({ 'a.js': 'const a = 1;\n', 'b.js': 'const b = 2;\n' });
    const requests = [];
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: { maxSteps: steps + 2, ...config }, llmGenerate: async (messages) => {
      requests.push(messages.map(m => String(m.content)));
      n++;
      if (n > steps) return '{"tool":"finish","args":{"summary":"fin"}}';
      return JSON.stringify({ tool: 'list_dir', args: { path: '.' } });
    } });
    return requests;
  }

  const isPrefix = (a, b) => a.every((m, i) => m === b[i]);

  it('ne touche à rien sous le seuil', async () => {
    const requests = await capture(8);
    assert.ok(!requests.at(-1).some(m => m.includes('Note système')));
  });

  it('entre deux paliers, chaque requête prolonge la précédente', async () => {
    const requests = await capture(30);
    const breaks = requests.slice(1).filter((r, i) => !isPrefix(requests[i], r)).length;
    assert.ok(breaks >= 1, 'au moins un palier sur 30 étapes');
    assert.ok(breaks <= 4, `${breaks} ruptures : la compaction doit rester rare`);
  });

  it('un palier laisse plusieurs étapes avant le suivant', async () => {
    const requests = await capture(30);
    const breakAt = requests.map((r, i) => (i > 0 && !isPrefix(requests[i - 1], r) ? i : -1)).filter(i => i >= 0);
    for (let i = 1; i < breakAt.length; i++) {
      assert.ok(breakAt[i] - breakAt[i - 1] >= 4, `paliers trop proches : ${breakAt}`);
    }
  });

  it('la taille de la requête reste bornée par le seuil', async () => {
    const requests = await capture(40);
    assert.ok(Math.max(...requests.map(r => r.length)) <= 27);
  });

  it('la note garde l\'état de tâche et alterne correctement les rôles', async () => {
    const dir = project({ 'a.js': 'x\n' });
    let last;
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: { maxSteps: 20 }, llmGenerate: async (messages) => {
      last = messages.map(m => m.role);
      if (messages.some(m => String(m.content).includes('ÉTAT DE LA TÂCHE'))) n++;
      return JSON.stringify({ tool: 'list_dir', args: { path: '.' } });
    } });
    assert.ok(n > 0, 'état présent');
    assert.deepEqual(last.slice(0, 4), ['system', 'user', 'user', 'assistant']);
    assert.equal(last.at(-1), 'user');
  });

  it('un fichier sorti de la fenêtre est relu réellement', async () => {
    const dir = project({ 'a.js': 'CONTENU_REEL\n' });
    const seen = [];
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: { maxSteps: 22 }, llmGenerate: async (messages) => {
      seen.push(String(messages.at(-1).content));
      n++;
      if (n === 1 || n === 20) return JSON.stringify({ tool: 'read_file', args: { path: 'a.js' } });
      if (n > 20) return '{"tool":"finish","args":{"summary":"fin"}}';
      return JSON.stringify({ tool: 'list_dir', args: { path: '.' } });
    } });
    assert.ok(seen[20].includes('CONTENU_REEL'), seen[20].slice(0, 120));
  });

  it('une relecture encore visible reste économisée', async () => {
    const dir = project({ 'a.js': 'CONTENU_REEL\n' });
    const seen = [];
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: {}, llmGenerate: async (messages) => {
      seen.push(String(messages.at(-1).content));
      n++;
      if (n <= 2) return JSON.stringify({ tool: 'read_file', args: { path: 'a.js' } });
      return '{"tool":"finish","args":{"summary":"fin"}}';
    } });
    assert.ok(seen[2].includes('déjà lu'));
  });
});

describe('carte du code', () => {
  const files = {
    'src/central.js': 'function publique() {}\nfunction _interne() {}\nmodule.exports = { publique };\n',
    'src/a.js': "const c = require('./central');\nfunction a1() {}\nmodule.exports = { a1 };\n",
    'src/b.js': "const c = require('./central');\nfunction b1() {}\nmodule.exports = { b1 };\n",
    'tests/a.test.js': 'function dansTest() {}\n',
    'fixtures/f.js': 'function dansFixture() {}\n',
  };

  it('classe les fichiers par nombre d\'importeurs', () => {
    const lines = buildCodeMap(project(files)).split('\n');
    assert.ok(lines[1].startsWith('src/central.js [importé par 2]'), lines[1]);
  });

  it('montre le public et cache l\'interne', () => {
    const map = buildCodeMap(project(files));
    assert.ok(map.includes('publique'));
    assert.ok(!map.includes('_interne'));
  });

  it('écarte les tests et les fixtures', () => {
    const map = buildCodeMap(project(files));
    assert.ok(!map.includes('dansTest'));
    assert.ok(!map.includes('dansFixture'));
  });

  it('compte les importeurs avec une racine écrite en barres obliques', () => {
    const lines = buildCodeMap(project(files).replace(/\\/g, '/')).split('\n');
    assert.ok(lines[1].includes('[importé par 2]'), lines[1]);
  });

  it('ignore un worktree et node_modules présents dans le projet', () => {
    const map = buildCodeMap(project({
      ...files,
      '.claude/worktrees/copie/src/copie.js': 'function dansWorktree() {}\n',
      'node_modules/lib/index.js': 'function dansDependance() {}\n',
    }));
    assert.ok(!map.includes('dansWorktree'));
    assert.ok(!map.includes('dansDependance'));
  });

  it('limite le nombre de symboles par fichier', () => {
    const many = Array.from({ length: 12 }, (_, i) => `function f${i}() {}`).join('\n');
    const map = buildCodeMap(project({ 'src/gros.js': many }));
    assert.ok(map.includes('(+4)'), map);
  });

  it('reste vide sur un projet sans symbole', () => {
    assert.equal(buildCodeMap(project({ 'a.txt': 'x' })), '');
  });

  it('entre dans le contexte en respectant le budget', async () => {
    const context = await buildContext({ task: 'tâche', projectRoot: project(files), maxChars: 12000 });
    assert.ok(context.includes('## Carte du code'));
    const small = await buildContext({ task: 'tâche', projectRoot: project(files), maxChars: 400 });
    assert.ok(small.length <= 400);
  });
});
