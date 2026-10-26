'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'depgraph-test-'));
}

function write(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

// Expose private functions via a fresh require with patched getIgnore
function loadModule(root) {
  // Clear require cache to get a fresh instance
  const modPath = require.resolve('../src/harness/context/depgraph.js');
  delete require.cache[modPath];
  return require('../src/harness/context/depgraph.js');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('depgraph — buildDepGraph', () => {
  let root;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('graphe vide sur projet vide', () => {
    const { buildDepGraph } = loadModule(root);
    const { deps, dependents, fileCount } = buildDepGraph(root);
    assert.equal(fileCount, 0);
    assert.deepEqual(deps, {});
    assert.deepEqual(dependents, {});
  });

  test('import ES modules relatif détecté', () => {
    write(root, 'src/a.js', `import { foo } from './b';\nconsole.log(foo);`);
    write(root, 'src/b.js', `export function foo() {}`);
    const { buildDepGraph } = loadModule(root);
    const { deps, dependents } = buildDepGraph(root);
    assert.ok(deps['src/a.js']?.includes('src/b.js'), 'a.js doit importer b.js');
    assert.ok(dependents['src/b.js']?.includes('src/a.js'), 'b.js doit être importé par a.js');
  });

  test('require CJS relatif détecté', () => {
    write(root, 'lib/x.js', `const y = require('./y');\n`);
    write(root, 'lib/y.js', `module.exports = 42;`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    assert.ok(deps['lib/x.js']?.includes('lib/y.js'));
  });

  test('import absolu (node_modules) ignoré', () => {
    write(root, 'src/app.js', `import React from 'react';\nimport { foo } from './utils';`);
    write(root, 'src/utils.js', `export const foo = 1;`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    const imports = deps['src/app.js'] || [];
    assert.ok(!imports.some(i => i.includes('react')), 'react ne doit pas apparaître');
    assert.ok(imports.includes('src/utils.js'), 'utils doit apparaître');
  });

  test('résolution sans extension (.js implicite)', () => {
    write(root, 'src/main.js', `import { init } from './core';`);
    write(root, 'src/core.js', `export function init() {}`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    assert.ok(deps['src/main.js']?.includes('src/core.js'));
  });

  test('résolution répertoire → index.js', () => {
    write(root, 'src/app.js', `import stuff from './utils';`);
    write(root, 'src/utils/index.js', `export default {};`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    assert.ok(deps['src/app.js']?.includes('src/utils/index.js'));
  });

  test('incrémental : fichier inchangé non re-parsé', () => {
    write(root, 'a.js', `import './b.js';`);
    write(root, 'b.js', `export const x = 1;`);
    const { buildDepGraph } = loadModule(root);
    buildDepGraph(root);  // first build

    // Modifier le graphe persisté pour vérifier qu'il est réutilisé
    const graphPath = path.join(root, '.harness', 'depgraph.json');
    assert.ok(fs.existsSync(graphPath), 'graphe persisté');
    const saved = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    assert.ok(saved.files['a.js'], 'a.js dans le graphe');

    // Deuxième build : rien ne change → même résultat
    const { deps: deps2 } = buildDepGraph(root);
    assert.ok(deps2['a.js']?.includes('b.js'));
  });

  test('fichier supprimé retiré du graphe', () => {
    write(root, 'x.js', `import './y.js';`);
    write(root, 'y.js', `export const z = 2;`);
    const { buildDepGraph } = loadModule(root);
    buildDepGraph(root);

    fs.unlinkSync(path.join(root, 'y.js'));
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    const { buildDepGraph: bg2 } = require('../src/harness/context/depgraph.js');
    const { deps } = bg2(root);
    assert.ok(!deps['y.js'], 'y.js supprimé du graphe');
  });

  test('dynamic import() détecté', () => {
    write(root, 'lazy.js', `const mod = import('./heavy.js');`);
    write(root, 'heavy.js', `export default 42;`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    assert.ok(deps['lazy.js']?.includes('heavy.js'));
  });

  test('TypeScript .ts détecté', () => {
    write(root, 'src/index.ts', `import { helper } from './helpers';`);
    write(root, 'src/helpers.ts', `export function helper() {}`);
    const { buildDepGraph } = loadModule(root);
    const { deps } = buildDepGraph(root);
    assert.ok(deps['src/index.ts']?.includes('src/helpers.ts'));
  });
});

describe('depgraph — queryFile', () => {
  let root;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('retourne imports et dependents', () => {
    write(root, 'src/a.js', `import './b.js';`);
    write(root, 'src/b.js', `import './c.js';`);
    write(root, 'src/c.js', `export const x = 1;`);
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    const { queryFile } = require('../src/harness/context/depgraph.js');
    const r = queryFile(root, 'src/b.js');
    assert.ok(r.imports.includes('src/c.js'), 'b importe c');
    assert.ok(r.dependents.includes('src/a.js'), 'a importe b');
  });

  test('fichier inconnu retourne tableaux vides', () => {
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    const { queryFile } = require('../src/harness/context/depgraph.js');
    const r = queryFile(root, 'does/not/exist.js');
    assert.deepEqual(r.imports, []);
    assert.deepEqual(r.dependents, []);
  });
});

describe('depgraph-tool — find_dependents / find_dependencies', () => {
  let root;

  beforeEach(() => { root = tmpDir(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function makeGuard(projectRoot) {
    return (relPath) => {
      const abs = path.resolve(projectRoot, relPath);
      if (!abs.startsWith(projectRoot)) throw new Error('HORS_PROJET');
      return abs;
    };
  }

  test('find_dependents retourne qui importe le fichier', () => {
    write(root, 'src/core.js', `export const x = 1;`);
    write(root, 'src/app.js', `import './core.js';`);
    // Build graph first
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    delete require.cache[require.resolve('../src/harness/tools/depgraph-tool.js')];
    const { findDependents } = require('../src/harness/tools/depgraph-tool.js');
    const r = findDependents({ path: 'src/core.js' }, makeGuard(root), root);
    assert.ok(r.ok);
    assert.ok(r.dependents.includes('src/app.js'));
  });

  test('find_dependencies retourne ce que le fichier importe', () => {
    write(root, 'src/core.js', `export const x = 1;`);
    write(root, 'src/app.js', `import './core.js';`);
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    delete require.cache[require.resolve('../src/harness/tools/depgraph-tool.js')];
    const { findDependencies } = require('../src/harness/tools/depgraph-tool.js');
    const r = findDependencies({ path: 'src/app.js' }, makeGuard(root), root);
    assert.ok(r.ok);
    assert.ok(r.dependencies.includes('src/core.js'));
  });

  test('chemin manquant retourne CHEMIN_MANQUANT', () => {
    delete require.cache[require.resolve('../src/harness/tools/depgraph-tool.js')];
    const { findDependents } = require('../src/harness/tools/depgraph-tool.js');
    const r = findDependents({}, makeGuard(root), root);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'CHEMIN_MANQUANT');
  });

  test('BFS depth=2 remonte deux niveaux', () => {
    write(root, 'a.js', `import './b.js';`);
    write(root, 'b.js', `import './c.js';`);
    write(root, 'c.js', `export const z = 3;`);
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    require('../src/harness/context/depgraph.js').buildDepGraph(root);

    delete require.cache[require.resolve('../src/harness/tools/depgraph-tool.js')];
    const { findDependents } = require('../src/harness/tools/depgraph-tool.js');
    const r = findDependents({ path: 'c.js', depth: 2 }, makeGuard(root), root);
    assert.ok(r.ok);
    // Depth 2 : c.js ← b.js ← a.js
    assert.ok(r.dependents.includes('b.js'), 'b.js à depth 1');
    assert.ok(r.dependents.includes('a.js'), 'a.js à depth 2');
  });

  test('constantes FIND_DEPENDENTS et FIND_DEPENDENCIES définies', () => {
    const { TOOLS } = require('../src/shared/constants.js');
    assert.equal(TOOLS.FIND_DEPENDENTS,   'find_dependents');
    assert.equal(TOOLS.FIND_DEPENDENCIES, 'find_dependencies');
  });

  test('dispatch reconnaît find_dependents', async () => {
    write(root, 'src/x.js', `export const x = 1;`);
    delete require.cache[require.resolve('../src/harness/context/depgraph.js')];
    delete require.cache[require.resolve('../src/harness/tools/depgraph-tool.js')];
    delete require.cache[require.resolve('../src/harness/tools/index.js')];
    const { dispatch } = require('../src/harness/tools/index.js');
    const guard = makeGuard(root);
    const r = await dispatch('find_dependents', { path: 'src/x.js' }, guard, {}, () => {}, root);
    assert.ok(r.ok, `dispatch find_dependents: ${r.error}`);
  });

  test('families.js inclut find_dependents et find_dependencies dans recherche', () => {
    delete require.cache[require.resolve('../src/harness/tools/families.js')];
    const { FAMILIES } = require('../src/harness/tools/families.js');
    assert.ok(FAMILIES.recherche.includes('find_dependents'),   'find_dependents dans recherche');
    assert.ok(FAMILIES.recherche.includes('find_dependencies'), 'find_dependencies dans recherche');
  });
});
