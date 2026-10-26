/**
 * Définition des tâches d'eval.
 *
 * Chaque tâche décrit :
 *   - un projet de démonstration (fixture copiée dans un dossier temporaire) ;
 *   - une consigne utilisateur réaliste, écrite avec un critère de succès ;
 *   - un script de réponses LLM (trajectoire rejouée) ;
 *   - des vérifications sur le résultat : traces, événements, contenu des fichiers.
 *
 * Les scripts contiennent volontairement des erreurs réalistes (JSON malformé,
 * mauvais old_string, chemin hors projet, refus d'approbation) : ce qui est mesuré
 * est la capacité du harness à récupérer, pas la perfection du modèle.
 */

'use strict';

// ── Extraits utilisés dans plusieurs tâches ─────────────────────────────────
const MATH_OLD = '  for (let i = 0; i <= arr.length; i++) {';
const MATH_NEW = '  for (let i = 0; i < arr.length; i++) {';

const PLAN_FIX = {
  tool: 'plan',
  intent: 'Tu veux que sum() cesse de renvoyer NaN sur un tableau. Je vais lire src/math.js, corriger la borne de la boucle, puis lancer les tests.',
  args: {
    objective: 'Corriger sum() qui renvoie NaN',
    goals: ['Boucle correcte', 'Tests verts'],
    steps: ['Lire src/math.js', 'Corriger la borne de boucle', 'Vérifier le fichier', 'Lancer les tests'],
  },
};

/** @type {Array<object>} */
const TASKS = [
  // 1 ── Trajectoire nominale complète ───────────────────────────────────────
  {
    id: 'nominal-fix',
    category: 'nominal',
    fixture: 'bugfix',
    task: 'sum([1,2,3]) renvoie NaN au lieu de 6. Corrige src/math.js pour que sum additionne correctement tous les éléments. Attendu : npm test vert, sans toucher aux tests.',
    script: [
      PLAN_FIX,
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'run_tests', args: {} },
      { tool: 'finish', args: { summary: 'sum() ne dépasse plus le tableau. npm test vert (2 tests).', checks: [{ kind: 'test', command: 'npm test', result: 'pass', count: 2 }] } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['fichier corrigé', /i < arr\.length/.test(c.read('src/math.js'))],
      ['fichier non corrompu', /function average/.test(c.read('src/math.js'))],
      ['tests exécutés et verts', c.events.some(e => e.type === 'tool_result' && e.result?.runner === 'npm' && e.result.ok === true)],
      ['aucune erreur d\'outil', c.metrics.toolErrors === 0],
      ['budget respecté (≤ 8 étapes)', c.metrics.steps <= 8, `${c.metrics.steps} étapes`],
      ['catalogue ciblé (ni navigateur ni média)', !c.system.includes('browser_open') && !c.system.includes('generate_video')],
    ],
  },

  // 2 ── Récupération après JSON invalide ────────────────────────────────────
  {
    id: 'recover-json',
    category: 'recovery',
    fixture: 'bugfix',
    task: 'Dis-moi en une phrase ce que fait average(). Aucune modification attendue.',
    script: [
      'Bien sûr ! Je vais regarder le fichier src/math.js et te répondre.',
      { tool: 'finish', args: { summary: 'average() renvoie la somme divisée par le nombre d\'éléments.' } },
    ],
    checks: (c) => [
      ['tâche terminée malgré le format invalide', c.result.ok === true, c.result.error],
      ['erreur de parse détectée', c.metrics.parseErrors >= 1, `${c.metrics.parseErrors}`],
      ['pas de consommation excessive', c.metrics.steps <= 3, `${c.metrics.steps} étapes`],
    ],
  },

  // 3 ── Récupération après mauvais old_string ──────────────────────────────
  {
    id: 'recover-block',
    category: 'recovery',
    fixture: 'bugfix',
    task: 'La boucle de sum() est fausse. Corrige-la dans src/math.js.',
    script: [
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: 'let total = 1;', new_string: 'let total = 0;' } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'finish', args: { summary: 'Boucle corrigée après relecture du fichier.', checks: [{ kind: 'file', path: 'src/math.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée après l\'échec', c.result.ok === true, c.result.error],
      ['BLOC_INTROUVABLE remonté', c.metrics.errors.includes('BLOC_INTROUVABLE')],
      ['fichier corrigé malgré l\'échec', /i < arr\.length/.test(c.read('src/math.js'))],
      ['guidage de relecture émis', c.metrics.nudges.relire >= 1, `${c.metrics.nudges.relire}`],
    ],
  },

  // 4 ── path-guard : lecture hors projet ────────────────────────────────────
  {
    id: 'path-guard',
    category: 'security',
    fixture: 'bugfix',
    task: 'Lis la configuration système puis corrige sum() si besoin.',
    script: [
      { tool: 'read_file', args: { path: '../../Windows/win.ini' } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'finish', args: { summary: 'Chemin système refusé, lecture du projet effectuée.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['lecture hors projet bloquée', c.metrics.errors.some(e => e.includes('PATH_GUARD'))],
      ['aucun contenu système injecté', !c.system.includes('win.ini') || !/\[fonts\]/i.test(c.system)],
      ['lecture normale toujours possible', c.events.some(e => e.type === 'tool_result' && e.result?.ok && String(e.result?.content || '').includes('function sum'))],
    ],
  },

  // 5 ── Approbation refusée : le fichier ne doit pas changer ────────────────
  {
    id: 'approval-reject',
    category: 'security',
    fixture: 'feature',
    task: 'Ajoute une fonction truncate(text, max) dans src/truncate.js.',
    config: { requestApproval: async () => false },
    script: [
      { tool: 'write_file', args: { path: 'src/truncate.js', content: 'function truncate(text, max) { return text.slice(0, max); }\n' } },
      { tool: 'finish', args: { summary: 'Écriture refusée par l\'utilisateur.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['refus remonté au modèle', c.metrics.errors.some(e => e.includes('REJETÉ_PAR_UTILISATEUR'))],
      ['aucun fichier créé', c.read('src/truncate.js') === ''],
    ],
  },

  // 6 ── Ajout de fonctionnalité (replace_code sur export) ───────────────────
  {
    id: 'feature-create',
    category: 'nominal',
    fixture: 'feature',
    task: 'Ajoute truncate(text, max) dans src/strings.js : renvoie le texte tel quel s\'il tient, sinon les (max-1) premiers caractères suivis de « … ». Garde slugify intacte et mets l\'export à jour.',
    script: [
      { tool: 'plan', intent: 'Tu veux une fonction truncate exportée. Je vais lire src/strings.js, l\'ajouter, mettre à jour l\'export puis relire le fichier.', args: { objective: 'Ajouter truncate() et son export', goals: ['Signature respectée', 'slugify intacte'], steps: ['Lire src/strings.js', 'Ajouter truncate', 'Mettre à jour l\'export', 'Vérifier'] } },
      { tool: 'read_file', args: { path: 'src/strings.js' } },
      { tool: 'replace_code', args: {
        path: 'src/strings.js',
        old_string: 'module.exports = { slugify };',
        new_string: "function truncate(text, max) {\n  if (text.length <= max) return text;\n  return text.slice(0, max - 1) + '…';\n}\n\nmodule.exports = { slugify, truncate };",
      } },
      { tool: 'read_file', args: { path: 'src/strings.js' } },
      { tool: 'finish', args: { summary: 'truncate ajoutée et exportée ; slugify inchangée.', checks: [{ kind: 'file', path: 'src/strings.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['fonction ajoutée', /function truncate\(text, max\)/.test(c.read('src/strings.js'))],
      ['export mis à jour', /module\.exports = \{ slugify, truncate \};/.test(c.read('src/strings.js'))],
      ['slugify préservée', /function slugify/.test(c.read('src/strings.js'))],
    ],
  },

  // 7 ── Le nudge de vérification est-il émis ? (mesure, pas garantie) ───────
  {
    id: 'verify-nudge',
    category: 'probe',
    fixture: 'bugfix',
    task: 'Corrige la boucle de sum().',
    script: [
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'finish', args: { summary: 'Correction appliquée.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['nudge de vérification émis', c.metrics.nudges.verification >= 1, `${c.metrics.nudges.verification}`],
      ['nudge tests émis', c.metrics.nudges.tests >= 1, `${c.metrics.nudges.tests}`],
      ['finish sans preuve relancé une fois', c.metrics.finishRejections === 1 && c.metrics.steps === 3, `steps=${c.metrics.steps} rejects=${c.metrics.finishRejections}`],
    ],
  },

  // ── Terminaison prouvée : un finish sans preuve est relancé ───────────────
  {
    id: 'finish-proof',
    category: 'security',
    fixture: 'bugfix',
    task: 'Corrige la boucle de sum() dans src/math.js.',
    script: [
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'finish', args: { summary: 'Correction appliquée.' } },
      { tool: 'finish', args: { summary: 'Correction appliquée et relue.', checks: [{ kind: 'file', path: 'src/math.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée avec preuve', c.result.ok === true, c.result.error],
      ['finish sans preuve refusé une fois', c.metrics.finishRejections === 1, `${c.metrics.finishRejections}`],
      ['résumé final conservé', /relue/.test(c.result.summary || '')],
      ['pas de boucle de relance', c.metrics.steps === 3, `${c.metrics.steps} étapes`],
    ],
  },

  // ── Compaction : l'état de tâche survit à la fenêtre glissante ─────────────
  {
    id: 'compaction-state',
    category: 'context',
    fixture: 'mixed',
    task: 'Lis src/cart.js par petits morceaux pour comprendre son contenu, puis résume.',
    config: { maxSteps: 18 },
    script: [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(n => ({
        tool: 'read_file', args: { path: 'src/cart.js', start_line: n, end_line: n + 3 },
      })),
      { tool: 'finish', args: { summary: 'cart.js contient computeTotal et describeCart.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['fenêtre glissante activée', c.metrics.steps >= 14, `${c.metrics.steps} étapes`],
      ['état de tâche injecté à la compaction', c.metrics.stateBlocks >= 1, `${c.metrics.stateBlocks}`],
      ['état nomme le fichier lu', c.metrics.stateText.includes('src/cart.js')],
      ['rappel compact dans le compteur d\'étapes', c.metrics.stepTexts.some(t => t.includes('lus:'))],
    ],
  },

  // 8 ── Le contexte projet contient-il le symbole cherché ? ────────────────
  {
    id: 'context-rag',
    category: 'context',
    fixture: 'mixed',
    task: 'Que fait padLabel() et dans quel fichier est-elle définie ? Réponds sans modifier de fichier.',
    script: [
      { tool: 'finish', args: { summary: 'padLabel tronque ou complète un libellé à une largeur donnée, dans src/format.js.' } },
    ],
    checks: (c) => {
      // Garde-fou direct contre le défaut « vecteurs de longueurs différentes » :
      // deux textes doivent produire des vecteurs comparables (même dimension, non nuls).
      const { encode } = require('../../src/harness/rag/embedder');
      const a = encode('total commande calcul');
      const b = encode('function computeTotal(items) { return items; }');
      return [
        ['tâche terminée', c.result.ok === true, c.result.error],
        ['extraits RAG injectés', c.metrics.ragPaths.length > 0, `${c.metrics.ragPaths.length} extrait(s)`],
        ['fichier pertinent dans les 2 premiers extraits', c.metrics.ragPaths.slice(0, 2).includes('src/format.js'), c.metrics.ragPaths.join(' > ')],
        ['vecteurs comparables (dimension fixe, non nuls)', a.length === b.length && a.length > 0 && a.some(v => v !== 0) && b.some(v => v !== 0), `${a.length}/${b.length}`],
        ['symbole présent dans le prompt système', c.system.includes('padLabel')],
      ];
    },
  },

  // 9 ── Troncature d'une lecture longue et pagination ─────────────────────
  {
    id: 'truncation',
    category: 'context',
    fixture: 'large',
    task: 'Lis src/large.js autour de la ligne 180 et dis-moi ce qu\'il y a à cet endroit.',
    script: [
      { tool: 'read_file', args: { path: 'src/large.js' } },
      { tool: 'read_file', args: { path: 'src/large.js', start_line: 175, end_line: 185 } },
      { tool: 'finish', args: { summary: 'La ligne 180 contient le marqueur MARKER-180.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['première lecture tronquée', c.metrics.truncatedResults >= 1, `${c.metrics.truncatedResults}`],
      ['lecture paginée possible', c.events.some(e => e.type === 'tool_result'
        && String(e.result?.content || '').includes('[Lignes 175')
        && String(e.result.content).includes('MARKER-180'))],
      ['total de lignes annoncé', c.events.some(e => e.type === 'tool_result' && e.result?.total_lines === 212)],
    ],
  },

  // 10 ── Sélection dynamique des outils (ADR-018) ──────────────────────────
  {
    id: 'tool-selection',
    category: 'context',
    fixture: 'mixed',
    task: 'Ouvre le navigateur sur https://example.com, connecte-toi puis clique sur le bouton Valider.',
    script: [
      { tool: 'browser_launch', args: { url: 'https://example.com' } },
      { tool: 'finish', args: { summary: 'Outil inconnu, puis arrêt.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['famille navigateur chargée', c.system.includes('browser_open') && c.system.includes('browser_click')],
      ['famille média non chargée', !c.system.includes('merge_videos')],
      ['outils de base toujours présents', c.system.includes('replace_code') && c.system.includes('run_tests')],
      ['outil inventé guidé vers les familles', c.metrics.errors.some(e => e.includes('OUTIL_INCONNU') && e.includes('familles disponibles'))],
    ],
  },

  // 11 ── Budget de contexte : troncature au lieu du rejet ──────────────────
  {
    id: 'context-budget',
    category: 'context',
    fixture: 'large',
    task: 'Résume ce que contient src/large.js, sans le modifier.',
    config: { contextBudget: 4000 },
    script: [
      { tool: 'finish', args: { summary: 'Fichier de fonctions de test, sans logique métier.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['arborescence conservée', c.system.includes('## Arborescence')],
      ['extraits RAG conservés', c.system.includes('## Extraits pertinents')],
      ['troncature signalée au modèle', c.system.includes('tronqué')],
      ['budget respecté (≤ 4 200 car. de contexte)', c.metrics.contextChars > 0 && c.metrics.contextChars <= 4200, `${c.metrics.contextChars} car.`],
    ],
  },

  // ── Validation d'arguments avant exécution ────────────────────────────────
  {
    id: 'arg-validation',
    category: 'security',
    fixture: 'bugfix',
    task: 'Lis src/math.js et dis-moi ce que fait sum().',
    script: [
      { tool: 'read_file', args: {} },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'finish', args: { summary: 'sum() additionne les éléments du tableau.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['argument manquant nommé', c.metrics.errors.some(e => e.includes('ARGUMENT_MANQUANT') && e.includes('path'))],
      ['exemple fourni au modèle', c.metrics.errors.some(e => e.includes('"path":"src/app.js"'))],
      ['appel corrigé accepté', c.events.some(e => e.type === 'tool_result' && e.result?.ok && String(e.result?.content || '').includes('function sum'))],
    ],
  },

  // ── Plan révisable une fois après lecture (F4) ────────────────────────────
  {
    id: 'plan-revision',
    category: 'nominal',
    fixture: 'bugfix',
    task: 'La fonction sum() renvoie NaN. Corrige-la dans src/math.js.',
    script: [
      { tool: 'plan', args: { objective: 'Corriger sum()', goals: ['Boucle correcte'], steps: ['Corriger le calcul', 'Vérifier', 'Finish'] } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'plan', args: { objective: 'Corriger la borne de boucle de sum()', goals: ['Boucle correcte', 'Tests verts'], steps: ['Remplacer i <= par i < dans src/math.js', 'Relire src/math.js', 'Finish'], revised: true } },
      { tool: 'plan', args: { objective: 'Encore un plan', goals: [], steps: ['boucle'], revised: true } },
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'finish', args: { summary: 'Borne de boucle corrigée.', checks: [{ kind: 'file', path: 'src/math.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['deux plans émis (initial + révisé)', c.events.filter(e => e.type === 'plan_ready').length === 2],
      ['second plan marqué révisé', c.events.find(e => e.type === 'plan_ready' && e.plan?.revised) != null],
      ['troisième plan refusé', c.metrics.errors.some(e => e.includes('PLAN_DEJA_RÉVISÉ'))],
      ['fichier corrigé', /i < arr\.length/.test(c.read('src/math.js'))],
      ['budget tenu (≤ 8 étapes)', c.metrics.steps <= 8, `${c.metrics.steps} étapes`],
    ],
  },

  // ── Profil de prompt allégé (L6) ──────────────────────────────────────────
  {
    id: 'prompt-profile',
    category: 'context',
    fixture: 'bugfix',
    task: 'Corrige la boucle de sum() dans src/math.js.',
    config: { promptProfile: 'minimal' },
    script: [
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'replace_code', args: { path: 'src/math.js', old_string: MATH_OLD, new_string: MATH_NEW } },
      { tool: 'read_file', args: { path: 'src/math.js' } },
      { tool: 'finish', args: { summary: 'Boucle corrigée.', checks: [{ kind: 'file', path: 'src/math.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['sections optionnelles retirées', !c.system.includes('STANDARDS PROFESSIONNELS')
        && !c.system.includes('DIRECTIVES DE CONFIGURATION')
        && !c.system.includes('note_user — SIGNALER')],
      ['règles essentielles conservées', c.system.includes('UNIQUEMENT par un objet JSON')
        && c.system.includes('RÈGLES NON NÉGOCIABLES')
        && c.system.includes('OUTILS DISPONIBLES')],
      ['prompt allégé (< 14 500 car. avec contexte)', c.metrics.systemChars < 14500, `${c.metrics.systemChars} car.`],
    ],
  },

  // 12 ── Budget d'étapes : arrêt propre + avertissements ───────────────────
  {
    id: 'budget-stop',
    category: 'budget',
    fixture: 'bugfix',
    task: 'Explore le projet sans jamais terminer.',
    config: { maxSteps: 6 },
    script: [
      { tool: 'list_dir', args: { path: '.' } },
    ],
    checks: (c) => [
      ['arrêt sur budget, pas de crash', c.result.ok === false && c.result.error === 'MAX_STEPS_ATTEINT', c.result.error],
      ['trace complète', c.metrics.steps === 6, `${c.metrics.steps} étapes`],
      ['avertissement précoce émis', c.metrics.nudges.remaining >= 1, `${c.metrics.nudges.remaining}`],
      ['consigne URGENT émise', c.metrics.nudges.urgent >= 1, `${c.metrics.nudges.urgent}`],
    ],
  },

  // 11 ── Ambiguïté : ask_user avant d'agir ────────────────────────────────
  {
    id: 'ambiguity',
    category: 'recovery',
    fixture: 'mixed',
    task: 'Améliore le projet.',
    script: [
      { tool: 'ask_user', args: { question: 'Que veux-tu améliorer en priorité ?', context: 'La demande est trop large pour être exécutée telle quelle.', suggestions: ['La lisibilité', 'Les tests', 'Les performances'] } },
      { tool: 'finish', args: { summary: 'Question posée à l\'utilisateur avant toute modification.' } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['question posée', c.events.some(e => e.type === 'ask_user')],
      ['réponse transmise au modèle', c.metrics.resultTexts.some(t => t.includes('La lisibilité'))],
      ['aucune écriture avant clarification', c.metrics.errors.length === 0],
    ],
  },

  // 12 ── Tâche multi-fichiers : coût en étapes ────────────────────────────
  {
    id: 'multi-file',
    category: 'nominal',
    fixture: 'mixed',
    task: 'Arrondis computeTotal au centime dans src/cart.js, et affiche les montants avec une virgule dans src/format.js. Attendu : les deux fichiers modifiés, aucune autre modification.',
    script: [
      { tool: 'plan', intent: 'Tu veux deux modifications d\'affichage du montant. Je vais lire les deux fichiers, arrondir le total, puis formater avec une virgule.', args: { objective: 'Arrondir le total et formater à la française', goals: ['Arrondi au centime', 'Virgule décimale'], steps: ['Lire src/cart.js', 'Arrondir computeTotal', 'Lire src/format.js', 'Formater avec une virgule', 'Vérifier'] } },
      { tool: 'read_file', args: { path: 'src/cart.js' } },
      { tool: 'replace_code', args: {
        path: 'src/cart.js',
        old_string: '  return items.reduce((acc, item) => acc + item.unit * item.qty, 0);',
        new_string: '  const raw = items.reduce((acc, item) => acc + item.unit * item.qty, 0);\n  return Math.round(raw * 100) / 100;',
      } },
      { tool: 'read_file', args: { path: 'src/format.js' } },
      { tool: 'replace_code', args: {
        path: 'src/format.js',
        old_string: '  return `${Number(value).toFixed(2)} ${currency}`;',
        new_string: '  return `${Number(value).toFixed(2).replace(\'.\', \',\')} ${currency}`;',
      } },
      { tool: 'read_file', args: { path: 'src/cart.js' } },
      { tool: 'finish', args: { summary: 'computeTotal arrondi au centime ; formatMoney affiche une virgule.', checks: [{ kind: 'file', path: 'src/cart.js' }, { kind: 'file', path: 'src/format.js' }] } },
    ],
    checks: (c) => [
      ['tâche terminée', c.result.ok === true, c.result.error],
      ['arrondi appliqué', /Math\.round\(raw \* 100\) \/ 100/.test(c.read('src/cart.js'))],
      ['format à la française', /replace\('\.', ','\)/.test(c.read('src/format.js'))],
      ['budget tenu (≤ 10 étapes)', c.metrics.steps <= 10, `${c.metrics.steps} étapes`],
      ['aucune erreur d\'outil', c.metrics.toolErrors === 0],
    ],
  },
];

module.exports = { TASKS };
