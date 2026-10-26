/**
 * Tests Phase 61 — Chat principal à plat : plus aucune bordure ni fond de cadre
 *
 * Toutes les cartes du chat (messages, plan, approbation, sous-agent, hint,
 * code, chips, badges) sont neutralisées par un bloc de surcharge `#chat-area`
 * placé en fin de feuille de styles.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

/** Bloc de surcharge : du marqueur de section jusqu'à la section suivante. */
const idx = css.indexOf('CHAT PRINCIPAL — RENDU À PLAT');
assert.ok(idx !== -1, 'section de surcharge absente');
const nextSection = css.indexOf('FICHIERS DU PROJET', idx);
const override = css.slice(idx, nextSection === -1 ? undefined : nextSection);

describe('surcharge #chat-area — conteneurs', () => {
  const containers = [
    '.message', '.message-user', '.message-agent', '.message-info',
    '.message-error', '.message-streaming', '.ask-card', '.plan-card',
    '.approval-card', '.subagent-card', '.sham-hint', '.activity-info-line',
    '.chat-todo', '.code-block', '.cb-header', '.run-strip-diff',
  ];

  for (const sel of containers) {
    it(`${sel} est neutralisé`, () => {
      assert.ok(override.includes(`#chat-area ${sel}`), `sélecteur #chat-area ${sel} manquant`);
    });
  }

  it('les fonds sont supprimés', () => {
    assert.ok(override.includes('background: none'), 'background: none requis');
  });

  it('les bordures sont supprimées', () => {
    assert.ok(override.includes('border: none'), 'border: none requis');
  });

  it('les ombres sont supprimées', () => {
    assert.ok(override.includes('box-shadow: none'), 'box-shadow: none requis');
  });
});

describe('surcharge #chat-area — éléments internes', () => {
  const inner = [
    '.tf-chip', '.ask-chip', '.activity-step-badge', '.activity-retry',
    '.run-strip-count', '.subagent-role-badge', '.cb-lang', '.msg-copy',
  ];

  for (const sel of inner) {
    it(`${sel} n'a plus de cadre`, () => {
      assert.ok(override.includes(`#chat-area ${sel}`), `sélecteur #chat-area ${sel} manquant`);
    });
  }

  it('le code perd son fond et son encadré', () => {
    assert.ok(override.includes('#chat-area .message-agent code'), 'code inline');
    assert.ok(override.includes('#chat-area .code-block pre'), 'bloc de code');
  });
});

describe('surcharge — position et lisibilité', () => {
  it('la surcharge est appliquée en fin de feuille (après les cartes)', () => {
    const baseCard = css.indexOf('.approval-card {');
    assert.ok(baseCard !== -1, 'carte d\'approbation définie');
    assert.ok(idx > baseCard, 'la surcharge doit venir après les styles de carte');
  });

  it('la carte d\'erreur reste signalée par la couleur du texte', () => {
    assert.ok(override.includes('#chat-area .message-error { color: #ff9e9e; }'), 'couleur d\'erreur conservée');
  });

  it('les lignes de diff gardent leur coloration', () => {
    assert.ok(override.includes('.run-strip-diff .diff-line-add'), 'lignes ajoutées');
    assert.ok(override.includes('.run-strip-diff .diff-line-del'), 'lignes supprimées');
  });

  it('aucune bordure colorée ne subsiste dans la surcharge', () => {
    assert.ok(!/border(-left|-top|-bottom|-right)?:\s*\d/.test(override), 'aucune bordure numérique');
  });
});
