'use strict';

/**
 * Validation des arguments d'outils avant exécution (ADR-019).
 *
 * Pourquoi : un petit modèle produit régulièrement des appels incomplets
 * (`{"tool":"read_file","args":{}}`) ou mal typés (`"line": "42"`). Sans validation,
 * l'erreur remontée est celle de l'implémentation (`fs.readFileSync` sur `undefined`),
 * incompréhensible pour le modèle, qui répète la même erreur. Une erreur qui nomme le
 * champ manquant ET donne un exemple corrige ce comportement en un aller-retour.
 *
 * Portée volontairement limitée aux champs réellement obligatoires : un schéma trop
 * strict refuserait des appels légitimes (ex. `browser_click` accepte un sélecteur OU
 * des coordonnées). `plan` et `finish` sont exclus : ils ont déjà leur propre erreur
 * explicite côté implémentation / boucle.
 */

const SCHEMAS = {
  read_file:      { required: { path: 'string' }, example: { path: 'src/app.js' } },
  write_file:     { required: { path: 'string', content: 'string' }, example: { path: 'src/notes.md', content: '# Titre\n' } },
  replace_code:   { required: { path: 'string', old_string: 'string', new_string: 'string' }, example: { path: 'src/app.js', old_string: 'const a = 1;', new_string: 'const a = 2;' } },
  delete_file:    { required: { path: 'string' }, example: { path: 'src/old.js' } },
  move_file:      { required: { path: 'string', dest: 'string' }, example: { path: 'src/a.js', dest: 'src/b.js' } },
  format_file:    { required: { path: 'string' }, example: { path: 'src/app.js' } },
  diff_file:      { required: { path: 'string' }, example: { path: 'src/app.js' } },
  batch_replace:  { required: { pattern: 'string', replacement: 'string' }, example: { pattern: 'console\\.log', replacement: 'logger.info' } },
  search_grep:    { required: { pattern: 'string' }, example: { pattern: 'TODO', path: 'src' } },
  find_symbol:    { required: { name: 'string' }, example: { name: 'runAgent' } },
  read_url:       { required: { url: 'string' }, example: { url: 'https://example.com/doc' } },
  web_search:     { required: { query: 'string' }, example: { query: 'node --test glob' } },
  http_request:   { required: { url: 'string' }, example: { url: 'http://localhost:3000/health' } },
  call_api:       { required: { url: 'string' }, example: { url: 'https://api.exemple.fr/v1/items' } },
  run_shell:      { required: { command: 'string' }, example: { command: 'npm run build' } },
  start_process:  { required: { command: 'string' }, example: { command: 'npm run dev' } },
  stop_process:   { required: { name: 'string' }, example: { name: 'dev' } },
  get_output:     { required: { name: 'string' }, example: { name: 'dev' } },
  ask_user:       { required: { question: 'string' }, example: { question: 'Quel bundler est actif ?' } },
  note_user:      { required: { message: 'string' }, example: { message: 'Dépendance obsolète détectée', level: 'warn' } },
  spawn_agent:    { required: { role: 'string', task: 'string' }, example: { role: 'test-writer', task: 'Écrire les tests de sum()' } },
  git_commit:     { required: { message: 'string' }, example: { message: 'fix: borne de boucle' } },
  git_create_branch: { required: { name: 'string' }, example: { name: 'fix/sum-bounds' } },
  generate_image: { required: { prompt: 'string' }, example: { prompt: 'Logo minimaliste, fond sombre' } },
  generate_video: { required: { prompt: 'string' }, example: { prompt: 'Clip 5s, coucher de soleil' } },
  generate_speech:{ required: { text: 'string' }, example: { text: 'Bonjour' } },
  merge_videos:   { required: { inputs: 'array' }, example: { inputs: ['a.mp4', 'b.mp4'] } },
  lsp_hover:          { required: { path: 'string', line: 'number' }, example: { path: 'src/app.ts', line: 42 } },
  lsp_definition:     { required: { path: 'string', line: 'number' }, example: { path: 'src/app.ts', line: 42 } },
  lsp_references:     { required: { path: 'string', line: 'number' }, example: { path: 'src/app.ts', line: 42 } },
  find_dependents:    { required: { path: 'string' }, example: { path: 'src/harness/agent.js' } },
  find_dependencies:  { required: { path: 'string' }, example: { path: 'src/harness/agent.js' } },
  project_note:         { required: { action: 'string' }, example: { action: 'set', key: 'stack', value: 'Next.js + Prisma' } },
  generate_palette:     { required: { base_color: 'string' }, example: { base_color: '#3B82F6' } },
  read_design_tokens:   { required: {}, example: { path: 'src/styles.css' } },
};

const EXAMPLE_MAX = 180;

function _example(schema) {
  const json = JSON.stringify(schema.example);
  return json.length <= EXAMPLE_MAX ? json : `${json.slice(0, EXAMPLE_MAX)}…`;
}

/**
 * Vérifie les arguments obligatoires d'un outil.
 * Les outils sans schéma passent sans contrôle (comportement inchangé).
 *
 * @param {string} toolName
 * @param {object} args
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateArgs(toolName, args) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: true };

  const value = args && typeof args === 'object' ? args : {};

  for (const [key, type] of Object.entries(schema.required)) {
    const v = value[key];
    const missing = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (missing) {
      return {
        ok: false,
        error: `ARGUMENT_MANQUANT: "${key}" — ${toolName} attend ${_example(schema)}`,
      };
    }
    const actual = Array.isArray(v) ? 'array' : typeof v;
    if (actual !== type) {
      return {
        ok: false,
        error: `ARGUMENT_TYPE: "${key}" doit être ${type} (reçu ${actual}) — ${toolName} attend ${_example(schema)}`,
      };
    }
  }
  return { ok: true };
}

module.exports = { validateArgs, SCHEMAS };
