/**
 * Tests Phase 67 — Briefing obligatoire avant exécution
 *
 * 1. Prompt — le plan est la première action (Action ET Plan), avec un briefing
 * 2. UI — le briefing (intent du plan) s'affiche en clair dans le chat avant le travail
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const { buildSystemPrompt } = require('../src/harness/prompts/system');
const { getExamples }      = require('../src/harness/prompts/examples');

const src    = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css    = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const agentJs = fs.readFileSync(path.join(__dirname, '../src/harness/agent.js'), 'utf8');

describe('prompt — briefing avant toute action', () => {
  const actionPrompt = buildSystemPrompt(['plan', 'read_file', 'write_file']);
  const planPrompt   = buildSystemPrompt(['plan'], '', { planMode: true });

  it('en mode Action, le plan est conditionnel (écriture ≥ 3 étapes)', () => {
    assert.ok(actionPrompt.includes('selon ton propre jugement'), 'plan conditionnel');
    assert.ok(actionPrompt.includes('comporte plusieurs modifications'), 'plan optionnel dans le process');
  });

  it('en mode Plan, le plan reste conditionnel', () => {
    assert.ok(planPrompt.includes('selon ton propre jugement'), 'plan conditionnel en planMode aussi');
  });

  it('la section briefing décrit les deux phrases attendues', () => {
    assert.ok(actionPrompt.includes('BRIEFING AVANT EXÉCUTION (quand tu utilises plan)'), 'section présente');
    assert.ok(actionPrompt.includes('reformule ce que l\'utilisateur demande'), 'compréhension');
    assert.ok(actionPrompt.includes('annonce la suite prévue'), 'plan annoncé');
    assert.ok(actionPrompt.includes('zéro jargon'), 'langage clair');
  });

  it('l\'exemple de plan commence par la reformulation de la demande', () => {
    const ex = getExamples('js');
    const m = ex.match(/\{"tool":"plan","intent":"([^"]+)"/);
    assert.ok(m, 'exemple de plan présent');
    assert.ok(m[1].startsWith('Tu veux'), `briefing non user-facing : ${m[1]}`);
  });

  it('la description de l\'outil plan rappelle le briefing', () => {
    assert.ok(agentJs.includes('À utiliser librement'), 'rôle de l\'outil');
    assert.ok(agentJs.includes('briefe'), 'rôle de briefing');
    assert.ok(agentJs.includes('intent ='), 'avant exécution');
  });
});

describe('app.js — affichage du briefing', () => {
  it('l\'intention du plan est mémorisée au tool_call', () => {
    const idx = src.indexOf("event.type === 'tool_call'");
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes('_lastToolIntent = event.intent'), 'intention capturée');
  });

  it('plan_ready transmet le briefing au plan du chat', () => {
    const idx = src.indexOf("event.type === 'plan_ready'");
    const block = src.slice(idx, idx + 320);
    assert.ok(block.includes('_appendChatTodo(event.plan, _lastToolIntent)'), 'briefing transmis');
  });

  it('_appendChatTodo affiche le briefing avant l\'en-tête plié', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('chat-todo-brief'), 'classe du briefing');
    assert.ok(block.includes('b.textContent = briefText'), 'texte du briefing');
    assert.ok(block.includes('b.title = briefText'), 'texte complet au survol');
  });

  it('le briefing est optionnel (pas de bloc vide)', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('if (briefText)'), 'rendu conditionnel');
  });
});

describe('styles.css — briefing', () => {
  it('.chat-todo-brief est stylé', () => {
    const idx = css.indexOf('.chat-todo-brief {');
    assert.ok(idx !== -1, 'style requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('font-size: var(--text-xs)'), 'taille lisible');
    assert.ok(block.includes('color: var(--text)'), 'texte principal');
  });

  it('le briefing porte un repère visuel', () => {
    assert.ok(css.includes('.chat-todo-brief::before'), 'repère avant le texte');
  });
});
