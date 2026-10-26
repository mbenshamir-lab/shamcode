/**
 * Tests Phase 57 — Chat allégé : bandeaux regroupés + sauts de ligne inutiles
 *
 * 1. _plural / _runStripLabel / _runStripMeta — libellés des bandeaux (purs)
 * 2. _patchLines — plus de ligne vide finale dans les diffs
 * 3. app.js — write_preview et bus_message alimentent un bandeau unique
 * 4. _renderMarkdown — normalisation des sauts de ligne
 * 5. styles.css — bandeau compact
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

const pluralBody = _extract('_plural', /function _plural\(n, sing, plur\) \{([\s\S]*?)\n  \}/);
const labelBody  = _extract('_runStripLabel', /function _runStripLabel\(kind, n, ok = true\) \{([\s\S]*?)\n  \}/);
const metaBody   = _extract('_runStripMeta', /function _runStripMeta\(kind, entry\) \{([\s\S]*?)\n  \}/);
const patchBody  = _extract('_patchLines', /function _patchLines\(patch\) \{([\s\S]*?)\n  \}/);

const moduleCode = `
  function _plural(n, sing, plur) {
    ${pluralBody}
  }
  function _runStripLabel(kind, n, ok = true) {
    ${labelBody}
  }
  function _runStripMeta(kind, entry) {
    ${metaBody}
  }
  function _patchLines(patch) {
    ${patchBody}
  }
  module.exports = { _plural, _runStripLabel, _runStripMeta, _patchLines };
`;
const mod = new module.constructor();
mod._compile(moduleCode, 'run-strip-extract.js');
const { _plural, _runStripLabel, _runStripMeta, _patchLines } = mod.exports;

describe('libellés des bandeaux regroupés', () => {
  it('_plural accorde correctement', () => {
    assert.equal(_plural(1, 'modification'), 'modification');
    assert.equal(_plural(2, 'modification'), 'modifications');
    assert.equal(_plural(0, 'message'), 'message');
  });

  it('écritures réussies', () => {
    assert.equal(_runStripLabel('writes', 1, true), '1 modification appliquée');
    assert.equal(_runStripLabel('writes', 3, true), '3 modifications appliquées');
  });

  it('écritures interrompues', () => {
    assert.equal(_runStripLabel('writes', 2, false), '2 modifications interrompues');
  });

  it('messages inter-agents', () => {
    assert.equal(_runStripLabel('bus', 1), '1 message inter-agent');
    assert.equal(_runStripLabel('bus', 4), '4 messages inter-agents');
  });

  it('méta d\'une écriture : fichier + stats', () => {
    assert.equal(
      _runStripMeta('writes', { path: 'src/snake.py', stats: { additions: 3, deletions: 1 } }),
      'snake.py +3/-1',
    );
    assert.equal(
      _runStripMeta('writes', { path: 'C:\\\\projet\\\\a\\\\b.js', stats: {} }),
      'b.js +0/-0',
    );
  });

  it('méta d\'un message : émetteur', () => {
    assert.equal(_runStripMeta('bus', { from: 'analyzer' }), 'analyzer');
  });
});

describe('_patchLines — pas de ligne vide parasite', () => {
  it('supprime le saut de ligne final', () => {
    assert.deepEqual(_patchLines('+a\n+b\n'), ['+a', '+b']);
  });

  it('conserve les lignes vides internes', () => {
    assert.deepEqual(_patchLines('+a\n\n+b'), ['+a', '', '+b']);
  });

  it('patch vide ou null → tableau vide', () => {
    assert.deepEqual(_patchLines(''), []);
    assert.deepEqual(_patchLines(null), []);
  });
});

describe('app.js — un seul bandeau par type d\'événement', () => {
  it('write_preview alimente le bandeau « writes »', () => {
    const idx = src.indexOf("event.type === 'write_preview'");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes("_stripPush('writes'"), 'push dans le bandeau écritures');
    assert.ok(!block.includes('_appendDiff'), 'plus de carte par écriture');
  });

  it('bus_message alimente le bandeau « bus »', () => {
    const idx = src.indexOf("event.type === 'bus_message'");
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes("_stripPush('bus'"), 'push dans le bandeau inter-agents');
  });

  it('_appendDiff et _appendBusMessage ont disparu', () => {
    assert.ok(!src.includes('function _appendDiff'), '_appendDiff supprimé');
    assert.ok(!src.includes('function _appendBusMessage'), '_appendBusMessage supprimé');
  });

  it('le libellé d\'attente est « Modification en cours »', () => {
    assert.ok(src.includes("writes: 'Modification en cours'"), 'libellé running attendu');
  });

  it('finish ferme les bandeaux en succès', () => {
    const idx = src.indexOf("event.type === 'finish'");
    const block = src.slice(idx, idx + 220);
    assert.ok(block.includes('_stripCloseAll(true)'), 'fermeture succès');
  });

  it('cancelled ferme les bandeaux en échec', () => {
    const idx = src.indexOf("event.type === 'cancelled'");
    const block = src.slice(idx, idx + 260);
    assert.ok(block.includes('_stripCloseAll(false)'), 'fermeture échec');
  });

  it('sendTask ferme les bandeaux dans finally (aucun bandeau bloqué)', () => {
    const idx = src.indexOf('async function sendTask');
    // Fenêtre généreuse : sendTask a grossi (contexte de session précédente, Phase 98).
    // Ce qui est testé est la présence du filet, pas sa position exacte.
    const block = src.slice(idx, idx + 6000);
    assert.ok(block.includes('_stripCloseAll(taskOk)'), 'filet de sécurité dans finally');
    assert.ok(block.includes('let taskOk = false'), 'état de la tâche suivi');
  });

  it('les diffs ne rajoutent plus de « \\n » par ligne', () => {
    const idx = src.indexOf('function _colorDiff');
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes('_patchLines(patch)'), '_colorDiff utilise _patchLines');
    assert.ok(!block.includes("line + '\\n'"), 'plus de saut de ligne ajouté');
  });
});

describe('_renderMarkdown — sauts de ligne normalisés', () => {
  const { _renderMarkdown } = require('./lib/app-module');

  it('réduit 3+ sauts de ligne à un seul blanc', () => {
    const out = _renderMarkdown('**1. Bugs**\n\n\n\n- a\n\n\n- b');
    assert.ok(!out.includes('\n\n\n'), 'aucune séquence de 3 sauts');
  });

  it('supprime les lignes vides en début et fin', () => {
    const out = _renderMarkdown('\n\n\n- seul\n\n\n');
    assert.ok(!out.startsWith('<br>'));
    assert.ok(!out.startsWith('\n'));
    assert.ok(out.includes('seul'));
  });

  it('texte vide → chaîne vide', () => {
    assert.equal(_renderMarkdown(''), '');
    assert.equal(_renderMarkdown(null), '');
  });
});

describe('styles.css — bandeau compact', () => {
  it('.run-strip est une colonne bornée', () => {
    assert.ok(css.includes('.run-strip {'), 'style du bandeau');
    assert.ok(css.includes('flex-direction: column'), 'structure colonne');
  });

  it('ligne animée en attente', () => {
    assert.ok(css.includes('.run-strip-spin'), 'spinner');
    assert.ok(css.includes('tp-spin'), 'animation réutilisée');
  });

  it('liste dépliable masquée par défaut', () => {
    assert.ok(css.includes('.run-strip-items.hidden { display: none; }'), 'dépliage');
  });

  it('contenu inter-agent limité à 2 lignes', () => {
    const idx = css.indexOf('.rsi-bus-text');
    assert.ok(idx !== -1, '.rsi-bus-text requis');
    const block = css.slice(idx, idx + 260);
    assert.ok(block.includes('-webkit-line-clamp: 2'), 'clamp 2 lignes');
  });
});
