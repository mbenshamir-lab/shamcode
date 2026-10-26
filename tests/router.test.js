const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { LlmRouter } = require('../src/harness/llm/router');

// Helpers : moteurs mock
function makeEngine({ readyResult, generateResult }) {
  return {
    async isReady()            { return readyResult; },
    async generate()           { return generateResult; },
    async dispose()            {},
  };
}

function makeRegistry(engines) {
  const reg = {};
  for (const [name, inst] of Object.entries(engines)) {
    reg[name] = { factory: () => inst };
  }
  return reg;
}

test('router — moteur primaire disponible → utilise primaire', async () => {
  const primary  = makeEngine({ readyResult: { ready: true }, generateResult: 'pong-primary' });
  const fallback = makeEngine({ readyResult: { ready: true }, generateResult: 'pong-fallback' });
  const reg = makeRegistry({ a: primary, b: fallback });
  const router = new LlmRouter(['a', 'b'], reg, {});
  const out = await router.generate([{ role: 'user', content: 'ping' }]);
  assert.equal(out, 'pong-primary');
});

test('router — primaire échoue → utilise fallback', async () => {
  const broken   = makeEngine({ readyResult: { ready: false, error: 'indispo' }, generateResult: '' });
  const fallback = makeEngine({ readyResult: { ready: true  }, generateResult: 'pong-fallback' });
  const reg = makeRegistry({ broken, fallback });
  const router = new LlmRouter(['broken', 'fallback'], reg, {});
  const out = await router.generate([{ role: 'user', content: 'ping' }]);
  assert.equal(out, 'pong-fallback');
});

test('router — tous les moteurs échouent → erreur claire', async () => {
  const bad1 = makeEngine({ readyResult: { ready: false, error: 'err1' }, generateResult: '' });
  const bad2 = makeEngine({ readyResult: { ready: false, error: 'err2' }, generateResult: '' });
  const reg  = makeRegistry({ bad1, bad2 });
  const router = new LlmRouter(['bad1', 'bad2'], reg, {});
  await assert.rejects(
    () => router.generate([{ role: 'user', content: 'ping' }]),
    /Tous les moteurs/,
  );
});

test('router — clé API manquante → erreur explicite', async () => {
  const noKey = {
    async isReady()  { return { ready: false, error: 'Clé API manquante' }; },
    async generate() { return ''; },
    async dispose()  {},
  };
  const reg    = makeRegistry({ noKey });
  const router = new LlmRouter(['noKey'], reg, {});
  await assert.rejects(
    () => router.generate([{ role: 'user', content: 'ping' }]),
    /Tous les moteurs/,
  );
});

test('router — moteur inconnu ignoré, suivant utilisé', async () => {
  const ok  = makeEngine({ readyResult: { ready: true }, generateResult: 'ok' });
  const reg = makeRegistry({ ok }); // 'missing' absent du registre
  const router = new LlmRouter(['missing', 'ok'], reg, {});
  const out = await router.generate([{ role: 'user', content: 'ping' }]);
  assert.equal(out, 'ok');
});

test('router — generate lève une erreur → passe au suivant', async () => {
  const crashing = {
    async isReady()  { return { ready: true }; },
    async generate() { throw new Error('crash réseau'); },
    async dispose()  {},
  };
  const ok  = makeEngine({ readyResult: { ready: true }, generateResult: 'recovered' });
  const reg = makeRegistry({ crashing, ok });
  const router = new LlmRouter(['crashing', 'ok'], reg, {});
  const out = await router.generate([{ role: 'user', content: 'ping' }]);
  assert.equal(out, 'recovered');
});
