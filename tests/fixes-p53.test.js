/**
 * Tests Phase 53 — Toggle approbation rapide (btn-approval-toggle)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');

describe('approval-toggle — HTML', () => {
  it('bouton btn-approval-toggle présent dans la toolbar', () => {
    assert.ok(html.includes('id="btn-approval-toggle"'), 'Le bouton doit exister');
  });

  it('bouton a la classe approval-on par défaut', () => {
    assert.ok(html.includes('approval-on'), 'Doit démarrer en mode validation activée');
  });

  it('label approval-toggle-label présent', () => {
    assert.ok(html.includes('id="approval-toggle-label"'), 'Le label doit exister');
  });
});

describe('approval-toggle — CSS', () => {
  it('.btn-approval-toggle défini', () => {
    assert.ok(css.includes('.btn-approval-toggle'), 'Le style doit exister');
  });

  it('.approval-on avec couleur warning', () => {
    assert.ok(css.includes('.btn-approval-toggle.approval-on'), 'État approval-on doit être stylé');
  });

  it('.approval-off avec couleur success', () => {
    assert.ok(css.includes('.btn-approval-toggle.approval-off'), 'État approval-off doit être stylé');
  });
});

describe('approval-toggle — app.js', () => {
  it('btnApprovalToggle référencé', () => {
    assert.ok(appJs.includes("getElementById('btn-approval-toggle')"), 'Référence DOM requise');
  });

  it('_refreshApprovalToggle définie', () => {
    assert.ok(appJs.includes('function _refreshApprovalToggle'), 'Fonction de refresh requise');
  });

  it('toggle inverse approvalMode', () => {
    assert.ok(appJs.includes('approvalMode = !approvalMode'), 'Le click doit inverser la valeur');
  });

  it('setConfig appelé dans le handler click du toggle', () => {
    // Cherche le handler addEventListener click du toggle
    const idx = appJs.indexOf("btnApprovalToggle.addEventListener('click'");
    assert.ok(idx !== -1, 'Le handler click du toggle doit exister');
    // Cherche setConfig dans les 2000 chars qui suivent
    const block = appJs.slice(idx, idx + 2000);
    assert.ok(block.includes('setConfig'), 'La nouvelle valeur doit être persistée via setConfig');
  });

  it('_refreshApprovalToggle appelé au chargement config', () => {
    assert.ok(
      appJs.includes('_refreshApprovalToggle()'),
      '_refreshApprovalToggle doit être appelé après chargement config'
    );
  });
});

describe('config.js — approvalMode dans DEFAULTS', () => {
  const { DEFAULTS } = require('../src/main/config');

  it('approvalMode présent dans DEFAULTS', () => {
    assert.ok('approvalMode' in DEFAULTS, 'DEFAULTS doit contenir approvalMode');
  });

  it('approvalMode vaut false par défaut (auto-apply)', () => {
    assert.strictEqual(DEFAULTS.approvalMode, false, 'L\'auto-apply doit être activé par défaut');
  });
});
