/**
 * Tests Phase 79 — WebLLM local engine.
 *
 * 1. WebLlmEngine — délègue generate() au bridge IPC, isReady() le consulte.
 * 2. Registry — entrée 'webllm' marquée offline/free, factory accepte le bridge.
 * 3. LlmRouter — instancie WebLlmEngine via bridges.webllm, passe en fallback si non prêt.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { WebLlmEngine } = require('../src/harness/llm/engines/webllm');
const { registry }     = require('../src/harness/llm/registry');
const { LlmRouter }    = require('../src/harness/llm/router');

// ── Bridge IPC mocké ─────────────────────────────────────────────────────────

function _makeBridge({ ready = true, response = 'ok', fail = false } = {}) {
  return {
    isReady:     async () => ready,
    sendRequest: async (messages, opts) => {
      if (fail) throw new Error('BRIDGE_ERROR');
      return response;
    },
  };
}

// ── WebLlmEngine ─────────────────────────────────────────────────────────────

describe('WebLlmEngine — generate', () => {
  it('délègue au bridge et retourne la réponse', async () => {
    const bridge = _makeBridge({ response: 'bonjour' });
    const eng    = new WebLlmEngine({}, bridge);
    const text   = await eng.generate([{ role: 'user', content: 'salut' }]);
    assert.equal(text, 'bonjour');
  });

  it('throws WEBLLM_NO_BRIDGE sans bridge', async () => {
    const eng = new WebLlmEngine({});
    await assert.rejects(() => eng.generate([]), /WEBLLM_NO_BRIDGE/);
  });

  it('propage l\'erreur du bridge', async () => {
    const bridge = _makeBridge({ fail: true });
    const eng    = new WebLlmEngine({}, bridge);
    await assert.rejects(() => eng.generate([]), /BRIDGE_ERROR/);
  });
});

describe('WebLlmEngine — isReady', () => {
  it('retourne ready:true quand le bridge dit true', async () => {
    const eng = new WebLlmEngine({}, _makeBridge({ ready: true }));
    const r   = await eng.isReady();
    assert.equal(r.ready, true);
    assert.ok(r.info.includes('WebLlmEngine'));
  });

  it('retourne ready:false quand le bridge dit false', async () => {
    const eng = new WebLlmEngine({}, _makeBridge({ ready: false }));
    const r   = await eng.isReady();
    assert.equal(r.ready, false);
    assert.ok(r.error);
  });

  it('retourne ready:false sans bridge', async () => {
    const eng = new WebLlmEngine({});
    const r   = await eng.isReady();
    assert.equal(r.ready, false);
    assert.ok(r.error.includes('bridge'));
  });

  it('retourne ready:false si isReady() du bridge throw', async () => {
    const bridge = { isReady: async () => { throw new Error('IPC_DOWN'); }, sendRequest: async () => '' };
    const eng    = new WebLlmEngine({}, bridge);
    const r      = await eng.isReady();
    assert.equal(r.ready, false);
    assert.ok(r.error.includes('IPC_DOWN'));
  });
});

describe('WebLlmEngine — modèle par défaut', () => {
  it('utilise Qwen2.5-Coder-3B si aucun modèle fourni', () => {
    const eng = new WebLlmEngine({});
    assert.ok(eng.model.includes('Qwen2.5-Coder-3B'));
  });

  it('utilise le modèle fourni dans config', () => {
    const eng = new WebLlmEngine({ model: 'Qwen2.5-Coder-1.5B-q4f16_1-MLC' });
    assert.equal(eng.model, 'Qwen2.5-Coder-1.5B-q4f16_1-MLC');
  });
});

// ── Registry ─────────────────────────────────────────────────────────────────

describe('registry — entrée webllm', () => {
  it('existe dans le registry', () => {
    assert.ok(registry.webllm, 'registry.webllm absent');
  });

  it('est marqué offline:true et cost:free', () => {
    assert.equal(registry.webllm.offline, true);
    assert.equal(registry.webllm.cost, 'free');
  });

  it('ne requiert pas de clé API', () => {
    assert.equal(registry.webllm.requiresKey, false);
  });

  it('factory crée un WebLlmEngine avec le bridge', () => {
    const bridge = _makeBridge();
    const eng    = registry.webllm.factory({}, bridge);
    assert.ok(eng instanceof WebLlmEngine);
    assert.equal(eng.ipcBridge, bridge);
  });
});

// ── LlmRouter avec webllm ────────────────────────────────────────────────────

describe('LlmRouter — webllm via bridges', () => {
  it('instancie WebLlmEngine et génère', async () => {
    const bridge = _makeBridge({ response: 'résultat local' });
    const router = new LlmRouter(['webllm'], registry, {}, { webllm: bridge });
    const text   = await router.generate([{ role: 'user', content: 'test' }]);
    assert.equal(text, 'résultat local');
  });

  it('passe au fallback si webllm non prêt', async () => {
    // WebLLM non prêt, fallback vers un moteur cloud mocké
    const bridgeDown = _makeBridge({ ready: false });

    // Entrée cloud minimaliste
    const fakeCloud = {
      factory: () => ({
        isReady:  async () => ({ ready: true }),
        generate: async () => 'fallback cloud',
      }),
    };
    const localRegistry = { webllm: registry.webllm, cloud: fakeCloud };
    const router        = new LlmRouter(['webllm', 'cloud'], localRegistry, {}, { webllm: bridgeDown });
    const text          = await router.generate([{ role: 'user', content: 'test' }]);
    assert.equal(text, 'fallback cloud');
  });

  it('throw si tous les moteurs échouent', async () => {
    const bridgeDown = _makeBridge({ ready: false });
    const router     = new LlmRouter(['webllm'], registry, {}, { webllm: bridgeDown });
    await assert.rejects(
      () => router.generate([{ role: 'user', content: 'test' }]),
      /Tous les moteurs ont échoué/,
    );
  });

  it('statusAll retourne le statut webllm', async () => {
    const bridge = _makeBridge({ ready: true });
    const router = new LlmRouter(['webllm'], registry, {}, { webllm: bridge });
    const status = await router.statusAll();
    assert.ok('webllm' in status);
    assert.equal(status.webllm.ready, true);
  });
});
