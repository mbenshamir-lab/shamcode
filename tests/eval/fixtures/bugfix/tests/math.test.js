'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sum, average } = require('../src/math');

test('sum additionne tous les éléments', () => {
  assert.equal(sum([1, 2, 3]), 6);
});

test('average renvoie la moyenne', () => {
  assert.equal(average([2, 4]), 3);
});
