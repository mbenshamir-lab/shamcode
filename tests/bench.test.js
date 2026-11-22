'use strict';
/**
 * Le benchmark sur vrais modèles est validé ici sans aucun appel réseau : ses tâches doivent
 * distinguer un travail fait d'un travail absent, et ses garde-fous de coût doivent tenir.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
process.env.APPDATA = tmpBase;

const { selfCheck, runBench, compareReports, loadHarness, parseArgs, summarize, makeProject, removeProject } = require('./bench/run');
const { TASKS } = require('./bench/tasks');

after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

const finish = '{"tool":"finish","args":{"summary":"fin"}}';
const bench = (generate, extra = {}) => runBench({ harness: loadHarness(), generate, tasks: TASKS.slice(0, 2), repeat: 1, ...extra });

describe('tâches du benchmark', () => {
  it('couvre les douze situations prévues', () => {
    assert.equal(TASKS.length, 12);
    assert.equal(new Set(TASKS.map(t => t.id)).size, 12);
    assert.deepEqual([...new Set(TASKS.map(t => t.category))].sort(), ['ambigu', 'bug', 'feature', 'lecture', 'refactor']);
  });

  it('le projet intact a une suite verte', () => {
    const project = makeProject({});
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const status = spawnSync(process.execPath, ['--test'], { cwd: project.root, env, stdio: 'ignore' }).status;
    removeProject(project);
    assert.equal(status, 0);
  });

  for (const row of selfCheck()) {
    it(`${row.id} : échoue sur le projet intact, réussit avec la solution`, () => {
      assert.equal(row.untouchedFails, true, 'une tâche qui réussit sans travail ne mesure rien');
      assert.deepEqual(row.failed, []);
    });
  }
});

describe('exécution', () => {
  it('ne contacte aucune API sans --yes', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'bench', 'run.js'), '--engine=claude', '--model=x'], {
      encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    assert.ok(out.includes('Aucun appel effectué'));
  });

  it('n\'est pas dupé par un agent qui se déclare terminé', async () => {
    const report = await bench(async () => finish);
    assert.equal(report.summary.successes, 0);
    assert.equal(report.summary.falseSuccesses, 2);
  });

  it('s\'arrête au plafond de tokens global', async () => {
    let calls = 0;
    const generate = async (messages, options) => {
      calls++;
      options.onUsage({ inputTokens: 1000, outputTokens: 0 });
      return '{"tool":"list_dir","args":{"path":"."}}';
    };
    const report = await bench(generate, { maxTokens: 3000 });
    assert.equal(report.stoppedByTokenLimit, true);
    assert.ok(calls <= 4, `${calls} appels après le plafond`);
    assert.equal(report.runs[0].error, 'PLAFOND_TOKENS');
  });

  it('s\'arrête au plafond de tokens par tâche et passe à la suivante', async () => {
    const generate = async (messages, options) => {
      options.onUsage({ inputTokens: 1000, outputTokens: 0 });
      return '{"tool":"list_dir","args":{"path":"."}}';
    };
    const report = await bench(generate, { taskTokens: 2500 });
    assert.equal(report.runs.length, 2);
    assert.ok(report.runs.every(r => r.error === 'PLAFOND_TOKENS'));
  });

  it('réussit de bout en bout quand le code produit est le bon', async () => {
    const [def] = TASKS;
    const script = [
      { tool: 'replace_code', args: { path: 'src/inventory.js', old_string: '?? 0) - qty', new_string: '?? 0) + qty' } },
      { tool: 'read_file', args: { path: 'src/inventory.js' } },
      { tool: 'finish', args: { summary: 'ok', checks: [{ kind: 'file', path: 'src/inventory.js' }] } },
    ];
    const report = await bench(async () => JSON.stringify(script.shift()), { tasks: [def] });
    assert.equal(report.runs[0].success, true, JSON.stringify(report.runs[0].checks));
  });

  it('refuse un argument inconnu', () => {
    assert.throws(() => parseArgs(['--clef=x']), /ARGUMENT_INCONNU/);
  });
});

describe('comparaison', () => {
  const run = (id, success, tokens = 1000, steps = 5) => ({
    id, success, finishedOk: true, unverified: false, steps, inputTokens: tokens, outputTokens: 0, cachedTokens: 0,
    parseErrors: 0, toolErrors: 0, durationMs: 1000,
  });
  const report = (runs, meta = {}) => ({
    meta: { engine: 'gemini', model: 'm', label: 'x', repeat: 2, ...meta }, runs, summary: summarize(runs), stoppedByTokenLimit: false,
  });

  it('adopte une hausse de réussite', () => {
    const c = compareReports(report([run('a', false)]), report([run('a', true)]));
    assert.equal(c.verdict, 'ADOPTER');
    assert.deepEqual(c.changed, [{ id: 'a', before: 0, after: 1 }]);
  });

  it('adopte une réussite égale avec un gain de coût supérieur à 15 %', () => {
    assert.equal(compareReports(report([run('a', true, 1000)]), report([run('a', true, 800)])).verdict, 'ADOPTER');
  });

  it('un gain de coût de 15 % ou moins ne suffit pas', () => {
    assert.equal(compareReports(report([run('a', true, 1000)]), report([run('a', true, 900)])).verdict, 'SANS_EFFET_MESURABLE');
  });

  it('rejette une baisse de réussite, même moins chère', () => {
    assert.equal(compareReports(report([run('a', true, 1000)]), report([run('a', false, 10)])).verdict, 'REJETER');
  });

  it('refuse de comparer deux modèles différents', () => {
    const c = compareReports(report([run('a', true)]), report([run('a', true)], { model: 'autre' }));
    assert.equal(c.verdict, 'NON_COMPARABLE');
  });

  it('refuse de comparer une mesure interrompue', () => {
    const cut = { ...report([run('a', true)]), stoppedByTokenLimit: true };
    assert.equal(compareReports(report([run('a', true)]), cut).verdict, 'NON_COMPARABLE');
  });
});
