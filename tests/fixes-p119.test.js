'use strict';

// Phase 119 — non-régression des bugs relevés en revue de code.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const Module = require('module');
const { execFileSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p119-'));
process.env.HARNESS_DATA_DIR = path.join(SANDBOX, 'data');

const { makeGuard }    = require('../src/harness/safety/path-guard');
const { snapshot, fileKey, getBackupDir } = require('../src/harness/safety/backup');
const { getIgnore }    = require('../src/harness/safety/harnessignore');
const fsTools          = require('../src/harness/tools/fs');
const { dispatch }     = require('../src/harness/tools');

let _n = 0;
function project(files = {}) {
  const root = path.join(SANDBOX, `proj${++_n}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { root, guard: makeGuard(root), read: rel => fs.readFileSync(path.join(root, rel), 'utf8') };
}
const run = (p, tool, args, config = {}) => dispatch(tool, args, p.guard, config, () => {}, p.root);

after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

describe('validation des arguments', () => {
  it('replace_code peut supprimer un bloc (new_string vide)', async () => {
    const p = project({ 'a.js': 'keep\nremove\n' });
    const r = await run(p, 'replace_code', { path: 'a.js', old_string: 'remove\n', new_string: '' });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.read('a.js'), 'keep\n');
  });

  it('write_file peut créer un fichier vide', async () => {
    const p = project();
    const r = await run(p, 'write_file', { path: '__init__.py', content: '' });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.read('__init__.py'), '');
  });

  it('un contenu absent reste refusé', async () => {
    const r = await run(project(), 'write_file', { path: 'a' });
    assert.match(r.error, /ARGUMENT_MANQUANT/);
  });
});

describe('path-guard', () => {
  it('refuse un nouveau fichier sous un lien qui sort du projet', (t) => {
    const p = project();
    const outside = project();
    try { fs.symlinkSync(outside.root, path.join(p.root, 'link'), 'junction'); }
    catch { return t.skip('liens non disponibles'); }
    assert.throws(() => p.guard('link/new.txt'), /PATH_GUARD/);
    assert.throws(() => p.guard('link/sub/new.txt'), /PATH_GUARD/);
  });

  it('accepte une racine qui est elle-même un lien', (t) => {
    const p = project({ 'a.txt': 'x' });
    const alias = path.join(SANDBOX, `alias${++_n}`);
    try { fs.symlinkSync(p.root, alias, 'junction'); }
    catch { return t.skip('liens non disponibles'); }
    assert.doesNotThrow(() => makeGuard(alias)('a.txt'));
  });
});

describe('.harnessignore', () => {
  const files = { '.harnessignore': '/secret.env\n**/token.txt\n', 'secret.env': 'KEY=1\n', 'token.txt': 't\n' };

  it('un chemin détourné ne contourne pas une règle ancrée', async () => {
    const p = project(files);
    for (const rel of ['./secret.env', 'x/../secret.env', path.join(p.root, 'secret.env')]) {
      const r = await run(p, 'read_file', { path: rel });
      assert.match(String(r.error), /FICHIER_IGNORÉ/, rel);
    }
  });

  it('**/ couvre aussi la racine', () => {
    assert.equal(getIgnore(project(files).root).isIgnored('token.txt'), true);
  });

  it('replace_code et diff_file ne révèlent pas un fichier ignoré', async () => {
    const p = project(files);
    snapshot(path.join(p.root, 'secret.env'));
    for (const r of [
      await run(p, 'replace_code', { path: 'secret.env', old_string: 'zzz', new_string: 'y' }),
      await run(p, 'diff_file', { path: 'secret.env' }),
    ]) {
      assert.match(String(r.error), /FICHIER_IGNORÉ/);
      assert.ok(!JSON.stringify(r).includes('KEY=1'));
    }
  });

  it('batch_replace limité à un sous-dossier respecte les règles et les chemins du projet', async () => {
    const p = project({ '.harnessignore': 'src/private.js\n', 'src/private.js': 'old\n', 'src/a.js': 'old\n' });
    const r = await run(p, 'batch_replace', { pattern: 'old', replacement: 'new', path: 'src' });
    assert.deepEqual(r.results.map(x => x.path), ['src/a.js']);
    assert.equal(p.read('src/private.js'), 'old\n');
  });

  it('batch_replace accepte un fichier comme cible', async () => {
    const p = project({ 'a.js': 'old\n' });
    const r = await run(p, 'batch_replace', { pattern: 'old', replacement: 'new', path: 'a.js' });
    assert.equal(r.files_modified, 1);
  });
});

describe('replace_code', () => {
  it('le repli tolérant ne touche pas les autres lignes', async () => {
    const p = project({ 'a.md': 'titre  \nfoo   \nbar\nfin  \n' });
    const r = await run(p, 'replace_code', { path: 'a.md', old_string: 'foo\nbar', new_string: 'baz' });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.read('a.md'), 'titre  \nbaz\nfin  \n');
  });

  it('conserve des fins de ligne CRLF homogènes', async () => {
    const p = project({ 'a.js': 'un\r\ndeux\r\n' });
    await run(p, 'replace_code', { path: 'a.js', old_string: 'un', new_string: 'un\nbis' });
    assert.equal(p.read('a.js'), 'un\r\nbis\r\ndeux\r\n');
  });

  it('bloc commençant par un saut de ligne dans un fichier CRLF', async () => {
    const p = project({ 'a.js': 'un\r\ndeux\r\n' });
    await run(p, 'replace_code', { path: 'a.js', old_string: '\ndeux', new_string: '\ntrois' });
    assert.equal(p.read('a.js'), 'un\r\ntrois\r\n');
  });

  it('repli tolérant sur un fichier CRLF', async () => {
    const p = project({ 'a.js': 'x  \r\nfoo \r\nbar\r\n' });
    await run(p, 'replace_code', { path: 'a.js', old_string: 'foo\nbar', new_string: 'a\nb' });
    assert.equal(p.read('a.js'), 'x  \r\na\r\nb\r\n');
  });
});

describe('backups', () => {
  it('une suppression est annulée si la sauvegarde échoue', async () => {
    const p = project({ 'a.txt': 'précieux' });
    const previous = process.env.HARNESS_DATA_DIR;
    // Un fichier à la place du dossier de données rend toute sauvegarde impossible
    const blocker = path.join(SANDBOX, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env.HARNESS_DATA_DIR = blocker;
    try {
      for (const r of [
        await fsTools.deleteFile({ path: 'a.txt' }, p.guard),
        await fsTools.writeFile({ path: 'a.txt', content: 'x' }, p.guard),
        await fsTools.replaceCode({ path: 'a.txt', old_string: 'précieux', new_string: 'x' }, p.guard),
      ]) assert.match(String(r.error), /BACKUP_ÉCHOUÉ/);
      assert.equal(p.read('a.txt'), 'précieux');
    } finally {
      process.env.HARNESS_DATA_DIR = previous;
    }
  });

  it('deux sauvegardes dans la même milliseconde ne s\'écrasent pas', () => {
    const p = project({ 'a.txt': 'v1' });
    const abs = path.join(p.root, 'a.txt');
    const RealDate = Date;
    global.Date = class extends RealDate { constructor() { super(1700000000000); } };
    try {
      const first = snapshot(abs);
      fs.writeFileSync(abs, 'v2');
      const second = snapshot(abs);
      assert.notEqual(first.dest, second.dest);
      assert.equal(fs.readFileSync(first.dest, 'utf8'), 'v1');
    } finally { global.Date = RealDate; }
  });

  it('maxBackups de la config est respecté à l\'écriture', async () => {
    const p = project({ 'a.txt': '0' });
    for (let i = 1; i <= 4; i++) await run(p, 'write_file', { path: 'a.txt', content: String(i) }, { maxBackups: 2 });
    assert.equal(fs.readdirSync(path.join(getBackupDir(), fileKey(path.join(p.root, 'a.txt')))).length, 2);
  });

  it('restaurer le plus ancien backup fonctionne quand la rétention est pleine', async () => {
    const p = project({ 'a.txt': '0' });
    for (let i = 1; i <= 50; i++) await run(p, 'write_file', { path: 'a.txt', content: String(i) });
    const r = await run(p, 'restore_file', { path: 'a.txt', backup_index: 49 });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.read('a.txt'), '0');
  });
});

describe('diff_file', () => {
  it('voit une modification au-delà de la 500e ligne', async () => {
    const lines = Array.from({ length: 900 }, (_, i) => `l${i}`);
    const p = project({ 'a.txt': lines.join('\n') });
    await run(p, 'replace_code', { path: 'a.txt', old_string: 'l800\n', new_string: 'CHANGÉ\n' });
    const r = await run(p, 'diff_file', { path: 'a.txt' });
    assert.equal(r.added, 1);
    assert.equal(r.removed, 1);
    assert.ok(r.diff_lines.some(d => d.text === 'CHANGÉ'));
  });
});

describe('outils git', () => {
  function repo() {
    const p = project({ 'a.txt': 'a\n' });
    const git = (...a) => execFileSync('git', a, { cwd: p.root, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-qm', 'init');
    return { ...p, git };
  }

  it('git_status garde le chemin entier d\'un fichier modifié', async () => {
    const p = repo();
    fs.writeFileSync(path.join(p.root, 'a.txt'), 'b\n');
    const r = await run(p, 'git_status', {});
    assert.deepEqual(r.files, [{ status: 'M', path: 'a.txt' }]);
  });

  it('git_commit transmet le message tel quel', async () => {
    const p = repo();
    fs.writeFileSync(path.join(p.root, 'a.txt'), 'b\n');
    const message = 'fix: l\'espace & les "guillemets" %PATH%';
    const r = await run(p, 'git_commit', { message, paths: ['a.txt'] }, { enableGitWrite: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.git('log', '-1', '--format=%s').trim(), message);
  });

  it('git_diff n\'exécute pas de commande glissée dans le chemin', async () => {
    const p = repo();
    await run(p, 'git_diff', { path: 'a.txt & echo x> pwned.txt' });
    await run(p, 'git_diff', { path: 'a.txt; echo x> pwned.txt' });
    assert.equal(fs.existsSync(path.join(p.root, 'pwned.txt')), false);
  });
});

describe('commandes', () => {
  it('run_tests refuse une commande chaînée', async () => {
    const p = project();
    for (const command of ['npm test && echo x> pwned.txt', 'npm test & echo x> pwned.txt', 'pytest\necho x> pwned.txt']) {
      const r = await run(p, 'run_tests', { command });
      assert.match(String(r.error), /COMMANDE_TEST_NON_AUTORISÉE/, command);
    }
    assert.equal(fs.existsSync(path.join(p.root, 'pwned.txt')), false);
  });

  it('format_file refuse un chemin capable de sortir des guillemets', async () => {
    const p = project();
    const r = await run(p, 'format_file', { path: 'a" & echo x> pwned.txt & ".js' });
    assert.equal(r.ok, false);
    assert.match(r.error, /CHEMIN_NON_FORMATABLE/);
  });

  it('start_process applique la liste des commandes bloquées', async () => {
    const r = await run(project(), 'start_process', { command: 'shutdown /?' }, { enableShell: true });
    assert.match(String(r.error), /COMMANDE_BLOQUÉE/);
  });

  it('start_process résout cwd depuis le projet et un arrêt manuel reste « stopped »', async () => {
    const p = project({ 'sub/x': '' });
    const config = { enableShell: true };
    const r = await run(p, 'start_process', { command: 'node -e "setTimeout(()=>{},20000)"', cwd: 'sub', name: 'p119' }, config);
    assert.equal(r.cwd, path.join(p.root, 'sub'));
    await run(p, 'stop_process', { name: 'p119' }, config);
    await new Promise(res => setTimeout(res, 1500));
    assert.equal((await run(p, 'get_output', { name: 'p119' }, config)).status, 'stopped');
  });
});

describe('fix_loop', () => {
  it('s\'arrête sans appeler le modèle quand les tests ne peuvent pas être lancés', async () => {
    let calls = 0;
    const r = await run(project(), 'fix_loop', {}, { _llmGenerate: async () => { calls++; return ''; } });
    assert.equal(calls, 0);
    assert.match(r.error, /RUNNER_NON_DÉTECTÉ/);
  });

  it('batch_replace sans projectRoot reste dans le projet gardé', () => {
    const { batchReplace } = require('../src/harness/tools/batch-replace');
    const p = project({ 'only.txt': 'MARQUEUR_P119' });
    const r = batchReplace({ pattern: 'MARQUEUR_P119', replacement: 'ok' }, p.guard);
    assert.deepEqual(r.results.map(x => x.path), ['only.txt']);
  });
});

describe('add_rule / install_skill', () => {
  it('deux ajouts dans la même tâche sont tous les deux conservés', async () => {
    let saved = {};
    const config = { saveConfig: async u => { saved = { ...saved, ...u }; } };
    const p = project();
    await run(p, 'add_rule', { text: 'un' }, config);
    await run(p, 'add_rule', { text: 'deux' }, config);
    await run(p, 'install_skill', { name: 's1' }, config);
    await run(p, 'install_skill', { name: 's2' }, config);
    assert.equal(saved.customRules.length, 2);
    assert.equal(saved.customSkills.length, 2);
  });
});

describe('sous-agents', () => {
  it('le quota de plans du parent n\'est pas hérité', () => {
    const { _buildSubContext } = require('../src/harness/tools/spawn');
    const { PROFILES } = require('../src/harness/agents/profiles');
    const { subConfig } = _buildSubContext(Object.keys(PROFILES)[0], 't', { _planCalls: 2 }, () => {});
    assert.equal(subConfig._planCalls, 0);
  });
});

describe('objectifs', () => {
  it('une lecture groupée prouve un critère fichier', () => {
    const { evaluateGoalCompletion } = require('../src/harness/goals/policy');
    const goal = {
      criteria: [{ id: 'c1', status: 'met', verify: { kind: 'file', path: 'b.js' }, evidence: { kind: 'file', path: 'b.js' } }],
      budget: { maxSteps: 10, maxFiles: 5, maxNewDeps: 1 }, decisions: [],
    };
    const trace = [{ tool: 'read_file', args: { paths: ['a.js', 'b.js'] }, result: { ok: true, files: [{ path: 'a.js', ok: true }, { path: 'b.js', ok: true }] } }];
    assert.equal(evaluateGoalCompletion(goal, { trace }).ok, true);
  });
});

describe('réseau', () => {
  it('read_url bloque les adresses IPv6 locales', async () => {
    const { readUrl } = require('../src/harness/tools/read-url');
    for (const url of ['http://[::1]:9/', 'http://[::ffff:127.0.0.1]:9/', 'http://[fd00::1]:9/', 'http://[fe80::1]:9/', 'http://localhost.:9/']) {
      assert.equal((await readUrl({ url })).error, 'HÔTE_PRIVÉ_BLOQUÉ', url);
    }
  });

  it('read_url suit une redirection relative', async () => {
    const original = http.get;
    const seen = [];
    http.get = (url, _opts, cb) => {
      seen.push(String(url));
      const { EventEmitter } = require('events');
      const res = new EventEmitter();
      res.resume = () => {};
      res.statusCode = seen.length === 1 ? 302 : 200;
      res.headers = seen.length === 1 ? { location: '/suite' } : { 'content-type': 'text/plain' };
      process.nextTick(() => { cb(res); res.emit('data', Buffer.from('arrivé')); res.emit('end'); });
      return new EventEmitter();
    };
    try {
      const { readUrl } = require('../src/harness/tools/read-url');
      const r = await readUrl({ url: 'http://exemple.invalid/depart' });
      assert.equal(r.content, 'arrivé', r.error);
      assert.equal(seen[1], 'http://exemple.invalid/suite');
    } finally { http.get = original; }
  });

  it('generate_image signale un téléchargement en erreur au lieu d\'écrire la page', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/images/generations') {
        return res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${server.address().port}/absent` }] }));
      }
      res.statusCode = 404;
      res.end('not found');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const p = project({ 'img.png': 'ancienne' });
    try {
      const config = { customProviders: [{ name: 'x', apiKey: 'k', baseUrl: `http://127.0.0.1:${server.address().port}` }] };
      const r = await run(p, 'generate_image', { prompt: 'p', output: 'img.png' }, config);
      assert.equal(r.ok, false);
      assert.match(r.error, /HTTP_404/);
      assert.equal(p.read('img.png'), 'ancienne');
    } finally { server.close(); }
  });
});

describe('synthèse vocale', () => {
  it('le script PowerShell garde les accents et neutralise les apostrophes typographiques', async () => {
    const childProcess = require('child_process');
    const original = childProcess.spawn;
    let script = '';
    childProcess.spawn = (_bin, args) => {
      script = fs.readFileSync(args[args.length - 1], 'utf8');
      const { EventEmitter } = require('events');
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
      process.nextTick(() => proc.emit('close', 1));
      return proc;
    };
    delete require.cache[require.resolve('../src/harness/tools/speech')];
    try {
      const { generateSpeech } = require('../src/harness/tools/speech');
      const p = project();
      await generateSpeech({ text: 'été', voice: 'x’; calc; ‘', volume: 0 }, p.guard, p.root);
      assert.equal(script.charCodeAt(0), 0xFEFF);
      assert.ok(script.includes("SelectVoice('x’’; calc; ‘‘')"), script);
      assert.ok(script.includes('$tts.Volume = 0'));
    } finally {
      childProcess.spawn = original;
      delete require.cache[require.resolve('../src/harness/tools/speech')];
    }
  });
});

describe('moteur CPU', () => {
  const { CpuEngine } = require('../src/harness/llm/engines/cpu');

  // Reproduit l'API réelle de node-llama-cpp : une seule séquence, setChatHistory
  function fakeLlama(onPrompt = async () => 'ok') {
    const state = { sequences: 0, histories: [], options: [], active: 0, maxActive: 0 };
    const importFn = async () => ({
      getLlama: async () => ({
        loadModel: async () => ({
          createContext: async () => ({
            getSequence: () => { if (state.sequences++) throw new Error('No sequences left'); return {}; },
            dispose: async () => {},
          }),
          dispose: async () => {},
        }),
        dispose: async () => {},
      }),
      LlamaChatSession: function (opts) {
        let history = opts.systemPrompt ? [{ type: 'system', text: opts.systemPrompt }] : [];
        this.getChatHistory = () => history;
        this.setChatHistory = h => { history = h; state.histories.push(h); };
        this.dispose = () => {};
        this.prompt = async (text, options) => {
          state.options.push(options);
          state.maxActive = Math.max(state.maxActive, ++state.active);
          try { return await onPrompt(text, options); } finally { state.active--; }
        };
      },
    });
    return { state, engine: new CpuEngine({ modelPath: '/m.gguf' }, importFn) };
  }

  const turn = text => [{ role: 'system', content: 'S' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'r' }, { role: 'user', content: text }];

  it('reconstruit un historique avec l\'API de la bibliothèque, prompt système compris', async () => {
    const { engine, state } = fakeLlama();
    await engine.generate(turn('b'));
    await engine.generate([{ role: 'system', content: 'S' }, { role: 'user', content: 'autre' }, { role: 'assistant', content: 'r' }, { role: 'user', content: 'c' }]);
    assert.deepEqual(state.histories[0], [
      { type: 'system', text: 'S' }, { type: 'user', text: 'a' }, { type: 'model', response: ['r'] },
    ]);
    assert.equal(state.sequences, 1);
  });

  it('transmet le signal d\'arrêt et repart d\'une session neuve après un échec', async () => {
    let fail = false;
    const { engine, state } = fakeLlama(async () => { if (fail) throw new Error('stop'); return 'r'; });
    const signal = new AbortController().signal;
    await engine.generate([{ role: 'user', content: 'a' }], { signal });
    assert.equal(state.options[0].signal, signal);
    fail = true;
    const next = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'r' }, { role: 'user', content: 'b' }];
    await assert.rejects(engine.generate(next));
    fail = false;
    await engine.generate(next);
    assert.equal(state.histories.length, 1, 'la session interrompue ne doit pas être prolongée');
  });

  it('sérialise les appels concurrents (sous-agents parallèles)', async () => {
    const { engine, state } = fakeLlama(() => new Promise(r => setTimeout(() => r('ok'), 20)));
    await Promise.all([engine.generate(turn('x')), engine.generate(turn('y'))]);
    assert.equal(state.maxActive, 1);
  });
});

describe('moteur Gemini', () => {
  it('assemble toutes les parties de texte, hors réflexion', async () => {
    const { GeminiEngine } = require('../src/harness/llm/engines/gemini');
    const original = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { text: 'je réfléchis', thought: true }, { text: '{"tool":' }, { text: '"finish"}' },
    ] } }] }) });
    try {
      assert.equal(await new GeminiEngine({ apiKey: 'k' }).generate([{ role: 'user', content: 'q' }]), '{"tool":"finish"}');
    } finally { global.fetch = original; }
  });
});

describe('serveur de langage', () => {
  it('décode une URI encodée', () => {
    const { _uriToPath } = require('../src/harness/tools/lsp');
    assert.equal(_uriToPath('file:///c%3A/Mon%20projet/a.ts').replace(/\\/g, '/'), 'c:/Mon projet/a.ts');
  });

  it('découpe les messages en octets (réponse accentuée suivie d\'une autre)', async () => {
    const server = path.join(SANDBOX, 'fake-lsp.js');
    fs.writeFileSync(server, `
      let buf = '';
      const send = m => { const j = JSON.stringify(m); process.stdout.write('Content-Length: ' + Buffer.byteLength(j) + '\\r\\n\\r\\n' + j); };
      process.stdin.on('data', d => {
        buf += d; let m;
        const re = /"id":(\\d+),"method":"([^"]+)"/g;
        while ((m = re.exec(buf))) {
          if (m[2] === 'textDocument/hover') send({ jsonrpc: '2.0', id: +m[1], result: { contents: 'été à côté — déjà' } });
          else if (m[2] !== 'shutdown') send({ jsonrpc: '2.0', id: +m[1], result: {} });
        }
        buf = '';
      });
    `);
    const { lspHover, disposeLsp } = require('../src/harness/tools/lsp');
    const p = project({ 'a.py': 'x = 1\n' });
    const config = { lspServers: { python: `node ${server}` } };
    try {
      for (let i = 0; i < 2; i++) {
        const r = await lspHover({ path: 'a.py', line: 1 }, p.guard, p.root, config);
        assert.equal(r.content, 'été à côté — déjà', r.error);
      }
    } finally { await disposeLsp(); }
  });
});

describe('client MCP', () => {
  it('une commande introuvable rejette sans faire tomber le processus', async () => {
    const { McpClient } = require('../src/harness/mcp/client');
    const client = new McpClient({ type: 'stdio', url: 'commande-inexistante-p119' }, { timeoutMs: 2000 });
    await assert.rejects(client.connect());
    client.dispose();
    await new Promise(r => setTimeout(r, 300));
  });
});

describe('client MCP sous Windows', { skip: process.platform !== 'win32' }, () => {
  it('lance un serveur fourni sous forme de script .cmd', async () => {
    const server = path.join(SANDBOX, 'fake-mcp.js');
    fs.writeFileSync(server, `
      require('readline').createInterface({ input: process.stdin }).on('line', line => {
        const m = JSON.parse(line);
        if (m.id === undefined) return;
        const result = m.method === 'tools/list' ? { tools: [{ name: 'ping' }] } : {};
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
      }).on('close', () => process.exit(0));
    `);
    const script = path.join(SANDBOX, 'fake-mcp.cmd');
    fs.writeFileSync(script, '@node "%~dp0fake-mcp.js" %*\r\n');
    const { McpClient } = require('../src/harness/mcp/client');
    const client = new McpClient({ type: 'stdio', url: script }, { timeoutMs: 8000 });
    try { assert.deepEqual(await client.connect(), [{ name: 'ping' }]); }
    finally { client.dispose(); await new Promise(r => setTimeout(r, 500)); }
  });
});

describe('pont WebLLM', () => {
  function loadBridge() {
    const ipcMain = new (require('events').EventEmitter)();
    ipcMain.handle = () => {};
    const original = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron') {
        return { ipcMain, app: { getAppPath: () => '.' }, BrowserWindow: {}, dialog: {}, Notification: {}, safeStorage: {} };
      }
      return original.call(this, request, ...rest);
    };
    try { return { ipcMain, ...require('../src/main/ipc') }; }
    finally { Module._load = original; }
  }

  it('n\'envoie au renderer que des données sérialisables, et obéit au Stop', async () => {
    const { ipcMain, _createWebLlmBridge } = loadBridge();
    const sent = [];
    const bridge = _createWebLlmBridge({ webContents: { send: (channel, payload) => sent.push({ channel, payload }) } });
    const options = { temperature: 0.2, maxTokens: 64, onToken: () => {}, onUsage: () => {}, signal: new AbortController().signal };

    const answer = bridge.sendRequest([], options);
    assert.doesNotThrow(() => structuredClone(sent[0].payload));
    assert.equal(sent[0].payload.options.temperature, 0.2);
    assert.equal(sent[0].payload.options.maxTokens, 64);
    ipcMain.emit(`llm:reply:${sent[0].payload.replyChannel}`, {}, { text: 'ok' });
    assert.equal(await answer, 'ok');

    const abort = new AbortController();
    const cancelled = bridge.sendRequest([], { signal: abort.signal });
    abort.abort();
    await assert.rejects(cancelled, /ANNULÉ/);
    assert.equal(ipcMain.listenerCount(`llm:reply:${sent[1].payload.replyChannel}`), 0);
  });
});

describe('rendu Markdown', () => {
  it('ne met pas en italique l\'intérieur du code en ligne', () => {
    const { _renderMarkdown } = require('./lib/app-module');
    const out = _renderMarkdown('Utilise `a * b * c` et `**kwargs, **opts` ici');
    assert.ok(out.includes('<code>a * b * c</code>'), out);
    assert.ok(out.includes('<code>**kwargs, **opts</code>'), out);
  });
});
