'use strict';

// Le trimmer est le garde-fou du budget de contexte : quand il coupe, il doit le dire
// au modèle (marqueur explicite) et ne jamais dépasser le budget.

const test = require('node:test');
const assert = require('node:assert/strict');

const { trimToBudget } = require('../src/harness/context/trimmer');

test('trimmer — budget 0 → chaîne vide', () => {
  assert.equal(trimToBudget([{ type: 'rag', content: 'abc' }], 0), '');
});

test('trimmer — sections qui tiennent : tout est conservé, sans marqueur', () => {
  const out = trimToBudget([
    { type: 'rag', content: 'RAG court' },
    { type: 'tree', content: 'ARBRE court' },
  ], 2000);
  assert.ok(out.includes('RAG court'));
  assert.ok(out.includes('ARBRE court'));
  assert.ok(!out.includes('tronqué'));
});

test('trimmer — dépassement : marqueur explicite et budget respecté', () => {
  const out = trimToBudget([
    { type: 'rag', content: 'x'.repeat(5000) },
    { type: 'tree', content: 'y'.repeat(5000) },
  ], 600);
  assert.ok(out.includes('tronqué'), 'le modèle doit savoir que le contexte est coupé');
  assert.ok(out.length <= 600, `budget dépassé : ${out.length}`);
});

test('trimmer — sections vides ignorées', () => {
  const out = trimToBudget([
    { type: 'rag', content: '   ' },
    { type: 'tree', content: 'visible' },
  ], 500);
  assert.equal(out, 'visible');
});
