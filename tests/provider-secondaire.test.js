/**
 * Tests — modèle d'un « moteur secondaire » (fournisseurs IA des Paramètres).
 *
 * Avant : choisir un modèle d'un fournisseur secondaire dans la pastille du
 * composer ne modifiait que l'affichage — l'agent continuait sur le moteur
 * principal, le modèle secondaire était donc inutilisable.
 *
 * Après : la sélection écrit `model.activeProvider` et `_buildRouter` place ce
 * fournisseur en tête de chaîne, déclaré au runtime comme moteur
 * OpenAI-compatible (jamais dans le registre statique).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const { LlmRouter }          = require('../src/harness/llm/router');
const { registry }           = require('../src/harness/llm/registry');
const { OpenAiCompatEngine } = require('../src/harness/llm/engines/openai-compat');

const ROOT   = path.join(__dirname, '..');
const ipcSrc = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');

// ── Fournisseur secondaire de test ──────────────────────────────────────────

const PROVIDER = {
  id:            'prov-1',
  name:          'openrouter',
  baseUrl:       'https://openrouter.test/v1',
  apiKey:        'sk-secondaire',
  model:         'mistral-large',
  availableModels: ['mistral-large', 'qwen-2.5-72b'],
};

/** Reproduit ce que _buildRouter fabrique pour un fournisseur actif. */
function _routerFor(config, fetchImpl) {
  const globalFetch = global.fetch;
  global.fetch = fetchImpl;
  const primary = config.model.activeProvider;
  const runtimeRegistry = {
    ...registry,
    [primary]: { factory: (cfg) => new OpenAiCompatEngine(cfg) },
  };
  const engines = {
    ...(config.model.engines || {}),
    [primary]: { baseUrl: PROVIDER.baseUrl, apiKey: PROVIDER.apiKey, model: PROVIDER.model },
  };
  const chain = [primary, ...(config.model.fallbacks || []).filter(f => f !== primary)];
  const router = new LlmRouter(chain, runtimeRegistry, { ...config, model: { ...config.model, engines } });
  return { router, restore: () => { global.fetch = globalFetch; } };
}

function _ok(value) {
  return { ok: true, json: async () => value };
}

// ── Câblage — main ──────────────────────────────────────────────────────────

describe('_buildRouter — fournisseur secondaire en tête de chaîne', () => {
  it('lit config.model.activeProvider', () => {
    assert.match(ipcSrc, /config\.model\?\.activeProvider/);
  });

  it('résout le fournisseur dans config.customProviders', () => {
    assert.match(ipcSrc, /customProviders \|\| \[\]\)\.find\(p => p\.id === activeId\)/);
  });

  it('ignore un fournisseur sans URL ou sans clé (repli sur le principal)', () => {
    assert.match(ipcSrc, /provider && provider\.baseUrl && provider\.apiKey \? provider : null/);
    assert.match(ipcSrc, /const primary   = usable \? usable\.id : \(config\.model\?\.primary/);
  });

  it('déclare le fournisseur au runtime avec le moteur OpenAI-compatible', () => {
    assert.match(ipcSrc, /runtimeRegistry = \{\s*\n\s*\.\.\.registry,/);
    assert.match(ipcSrc, /factory:     \(cfg\) => new OpenAiCompatEngine\(cfg\)/);
  });

  it('injecte baseUrl / clé / modèle du fournisseur dans engines[<id>]', () => {
    assert.match(ipcSrc, /engines\[usable\.id\] = \{/);
    assert.match(ipcSrc, /baseUrl: usable\.baseUrl/);
    assert.match(ipcSrc, /apiKey:  usable\.apiKey/);
  });

  it('ne modifie pas la config d\'origine (copie avant injection)', () => {
    assert.match(ipcSrc, /const routerCfg = usable \? \{ \.\.\.config, model: \{ \.\.\.config\.model, engines \} \} : config/);
  });

  it('changer de moteur principal annule le fournisseur secondaire', () => {
    assert.match(ipcSrc, /const prevPrimary = config\.model\?\.primary;/);
    assert.match(ipcSrc, /config\.model\.primary !== prevPrimary\) config\.model\.activeProvider = null/);
  });
});

describe('_buildRouter — génération réelle via le fournisseur', () => {
  it('envoie la requête à l\'URL du fournisseur avec sa clé et son modèle', async () => {
    let capturedUrl = '';
    let capturedBody = null;
    const headers = {};
    const { router, restore } = _routerFor(
      { model: { primary: 'openai-compat', activeProvider: PROVIDER.id, engines: {} }, customProviders: [PROVIDER] },
      async (url, init) => {
        capturedUrl  = url;
        capturedBody = JSON.parse(init.body);
        Object.assign(headers, init.headers);
        return _ok({ choices: [{ message: { content: 'réponse fournisseur' } }] });
      },
    );
    try {
      const text = await router.generate([{ role: 'user', content: 'salut' }]);
      assert.equal(text, 'réponse fournisseur');
      assert.equal(capturedUrl, 'https://openrouter.test/v1/chat/completions');
      assert.equal(capturedBody.model, 'mistral-large');
      assert.equal(headers.Authorization, 'Bearer sk-secondaire');
    } finally { restore(); }
  });

  it('le moteur principal reste disponible en repli quand le fournisseur échoue', async () => {
    const { router, restore } = _routerFor(
      {
        model: {
          primary: 'openai-compat',
          activeProvider: PROVIDER.id,
          fallbacks: ['openai-compat'],
          engines: { 'openai-compat': { baseUrl: 'https://principal.test/v1', apiKey: 'principal-key', model: 'modele-principal' } },
        },
        customProviders: [PROVIDER],
      },
      async (url) => {
        if (url.includes('openrouter.test')) throw new Error('PROVIDER_DOWN');
        return _ok({ choices: [{ message: { content: 'réponse principale' } }] });
      },
    );
    try {
      const text = await router.generate([{ role: 'user', content: 'salut' }]);
      assert.equal(text, 'réponse principale');
    } finally { restore(); }
  });

  it('sans activeProvider, la chaîne démarre sur le moteur principal', () => {
    const chain = ['openai-compat', ...[]];
    const router = new LlmRouter(chain, registry, { model: { primary: 'openai-compat', engines: {} } });
    assert.deepEqual(router.chain, ['openai-compat']);
    assert.equal(router.registry, registry);
  });
});

// ── Câblage — renderer ──────────────────────────────────────────────────────

describe('Pastille de modèle — sélection d\'un fournisseur secondaire', () => {
  it('expose _activeProviderOf et ignore un fournisseur incomplet', () => {
    assert.match(appSrc, /function _activeProviderOf\(cfg\)/);
    assert.match(appSrc, /p\.id === id && p\.baseUrl && p\.apiKey/);
  });

  it('la sélection écrit activeProvider (le moteur change réellement)', () => {
    assert.match(appSrc, /model: \{ \.\.\.currentConfig\.model, activeProvider: prov\.id \}/);
  });

  it('choisir un modèle du moteur principal désactive le fournisseur', () => {
    assert.match(appSrc, /activeProvider: null, engines:/);
  });

  it('la pastille affiche le nom du fournisseur et son modèle', () => {
    assert.match(appSrc, /const provider  = active \? \(active\.name \|\| 'Secondaire'\)/);
    assert.match(appSrc, /active\.model \|\| cfg\?\.model\?\.engines\?\.\[active\.id\]\?\.model/);
  });

  it('la barre de statut reflète le fournisseur actif', () => {
    assert.match(appSrc, /const hasKey = active \? !!active\.apiKey : !!/);
  });

  it('le modèle actif est marqué dans le groupe du fournisseur sélectionné', () => {
    assert.match(appSrc, /const activeSec = activeProv === prov\.id \? prov\.model : null/);
    assert.match(appSrc, /if \(id === activeprimary && !activeProv\) item\.classList\.add\('selected'\)/);
  });
});
