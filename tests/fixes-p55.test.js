/**
 * Tests Phase 55 — Réponses compactes : plan + résumé, puces et numérotation
 *
 * 1. Prompt système — section FORMAT COMPACT (limites chiffrées plan / finish)
 * 2. agent.js — limites rappelées dans les descriptions d'outils
 * 3. app.js — étapes numérotées dans le Chat ToDo + texte complet au survol
 * 4. styles.css — rendu compact (numéro, clamp 2 lignes, espacements)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const { buildSystemPrompt } = require('../src/harness/prompts/system');

const appJs = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const agentJs = fs.readFileSync(path.join(__dirname, '../src/harness/agent.js'), 'utf8');
const css   = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

describe('prompt système — FORMAT COMPACT', () => {
  const prompt = buildSystemPrompt(['plan', 'read_file', 'write_file', 'finish']);

  it('la section existe', () => {
    assert.ok(prompt.includes('FORMAT COMPACT — PLANS ET RÉPONSES'), 'section FORMAT COMPACT attendue');
  });

  it('limite l\'objectif du plan à 90 caractères', () => {
    assert.ok(prompt.includes('max 90 caractères'), 'objectif 1 ligne ≤ 90 caractères');
  });

  it('limite goals et steps du plan', () => {
    assert.ok(prompt.includes('3 à 4 max, max 60 caractères'), 'goals bornés');
    assert.ok(prompt.includes('3 à 6 max, max 70 caractères'), 'steps bornés');
  });

  it('impose le verbe à l\'infinitif pour les étapes', () => {
    assert.ok(prompt.includes('à l\'infinitif (verbe + objet)'), 'steps verbalisés');
  });

  it('limite le résumé final à 1000 caractères / 14 lignes', () => {
    assert.ok(prompt.includes('max 1000 caractères AU TOTAL'), 'budget du summary');
    assert.ok(prompt.includes('14 lignes maximum'), 'budget de lignes');
  });

  it('impose sections numérotées + puces d\'une ligne', () => {
    assert.ok(prompt.includes('**1. Titre court**'), 'sections numérotées');
    assert.ok(prompt.includes('2 à 4 puces'), 'puces bornées');
    assert.ok(prompt.includes('d\'UNE ligne (max 100 caractères)'), 'puces d\'une ligne');
  });

  it('interdit le remplissage (intro, méthode, conclusion)', () => {
    assert.ok(prompt.includes('paragraphe d\'introduction'), 'intro interdite');
    assert.ok(prompt.includes('rappel de la méthode'), 'méthode interdite');
    assert.ok(prompt.includes('conclusion'), 'conclusion interdite');
  });

  it('donne un exemple de summary conforme', () => {
    assert.ok(prompt.includes('Exemple de summary conforme'), 'few-shot compact attendu');
  });

  it('en mode Plan, finish demande un plan numéroté 1 ligne par étape', () => {
    const p = buildSystemPrompt(['plan', 'finish'], '', { planMode: true });
    assert.ok(p.includes('plan d\'action numéroté, 1 ligne par étape'), 'plan mode → étapes numérotées');
    assert.ok(p.includes('max 1000 caractères'), 'budget rappelé dans le process');
  });

  it('en mode Action, finish demande un résumé numéros + puces', () => {
    assert.ok(prompt.includes('résumé concis, numéros + puces (max 1000 caractères)'), 'process action');
  });
});

describe('agent.js — limites rappelées dans les descriptions d\'outils', () => {
  it('la description de plan contient les bornes', () => {
    assert.ok(agentJs.includes('1 ligne ≤ 90 car.'), 'objectif borné');
    assert.ok(agentJs.includes('3-6 max, ≤ 70 car.'), 'étapes bornées');
    assert.ok(agentJs.includes('infinitif'), 'formulation imposée');
  });

  it('la description de finish contient le budget', () => {
    assert.ok(agentJs.includes('summary compact (max 1000 car.'), 'budget du résumé rappelé');
  });
});

describe('app.js — Chat ToDo numéroté et compact', () => {
  it('_appendChatTodo crée un numéro d\'étape', () => {
    const idx = appJs.indexOf('function _appendChatTodo');
    const block = appJs.slice(idx, idx + 2200);
    assert.ok(block.includes('chat-todo-num'), 'badge numéro attendu');
    assert.ok(block.includes('`${i + 1}.`'), 'numérotation 1..N');
  });

  it('_appendChatTodo ajoute le texte complet au survol', () => {
    const idx = appJs.indexOf('function _appendChatTodo');
    const block = appJs.slice(idx, idx + 2200);
    assert.ok(block.includes('label.title = s'), 'tooltip étape');
    assert.ok(block.includes('head.title = _chatTodoObjective'), 'tooltip objectif');
  });

  it('après finish, le plan reste plié et toutes les étapes sont marquées faites', () => {
    const idx = appJs.indexOf('function _finalizeChatTodo');
    const end = appJs.indexOf('\n  function', idx + 10);
    const block = appJs.slice(idx, end === -1 ? idx + 900 : end);
    assert.ok(block.includes('chat-todo-item done'), 'étapes marquées faites');
    assert.ok(block.includes('_syncChatTodoCount()'), 'compteur mis à jour');
    assert.ok(!block.includes('innerHTML'), 'la ligne pliée n\'est pas reconstruite');
  });

  it('le panneau Plan garde les étapes complètes au survol', () => {
    const idx = appJs.indexOf('function _tpSetPlan');
    const block = appJs.slice(idx, idx + 900);
    assert.ok(block.includes('li.title = s'), 'tooltip dans le panneau');
  });
});

describe('styles.css — compacité du Chat ToDo', () => {
  it('.chat-todo-num est stylé', () => {
    assert.ok(css.includes('.chat-todo-num {'), 'style du numéro requis');
    assert.ok(css.includes('tabular-nums'), 'chiffres alignés');
  });

  it('objectif et étapes sont limités à 2 lignes', () => {
    const section = css.slice(css.indexOf('.chat-todo-objective'), css.indexOf('.chat-todo-check {'));
    assert.ok(section.includes('-webkit-line-clamp: 2'), 'clamp 2 lignes');
    assert.ok(section.includes('.chat-todo-label'), 'label compacté');
  });

  it('espacements resserrés (gap 3px, line-height 1.45)', () => {
    const section = css.slice(css.indexOf('.chat-todo-list'), css.indexOf('.chat-todo-check {'));
    assert.ok(section.includes('gap: 3px'), 'gap réduit');
    assert.ok(section.includes('line-height: 1.45'), 'interligne réduit');
  });

  it('la pastille est alignée sur la première ligne', () => {
    assert.ok(css.includes('margin-top: 2px;            /* aligné sur la 1re ligne'), 'alignement pastille');
  });
});
