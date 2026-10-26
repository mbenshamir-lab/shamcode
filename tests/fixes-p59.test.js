/**
 * Tests Phase 59 — Chat sans blocs visibles
 *
 * Les réponses de l'agent, le flux en direct, le plan et le bandeau d'écriture
 * se posent directement dans le chat : plus de carte bordée par réponse.
 * La bulle utilisateur et l'alerte d'erreur restent distinctes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

/** Retourne le corps d'une règle CSS simple (sélecteur exact). */
function rule(selector) {
  const idx = css.indexOf(`${selector} {`);
  if (idx === -1) return null;
  return css.slice(idx, css.indexOf('}', idx));
}

describe('styles.css — plus de bloc autour des réponses', () => {
  it('.message-agent est transparent, sans bordure ni padding', () => {
    const r = rule('.message-agent');
    assert.ok(r, 'règle .message-agent requise');
    assert.ok(r.includes('background: none'), 'fond neutralisé');
    assert.ok(r.includes('border: none'), 'bordure retirée');
    assert.ok(r.includes('padding: 0'), 'padding retiré');
  });

  it('.message-agent occupe toute la largeur du chat', () => {
    const r = rule('.message-agent');
    assert.ok(r.includes('max-width: 100%'), 'plus de largeur de carte');
    assert.ok(r.includes('align-self: stretch'), 'aligné sur toute la largeur');
  });

  it('.message-streaming (flux en direct) est aussi à plat', () => {
    const r = rule('.message-streaming');
    assert.ok(r, 'règle .message-streaming requise');
    assert.ok(r.includes('background: none'), 'fond neutralisé');
    assert.ok(r.includes('border: none'), 'bordure retirée');
    assert.ok(r.includes('padding: 0'), 'padding retiré');
  });

  it('.chat-todo (plan) n\'est plus une carte', () => {
    const r = rule('.chat-todo');
    assert.ok(r, 'règle .chat-todo requise');
    assert.ok(r.includes('background: none'), 'fond neutralisé');
    assert.ok(r.includes('border: none'), 'bordure retirée');
  });

  it('la bulle utilisateur est neutralisée dans le chat (Phase 61)', () => {
    const r = rule('.message-user');
    assert.ok(r.includes('background: var(--accent-muted)'), 'style de base défini');
    assert.ok(css.includes('#chat-area .message-user'), 'neutralisé dans le chat');
  });

  it('l\'alerte d\'erreur est neutralisée dans le chat (Phase 61)', () => {
    const r = rule('.message-error');
    assert.ok(r.includes('background: var(--error-bg)'), 'style de base défini');
    assert.ok(css.includes('#chat-area .message-error'), 'neutralisée dans le chat');
  });

  it('aucune bordure ne subsiste sur les blocs de réponse', () => {
    for (const sel of ['.message-agent', '.message-streaming', '.chat-todo']) {
      assert.ok(!rule(sel).includes('border: 1px'), `${sel} ne doit plus dessiner de cadre`);
    }
  });
});
