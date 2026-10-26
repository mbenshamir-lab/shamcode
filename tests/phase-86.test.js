/**
 * Phase 86 — LSP integration
 * Tests : lsp.js (fonctions pures), constantes, dispatch, agent, settings UI
 */

'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

const ROOT = path.resolve(__dirname, '..');

// ── 1. Helpers internes — _pathToUri / _uriToPath ────────────────────────────

test('_pathToUri — Windows absolu', () => {
  const { _pathToUri } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const uri = _pathToUri('C:\\Users\\foo\\bar.ts');
  assert.equal(uri, 'file:///C:/Users/foo/bar.ts');
});

test('_pathToUri — chemin POSIX', () => {
  const { _pathToUri } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const uri = _pathToUri('/home/user/project/foo.ts');
  assert.equal(uri, 'file:///home/user/project/foo.ts');
});

test('_uriToPath — round-trip Windows', () => {
  const { _pathToUri, _uriToPath } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const orig = 'C:\\Users\\foo\\project\\src\\bar.ts';
  const uri  = _pathToUri(orig);
  const back = _uriToPath(uri);
  assert.equal(back.toLowerCase(), orig.toLowerCase());
});

test('_uriToPath — URI POSIX', () => {
  const { _uriToPath } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const p = _uriToPath('file:///home/user/foo.py');
  assert.ok(p.includes('foo.py'));
});

// ── 2. Validation des args (sans serveur LSP réel) ───────────────────────────

test('lsp_hover — chemin manquant retourne CHEMIN_MANQUANT', async () => {
  const { lspHover } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const fakeGuard = (p) => { if (!p) throw new Error('guard'); return p; };
  const r = await lspHover({}, fakeGuard, '/project', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CHEMIN_MANQUANT');
});

test('lsp_hover — extension non supportée retourne EXTENSION_NON_SUPPORTÉE', async () => {
  const { lspHover } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const fakeGuard = (p) => path.join('/project', p);
  const r = await lspHover({ path: 'README.md', line: 1 }, fakeGuard, '/project', {});
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('EXTENSION_NON_SUPPORTÉE'));
});

test('lsp_definition — chemin manquant retourne CHEMIN_MANQUANT', async () => {
  const { lspDefinition } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const r = await lspDefinition({}, () => {}, '/project', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CHEMIN_MANQUANT');
});

test('lsp_references — chemin manquant retourne CHEMIN_MANQUANT', async () => {
  const { lspReferences } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const r = await lspReferences({}, () => {}, '/project', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CHEMIN_MANQUANT');
});

test('lsp_hover — path-guard violation retourne CHEMIN_HORS_PROJET', async () => {
  const { lspHover } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  const strictGuard = (_p) => { throw new Error('hors-projet'); };
  const r = await lspHover({ path: '../secret.ts', line: 1 }, strictGuard, '/project', {});
  assert.equal(r.ok, false);
  assert.ok(r.error.startsWith('CHEMIN_HORS_PROJET'));
});

test('lsp_hover — serveur introuvable retourne erreur', async () => {
  // Purge le module pour réinitialiser le manager singleton
  Object.keys(require.cache).forEach(k => { if (k.includes('/tools/lsp')) delete require.cache[k]; });
  const { lspHover } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));

  const fakeGuard = (p) => path.join('/project', p);
  // On pointe vers un binaire inexistant
  const cfg = { lspServers: { typescript: '__binaire_inexistant_lsp__' } };
  const r = await lspHover({ path: 'src/foo.ts', line: 1 }, fakeGuard, '/project', cfg);
  assert.equal(r.ok, false);
  assert.ok(r.error, 'error doit être présent');
  // Purge pour les prochains tests
  Object.keys(require.cache).forEach(k => { if (k.includes('/tools/lsp')) delete require.cache[k]; });
});

// ── 3. disposeLsp ────────────────────────────────────────────────────────────

test('disposeLsp — fonctionne même sans manager actif', async () => {
  Object.keys(require.cache).forEach(k => { if (k.includes('/tools/lsp')) delete require.cache[k]; });
  const { disposeLsp } = require(path.join(ROOT, 'src/harness/tools/lsp.js'));
  await assert.doesNotReject(() => disposeLsp());
  Object.keys(require.cache).forEach(k => { if (k.includes('/tools/lsp')) delete require.cache[k]; });
});

// ── 4. Constantes ────────────────────────────────────────────────────────────

test('constantes LSP_HOVER / LSP_DEFINITION / LSP_REFERENCES', () => {
  const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
  assert.equal(TOOLS.LSP_HOVER,       'lsp_hover');
  assert.equal(TOOLS.LSP_DEFINITION,  'lsp_definition');
  assert.equal(TOOLS.LSP_REFERENCES,  'lsp_references');
});

// ── 5. Dispatch ──────────────────────────────────────────────────────────────

test('dispatch — 3 cases LSP présents dans index.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/index.js'), 'utf8');
  assert.ok(src.includes('case TOOLS.LSP_HOVER:'),       'case LSP_HOVER absent');
  assert.ok(src.includes('case TOOLS.LSP_DEFINITION:'),  'case LSP_DEFINITION absent');
  assert.ok(src.includes('case TOOLS.LSP_REFERENCES:'),  'case LSP_REFERENCES absent');
  assert.ok(src.includes("require('./lsp')"),            "import lsp absent");
});

// ── 6. Agent — toolNames + descriptions + dispose ────────────────────────────

test('agent — lsp_* ajoutés si enableLsp:true', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes("config.enableLsp"), 'garde enableLsp absente');
  assert.ok(src.includes("'lsp_hover', 'lsp_definition', 'lsp_references'"), 'push lsp tools absent');
});

test('agent — descriptions lsp dans allToolDefs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes('lsp_hover'),       'description lsp_hover absente');
  assert.ok(src.includes('lsp_definition'),  'description lsp_definition absente');
  assert.ok(src.includes('lsp_references'),  'description lsp_references absente');
});

test('agent — disposeLsp appelé aux 4 points de sortie', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes("require('./tools/lsp')"), 'import disposeLsp absent');
  const count = (src.match(/disposeLsp\(\)/g) || []).length;
  assert.equal(count, 4, `disposeLsp() appelé ${count} fois, attendu 4`);
});

// ── 7. Settings HTML ─────────────────────────────────────────────────────────

test('settings.html — toggle sm-enable-lsp présent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('sm-enable-lsp'),   'id sm-enable-lsp absent');
  assert.ok(html.includes('sm-lsp-config'),   'id sm-lsp-config absent');
  assert.ok(html.includes('sm-lsp-ts'),       'champ typescript absent');
  assert.ok(html.includes('sm-lsp-py'),       'champ python absent');
  assert.ok(html.includes('sm-lsp-rs'),       'champ rust absent');
  assert.ok(html.includes('sm-lsp-go'),       'champ go absent');
});

test('settings.html — hints installation présents', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('typescript-language-server'), 'hint typescript absent');
  assert.ok(html.includes('python-lsp-server'),          'hint python absent');
});

test('settings.html — sm-lsp-config démarre caché (sm-hidden)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('id="sm-lsp-config" class="sm-hidden"') ||
            html.includes("id=\"sm-lsp-config\" class=\"sm-hidden\""),
            'sm-lsp-config doit avoir la classe sm-hidden');
});

// ── 8. Settings JS ───────────────────────────────────────────────────────────

test('settings.js — lit enableLsp et lspServers depuis cfg', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('enableLsp'),       'enableLsp absent du settings.js');
  assert.ok(src.includes('lspServers'),      'lspServers absent du settings.js');
  assert.ok(src.includes('sm-lsp-ts'),       'sm-lsp-ts absent');
});

test('settings.js — helper _smToggleLspConfig défini', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('function _smToggleLspConfig'), '_smToggleLspConfig absent');
  assert.ok(src.includes('sm-lsp-config'),               'référence sm-lsp-config absente');
});

test('settings.js — handler change persiste enableLsp', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes("_autoSave({ enableLsp:"), 'handler _autoSave enableLsp absent');
});

test('settings.js — _saveLspServers persiste lspServers', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('_saveLspServers'), '_saveLspServers absent');
  assert.ok(src.includes("_autoSave({ lspServers:"), '_autoSave lspServers absent');
});
