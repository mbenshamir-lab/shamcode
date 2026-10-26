/**
 * Phase 85 — web_search : DuckDuckGo sans clé API
 * Tests : outil web-search, constante, dispatch, agent toolNames, settings UI
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');

// ── Helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

function loadModule(rel) {
  return require(path.join(ROOT, rel));
}

// ── 1. web-search.js : validation des arguments ────────────────────────────

test('web_search — query manquante retourne QUERY_MANQUANTE', async () => {
  const { webSearch } = loadModule('src/harness/tools/web-search.js');
  const r = await webSearch({});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'QUERY_MANQUANTE');
});

test('web_search — query vide retourne QUERY_MANQUANTE', async () => {
  const { webSearch } = loadModule('src/harness/tools/web-search.js');
  const r = await webSearch({ query: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'QUERY_MANQUANTE');
});

test('web_search — module exporte webSearch', () => {
  const mod = loadModule('src/harness/tools/web-search.js');
  assert.equal(typeof mod.webSearch, 'function');
});

// ── 2. _resolveUrl / _clean via test d'intégration du parser interne ───────

test('web_search — erreur réseau retourne ok:false avec code erreur', async () => {
  const https = require('https');
  const orig  = https.request.bind(https);

  https.request = (_opts, _cb) => {
    // Simule une erreur réseau immédiate
    const fakeReq = {
      on(evt, handler) {
        if (evt === 'error') {
          process.nextTick(() => handler(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })));
        }
        return this;
      },
      end() {},
    };
    return fakeReq;
  };

  // Vider le cache require pour que le module relise https
  Object.keys(require.cache).forEach(k => { if (k.includes('web-search')) delete require.cache[k]; });

  try {
    const { webSearch } = require(path.join(ROOT, 'src/harness/tools/web-search.js'));
    const r = await webSearch({ query: 'test réseau' });
    assert.equal(r.ok, false);
    assert.ok(r.error, 'error doit être présent');
  } finally {
    https.request = orig;
    Object.keys(require.cache).forEach(k => { if (k.includes('web-search')) delete require.cache[k]; });
  }
});

// ── 3. Constante ────────────────────────────────────────────────────────────

test('constante WEB_SEARCH = "web_search"', () => {
  const { TOOLS } = loadModule('src/shared/constants.js');
  assert.equal(TOOLS.WEB_SEARCH, 'web_search');
});

// ── 4. Dispatch ─────────────────────────────────────────────────────────────

test('dispatch web_search — appelle webSearch', async () => {
  // On vérifie que le case existe dans index.js en cherchant dans le source
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/index.js'), 'utf8');
  assert.ok(src.includes("case TOOLS.WEB_SEARCH:"), 'case WEB_SEARCH manquant dans dispatch');
  assert.ok(src.includes('webSearch(args)'),         'appel webSearch(args) manquant');
  assert.ok(src.includes("require('./web-search')"), "import web-search manquant");
});

// ── 5. Agent — toolNames ────────────────────────────────────────────────────

test('agent — web_search dans toolNames par défaut (enableWebSearch non défini)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes("config.enableWebSearch !== false"), 'garde enableWebSearch manquante');
  assert.ok(src.includes("toolNames.push('web_search')"),    'push web_search manquant');
});

test('agent — description web_search présente dans allToolDefs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
  assert.ok(src.includes('web_search'), 'clé web_search absente de allToolDefs');
  assert.ok(src.includes('DuckDuckGo'), 'mention DuckDuckGo absente de la description');
});

// ── 6. Settings HTML ─────────────────────────────────────────────────────────

test('settings.html — contient le toggle sm-enable-web-search', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.html'), 'utf8');
  assert.ok(html.includes('sm-enable-web-search'),   'id sm-enable-web-search absent');
  assert.ok(html.includes('web_search'),              'label web_search absent');
  assert.ok(html.includes('DuckDuckGo'),              'mention DuckDuckGo absente');
});

// ── 7. Settings JS ───────────────────────────────────────────────────────────

test('settings.js — lit enableWebSearch depuis cfg', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  assert.ok(src.includes('enableWebSearch'), 'enableWebSearch absent du settings.js');
  assert.ok(src.includes('sm-enable-web-search'), 'id absent du settings.js');
});

test('settings.js — handler change persiste enableWebSearch', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-settings/settings.js'), 'utf8');
  // Vérifie que le handler appelle _autoSave avec enableWebSearch
  assert.ok(src.includes('_autoSave({ enableWebSearch:'), 'handler _autoSave enableWebSearch absent');
});

// ── 8. max_results plafonné à 8 ──────────────────────────────────────────────

test('web_search — MAX_RESULTS plafonné à 8 dans le source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/web-search.js'), 'utf8');
  assert.ok(src.includes('MAX_RESULTS  = 8'), 'MAX_RESULTS absent ou différent de 8');
  assert.ok(src.includes('Math.min(Math.max(1,'), 'clamp max_results absent');
});
