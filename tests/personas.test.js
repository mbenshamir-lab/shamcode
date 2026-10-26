'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PERSONAS, resolvePersona } = require('../src/harness/prompts/personas');
const { PERSONA_IDS }              = require('../src/shared/constants');
const { selectToolsForTask }       = require('../src/harness/tools/families');

// ── resolvePersona ───────────────────────────────────────────────────────────

describe('resolvePersona', () => {
  it('retourne dev par défaut (undefined)', () => {
    const p = resolvePersona();
    assert.equal(p.id, 'dev');
    assert.equal(p.systemAddition, '');
    assert.deepEqual(p.forceFamilies, []);
  });

  it('retourne dev par défaut (inconnu)', () => {
    assert.equal(resolvePersona('inconnu').id, 'dev');
  });

  it('retourne architecte avec forceFamilies recherche', () => {
    const p = resolvePersona('architecte');
    assert.equal(p.id, 'architecte');
    assert.ok(p.forceFamilies.includes('recherche'));
    assert.ok(p.systemAddition.length > 0);
  });

  it('retourne securite avec forceFamilies recherche + web', () => {
    const p = resolvePersona('securite');
    assert.ok(p.forceFamilies.includes('recherche'));
    assert.ok(p.forceFamilies.includes('web'));
    assert.ok(p.systemAddition.includes('OWASP'));
  });

  it('retourne reviewer avec forceFamilies git', () => {
    const p = resolvePersona('reviewer');
    assert.ok(p.forceFamilies.includes('git'));
    assert.ok(p.systemAddition.includes('git_diff'));
  });

  it('retourne cyber avec forceFamilies execution', () => {
    const p = resolvePersona('cyber');
    assert.ok(p.forceFamilies.includes('execution'));
    assert.ok(p.systemAddition.includes('autoris'));
  });

  it('retourne designer avec forceFamilies design', () => {
    const p = resolvePersona('designer');
    assert.ok(p.forceFamilies.includes('design'));
    assert.ok(p.systemAddition.includes('WCAG'));
  });
});

// ── PERSONAS catalogue ───────────────────────────────────────────────────────

describe('PERSONAS catalogue', () => {
  const ids = Object.values(PERSONA_IDS);

  it('tous les PERSONA_IDS existent dans PERSONAS', () => {
    for (const id of ids) {
      assert.ok(PERSONAS[id], `PERSONA_IDS.${id.toUpperCase()} introuvable dans PERSONAS`);
    }
  });

  it('chaque persona a id, label, icon, systemAddition, forceFamilies', () => {
    for (const p of Object.values(PERSONAS)) {
      assert.ok(typeof p.id === 'string' && p.id.length > 0,   `${p.id}: id manquant`);
      assert.ok(typeof p.label === 'string' && p.label.length > 0, `${p.id}: label manquant`);
      assert.ok(typeof p.icon === 'string' && p.icon.length > 0,   `${p.id}: icon manquant`);
      assert.ok(typeof p.systemAddition === 'string',               `${p.id}: systemAddition manquant`);
      assert.ok(Array.isArray(p.forceFamilies),                      `${p.id}: forceFamilies pas un tableau`);
    }
  });

  it('six personas définis', () => {
    assert.equal(Object.keys(PERSONAS).length, 6);
  });
});

// ── selectToolsForTask + forceFamilies ───────────────────────────────────────

const ALL_TOOLS = [
  'plan', 'read_file', 'write_file', 'replace_code', 'list_dir', 'search_grep',
  'run_tests', 'get_project_info', 'scratchpad', 'project_note', 'ask_user', 'note_user', 'finish', 'notify_user',
  'delete_file', 'move_file', 'batch_replace', 'restore_file', 'diff_file', 'format_file',
  'find_symbol', 'find_dependents', 'find_dependencies', 'find_relevant_files', 'git_status', 'git_diff',
  'run_shell', 'start_process', 'stop_process', 'get_output', 'list_processes', 'fix_loop', 'deploy', 'check_service', 'http_request',
  'read_url', 'web_search', 'call_api',
  'git_create_branch', 'git_commit',
];

describe('selectToolsForTask + forceFamilies persona', () => {
  it('sans forceFamilies, git_commit absent pour une tâche neutre', () => {
    const tools = selectToolsForTask(ALL_TOOLS, 'analyser ce fichier', {});
    assert.ok(!tools.includes('git_commit'), 'git_commit ne devrait pas être présent sans trigger git');
  });

  it('persona architecte force find_dependents même sans mot-clé', () => {
    const { forceFamilies } = resolvePersona('architecte');
    const tools = selectToolsForTask(ALL_TOOLS, 'analyser ce fichier', { forceFamilies });
    assert.ok(tools.includes('find_dependents'), 'find_dependents doit être forcé par persona architecte');
  });

  it('persona securite force web_search même sans mot-clé', () => {
    const { forceFamilies } = resolvePersona('securite');
    const tools = selectToolsForTask(ALL_TOOLS, 'auditer ce fichier', { forceFamilies });
    assert.ok(tools.includes('web_search'), 'web_search doit être forcé par persona securite');
  });

  it('persona reviewer force git_diff même sans mot-clé git', () => {
    const { forceFamilies } = resolvePersona('reviewer');
    const tools = selectToolsForTask(ALL_TOOLS, 'regarder le code', { forceFamilies });
    assert.ok(tools.includes('git_diff'), 'git_diff doit être forcé par persona reviewer');
  });

  it('persona cyber force run_shell même sans mot-clé', () => {
    const { forceFamilies } = resolvePersona('cyber');
    const tools = selectToolsForTask(ALL_TOOLS, 'analyser', { forceFamilies });
    assert.ok(tools.includes('run_shell'), 'run_shell doit être forcé par persona cyber');
  });

  it('persona dev (forceFamilies vide) ne force rien de supplémentaire', () => {
    const { forceFamilies } = resolvePersona('dev');
    const toolsDev  = selectToolsForTask(ALL_TOOLS, 'analyser', { forceFamilies });
    const toolsBase = selectToolsForTask(ALL_TOOLS, 'analyser', {});
    assert.deepEqual(toolsDev, toolsBase);
  });
});

// ── HTML — présence du sélecteur de persona ──────────────────────────────────

const fs   = require('fs');
const path = require('path');

describe('index.html — persona-select (combo)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');

  it('contient le <select id="persona-select">', () => {
    assert.ok(html.includes('<select id="persona-select"'));
  });

  it('contient les 6 options persona', () => {
    const personas = ['dev', 'architecte', 'securite', 'reviewer', 'cyber', 'designer'];
    for (const id of personas) {
      assert.ok(html.includes(`<option value="${id}">`), `option persona "${id}" absente`);
    }
  });

  it('le combo est placé juste au-dessus du champ de saisie', () => {
    assert.ok(html.indexOf('id="persona-select"') < html.indexOf('id="input-wrapper"'));
    assert.ok(html.indexOf('id="persona-select"') > html.indexOf('id="prompt-examples"'));
  });
});

// ── CSS — styles persona ──────────────────────────────────────────────────────

describe('styles.css — .persona-select', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

  it('contient .persona-select', () => assert.ok(css.includes('.persona-select')));
});
