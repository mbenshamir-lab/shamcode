#!/usr/bin/env node
/**
 * Eval du harnais ShamCode.
 *
 * Mesure ce que le harness fait d'une trajectoire donnée : taille du prompt,
 * contexte injecté, nudges, récupération après erreur, garde-fous, budget.
 * Le « modèle » est un script rejoué (voir tasks.js) : aucune clé API, aucun réseau,
 * donc un résultat déterministe qui sert de référence (baseline) pour comparer
 * deux versions de prompt ou de boucle.
 *
 * Usage :
 *   node tests/eval/run.js                 # rapport lisible
 *   node tests/eval/run.js --json          # résultat machine
 *   node tests/eval/run.js --task=nominal-fix,truncation
 *   node tests/eval/run.js --strict        # code de sortie 1 si une tâche échoue
 *   node tests/eval/run.js --save=baseline.json
 *   node tests/eval/run.js --compare=baseline.json
 *   node tests/eval/run.js --keep          # conserve les bacs à sable temporaires
 */

'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const { makeSandbox, createReplay, readProjectFile, removeSandbox } = require('./lib');
const { TASKS } = require('./tasks');

/**
 * Exécute une tâche et retourne son rapport détaillé.
 * @param {object} def  définition issue de tasks.js
 * @param {{ keep: boolean }} opts
 */
async function runOne(def, { keep = false } = {}) {
  // require paresseux : APPDATA doit déjà pointer sur le dossier isolé
  const { runAgent } = require('../../src/harness/agent');

  const root = makeSandbox(def.fixture);
  const events = [];
  const replay = createReplay(def.script);
  const config = {
    maxSteps: 12,
    requestApproval: async () => true,
    ...(def.config || {}),
  };

  const t0 = Date.now();
  let result;
  try {
    result = await runAgent({
      task: def.task,
      projectRoot: root,
      config,
      llmGenerate: replay,
      onEvent: e => events.push(e),
    });
  } catch (err) {
    result = { ok: false, error: `CRASH: ${err.message}`, trace: [] };
  }
  const durationMs = Date.now() - t0;

  // ── Métriques dérivées ────────────────────────────────────────────────────
  const calls = replay.calls;
  const system = calls[0]?.[0]?.content || '';
  // Dernier message de chaque génération = retour d'outil / nudge de l'étape précédente
  const stepMessages = calls.slice(1).map(c => String(c[c.length - 1]?.content ?? ''));

  const toolResults = events.filter(e => e.type === 'tool_result');
  const failed = toolResults.filter(e => !e.result?.ok);
  const countIn = (arr, needle) => arr.reduce((n, s) => n + (s.split(needle).length - 1), 0);

  // Extraits RAG injectés, dans l'ordre de pertinence retourné par le store
  const ragSection = system.includes('## Extraits pertinents')
    ? system.slice(system.indexOf('## Extraits pertinents'))
    : '';
  const ragPaths = ragSection
    .split('\n### ')
    .slice(1)
    .map(b => b.split(' ')[0]);
  const ragFirst = ragPaths[0] || '';

  // Taille de la portion « contexte projet » en fin de prompt système
  const ctxStarts = [system.indexOf('## Extraits pertinents'), system.indexOf('## Arborescence')].filter(i => i >= 0);
  const contextChars = ctxStarts.length ? system.length - Math.min(...ctxStarts) : 0;

  const metrics = {
    steps: Array.isArray(result.trace) ? result.trace.length : 0,
    systemChars: system.length,
    contextChars,
    ragFirst,
    ragPaths,
    promptHash: crypto.createHash('sha256').update(system).digest('hex').slice(0, 8),
    toolErrors: failed.length,
    parseErrors: events.filter(e => e.type === 'parse_error').length,
    finishRejections: events.filter(e => e.type === 'finish_rejected').length,
    errors: failed.map(e => String(e.result?.error || '')),
    truncatedResults: countIn(stepMessages, 'tronqué'),
    stateBlocks: calls.reduce((n, c) => n + c.filter(m => String(m.content).includes('ÉTAT DE LA TÂCHE')).length, 0),
    stateText: calls
      .flat()
      .filter(m => String(m.content).includes('ÉTAT DE LA TÂCHE'))
      .map(m => String(m.content))
      .join('\n')
      .slice(0, 3000),
    stepTexts: stepMessages.map(t => t.slice(0, 400)),
    nudges: {
      verification: countIn(stepMessages, 'VÉRIFICATION OBLIGATOIRE'),
      tests:         countIn(stepMessages, '🧪 TESTS'),
      relire:        countIn(stepMessages, 'Relis le fichier entier'),
      urgent:        countIn(stepMessages, 'URGENT :'),
      remaining:     countIn(stepMessages, 'étapes restantes'),
    },
    resultTexts: toolResults.map(e => {
      try { return JSON.stringify(e.result); } catch { return ''; }
    }),
    durationMs,
  };

  const ctx = {
    result,
    events,
    trace: result.trace || [],
    metrics,
    system,
    read: rel => readProjectFile(root, rel),
  };

  // ── Vérifications ─────────────────────────────────────────────────────────
  let checks = [];
  try {
    checks = (def.checks ? def.checks(ctx) : [['tâche terminée', result.ok === true]]).map(([name, ok, detail]) => ({
      name,
      ok: !!ok,
      detail: detail == null ? '' : String(detail),
    }));
  } catch (err) {
    checks = [{ name: 'vérifications exécutables', ok: false, detail: err.message }];
  }

  if (!keep) removeSandbox(root);

  return {
    id: def.id,
    category: def.category,
    ok: checks.every(c => c.ok),
    knownIssue: def.knownIssue || null,
    checks,
    metrics,
    error: result.ok ? null : String(result.error || ''),
  };
}

/**
 * Exécute l'eval complète (ou une sélection).
 * @param {{ only?: string[]|null, keep?: boolean, quiet?: boolean }} opts
 */
async function runEval(opts = {}) {
  const { only = null, keep = false } = opts;
  const selected = TASKS.filter(t => !only || only.includes(t.id));
  if (selected.length === 0) throw new Error('AUCUNE_TÂCHE_CORRESPONDANTE');

  const prevAppData = process.env.APPDATA;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shamcode-eval-home-'));
  process.env.APPDATA = home;

  const started = Date.now();
  const results = [];
  try {
    for (const def of selected) {
      results.push(await runOne(def, { keep }));
    }
  } finally {
    process.env.APPDATA = prevAppData;
    if (!keep) { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignoré */ } }
  }
  const durationMs = Date.now() - started;

  const passed   = results.filter(r => r.ok).length;
  const known    = results.filter(r => !r.ok && r.knownIssue).length;
  const checks   = results.reduce((n, r) => n + r.checks.length, 0);
  const okChecks = results.reduce((n, r) => n + r.checks.filter(c => c.ok).length, 0);
  const avgSteps = results.length ? +(results.reduce((n, r) => n + r.metrics.steps, 0) / results.length).toFixed(1) : 0;

  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    promptHash: results[0]?.metrics.promptHash || '',
    summary: {
      tasks: results.length,
      passed,
      failed: results.length - passed,
      known,
      unknown: results.length - passed - known,
      checks,
      checksPassed: okChecks,
      avgSteps,
      systemChars: results[0]?.metrics.systemChars || 0,
      parseErrors: results.reduce((n, r) => n + r.metrics.parseErrors, 0),
      toolErrors: results.reduce((n, r) => n + r.metrics.toolErrors, 0),
      durationMs,
    },
    tasks: results,
  };
}

// ── Affichage ───────────────────────────────────────────────────────────────
const SYM = { ok: '✓', ko: '✗' };

function pad(s, n) { return String(s).padEnd(n, ' '); }

function printReport(report) {
  const s = report.summary;
  process.stdout.write('\nShamCode — eval du harnais\n');
  process.stdout.write(`prompt système : ${s.systemChars} car. (~${Math.round(s.systemChars / 4)} tokens) · empreinte ${report.promptHash || 'n/a'}\n\n`);

  for (const t of report.tasks) {
    const flag = t.ok ? SYM.ok : SYM.ko;
    process.stdout.write(
      `  ${flag} ${pad(t.id, 16)} ${pad(`${t.metrics.steps} étapes`, 11)}` +
      `${pad(`${t.metrics.toolErrors} err`, 8)}${pad(`${t.metrics.parseErrors} parse`, 10)}` +
      `${pad(`${(t.metrics.durationMs / 1000).toFixed(2)} s`, 9)}\n`,
    );
    for (const c of t.checks.filter(c => !c.ok)) {
      process.stdout.write(`      ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}\n`);
    }
    if (!t.ok && t.knownIssue) {
      process.stdout.write(`      ⚠ défaut connu : ${t.knownIssue}\n`);
    }
  }

  const knownNote = s.known ? ` (dont ${s.known} échec connu)` : '';
  process.stdout.write(`\nScore : ${s.passed}/${s.tasks} tâches${knownNote} · ${s.checksPassed}/${s.checks} vérifications\n`);
  process.stdout.write(`Coût  : ${s.avgSteps} étapes/tâche en moyenne · ${s.parseErrors} erreur(s) de parse · ${s.toolErrors} erreur(s) d'outil · ${(s.durationMs / 1000).toFixed(1)} s\n\n`);

  const unexpected = report.tasks.filter(t => !t.ok && !t.knownIssue);
  if (unexpected.length > 0) {
    process.stdout.write(`Tâches en échec : ${unexpected.map(t => t.id).join(', ')}\n\n`);
  }
}

function printCompare(base, report) {
  const b = base.summary;
  const c = report.summary;
  const d = (label, from, to, unit = '') => {
    const delta = +(to - from).toFixed(1);
    const sign = delta > 0 ? '+' : '';
    process.stdout.write(`  ${pad(label, 22)} ${pad(from + unit, 12)} → ${pad(to + unit, 12)} ${sign}${delta}${unit}\n`);
  };
  process.stdout.write(`\nComparaison avec ${base.generatedAt} (empreinte ${base.promptHash || 'n/a'})\n`);
  d('tâches réussies', b.passed, c.passed);
  d('vérifications', b.checksPassed, c.checksPassed);
  d('étapes / tâche', b.avgSteps, c.avgSteps);
  d('prompt système', b.systemChars, c.systemChars, ' car.');
  d('erreurs de parse', b.parseErrors, c.parseErrors);
  d('erreurs d\'outil', b.toolErrors, c.toolErrors);

  const before = new Map(base.tasks.map(t => [t.id, t.ok]));
  const changed = report.tasks.filter(t => before.has(t.id) && before.get(t.id) !== t.ok);
  if (changed.length) {
    process.stdout.write('\n  Changements de statut :\n');
    for (const t of changed) {
      process.stdout.write(`    ${t.id} : ${before.get(t.id) ? '✓ → ✗ régression' : '✗ → ✓ corrigé'}\n`);
    }
  }
  process.stdout.write('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { only: null, keep: false, json: false, strict: false, save: null, compare: null };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg.startsWith('--task=')) opts.only = arg.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--save=')) opts.save = arg.slice(7);
    else if (arg.startsWith('--compare=')) opts.compare = arg.slice(10);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`ARGUMENT_INCONNU: ${arg}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write('node tests/eval/run.js [--json] [--strict] [--task=id1,id2] [--save=f] [--compare=f] [--keep]\n');
    return 0;
  }

  const report = await runEval({ only: opts.only, keep: opts.keep });

  if (opts.save) {
    fs.writeFileSync(path.resolve(opts.save), JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`Résultat enregistré : ${path.resolve(opts.save)}\n`);
  }
  if (opts.compare) {
    const base = JSON.parse(fs.readFileSync(path.resolve(opts.compare), 'utf8'));
    printReport(report);
    printCompare(base, report);
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printReport(report);
  }

  return opts.strict && report.summary.unknown > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      process.stderr.write(`Eval impossible : ${err.message}\n`);
      process.exit(2);
    });
}

module.exports = { runEval, runOne, printReport, printCompare };
