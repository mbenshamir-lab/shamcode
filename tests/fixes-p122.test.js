'use strict';

// Phase 122 — sauvegarde avant formatage, environnement de la commande de déploiement,
// preuve de fin après fix_loop et préfixe « Bearer » des connecteurs MCP.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p122-'));
process.env.HARNESS_DATA_DIR = path.join(SANDBOX, 'data');
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const { makeGuard }             = require('../src/harness/safety/path-guard');
const { fileKey, getBackupDir } = require('../src/harness/safety/backup');
const { dispatch }              = require('../src/harness/tools');

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

function backups(p, rel) {
  const dir = path.join(getBackupDir(), fileKey(path.join(p.root, rel)));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map(d => fs.readFileSync(path.join(dir, d, path.basename(rel)), 'utf8'));
}

describe('format_file — sauvegarde', () => {
  /** Projet doté d'un faux prettier local qui réécrit le fichier. */
  function formatted() {
    const p = project({
      'a.js': 'original',
      'node_modules/fake.js': 'require("fs").writeFileSync(process.argv[3], "formaté");',
      'node_modules/.bin/prettier': '#!/bin/sh\nnode "$(dirname "$0")/../fake.js" "$@"\n',
      'node_modules/.bin/prettier.cmd': '@node "%~dp0..\\fake.js" %*\r\n',
    });
    fs.chmodSync(path.join(p.root, 'node_modules/.bin/prettier'), 0o755);
    return p;
  }

  it('garde la version d\'avant le formatage', async () => {
    const p = formatted();
    const r = await run(p, 'format_file', { path: 'a.js' });
    assert.equal(r.ok, true, r.error);
    assert.equal(p.read('a.js'), 'formaté');
    assert.deepEqual(backups(p, 'a.js'), ['original']);
  });

  it('ne formate pas si la sauvegarde échoue', async () => {
    const p = formatted();
    const previous = process.env.HARNESS_DATA_DIR;
    process.env.HARNESS_DATA_DIR = path.join(p.root, 'a.js');
    try {
      const r = await run(p, 'format_file', { path: 'a.js' });
      assert.match(String(r.error), /BACKUP_ÉCHOUÉ/);
      assert.equal(p.read('a.js'), 'original');
    } finally { process.env.HARNESS_DATA_DIR = previous; }
  });

  it('le formatage automatique n\'ajoute pas de sauvegarde par-dessus l\'originale', async () => {
    const p = formatted();
    await run(p, 'write_file', { path: 'a.js', content: 'nouveau' }, { autoFormat: true });
    assert.equal(p.read('a.js'), 'formaté');
    assert.deepEqual(backups(p, 'a.js'), ['original']);
  });
});

describe('deploy — environnement', () => {
  const print = 'node -e "console.log(process.env.P122_API_KEY || \'absent\')"';

  async function withSecret(fn) {
    process.env.P122_API_KEY = 'valeur-secrete';
    try { return await fn(); } finally { delete process.env.P122_API_KEY; }
  }

  it('la commande libre ne reçoit pas les variables secrètes', async () => {
    const r = await withSecret(() => run(project(), 'deploy', { command: print }, { enableDeploy: true, enableShell: true }));
    assert.equal(r.ok, true, r.error);
    assert.match(r.output, /absent/);
    assert.doesNotMatch(r.output, /valeur-secrete/);
  });

  it('la plateforme détectée garde ses jetons de déploiement', async () => {
    const p = project({ 'package.json': JSON.stringify({ scripts: { deploy: 'node show.js' } }), 'show.js': 'console.log(process.env.P122_API_KEY)' });
    const r = await withSecret(() => run(p, 'deploy', {}, { enableDeploy: true }));
    assert.match(r.output, /valeur-secrete/);
  });
});

describe('preuve de fin après fix_loop', () => {
  const { runAgent } = require('../src/harness/agent');
  const files = {
    'package.json': JSON.stringify({ scripts: { test: 'node check.js' } }),
    'check.js': 'process.exit(require("fs").readFileSync("a.js","utf8") === "fixed" ? 0 : 1);',
    'a.js': 'broken',
  };
  const claim = { tool: 'finish', args: { summary: 's', checks: [{ kind: 'test', command: 'npm test', result: 'pass' }] } };

  async function agent(replacement) {
    const p = project(files);
    const events = [];
    let i = 0;
    const calls = [{ tool: 'fix_loop', args: { max_iterations: 1 } }, claim, { tool: 'finish', args: { summary: 's' } }];
    const result = await runAgent({
      task: 'répare les tests', projectRoot: p.root, onEvent: e => events.push(e),
      llmGenerate: async () => JSON.stringify(calls[Math.min(i++, calls.length - 1)]),
      config: {
        autonomyLevel: 'off', enableFixLoop: true,
        _llmGenerate: async () => JSON.stringify({ tool: 'replace_code', args: { path: 'a.js', old_string: 'broken', new_string: replacement } }),
      },
    });
    return { result, events, entry: result.trace[0] };
  }

  it('une boucle réussie atteste ses fichiers et prouve le test', async () => {
    const { result, events, entry } = await agent('fixed');
    assert.equal(entry.result.ok, true, entry.result.error);
    assert.deepEqual(entry.result.modified_files, ['a.js']);
    assert.deepEqual(entry.verifiedFiles.map(v => v.path), ['a.js']);
    assert.ok(!events.some(e => e.type === 'finish_rejected'));
    assert.equal(result.unverified, undefined);
  });

  it('une boucle en échec compte ses écritures et ne prouve aucun test', async () => {
    const { events, entry } = await agent('encore');
    assert.equal(entry.result.ok, false);
    assert.deepEqual(entry.result.modified_files, ['a.js']);
    assert.deepEqual(entry.verifiedFiles.map(v => v.path), ['a.js']);
    assert.match(String(events.find(e => e.type === 'finish_rejected')?.reason), /non lancé/);
  });

  it('modifier package.json par fix_loop exige une décision D2', () => {
    const { evaluateGoalCompletion } = require('../src/harness/goals/policy');
    const goal = { criteria: [], budget: { maxSteps: 10, maxFiles: 5, maxNewDeps: 0 }, decisions: [] };
    const trace = [{ tool: 'fix_loop', args: {}, result: { ok: false, modified_files: ['package.json'] } }];
    assert.match(String(evaluateGoalCompletion(goal, { trace }).reason), /package\.json/);
  });
});

describe('connecteur MCP — authentification', () => {
  it('n\'envoie qu\'un seul préfixe Bearer', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization);
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { tools: [] } })));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { McpClient } = require('../src/harness/mcp/client');
    try {
      for (const auth of ['abc', 'Bearer abc', 'bearer   abc']) {
        const client = new McpClient({ type: 'http', url: `http://127.0.0.1:${server.address().port}`, auth });
        await client.connect();
        client.dispose();
      }
      assert.ok(seen.length >= 3);
      assert.deepEqual([...new Set(seen)], ['Bearer abc']);
    } finally { server.close(); }
  });

  it('l\'exemple du champ n\'invite plus à saisir le préfixe', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/renderer-settings/settings.html'), 'utf8');
    assert.doesNotMatch(html.match(/<input[^>]*id="sm-conn-auth"[^>]*>/)[0], /placeholder="Bearer/);
  });
});
