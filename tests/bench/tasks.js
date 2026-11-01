/**
 * Tâches du benchmark sur vrais modèles.
 *
 * Chaque tâche porte :
 *   seed(files)   défaut injecté dans une copie du projet (optionnel)
 *   task          consigne, formulée comme le ferait un utilisateur
 *   verify(ctx)   vérifications objectives, par exécution du code : jamais la parole de l'agent
 *   solve(ctx)    solution de référence : l'auto-contrôle prouve que verify échoue sur le
 *                 projet intact et réussit sur cette solution
 *   answer        réponse donnée si l'agent appelle ask_user
 *
 * Plusieurs tâches reproduisent une situation où le harness a déjà été pris en défaut :
 * échec visible seulement dans la sortie des tests, `'$'` dans du code, fences dans un
 * contenu, fichier plus long que la troncature.
 */

'use strict';

const replaceIn = (files, file, from, to) => {
  if (!files[file].includes(from)) throw new Error(`SEED_INTROUVABLE: ${file}`);
  files[file] = files[file].replace(from, () => to);
};

const edit = (ctx, file, from, to) => ctx.write(file, ctx.read(file).replace(from, () => to));

const INVENTORY_BUG = 'stock[sku] = (stock[sku] ?? 0) + qty;';
const OLD_DISCOUNT  = 'return total >= 100 ? total * 0.1 : 0;';
const OLD_PRICE     = 'return product ? product.price : null;';

const TASKS = [
  // ── Corrections ───────────────────────────────────────────────────────────
  {
    id: 'bug-from-tests',
    category: 'bug',
    seed: f => replaceIn(f, 'src/inventory.js', INVENTORY_BUG, 'stock[sku] = (stock[sku] ?? 0) - qty;'),
    task: 'npm test échoue. Trouve la cause et corrige le code, sans modifier les tests.',
    verify: c => [
      ['suite de tests verte', c.tests()],
      ['tests non modifiés', c.unchanged('tests/inventory.test.js')],
      ['comportement corrigé', c.node("const s={A:1};require('./src/inventory').release(s,'A',4);require('assert').equal(s.A,5)")],
    ],
    solve: c => edit(c, 'src/inventory.js', '?? 0) - qty', '?? 0) + qty'),
  },
  {
    id: 'bug-described',
    category: 'bug',
    seed: f => replaceIn(f, 'src/pricing.js', OLD_DISCOUNT, 'return total > 100 ? total * 0.1 : 0;'),
    task: 'Un client à exactement 100 € d\'achat n\'obtient pas sa remise de 10 %. Corrige ce bug.',
    verify: c => [
      ['seuil inclus', c.node("require('assert').equal(require('./src/pricing').discount(100),10)")],
      ['sous le seuil inchangé', c.node("require('assert').equal(require('./src/pricing').discount(99),0)")],
      ['suite de tests verte', c.tests()],
    ],
    solve: c => edit(c, 'src/pricing.js', 'total > 100', 'total >= 100'),
  },
  {
    id: 'bug-long-file',
    category: 'bug',
    seed: f => replaceIn(f, 'src/catalog.js', OLD_PRICE, 'return product ? product.price * 10 : null;'),
    task: 'priceOf(\'SKU-0350\') renvoie 350 au lieu de 35. Corrige le bug sans toucher aux données du catalogue.',
    verify: c => [
      ['prix corrigé', c.node("require('assert').equal(require('./src/catalog').priceOf('SKU-0350'),35)")],
      ['catalogue complet', c.node("require('assert').equal(require('./src/catalog').CATALOG.length,400)")],
    ],
    solve: c => edit(c, 'src/catalog.js', 'product.price * 10', 'product.price'),
  },

  // ── Fonctionnalités ───────────────────────────────────────────────────────
  {
    id: 'feature-coupon',
    category: 'feature',
    task: 'Ajoute et exporte applyCoupon(total, code) dans src/pricing.js : BIENVENUE retire 15 %, VIP retire 25 %, '
        + 'tout autre code lève une Error dont le message est COUPON_INCONNU.',
    verify: c => [
      ['BIENVENUE', c.node("require('assert').equal(require('./src/pricing').applyCoupon(100,'BIENVENUE'),85)")],
      ['VIP', c.node("require('assert').equal(require('./src/pricing').applyCoupon(100,'VIP'),75)")],
      ['code inconnu', c.node("require('assert').throws(()=>require('./src/pricing').applyCoupon(100,'X'),/COUPON_INCONNU/)")],
      ['existant préservé', c.tests()],
    ],
    solve: c => edit(c, 'src/pricing.js', 'module.exports = { discount, withVat };',
      "function applyCoupon(total, code) {\n  const rates = { BIENVENUE: 0.15, VIP: 0.25 };\n  if (!(code in rates)) throw new Error('COUPON_INCONNU');\n  return total * (1 - rates[code]);\n}\n\nmodule.exports = { discount, withVat, applyCoupon };"),
  },
  {
    id: 'feature-dollar',
    category: 'feature',
    task: "Ajoute dans src/format.js cette fonction, écrite exactement ainsi, et exporte-la : function formatUsd(value) { return '$' + value.toFixed(2); }",
    verify: c => [
      ['fonction correcte', c.node("require('assert').equal(require('./src/format').formatUsd(12.5),'$12.50')")],
      ['fichier non corrompu', (c.read('src/format.js').match(/function formatMoney/g) || []).length === 1],
      ['existant préservé', c.tests()],
    ],
    solve: c => edit(c, 'src/format.js', 'module.exports = { formatMoney };',
      "function formatUsd(value) { return '$' + value.toFixed(2); }\n\nmodule.exports = { formatMoney, formatUsd };"),
  },
  {
    id: 'feature-readme',
    category: 'feature',
    task: 'Ajoute à README.md une section "## Installation" avec un bloc de code bash contenant npm install, '
        + 'puis une section "## Tests" avec un bloc de code bash contenant npm test.',
    verify: c => [
      ['bloc installation', /## Installation[\s\S]*```bash\s+npm install\s+```/.test(c.read('README.md'))],
      ['bloc tests', /## Tests[\s\S]*```bash\s+npm test\s+```/.test(c.read('README.md'))],
      ['description préservée', c.read('README.md').includes('Mini-boutique en ligne')],
    ],
    solve: c => c.write('README.md', `${c.read('README.md')}\n## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Tests\n\n\`\`\`bash\nnpm test\n\`\`\`\n`),
  },

  // ── Refactorings ──────────────────────────────────────────────────────────
  {
    id: 'refactor-rename',
    category: 'refactor',
    task: 'Renomme computeTotal en cartTotal partout dans le projet, tests compris. Le comportement ne doit pas changer.',
    verify: c => [
      ['nouveau nom exporté', c.node("require('assert').equal(require('./src/cart').cartTotal([{unit:2,qty:3}]),6)")],
      ['ancien nom disparu', !['src/cart.js', 'src/orders.js', 'tests/cart.test.js'].some(f => c.read(f).includes('computeTotal'))],
      ['commande fonctionnelle', c.node("require('assert').equal(require('./src/orders').placeOrder([{sku:'A',unit:10,qty:1}],{A:1}).net,10)")],
      ['suite de tests verte', c.tests()],
    ],
    solve: (c) => {
      for (const f of ['src/cart.js', 'src/orders.js', 'tests/cart.test.js']) c.write(f, c.read(f).replaceAll('computeTotal', 'cartTotal'));
    },
  },
  {
    id: 'refactor-constant',
    category: 'refactor',
    task: 'Le taux de TVA 0.2 est répété dans plusieurs fichiers de src. Centralise-le dans une constante VAT_RATE '
        + 'exportée par un nouveau fichier src/constants.js, sans changer le comportement.',
    verify: c => [
      ['constante exportée', c.node("require('assert').equal(require('./src/constants').VAT_RATE,0.2)")],
      ['plus de valeur en dur', !['src/pricing.js', 'src/cart.js', 'src/orders.js'].some(f => c.read(f).includes('0.2'))],
      ['montants inchangés', c.node("const r=require('./src/orders').placeOrder([{sku:'A',unit:100,qty:1}],{A:1});require('assert').deepEqual([r.vat,r.gross],[20,120])")],
      ['suite de tests verte', c.tests()],
    ],
    solve: (c) => {
      c.write('src/constants.js', "'use strict';\n\nmodule.exports = { VAT_RATE: 0.2 };\n");
      edit(c, 'src/pricing.js', 'const VAT_RATE = 0.2;', "const { VAT_RATE } = require('./constants');");
      edit(c, 'src/cart.js', "'use strict';\n", "'use strict';\n\nconst { VAT_RATE } = require('./constants');\n");
      edit(c, 'src/cart.js', '* 0.2', '* VAT_RATE');
      edit(c, 'src/orders.js', "'use strict';\n", "'use strict';\n\nconst { VAT_RATE } = require('./constants');");
      c.write('src/orders.js', c.read('src/orders.js').replace('net * 0.2', 'net * VAT_RATE').replace('(1 + 0.2)', '(1 + VAT_RATE)'));
    },
  },

  // ── Lecture seule ─────────────────────────────────────────────────────────
  {
    id: 'read-locate',
    category: 'lecture',
    task: 'Dans quel fichier et quelle fonction le stock est-il décrémenté ? Réponds sans rien modifier.',
    verify: c => [
      ['fichier cité', /inventory\.js/.test(c.summary)],
      ['fonction citée', /reserve/.test(c.summary)],
      ['rien modifié', c.sourcesUntouched()],
    ],
    solve: (c) => { c.summary = 'src/inventory.js, fonction reserve'; },
  },
  {
    id: 'read-explain',
    category: 'lecture',
    task: 'Que se passe-t-il quand une commande demande plus que le stock disponible ? Cite le code d\'erreur exact. Ne modifie rien.',
    verify: c => [
      ['code d\'erreur cité', /STOCK_INSUFFISANT/.test(c.summary)],
      ['rien modifié', c.sourcesUntouched()],
    ],
    solve: (c) => { c.summary = 'reserve lève STOCK_INSUFFISANT'; },
  },

  // ── Demandes ambiguës ─────────────────────────────────────────────────────
  {
    id: 'ambiguous-delete',
    category: 'ambigu',
    task: 'Supprime l\'ancien module.',
    answer: 'Supprime src/legacy-shipping.js et garde src/legacy-tax.js.',
    verify: c => [
      ['question posée avant d\'agir', c.askedBefore('delete_file', 'write_file')],
      ['bon module supprimé', !c.exists('src/legacy-shipping.js')],
      ['autre module conservé', c.exists('src/legacy-tax.js')],
    ],
    solve: (c) => { c.remove('src/legacy-shipping.js'); c.tools.push('ask_user', 'delete_file'); },
  },
  {
    id: 'ambiguous-currency',
    category: 'ambigu',
    task: 'Change la devise par défaut de la boutique.',
    answer: 'Utilise USD.',
    verify: c => [
      ['question posée avant d\'agir', c.askedBefore('replace_code', 'write_file')],
      ['devise appliquée', c.node("require('assert').equal(require('./src/format').formatMoney(1),'1.00 USD')")],
    ],
    solve: (c) => { edit(c, 'src/format.js', "'EUR'", "'USD'"); c.tools.push('ask_user', 'replace_code'); },
  },
];

module.exports = { TASKS };
