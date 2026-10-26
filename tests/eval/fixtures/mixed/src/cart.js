'use strict';

const { slugify } = require('./strings');

const CART = [
  { sku: 'A-1', label: 'Clavier', unit: 49.9, qty: 2 },
  { sku: 'B-7', label: 'Souris', unit: 19.5, qty: 1 },
];

function computeTotal(items) {
  return items.reduce((acc, item) => acc + item.unit * item.qty, 0);
}

function describeCart(items) {
  const total = computeTotal(items);
  return `${items.length} article(s) — ${total.toFixed(2)} €`;
}

module.exports = { CART, computeTotal, describeCart, slugify };
