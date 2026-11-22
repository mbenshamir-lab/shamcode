'use strict';

/**
 * Carte objectif (ADR-031). Le moteur d'objectifs décide de la fin de tâche :
 * ses critères doivent être visibles dans le fil, sinon l'utilisateur voit
 * l'agent s'arrêter sans comprendre. L'IHM n'a pas de DOM de test ici : on
 * verrouille le câblage et les styles par lecture de source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'src/renderer-visible/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'src/renderer-visible/styles.css'), 'utf8');

test('carte objectif — les événements du moteur sont écoutés', () => {
  for (const type of [
    'goal_created', 'goal_blocked', 'goal_done',
    'goal_budget_warning', 'goal_finish_rejected',
  ]) {
    assert.ok(APP.includes(`event.type === '${type}'`), `${type} non écouté dans app.js`);
  }
});

test('carte objectif — mise à jour depuis le résultat de l\'outil goal', () => {
  assert.ok(APP.includes('function _renderGoalCard'),
    '_renderGoalCard absente');
  assert.ok(APP.includes('if (event.result.goal) _renderGoalCard(event.result.goal)'),
    'les actions goal ne rafraîchissent pas la carte');
});

test('carte objectif — le texte du modèle est échappé', () => {
  assert.ok(APP.includes('_escHtml(c.text'), 'texte de critère non échappé');
  assert.ok(APP.includes('_escHtml(c.verify?.kind'), 'type de vérification non échappé');
});

test('carte objectif — styles tokenisés, aucun px en dur', () => {
  const start = CSS.indexOf('.goal-card {');
  assert.ok(start !== -1, '.goal-card absente de styles.css');
  const block = CSS.slice(start, start + 2600);

  assert.ok(block.includes('.goal-crit.met'), 'état « prouvé » non stylé');
  assert.ok(block.includes('.goal-card.blocked'), 'état « bloqué » non stylé');
  assert.ok(/font-size: var\(--text-/.test(block), 'tailles non tokenisées');
  assert.ok(!/font-size:\s*\d+px/.test(block), 'px en dur interdit (tokens --text-*)');
});
