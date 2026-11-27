'use strict';

// Phase 120 — commande de déploiement, sauvegarde avant écrasement, arrêt des processus,
// synchronisation du serveur de langage et preuve de fin après batch_replace.

const { describe, it, after } = require('node:test');
const assert       = require('node:assert/strict');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const http         = require('http');
const Module       = require('module');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p120-'));
process.env.HARNESS_DATA_DIR = path.join(SANDBOX, 'data');

const { makeGuard }            = require('../src/harness/safety/path-guard');
const { fileKey, getBackupDir } = require('../src/harness/safety/backup');
const { dispatch }             = require('../src/harness/tools');

let _n = 0;
function project(files = {}) {
  const root = path.join(SANDBOX, `proj${++_n}`);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return {
    root, guard: makeGuard(root),
    has: rel => fs.existsSync(path.join(root, rel)),
    read: rel => fs.readFileSync(path.join(root, rel), 'utf8'),
  };
}
const run = (p, tool, args, config = {}) => dispatch(tool, args, p.guard, config, () => {}, p.root);

/** Contenus sauvegardés d'un fichier du projet. */
function backups(p, rel) {
  const dir = path.join(getBackupDir(), fileKey(path.join(p.root, rel)));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map(d => fs.readFileSync(path.join(dir, d, path.basename(rel)), 'utf8'));
}

/** Rend toute sauvegarde impossible le temps de fn. */
async function withoutBackupDir(fn) {
  const previous = process.env.HARNESS_DATA_DIR;
  const blocker = path.join(SANDBOX, 'blocker');
  fs.writeFileSync(blocker, '');
  process.env.HARNESS_DATA_DIR = blocker;
  try { return await fn(); }
  finally { process.env.HARNESS_DATA_DIR = previous; }
}

after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

describe('deploy — argument command', () => {
  const command = 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'1\')"';

  it('est refusé quand le shell est désactivé', async () => {
    const p = project();
    const r = await run(p, 'deploy', { command }, { enableDeploy: true });
    assert.match(String(r.error), /COMMANDE_DEPLOY_REFUSÉE/);
    assert.equal(p.has('ran.txt'), false);
  });

  it('demande l\'approbation quand elle est active', async () => {
    const p = project();
    const asked = [];
    const r = await run(p, 'deploy', { command }, {
      enableDeploy: true, enableShell: true, requestApproval: async preview => { asked.push(preview.patch); return false; },
    });
    assert.equal(r.error, 'REJETÉ_PAR_UTILISATEUR');
    assert.deepEqual(asked, [`+ ${command}`]);
    assert.equal(p.has('ran.txt'), false);
  });

  it('applique la liste des commandes bloquées', async () => {
    const r = await run(project(), 'deploy', { command: 'shutdown /?' }, { enableDeploy: true, enableShell: true });
    assert.match(String(r.error), /COMMANDE_BLOQUÉE/);
  });

  it('s\'exécute avec le shell activé', async () => {
    const p = project();
    const r = await run(p, 'deploy', { command }, { enableDeploy: true, enableShell: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.has('ran.txt'), true);
  });

  it('la plateforme détectée reste utilisable sans le shell', async () => {
    const p = project({ 'package.json': JSON.stringify({ scripts: { deploy: 'echo deployed' } }) });
    const r = await run(p, 'deploy', {}, { enableDeploy: true });
    assert.equal(r.ok, true, r.error);
  });
});

describe('sauvegarde avant écrasement', () => {
  async function mediaServer() {
    const server = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${server.address().port}`;
      if (req.url === '/images/generations') return res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('neuve').toString('base64') }] }));
      if (req.url === '/videos') return res.end(JSON.stringify({ url: `${base}/clip` }));
      res.end('neuve');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return {
      server,
      config: { customProviders: [{ name: 'x', apiKey: 'k', baseUrl: `http://127.0.0.1:${server.address().port}` }] },
    };
  }

  for (const [tool, file] of [['generate_image', 'out.png'], ['generate_video', 'out.mp4']]) {
    it(`${tool} garde l'ancien fichier`, async () => {
      const { server, config } = await mediaServer();
      const p = project({ [file]: 'ancienne' });
      try {
        const r = await run(p, tool, { prompt: 'p', output: file }, config);
        assert.equal(r.ok, true, r.error);
        assert.deepEqual(backups(p, file), ['ancienne']);
        assert.equal(p.read(file), 'neuve');
      } finally { server.close(); }
    });
  }

  it('un média n\'écrase rien si la sauvegarde échoue', async () => {
    const { server, config } = await mediaServer();
    const p = project({ 'out.png': 'ancienne' });
    try {
      const r = await withoutBackupDir(() => run(p, 'generate_image', { prompt: 'p', output: 'out.png' }, config));
      assert.match(String(r.error), /BACKUP_ÉCHOUÉ/);
      assert.equal(p.read('out.png'), 'ancienne');
    } finally { server.close(); }
  });

  /** Remplace ffmpeg et PowerShell : le « processus » écrit la sortie et réussit. */
  async function withFakeSpawn(moduleName, target, fn) {
    const original = childProcess.spawn;
    childProcess.spawn = () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
      process.nextTick(() => { fs.writeFileSync(target, 'neuve'); proc.emit('close', 0); });
      return proc;
    };
    // Les modules capturent spawn à leur chargement
    const files = [require.resolve(`../src/harness/tools/${moduleName}`)];
    files.forEach(f => delete require.cache[f]);
    try { return await fn(require(files[0])); }
    finally { childProcess.spawn = original; files.forEach(f => delete require.cache[f]); }
  }

  it('merge_videos garde l\'ancien fichier', async () => {
    const p = project({ 'a.mp4': 'a', 'b.mp4': 'b', 'out.mp4': 'ancienne' });
    const r = await withFakeSpawn('merge-videos', path.join(p.root, 'out.mp4'),
      ({ mergeVideos }) => mergeVideos({ inputs: ['a.mp4', 'b.mp4'], output: 'out.mp4' }, p.guard, p.root, {}));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(backups(p, 'out.mp4'), ['ancienne']);
  });

  it('generate_speech garde l\'ancien fichier', async () => {
    const p = project({ 'out.wav': 'ancienne' });
    const r = await withFakeSpawn('speech', path.join(p.root, 'out.wav'),
      ({ generateSpeech }) => generateSpeech({ text: 't', output: 'out.wav' }, p.guard, p.root, {}));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(backups(p, 'out.wav'), ['ancienne']);
  });

  it('browser_screenshot garde l\'ancien fichier', async () => {
    const browser = require('../src/harness/tools/browser');
    const page = {
      setViewport: async () => {}, url: () => 'about:blank',
      screenshot: async ({ path: dest }) => fs.writeFileSync(dest, 'neuve'),
    };
    browser._setPuppeteerMock({ launch: async () => ({ newPage: async () => page, once: () => {}, close: async () => {} }) });
    const p = project({ 'shot.png': 'ancienne' });
    const exists = fs.existsSync;
    try {
      fs.existsSync = () => true; // Chrome « installé » le temps de l'ouverture
      await browser.browserOpen({});
      fs.existsSync = exists;
      const r = await run(p, 'browser_screenshot', { path: 'shot.png' });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(backups(p, 'shot.png'), ['ancienne']);
    } finally {
      fs.existsSync = exists;
      await browser.browserClose();
      browser._setPuppeteerMock(null);
    }
  });

  it('l\'export du Design Studio garde l\'ancien fichier', async () => {
    const handlers = new Map();
    const ipcMain = new EventEmitter();
    ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
    const original = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron') {
        return { ipcMain, app: { getAppPath: () => '.' }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, Notification: {}, safeStorage: {} };
      }
      return original.call(this, request, ...rest);
    };
    const p = project({ 'theme.css': 'ancienne' });
    try {
      const { registerIpcHandlers } = require('../src/main/ipc');
      const { IPC } = require('../src/shared/constants');
      const win = { isDestroyed: () => false, webContents: { once: () => {}, send: () => {}, isDestroyed: () => false } };
      registerIpcHandlers({ visibleWin: win, hiddenWin: win, config: { projectRoot: p.root } });
      const write = handlers.get(IPC.DESIGN_WRITE_FILE);
      assert.deepEqual(await write({}, { path: 'theme.css', content: 'neuve' }), { ok: true });
      assert.deepEqual(backups(p, 'theme.css'), ['ancienne']);
      const refused = await withoutBackupDir(() => write({}, { path: 'theme.css', content: 'perdue' }));
      assert.match(String(refused.error), /BACKUP_ÉCHOUÉ/);
      assert.equal(p.read('theme.css'), 'neuve');
    } finally { Module._load = original; }
  });
});

describe('fermeture de l\'application', () => {
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitFor = async (check) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 100));
    return check();
  };

  // taskkill /T est propre à Windows, la cible de l'application
  it('stopAll arrête les processus et leurs enfants', { skip: process.platform !== 'win32' }, async () => {
    const { stopAll } = require('../src/harness/tools/process-runner');
    const p = project({ 'serve.js': 'require("fs").writeFileSync("pid.txt", String(process.pid)); setTimeout(() => {}, 20000);' });
    await run(p, 'start_process', { command: 'node serve.js', name: 'p120' }, { enableShell: true });
    assert.ok(await waitFor(() => p.has('pid.txt') && p.read('pid.txt')), 'le processus doit démarrer');
    const pid = Number(p.read('pid.txt'));
    stopAll();
    assert.ok(await waitFor(() => !alive(pid)), 'le processus enfant doit être arrêté');
  });

  it('le processus principal et la CLI appellent stopAll', () => {
    const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
    const quit = main.slice(main.indexOf("app.on('before-quit'"));
    assert.ok(quit.indexOf('stopAll()') !== -1 && quit.indexOf('stopAll()') < quit.indexOf('app.exit(0)'));
    assert.match(fs.readFileSync(path.join(__dirname, '../bin/harness.js'), 'utf8'), /stopAll\(\)/);
  });
});

describe('serveur de langage', () => {
  it('signale les fichiers modifiés ou supprimés depuis leur ouverture', async () => {
    const log = path.join(SANDBOX, 'lsp.log');
    const server = path.join(SANDBOX, 'fake-lsp.js');
    fs.writeFileSync(server, `
      const fs = require('fs');
      let buf = Buffer.alloc(0);
      const send = m => { const j = JSON.stringify(m); process.stdout.write('Content-Length: ' + Buffer.byteLength(j) + '\\r\\n\\r\\n' + j); };
      process.stdin.on('data', d => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const m = /Content-Length: (\\d+)\\r\\n\\r\\n/.exec(buf.toString('latin1'));
          if (!m) return;
          const start = m.index + m[0].length;
          if (buf.length < start + Number(m[1])) return;
          const msg = JSON.parse(buf.subarray(start, start + Number(m[1])).toString());
          buf = buf.subarray(start + Number(m[1]));
          if (msg.method.startsWith('textDocument/did')) {
            fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(msg) + '\\n');
          }
          if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: null });
        }
      });
      process.stdin.on('end', () => process.exit(0));
    `);
    const { lspHover, disposeLsp } = require('../src/harness/tools/lsp');
    const p = project({ 'a.py': 'v1', 'b.py': 'b' });
    const config = { lspServers: { python: `node ${server}` } };
    const hover = file => lspHover({ path: file, line: 1 }, p.guard, p.root, config);
    try {
      await hover('a.py');
      await hover('a.py');                                      // inchangé : rien à signaler
      fs.writeFileSync(path.join(p.root, 'a.py'), 'v2');
      await hover('b.py');                                      // a.py est resynchronisé aussi
      fs.unlinkSync(path.join(p.root, 'a.py'));
      await hover('b.py');
    } finally { await disposeLsp(); }

    const events = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      .map(m => [m.method.split('/')[1], path.basename(m.params.textDocument.uri), m.params.textDocument.version,
        m.params.contentChanges?.[0]?.text]);
    assert.deepEqual(events.map(e => e.slice(0, 2)), [
      ['didOpen', 'a.py'], ['didChange', 'a.py'], ['didOpen', 'b.py'], ['didClose', 'a.py'],
    ]);
    assert.deepEqual(events[1].slice(2), [2, 'v2']);
  });
});

describe('preuve de fin après batch_replace', () => {
  const { runAgent } = require('../src/harness/agent');
  const script = (...calls) => { let i = 0; return async () => JSON.stringify(calls[Math.min(i++, calls.length - 1)]); };
  const replace = { tool: 'batch_replace', args: { pattern: 'old', replacement: 'new' } };

  async function agent(calls) {
    const p = project({ 'a.js': 'old', 'b.js': 'old' });
    const events = [];
    const result = await runAgent({
      task: 'remplace old par new', projectRoot: p.root, llmGenerate: script(...calls),
      onEvent: e => events.push(e), config: { autonomyLevel: 'off' },
    });
    return { result, events };
  }

  it('un test déclaré mais non lancé est refusé', async () => {
    const lie = { tool: 'finish', args: { summary: 's', checks: [{ kind: 'test', command: 'npm test', result: 'pass' }] } };
    const { events } = await agent([replace, lie, { tool: 'finish', args: { summary: 's' } }]);
    const refus = events.find(e => e.type === 'finish_rejected');
    assert.ok(refus, 'finish doit être refusé');
    assert.match(refus.reason, /non lancé/);
  });

  it('les fichiers modifiés sont attestés par le serveur', async () => {
    const { result, events } = await agent([replace, { tool: 'finish', args: { summary: 's' } }]);
    assert.equal(result.ok, true);
    assert.equal(result.unverified, undefined);
    assert.ok(!events.some(e => e.type === 'finish_rejected'));
    assert.deepEqual(result.trace[0].verifiedFiles.map(v => v.path).sort(), ['a.js', 'b.js']);
  });

  it('un essai à blanc ne compte pas comme modification', async () => {
    const { result } = await agent([
      { tool: 'batch_replace', args: { ...replace.args, dry_run: true } },
      { tool: 'finish', args: { summary: 's', checks: [] } },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.trace[0].verifiedFiles, undefined);
  });

  it('modifier package.json par batch_replace exige une décision D2', () => {
    const { evaluateGoalCompletion } = require('../src/harness/goals/policy');
    const goal = { criteria: [], budget: { maxSteps: 10, maxFiles: 5, maxNewDeps: 0 }, decisions: [] };
    const trace = [{ tool: 'batch_replace', args: { pattern: 'a' }, result: { ok: true, results: [{ path: 'package.json', modified: true }] } }];
    assert.match(String(evaluateGoalCompletion(goal, { trace }).reason), /package\.json/);
  });
});
