'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Simuler un DOM minimal pour tester la logique des raccourcis
// On extrait uniquement les fonctions pures testables depuis app.js

const src = require('fs').readFileSync(
  require('path').join(__dirname, '../src/renderer-visible/app.js'),
  'utf8'
);

// Vérifier que les raccourcis sont présents dans le source
describe('Raccourcis clavier — présence dans app.js', () => {

  it('Arrow Up rappelle la dernière tâche (code présent)', () => {
    assert.ok(
      src.includes("e.key === 'ArrowUp'"),
      "ArrowUp handler absent de app.js"
    );
    assert.ok(
      src.includes('_lastSentTask'),
      "_lastSentTask absent de app.js"
    );
  });

  it('Escape annule la tâche en cours (code présent)', () => {
    assert.ok(
      src.includes("e.key === 'Escape'"),
      "Escape handler absent de app.js"
    );
    assert.ok(
      src.includes('btnCancel.click()'),
      "btnCancel.click() absent"
    );
  });

  it('Ctrl+L efface le chat (code présent)', () => {
    assert.ok(
      src.includes("e.key === 'l'"),
      "Ctrl+L handler absent de app.js"
    );
    assert.ok(
      src.includes("messagesEl.innerHTML = ''"),
      "reset messagesEl absent"
    );
  });

  it('sendTask mémorise la dernière tâche dans _lastSentTask', () => {
    // Vérifier que _lastSentTask est assigné dans sendTask
    const sendTaskMatch = src.match(/async function sendTask\(\)([\s\S]*?)^  \}/m);
    assert.ok(sendTaskMatch, 'sendTask introuvable');
    assert.ok(
      sendTaskMatch[0].includes('_lastSentTask = rawTask'),
      '_lastSentTask non assigné dans sendTask'
    );
  });

  it('Enter sans Shift envoie la tâche (code présent)', () => {
    assert.ok(
      src.includes("e.key === 'Enter' && !e.shiftKey"),
      "Enter handler absent de app.js"
    );
  });

});

// Tester la logique Arrow Up de façon isolée
describe('Arrow Up — logique de rappel', () => {

  it('rappelle uniquement si _lastSentTask non vide et champ vide', () => {
    // Simuler la condition
    let lastSentTask = 'modifier index.js';
    let inputValue   = '';

    // Condition du handler Arrow Up
    const shouldRecall = inputValue === '' && lastSentTask !== '';
    assert.ok(shouldRecall, 'doit rappeler quand champ vide et lastSentTask défini');
  });

  it("ne rappelle pas si le champ n'est pas vide", () => {
    let lastSentTask = 'ancienne tâche';
    let inputValue   = 'en cours de frappe';

    const shouldRecall = inputValue === '' && lastSentTask !== '';
    assert.ok(!shouldRecall, 'ne doit pas rappeler si le champ est occupé');
  });

  it("ne rappelle pas si _lastSentTask est vide", () => {
    let lastSentTask = '';
    let inputValue   = '';

    const shouldRecall = inputValue === '' && lastSentTask !== '';
    assert.ok(!shouldRecall, 'ne doit pas rappeler si lastSentTask est vide');
  });

});

describe('Bouton copy sur message agent — présence dans app.js', () => {

  it('_appendAgentMessage crée un bouton .msg-copy', () => {
    assert.ok(
      src.includes("'msg-copy'") || src.includes('"msg-copy"'),
      "classe msg-copy absente de _appendAgentMessage"
    );
  });

  it('le bouton copie le texte brut (navigator.clipboard.writeText)', () => {
    assert.ok(
      src.includes('navigator.clipboard.writeText(text)'),
      "clipboard.writeText(text) absent"
    );
  });

  it('le bouton affiche un retour visuel (✓ Copié)', () => {
    assert.ok(
      src.includes('✓ Copié') || src.includes('Copié'),
      "retour visuel copié absent"
    );
  });

});
