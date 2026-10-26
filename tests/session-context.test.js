'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

// La fonction vit dans le renderer (pas de module) : on l'extrait comme pour
// `_buildTaskWithContext` dans tests/context.test.js.
const src = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const match = src.match(/function _buildPreviousSessionContext\(session\) \{([\s\S]*?)\n  \}/);
assert.ok(match, '_buildPreviousSessionContext introuvable dans app.js');

// Compilation isolée (même technique que tests/context.test.js) : évite eval/new Function.
const mod = new module.constructor();
mod._compile(
  `module.exports = function _buildPreviousSessionContext(session) {${match[1]}\n};`,
  'session-context-extract.js',
);
const helper = mod.exports;

function step(tool, filePath, ok = true) {
  return { tool, args: { path: filePath }, result: { ok } };
}

describe('_buildPreviousSessionContext', () => {

  it('session vide ou sans étapes → chaîne vide', () => {
    assert.equal(helper(null), '');
    assert.equal(helper({ steps: [] }), '');
    assert.equal(helper({ steps: undefined }), '');
  });

  it('aucune lecture ni écriture → chaîne vide', () => {
    const session = { steps: [{ tool: 'list_dir', args: { path: '.' }, result: { ok: true } }] };
    assert.equal(helper(session), '');
  });

  it('liste les fichiers modifiés, sans doublon', () => {
    const session = {
      steps: [
        step('read_file', 'src/a.js'),
        step('write_file', 'src/a.js'),
        step('replace_code', 'src/a.js'),
        step('replace_code', 'src/b.js'),
      ],
      result: { ok: true, summary: 'Corrigé le total.' },
    };
    const out = helper(session);
    assert.ok(out.includes('SESSION PRÉCÉDENTE'), 'en-tête présent');
    assert.ok(out.includes('src/a.js'), 'fichier modifié cité');
    assert.ok(out.includes('src/b.js'), 'second fichier cité');
    assert.equal(out.split('src/a.js').length - 1, 1, 'src/a.js ne doit apparaître qu\'une fois');
    assert.ok(out.includes('Corrigé le total'), 'dernier résultat repris');
    assert.ok(out.includes('déjà lus'), 'compteur de lectures présent');
  });

  it('ignore les écritures qui ont échoué', () => {
    const session = {
      steps: [step('replace_code', 'src/cassé.js', false), step('read_file', 'src/ok.js')],
      result: { ok: false },
    };
    const out = helper(session);
    assert.ok(!out.includes('src/cassé.js'), 'écriture échouée non listée');
    assert.ok(out.includes('déjà lus'), 'lectures conservées');
  });

  it('borne la taille du bloc injecté', () => {
    const many = Array.from({ length: 40 }, (_, i) => step('write_file', `src/fichier-${i}.js`));
    const out = helper({ steps: many, result: { ok: true, summary: 'x'.repeat(400) } });
    assert.ok(out.length <= 701, `bloc trop long (${out.length})`);
  });

});
