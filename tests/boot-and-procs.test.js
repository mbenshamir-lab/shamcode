'use strict';

/**
 * Régression — démarrage de l'UI et panneau Processus.
 *
 * 1. Le thème doit être posé AVANT la feuille de styles (sinon flash sombre).
 * 2. Les préférences de panneaux (repli, largeurs) doivent être persistées.
 * 3. Le bouton « Arrêter » du panneau Processus doit appeler un vrai IPC
 *    (il se contentait auparavant d'afficher « … » sans rien arrêter).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const html    = read('src/renderer-visible/index.html');
const app     = read('src/renderer-visible/app.js');
const preload = read('src/main/preload.js');
const ipc     = read('src/main/ipc.js');
const windows = read('src/main/windows.js');

test('le thème est appliqué avant la feuille de styles (pas de flash)', () => {
  const scriptIdx = html.indexOf('__shamBoot');
  const cssIdx    = html.indexOf('<link rel="stylesheet"');
  assert.ok(scriptIdx !== -1, 'script de thème absent de index.html');
  assert.ok(cssIdx    !== -1, 'feuille de styles introuvable');
  assert.ok(scriptIdx < cssIdx, 'le script de thème doit précéder la feuille de styles');
  assert.ok(html.includes("setAttribute('data-theme'"), 'data-theme non posé au démarrage');
});

test('main transmet le thème au renderer via le preload', () => {
  assert.ok(windows.includes('--sham-theme='), 'argument de démarrage absent');
  assert.ok(preload.includes("'__shamBoot'"), 'pont __shamBoot absent du preload');
});

test('les préférences de panneaux sont persistées', () => {
  assert.ok(app.includes("'sham.ui.prefs'"), 'clé de préférences absente');
  assert.ok(app.includes('_loadUiPrefs()'), 'lecture des préférences absente');
  assert.ok(app.includes("prefKey: 'sidebarWidth'"), 'largeur sidebar non persistée');
  assert.ok(app.includes("prefKey: 'tpWidth'"), 'largeur task panel non persistée');
});

test('le panneau Processus arrête réellement un processus', () => {
  assert.ok(ipc.includes('PROCS_IPC.STOP'), 'canal procs:stop non enregistré');
  assert.ok(ipc.includes('stopProcessRun'), 'stopProcess du harness non branché');
  assert.ok(preload.includes('stopProcess:'), 'stopProcess non exposé au renderer');
  assert.ok(app.includes('window.harness.stopProcess('), "le bouton n'appelle pas le pont");
});

test('après un Stop, les cartes en attente sont neutralisées', () => {
  assert.ok(app.includes('function _cancelPendingCards'), 'neutralisation absente');
  assert.ok(app.includes('_cancelPendingCards();'), 'neutralisation non appelée');
});
