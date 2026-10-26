'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Extraire _extractModifiedFiles depuis app.js
const src = require('fs').readFileSync(
  require('path').join(__dirname, '../src/renderer-visible/app.js'),
  'utf8'
);

const match = src.match(/function _extractModifiedFiles\(trace\) \{([\s\S]*?)\n  \}/);
assert.ok(match, '_extractModifiedFiles introuvable dans app.js');

const moduleCode = `
  function _extractModifiedFiles(trace) {
    ${match[1]}
  }
  module.exports = { _extractModifiedFiles };
`;
const m = new module.constructor();
m._compile(moduleCode, 'trace-files-extract.js');
const { _extractModifiedFiles } = m.exports;

describe('_extractModifiedFiles', () => {

  it('trace null/undefined → tableau vide', () => {
    assert.deepEqual(_extractModifiedFiles(null),      []);
    assert.deepEqual(_extractModifiedFiles(undefined), []);
    assert.deepEqual(_extractModifiedFiles([]),        []);
  });

  it('ignore les outils de lecture (read_file, list_dir, search_grep)', () => {
    const trace = [
      { step: 1, tool: 'read_file', args: { path: 'src/main.js' } },
      { step: 2, tool: 'list_dir',  args: { path: '.' } },
      { step: 3, tool: 'finish',    args: { summary: 'ok' } },
    ];
    assert.deepEqual(_extractModifiedFiles(trace), []);
  });

  it('détecte write_file', () => {
    const trace = [{ step: 1, tool: 'write_file', args: { path: 'src/a.js', content: '...' } }];
    const result = _extractModifiedFiles(trace);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'src/a.js');
    assert.equal(result[0].action, 'edit');
  });

  it('détecte replace_code', () => {
    const trace = [{ step: 1, tool: 'replace_code', args: { path: 'lib/b.js', old_string: 'x', new_string: 'y' } }];
    const result = _extractModifiedFiles(trace);
    assert.equal(result[0].action, 'edit');
  });

  it('détecte delete_file avec action del', () => {
    const trace = [{ step: 1, tool: 'delete_file', args: { path: 'old.js' } }];
    const result = _extractModifiedFiles(trace);
    assert.equal(result[0].action, 'del');
  });

  it('détecte move_file avec action mv', () => {
    const trace = [{ step: 1, tool: 'move_file', args: { path: 'src/a.js', dest: 'src/b.js' } }];
    const result = _extractModifiedFiles(trace);
    // move_file enregistre src et dest
    assert.ok(result.some(f => f.action === 'mv'), 'au moins un entry mv');
  });

  it('déduplique les chemins — garde la dernière action', () => {
    const trace = [
      { step: 1, tool: 'write_file',  args: { path: 'src/x.js' } },
      { step: 2, tool: 'replace_code', args: { path: 'src/x.js' } },
      { step: 3, tool: 'delete_file', args: { path: 'src/x.js' } },
    ];
    const result = _extractModifiedFiles(trace);
    assert.equal(result.length, 1, 'dédupliqué à 1 fichier');
    assert.equal(result[0].action, 'del', 'dernière action = del');
  });

  it('plusieurs fichiers distincts', () => {
    const trace = [
      { step: 1, tool: 'write_file',   args: { path: 'a.js' } },
      { step: 2, tool: 'write_file',   args: { path: 'b.js' } },
      { step: 3, tool: 'replace_code', args: { path: 'c.js' } },
    ];
    const result = _extractModifiedFiles(trace);
    assert.equal(result.length, 3);
  });

  it('ignore les entrées sans args.path', () => {
    const trace = [
      { step: 1, tool: 'write_file', args: {} },
      { step: 2, tool: 'replace_code', args: null },
    ];
    assert.doesNotThrow(() => _extractModifiedFiles(trace));
    assert.equal(_extractModifiedFiles(trace).length, 0);
  });

});
