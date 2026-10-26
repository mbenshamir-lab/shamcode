'use strict';
// Tests unitaires pour CpuEngine + câblage registre/constantes/settings.

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');
const path = require('path');
const fs   = require('fs');

// ── Helpers mock ───────────────────────────────────────────────────────────────

/** Crée un mock node-llama-cpp complet et injectable. */
function _makeMock({ promptResult = 'réponse mock', promptError = null } = {}) {
  const disposeCtx  = { called: false };
  const disposeModel = { called: false };
  const disposeLlama = { called: false };

  const mockSequence = {};
  const mockContext = {
    getSequence: () => mockSequence,
    dispose:     async () => { disposeCtx.called = true; },
  };
  const mockSession = {
    _history:       null,
    reloadHistory:  async (h) => { mockSession._history = h; },
    prompt:         async (text, opts) => {
      if (promptError) throw new Error(promptError);
      if (opts?.onTextChunk) opts.onTextChunk('token');
      return promptResult;
    },
  };

  const MockLlamaChatSession = function(opts) {
    this._opts    = opts;
    this.reloadHistory = mockSession.reloadHistory;
    this.prompt        = mockSession.prompt;
  };

  const mockModel  = {
    createContext: async () => mockContext,
    dispose:       async () => { disposeModel.called = true; },
  };
  const mockLlama  = {
    loadModel: async ({ modelPath: p }) => {
      mockLlama._loadedPath = p;
      return mockModel;
    },
    dispose: async () => { disposeLlama.called = true; },
    _loadedPath: null,
  };

  const mockImport = async () => ({
    getLlama:         async () => mockLlama,
    LlamaChatSession: MockLlamaChatSession,
  });

  return { mockImport, mockLlama, mockModel, mockContext, mockSession, disposeCtx, disposeModel, disposeLlama };
}

// ── CpuEngine — unit tests ─────────────────────────────────────────────────────

describe('CpuEngine', () => {
  const { CpuEngine } = require('../src/harness/llm/engines/cpu');

  it('isReady() → erreur si modelPath vide', async () => {
    const eng = new CpuEngine({});
    const r = await eng.isReady();
    assert.equal(r.ready, false);
    assert.ok(r.error.includes('configuré'));
  });

  it('isReady() → erreur si fichier introuvable', async () => {
    const eng = new CpuEngine({ modelPath: '/tmp/does-not-exist.gguf' });
    const r = await eng.isReady();
    assert.equal(r.ready, false);
    assert.ok(r.error.includes('introuvable'));
  });

  it('isReady() → ok si fichier existe', async () => {
    // Créer un fichier temporaire
    const tmp = path.join(require('os').tmpdir(), 'test-model.gguf');
    fs.writeFileSync(tmp, 'fake');
    try {
      const eng = new CpuEngine({ modelPath: tmp });
      const r = await eng.isReady();
      assert.equal(r.ready, true);
      assert.ok(r.info.includes('test-model.gguf'));
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('generate() → erreur CPU_NO_MODEL_PATH si modelPath vide', async () => {
    const { mockImport } = _makeMock();
    const eng = new CpuEngine({}, mockImport);
    await assert.rejects(eng.generate([{ role: 'user', content: 'test' }]), /CPU_NO_MODEL_PATH/);
  });

  it('generate() → charge le modèle paresseusement et retourne la réponse', async () => {
    const { mockImport, mockLlama } = _makeMock({ promptResult: 'réponse attendue' });
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, mockImport);
    const r = await eng.generate([{ role: 'user', content: 'bonjour' }]);
    assert.equal(r, 'réponse attendue');
    assert.equal(mockLlama._loadedPath, '/fake/model.gguf');
  });

  it('generate() → charge le modèle une seule fois (lazy)', async () => {
    let loadCount = 0;
    const { mockImport } = _makeMock();
    const origImport = mockImport;
    const countingImport = async () => {
      const m = await origImport();
      const origGetLlama = m.getLlama;
      m.getLlama = async () => {
        const l = await origGetLlama();
        const origLoad = l.loadModel;
        l.loadModel = async (opts) => { loadCount++; return origLoad(opts); };
        return l;
      };
      return m;
    };
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, countingImport);
    await eng.generate([{ role: 'user', content: 'q1' }]);
    await eng.generate([{ role: 'user', content: 'q2' }]);
    assert.equal(loadCount, 1, 'loadModel ne doit être appelé qu\'une seule fois');
  });

  it('generate() → extrait le message system comme systemPrompt', async () => {
    let capturedOpts = null;
    const { mockImport } = _makeMock();
    const origImport = mockImport;
    const spyImport = async () => {
      const m = await origImport();
      const OrigSession = m.LlamaChatSession;
      m.LlamaChatSession = function(opts) {
        capturedOpts = opts;
        return new OrigSession(opts);
      };
      return m;
    };
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, spyImport);
    await eng.generate([
      { role: 'system', content: 'Tu es un assistant.' },
      { role: 'user',   content: 'bonjour' },
    ]);
    assert.equal(capturedOpts?.systemPrompt, 'Tu es un assistant.');
  });

  it('generate() → appelle onToken si streaming', async () => {
    const tokens = [];
    const { mockImport } = _makeMock({ promptResult: 'ok' });
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, mockImport);
    await eng.generate([{ role: 'user', content: 'test' }], { onToken: t => tokens.push(t) });
    assert.ok(tokens.length > 0);
  });

  it('generate() → appelle onUsage avec outputTokens estimés', async () => {
    let usage = null;
    const { mockImport } = _makeMock({ promptResult: 'résultat' });
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, mockImport);
    await eng.generate([{ role: 'user', content: 'q' }], { onUsage: u => { usage = u; } });
    assert.ok(usage, 'onUsage doit être appelé');
    assert.ok(typeof usage.outputTokens === 'number');
    assert.equal(usage.inputTokens, 0);
  });

  it('generate() → propage l\'erreur du prompt', async () => {
    const { mockImport } = _makeMock({ promptError: 'LLAMA_ERREUR' });
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, mockImport);
    await assert.rejects(
      eng.generate([{ role: 'user', content: 'test' }]),
      /LLAMA_ERREUR/
    );
  });

  it('dispose() → libère le modèle et le contexte llama', async () => {
    const { mockImport, disposeModel, disposeLlama } = _makeMock();
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' }, mockImport);
    await eng.generate([{ role: 'user', content: 'test' }]);
    await eng.dispose();
    assert.equal(disposeModel.called, true);
    assert.equal(disposeLlama.called, true);
    assert.equal(eng._ctx, null);
  });

  it('dispose() → sans génération préalable ne lève pas d\'erreur', async () => {
    const eng = new CpuEngine({ modelPath: '/fake/model.gguf' });
    await assert.doesNotReject(() => eng.dispose());
  });
});

// ── Registre ───────────────────────────────────────────────────────────────────

describe('registry — cpu', () => {
  const { registry } = require('../src/harness/llm/registry');

  it('cpu est présent dans le registre', () => {
    assert.ok(registry.cpu, 'registry.cpu doit exister');
  });

  it('cpu : offline=true, requiresKey=false, cost=free', () => {
    assert.equal(registry.cpu.offline, true);
    assert.equal(registry.cpu.requiresKey, false);
    assert.equal(registry.cpu.cost, 'free');
  });

  it('cpu factory retourne une CpuEngine', () => {
    const { CpuEngine } = require('../src/harness/llm/engines/cpu');
    const eng = registry.cpu.factory({ modelPath: '/tmp/m.gguf' });
    assert.ok(eng instanceof CpuEngine);
  });
});

// ── Constantes ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  const { ENGINES, IPC } = require('../src/shared/constants');

  it('ENGINES.CPU vaut "cpu"', () => {
    assert.equal(ENGINES.CPU, 'cpu');
  });

  it('IPC.FILE_DIALOG vaut "file:dialog"', () => {
    assert.equal(IPC.FILE_DIALOG, 'file:dialog');
  });
});

// ── Settings HTML ──────────────────────────────────────────────────────────────

describe('settings.html — cpu', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer-settings', 'settings.html'),
    'utf8'
  );

  it('contient l\'option cpu dans le select du moteur', () => {
    assert.ok(html.includes('value="cpu"'), 'option value="cpu" doit être présente');
  });

  it('contient le bloc sm-row-cpu', () => {
    assert.ok(html.includes('id="sm-row-cpu"'));
  });

  it('sm-row-cpu contient le champ sm-cpu-model-path', () => {
    assert.ok(html.includes('id="sm-cpu-model-path"'));
  });

  it('contient le bouton sm-cpu-browse', () => {
    assert.ok(html.includes('id="sm-cpu-browse"'));
  });

  it('cpu dans la chaîne de fallback', () => {
    assert.ok(html.includes('data-engine="cpu"'));
  });
});

// ── Preload settings ───────────────────────────────────────────────────────────

describe('preload-settings.js', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'preload-settings.js'),
    'utf8'
  );

  it('expose selectFile via ipcRenderer.invoke(IPC.FILE_DIALOG)', () => {
    assert.ok(src.includes('selectFile'));
    assert.ok(src.includes('IPC.FILE_DIALOG'));
  });
});
