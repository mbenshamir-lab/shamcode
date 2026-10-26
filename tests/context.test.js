'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Extraire les fonctions pures du fichier renderer
const src = require('fs').readFileSync(
  require('path').join(__dirname, '../src/renderer-visible/app.js'),
  'utf8'
);

// Extraire _trunc
const truncMatch = src.match(/function _trunc\(s, max\) \{([\s\S]*?)\n  \}/);
assert.ok(truncMatch, '_trunc introuvable dans app.js');

// Extraire _buildTaskWithContext (dépend de _chatHistory, HISTORY_MAX, _trunc)
const ctxMatch = src.match(/function _buildTaskWithContext\(task\) \{([\s\S]*?)\n  \}/);
assert.ok(ctxMatch, '_buildTaskWithContext introuvable dans app.js');

// Construire un module isolé avec les constantes et les deux fonctions
const HISTORY_USER_MAX  = 400;
const HISTORY_AGENT_MAX = 600;

const moduleCode = `
  const HISTORY_USER_MAX  = ${HISTORY_USER_MAX};
  const HISTORY_AGENT_MAX = ${HISTORY_AGENT_MAX};

  function _trunc(s, max) {
    ${truncMatch[1]}
  }

  // Simuler les variables externes — on les passe en param via une factory
  function makeCtxBuilder(chatHistory) {
    const _chatHistory = chatHistory;
    return function _buildTaskWithContext(task) {
      ${ctxMatch[1]}
    };
  }

  module.exports = { _trunc, makeCtxBuilder };
`;
const m = new module.constructor();
m._compile(moduleCode, 'context-extract.js');
const { _trunc, makeCtxBuilder } = m.exports;

describe('_trunc', () => {

  it('retourne la chaîne inchangée si sous la limite', () => {
    assert.equal(_trunc('hello', 10), 'hello');
  });

  it('tronque et ajoute … si au-dessus de la limite', () => {
    const out = _trunc('abcdef', 4);
    assert.equal(out, 'abcd…');
  });

  it('limite exacte → pas de troncature', () => {
    assert.equal(_trunc('abcd', 4), 'abcd');
  });

  it('chaîne vide → chaîne vide', () => {
    assert.equal(_trunc('', 10), '');
  });

});

describe('_buildTaskWithContext', () => {

  it('historique vide → retourne la tâche telle quelle', () => {
    const build = makeCtxBuilder([]);
    assert.equal(build('ma tâche'), 'ma tâche');
  });

  it('1 échange → préfixe le contexte', () => {
    const build = makeCtxBuilder([{ user: 'question 1', agent: 'réponse 1' }]);
    const out = build('ma tâche');
    assert.ok(out.includes('CONTEXTE'), 'doit avoir le préfixe CONTEXTE');
    assert.ok(out.includes('question 1'), 'doit inclure la question précédente');
    assert.ok(out.includes('réponse 1'), 'doit inclure la réponse précédente');
    assert.ok(out.includes('TÂCHE ACTUELLE'), 'doit avoir le marqueur TÂCHE ACTUELLE');
    assert.ok(out.endsWith('ma tâche'), 'la tâche courante doit être à la fin');
  });

  it('3 échanges → tous inclus', () => {
    const history = [
      { user: 'q1', agent: 'a1' },
      { user: 'q2', agent: 'a2' },
      { user: 'q3', agent: 'a3' },
    ];
    const build = makeCtxBuilder(history);
    const out = build('nouvelle tâche');
    assert.ok(out.includes('Échange 1'), 'échange 1 présent');
    assert.ok(out.includes('Échange 3'), 'échange 3 présent');
    assert.ok(out.includes('q1') && out.includes('a3'), 'tout le contenu présent');
  });

  it('tronque les messages trop longs', () => {
    const longUser  = 'u'.repeat(500);
    const longAgent = 'a'.repeat(700);
    const build = makeCtxBuilder([{ user: longUser, agent: longAgent }]);
    const out = build('tâche');
    // Les textes doivent être tronqués à HISTORY_USER_MAX / HISTORY_AGENT_MAX
    const userPart  = out.match(/Utilisateur : (u+…?)/)?.[1] || '';
    const agentPart = out.match(/Agent : (a+…?)/)?.[1] || '';
    assert.ok(userPart.length  <= HISTORY_USER_MAX  + 1, 'user tronqué');
    assert.ok(agentPart.length <= HISTORY_AGENT_MAX + 1, 'agent tronqué');
  });

  it('ne modifie pas la tâche originale (pure function)', () => {
    const history = [{ user: 'old', agent: 'answer' }];
    const build = makeCtxBuilder(history);
    const task = 'test task';
    build(task);
    assert.equal(task, 'test task', 'la tâche originale est inchangée');
  });

});
