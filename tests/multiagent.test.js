const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { createSharedBus, enableCollaboration, postMessage, readMessages } = require('../src/harness/tools/message-bus');
const { spawnAgent } = require('../src/harness/tools/spawn');
const { askUser } = require('../src/harness/tools/ask');
const { dispatch } = require('../src/harness/tools/index');
const { makeGuard } = require('../src/harness/safety/path-guard');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ma-'));
  process.env.APPDATA = d;
  return d;
}

function mockLlm(responses) {
  let i = 0;
  return async () => responses[i < responses.length ? i++ : responses.length - 1];
}

// ── createSharedBus ───────────────────────────────────────────────────────────

describe('createSharedBus', () => {
  test('post + readFor(all) retourne le message', () => {
    const bus = createSharedBus();
    bus.post('main', 'all', 'bonjour');
    const msgs = bus.readFor('analyzer');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'bonjour');
    assert.equal(msgs[0].from, 'main');
  });

  test('readFor filtre par destinataire', () => {
    const bus = createSharedBus();
    bus.post('main', 'debugger', 'pour debugger seulement');
    bus.post('main', 'all', 'pour tous');
    assert.equal(bus.readFor('debugger').length, 2);
    assert.equal(bus.readFor('analyzer').length, 1);
  });

  test('size reflète le nombre de messages', () => {
    const bus = createSharedBus();
    assert.equal(bus.size, 0);
    bus.post('a', 'all', 'msg1');
    bus.post('b', 'all', 'msg2');
    assert.equal(bus.size, 2);
  });
});

// ── enableCollaboration ───────────────────────────────────────────────────────

describe('enableCollaboration', () => {
  test('active le bus et retourne ok', () => {
    const config = {};
    const events = [];
    const r = enableCollaboration({}, config, e => events.push(e));
    assert.ok(r.ok);
    assert.ok(config._sharedBus);
    assert.ok(events.some(e => e.type === 'collaboration_enabled'));
  });

  test('déjà actif → already_active', () => {
    const config = { _sharedBus: createSharedBus() };
    const r = enableCollaboration({}, config, () => {});
    assert.ok(r.ok);
    assert.ok(r.already_active);
  });
});

// ── postMessage / readMessages ────────────────────────────────────────────────

describe('postMessage / readMessages', () => {
  test('post puis read récupère le message', () => {
    const bus = createSharedBus();
    const config = { _sharedBus: bus, _subRole: 'main' };
    postMessage({ to: 'all', content: 'tâche prête' }, config, () => {});
    const r = readMessages({}, { _sharedBus: bus, _subRole: 'analyzer' });
    assert.ok(r.ok);
    assert.equal(r.count, 1);
    assert.equal(r.messages[0].content, 'tâche prête');
  });

  test('post sans bus → BUS_NON_ACTIF', () => {
    const r = postMessage({ to: 'all', content: 'test' }, {}, () => {});
    assert.ok(!r.ok);
    assert.ok(r.error.includes('BUS_NON_ACTIF'));
  });

  test('read sans bus → BUS_NON_ACTIF', () => {
    const r = readMessages({}, {});
    assert.ok(!r.ok);
    assert.ok(r.error.includes('BUS_NON_ACTIF'));
  });

  test('post sans contenu → erreur', () => {
    const bus = createSharedBus();
    const r = postMessage({ to: 'all' }, { _sharedBus: bus }, () => {});
    assert.ok(!r.ok);
    assert.equal(r.error, 'POST_MESSAGE_SANS_CONTENU');
  });

  test('read filtre par from', () => {
    const bus = createSharedBus();
    bus.post('alpha', 'all', 'msg alpha');
    bus.post('beta', 'all', 'msg beta');
    const r = readMessages({ from: 'alpha' }, { _sharedBus: bus, _subRole: 'main' });
    assert.equal(r.count, 1);
    assert.equal(r.messages[0].from, 'alpha');
  });
});

// ── askUser ───────────────────────────────────────────────────────────────────

describe('askUser', () => {
  test('sans requestUserInput → réponse simulée (mode test)', async () => {
    const r = await askUser({ question: 'Quelle option ?', suggestions: ['A', 'B'] }, {}, () => {});
    assert.ok(r.ok);
    assert.equal(r.answer, 'A');
  });

  test('sans question → ASK_SANS_QUESTION', async () => {
    const r = await askUser({}, {}, () => {});
    assert.ok(!r.ok);
    assert.equal(r.error, 'ASK_SANS_QUESTION');
  });

  test('requestUserInput retourne false → ANNULÉ', async () => {
    const config = { requestUserInput: async () => false };
    const r = await askUser({ question: 'test ?' }, config, () => {});
    assert.ok(!r.ok);
    assert.equal(r.error, 'ANNULÉ');
  });

  test('requestUserInput retourne une réponse → ok', async () => {
    const config = { requestUserInput: async () => 'réponse utilisateur' };
    const r = await askUser({ question: 'nom ?' }, config, () => {});
    assert.ok(r.ok);
    assert.equal(r.answer, 'réponse utilisateur');
  });
});

// ── spawnAgent ────────────────────────────────────────────────────────────────

describe('spawnAgent', () => {
  test('rôle inconnu → ROLE_INCONNU', async () => {
    const r = await spawnAgent({ role: 'inexistant', task: 'test' }, {}, () => {}, os.tmpdir());
    assert.ok(!r.ok);
    assert.ok(r.error.includes('ROLE_INCONNU'));
  });

  test('sans tâche → SOUS_AGENT_SANS_TACHE', async () => {
    const r = await spawnAgent({ role: 'analyzer' }, {}, () => {}, os.tmpdir());
    assert.ok(!r.ok);
    assert.equal(r.error, 'SOUS_AGENT_SANS_TACHE');
  });

  test('sans _llmGenerate → LLM_NON_INJECTABLE_SOUS_AGENT', async () => {
    const r = await spawnAgent({ role: 'analyzer', task: 'lire fichiers' }, {}, () => {}, os.tmpdir());
    assert.ok(!r.ok);
    assert.equal(r.error, 'LLM_NON_INJECTABLE_SOUS_AGENT');
  });

  test('sous-agent analyzer finit en succès', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'hello.js'), 'console.log("hi");');
    const events = [];
    const llm = mockLlm(['{"tool":"finish","args":{"summary":"Analyse complète."}}']);
    const config = {
      _llmGenerate: llm,
      _signal:      null,
      maxSteps:     10,
    };
    const r = await spawnAgent({ role: 'analyzer', task: 'Analyse ce projet' }, config, e => events.push(e), dir);
    assert.ok(r.ok, r.error);
    assert.equal(r.role, 'analyzer');
    assert.ok(r.summary);
    assert.ok(events.some(e => e.type === 'sub_agent_start'));
    assert.ok(events.some(e => e.type === 'sub_agent_done'));
  });

  test('sous-agent propage le bus si actif', async () => {
    const dir = tmpDir();
    const bus = createSharedBus();
    const events = [];
    const llm = mockLlm([
      '{"tool":"post_message","args":{"to":"all","content":"analyse faite"}}',
      '{"tool":"finish","args":{"summary":"ok"}}',
    ]);
    const config = {
      _llmGenerate: llm,
      _signal:      null,
      _sharedBus:   bus,
      maxSteps:     5,
    };
    const r = await spawnAgent({ role: 'analyzer', task: 'envoyer un message' }, config, e => events.push(e), dir);
    assert.ok(r.ok, r.error);
    // Le message doit être dans le bus
    assert.ok(bus.size >= 1);
  });
});

// ── dispatch — outil plan ─────────────────────────────────────────────────────

describe('dispatch plan', () => {
  let dir, guard;

  before(() => {
    dir = tmpDir();
    guard = makeGuard(dir);
  });

  test('plan sans requestPlanApproval → plan_ready event', async () => {
    const events = [];
    const r = await dispatch('plan', {
      objective: 'Refactorer le module auth',
      goals: ['Améliorer la lisibilité'],
      steps: ['1. Lire les fichiers', '2. Refactorer'],
    }, guard, {}, e => events.push(e), dir);
    assert.ok(r.ok);
    assert.ok(events.some(e => e.type === 'plan_ready'));
  });

  test('plan sans objective → PLAN_SANS_OBJECTIF', async () => {
    const r = await dispatch('plan', { goals: [], steps: [] }, guard, {}, () => {}, dir);
    assert.ok(!r.ok);
    assert.equal(r.error, 'PLAN_SANS_OBJECTIF');
  });

  test('plan avec requestPlanApproval approuvé → ok', async () => {
    const config = { requestPlanApproval: async () => true };
    const r = await dispatch('plan', {
      objective: 'Test', goals: [], steps: [],
    }, guard, config, () => {}, dir);
    assert.ok(r.ok);
    assert.ok(r.planned);
  });

  test('plan rejeté par utilisateur → PLAN_REJETÉ', async () => {
    const config = { requestPlanApproval: async () => false };
    const r = await dispatch('plan', {
      objective: 'Test', goals: [], steps: [],
    }, guard, config, () => {}, dir);
    assert.ok(!r.ok);
    assert.equal(r.error, 'PLAN_REJETÉ_PAR_UTILISATEUR');
  });
});
