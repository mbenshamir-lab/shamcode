'use strict';

/**
 * Régression — durcissement de l'UI (audit UX).
 *
 * 1. Les rendus qui injectent des données (sessions, apps, pièces jointes,
 *    erreurs de modèle) doivent échapper le HTML.
 * 2. Workspaces et sessions sont utilisables au clavier.
 * 3. Les bandeaux d'écriture sont bornés et le fil est purgé au-delà d'un plafond.
 * 4. Un message d'erreur propose de relancer la dernière tâche.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/styles.css'), 'utf8');

test('le dialogue Sessions échappe la tâche de la session', () => {
  const hits = app.match(/_escHtml\(s\.task/g) || [];
  assert.ok(hits.length >= 2, 'la tâche doit être échappée dans la sidebar ET le dialogue');
});

test('le panneau Apps échappe le nom et l\'URL', () => {
  assert.ok(app.includes('title="${_escAttr(app.url)}"'), 'URL non échappée dans l\'attribut');
  assert.ok(app.includes('${_esc(app.name)}'), 'nom d\'app non échappé');
});

test('les pièces jointes échappent le nom de fichier', () => {
  const hits = app.match(/<span>\$\{_escHtml\(name\)\}<\/span>/g) || [];
  assert.equal(hits.length, 2, 'les deux chips (fichier et image) doivent échapper le nom');
});

test('workspaces et sessions sont accessibles au clavier', () => {
  assert.ok(app.includes("header.setAttribute('role', 'button')"), 'en-tête workspace non focusable');
  assert.ok(app.includes("header.setAttribute('aria-expanded'"), 'état du workspace non annoncé');
  assert.ok(app.includes("sItem.setAttribute('tabindex', '0')"), 'session non focusable');
});

test('les bandeaux d\'écriture sont bornés', () => {
  assert.ok(app.includes('st.entries.length > 50'), 'aucun plafond sur les entrées du bandeau');
  assert.ok(app.includes('run-strip-more'), 'les entrées écartées doivent être signalées');
  assert.ok(css.includes('.run-strip-more'), 'style de la mention manquant');
});

test('le fil est purgé au-delà du plafond', () => {
  assert.ok(app.includes('MAX_CHAT_MESSAGES'), 'plafond du fil absent');
  assert.ok(app.includes('function _pruneChat'), 'purge du fil absente');
  assert.ok(app.includes('_pruneChat();'), 'purge non appelée à l\'ajout');
});

test('un message d\'erreur propose de réessayer', () => {
  assert.ok(app.includes("'↻ Réessayer'"), 'bouton Réessayer absent');
  assert.ok(app.includes('error-action-secondary'), 'style secondaire absent');
  assert.ok(css.includes('.error-action-secondary'), 'règle CSS du bouton secondaire absente');
});
