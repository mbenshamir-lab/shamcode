/**
 * Outil fix_loop — boucle autonome test → analyse → fix → répéter.
 * Utilise config._llmGenerate pour obtenir les corrections du LLM
 * sans relancer une boucle agent complète.
 */

'use strict';

const { runTests } = require('./test-runner');
const { DEFAULT_TEMPERATURE } = require('../../shared/constants');

// Outils acceptés dans la boucle de fix — lecture/écriture fichier uniquement
const ALLOWED_FIX_TOOLS = new Set(['replace_code', 'write_file', 'batch_replace']);

const MAX_ITER_HARD  = 10;
const MAX_OUTPUT_FIX = 6000; // ~1500 tokens — suffisant pour localiser les échecs

const FIX_SYSTEM_PROMPT = `Tu es un correcteur de code automatique. Ta seule mission : produire des appels d'outils JSON qui corrigent les tests en échec.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec des appels d'outils JSON. Zéro prose, zéro explication.
2. Format d'un appel : {"tool":"replace_code","args":{"path":"...","old_string":"...","new_string":"..."}}
   ou : {"tool":"write_file","args":{"path":"...","content":"..."}}
   ou : {"tool":"batch_replace","args":{"pattern":"...","replacement":"...","path":"..."}}
3. Produis un ou plusieurs appels, un par ligne ou séparés par des sauts de ligne.
4. Préfère replace_code (chirurgical) à write_file (écrase tout le fichier).
5. Si tu ne peux pas corriger, réponds exactement : {"tool":"finish","args":{"summary":"unfixable"}}

Ne jamais expliquer. Ne jamais planifier. Uniquement des JSON valides.`;

/**
 * Extrait tous les appels d'outils JSON d'une réponse LLM.
 * Parcourt le texte et isole chaque objet JSON { "tool": ..., "args": ... }.
 *
 * @param {string} text
 * @returns {{ tool: string, args: object }[]}
 */
function _extractAllToolCalls(text) {
  if (!text || typeof text !== 'string') return [];
  const calls = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    let depth = 0;
    let j = start;
    while (j < text.length) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (depth === 0) break; }
      j++;
    }
    if (depth !== 0) break;
    const chunk = text.slice(start, j + 1).replace(/,(\s*[}\]])/g, '$1');
    try {
      const obj = JSON.parse(chunk);
      if (obj && typeof obj.tool === 'string' && obj.args !== undefined) calls.push(obj);
    } catch { /* JSON invalide — ignoré */ }
    i = j + 1;
  }
  return calls;
}

/**
 * Résume la sortie de tests pour le LLM : garde les lignes d'échec uniquement.
 * Évite d'envoyer des milliers de lignes de tests qui passent.
 *
 * @param {string} output
 * @returns {string}
 */
function _summarizeFailures(output) {
  if (!output) return '(aucune sortie)';
  const lines = output.split('\n');
  // Lignes d'échec (✗, ✘, FAIL, Error, assert, not equal, etc.)
  const failLines = lines.filter(l => /✗|✘|fail|error|assert|not equal|expected|actual|at Object/i.test(l));
  const relevant = failLines.length > 0 ? failLines : lines;
  return relevant.slice(0, 120).join('\n').slice(0, MAX_OUTPUT_FIX);
}

/**
 * Boucle autonome test → analyse → fix.
 *
 * @param {{ command?: string, max_iterations?: number }} args
 * @param {Function} guard
 * @param {string}   projectRoot
 * @param {object}   config
 * @returns {Promise<{ ok, fixed, iterations, history, error? }>}
 */
async function fixLoop(args, guard, projectRoot, config) {
  const llmGenerate = config._llmGenerate;
  if (!llmGenerate) return { ok: false, error: 'LLM_NON_INJECTABLE' };
  if (!projectRoot) return { ok: false, error: 'PROJET_MANQUANT' };

  const maxIter = Math.min(parseInt(args.max_iterations) || config.fixLoopMaxIterations || 5, MAX_ITER_HARD);
  const testCmd = args.command ? { command: args.command } : {};

  const history = [];

  // Lazy require — évite la dépendance circulaire (fix-loop → tools/index → fix-loop)
  const { dispatch } = require('./index');

  for (let iter = 1; iter <= maxIter; iter++) {
    // ── 1. Lancer les tests ──────────────────────────────────────────────────
    const testResult = await runTests(testCmd, projectRoot);

    if (testResult.exitCode === 0) {
      return { ok: true, fixed: iter > 1, iterations: iter - 1, history };
    }

    const failures = _summarizeFailures(testResult.stdout || testResult.error || '');

    // ── 2. Appel LLM ciblé ──────────────────────────────────────────────────
    const messages = [
      { role: 'system', content: FIX_SYSTEM_PROMPT },
      { role: 'user',   content: `Tests en échec (itération ${iter}/${maxIter}) :\n\n${failures}\n\nProduis les appels d'outils pour corriger.` },
    ];

    let llmResponse;
    try {
      llmResponse = await llmGenerate(messages, { temperature: DEFAULT_TEMPERATURE });
    } catch (e) {
      return { ok: false, error: `LLM_ERREUR: ${e.message}`, history };
    }

    // ── 3. Parser et filtrer les tool calls ──────────────────────────────────
    const toolCalls = _extractAllToolCalls(llmResponse || '');

    if (toolCalls.length === 0) {
      history.push({ iteration: iter, failures: failures.slice(0, 200), actions: [], note: 'aucun_outil' });
      return { ok: false, error: 'AUCUN_OUTIL_SUGGÉRÉ', history };
    }

    // Détecter "unfixable"
    if (toolCalls.some(c => c.tool === 'finish')) {
      history.push({ iteration: iter, failures: failures.slice(0, 200), actions: [], note: 'non_corrigeable' });
      return { ok: false, error: 'LLM_DÉCLARE_NON_CORRIGEABLE', history };
    }

    // ── 4. Appliquer les corrections ─────────────────────────────────────────
    const actions = [];
    for (const { tool, args: toolArgs } of toolCalls) {
      if (!ALLOWED_FIX_TOOLS.has(tool)) continue;
      const result = await dispatch(tool, toolArgs, guard, config);
      actions.push({ tool, args: toolArgs, ok: result.ok, error: result.error });
    }

    history.push({ iteration: iter, failures: failures.slice(0, 200), actions });

    if (actions.length === 0) {
      return { ok: false, error: 'AUCUN_OUTIL_AUTORISÉ_UTILISÉ', history };
    }
  }

  // ── Dernière vérification après épuisement des itérations ────────────────
  const finalTest = await runTests(testCmd, projectRoot);
  const allPassed = finalTest.exitCode === 0;
  return {
    ok:         allPassed,
    fixed:      allPassed,
    iterations: maxIter,
    history,
    ...(allPassed ? {} : { error: 'MAX_ITERATIONS_ATTEINT' }),
  };
}

module.exports = { fixLoop, _extractAllToolCalls, _summarizeFailures };
