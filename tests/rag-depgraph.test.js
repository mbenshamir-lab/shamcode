'use strict';

/**
 * Tests : RAG expansion via graphe de dépendances (Phase 104).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-depgraph-'));
}
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

// Store minimal compatible avec l'API retrieve
function makeStore(chunks) {
  return {
    all()            { return chunks; },
    search(vec, k)   { return chunks.slice(0, k).map(c => ({ ...c, score: 0.8 })); },
  };
}

describe('retrieveRelevant — sans expansion (pas de projectRoot)', () => {
  test('retourne les chunks directs uniquement', async () => {
    delete require.cache[require.resolve('../src/harness/rag/retrieve.js')];
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');

    const chunks = [
      { path: 'src/a.js', startLine: 1, endLine: 10, content: 'function foo', vector: Array(256).fill(0.1), hash: 'h1' },
    ];
    const store = makeStore(chunks);
    const results = await retrieveRelevant(store, 'foo function', { topK: 5 });
    assert.equal(results.length, 1);
    assert.ok(!results[0].dep_expanded);
  });
});

describe('retrieveRelevant — expansion via dep graph', () => {
  let root;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function clearCache() {
    for (const k of Object.keys(require.cache)) {
      if (k.includes('depgraph') || k.includes('retrieve') || k.includes('embedder')) {
        delete require.cache[k];
      }
    }
  }

  test('chunk de dépendance ajouté avec dep_expanded:true', async () => {
    // a.js importe b.js
    write(root, 'src/a.js', `import './b.js'; export function main() {}`);
    write(root, 'src/b.js', `export function helper() {}`);

    // Construire le graphe
    clearCache();
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    // Store avec chunks pour a.js et b.js
    const vecA = Array(256).fill(0);  vecA[0] = 1;
    const vecB = Array(256).fill(0);  vecB[1] = 1;
    const chunks = [
      { path: 'src/a.js', startLine: 1, endLine: 5, content: 'function main', vector: vecA, hash: 'ha' },
      { path: 'src/b.js', startLine: 1, endLine: 3, content: 'function helper', vector: vecB, hash: 'hb' },
    ];
    const store = {
      all()         { return chunks; },
      search(v, k)  { return [{ ...chunks[0], score: 0.9 }]; },  // retourne seulement a.js
    };

    clearCache();
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');
    const results = await retrieveRelevant(store, 'main helper', { topK: 5, projectRoot: root });

    const expanded = results.filter(r => r.dep_expanded);
    assert.ok(expanded.length > 0, 'au moins un chunk dep_expanded');
    assert.ok(expanded.some(r => r.path === 'src/b.js'), 'b.js ajouté via dépendance');
  });

  test('pas de doublon si la dépendance est déjà dans les résultats directs', async () => {
    write(root, 'src/a.js', `import './b.js'; export function main() {}`);
    write(root, 'src/b.js', `export function helper() {}`);

    clearCache();
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    const vecA = Array(256).fill(0); vecA[0] = 1;
    const vecB = Array(256).fill(0); vecB[1] = 1;
    const chunks = [
      { path: 'src/a.js', startLine: 1, endLine: 5, content: 'main', vector: vecA, hash: 'ha' },
      { path: 'src/b.js', startLine: 1, endLine: 3, content: 'helper', vector: vecB, hash: 'hb' },
    ];
    // search retourne déjà les deux fichiers
    const store = {
      all()       { return chunks; },
      search(v, k){ return chunks.map(c => ({ ...c, score: 0.9 })); },
    };

    clearCache();
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');
    const results = await retrieveRelevant(store, 'test', { topK: 5, projectRoot: root });

    const bPaths = results.filter(r => r.path === 'src/b.js');
    assert.equal(bPaths.length, 1, 'b.js ne doit apparaître qu\'une seule fois');
  });

  test('score dep_expanded = score direct × 0.6', async () => {
    write(root, 'src/main.js', `import './lib.js'; export const app = 1;`);
    write(root, 'src/lib.js', `export const util = 2;`);

    clearCache();
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    const vec = Array(256).fill(0); vec[5] = 1;
    const chunks = [
      { path: 'src/main.js', startLine: 1, endLine: 2, content: 'app', vector: vec, hash: 'hm' },
      { path: 'src/lib.js',  startLine: 1, endLine: 2, content: 'util', vector: vec, hash: 'hl' },
    ];
    const DIRECT_SCORE = 0.75;
    const store = {
      all()       { return chunks; },
      search(v, k){ return [{ ...chunks[0], score: DIRECT_SCORE }]; },
    };

    clearCache();
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');
    const results = await retrieveRelevant(store, 'app util', { topK: 5, projectRoot: root });

    const lib = results.find(r => r.path === 'src/lib.js');
    assert.ok(lib, 'lib.js présent');
    assert.ok(lib.dep_expanded, 'marqué dep_expanded');
    // Le score est le dot product entre les deux vecteurs (identiques ici → 1.0 × 0.6)
    assert.ok(lib.score < DIRECT_SCORE, 'score réduit par rapport au chunk direct');
  });

  test('dégradation silencieuse si dep graph absent', async () => {
    clearCache();
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');

    const vec = Array(256).fill(0.1);
    const chunks = [{ path: 'src/x.js', startLine: 1, endLine: 5, content: 'x', vector: vec, hash: 'hx' }];
    const store = {
      all()       { return chunks; },
      search(v, k){ return [{ ...chunks[0], score: 0.8 }]; },
    };
    // projectRoot pointe sur un dossier vide sans depgraph → pas de crash
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-empty-'));
    const results = await retrieveRelevant(store, 'getProjectInfo settings configuration', { topK: 5, projectRoot: emptyRoot });
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    assert.ok(results.length >= 1, 'résultats directs toujours retournés');
  });

  test('max DEP_EXTRA_MAX chunks supplémentaires (plafond 3)', async () => {
    // a.js importe 5 fichiers
    const imports = ['b','c','d','e','f'].map(n => `'./src/${n}.js'`).join(', ');
    write(root, 'src/a.js', `import { x } from './src/b.js';\nimport { y } from './src/c.js';\nimport { z } from './src/d.js';\nimport { w } from './src/e.js';\nimport { v } from './src/f.js';`);
    ['b','c','d','e','f'].forEach(n => write(root, `src/${n}.js`, `export const ${n} = 1;`));

    clearCache();
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    const vec = Array(256).fill(0); vec[0] = 1;
    const allChunks = [
      { path: 'src/a.js', startLine: 1, endLine: 5, content: 'a', vector: vec, hash: 'ha' },
      ...['b','c','d','e','f'].map(n => ({ path: `src/${n}.js`, startLine: 1, endLine: 1, content: n, vector: vec, hash: `h${n}` })),
    ];
    const store = {
      all()       { return allChunks; },
      search(v, k){ return [{ ...allChunks[0], score: 0.9 }]; },
    };

    clearCache();
    const { retrieveRelevant } = require('../src/harness/rag/retrieve.js');
    const results = await retrieveRelevant(store, 'x y z', { topK: 5, projectRoot: root });

    const expanded = results.filter(r => r.dep_expanded);
    assert.ok(expanded.length <= 3, `plafond 3 respecté, got ${expanded.length}`);
  });
});
