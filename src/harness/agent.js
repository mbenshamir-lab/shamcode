// RAG activé : ce module utilise le RAG (store + indexer + buildContext) pour enrichir le prompt système avec le contexte projet pertinent avant génération.
/**
 * Boucle principale de l'agent.
 * N'importe JAMAIS electron — llmGenerate est injecté en paramètre.
 *
 * @param {object} opts
 * @param {string}   opts.task          - Tâche décrite par l'utilisateur
 * @param {Function} opts.llmGenerate   - async (messages, options) => string
 * @param {string}   opts.projectRoot   - Chemin absolu du dossier projet
 * @param {object}   [opts.config]      - Config utilisateur (maxSteps, temperature...)
 * @param {Function} [opts.onEvent]     - Callback(event) pour streamer la trace à l'UI
 * @returns {Promise<{ok, summary?, trace, error?}>}
 */

const { extractToolCall }       = require('./parser');
const { dispatch }              = require('./tools/index');
const { selectToolsForTask, describeFamilies } = require('./tools/families');
const { McpRegistry }           = require('./mcp/registry');
const { makeGuard }             = require('./safety/path-guard');
const { buildSystemPrompt }     = require('./prompts/system');
const { resolvePromptProfile }  = require('./prompts/profile');
const { resolvePersona }        = require('./prompts/personas');
const { detectLanguage, getLangRules } = require('./prompts/by-language');
const { buildContext }          = require('./context/builder');
const { createStore }       = require('./rag/store');
const { EMBEDDER_VERSION }  = require('./rag/embedder');
const { indexProject, CHUNKER_VERSION } = require('./rag/indexer');
const { createSession, updateSession, applyRetention } = require('./memory/sessions');
const { createScratchpad }  = require('./memory/scratchpad');
const {
  MAX_STEPS, MAX_CONTEXT_CHARS, DEFAULT_TEMPERATURE, MAX_RETRIES_PER_STEP, TOOLS,
  SESSIONS_RETENTION, TDD_PHASES,
  MAX_RESULT_CHARS = 6000, WINDOW_KEEP_PAIRS = 10, WINDOW_THRESHOLD = 26,
} = require('../shared/constants');
const { disposeBrowser }    = require('./tools/browser');
const { _detectRunner }     = require('./tools/test-runner');
const { disposeLsp }        = require('./tools/lsp');
const { recordFeedback, loadFeedback } = require('./feedback/store');
const { buildFeedbackSummary }         = require('./feedback/advisor');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// Noms acceptés pour le fichier guide du projet — AGENTS.md en priorité, Sham.md en fallback (projets existants)
const AGENTS_CANDIDATES = ['AGENTS.md', 'agents.md', 'Sham.md', 'SHAM.md', 'sham.md'];
// Fichiers de consignes déjà écrits par d'autres outils : lus après AGENTS.md, plus court,
// pour qu'un projet existant (CLAUDE.md, .cursorrules…) ne perde pas ses conventions.
const CONVENTION_CANDIDATES = ['CLAUDE.md', 'claude.md', '.cursorrules', '.cursor/rules', '.github/copilot-instructions.md', 'CONTRIBUTING.md'];
const AGENTS_MAX_CHARS  = 4000; // ~1000 tokens — garde la lecture courte
const CONVENTION_MAX_CHARS = 2000;

/** Coupe un texte sur une frontière de ligne (jamais en pleine phrase). */
function _cutAtLine(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastNewline = cut.lastIndexOf('\n');
  return lastNewline > max * 0.6 ? cut.slice(0, lastNewline) : cut;
}

// Détection du runner de tests, mémorisée : sert à ne pas réclamer run_tests
// sur un projet qui n'a aucune suite de tests.
const _runnerCache = new Map();
function _projectHasTests(projectRoot) {
  if (_runnerCache.has(projectRoot)) return _runnerCache.get(projectRoot);
  let has = false;
  try { has = !!_detectRunner(projectRoot); } catch { has = false; }
  _runnerCache.set(projectRoot, has);
  return has;
}

/** Lit le guide du projet : AGENTS.md/Sham.md, sinon un fichier de consignes existant. Retourne '' si absent. */
function _readAgentsFile(projectRoot) {
  const groups = [
    [AGENTS_CANDIDATES, AGENTS_MAX_CHARS],
    [CONVENTION_CANDIDATES, CONVENTION_MAX_CHARS],
  ];
  for (const [names, maxChars] of groups) {
    for (const name of names) {
      try {
        const p = path.join(projectRoot, name);
        if (fs.existsSync(p)) {
          return _cutAtLine(fs.readFileSync(p, 'utf8'), maxChars);
        }
      } catch { /* ignoré */ }
    }
  }
  return '';
}

// Limites de consommation de contexte : définies dans shared/constants.js

/**
 * Construit le contenu du premier message utilisateur.
 * Si des images sont présentes (Gemini Vision / Claude Vision), retourne un tableau
 * de blocs multimodaux. Sinon retourne la tâche sous forme de chaîne simple.
 *
 * @param {string} task
 * @param {{ name: string, base64: string, mimeType: string }[] | undefined} images
 * @returns {string | Array}
 */
function _buildTaskContent(task, images) {
  if (!images || images.length === 0) return task;
  return [
    { type: 'text', text: task },
    ...images.map(img => ({ type: 'image', base64: img.base64, mimeType: img.mimeType, name: img.name })),
  ];
}

/** Tronque un résultat d'outil trop long pour ne pas saturer le contexte. */
function _truncateResult(result) {
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  if (s.length <= MAX_RESULT_CHARS) return result;
  const kept = s.slice(0, MAX_RESULT_CHARS);
  const omitted = s.length - MAX_RESULT_CHARS;
  return kept + `\n[… tronqué — ${omitted} caractères omis]`;
}

/**
 * Fenêtre glissante : conserve [system, user(task)] + les WINDOW_KEEP_PAIRS dernières
 * paires. Le message d'omission porte l'état de la tâche reconstruit depuis la trace :
 * sans lui, la compaction faisait perdre le plan et la liste des fichiers déjà traités,
 * et le modèle relisait tout.
 *
 * @param {Array}  messages
 * @param {string} [stateBlock] texte court rappelant ce qui a été lu / modifié / échoué
 * @param {object} [opts] { keepPairs, threshold } — surcharge via config
 */
function _windowMessages(messages, stateBlock = '', opts = {}) {
  const keepPairs = opts.keepPairs ?? WINDOW_KEEP_PAIRS;
  const threshold = opts.threshold ?? WINDOW_THRESHOLD;
  if (messages.length <= threshold) return messages;
  const head   = messages.slice(0, 2);                 // system + user initial
  const tail   = messages.slice(-(keepPairs * 2));     // N dernières paires
  const omitted = messages.length - 2 - (keepPairs * 2);
  const note = {
    role: 'user',
    content: `[Note système : ${omitted} message(s) anciens omis pour économiser le contexte. Utilise l'état ci-dessous plutôt que de tout relire.]${stateBlock ? `\n\n${stateBlock}` : ''}`,
  };
  return [...head, note, ...tail];
}

/** Index de la première paire tail dans messages (1-based en étapes) lorsque la fenêtre est active. */
function _windowTailStart(msgCount, opts = {}) {
  const keepPairs = opts.keepPairs ?? WINDOW_KEEP_PAIRS;
  const threshold = opts.threshold ?? WINDOW_THRESHOLD;
  if (msgCount <= threshold) return 0;
  // Chaque étape produit 2 messages (assistant + user), donc on divise par 2
  return Math.max(0, (msgCount - 2 - keepPairs * 2) / 2);
}

async function runAgent({ task, llmGenerate, projectRoot, config = {}, onEvent = () => {}, signal = null }) {
  const maxSteps = config.maxSteps ?? MAX_STEPS;
  // Surcharges de consommation de contexte (cf. docs/DECISIONS.md) — undefined retombe sur la constante
  const windowOpts = { keepPairs: config.windowKeepPairs, threshold: config.windowThreshold };
  const guard    = makeGuard(projectRoot);

  // Les sous-agents ne créent pas de session propre — ils s'exécutent dans le contexte du parent.
  const isSubAgent = !!config._subAgent;
  let sessionPath, session;
  const scratchpad = createScratchpad();
  // Injecter le scratchpad dans config pour que l'outil scratchpad y accède via dispatch
  config._scratchpad = scratchpad;

  // Feedback learning — wrap requestApproval pour enregistrer chaque décision
  if (config.enableFeedbackLearning && config.requestApproval && !isSubAgent) {
    const _orig = config.requestApproval;
    config.requestApproval = async (preview) => {
      const approved = await _orig(preview);
      recordFeedback({ projectRoot, path: preview.path || '', action: preview.type || preview.action || '', approved });
      return approved;
    };
  }
  if (!isSubAgent) {
    ({ path: sessionPath, session } = createSession({ task, projectRoot }));
    applyRetention(config.sessionsRetention ?? SESSIONS_RETENTION);
  } else {
    session = { id: null };
  }

  // Catalogue complet — filtré selon le contexte (agent principal vs sous-agent)
  const allToolDefs = {
    plan:         'plan         — args: { "objective": "1 ligne ≤ 90 car.", "goals": ["3-4 max, ≤ 60 car."], "steps": ["3-6 max, ≤ 70 car., verbe à l\'infinitif"] }  — briefe l\'utilisateur sur ce que tu as compris et ce que tu vas faire (intent = « tu veux… / je vais… »). À utiliser librement selon la complexité de la tâche.',
    read_file:    'read_file    — args: { "path": "...", "start_line"?: N, "end_line"?: N }  — lit un fichier (ou une plage de lignes)',
    write_file:   'write_file   — args: { "path": "...", "content": "..." }  — écrit/crée un fichier',
    replace_code: 'replace_code — args: { "path": "...", "old_string": "...", "new_string": "..." }  — remplace une chaîne exacte',
    list_dir:     'list_dir     — args: { "path": "...", "recursive"?: true, "depth"?: N }  — liste un dossier (récursif optionnel, depth max 5)',
    find_symbol:         'find_symbol         — args: { "name": "...", "path"?: "...", "exact"?: true }  — trouve une fonction/classe par nom (retourne chemin + ligne)',
    find_dependents:     'find_dependents     — args: { "path": "src/foo.js", "depth"?: 1 }  — quels fichiers importent ce fichier ? (impact d\'une modification) ; depth>1 pour remonter la chaîne (max 4)',
    find_dependencies:   'find_dependencies   — args: { "path": "src/foo.js", "depth"?: 1 }  — quels fichiers ce fichier importe-t-il ? (dépendances directes) ; depth>1 pour descendre la chaîne (max 4)',
    find_relevant_files: 'find_relevant_files — args: { "task": "...", "top_k"?: 10 }  — trouve les fichiers les plus pertinents pour une tâche (basé sur l\'index RAG du projet)',
    run_tests:        'run_tests        — args: { "command"?: "npm test" }  — lance les tests du projet (auto-détecté), vérifie que les modifs ne cassent rien',
    format_file:      'format_file      — args: { "path": "..." }  — formate un fichier avec prettier ou eslint --fix (si disponible dans le projet)',
    get_project_info: 'get_project_info — args: {}  — lit les métadonnées du projet (nom, version, scripts, dépendances clés)',
    restore_file:     'restore_file     — args: { "path": "...", "list"?: true, "backup_index"?: 0 }  — restaure un fichier depuis son backup (annule une modification)',
    scratchpad:       'scratchpad       — args: { "action": "set|get|append|list", "key"?: "...", "value"?: "..." }  — notes intra-session : mémorise des décisions, l\'état courant, des informations à réutiliser plus tard',
    project_note:     'project_note     — args: { "action": "set|get|list|delete|search", "key"?: "...", "value"?: "...", "tags"?: [], "task"?: "..." }  — mémoire persistante inter-sessions : conventions du projet, stack, décisions d\'archi, endpoints — survit entre sessions (≠ scratchpad)',
    diff_file:        'diff_file        — args: { "path": "...", "backup_index"?: 0 }  — diff entre le fichier courant et son backup (vérifie ce qui a changé avant de terminer)',
    batch_replace:    'batch_replace    — args: { "pattern": "...", "replacement": "...", "path"?: "...", "ext"?: ".js", "dry_run"?: true }  — remplace un pattern regex dans tous les fichiers du projet (backup auto avant chaque écriture)',
    read_url:         'read_url         — args: { "url": "https://...", "max_chars"?: 5000 }  — lit une page web ou doc (stripping HTML) pour consulter de la documentation',
    web_search:       'web_search       — args: { "query": "...", "max_results"?: 5 }  — recherche sur le web (DuckDuckGo) et retourne titre + URL + snippet des résultats. Utiliser avant read_url pour trouver l\'URL exacte d\'une doc ou d\'une solution.',
    lsp_hover:        'lsp_hover        — args: { "path": "src/foo.ts", "line": 42, "col"?: 5 }  — type, signature et documentation d\'un symbole via le Language Server (TypeScript, Python…). line/col = 1-based (comme find_symbol). Nécessite enableLsp.',
    lsp_definition:   'lsp_definition   — args: { "path": "src/foo.ts", "line": 42, "col"?: 5 }  — fichier + ligne de la définition d\'un symbole. Nécessite enableLsp.',
    lsp_references:   'lsp_references   — args: { "path": "src/foo.ts", "line": 42, "col"?: 5 }  — toutes les utilisations d\'un symbole dans le projet. Nécessite enableLsp.',
    fix_loop:         'fix_loop         — args: { "command"?: "npm test", "max_iterations"?: 5 }  — boucle autonome test→analyse→fix : lance les tests, appelle le LLM pour corriger les échecs, réapplique jusqu\'à succès ou max_iterations. Nécessite enableFixLoop.',
    http_request:     'http_request     — args: { "url": "...", "method"?: "GET|POST|PUT|PATCH|DELETE", "headers"?: {}, "body"?: "...", "timeout"?: 10000 }  — requête HTTP vers une app locale ou distante (teste une API, envoie des données)',
    check_service:    'check_service    — args: { "url"?: "...", "port"?: 3000, "host"?: "localhost", "timeout"?: 5000 }  — vérifie si un serveur ou port est accessible',
    deploy:           'deploy           — args: { "platform"?: "auto|vercel|netlify|fly|railway|docker|npm-deploy", "command"?: "...", "build_first"?: true, "timeout"?: 300 }  — déploie l\'application (Vercel, Netlify, Fly.io, Railway, Docker, npm run deploy)',
    start_process:   'start_process    — args: { "command": "...", "name"?: "...", "cwd"?: "..." }  — démarre un processus en arrière-plan (serveur de dev, watcher…) ; requiert enableShell',
    stop_process:    'stop_process     — args: { "name": "...", "force"?: false }  — arrête un processus par son nom',
    get_output:      'get_output       — args: { "name": "...", "lines"?: 50 }  — retourne les dernières lignes stdout/stderr d\'un processus',
    list_processes:  'list_processes   — args: {}  — liste tous les processus gérés et leur statut',
    search_grep:      'search_grep      — args: { "pattern": "...", "path": "..." (opt), "ext": ".js" (opt), "context_lines"?: 2 }  — recherche dans les fichiers (context_lines = lignes de contexte autour du match)',
    git_status:        'git_status        — args: {}  — fichiers modifiés dans le repo git',
    git_diff:          'git_diff          — args: { "path": "..." (opt) }  — diff git',
    git_create_branch: 'git_create_branch — args: { "name": "feat/ma-branche", "from"?: "main" }  — crée et bascule sur une nouvelle branche (requiert enableGitWrite)',
    git_commit:        'git_commit        — args: { "message": "...", "paths"?: ["src/foo.js"] }  — stage les fichiers et crée un commit (requiert enableGitWrite)',
    run_shell:    'run_shell    — args: { "command": "..." }  — exécute une commande (activé)',
    spawn_agent:          'spawn_agent          — args: { "role": "refactorer|test-writer|debugger|doc-writer|analyzer", "task": "..." }  — délègue à un sous-agent spécialisé',
    spawn_parallel:       'spawn_parallel       — args: { "agents": [{"role": "...", "task": "..."}, ...] }  — lance plusieurs sous-agents en parallèle (tâches indépendantes) ; partage automatiquement le bus de messages',
    ask_user:             'ask_user             — args: { "question": "...", "context"?: "...", "suggestions"?: ["option A","option B","option C"] }  — demande une clarification à l\'utilisateur AVANT d\'agir ; suggestions = choix proposés (optionnel)',
    note_user:            'note_user            — args: { "message": "...", "level"?: "info|warn|error" }  — signale une trouvaille ou situation notable PENDANT l\'exécution (bug découvert, incohérence, point d\'attention, décision importante) pour attirer l\'attention de l\'utilisateur sans bloquer la tâche',
    notify_user:          'notify_user          — args: { "title": "...", "body": "..." }  — envoie une notification système à l\'utilisateur (notification Windows) ; réservé aux tâches planifiées pour signaler un résultat important',
    generate_video:       'generate_video       — args: { "prompt": "...", "provider"?: "<nom_fournisseur>", "output"?: "video.mp4", "duration"?: 5, "ratio"?: "16:9|9:16|1:1", "image"?: "chemin/image.jpg ou URL", "model"?: "..." }  — génère une vidéo IA via un fournisseur enregistré dans Paramètres > Agent > Fournisseurs IA (API OpenAI Videos-compatible, endpoint /videos, polling GET /videos/{id}) ; si provider absent, utilise le premier fournisseur configuré',
    generate_image:       'generate_image       — args: { "prompt": "...", "provider"?: "<nom_fournisseur>", "output"?: "image.png", "ratio"?: "1:1|16:9|9:16|4:3|3:4", "quality"?: "standard|hd", "model"?: "...", "format"?: "png|jpg" }  — génère une image IA via un fournisseur enregistré dans Paramètres > Agent > Fournisseurs IA (API OpenAI-compatible, endpoint /images/generations) ; si provider absent, utilise le premier fournisseur configuré',
    merge_videos:         'merge_videos         — args: { "inputs": ["clip1.mp4","clip2.mp4",...], "output"?: "final.mp4", "reencode"?: false }  — fusionne plusieurs clips vidéo en un seul fichier via ffmpeg (doit être installé : winget install ffmpeg) ; reencode:true si les clips ont des codecs différents',
    generate_speech:      'generate_speech      — args: { "text": "...", "output"?: "narration.wav", "voice"?: "Microsoft Zira Desktop", "rate"?: 0, "volume"?: 100 }  — synthèse vocale hors-ligne via Windows SAPI (intégré Windows, gratuit) ; rate de -10 (lent) à +10 (rapide) ; utilisez list_speech_voices pour voir les voix disponibles',
    list_speech_voices:   'list_speech_voices   — args: {}  — liste les voix TTS installées sur ce Windows (Windows SAPI) ; utile avant generate_speech pour choisir une voix',
    delete_file:          'delete_file          — args: { "path": "..." }  — supprime un fichier (backup automatique avant suppression)',
    move_file:            'move_file            — args: { "path": "...", "dest": "..." }  — déplace ou renomme un fichier dans le projet (backup automatique)',
    enable_collaboration: 'enable_collaboration — args: { "reason": "..." }  — active le bus de communication inter-agents (si la tâche le nécessite)',
    post_message:         'post_message         — args: { "to": "all|<role>", "content": "..." }  — envoie un message aux autres agents',
    read_messages:        'read_messages        — args: { "from"?: "<role>" }  — lit les messages reçus sur le bus partagé',
    finish:               'finish               — args: { "summary": "...", "checks"?: [{ "kind": "file", "path": "src/…" } | { "kind": "test", "command": "npm test", "result": "pass", "count"?: N }] }  — termine la tâche ; summary compact (max 1000 car., sections numérotées + puces d\'une ligne) ; "checks" = preuves de vérification : chaque fichier modifié relu, ou test lancé',
    add_rule:             'add_rule             — args: { "name": "label court ≤ 40 car.", "text": "instruction complète" }  — DIRECTIVE CONFIGURATION : ajoute une règle persistante (déclencheurs : « retiens que », « à partir de maintenant », « toujours », « souviens-toi », « dorénavant »…). Appeler SANS plan préalable, puis finish.',
    delete_rule:          'delete_rule          — args: { "text": "..." }  — DIRECTIVE CONFIGURATION : supprime une règle par son texte exact (déclencheurs : « supprime la règle », « oublie », « ne plus »…). Appeler SANS plan préalable, puis finish.',
    install_skill:        'install_skill        — args: { "name": "...", "description"?: "...", "system_prompt"?: "..." }  — DIRECTIVE CONFIGURATION : installe un module de comportement nommé (déclencheurs : « installe le skill », « crée un expert », « ajoute un module »…). system_prompt = instructions injectées dans chaque session. Appeler SANS plan préalable, puis finish.',
    remove_skill:         'remove_skill         — args: { "name": "..." }  — DIRECTIVE CONFIGURATION : désinstalle un skill par son nom exact (déclencheurs : « désinstalle le skill », « retire le module »…). Appeler SANS plan préalable, puis finish.',
    call_api: (() => {
      const keys = Object.keys(config.apiTokens || {});
      const tokensInfo = keys.length
        ? `Tokens disponibles : ${keys.map(k => `"${k}"`).join(', ')}.`
        : 'Aucun token configuré (ajouter dans Paramètres > Connecteurs > Tokens API).';
      return `call_api — args: { "url": "https://...", "method"?: "GET|POST|PUT|PATCH|DELETE", "body"?: {...}, "token_key"?: "<nom>", "headers"?: {} } — Appelle une API REST externe et retourne la réponse JSON. token_key référence un token stocké dans la config (jamais le token brut dans les args). ${tokensInfo}`;
    })(),
    browser_open:       'browser_open       — args: { "url"?: "https://...", "headless"?: false }  — lance Chrome/Edge et ouvre une page. headless: false = fenêtre visible (défaut). Appelle browser_close à la fin.',
    browser_navigate:   'browser_navigate   — args: { "url": "https://...", "timeout"?: 30000 }  — navigue vers une URL dans la page ouverte',
    browser_screenshot: 'browser_screenshot — args: { "path"?: "screenshot.png", "selector"?: "#app", "full_page"?: false }  — capture la page ou un élément, enregistre dans le projet',
    browser_click:      'browser_click      — args: { "selector"?: "button#submit", "x"?: 100, "y"?: 200, "timeout"?: 5000 }  — clique sur un élément CSS ou des coordonnées pixel',
    browser_type:       'browser_type       — args: { "selector": "input#email", "text": "...", "clear"?: true }  — saisit du texte dans un champ (efface d\'abord si clear: true)',
    browser_evaluate:   'browser_evaluate   — args: { "script": "return document.title" }  — exécute du JavaScript dans la page et retourne le résultat (requiert enableShell)',
    browser_get_text:    'browser_get_text    — args: { "selector"?: ".main-content", "max_chars"?: 8000 }  — extrait le texte visible de la page ou d\'un élément',
    browser_get_content: 'browser_get_content — args: { "max_chars"?: 4000, "max_links"?: 20, "max_elements"?: 15 }  — vue structurée de la page : texte + liens (href+selector) + boutons (selector) + champs (selector). À utiliser après chaque navigation pour décider de la prochaine action.',
    browser_get_dom:     'browser_get_dom     — args: { "selector"?: "table.data", "max_chars"?: 10000 }  — retourne le HTML brut d\'un élément (tableaux, listes, structures imbriquées)',
    browser_select:      'browser_select      — args: { "selector": "select#pays", "value": "FR" }  — sélectionne une option dans un <select> par sa value',
    browser_check:       'browser_check       — args: { "selector": "input#cgu", "checked"?: true }  — coche ou décoche une checkbox / radio',
    browser_key:         'browser_key         — args: { "key": "Enter", "selector"?: "#input", "count"?: 1 }  — appuie sur une touche clavier (Tab, Enter, Escape, ArrowDown…)',
    browser_new_tab:     'browser_new_tab     — args: { "url"?: "https://..." }  — ouvre un nouvel onglet et le rend actif',
    browser_list_tabs:   'browser_list_tabs   — args: {}  — liste tous les onglets ouverts (index, url, title, active)',
    browser_switch_tab:  'browser_switch_tab  — args: { "index": 0 }  — change d\'onglet actif par son index (voir browser_list_tabs)',
    browser_scroll:      'browser_scroll      — args: { "direction"?: "down|up|top|bottom", "pixels"?: 500, "selector"?: "#el" }  — fait défiler la page ou amène un élément en vue',
    browser_wait:        'browser_wait        — args: { "selector"?: ".loaded", "ms"?: 1000, "timeout"?: 10000 }  — attend qu\'un sélecteur apparaisse ou un délai en ms',
    browser_close:      'browser_close      — args: {}  — ferme Chrome et libère les ressources',
    generate_palette:   'generate_palette   — args: { "base_color": "#3B82F6" }  — génère une palette de 9 tons (100→900) à partir d\'une couleur hexadécimale avec ratios de contraste WCAG 2.1 (AA/AAA) et couleur de texte recommandée pour chaque ton',
    read_design_tokens: 'read_design_tokens — args: { "path"?: "src/styles.css" }  — extrait les CSS custom properties (--variable: valeur) d\'un fichier CSS ou de tous les .css du projet ; si path absent, scanne l\'ensemble du projet',
  };

  let toolNames;
  if (config._allowedTools) {
    // Sous-agent : liste restreinte définie par son profil
    toolNames = config._allowedTools;
  } else if (config.planMode) {
    // Mode Plan : lecture et analyse uniquement — aucune écriture autorisée
    toolNames = ['ask_user', 'note_user', 'plan', 'read_file', 'list_dir', 'search_grep'];
    if (config.enableGit !== false) toolNames.push('git_status', 'git_diff');
    toolNames.push('finish');
  } else {
    // Agent principal : tous les outils activés
    toolNames = ['ask_user', 'note_user', 'plan', 'get_project_info', 'read_file', 'write_file', 'replace_code', 'batch_replace', 'restore_file', 'diff_file', 'delete_file', 'move_file', 'list_dir', 'find_symbol', 'find_dependents', 'find_dependencies', 'find_relevant_files', 'search_grep', 'run_tests', 'format_file', 'scratchpad', 'project_note', 'read_url', 'http_request', 'check_service'];
    if (config.enableWebSearch !== false) toolNames.push('web_search');
    if (config.enableLsp) toolNames.push('lsp_hover', 'lsp_definition', 'lsp_references');
    if (config.enableFixLoop) toolNames.push('fix_loop');
    if (config.enableGit !== false) toolNames.push('git_status', 'git_diff');
    if (config.enableGitWrite) toolNames.push('git_create_branch', 'git_commit');
    if (config.enableShell)  toolNames.push('run_shell', 'start_process', 'stop_process', 'get_output', 'list_processes');
    if (config.enableDeploy) toolNames.push('deploy');
    toolNames.push('add_rule', 'delete_rule', 'install_skill', 'remove_skill');
    toolNames.push('call_api');
    toolNames.push('browser_open', 'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_get_text', 'browser_get_content', 'browser_get_dom', 'browser_select', 'browser_check', 'browser_key', 'browser_new_tab', 'browser_list_tabs', 'browser_switch_tab', 'browser_scroll', 'browser_wait', 'browser_close');
    if (config.enableShell) toolNames.push('browser_evaluate');
    toolNames.push('spawn_agent', 'spawn_parallel');
    toolNames.push('enable_collaboration');
    if (config._sharedBus) toolNames.push('post_message', 'read_messages');
    if ((config.customProviders || []).some(p => p.apiKey && p.baseUrl)) {
      toolNames.push('generate_video');
      toolNames.push('generate_image');
    }
    toolNames.push('merge_videos', 'generate_speech', 'list_speech_voices');
    toolNames.push('generate_palette', 'read_design_tokens');
    toolNames.push('finish');
  }
  // Mode planifié : pas d'interaction utilisateur, notification système disponible
  if (config.scheduled) {
    toolNames = toolNames.filter(n => n !== 'ask_user' && n !== 'note_user');
    toolNames.splice(toolNames.indexOf('finish'), 0, 'notify_user');
  }

  const persona = resolvePersona(config.activePersona);

  // Sélection dynamique du catalogue (ADR-018) : le prompt ne porte que les outils
  // utiles à la tâche. Les sous-agents (liste déjà curatée par profil) et les tâches
  // planifiées (aucun utilisateur pour corriger un mauvais choix) gardent tout.
  const activeToolNames = (config._subAgent || config.scheduled || config.dynamicTools === false)
    ? toolNames
    : selectToolsForTask(toolNames, task, { ...config, forceFamilies: persona.forceFamilies });

  const availableTools = activeToolNames.map(n => allToolDefs[n]).filter(Boolean);

  // Initialiser le registre MCP — connecteurs activés dans config
  const mcpRegistry = new McpRegistry();
  const _mcpLog = msg => onEvent({ type: 'mcp_status', msg });
  await mcpRegistry.init(config.connectors ?? [], _mcpLog);
  // Ajouter les outils MCP découverts à availableTools (visibles dans le prompt système)
  for (const desc of mcpRegistry.toolDescriptions) {
    availableTools.push(desc);
  }

  // Périmètre strict d'exécution : sous-agents (liste du profil) et mode plan.
  // Sans ce garde-fou, la liste ne servait qu'à rédiger le prompt — un modèle
  // pouvait appeler write_file alors que son rôle est en lecture seule.
  // L'agent principal garde la sélection dynamique souple (ADR-018).
  const strictTools = (config._subAgent || config.planMode)
    ? new Set(activeToolNames)
    : null;
  if (strictTools) {
    for (const desc of mcpRegistry.toolDescriptions) {
      const mcpName = desc?.name || desc?.function?.name;
      if (mcpName) strictTools.add(mcpName);
    }
  }

  // Détecter le langage dominant du projet — calibre les règles et les exemples few-shot
  const lang     = detectLanguage(projectRoot);
  const langRules = getLangRules(lang);
  onEvent({ type: 'lang_detected', lang });

  // Lire AGENTS.md (guide du projet) — injecté une seule fois dans le prompt
  const agentsContent = _readAgentsFile(projectRoot);
  const agentsExists  = agentsContent.length > 0;
  if (agentsExists)  onEvent({ type: 'agents_loaded', chars: agentsContent.length });
  if (!agentsExists) onEvent({ type: 'agents_missing' });

  // Feedback learning — charger l'historique et construire le résumé
  let feedbackSummary = '';
  if (config.enableFeedbackLearning && !isSubAgent) {
    try {
      const entries = loadFeedback(projectRoot, 50);
      feedbackSummary = buildFeedbackSummary(entries);
      if (feedbackSummary) onEvent({ type: 'feedback_loaded', entries: entries.length });
    } catch { /* non bloquant */ }
  }

  // Construire le contexte RAG (indexation incrémentale + retrieval)
  let projectContext = '';
  try {
    const storeId  = crypto.createHash('sha1')
      .update(`${projectRoot}|v${EMBEDDER_VERSION}|c${CHUNKER_VERSION}`)
      .digest('hex').slice(0, 12);
    const ragStore = createStore(storeId);
    indexProject(projectRoot, ragStore);
    ragStore.flush(); // persistance unique après indexation complète
    projectContext = await buildContext({ task, projectRoot, ragStore, maxChars: config.contextBudget ?? config.maxContextChars ?? MAX_CONTEXT_CHARS });
    onEvent({ type: 'context_ready', chars: projectContext.length });
  } catch {
    // RAG non bloquant — l'agent continue sans contexte enrichi
  }

  // Profil de prompt selon le moteur (ADR-024) : un 3B reçoit un prompt allégé,
  // un modèle cloud garde le prompt complet.
  const promptProfile = resolvePromptProfile({
    engine:   config.model?.primary,
    model:    config.model?.engines?.[config.model?.primary]?.model,
    explicit: config.promptProfile,
  });

  const messages = [
    { role: 'system', content: buildSystemPrompt(availableTools, projectContext, {
        systemExtra:  [config._systemExtra, persona.systemAddition].filter(Boolean).join('\n\n'),
        skipPlanRule: !!config._subAgent,
        busActive:    !!config._sharedBus,
        planMode:     !!config.planMode,
        tddMode:      !!config.tddMode,
        agentsContent,
        agentsExists,
        customRules:    config.customRules  ?? [],
        customSkills:   config.customSkills ?? [],
        lang,
        langRules,
        enableShell:    !!config.enableShell,
        feedbackSummary,
        profile:        promptProfile,
    }) },
    { role: 'user',   content: _buildTaskContent(task, config._images) },
  ];

  const trace = [];
  // État TDD — phase courante (null si mode TDD inactif)
  const tddMode = !!config.tddMode;
  let tddPhase = tddMode ? TDD_PHASES.RED : null;
  if (tddMode) onEvent({ type: 'tdd_phase', phase: TDD_PHASES.RED });
  // Cache intra-session : évite de réinjecter le contenu d'un fichier déjà lu.
  // La clé inclut la plage de lignes : sans elle, une relecture paginée du même fichier
  // renverrait « déjà lu » et la fin d'un fichier tronqué resterait inaccessible.
  const _readCache = new Map();
  const _readCacheKey = (args) => `${args.path}|${args.start_line ?? ''}|${args.end_line ?? ''}`;
  const _invalidateReadCache = (filePath) => {
    const prefix = `${filePath}|`;
    for (const key of _readCache.keys()) {
      if (key.startsWith(prefix)) _readCache.delete(key);
    }
  };

  // ── État de la tâche (reconstruit depuis la trace, sans appel LLM) ─────────
  // Sert deux fois : rappel compact dans le compteur d'étapes, et bloc complet quand la
  // fenêtre glissante oublie les messages anciens (sinon le modèle relit tout).
  const _reads     = new Map();  // path → dernière étape de lecture
  const _mods      = new Map();  // path → étape de modification
  const _verified  = new Map();  // path → étape de relecture après modification
  let _lastFailure = null;       // { tool, error, step }
  let _planObjective = '';

  const _shortList = (map, max = 3) => {
    const entries = [...map.entries()].sort((a, b) => a[1] - b[1]);
    const shown = entries.slice(-max).map(([filePath]) =>
      (map === _mods && !_verified.has(filePath) ? `${filePath}(non relu)` : filePath));
    return shown.join(', ') + (entries.length > max ? ` (+${entries.length - max})` : '');
  };

  const _stateSuffix = () => {
    const parts = [];
    if (_mods.size) parts.push(`modifiés: ${_shortList(_mods)}`);
    if (_reads.size) parts.push(`lus: ${_reads.size}`);
    if (_lastFailure) parts.push(`dernier échec: ${_lastFailure.tool} (${String(_lastFailure.error).split(':')[0].slice(0, 28)})`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  };

  const _compactState = () => {
    const lines = ['ÉTAT DE LA TÂCHE (reconstruit automatiquement — ne relis pas ce qui est déjà listé)'];
    if (_planObjective) lines.push(`Objectif      : ${_planObjective}`);
    if (_reads.size) lines.push(`Fichiers lus  : ${_shortList(_reads, 6)}`);
    if (_mods.size) lines.push(`Modifiés      : ${_shortList(_mods, 6)}`);
    if (_lastFailure) lines.push(`Dernier échec : ${_lastFailure.tool} → ${String(_lastFailure.error).slice(0, 80)} (étape ${_lastFailure.step})`);
    return lines.join('\n');
  };

  // ── Terminaison prouvée ────────────────────────────────────────────────────
  // `finish` est déclaratif : rien n'oblige le modèle à dire ce qu'il a vérifié.
  // Quand des fichiers ont été modifiés, on exige un `checks` qui les couvre ou un
  // test passé — avec une seule relance, pour ne pas changer un oubli en boucle.
  let _finishNudgeSent = false;

  const _modifiedPaths = () => {
    const modTools = new Set([TOOLS.WRITE_FILE, TOOLS.REPLACE_CODE, TOOLS.DELETE_FILE, TOOLS.MOVE_FILE]);
    const paths = new Set();
    for (const entry of trace) {
      if (!modTools.has(entry.tool) || !entry.result?.ok) continue;
      if (entry.args?.path) paths.add(String(entry.args.path));
      if (entry.tool === TOOLS.MOVE_FILE && entry.args?.dest) paths.add(String(entry.args.dest));
    }
    return [...paths];
  };

  const _checkFinishProof = (args) => {
    const modified = _modifiedPaths();
    if (modified.length === 0) return { ok: true };

    const checks = Array.isArray(args?.checks) ? args.checks.filter(c => c && typeof c === 'object') : [];
    if (checks.length === 0) {
      return {
        ok: false,
        reason: `aucune vérification déclarée alors que ${modified.length} fichier(s) ont été modifiés (${modified.slice(0, 3).join(', ')})`,
      };
    }

    const SHAPES = ['file', 'test', 'command'];
    const malformed = checks.find(c =>
      !SHAPES.includes(c.kind) ||
      (c.kind === 'file' && !c.path) ||
      ((c.kind === 'test' || c.kind === 'command') && !c.command));
    if (malformed) {
      return { ok: false, reason: 'une vérification est incomplète (kind + path ou command attendus)' };
    }

    const coversFile = checks.some(c => c.kind === 'file' && modified.includes(String(c.path)));
    const passedTest = checks.some(c => c.kind === 'test' && String(c.result || '').toLowerCase() === 'pass');
    if (!coversFile && !passedTest) {
      return {
        ok: false,
        reason: `les vérifications ne couvrent pas les fichiers modifiés (${modified.slice(0, 3).join(', ')}) : cite-les avec "kind": "file", ou déclare un test passé`,
      };
    }
    return { ok: true };
  };
  // Compteur de tokens cumulés sur la session
  let _sessionIn  = 0;
  let _sessionOut = 0;

  onEvent({ type: 'session_start', sessionId: session.id });

  /**
   * Une génération LLM + les événements d'UI associés (thinking, contexte, tokens).
   * Les réglages du panneau Paramètres sont réellement transmis :
   *  - temperature / topP (avant, topP n'était jamais envoyé au moteur) ;
   *  - streaming:false → aucun onToken, le moteur utilise la réponse complète.
   * @param {number} currentStep
   * @returns {Promise<string>} texte brut renvoyé par le modèle
   */
  async function _generateOnce(currentStep) {
    const onToken = config.streaming === false
      ? undefined
      : (token) => onEvent({ type: 'llm_token', token });
    const onUsage = (usage) => {
      _sessionIn  += usage.inputTokens  || 0;
      _sessionOut += usage.outputTokens || 0;
      onEvent({ type: 'llm_usage', step: currentStep,
        inputTokens: usage.inputTokens  || 0,
        outputTokens: usage.outputTokens || 0,
        engine: usage.engine || 'unknown',
        totalIn: _sessionIn, totalOut: _sessionOut,
      });
    };
    const windowed = _windowMessages(messages, _compactState(), windowOpts);
    // L'agent « réfléchit » : l'UI affiche une animation dédiée pendant la génération
    onEvent({ type: 'thinking', step: currentStep });
    // Consommation de la mémoire contextuelle (estimation fiable même sans usage API)
    const ctxChars = windowed.reduce((n, m) => {
      const c = m?.content;
      return n + (typeof c === 'string' ? c.length : JSON.stringify(c ?? '').length);
    }, 0);
    onEvent({
      type: 'context_usage', step: currentStep,
      messages: windowed.length,
      chars: ctxChars,
      estimatedTokens: Math.ceil(ctxChars / 4),
    });
    return llmGenerate(windowed, {
      temperature: config.temperature ?? DEFAULT_TEMPERATURE,
      topP:        config.topP ?? 1,
      onToken,
      onUsage,
      signal,
    });
  }

  for (let step = 1; step <= maxSteps; step++) {
    // ── Abort ────────────────────────────────────────────────────────────────
    if (signal?.aborted) {
      mcpRegistry.dispose();
      disposeBrowser().catch(() => {});
      disposeLsp().catch(() => {});
      const cancelled = { ok: false, error: 'ANNULÉ', trace, sessionId: session.id };
      if (!isSubAgent) updateSession(sessionPath, { steps: trace, result: cancelled, scratchpad: scratchpad.toJSON() });
      onEvent({ type: 'cancelled' });
      return cancelled;
    }

    // ── Génération (avec reprises sur JSON invalide) ────────────────────────
    // `retryOnParseError` (panneau Paramètres) : nombre de reprises avant de
    // consommer une étape. Auparavant le réglage n'était pas utilisé du tout.
    const maxParseRetries = Math.max(0, Number(config.retryOnParseError ?? MAX_RETRIES_PER_STEP));
    let rawText = '';
    let parsed;
    for (let attempt = 0; ; attempt++) {
      try {
        rawText = await _generateOnce(step);
      } catch (err) {
        // AbortError ou message 'ANNULÉ' = l'utilisateur a cliqué Stop
        if (signal?.aborted || err.name === 'AbortError' || err.message === 'ANNULÉ') {
          mcpRegistry.dispose();
          disposeBrowser().catch(() => {});
          disposeLsp().catch(() => {});
          const cancelled = { ok: false, error: 'ANNULÉ', trace, sessionId: session.id };
          if (!isSubAgent) updateSession(sessionPath, { steps: trace, result: cancelled, scratchpad: scratchpad.toJSON() });
          onEvent({ type: 'cancelled' });
          return cancelled;
        }
        return { ok: false, error: `LLM_ERREUR: ${err.message}`, trace };
      }
      parsed = extractToolCall(rawText);
      if (!parsed.error) break;
      if (attempt >= maxParseRetries) break;   // plus de reprise : traité ci-dessous
      // Renvoyer la sortie fautive + la consigne de format, puis régénérer.
      messages.push({ role: 'assistant', content: rawText });
      messages.push({
        role: 'user',
        content: `Format invalide (${parsed.error}). Réponds uniquement avec un JSON valide :\n{"tool": "<nom>", "args": { ... }}`,
      });
      trace.push({ step, error: parsed.error, attempt: attempt + 1 });
      onEvent({ type: 'parse_error', step, error: parsed.error, attempt: attempt + 1 });
    }

    // ── Parse ────────────────────────────────────────────────────────────────
    if (parsed.error) {
      // Guider le LLM avec un message d'erreur explicite
      messages.push({ role: 'assistant', content: rawText });
      messages.push({
        role: 'user',
        content: `Format invalide (${parsed.error}). Réponds uniquement avec un JSON valide :\n{"tool": "<nom>", "args": { ... }}`,
      });
      trace.push({ step, error: parsed.error });
      onEvent({ type: 'parse_error', step, error: parsed.error });

      if (step >= maxSteps) break;
      continue;
    }

    // ── Trace & event ────────────────────────────────────────────────────────
    const entry = { step, tool: parsed.tool, args: parsed.args, ...(parsed.intent ? { intent: parsed.intent } : {}) };
    trace.push(entry);
    onEvent({ type: 'tool_call', ...entry });

    messages.push({ role: 'assistant', content: rawText });

    // ── Finish ───────────────────────────────────────────────────────────────
    if (parsed.tool === TOOLS.FINISH) {
      const summary = parsed.args.summary || 'Tâche terminée.';
      const proof = _checkFinishProof(parsed.args);
      if (!proof.ok && !_finishNudgeSent) {
        _finishNudgeSent = true;
        onEvent({ type: 'finish_rejected', reason: proof.reason });
        messages.push({
          role: 'user',
          content: `TERMINAISON SANS PREUVE : ${proof.reason}.\nRappelle finish en listant les vérifications réelles, par exemple :\n{"tool":"finish","args":{"summary":"…","checks":[{"kind":"file","path":"src/fichier.js"},{"kind":"test","command":"npm test","result":"pass","count":12}]}}`,
        });
        continue;
      }
      onEvent({ type: 'finish', summary });
      mcpRegistry.dispose();
      disposeBrowser().catch(() => {});
      disposeLsp().catch(() => {});
      const result = { ok: true, summary, trace, sessionId: session.id };
      if (!isSubAgent) updateSession(sessionPath, { steps: trace, result, scratchpad: scratchpad.toJSON() });
      return result;
    }

    // ── Exécution ────────────────────────────────────────────────────────────
    let result;

    // Refus des outils hors périmètre (sous-agent ou mode plan). Le modèle est
    // informé de la liste autorisée pour qu'il se corrige à l'étape suivante.
    if (strictTools && !strictTools.has(parsed.tool)) {
      result = {
        ok: false,
        error: `OUTIL_HORS_PERIMETRE: "${parsed.tool}" n'est pas autorisé pour ce rôle. ` +
               `Outils disponibles : ${[...strictTools].join(', ')}`,
      };
      entry.result = result;
      _lastFailure = { tool: parsed.tool, error: 'OUTIL_HORS_PERIMETRE', step };
      onEvent({ type: 'tool_blocked', step, tool: parsed.tool });
      messages.push({
        role: 'user',
        content: `OUTIL HORS PÉRIMÈTRE : ${result.error}`,
      });
      if (step >= maxSteps) break;
      continue;
    }

    try {
      // Cache read_file : réutilise le résultat seulement si le message portant ce
      // résultat est encore dans la fenêtre glissante. Sinon on relit le fichier.
      if (parsed.tool === TOOLS.READ_FILE && parsed.args?.path) {
        const cacheKey  = _readCacheKey(parsed.args);
        const cachedAt  = _readCache.get(cacheKey);
        const tailStart = _windowTailStart(messages.length, windowOpts); // étape à partir de laquelle la tail commence
        const inWindow  = cachedAt != null && cachedAt > tailStart;
        if (inWindow) {
          result = { ok: true, content: `[déjà lu à l'étape ${cachedAt} — contenu identique]` };
        } else {
          if (cachedAt != null) _readCache.delete(cacheKey); // expiré de la fenêtre
          result = await dispatch(parsed.tool, parsed.args, guard, config, onEvent, projectRoot, mcpRegistry);
          if (result.ok) _readCache.set(cacheKey, step);
        }
        // État de tâche : une lecture compte, et vaut vérification si le fichier a été modifié
        _reads.set(String(parsed.args.path), step);
        if (_mods.has(String(parsed.args.path))) _verified.set(String(parsed.args.path), step);
      } else {
        result = await dispatch(parsed.tool, parsed.args, guard, config, onEvent, projectRoot, mcpRegistry);
        // Invalider le cache si le fichier vient d'être modifié
        if (result.ok && parsed.args?.path &&
            (parsed.tool === TOOLS.WRITE_FILE || parsed.tool === TOOLS.REPLACE_CODE ||
             parsed.tool === TOOLS.DELETE_FILE || parsed.tool === TOOLS.MOVE_FILE)) {
          _invalidateReadCache(parsed.args.path);
          // move_file écrase la destination — invalider aussi son entrée en cache
          if (parsed.tool === TOOLS.MOVE_FILE && parsed.args.dest) {
            _invalidateReadCache(parsed.args.dest);
          }
        }
        // batch_replace peut toucher n'importe quel fichier — vider tout le cache
        if (result.ok && parsed.tool === TOOLS.BATCH_REPLACE) {
          _readCache.clear();
          _mods.set('(batch_replace)', step);
        }
      }
    } catch (err) {
      result = { ok: false, error: err.message };
    }

    // ── Mise à jour de l'état de tâche ───────────────────────────────────────
    if (result.ok) {
      if ((parsed.tool === TOOLS.WRITE_FILE || parsed.tool === TOOLS.REPLACE_CODE ||
           parsed.tool === TOOLS.DELETE_FILE || parsed.tool === TOOLS.MOVE_FILE) && parsed.args?.path) {
        _mods.set(String(parsed.args.path), step);
        _verified.delete(String(parsed.args.path)); // doit être relu après modification
      }
      if (parsed.tool === TOOLS.PLAN && parsed.args?.objective) {
        _planObjective = String(parsed.args.objective).slice(0, 120);
      }
    } else if (!parsed.error) {
      _lastFailure = { tool: parsed.tool, error: String(result.error || 'ERREUR'), step };
    }

    // Le modèle a inventé un nom d'outil : lui donner la carte des familles plutôt
    // qu'un simple refus, sinon un petit modèle répète le même nom.
    if (!result.ok && String(result.error || '').startsWith('OUTIL_INCONNU')) {
      result = {
        ok: false,
        error: `${result.error} — familles disponibles : ${describeFamilies(activeToolNames)}`,
      };
    }

    // Tronquer les résultats longs avant injection dans les messages.
    // Si le résultat a un champ `content` (read_file), on le tronque dedans.
    // Pour les outils sans `content` (search_grep, list_dir, git_diff…),
    // on tronque le JSON sérialisé global pour éviter de saturer la fenêtre LLM.
    let resultForContext;
    if (result.ok) {
      if (result.content != null) {
        resultForContext = { ...result, content: _truncateResult(result.content) };
      } else {
        const serialized = JSON.stringify(result);
        if (serialized.length > MAX_RESULT_CHARS) {
          const kept    = serialized.slice(0, MAX_RESULT_CHARS);
          const omitted = serialized.length - MAX_RESULT_CHARS;
          resultForContext = `${kept}\n[… tronqué — ${omitted} caractères omis]`;
        } else {
          resultForContext = result;
        }
      }
    } else {
      resultForContext = result;
    }

    entry.result = result;
    onEvent({ type: 'tool_result', step, result });

    // Retourner le résultat + rappel d'étape pour que le LLM sache quand s'arrêter
    const remaining = maxSteps - step;
    let resultMsg = result.ok
      ? `Résultat : ${typeof resultForContext === 'string' ? resultForContext : JSON.stringify(resultForContext)}`
      : `Erreur outil : ${result.error}`;

    // Vérification obligatoire après écriture : force le LLM à relire avant de continuer.
    // Les erreurs de code les plus fréquentes viennent d'une écriture non vérifiée.
    if (result.ok && parsed.args?.path &&
        (parsed.tool === TOOLS.WRITE_FILE || parsed.tool === TOOLS.REPLACE_CODE)) {
      resultMsg += `\n\nVÉRIFICATION OBLIGATOIRE : appelle read_file { "path": "${parsed.args.path}" } avant toute autre action.`;

      // Nudge tests : si le fichier modifié est un fichier de code ET que le projet a
      // réellement une suite de tests (sinon on réclame un outil qui échouera).
      const CODE_EXTS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.cs', '.cpp', '.c', '.php'];
      const ext = path.extname(parsed.args.path).toLowerCase();
      if (CODE_EXTS.includes(ext) && activeToolNames.includes('run_tests') && _projectHasTests(projectRoot)) {
        resultMsg += `\n\n🧪 TESTS : après avoir relu le fichier, appelle run_tests pour vérifier que les modifications ne cassent pas la suite.`;
      }

      // Avertissement secrets : le LLM a peut-être écrit un secret dans le fichier
      if (result.secretWarnings?.length) {
        const warns = result.secretWarnings.map(w => `ligne ${w.line} (${w.label})`).join(', ');
        resultMsg += `\n\n⚠️ SECRET POTENTIEL DÉTECTÉ dans le fichier écrit : ${warns}. Vérifie que ce n'est pas une vraie clé API ou un mot de passe.`;
      }
    }

    // Nudge TDD : avancer la phase selon le résultat de run_tests
    if (tddMode && parsed.tool === TOOLS.RUN_TESTS) {
      if (tddPhase === TDD_PHASES.RED) {
        if (result.ok && result.exitCode === 0) {
          resultMsg += `\n\n🔴 TDD RED : tous les tests passent déjà — tes assertions sont trop faibles. Renforce-les ou ajoute des cas qui échouent.`;
        } else {
          resultMsg += `\n\n✅ Phase RED validée — les tests échouent comme prévu. Passe à GREEN : écris le code minimal pour les faire passer (ne modifie pas le test).`;
          tddPhase = TDD_PHASES.GREEN;
          onEvent({ type: 'tdd_phase', phase: TDD_PHASES.GREEN });
        }
      } else if (tddPhase === TDD_PHASES.GREEN) {
        if (result.ok && result.exitCode === 0) {
          resultMsg += `\n\n🟢 Phase GREEN validée — tous les tests passent. Tu peux appeler finish ou passer à REFACTOR pour améliorer le code sans changer le comportement.`;
          tddPhase = TDD_PHASES.REFACTOR;
          onEvent({ type: 'tdd_phase', phase: TDD_PHASES.REFACTOR });
        } else {
          resultMsg += `\n\n🔴 Tests encore rouges. Modifie UNIQUEMENT le fichier SOURCE — ne touche pas au fichier de test.`;
        }
      } else if (tddPhase === TDD_PHASES.REFACTOR) {
        if (result.ok && result.exitCode === 0) {
          resultMsg += `\n\n✅ Tests verts après refactoring. Continue à améliorer ou appelle finish.`;
        } else {
          resultMsg += `\n\n⚠️ TDD REFACTOR : un test vient de casser. Appelle restore_file immédiatement — ne modifie pas le test pour le faire passer.`;
        }
      }
    }

    // Guidage explicite sur BLOC_INTROUVABLE : le modèle doit relire avant de retenter.
    if (!result.ok && typeof result.error === 'string' &&
        result.error.includes('BLOC_INTROUVABLE') && parsed.args?.path) {
      resultMsg += `\n\n→ Relis le fichier entier avec read_file { "path": "${parsed.args.path}" }, puis copie le bloc exact avant de retenter replace_code.`;
    }

    if (remaining <= 3) {
      resultMsg += `\n\nURGENT : il te reste ${remaining} étape(s). Tu DOIS appeler finish maintenant avec ce que tu sais.`;
      resultMsg += _stateSuffix();
    } else if (remaining <= 5) {
      resultMsg += `\n\n[Étape ${step}/${maxSteps} — ⚠️ ${remaining} étapes restantes — prévois le finish]${_stateSuffix()}`;
    } else {
      resultMsg += `\n\n[Étape ${step}/${maxSteps} — ${remaining} restantes]${_stateSuffix()}`;
    }

    messages.push({ role: 'user', content: resultMsg });
  }

  mcpRegistry.dispose();
  disposeBrowser().catch(() => {});
  disposeLsp().catch(() => {});
  const failResult = { ok: false, error: 'MAX_STEPS_ATTEINT', trace, sessionId: session.id };
  if (!isSubAgent) updateSession(sessionPath, { steps: trace, result: failResult, scratchpad: scratchpad.toJSON() });
  return failResult;
}

module.exports = { runAgent };
