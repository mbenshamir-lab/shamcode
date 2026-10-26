/**
 * Tests Phase 62 — Plan épinglé au-dessus de la saisie + plan plié dans le chat
 *
 * 1. index.html — bandeau #active-plan dans le footer, avant #input-wrapper
 * 2. styles.css — bandeau visible / masqué, en-tête plié du plan dans le chat
 * 3. app.js — affichage pendant l'exécution, mise à jour de la progression,
 *    disparition en fin de plan, plan du chat plié par défaut et dépliable
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const src  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');

describe('index.html — bandeau de plan épinglé', () => {
  it('le bandeau existe', () => {
    assert.ok(html.includes('id="active-plan"'), '#active-plan requis');
  });

  it('il est placé dans le footer, juste avant la zone de saisie', () => {
    const footer = html.indexOf('id="input-area"');
    const bar    = html.indexOf('id="active-plan"');
    const wrapper = html.indexOf('id="input-wrapper"');
    assert.ok(footer !== -1 && bar !== -1 && wrapper !== -1, 'éléments présents');
    assert.ok(bar > footer, 'dans le footer');
    assert.ok(bar < wrapper, 'au-dessus de la zone de saisie');
  });

  it('il démarre masqué', () => {
    const idx = html.indexOf('id="active-plan"');
    const tag = html.slice(idx, html.indexOf('>', idx));
    assert.ok(tag.includes('hidden'), 'classe hidden au départ');
  });

  it('il contient spinner, objectif, progression et la liste des étapes', () => {
    for (const cls of ['ap-spin', 'ap-objective', 'ap-progress', 'ap-label', 'ap-steps']) {
      assert.ok(html.includes(cls), `.${cls} manquant`);
    }
  });
});

describe('styles.css — bandeau et plan plié', () => {
  it('.active-plan est stylé et masquable', () => {
    assert.ok(css.includes('.active-plan {'), 'style du bandeau');
    assert.ok(css.includes('.active-plan.hidden'), 'état masqué');
  });

  it('le bandeau met le plan en évidence', () => {
    const idx = css.indexOf('.active-plan {');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('border-left: 3px solid var(--accent)'), 'liseré accent');
    assert.ok(block.includes('background'), 'fond distinctif');
  });

  it('en-tête plié du plan dans le chat', () => {
    for (const cls of ['.chat-todo-head', '.chat-todo-chevron', '.chat-todo-kind', '.chat-todo-count']) {
      assert.ok(css.includes(cls), `${cls} manquant`);
    }
  });

  it('la liste pliée est masquée', () => {
    assert.ok(css.includes('.chat-todo-list.hidden { display: none; }'), 'liste repliable');
  });
});

describe('app.js — cycle de vie du plan épinglé', () => {
  it('les trois fonctions du bandeau existent', () => {
    for (const fn of ['_planPinShow', '_planPinSync', '_planPinHide']) {
      assert.ok(src.includes(`function ${fn}`), `${fn} manquante`);
    }
  });

  it('plan_ready affiche le bandeau et le plan plié', () => {
    const idx = src.indexOf("event.type === 'plan_ready'");
    const block = src.slice(idx, idx + 360);
    assert.ok(block.includes('_appendChatTodo(event.plan'), 'plan dans le chat');
    assert.ok(block.includes('_planPinShow(event.plan)'), 'bandeau épinglé affiché');
  });

  it('chaque étape met à jour la progression', () => {
    const idx = src.indexOf('function _advanceChatTodo');
    const block = src.slice(idx, idx + 800);
    assert.ok(block.includes('_planPinSync()'), 'progression synchronisée');
  });

  it('finish retire le bandeau (plan totalement exécuté)', () => {
    const idx = src.indexOf("event.type === 'finish'");
    const block = src.slice(idx, idx + 240);
    assert.ok(block.includes('_planPinHide()'), 'disparition à la fin');
  });

  it('cancelled retire aussi le bandeau', () => {
    const idx = src.indexOf("event.type === 'cancelled'");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('_planPinHide()'), 'disparition si annulé');
  });

  it('une nouvelle tâche repart sans bandeau résiduel', () => {
    const idx = src.indexOf('async function sendTask');
    // Fenêtre large : la remise à zéro des bandeaux se trouve après le garde-fou
    // de validation (~1400 caractères) — une borne trop courte rendait ce test
    // rouge sans qu'aucun comportement ne soit cassé.
    const block = src.slice(idx, idx + 2000);
    assert.ok(block.includes('_planPinHide()'), 'réinitialisation au démarrage');
  });

  it('le bandeau affiche objectif, compteur et toutes les étapes', () => {
    const idx = src.indexOf('function _planPinSync');
    const block = src.slice(idx, idx + 900);
    assert.ok(block.includes('apProgressEl.textContent'), 'compteur n/m');
    assert.ok(block.includes('_apItems.forEach'), 'état de chaque étape mis à jour');
  });
});

describe('app.js — plan du chat toujours plié', () => {
  it('la liste démarre masquée', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 2400);
    assert.ok(block.includes("ul.className = 'chat-todo-list hidden'"), 'liste pliée par défaut');
  });

  it('un clic déplie / replie', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 2600);
    assert.ok(block.includes("head.addEventListener('click'"), 'en-tête cliquable');
    assert.ok(block.includes('setExpanded(!expanded)'), 'bascule');
    assert.ok(block.includes("expanded ? '▾' : '▸'"), 'chevron synchronisé');
  });

  it('le compteur est mis à jour à chaque étape', () => {
    const idx = src.indexOf('function _syncChatTodoCount');
    assert.ok(idx !== -1, '_syncChatTodoCount requise');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('_chatTodoCountEl.textContent'), 'texte du compteur');
  });
});
