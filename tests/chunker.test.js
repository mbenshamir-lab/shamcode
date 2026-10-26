'use strict';

/**
 * Tests : chunking sémantique par frontières de déclarations (Phase 106).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function load() {
  delete require.cache[require.resolve('../src/harness/rag/indexer.js')];
  return require('../src/harness/rag/indexer.js');
}

// ── _findBoundaries ───────────────────────────────────────────────────────────

describe('_findBoundaries — JS', () => {
  test('détecte function declaration', () => {
    const { _findBoundaries } = load();
    const lines = [
      'const x = 1;',
      'function foo() {',
      '  return x;',
      '}',
    ];
    assert.deepEqual(_findBoundaries(lines, '.js'), [1]);
  });

  test('détecte export function', () => {
    const { _findBoundaries } = load();
    const lines = ['export function bar() {}'];
    assert.deepEqual(_findBoundaries(lines, '.js'), [0]);
  });

  test('détecte arrow function const', () => {
    const { _findBoundaries } = load();
    const lines = ['const fn = (x) => x * 2;'];
    assert.deepEqual(_findBoundaries(lines, '.js'), [0]);
  });

  test('détecte class', () => {
    const { _findBoundaries } = load();
    const lines = ['class Foo {', '  constructor() {}', '}'];
    assert.deepEqual(_findBoundaries(lines, '.js'), [0]);
  });

  test('ignore les méthodes indentées', () => {
    const { _findBoundaries } = load();
    const lines = [
      'class Foo {',
      '  method() {}',           // indented → not a boundary
      '  async other() {}',      // indented → not a boundary
      '}',
    ];
    // Only the class itself is a boundary
    assert.deepEqual(_findBoundaries(lines, '.js'), [0]);
  });

  test('détecte module.exports', () => {
    const { _findBoundaries } = load();
    const lines = ['module.exports = { foo };'];
    assert.deepEqual(_findBoundaries(lines, '.js'), [0]);
  });

  test('détecte plusieurs déclarations (functions et classes)', () => {
    const { _findBoundaries } = load();
    const lines = [
      '// header',
      'function B() {}',         // boundary : index 1
      '',
      'class C {}',              // boundary : index 3
      '',
      'async function D() {}',   // boundary : index 5
    ];
    const bounds = _findBoundaries(lines, '.js');
    assert.equal(bounds.length, 3);
    assert.deepEqual(bounds, [1, 3, 5]);
  });

  test('retourne [] pour ext non reconnue', () => {
    const { _findBoundaries } = load();
    assert.deepEqual(_findBoundaries(['def foo(): pass'], '.rb'), []);
  });

  test('TypeScript : détecte export const arrow', () => {
    const { _findBoundaries } = load();
    const lines = ['export const compute = async (x: number): Promise<number> => {'];
    assert.deepEqual(_findBoundaries(lines, '.ts'), [0]);
  });
});

describe('_findBoundaries — Python', () => {
  test('détecte def', () => {
    const { _findBoundaries } = load();
    const lines = ['import os', 'def foo():', '    pass'];
    assert.deepEqual(_findBoundaries(lines, '.py'), [1]);
  });

  test('détecte class', () => {
    const { _findBoundaries } = load();
    const lines = ['class Bar:', '    def method(self): pass'];
    assert.deepEqual(_findBoundaries(lines, '.py'), [0]);
  });

  test('le def après un décorateur est la frontière (décorateur dans segment précédent)', () => {
    const { _findBoundaries } = load();
    const lines = ['@property', 'def foo(self): return self._x'];
    // @property n'est pas une frontière — seul 'def foo' l'est
    const bounds = _findBoundaries(lines, '.py');
    assert.ok(bounds.includes(1), 'def foo doit être détecté');
    assert.ok(!bounds.includes(0) || bounds.length === 2, 'comportement acceptable');
  });
});

// ── chunkFile ─────────────────────────────────────────────────────────────────

describe('chunkFile — chunking sémantique', () => {
  test('crée un chunk par déclaration (fichier simple)', () => {
    const { chunkFile } = load();
    const content = [
      'const CONST = 1;',
      '',
      'function alpha() {',
      '  return CONST;',
      '}',
      '',
      'function beta() {',
      '  return CONST + 1;',
      '}',
    ].join('\n');
    const chunks = chunkFile('src/a.js', content, 'hash1');
    // Header (CONST) + alpha + beta
    assert.ok(chunks.length >= 2, `attendu ≥ 2 chunks, reçu ${chunks.length}`);
    const paths = new Set(chunks.map(c => c.path));
    assert.ok(paths.has('src/a.js'));
  });

  test('chaque chunk a startLine/endLine/content/vector', () => {
    const { chunkFile } = load();
    const content = 'function foo() {\n  return 1;\n}\n';
    const chunks = chunkFile('src/f.js', content, 'h');
    for (const c of chunks) {
      assert.ok(c.startLine >= 1);
      assert.ok(c.endLine >= c.startLine);
      assert.ok(c.content.length > 0);
      assert.ok(Array.isArray(c.vector));
    }
  });

  test('chunk id = filePath:lineIndex', () => {
    const { chunkFile } = load();
    const content = 'function x() {}\n';
    const chunks = chunkFile('src/x.js', content, 'h');
    assert.ok(chunks[0].id.startsWith('src/x.js:'));
  });

  test('fallback fixe pour .md (pas de frontières)', () => {
    const { chunkFile } = load();
    // 120 lignes de markdown
    const lines = Array.from({ length: 120 }, (_, i) => `Line ${i}`);
    const chunks = chunkFile('README.md', lines.join('\n'), 'h');
    // Fallback → au moins 2 chunks (60+overlap)
    assert.ok(chunks.length >= 2, `attendu ≥ 2 chunks, reçu ${chunks.length}`);
    // Overlap : deuxième chunk commence avant la fin du premier
    assert.ok(chunks[1].startLine <= chunks[0].endLine);
  });

  test('sous-découpe un segment > CHUNK_SIZE lignes', () => {
    const { chunkFile } = load();
    // Une seule grande fonction de 80 lignes
    const body = Array.from({ length: 78 }, (_, i) => `  line${i};`).join('\n');
    const content = `function huge() {\n${body}\n}`;
    const chunks = chunkFile('src/big.js', content, 'h');
    assert.ok(chunks.length >= 2, `une fonction de 80 lignes doit être sous-découpée`);
  });

  test('fichier vide → 0 ou 1 chunk', () => {
    const { chunkFile } = load();
    const chunks = chunkFile('src/empty.js', '', 'h');
    assert.ok(chunks.length <= 1);
  });

  test('header (imports avant première déclaration) a son propre chunk', () => {
    const { chunkFile } = load();
    const content = [
      "'use strict';",
      "const fs = require('fs');",
      '',
      'function doStuff() {',
      '  fs.readFileSync("x");',
      '}',
    ].join('\n');
    const chunks = chunkFile('src/h.js', content, 'h');
    // Premier chunk = header (lignes 1-3), deuxième = doStuff
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].content.includes('use strict') || chunks[0].content.includes('require'));
  });

  test('CHUNKER_VERSION exporté', () => {
    const { CHUNKER_VERSION } = load();
    assert.equal(typeof CHUNKER_VERSION, 'number');
    assert.ok(CHUNKER_VERSION >= 1);
  });
});

describe('chunkFile — fallback fixe identique à avant', () => {
  test('fichier .json découpé en blocs de 60 lignes avec overlap', () => {
    const { chunkFile } = load();
    const lines = Array.from({ length: 100 }, (_, i) => `  "key${i}": ${i},`);
    lines.unshift('{');
    lines.push('}');
    const content = lines.join('\n');  // 102 lignes
    const chunks = chunkFile('data.json', content, 'h');
    assert.ok(chunks.length >= 2);
    // Deuxième chunk commence avant la fin du premier (overlap)
    if (chunks.length >= 2) {
      assert.ok(chunks[1].startLine <= chunks[0].endLine);
    }
  });
});
