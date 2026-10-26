/**
 * Tests Phase 69 — Barre d'outils adaptative (fin du chevauchement Stop/Envoyer)
 *
 * 1. HTML — libellés de mode isolés dans des spans (masquables)
 * 2. CSS — composer en container query : repli des libellés sous 560 px,
 *    commandes compactes, aucun débordement sur Stop/Envoyer
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');

// Section dédiée de la feuille (les règles y sont regroupées)
const adaptiveIdx = css.indexOf('BARRE D\'OUTILS ADAPTATIVE');
assert.ok(adaptiveIdx !== -1, 'section adaptative absente');
const adaptive = css.slice(adaptiveIdx);

function rule(selector) {
  const idx = adaptive.indexOf(`${selector} {`);
  if (idx === -1) return null;
  return adaptive.slice(idx, adaptive.indexOf('}', idx));
}

describe('index.html — libellés masquables', () => {
  it('les libellés Plan / Action sont dans des spans', () => {
    const count = (html.match(/class="mode-btn-label"/g) || []).length;
    assert.ok(count >= 2, 'au moins deux libellés de mode attendus');
  });

  it('le libellé de validation reste une span', () => {
    assert.ok(html.includes('id="approval-toggle-label"'), 'span de validation');
  });
});

describe('styles.css — composer adaptatif', () => {
  it('le composer est une container query', () => {
    const r = rule('#input-wrapper');
    assert.ok(r.includes('container-type: inline-size'), 'container-type requis');
  });

  it('la barre et le groupe de gauche ne débordent pas', () => {
    // flex-wrap:nowrap empêche le saut de ligne — les libellés se masquent via container query
    assert.ok(rule('#input-toolbar').includes('flex-wrap: nowrap'), 'barre sans wrap');
    assert.ok(rule('.toolbar-left').includes('flex-wrap: nowrap'), 'groupe gauche sans wrap');
    assert.ok(rule('.toolbar-left').includes('min-width: 0'), 'flex shrink autorisé (empêche le débordement)');
  });

  it('les boutons de droite restent alignés à droite', () => {
    assert.ok(rule('.toolbar-right').includes('margin-left: auto'), 'poussés à droite');
  });

  it('le modèle ne pousse pas la barre (ellipsis)', () => {
    const r = rule('#model-pill-label');
    assert.ok(r.includes('text-overflow: ellipsis'), 'troncature');
    assert.ok(r.includes('white-space: nowrap'), 'une ligne');
  });

  it('sous 640 px : libellés masqués et contrôles compacts', () => {
    const idx = css.indexOf('@container (max-width: 640px)');
    assert.ok(idx !== -1, 'container query requise');
    const block = css.slice(idx, idx + 520);
    assert.ok(block.includes('.mode-btn-label { display: none; }'), 'mode en icônes');
    assert.ok(block.includes('#approval-toggle-label { display: none; }'), 'validation en icône');
  });
});
