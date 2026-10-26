/**
 * Tests Phase 56 — Réponses d'agent affichées en entier
 *
 * 1. app.js — _appendAgentMessage rend le texte complet (aucun repli)
 * 2. styles.css — plus de bouton de dépliage
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

function agentBlock() {
  const idx  = src.indexOf('function _appendAgentMessage');
  assert.ok(idx !== -1, '_appendAgentMessage introuvable dans app.js');
  const next = src.indexOf('\n  function', idx + 10);
  return src.slice(idx, next === -1 ? idx + 4000 : next);
}

const block = agentBlock();

describe('app.js — réponse affichée en entier', () => {
  it('aucune troncature du corps du message', () => {
    assert.ok(!block.includes('_splitSummary'), '_splitSummary ne doit plus être appelé');
    assert.ok(!block.includes('SUMMARY_MAX_LINES'), 'budget de lignes supprimé');
    assert.ok(!block.includes('SUMMARY_MAX_CHARS'), 'budget de caractères supprimé');
  });

  it('le texte complet est rendu en markdown', () => {
    assert.ok(block.includes('_renderMarkdown(mainText)'), 'rendu du texte intégral');
  });

  it('aucun bouton de repli ni de dépliage', () => {
    assert.ok(!block.includes("className = 'msg-more'"), 'bouton de dépliage retiré');
    assert.ok(!block.includes('Afficher tout'), 'libellé de dépliage retiré');
    assert.ok(!block.includes('Réduire'), 'libellé de repli retiré');
  });

  it('le corps du message est isolé dans .msg-body', () => {
    assert.ok(block.includes("className = 'msg-body'"), 'container .msg-body requis');
  });

  it('le bouton Copier copie le texte intégral', () => {
    assert.ok(block.includes('clipboard.writeText(text)'), 'copie du texte complet');
  });

  it('les helpers de troncature ont disparu du module', () => {
    assert.ok(!src.includes('function _splitSummary'), '_splitSummary supprimé');
    assert.ok(!src.includes('function _isSectionStart'), '_isSectionStart supprimé');
  });
});

describe('styles.css — plus de bouton de dépliage', () => {
  it('.msg-more n\'est plus défini', () => {
    assert.ok(!css.includes('.msg-more'), 'style du bouton supprimé');
  });

  it('.msg-body existe toujours', () => {
    assert.ok(css.includes('.msg-body'), 'container du corps');
  });
});
