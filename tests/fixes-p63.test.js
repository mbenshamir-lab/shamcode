/**
 * Tests Phase 63 — Étapes complètes dans le bandeau + actions en cours en bas
 *
 * 1. Le bandeau #active-plan liste TOUTES les étapes (état done / active / pending)
 * 2. La ligne d'action en cours reste le dernier élément du chat (sticky en bas)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const src  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');

describe('bandeau de plan — toutes les étapes', () => {
  it('le HTML prévoit une liste ordonnée d\'étapes', () => {
    const bar   = html.indexOf('id="active-plan"');
    const list  = html.indexOf('<ol class="ap-steps">');
    const input = html.indexOf('id="input-wrapper"');
    assert.ok(list !== -1, 'liste <ol class="ap-steps"> attendue');
    assert.ok(bar !== -1 && list > bar, 'liste dans le bandeau');
    assert.ok(list < input, 'bandeau toujours au-dessus de la zone de saisie');
  });

  it('_planPinShow construit une ligne par étape', () => {
    const idx = src.indexOf('function _planPinShow');
    const block = src.slice(idx, idx + 1600);
    assert.ok(block.includes('(plan?.steps || []).forEach'), 'toutes les étapes parcourues');
    assert.ok(block.includes('apStepsEl.appendChild(li)'), 'étapes ajoutées au bandeau');
    assert.ok(block.includes('ap-step-num'), 'numérotation');
  });

  it('_planPinSync marque chaque étape done / active / pending', () => {
    const idx = src.indexOf('function _planPinSync');
    const block = src.slice(idx, idx + 800);
    assert.ok(block.includes("i < done ? 'done' : i === done ? 'active' : 'pending'"), 'états calculés');
    assert.ok(block.includes('_apItems.forEach'), 'appliqués à toutes les étapes');
  });

  it('_planPinHide vide le bandeau', () => {
    const idx = src.indexOf('function _planPinHide');
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("apStepsEl.innerHTML = ''"), 'liste nettoyée');
    assert.ok(block.includes('_apItems = []'), 'références libérées');
  });

  it('les états sont stylés', () => {
    for (const cls of ['.ap-steps', '.ap-step-item', '.ap-step-item.active', '.ap-step-item.done']) {
      assert.ok(css.includes(cls), `${cls} manquant`);
    }
  });
});

describe('actions en cours — toujours en bas du chat', () => {
  it('_activityToBottom existe et replace la ligne en dernier', () => {
    const idx = src.indexOf('function _activityToBottom');
    assert.ok(idx !== -1, '_activityToBottom requise');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('messagesEl.appendChild(_activityBlock)'), 'déplacement en fin de liste');
  });

  it('chaque étape d\'outil ramène la ligne en bas', () => {
    const idx = src.indexOf('function _activityStep');
    const block = src.slice(idx, idx + 1300);
    assert.ok(block.includes('_activityToBottom()'), 'appel après mise à jour');
  });

  it('les bandeaux d\'écriture ne passent pas sous l\'action en cours', () => {
    const idx = src.indexOf('function _stripPush');
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes('_activityToBottom()'), 'appel après ajout au bandeau');
  });

  it('le plan du chat non plus', () => {
    const idx = src.indexOf('function _appendChatTodo');
    const block = src.slice(idx, idx + 2600);
    assert.ok(block.includes('_activityToBottom()'), 'appel après le plan');
  });

  it('CSS : la ligne d\'activité suit le flux du chat (pas de superposition)', () => {
    const idx = css.indexOf('.activity-block {');
    assert.ok(idx !== -1, '.activity-block requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(!block.includes('position: sticky'), 'ne recouvre pas le contenu');
    assert.ok(!block.includes('z-index'), 'pas de calque flottant');
  });

  it('CSS : les messages s\'empilent avec un espacement régulier', () => {
    const idx = css.indexOf('#messages {');
    assert.ok(idx !== -1, '#messages requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('display: flex'), 'conteneur flex');
    assert.ok(block.includes('gap: 8px'), 'espacement');
  });
});
