'use strict';

/**
 * Familles d'outils et sélection dynamique du catalogue (ADR-018).
 *
 * Pourquoi : le prompt système portait les 72 descriptions d'outils à chaque étape,
 * soit ~12 200 caractères — 32 % du prompt — alors qu'une tâche donnée en mobilise
 * trois à six. Sur un petit modèle, chaque option supplémentaire est une occasion
 * d'erreur de sélection.
 *
 * Principe : un noyau toujours présent (les gestes quotidiens), des familles toujours
 * présentes quand elles sont bon marché (édition, recherche, LSP), et des familles
 * lourdes chargées uniquement si la tâche les évoque (navigateur, média, exécution…).
 *
 * Ce module ne décide pas de ce qui est *permis* : un outil non listé reste appelable
 * (le dispatch ne change pas). Il ne décide que de ce qui est *visible*.
 */

// Toujours exposés (le geste de base d'une tâche de code)
const CORE = [
  'plan', 'read_file', 'write_file', 'replace_code', 'list_dir', 'search_grep',
  'run_tests', 'get_project_info', 'scratchpad', 'project_note', 'ask_user', 'note_user', 'finish',
  'notify_user',
];

const FAMILIES = {
  // Édition courante : peu coûteuse, utile dès qu'on touche un fichier
  edition: ['delete_file', 'move_file', 'batch_replace', 'restore_file', 'diff_file', 'format_file'],
  // Recherche et lecture d'état : utile à presque toutes les tâches
  recherche: ['find_symbol', 'find_dependents', 'find_dependencies', 'find_relevant_files', 'git_status', 'git_diff'],
  // Types et navigation de code (chargés seulement si enableLsp)
  lsp: ['lsp_hover', 'lsp_definition', 'lsp_references'],

  // Familles lourdes, chargées sur déclencheur
  execution: ['run_shell', 'start_process', 'stop_process', 'get_output', 'list_processes', 'fix_loop', 'deploy', 'check_service', 'http_request'],
  web: ['read_url', 'web_search', 'call_api'],
  navigateur: [
    'browser_open', 'browser_navigate', 'browser_screenshot', 'browser_click', 'browser_type',
    'browser_evaluate', 'browser_get_text', 'browser_get_content', 'browser_get_dom',
    'browser_select', 'browser_check', 'browser_key', 'browser_new_tab', 'browser_list_tabs',
    'browser_switch_tab', 'browser_scroll', 'browser_wait', 'browser_close',
  ],
  git: ['git_create_branch', 'git_commit'],
  media: ['generate_image', 'generate_video', 'merge_videos', 'generate_speech', 'list_speech_voices'],
  agents: ['spawn_agent', 'spawn_parallel', 'enable_collaboration', 'post_message', 'read_messages'],
  configuration: ['add_rule', 'delete_rule', 'install_skill', 'remove_skill'],
  design: ['generate_palette', 'read_design_tokens'],
};

// Familles présentes dès qu'elles sont disponibles dans la configuration
const ALWAYS = ['edition', 'recherche', 'lsp'];

// Déclencheurs par famille lourde — français et anglais, volontairement larges :
// rater une famille coûte un aller-retour, la charger à tort coûte des caractères.
const TRIGGERS = {
  execution: /\b(test|tests|npm|npx|yarn|pnpm|build|compile|compiler|lancer|lance|ex[ée]cute|ex[ée]cuter|commande|shell|terminal|serveur|processus|d[ée]marre|d[ée]marrer|d[ée]ploie|d[ée]ployer|deploy|port|curl)\b/i,
  web: /\b(url|uri|http|https|api|endpoint|requ[êe]te|documentation|doc|internet|web|scrap)\b/i,
  navigateur: /\b(navigateur|browser|site|page|clic|clique|cliquer|formulaire|screenshot|capture|[ée]cran|onglet|connexion|login|s'inscrire|remplir)\b/i,
  git: /\b(git|commit|branche|branch|merge|push|pull|repo|d[ée]p[ôo]t)\b/i,
  media: /\b(vid[ée]o|video|image|images|audio|voix|speech|narration|mp4|png|jpe?g|g[ée]n[èe]re|g[ée]n[ée]rer)\b/i,
  agents: /\b(sous-agent|subagent|agent|agents|d[ée]l[èe]gue|d[ée]l[ée]guer|parall[èe]le|multi-agent)\b/i,
  configuration: /\b(r[èe]gle|retiens|souviens|souvenir|d[ée]sormais|dor[ée]navant|d[ée]sactive|installe|module|skill|expert|comportement)\b/i,
  design: /\b(palette|couleur|couleurs|color|colors|design|token|tokens|th[eè]me|th[ée]mes|accessibilit[eé]|wcag|contraste|typographie|typography|police|spacing|espacement|ui|ux|variable|custom.propert)\b/i,
};

// Familles dont le chargement coûte cher en caractères de prompt.
// Un seul mot ambigu (« page », « image », « agent ») ne doit pas suffire.
const HEAVY = new Set(['navigateur', 'media', 'agents']);

// Termes non ambigus : leur présence seule justifie la famille, même sans second signal.
const STRONG = {
  navigateur: /\b(navigateur|browser|screenshot|onglet|formulaire|browser_)/i,
  media: /\b(vid[ée]o|video|mp4|audio|narration|speech|voix|voice|merge_videos)/i,
  agents: /\b(sous-agent|subagent|spawn|multi-agent|d[ée]l[èe]gue|d[ée]l[ée]guer)\b/i,
};

/**
 * Nombre de mots-clés distincts reconnus dans un texte.
 * @param {RegExp} re
 * @param {string} text
 * @returns {number}
 */
function _distinctMatches(re, text) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const found = new Set();
  for (const m of text.matchAll(new RegExp(re.source, flags))) {
    found.add(m[0].toLowerCase());
  }
  return found.size;
}

/**
 * Familles effectivement disponibles pour le jeu d'outils autorisé.
 * @param {string[]} toolNames
 * @returns {Record<string, string[]>}
 */
function familiesIn(toolNames) {
  const set = new Set(toolNames);
  const out = {};
  for (const [name, tools] of Object.entries(FAMILIES)) {
    const present = tools.filter(t => set.has(t));
    if (present.length) out[name] = present;
  }
  return out;
}

/**
 * Sélectionne les outils à exposer dans le prompt pour une tâche donnée.
 * Conserve l'ordre du catalogue original (lisibilité du prompt).
 *
 * @param {string[]} toolNames  outils autorisés par la configuration
 * @param {string}   task       texte de la tâche
 * @param {{ enableLsp?: boolean }} [config]
 * @returns {string[]}
 */
function selectToolsForTask(toolNames, task, config = {}) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return [];
  const allowed = new Set(toolNames);
  const text = String(task || '');

  const keep = new Set();
  const addFamily = (name) => {
    for (const tool of FAMILIES[name] || []) {
      if (allowed.has(tool)) keep.add(tool);
    }
  };

  for (const tool of CORE) {
    if (allowed.has(tool)) keep.add(tool);
  }
  for (const name of ALWAYS) {
    if (name === 'lsp' && !config.enableLsp) continue;
    addFamily(name);
  }
  for (const [name, re] of Object.entries(TRIGGERS)) {
    if (!re.test(text)) continue;
    // Famille lourde : exiger un terme fort ou deux mots-clés distincts,
    // sinon « page » ou « image » suffirait à charger 18 outils.
    if (HEAVY.has(name)) {
      const strong = STRONG[name];
      const decisive = (strong && strong.test(text)) || _distinctMatches(re, text) >= 2;
      if (!decisive) continue;
    }
    addFamily(name);
  }

  // Familles forcées par le persona actif (indépendantes des déclencheurs textuels)
  for (const name of (config.forceFamilies || [])) {
    addFamily(name);
  }

  return toolNames.filter(t => keep.has(t));
}

/**
 * Résumé lisible des familles disponibles, pour guider un modèle qui a inventé un outil.
 * @param {string[]} toolNames
 * @returns {string}
 */
function describeFamilies(toolNames) {
  const families = familiesIn(toolNames);
  return Object.entries(families)
    .map(([name, tools]) => `${name} (${tools.slice(0, 3).join(', ')}${tools.length > 3 ? '…' : ''})`)
    .join(' · ');
}

module.exports = { CORE, FAMILIES, FAMILY_TRIGGERS: TRIGGERS, selectToolsForTask, familiesIn, describeFamilies };
