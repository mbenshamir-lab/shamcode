#!/usr/bin/env node
/**
 * Benchmark de l'agent sur de vrais modèles (cf. tests/bench/README.md).
 *
 * Contrairement à tests/eval, le modèle n'est pas rejoué : ce banc mesure si l'agent réussit
 * réellement une tâche, vérifiée par exécution du code produit. Il coûte des tokens, d'où
 * --yes obligatoire et un plafond ; sans --yes, il affiche le plan et ne contacte aucune API.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const { FILES } = require('./project');
const { TASKS } = require('./tasks');

const HARNESS_ROOT = path.join(__dirname, '..', '..');
const MAX_STEPS = 25; // réglage par défaut de l'application
const CONTEXT_BUDGET = 12000;
const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_TOKENS = 2500000; // large devant l'estimation : une mesure coupée n'est pas comparable
const DEFAULT_TASK_TOKENS = 150000;
const ESTIMATED_TOKENS_PER_RUN = 60000; // ordre de grandeur : ~8 étapes de ~7 000 tokens

const API_KEYS = {
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'openai-compat': 'OPENAI_COMPAT_API_KEY',
};

// ── Bac à sable ─────────────────────────────────────────────────────────────

function _hashFile(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/** AGENTS.md est exclu : le prompt demande à l'agent de le tenir à jour à chaque tâche. */
function _snapshot(root, dir = root, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) _snapshot(root, full, out);
    else if (e.name !== 'AGENTS.md') out[path.relative(root, full).replace(/\\/g, '/')] = _hashFile(full);
  }
  return out;
}

function makeProject(def) {
  const files = { ...FILES };
  if (def.seed) def.seed(files);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shamcode-bench-'));
  const root = path.join(base, 'boutique'); // nom stable : il figure dans le prompt
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return { root, base, before: _snapshot(root) };
}

/** Environnement sans la marque de node --test, qui altérerait une suite lancée dedans. */
function _cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function makeContext({ root, before }, { summary = '', tools = [] } = {}) {
  const ctx = {
    root,
    summary,
    tools,
    read:   rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } },
    write:  (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    },
    remove: rel => fs.unlinkSync(path.join(root, rel)),
    exists: rel => fs.existsSync(path.join(root, rel)),
    node: (script) => {
      try {
        execFileSync(process.execPath, ['-e', script], { cwd: root, timeout: 10000, stdio: 'ignore', env: _cleanEnv() });
        return true;
      } catch { return false; }
    },
    tests: () => spawnSync(process.execPath, ['--test'], { cwd: root, timeout: 30000, stdio: 'ignore', env: _cleanEnv() }).status === 0,
    unchanged: rel => {
      const file = path.join(root, rel);
      return fs.existsSync(file) && _hashFile(file) === before[rel];
    },
    sourcesUntouched: () => {
      const now = _snapshot(root);
      return Object.keys({ ...before, ...now }).every(rel => before[rel] === now[rel]);
    },
    // ask_user doit précéder tout appel aux outils d'écriture cités
    askedBefore: (...writers) => {
      const asked = tools.indexOf('ask_user');
      const wrote = tools.findIndex(t => writers.includes(t));
      return asked !== -1 && (wrote === -1 || asked < wrote);
    },
  };
  return ctx;
}

function verify(def, ctx) {
  try {
    return def.verify(ctx).map(([name, ok]) => ({ name, ok: !!ok }));
  } catch (err) {
    return [{ name: 'vérification exécutable', ok: false, detail: err.message }];
  }
}

function removeProject({ base }) {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignoré */ }
}

// ── Auto-contrôle ───────────────────────────────────────────────────────────

/**
 * Prouve que chaque tâche sait distinguer un travail fait d'un travail absent. Sans cela, un
 * « réussi » pourrait ne rien vouloir dire. N'appelle aucun modèle.
 * @returns {{ id: string, untouchedFails: boolean, solutionPasses: boolean, failed: string[] }[]}
 */
function selfCheck(tasks = TASKS) {
  return tasks.map((def) => {
    const untouched = makeProject(def);
    const untouchedChecks = verify(def, makeContext(untouched));
    removeProject(untouched);

    const solved = makeProject(def);
    const ctx = makeContext(solved);
    let failed;
    try {
      def.solve(ctx);
      failed = verify(def, ctx).filter(c => !c.ok).map(c => c.name);
    } catch (err) {
      failed = [`solution inapplicable : ${err.message}`];
    }
    removeProject(solved);

    return {
      id: def.id,
      untouchedFails: untouchedChecks.some(c => !c.ok),
      solutionPasses: failed.length === 0,
      failed,
    };
  });
}

// ── Exécution ───────────────────────────────────────────────────────────────

/** Charge l'agent depuis une copie du code : c'est ce qui rend l'A/B possible. */
function loadHarness(harnessRoot = HARNESS_ROOT) {
  const from = rel => require(path.join(path.resolve(harnessRoot), rel));
  return {
    runAgent:  from('src/harness/agent.js').runAgent,
    LlmRouter: from('src/harness/llm/router.js').LlmRouter,
    registry:  from('src/harness/llm/registry.js').registry,
  };
}

function makeGenerate({ harness, engine, model, baseUrl, apiKey }) {
  const engines = { [engine]: { apiKey, model, ...(baseUrl ? { baseUrl } : {}) } };
  const router = new harness.LlmRouter([engine], harness.registry, { model: { engines } });
  return (messages, options) => router.generate(messages, options);
}

/**
 * Exécute une tâche une fois.
 * @param {object} def
 * @param {{ runAgent: Function, generate: Function, taskTokens: number, shared: { tokens: number, limit: number } }} opts
 */
async function runOnce(def, { runAgent, generate, taskTokens, shared }) {
  const project = makeProject(def);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TASK_TIMEOUT_MS);
  const usage = { input: 0, output: 0, cached: 0 };
  let overBudget = false;

  // Compté ici plutôt que dans l'agent : le plafond vaut aussi pour fix_loop et les sous-agents
  const generateCapped = (messages, options = {}) => generate(messages, {
    ...options,
    onUsage: (u) => {
      usage.input  += u.inputTokens  || 0;
      usage.output += u.outputTokens || 0;
      usage.cached += u.cachedTokens || 0;
      shared.tokens += (u.inputTokens || 0) + (u.outputTokens || 0);
      options.onUsage?.(u);
      if (usage.input + usage.output > taskTokens || shared.tokens > shared.limit) {
        overBudget = true;
        abort.abort();
      }
    },
  });

  const events = [];
  const started = Date.now();
  let result;
  try {
    result = await runAgent({
      task: def.task,
      projectRoot: project.root,
      llmGenerate: generateCapped,
      signal: abort.signal,
      onEvent: e => events.push(e),
      config: {
        maxSteps: MAX_STEPS,
        temperature: 0.1,
        contextBudget: CONTEXT_BUDGET,
        // Le modèle ne doit exécuter que run_tests : le banc ne lui ouvre ni shell ni réseau
        enableShell: false,
        enableWebSearch: false,
        enableGit: false,
        streaming: false,
        requestApproval: async () => true,
        requestPlanApproval: async () => true,
        requestUserInput: async () => def.answer ?? 'Fais le choix le plus prudent.',
        _llmGenerate: generateCapped,
        _signal: abort.signal,
      },
    });
  } catch (err) {
    result = { ok: false, error: `CRASH: ${err.message}`, trace: [] };
  }
  clearTimeout(timer);

  const trace = result.trace || [];
  const tools = trace.map(t => t.tool).filter(Boolean);
  const checks = verify(def, makeContext(project, { summary: result.summary || '', tools }));
  removeProject(project);

  const toolResults = events.filter(e => e.type === 'tool_result');
  return {
    id: def.id,
    category: def.category,
    success: checks.every(c => c.ok),
    checks,
    finishedOk: result.ok === true,
    unverified: result.unverified === true,
    error: overBudget ? 'PLAFOND_TOKENS' : (result.error || null),
    steps: trace.length,
    inputTokens: usage.input,
    outputTokens: usage.output,
    cachedTokens: usage.cached,
    parseErrors: events.filter(e => e.type === 'parse_error').length,
    toolErrors: toolResults.filter(e => !e.result?.ok).length,
    finishRejections: events.filter(e => e.type === 'finish_rejected').length,
    durationMs: Date.now() - started,
  };
}

/**
 * @param {{ harness: object, generate: Function, tasks?: object[], repeat?: number,
 *           maxTokens?: number, taskTokens?: number, meta?: object, onRun?: Function }} opts
 */
async function runBench({ harness, generate, tasks = TASKS, repeat = 2, maxTokens = DEFAULT_MAX_TOKENS,
  taskTokens = DEFAULT_TASK_TOKENS, meta = {}, onRun = () => {} }) {
  const shared = { tokens: 0, limit: maxTokens };
  const runs = [];
  let stopped = false;

  outer: for (let rep = 1; rep <= repeat; rep++) {
    for (const def of tasks) {
      if (shared.tokens > shared.limit) { stopped = true; break outer; }
      const run = { ...(await runOnce(def, { runAgent: harness.runAgent, generate, taskTokens, shared })), rep };
      runs.push(run);
      onRun(run);
    }
  }

  return { meta: { ...meta, repeat, date: new Date().toISOString() }, stoppedByTokenLimit: stopped, runs, summary: summarize(runs) };
}

function summarize(runs) {
  const n = runs.length || 1;
  const mean = key => +(runs.reduce((s, r) => s + r[key], 0) / n).toFixed(1);
  const successes = runs.filter(r => r.success).length;
  const tokens = runs.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  return {
    runs: runs.length,
    successes,
    successRate: +(successes / n).toFixed(3),
    steps: mean('steps'),
    tokens,
    cachedTokens: runs.reduce((s, r) => s + r.cachedTokens, 0),
    tokensPerSuccess: successes ? Math.round(tokens / successes) : null,
    parseErrors: runs.reduce((s, r) => s + r.parseErrors, 0),
    toolErrors: runs.reduce((s, r) => s + r.toolErrors, 0),
    unverifiedFinishes: runs.filter(r => r.unverified).length,
    falseSuccesses: runs.filter(r => r.finishedOk && !r.success).length,
    durationMs: mean('durationMs'),
  };
}

// ── Comparaison ─────────────────────────────────────────────────────────────

const _gain = (before, after) => (before > 0 && after != null ? (before - after) / before : 0);

/**
 * Applique la règle d'adoption de docs/ANALYSE_PROMPT.md §7. Une hausse du taux de réussite
 * suffit à adopter : on ne refuse pas un agent qui réussit plus au motif qu'il coûte autant.
 */
function compareReports(before, after) {
  const incompatible = ['engine', 'model'].filter(k => before.meta[k] !== after.meta[k]);
  const a = before.summary;
  const b = after.summary;
  const costs = {
    steps: _gain(a.steps, b.steps),
    tokens: _gain(a.tokens, b.tokens),
    tokensPerSuccess: _gain(a.tokensPerSuccess, b.tokensPerSuccess),
    durationMs: _gain(a.durationMs, b.durationMs),
  };
  const costImproved = Object.values(costs).some(g => g > 0.15);
  const delta = b.successRate - a.successRate;

  let verdict;
  if (incompatible.length || before.stoppedByTokenLimit || after.stoppedByTokenLimit) verdict = 'NON_COMPARABLE';
  else if (delta < 0) verdict = 'REJETER';
  else if (delta > 0 || costImproved) verdict = 'ADOPTER';
  else verdict = 'SANS_EFFET_MESURABLE';

  const rate = (report) => {
    const out = {};
    for (const r of report.runs) (out[r.id] ??= []).push(r.success);
    return Object.fromEntries(Object.entries(out).map(([id, v]) => [id, v.filter(Boolean).length / v.length]));
  };
  const beforeRates = rate(before);
  const afterRates  = rate(after);
  const changed = Object.keys(afterRates)
    .filter(id => beforeRates[id] !== afterRates[id])
    .map(id => ({ id, before: beforeRates[id], after: afterRates[id] }));

  return { verdict, incompatible, delta, costs, changed };
}

function printCompare(before, after) {
  const c = compareReports(before, after);
  const a = before.summary;
  const b = after.summary;
  const line = (label, from, to) => process.stdout.write(`  ${label.padEnd(26)} ${String(from).padEnd(12)} → ${to}\n`);
  process.stdout.write(`\nAvant : ${before.meta.label} · Après : ${after.meta.label} · ${after.meta.engine}/${after.meta.model}\n`);
  line('taux de réussite', a.successRate, b.successRate);
  line('fausses réussites', a.falseSuccesses, b.falseSuccesses);
  line('étapes / exécution', a.steps, b.steps);
  line('tokens au total', a.tokens, b.tokens);
  line('tokens / réussite', a.tokensPerSuccess, b.tokensPerSuccess);
  line('tokens en cache', a.cachedTokens, b.cachedTokens);
  line('erreurs de parse', a.parseErrors, b.parseErrors);
  line('erreurs d\'outil', a.toolErrors, b.toolErrors);
  line('durée / exécution (ms)', a.durationMs, b.durationMs);
  for (const t of c.changed) process.stdout.write(`  ${t.id} : ${t.before} → ${t.after}\n`);
  if (c.incompatible.length) process.stdout.write(`  Différence de ${c.incompatible.join(', ')} : comparaison invalide.\n`);
  if (before.stoppedByTokenLimit || after.stoppedByTokenLimit) process.stdout.write('  Une mesure a été interrompue par le plafond de tokens.\n');
  if (Math.min(before.meta.repeat, after.meta.repeat) < 2) process.stdout.write('  Moins de 2 répétitions : résultat fragile.\n');
  process.stdout.write(`\nVerdict : ${c.verdict}\n\n`);
}

function printRun(r) {
  const failed = r.checks.filter(c => !c.ok).map(c => c.name).join(', ');
  process.stdout.write(`  ${r.success ? '✓' : '✗'} ${r.id.padEnd(20)} ${String(r.steps).padStart(2)} étapes  ` +
    `${String(r.inputTokens + r.outputTokens).padStart(7)} tokens${r.error ? `  [${r.error.slice(0, 60)}]` : ''}${failed ? `  — ${failed}` : ''}\n`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { engine: null, model: null, baseUrl: null, harness: null, label: null, repeat: 2,
    only: null, save: null, compare: null, selfCheck: false, yes: false,
    maxTokens: DEFAULT_MAX_TOKENS, taskTokens: DEFAULT_TASK_TOKENS };
  for (const arg of argv) {
    const [key, value] = arg.split(/=(.*)/s);
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--self-check') opts.selfCheck = true;
    else if (key === '--engine') opts.engine = value;
    else if (key === '--model') opts.model = value;
    else if (key === '--base-url') opts.baseUrl = value;
    else if (key === '--harness') opts.harness = value;
    else if (key === '--label') opts.label = value;
    else if (key === '--repeat') opts.repeat = Number(value);
    else if (key === '--task') opts.only = value.split(',').map(s => s.trim());
    else if (key === '--save') opts.save = value;
    else if (key === '--compare') opts.compare = value.split(',');
    else if (key === '--max-tokens') opts.maxTokens = Number(value);
    else if (key === '--task-tokens') opts.taskTokens = Number(value);
    else throw new Error(`ARGUMENT_INCONNU: ${arg}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.selfCheck) {
    const rows = selfCheck();
    for (const r of rows) {
      const ok = r.untouchedFails && r.solutionPasses;
      process.stdout.write(`  ${ok ? '✓' : '✗'} ${r.id}${ok ? '' : ` — intact échoue: ${r.untouchedFails}, solution: ${r.failed.join(', ') || 'ok'}`}\n`);
    }
    return rows.every(r => r.untouchedFails && r.solutionPasses) ? 0 : 1;
  }

  if (opts.compare) {
    const [a, b] = opts.compare.map(f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
    printCompare(a, b);
    return 0;
  }

  const tasks = TASKS.filter(t => !opts.only || opts.only.includes(t.id));
  const keyName = API_KEYS[opts.engine];
  if (!keyName) throw new Error(`--engine requis : ${Object.keys(API_KEYS).join(', ')}`);
  if (!opts.model) throw new Error('--model requis');

  const planned = tasks.length * opts.repeat;
  process.stdout.write(`Plan : ${tasks.length} tâche(s) × ${opts.repeat} = ${planned} exécutions sur ${opts.engine}/${opts.model}\n`);
  process.stdout.write(`Estimation : ~${(planned * ESTIMATED_TOKENS_PER_RUN).toLocaleString('fr-FR')} tokens, plafond ${opts.maxTokens.toLocaleString('fr-FR')}\n`);
  if (!opts.yes) {
    process.stdout.write('Aucun appel effectué. Ajoute --yes pour lancer (cela consomme des tokens).\n');
    return 0;
  }

  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`Variable d'environnement ${keyName} absente`);

  // Isolé avant de charger l'agent : sessions et index ne touchent pas ceux de l'utilisateur
  process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'shamcode-bench-home-'));

  const harness = loadHarness(opts.harness || HARNESS_ROOT);
  const generate = makeGenerate({ harness, engine: opts.engine, model: opts.model, baseUrl: opts.baseUrl, apiKey });
  const report = await runBench({
    harness, generate, tasks, repeat: opts.repeat, maxTokens: opts.maxTokens, taskTokens: opts.taskTokens,
    meta: { engine: opts.engine, model: opts.model, label: opts.label || path.basename(opts.harness || 'courant') },
    onRun: printRun,
  });

  const s = report.summary;
  process.stdout.write(`\nRéussite : ${s.successes}/${s.runs} · ${s.steps} étapes/exécution · ${s.tokens} tokens\n`);
  if (report.stoppedByTokenLimit) process.stdout.write('Arrêté par le plafond de tokens.\n');
  if (opts.save) {
    // La clé peut figurer dans un message d'erreur de fournisseur : jamais sur le disque
    fs.writeFileSync(path.resolve(opts.save), JSON.stringify(report, null, 2).replaceAll(apiKey, '***'), 'utf8');
    process.stdout.write(`Résultat enregistré : ${path.resolve(opts.save)}\n`);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Benchmark impossible : ${err.message}\n`);
      process.exit(2);
    });
}

module.exports = { selfCheck, runBench, runOnce, summarize, compareReports, loadHarness, parseArgs, makeProject, removeProject };
