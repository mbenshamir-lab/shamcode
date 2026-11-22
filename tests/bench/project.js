/**
 * Projet « boutique » commun aux tâches du benchmark.
 * Défini en code pour que chaque tâche parte d'un état identique, avec son défaut injecté
 * par simple remplacement de chaîne. La suite de tests du projet intact est verte.
 */

'use strict';

const CATALOG_SIZE = 400; // assez long pour dépasser la troncature de read_file

function _catalogFile() {
  const items = Array.from({ length: CATALOG_SIZE }, (_, i) => {
    const n = String(i + 1).padStart(4, '0');
    return `  { sku: 'SKU-${n}', label: 'Article numero ${n}', price: ${(i + 1) / 10} },`;
  });
  return [
    "'use strict';",
    '',
    '// Catalogue complet de la boutique.',
    'const CATALOG = [',
    ...items,
    '];',
    '',
    'function findBySku(sku) {',
    '  return CATALOG.find(p => p.sku === sku);',
    '}',
    '',
    'function priceOf(sku) {',
    '  const product = findBySku(sku);',
    '  return product ? product.price : null;',
    '}',
    '',
    'module.exports = { CATALOG, findBySku, priceOf };',
    '',
  ].join('\n');
}

const FILES = {
  'package.json': JSON.stringify({ name: 'boutique', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2),

  'README.md': '# Boutique\n\nMini-boutique en ligne : panier, prix, stock et commandes.\n',

  'src/pricing.js': `'use strict';

const VAT_RATE = 0.2;

// Remise de 10 % à partir de 100 € d'achat.
function discount(total) {
  return total >= 100 ? total * 0.1 : 0;
}

function withVat(amount) {
  return amount * (1 + VAT_RATE);
}

module.exports = { discount, withVat };
`,

  'src/cart.js': `'use strict';

function computeTotal(items) {
  return items.reduce((sum, item) => sum + item.unit * item.qty, 0);
}

function cartVat(items) {
  return computeTotal(items) * 0.2;
}

module.exports = { computeTotal, cartVat };
`,

  'src/orders.js': `'use strict';

const { computeTotal } = require('./cart');
const { reserve } = require('./inventory');

function placeOrder(items, stock) {
  for (const item of items) reserve(stock, item.sku, item.qty);
  const net = computeTotal(items);
  return { net, vat: net * 0.2, gross: net * (1 + 0.2) };
}

module.exports = { placeOrder };
`,

  'src/inventory.js': `'use strict';

function reserve(stock, sku, qty) {
  const available = stock[sku] ?? 0;
  if (available < qty) throw new Error('STOCK_INSUFFISANT');
  stock[sku] = available - qty;
}

function release(stock, sku, qty) {
  stock[sku] = (stock[sku] ?? 0) + qty;
}

module.exports = { reserve, release };
`,

  'src/format.js': `'use strict';

const DEFAULT_CURRENCY = 'EUR';

function formatMoney(value, currency = DEFAULT_CURRENCY) {
  return \`\${value.toFixed(2)} \${currency}\`;
}

module.exports = { formatMoney };
`,

  'src/catalog.js': _catalogFile(),

  'src/legacy-tax.js': `'use strict';

// Ancien calcul de taxe, conservé pour l'export comptable annuel.
function legacyTax(amount) {
  return amount * 0.196;
}

module.exports = { legacyTax };
`,

  'src/legacy-shipping.js': `'use strict';

// Ancien calcul de frais de port, plus appelé depuis la refonte.
function legacyShipping(weight) {
  return 4.9 + weight * 0.5;
}

module.exports = { legacyShipping };
`,

  'tests/pricing.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { discount, withVat } = require('../src/pricing');

test('remise sous le seuil', () => assert.equal(discount(50), 0));
test('remise au-dessus du seuil', () => assert.equal(discount(200), 20));
test('TVA', () => assert.equal(withVat(100), 120));
`,

  'tests/cart.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeTotal } = require('../src/cart');

test('total du panier', () => {
  assert.equal(computeTotal([{ unit: 10, qty: 2 }, { unit: 5, qty: 1 }]), 25);
});
`,

  'tests/inventory.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reserve, release } = require('../src/inventory');

test('réserver puis libérer rétablit le stock', () => {
  const stock = { A: 5 };
  reserve(stock, 'A', 2);
  release(stock, 'A', 2);
  assert.equal(stock.A, 5);
});

test('stock insuffisant', () => {
  assert.throws(() => reserve({ A: 1 }, 'A', 2), /STOCK_INSUFFISANT/);
});
`,

  'tests/format.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('../src/format');

test('montant à deux décimales suivi de la devise', () => assert.match(formatMoney(12.5), /^12\\.50 [A-Z]{3}$/));
`,
};

module.exports = { FILES };
