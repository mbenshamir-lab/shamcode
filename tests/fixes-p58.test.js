/**
 * Tests Phase 58 — Ligne d'activité lisible : mot-clé coloré + adresse/indication
 *
 * 1. _TOOL_KEYWORDS / _toolDetail / _toolParts / _toolLabel (purs)
 * 2. app.js — rendu de la ligne d'activité (mot-clé + détail + spinner)
 * 3. styles.css — couleurs par famille + pulsation
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

function _extract(name, re) {
  const m = src.match(re);
  assert.ok(m, `${name} introuvable dans app.js`);
  return m[1];
}

const kwBody     = _extract('_TOOL_KEYWORDS', /const _TOOL_KEYWORDS = \{([\s\S]*?)\n  \};/);
const detailBody = _extract('_toolDetail', /function _toolDetail\(tool, args = \{\}\) \{([\s\S]*?)\n  \}/);
const partsBody  = _extract('_toolParts', /function _toolParts\(tool, args = \{\}\) \{([\s\S]*?)\n  \}/);
const labelBody  = _extract('_toolLabel', /function _toolLabel\(tool, args\) \{([\s\S]*?)\n  \}/);

const moduleCode = `
  const _TOOL_KEYWORDS = {${kwBody}};
  function _toolDetail(tool, args = {}) {
    ${detailBody}
  }
  function _toolParts(tool, args = {}) {
    ${partsBody}
  }
  function _toolLabel(tool, args) {
    ${labelBody}
  }
  module.exports = { _toolParts, _toolDetail, _toolLabel };
`;
const mod = new module.constructor();
mod._compile(moduleCode, 'tool-parts-extract.js');
const { _toolParts, _toolDetail, _toolLabel } = mod.exports;

describe('_toolParts — mot-clé + adresse', () => {
  it('lecture de fichier → « Lire » + nom du fichier', () => {
    assert.deepEqual(_toolParts('read_file', { path: 'src/snake.py' }), {
      keyword: 'Lire', detail: 'snake.py', kind: 'read',
    });
  });

  it('lecture avec plage de lignes → nom:ligne', () => {
    assert.equal(_toolDetail('read_file', { path: 'a/b.js', start_line: 42 }), 'b.js:42');
  });

  it('chemin Windows → dernier segment', () => {
    assert.equal(_toolDetail('read_file', { path: 'C:\\projet\\src\\app.js' }), 'app.js');
  });

  it('modification → « Modification en cours » + adresse complète', () => {
    const p = _toolParts('replace_code', { path: 'src/snake.py' });
    assert.equal(p.keyword, 'Modification en cours');
    assert.equal(p.detail, 'src/snake.py');
    assert.equal(p.kind, 'write');
  });

  it('écriture et suppression', () => {
    assert.equal(_toolParts('write_file', { path: 'x.js' }).keyword, 'Écriture');
    assert.equal(_toolParts('delete_file', { path: 'old.js' }).keyword, 'Suppression');
    assert.equal(_toolParts('delete_file', { path: 'old.js' }).kind, 'write');
  });

  it('déplacement → source → destination', () => {
    assert.equal(_toolDetail('move_file', { path: 'a.py', dest: 'lib/b.py' }), 'a.py → lib/b.py');
  });

  it('exécution → commande en indication', () => {
    const p = _toolParts('run_shell', { command: 'npm test -- --watch' });
    assert.equal(p.keyword, 'Exécution');
    assert.equal(p.detail, 'npm test -- --watch');
    assert.equal(p.kind, 'exec');
  });

  it('grep → motif entre guillemets + chemin', () => {
    const p = _toolParts('search_grep', { pattern: 'placeFood', path: 'src' });
    assert.equal(p.keyword, 'Grep');
    assert.ok(p.detail.includes('« placeFood »'));
    assert.ok(p.detail.includes('src'));
    assert.equal(p.kind, 'search');
  });

  it('recherche de symbole → « Recherche » + nom', () => {
    const p = _toolParts('find_symbol', { name: 'placeFood' });
    assert.equal(p.keyword, 'Recherche');
    assert.equal(p.detail, 'placeFood');
    assert.equal(p.kind, 'search');
  });

  it('requête HTTP → méthode + URL', () => {
    const p = _toolParts('http_request', { method: 'post', url: 'http://localhost:3000/api' });
    assert.equal(p.keyword, 'Requête');
    assert.equal(p.detail, 'POST http://localhost:3000/api');
    assert.equal(p.kind, 'net');
  });

  it('list_dir sans chemin → dossier courant', () => {
    assert.equal(_toolDetail('list_dir', {}), '.');
  });

  it('outil inconnu → nom brut, famille neutre', () => {
    assert.deepEqual(_toolParts('outil_bizarre', {}), {
      keyword: 'outil_bizarre', detail: '', kind: 'misc',
    });
  });

  it('args manquants → aucun crash', () => {
    assert.equal(_toolParts('read_file').keyword, 'Lire');
    assert.equal(_toolDetail('read_file'), '');
  });
});

describe('_toolLabel — libellé texte du panneau Exécution', () => {
  it('combine mot-clé et adresse', () => {
    assert.equal(_toolLabel('read_file', { path: 'src/snake.py' }), 'Lire snake.py');
  });

  it('sans détail → mot-clé seul', () => {
    assert.equal(_toolLabel('finish', { summary: 'x' }), 'Résumé');
  });
});

describe('app.js — rendu de la ligne d\'activité', () => {
  it('_activityRender affiche le mot-clé coloré et le détail', () => {
    const idx = src.indexOf('function _activityRender');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('act-kw act-kw-${p.kind}'), 'classe de couleur dynamique');
    assert.ok(block.includes('class="act-detail"'), 'détail affiché');
    assert.ok(block.includes('activity-spinner'), 'animation conservée sur la même ligne');
  });

  it('_activityStep mémorise mot-clé + détail', () => {
    const idx = src.indexOf('function _activityStep');
    const block = src.slice(idx, idx + 420);
    assert.ok(block.includes('_activityCurrentParts = _toolParts(tool, args)'), 'parts mémorisés');
  });

  it('l\'état est réinitialisé à la fermeture', () => {
    const idx = src.indexOf('function _closeActivityBlock');
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes('_activityCurrentParts = null'), 'reset des parts');
  });
});

describe('styles.css — mise en évidence et animation', () => {
  it('familles de couleurs définies', () => {
    for (const k of ['read', 'write', 'exec', 'search', 'net', 'misc']) {
      assert.ok(css.includes(`.act-kw-${k}`), `couleur .act-kw-${k} manquante`);
    }
  });

  it('variables de couleur ajoutées', () => {
    assert.ok(css.includes('--kw-search'), 'couleur recherche');
    assert.ok(css.includes('--kw-net'), 'couleur réseau');
  });

  it('le mot-clé pulse pendant l\'exécution', () => {
    assert.ok(css.includes('.activity-current.active .act-kw'), 'animation du mot-clé');
    assert.ok(css.includes('@keyframes kw-pulse'), 'keyframes définies');
  });

  it('.act-detail tronque proprement', () => {
    const idx = css.indexOf('.act-detail {');
    assert.ok(idx !== -1, '.act-detail requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('text-overflow: ellipsis'), 'troncature');
    assert.ok(block.includes('var(--mono)'), 'adresse en monospace');
  });

  it('le bandeau d\'écriture colore son libellé', () => {
    assert.ok(css.includes('.run-strip-writes.running .run-strip-label'), 'couleur écriture');
  });
});
