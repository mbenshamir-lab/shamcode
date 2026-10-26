'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const src = require('fs').readFileSync(
  require('path').join(__dirname, '../src/renderer-visible/app.js'),
  'utf8'
);

const match = src.match(/function _extractFinishMessage\(buf\) \{([\s\S]*?)\n  \}/);
assert.ok(match, '_extractFinishMessage introuvable dans app.js');

const moduleCode = `
  function _extractFinishMessage(buf) {
    ${match[1]}
  }
  module.exports = { _extractFinishMessage };
`;
const m = new module.constructor();
m._compile(moduleCode, 'streaming-extract.js');
const { _extractFinishMessage } = m.exports;

describe('_extractFinishMessage', () => {

  it('retourne null si pas de "finish" dans le buffer', () => {
    assert.equal(_extractFinishMessage('{"tool":"read_file","args":{"path":"a"}}'), null);
  });

  it('retourne null si "finish" mais pas encore "summary"', () => {
    assert.equal(_extractFinishMessage('{"tool":"finish","args":{'), null);
  });

  it('extrait le message simple', () => {
    const buf = '{"tool":"finish","args":{"summary":"Tâche terminée."}}';
    assert.equal(_extractFinishMessage(buf), 'Tâche terminée.');
  });

  it('extrait un message partiel (streaming en cours — pas de " fermant)', () => {
    const buf = '{"tool":"finish","args":{"summary":"Voilà ce que j\'ai fait : j\'ai modifié';
    const result = _extractFinishMessage(buf);
    assert.ok(result !== null, 'doit extraire malgré le manque de "');
    assert.ok(result.startsWith('Voilà'), 'début correct');
  });

  it('décode \\n en saut de ligne', () => {
    const buf = '{"tool":"finish","args":{"summary":"ligne1\\nligne2"}}';
    const result = _extractFinishMessage(buf);
    assert.equal(result, 'ligne1\nligne2');
  });

  it('décode \\" en guillemet', () => {
    const buf = '{"tool":"finish","args":{"summary":"il a dit \\"bonjour\\""}}';
    const result = _extractFinishMessage(buf);
    assert.equal(result, 'il a dit "bonjour"');
  });

  it('décode \\\\ en backslash', () => {
    const buf = '{"tool":"finish","args":{"summary":"chemin\\\\fichier"}}';
    const result = _extractFinishMessage(buf);
    assert.equal(result, 'chemin\\fichier');
  });

  it('décode \\t en tabulation', () => {
    const buf = '{"tool":"finish","args":{"summary":"col1\\tcol2"}}';
    const result = _extractFinishMessage(buf);
    assert.equal(result, 'col1\tcol2');
  });

  it('buffer vide → null', () => {
    assert.equal(_extractFinishMessage(''), null);
  });

  it('summary avec espaces et accents', () => {
    const buf = '{"tool":"finish","args":{"summary":"J\'ai créé 3 fichiers."}}';
    assert.equal(_extractFinishMessage(buf), "J'ai créé 3 fichiers.");
  });

});
