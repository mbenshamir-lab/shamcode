/**
 * Tests Phase 65 — Indentation du chat (hiérarchie de lecture)
 *
 * Niveau 0 : bulle utilisateur (droite)
 * Niveau 1 : réponse de l'agent      (14 px)
 * Niveau 2 : activité de l'agent     (26 px)
 * Niveau 3 : détails                 (20 à 30 px)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

/** Corps de la règle CSS dont le sélecteur exact est fourni. */
function rule(selector) {
  const idx = css.indexOf(`${selector} {`);
  if (idx === -1) return null;
  return css.slice(idx, css.indexOf('}', idx));
}

describe('indentation — niveaux de lecture', () => {
  it('niveau 1 : la réponse de l\'agent est décalée de 14 px', () => {
    const r = rule('#messages > .message-agent');
    assert.ok(r, 'règle d\'indentation de la réponse requise');
    assert.ok(r.includes('padding-left: 14px'), 'réponse décalée');
  });

  it('niveau 2 : plan, action en cours et bandeaux à 26 px', () => {
    const r = rule('#messages > .chat-todo,\n#messages > .run-strip,\n#messages > .activity-block');
    assert.ok(r, 'règle du niveau 2 requise');
    assert.ok(r.includes('padding-left: 26px'), 'activité décalée');
  });

  it('niveau 3 : intention à 20 px, items de bandeau à 30 px', () => {
    assert.ok(rule('#chat-area .activity-intent').includes('padding-left: 20px'), 'intention');
    assert.ok(rule('#chat-area .run-strip-items').includes('padding-left: 30px'), 'détails de bandeau');
  });

  it('les étapes du plan plié sont indentées', () => {
    assert.ok(rule('#chat-area .chat-todo-list').includes('padding-left: 26px'), 'liste du plan');
  });

  it('les listes de la réponse sont franchement indentées', () => {
    const r = rule('#chat-area .message-agent ul,\n#chat-area .message-agent ol');
    assert.ok(r, 'règle des listes requise');
    assert.ok(r.includes('padding-left: 24px'), 'listes décalées');
  });

  it('la bulle utilisateur reste alignée à droite (niveau 0)', () => {
    const r = rule('.message-user');
    assert.ok(r.includes('align-self: flex-end'), 'bulle à droite');
  });
});

describe('intégrité de la feuille de styles', () => {
  it('accolades équilibrées', () => {
    const open  = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    assert.equal(open, close, `${open} { contre ${close} }`);
  });

  it('la règle .message est restée intacte', () => {
    const r = rule('.message');
    assert.ok(r, 'règle .message requise');
    assert.ok(r.includes('padding: 10px 14px'), 'padding de base conservé');
    assert.ok(r.includes('max-width: 82%'), 'largeur de base conservée');
  });

  it('aucune déclaration orpheline avant .message', () => {
    const idx = css.indexOf('\n.message {');
    const before = css.slice(idx - 200, idx);
    assert.ok(before.trim().endsWith('*/') || before.trim().endsWith('}'),
      `déclarations orphelines : ${JSON.stringify(before.slice(-40))}`);
  });
});
