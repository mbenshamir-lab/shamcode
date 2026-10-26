'use strict';
/**
 * Tests Phase 75 — Fenêtre Paramètres isolée (BrowserWindow) + fix thème.
 *
 * Vérifie :
 * 1. La fenêtre settings.html existe avec la structure attendue
 * 2. Le settings.js implémente l'optimistic update (_autoSave sans race condition)
 * 3. Le preload-settings.js expose settingsApi
 * 4. windows.js exporte openSettingsWindow
 * 5. ipc.js gère settings:open / settings:close / config:updated broadcast
 * 6. preload.js expose openSettings + onConfigUpdated
 * 7. app.js n'a plus le code settings inline (dialog supprimé)
 * 8. index.html n'a plus de <dialog id="settings-dialog">
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const settingsHtml   = fs.readFileSync(path.join(root, 'src/renderer-settings/settings.html'), 'utf8');
const settingsJs     = fs.readFileSync(path.join(root, 'src/renderer-settings/settings.js'),   'utf8');
const preloadSet     = fs.readFileSync(path.join(root, 'src/main/preload-settings.js'),         'utf8');
const windowsJs      = fs.readFileSync(path.join(root, 'src/main/windows.js'),                  'utf8');
const ipcJs          = fs.readFileSync(path.join(root, 'src/main/ipc.js'),                       'utf8');
const preloadJs      = fs.readFileSync(path.join(root, 'src/main/preload.js'),                   'utf8');
const appJs          = fs.readFileSync(path.join(root, 'src/renderer-visible/app.js'),           'utf8');
const indexHtml      = fs.readFileSync(path.join(root, 'src/renderer-visible/index.html'),       'utf8');
const constantsJs    = fs.readFileSync(path.join(root, 'src/shared/constants.js'),               'utf8');

// ── settings.html ─────────────────────────────────────────────────────────────
describe('Phase 75 — settings.html structure', () => {

  it('est un document HTML autonome (pas un <dialog>)', () => {
    assert.ok(settingsHtml.includes('<!DOCTYPE html>'), 'DOCTYPE manquant');
    assert.ok(!settingsHtml.includes('<dialog'), 'ne doit pas contenir <dialog>');
  });

  it('contient tous les onglets attendus', () => {
    assert.ok(settingsHtml.includes('data-tab="model"'),  'onglet Modèle absent');
    assert.ok(settingsHtml.includes('data-tab="agent"'),  'onglet Agent absent');
    assert.ok(settingsHtml.includes('data-tab="skills"'), 'onglet Skills absent');
    assert.ok(settingsHtml.includes('data-tab="mcp"'),    'onglet MCP absent');
    assert.ok(settingsHtml.includes('data-tab="themes"'), 'onglet Thèmes absent');
  });

  it('contient les panneaux de thèmes', () => {
    assert.ok(settingsHtml.includes('sm-theme-card'), 'sm-theme-card absent');
    assert.ok(settingsHtml.includes('sm-swatch'),     'sm-swatch absent');
    assert.ok(settingsHtml.includes('sm-font-card'),  'sm-font-card absent');
    assert.ok(settingsHtml.includes('sm-density-btn'),'sm-density-btn absent');
  });

  it('contient le libellé Mode validation (mode Plan)', () => {
    assert.ok(settingsHtml.includes('Mode validation (mode Plan)'), 'libellé absent');
    assert.ok(settingsHtml.includes('En mode Action, l\'agent est pleinement autorisé'), 'hint absent');
  });

  it('contient btn-sw-close pour fermer la fenêtre', () => {
    assert.ok(settingsHtml.includes('btn-sw-close'), 'btn-sw-close absent');
  });

  it('lie styles.css via chemin relatif', () => {
    assert.ok(settingsHtml.includes('../renderer-visible/styles.css'), 'lien CSS absent');
  });

  it('charge settings.js', () => {
    assert.ok(settingsHtml.includes('settings.js'), 'script settings.js absent');
  });
});

// ── settings.js — correctif race condition ────────────────────────────────────
describe('Phase 75 — settings.js : autoSave optimiste', () => {

  it('utilise window.settingsApi (pas window.harness)', () => {
    assert.ok(settingsJs.includes('window.settingsApi'), 'settingsApi absent');
    assert.ok(!settingsJs.includes('window.harness'), 'window.harness ne doit pas être utilisé dans settings.js');
  });

  it('_autoSave met à jour currentConfig AVANT l\'await (optimistic update)', () => {
    const idx = settingsJs.indexOf('function _autoSave');
    assert.ok(idx !== -1, '_autoSave absent');
    // La zone de recherche couvre tout le corps de la fonction (queue + then callback)
    const body = settingsJs.slice(idx, idx + 800);
    // Object.assign(currentConfig) doit précéder le chaînage async (then / await)
    const assignIdx = body.indexOf('Object.assign(currentConfig');
    const awaitIdx  = body.indexOf('await window.settingsApi.setConfig');
    assert.ok(assignIdx !== -1, 'Object.assign(currentConfig) absent');
    assert.ok(awaitIdx  !== -1, 'await settingsApi.setConfig absent dans le then');
    assert.ok(assignIdx < awaitIdx, 'update optimiste doit précéder l\'await');
  });

  it('_applyVisualSettings est défini dans settings.js', () => {
    assert.ok(settingsJs.includes('function _applyVisualSettings'), '_applyVisualSettings absent');
  });

  it('handlers thèmes appellent _autoSave sans race (direct puis save)', () => {
    assert.ok(settingsJs.includes('data-theme'), 'data-theme absent');
    assert.ok(settingsJs.includes('_autoSave({ theme'), '_autoSave thème absent');
  });
});

// ── preload-settings.js ───────────────────────────────────────────────────────
describe('Phase 75 — preload-settings.js', () => {

  it('expose settingsApi via contextBridge', () => {
    assert.ok(preloadSet.includes('settingsApi'), 'settingsApi absent');
    assert.ok(preloadSet.includes('contextBridge'), 'contextBridge absent');
  });

  it('expose getConfig, setConfig, testEngine, selectFolder, closeWindow', () => {
    assert.ok(preloadSet.includes('getConfig'),    'getConfig absent');
    assert.ok(preloadSet.includes('setConfig'),    'setConfig absent');
    assert.ok(preloadSet.includes('testEngine'),   'testEngine absent');
    assert.ok(preloadSet.includes('selectFolder'), 'selectFolder absent');
    assert.ok(preloadSet.includes('closeWindow'),  'closeWindow absent');
  });
});

// ── windows.js ────────────────────────────────────────────────────────────────
describe('Phase 75 — windows.js : fenêtre settings isolée', () => {

  it('exporte openSettingsWindow', () => {
    assert.ok(windowsJs.includes('openSettingsWindow'), 'openSettingsWindow absent');
    assert.ok(windowsJs.includes('module.exports') && windowsJs.includes('openSettingsWindow'), 'non exporté');
  });

  it('crée une BrowserWindow avec frame: false', () => {
    assert.ok(windowsJs.includes('frame: false'), 'frame: false absent');
  });

  it('charge preload-settings.js', () => {
    assert.ok(windowsJs.includes('preload-settings.js'), 'preload-settings.js absent');
  });

  it('charge settings.html', () => {
    assert.ok(windowsJs.includes('settings.html'), 'settings.html absent');
  });
});

// ── ipc.js ────────────────────────────────────────────────────────────────────
describe('Phase 75 — ipc.js : handlers settings + broadcast', () => {

  it('gère SETTINGS_OPEN', () => {
    assert.ok(ipcJs.includes('SETTINGS_OPEN') || ipcJs.includes('settings:open'), 'SETTINGS_OPEN absent');
    assert.ok(ipcJs.includes('openSettingsWindow'), 'openSettingsWindow non appelé');
  });

  it('gère SETTINGS_CLOSE', () => {
    assert.ok(ipcJs.includes('SETTINGS_CLOSE') || ipcJs.includes('settings:close'), 'SETTINGS_CLOSE absent');
  });

  it('broadcast config:updated après CONFIG_SET', () => {
    const idx = ipcJs.indexOf('CONFIG_SET') !== -1
      ? ipcJs.indexOf('CONFIG_SET')
      : ipcJs.indexOf("'config:set'");
    assert.ok(idx !== -1, 'CONFIG_SET absent');
    // Fenêtre élargie (600 → 1100) : le handler CONFIG_SET réinitialise aussi
    // `model.activeProvider` quand le moteur principal change (fournisseur
    // secondaire de la pastille), ce qui éloigne le broadcast du marqueur.
    const block = ipcJs.slice(idx, idx + 1100);
    assert.ok(
      block.includes('CONFIG_UPDATED') || block.includes('config:updated'),
      'broadcast config:updated absent'
    );
  });
});

// ── preload.js ────────────────────────────────────────────────────────────────
describe('Phase 75 — preload.js : openSettings + onConfigUpdated', () => {

  it('expose openSettings', () => {
    assert.ok(preloadJs.includes('openSettings'), 'openSettings absent');
  });

  it('expose onConfigUpdated', () => {
    assert.ok(preloadJs.includes('onConfigUpdated'), 'onConfigUpdated absent');
  });
});

// ── app.js ────────────────────────────────────────────────────────────────────
describe('Phase 75 — app.js : plus de code settings inline', () => {

  it('n\'a plus de settingsDialog (BrowserWindow à la place)', () => {
    assert.ok(!appJs.includes("document.getElementById('settings-dialog')"), 'settings-dialog référencé dans app.js');
    assert.ok(!appJs.includes('settingsDialog.showModal()'), 'showModal() présent dans app.js');
  });

  it('appelle window.harness.openSettings() pour ouvrir les paramètres', () => {
    assert.ok(appJs.includes('window.harness.openSettings()'), 'openSettings() absent de app.js');
  });

  it('écoute onConfigUpdated pour synchroniser le thème', () => {
    assert.ok(appJs.includes('onConfigUpdated'), 'onConfigUpdated absent de app.js');
    assert.ok(appJs.includes('_applyVisualSettings'), '_applyVisualSettings absent de app.js');
  });

  it('conserve _renderSidebarRules (règles dans la sidebar)', () => {
    assert.ok(appJs.includes('_renderSidebarRules'), '_renderSidebarRules absent');
  });
});

// ── index.html ────────────────────────────────────────────────────────────────
describe('Phase 75 — index.html : dialog settings supprimé', () => {

  it('n\'a plus de <dialog id="settings-dialog">', () => {
    assert.ok(!indexHtml.includes('settings-dialog'), '<dialog settings-dialog> doit être absent');
  });

  it('sidebar-profile ouvre les paramètres (btn-settings supprimé)', () => {
    assert.ok(indexHtml.includes('sidebar-profile'), 'sidebar-profile absent');
    assert.ok(!indexHtml.includes('btn-settings'), 'btn-settings ne doit plus être présent');
  });

  it('conserve le dialog sessions (non affecté)', () => {
    assert.ok(indexHtml.includes('sessions-dialog'), 'sessions-dialog absent');
  });
});

// ── constants.js ─────────────────────────────────────────────────────────────
describe('Phase 75 — constants.js : nouvelles constantes IPC', () => {

  it('déclare SETTINGS_OPEN', () => {
    assert.ok(constantsJs.includes('SETTINGS_OPEN'), 'SETTINGS_OPEN absent');
  });

  it('déclare SETTINGS_CLOSE', () => {
    assert.ok(constantsJs.includes('SETTINGS_CLOSE'), 'SETTINGS_CLOSE absent');
  });

  it('déclare CONFIG_UPDATED', () => {
    assert.ok(constantsJs.includes('CONFIG_UPDATED'), 'CONFIG_UPDATED absent');
  });
});
