/**
 * Tests Phase 54 — Mode Action = pleine autorisation (zéro validation)
 *
 * Règle : en mode Action l'agent écrit sans demander d'accord. La validation
 * utilisateur ne s'applique qu'au mode Plan.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const { approvalRequired } = require('../src/shared/approval');

const ipcJs   = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
const appJs   = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const html    = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
// Settings dialog est dans la fenêtre isolée (Phase 75)
const settingsHtml = fs.existsSync(path.join(__dirname, '../src/renderer-settings/settings.html'))
  ? fs.readFileSync(path.join(__dirname, '../src/renderer-settings/settings.html'), 'utf8')
  : html;
const css     = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

describe('approvalRequired — règle de validation', () => {
  it('mode Action (planMode false) → aucune validation', () => {
    assert.equal(approvalRequired({ planMode: false, approvalMode: true }), false);
  });

  it('planMode absent → aucune validation (Action par défaut)', () => {
    assert.equal(approvalRequired({ approvalMode: true, configApprovalMode: true }), false);
  });

  it('mode Plan + validation activée → validation demandée', () => {
    assert.equal(approvalRequired({ planMode: true, approvalMode: true }), true);
  });

  it('mode Plan + auto-apply → validation non demandée', () => {
    assert.equal(approvalRequired({ planMode: true, approvalMode: false }), false);
  });

  it('mode Plan + choix absent → repli sur la config persistée (true)', () => {
    assert.equal(approvalRequired({ planMode: true, configApprovalMode: true }), true);
  });

  it('mode Plan + choix absent → repli sur la config persistée (false)', () => {
    assert.equal(approvalRequired({ planMode: true, configApprovalMode: false }), false);
  });

  it('mode Plan + rien → validation par défaut (jamais d\'écriture silencieuse)', () => {
    assert.equal(approvalRequired({ planMode: true }), true);
  });

  it('le toggle n\'a aucun effet en mode Action', () => {
    assert.equal(approvalRequired({ planMode: false, approvalMode: true }), false);
    assert.equal(approvalRequired({ planMode: false, approvalMode: false }), false);
  });

  it('planMode strictement true est requis pour valider', () => {
    assert.equal(approvalRequired({ planMode: 'true', approvalMode: true }), false);
  });

  it('appel sans argument → aucune validation', () => {
    assert.equal(approvalRequired(), false);
  });
});

describe('ipc.js — gating appliqué côté main process', () => {
  it('importe la règle partagée', () => {
    assert.ok(ipcJs.includes("require('../shared/approval')"), 'approval.js doit être importé');
  });

  it('useApproval passe par approvalRequired avec planMode', () => {
    const idx = ipcJs.indexOf('const useApproval');
    assert.ok(idx !== -1, 'useApproval doit être défini');
    const block = ipcJs.slice(idx, idx + 260);
    assert.ok(block.includes('approvalRequired('), 'useApproval doit utiliser approvalRequired');
    assert.ok(block.includes('planMode'), 'planMode doit être transmis');
  });

  it('plus de fallback permissif approvalMode ?? config.approvalMode ?? true', () => {
    assert.ok(
      !ipcJs.includes('const useApproval = approvalMode ?? config.approvalMode ?? true'),
      'L\'ancienne règle (validation en mode Action) doit être supprimée',
    );
  });
});

describe('app.js — UI du toggle en mode Action', () => {
  it('_approvalApplies défini', () => {
    assert.ok(appJs.includes('function _approvalApplies'), '_approvalApplies requis');
  });

  it('_effectiveApprovalMode défini', () => {
    assert.ok(appJs.includes('function _effectiveApprovalMode'), '_effectiveApprovalMode requis');
  });

  it('_effectiveApprovalMode renvoie false hors mode Plan', () => {
    const idx = appJs.indexOf('function _effectiveApprovalMode');
    const body = appJs.slice(idx, idx + 260);
    assert.ok(body.includes('_approvalApplies() ? approvalMode : false'), 'Action → false');
  });

  it('sendTask envoie la valeur effective et non le toggle brut', () => {
    const idx = appJs.indexOf('runAgent({ task, projectRoot');
    assert.ok(idx !== -1, 'appel runAgent introuvable');
    const call = appJs.slice(idx, idx + 200);
    assert.ok(call.includes('approvalMode: approvalForRun'), 'approvalForRun doit être transmis');
    assert.ok(appJs.includes('const approvalForRun = _effectiveApprovalMode()'), 'calcul requis avant l\'appel');
  });

  it('le changement de mode rafraîchit le toggle', () => {
    const idx = appJs.indexOf('function _setMode');
    const body = appJs.slice(idx, idx + 420);
    assert.ok(body.includes('_refreshApprovalToggle()'), '_setMode doit rafraîchir le toggle');
  });

  it('le toggle est désactivé hors mode Plan', () => {
    const idx = appJs.indexOf('function _refreshApprovalToggle');
    const body = appJs.slice(idx, idx + 1400);
    assert.ok(body.includes('btnApprovalToggle.disabled = !applies'), 'disabled piloté par le mode');
    assert.ok(body.includes('approval-neutral'), 'classe visuelle neutralisée');
  });

  it('le click est ignoré en mode Action', () => {
    const idx = appJs.indexOf("btnApprovalToggle.addEventListener('click'");
    const body = appJs.slice(idx, idx + 300);
    assert.ok(body.includes('if (!_approvalApplies()) return;'), 'garde du handler');
  });

  it('le toggle met à jour currentConfig (anti-reset par _refreshStatusBar)', () => {
    const idx = appJs.indexOf("btnApprovalToggle.addEventListener('click'");
    const body = appJs.slice(idx, idx + 900);
    assert.ok(body.includes('currentConfig = { ...currentConfig, approvalMode }'), 'snapshot local à synchroniser');
  });

  it('mode Action reste le mode par défaut', () => {
    assert.ok(appJs.includes("_setMode('action');"), 'Action par défaut');
  });
});

describe('index.html / styles.css — état neutralisé', () => {
  it('le toggle démarre désactivé (mode Action par défaut)', () => {
    const idx = html.indexOf('id="btn-approval-toggle"');
    const tag = html.slice(idx - 120, idx + 260);
    assert.ok(tag.includes('disabled'), 'attribut disabled requis');
  });

  it('le libellé des paramètres mentionne le mode Plan', () => {
    // Depuis Phase 75 : contenu dans la fenêtre settings isolée
    assert.ok(settingsHtml.includes('Mode validation (mode Plan)'), 'libellé clarifié');
    assert.ok(settingsHtml.includes('En mode Action, l\'agent est pleinement autorisé'), 'hint explicite');
  });

  it('CSS : état désactivé et classe neutral', () => {
    assert.ok(css.includes('.btn-approval-toggle:disabled'), 'style disabled requis');
    assert.ok(css.includes('.btn-approval-toggle.approval-neutral'), 'style approval-neutral requis');
  });
});
