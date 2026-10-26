/**
 * Tests Phase 50 — Task panel 4 cadres égaux + chat ToDo animée
 * 1. HTML — 4 panneaux tp-panel présents avec les bons IDs
 * 2. CSS  — .tp-panel utilise flex: 1 1 0, #task-panel est en colonne overflow:hidden
 * 3. CSS  — .chat-todo et .chat-todo-item définis avec animation
 * 4. app.js — _tp contient execEmpty + _chatTodo* déclarés avant _tpReset
 * 5. app.js — _appendChatTodo, _advanceChatTodo, _finalizeChatTodo existent
 * 6. app.js — plan_ready appelle _appendChatTodo ET _tpSetPlan
 * 7. app.js — tool_call appelle _advanceChatTodo
 * 8. app.js — finish/cancelled appellent _finalizeChatTodo
 * 9. app.js — _tpReset réinitialise les variables _chatTodo*
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'),  'utf8');
const src  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'),      'utf8');

// ── 1. HTML — 4 panneaux ─────────────────────────────────────────────────────
describe('index.html — 4 panneaux tp-panel', () => {
  it('apps-panel a class tp-panel', () => {
    assert.ok(html.includes('id="apps-panel"') && html.includes('tp-panel'), 'apps-panel doit avoir class tp-panel');
    const idx = html.indexOf('id="apps-panel"');
    const block = html.slice(Math.max(0, idx - 50), idx + 80);
    assert.ok(block.includes('tp-panel'), 'apps-panel doit être un tp-panel');
  });

  it('procs-panel a class tp-panel', () => {
    const idx = html.indexOf('id="procs-panel"');
    assert.ok(idx >= 0, 'procs-panel doit exister');
    const block = html.slice(Math.max(0, idx - 50), idx + 80);
    assert.ok(block.includes('tp-panel'), 'procs-panel doit être un tp-panel');
  });

  it('tp-plan-panel existe avec class tp-panel', () => {
    assert.ok(html.includes('id="tp-plan-panel"'), 'tp-plan-panel doit exister');
    const idx = html.indexOf('id="tp-plan-panel"');
    const block = html.slice(Math.max(0, idx - 50), idx + 80);
    assert.ok(block.includes('tp-panel'), 'tp-plan-panel doit être un tp-panel');
  });

  it('tp-exec-panel existe avec class tp-panel', () => {
    assert.ok(html.includes('id="tp-exec-panel"'), 'tp-exec-panel doit exister');
    const idx = html.indexOf('id="tp-exec-panel"');
    const block = html.slice(Math.max(0, idx - 50), idx + 80);
    assert.ok(block.includes('tp-panel'), 'tp-exec-panel doit être un tp-panel');
  });

  it('tp-exec-empty existe pour l\'état vide du panneau exécution', () => {
    assert.ok(html.includes('id="tp-exec-empty"'), 'tp-exec-empty doit exister');
  });

  it('tp-panel-body présent dans les panneaux Plan et Exécution', () => {
    // Panels 1 et 2 (apps/procs) conservent leur structure propre
    // Panels 3 (plan) et 4 (exec) utilisent tp-panel-body pour le scroll
    const count = (html.match(/tp-panel-body/g) || []).length;
    assert.ok(count >= 2, `Au moins 2 tp-panel-body attendus (plan + exec), trouvé ${count}`);
  });
});

// ── 2. CSS — structure tp-panel ──────────────────────────────────────────────
describe('styles.css — .tp-panel hauteur 1/4 (Phase 68)', () => {
  it('.tp-panel occupe un quart de la hauteur', () => {
    const idx = css.indexOf('.tp-panel {');
    assert.ok(idx >= 0, '.tp-panel doit être défini');
    const block = css.slice(idx, css.indexOf('}', idx) + 1);
    assert.ok(block.includes('flex:'), '.tp-panel doit avoir flex');
    assert.ok(block.includes('calc(25%'), '.tp-panel doit partiager la hauteur en quarts');
  });

  it('.tp-panel a min-height: 0 (évite overflow des enfants flex)', () => {
    const idx = css.indexOf('.tp-panel {');
    const block = css.slice(idx, css.indexOf('}', idx) + 1);
    assert.ok(block.includes('min-height: 0'), '.tp-panel doit avoir min-height: 0');
  });

  it('#task-panel a height calc(100vh - ...)', () => {
    const idx = css.indexOf('#task-panel {');
    assert.ok(idx >= 0, '#task-panel doit être défini');
    const block = css.slice(idx, css.indexOf('}', idx) + 1);
    assert.ok(block.includes('height') && block.includes('calc'), '#task-panel doit avoir une hauteur calculée');
  });

  it('.tp-panel-body a overflow-y: auto (scrollbar verticale)', () => {
    const idx = css.indexOf('.tp-panel-body {');
    assert.ok(idx >= 0, '.tp-panel-body doit être défini');
    const block = css.slice(idx, css.indexOf('}', idx) + 1);
    assert.ok(block.includes('overflow-y') && block.includes('auto'), '.tp-panel-body doit avoir overflow-y: auto');
  });
});

// ── 3. CSS — chat-todo ───────────────────────────────────────────────────────
describe('styles.css — .chat-todo', () => {
  it('.chat-todo est défini', () => {
    assert.ok(css.includes('.chat-todo {'), '.chat-todo doit être défini dans styles.css');
  });

  it('.chat-todo-item est défini', () => {
    assert.ok(css.includes('.chat-todo-item'), '.chat-todo-item doit être défini');
  });

  it('.chat-todo-item.active a une animation (spinner)', () => {
    assert.ok(
      css.includes('.chat-todo-item.active') && css.includes('animation'),
      '.chat-todo-item.active doit avoir une animation'
    );
  });

  it('.chat-todo-item.done a text-decoration line-through', () => {
    // Le sélecteur peut être déclaré en deux blocs (check + label) — chercher dans tout le CSS
    const section = css.slice(css.indexOf('.chat-todo-item.done'));
    assert.ok(section.includes('line-through'), '.chat-todo-item.done doit barrer le texte');
  });

  it('.chat-todo-check::after affiche ✓ quand done', () => {
    assert.ok(
      css.includes('.chat-todo-item.done .chat-todo-check::after'),
      'Le check mark doit apparaître pour les steps done'
    );
  });
});

// ── 4. app.js — _tp.execEmpty + _chatTodo* déclarés avant _tpReset ──────────
describe('app.js — déclarations avant _tpReset', () => {
  it('_tp.execEmpty est référencé dans l\'objet _tp', () => {
    assert.ok(src.includes("execEmpty: document.getElementById('tp-exec-empty')"),
      '_tp.execEmpty doit pointer vers #tp-exec-empty');
  });

  it('_chatTodoEl déclaré avant _tpReset (pas de TDZ)', () => {
    const tpResetIdx  = src.indexOf('function _tpReset()');
    const chatTodoIdx = src.indexOf('let _chatTodoEl');
    assert.ok(chatTodoIdx >= 0, '_chatTodoEl doit être déclaré');
    assert.ok(chatTodoIdx < tpResetIdx, '_chatTodoEl doit être déclaré AVANT _tpReset pour éviter le TDZ');
  });
});

// ── 5. app.js — fonctions chat ToDo ─────────────────────────────────────────
describe('app.js — fonctions chat ToDo', () => {
  it('_appendChatTodo existe', () => {
    assert.ok(src.includes('function _appendChatTodo'), '_appendChatTodo doit être défini');
  });

  it('_advanceChatTodo existe', () => {
    assert.ok(src.includes('function _advanceChatTodo'), '_advanceChatTodo doit être défini');
  });

  it('_finalizeChatTodo existe', () => {
    assert.ok(src.includes('function _finalizeChatTodo'), '_finalizeChatTodo doit être défini');
  });

  it('_appendChatTodo crée un élément .chat-todo', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 600);
    assert.ok(block.includes('chat-todo'),
      '_appendChatTodo doit créer un élément avec class chat-todo');
  });
});

// ── 6. app.js — plan_ready appelle les deux fonctions ───────────────────────
describe('app.js — plan_ready → _tpSetPlan + _appendChatTodo', () => {
  const planReadyIdx = src.indexOf("event.type === 'plan_ready'");
  assert.ok(planReadyIdx >= 0, 'Le handler plan_ready doit exister');
  const block = src.slice(planReadyIdx, planReadyIdx + 400);

  it('plan_ready appelle _tpSetPlan', () => {
    assert.ok(block.includes('_tpSetPlan'), 'plan_ready doit mettre à jour le task panel');
  });

  it('plan_ready appelle _appendChatTodo', () => {
    assert.ok(block.includes('_appendChatTodo'), 'plan_ready doit afficher le todo dans le chat');
  });
});

// ── 7. app.js — tool_call appelle _advanceChatTodo ──────────────────────────
describe('app.js — tool_call → _advanceChatTodo', () => {
  const toolCallIdx = src.indexOf("event.type === 'tool_call'");
  assert.ok(toolCallIdx >= 0, 'Le handler tool_call doit exister');
  const block = src.slice(toolCallIdx, toolCallIdx + 600);

  it('tool_call appelle _advanceChatTodo', () => {
    assert.ok(block.includes('_advanceChatTodo'), 'tool_call doit avancer le todo du chat');
  });
});

// ── 8. app.js — finish/cancelled → _finalizeChatTodo ────────────────────────
describe('app.js — finish/cancelled → _finalizeChatTodo', () => {
  it('finish appelle _finalizeChatTodo(true)', () => {
    const idx = src.indexOf("event.type === 'finish'");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('_finalizeChatTodo(true)'), 'finish doit finaliser le todo (ok=true)');
  });

  it('cancelled appelle _finalizeChatTodo(false)', () => {
    const idx = src.indexOf("event.type === 'cancelled'");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('_finalizeChatTodo(false)'), 'cancelled doit finaliser le todo (ok=false)');
  });
});

// ── 9. app.js — _tpReset réinitialise les _chatTodo* ────────────────────────
describe('app.js — _tpReset réinitialise chat todo', () => {
  const tpResetIdx = src.indexOf('function _tpReset()');
  const tpResetEnd = src.indexOf('\n  function', tpResetIdx + 10);
  const block = src.slice(tpResetIdx, tpResetEnd === -1 ? tpResetIdx + 2000 : tpResetEnd);

  it('_tpReset remet _chatTodoEl à null', () => {
    assert.ok(block.includes('_chatTodoEl') && block.includes('null'),
      '_tpReset doit réinitialiser _chatTodoEl');
  });

  it('_tpReset vide _chatTodoItems', () => {
    assert.ok(block.includes('_chatTodoItems') && block.includes('[]'),
      '_tpReset doit vider _chatTodoItems');
  });

  it('_tpReset remet _chatTodoStepIdx à 0', () => {
    assert.ok(block.includes('_chatTodoStepIdx') && block.includes('0'),
      '_tpReset doit remettre _chatTodoStepIdx à 0');
  });

  it('_tpReset montre tp-exec-empty (classList.remove hidden)', () => {
    assert.ok(
      block.includes('execEmpty') && block.includes("remove('hidden')"),
      '_tpReset doit afficher l\'état vide du panneau exécution'
    );
  });
});
