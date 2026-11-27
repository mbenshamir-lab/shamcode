'use strict';

// Phase 121 — protection des secrets (ADR-041) : domaines par token, chiffrement
// sur disque et masquage de la configuration envoyée aux renderers.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const Module = require('module');
const { EventEmitter } = require('events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p121-'));
process.env.HARNESS_DATA_DIR = SANDBOX;
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

// ── Electron simulé : safeStorage réversible et pilotable ────────────────────
const storage = { available: true, broken: false };
const safeStorage = {
  isEncryptionAvailable: () => storage.available,
  encryptString: s => Buffer.from(`\u0001dpapi:${[...s].reverse().join('')}`, 'utf8'),
  decryptString: (b) => {
    const text = b.toString('utf8');
    if (storage.broken || !text.startsWith('\u0001dpapi:')) throw new Error('illisible');
    return [...text.slice(7)].reverse().join('');
  },
};
const broadcasts = [];
const handlers = new Map();
const ipcMain = new EventEmitter();
ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
const electron = {
  ipcMain, safeStorage, dialog: {}, Notification: {},
  app: { getAppPath: () => '.' },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (c, p) => broadcasts.push([c, p]) } }] },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
};

const { callApi } = require('../src/harness/tools/api');
const safeKeys    = require('../src/main/safe-keys');
const { IPC }     = require('../src/shared/constants');

const clone = v => JSON.parse(JSON.stringify(v));
const SECRETS = ['sk-engine', 'sk-provider', 'ghp-token', 'mcp-auth'];
const assertNoSecret = (value) => {
  const text = JSON.stringify(value);
  for (const s of SECRETS) assert.ok(!text.includes(s), `${s} exposé dans ${text}`);
};
const sample = () => ({
  model: { primary: 'gemini', engines: { gemini: { apiKey: 'sk-engine', model: 'g' }, cpu: { modelPath: '/m' } } },
  customProviders: [{ id: 'p1', name: 'or', baseUrl: 'https://or.test/v1', apiKey: 'sk-provider' }],
  apiTokens: { github: 'ghp-token' },
  apiTokenHosts: { github: ['api.github.com'] },
  connectors: [{ id: 'c1', name: 'mcp', type: 'http', url: 'https://mcp.test', auth: 'mcp-auth', enabled: true }],
});

describe('call_api — domaines autorisés par token', () => {
  async function call(url, hosts, extra = {}) {
    const original = global.fetch;
    const sent = [];
    global.fetch = async (u, opts) => { sent.push(opts); return { ok: true, status: 200, headers: new Map(), text: async () => '{}' }; };
    try {
      const r = await callApi({ url, token_key: 'github', ...extra },
        { apiTokens: { github: 'ghp-token' }, ...(hosts ? { apiTokenHosts: { github: hosts } } : {}) });
      return { r, sent };
    } finally { global.fetch = original; }
  }

  it('refuse un token sans domaine déclaré, en indiquant où le saisir', async () => {
    for (const hosts of [undefined, [], ['']]) {
      const { r, sent } = await call('https://api.github.com/user', hosts);
      assert.match(String(r.error), /DOMAINE_NON_DÉCLARÉ.*Tokens API/);
      assert.equal(sent.length, 0);
    }
  });

  it('refuse tout autre domaine, y compris les imitations', async () => {
    for (const url of [
      'https://evil.test/x', 'https://api.github.com.evil.test/x', 'https://api.github.com@evil.test/x',
      'https://sub.api.github.com/x', 'https://github.com/x',
    ]) {
      const { r, sent } = await call(url, ['api.github.com']);
      assert.match(String(r.error), /DOMAINE_NON_AUTORISÉ/, url);
      assert.equal(sent.length, 0);
    }
  });

  it('envoie le token au domaine déclaré, sans suivre de redirection', async () => {
    const { r, sent } = await call('https://API.GitHub.com/user', ['https://api.github.com/v3']);
    assert.equal(r.ok, true, r.error);
    assert.equal(sent[0].headers.Authorization, 'Bearer ghp-token');
    assert.equal(sent[0].redirect, 'manual');
  });

  it('exige HTTPS, sauf vers la machine locale', async () => {
    const { r } = await call('http://api.github.com/user', ['api.github.com']);
    assert.match(String(r.error), /HTTPS_REQUIS/);
    const local = await call('http://localhost:3000/x', ['localhost']);
    assert.equal(local.r.ok, true, local.r.error);
  });

  it('respecte un port déclaré', async () => {
    assert.equal((await call('http://127.0.0.1:3000/x', ['127.0.0.1:3000'])).r.ok, true);
    assert.match(String((await call('http://127.0.0.1:4000/x', ['127.0.0.1:3000'])).r.error), /DOMAINE_NON_AUTORISÉ/);
  });

  it('une redirection ne transporte pas le token ailleurs', async () => {
    const received = [];
    const target = http.createServer((req, res) => { received.push(req.headers.authorization); res.end('{}'); });
    await new Promise(r => target.listen(0, '127.0.0.1', r));
    const origin = http.createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/vol` });
      res.end();
    });
    await new Promise(r => origin.listen(0, '127.0.0.1', r));
    try {
      const port = origin.address().port;
      const r = await callApi({ url: `http://127.0.0.1:${port}/a`, token_key: 't' },
        { apiTokens: { t: 'ghp-token' }, apiTokenHosts: { t: [`127.0.0.1:${port}`] } });
      assert.equal(r.error, 'REDIRECTION_NON_SUIVIE');
      assert.match(r.location, /\/vol$/);
      assert.equal(received.length, 0);
    } finally { origin.close(); target.close(); }
  });

  it('un nom hérité d\'Object n\'est pas un token', async () => {
    const r = await callApi({ url: 'https://x.test', token_key: 'constructor' }, { apiTokens: {} });
    assert.match(r.error, /TOKEN_INTROUVABLE/);
  });
});

describe('safe-keys — chiffrement sur disque', () => {
  it('ne laisse aucun secret en clair et se relit', () => {
    const config = sample();
    const saved = safeKeys.prepareConfigForSave(config);
    assertNoSecret(saved);
    assert.equal(config.apiTokens.github, 'ghp-token', 'la configuration en mémoire est intacte');
    const loaded = clone(saved);
    safeKeys.resolveAllKeys(loaded);
    assert.equal(loaded.model.engines.gemini.apiKey, 'sk-engine');
    assert.equal(loaded.customProviders[0].apiKey, 'sk-provider');
    assert.equal(loaded.apiTokens.github, 'ghp-token');
    assert.equal(loaded.connectors[0].auth, 'mcp-auth');
  });

  it('conserve la forme chiffrée d\'un secret indéchiffrable', () => {
    const saved = safeKeys.prepareConfigForSave(sample());
    storage.broken = true;
    try {
      const loaded = clone(saved);
      safeKeys.resolveAllKeys(loaded);
      assert.equal(loaded.apiTokens.github, '');
      const again = safeKeys.prepareConfigForSave(loaded);
      assert.equal(again.apiTokensEncrypted.github, saved.apiTokensEncrypted.github);
      assert.equal(again.customProviders[0].apiKeyEncrypted, saved.customProviders[0].apiKeyEncrypted);
      assert.equal(again.connectors[0].authEncrypted, saved.connectors[0].authEncrypted);
      assert.equal(again.model.engines.gemini.apiKeyEncrypted, saved.model.engines.gemini.apiKeyEncrypted);
    } finally { storage.broken = false; }
  });

  it('oublie la forme chiffrée d\'un token retiré', () => {
    const config = { apiTokens: {}, apiTokensEncrypted: { ancien: 'x' } };
    assert.deepEqual(safeKeys.prepareConfigForSave(config).apiTokensEncrypted ?? {}, {});
  });
});

describe('public-config — masquage et fusion', () => {
  const { toPublicConfig, mergeConfigUpdate } = require('../src/main/public-config');
  /** Ce que fait config:set : fusion puis remplacement des clés de premier niveau. */
  const apply = (current, updates) => Object.assign(current, mergeConfigUpdate(current, updates));

  it('ne transmet aucun secret, seulement des indicateurs', () => {
    const config = safeKeys.prepareConfigForSave(sample());
    safeKeys.resolveAllKeys(config);
    const pub = toPublicConfig(config, { secretsEncrypted: true });
    assertNoSecret(pub);
    assert.doesNotMatch(JSON.stringify(pub), /(apiKey|auth|apiTokens)Encrypted/);
    assert.equal(pub.model.engines.gemini.hasKey, true);
    assert.equal(pub.model.engines.cpu.hasKey, false);
    assert.equal(pub.customProviders[0].hasKey, true);
    assert.equal(pub.connectors[0].hasAuth, true);
    assert.deepEqual(pub.apiTokens, { github: '' });
    assert.deepEqual(pub.apiTokensSaved, { github: true });
    assert.equal(pub.secretsEncrypted, true);
    assert.equal(config.apiTokens.github, 'ghp-token', 'la source est intacte');
  });

  it('renvoyer la configuration masquée entière ne perd aucun secret', () => {
    const config = sample();
    apply(config, toPublicConfig(config, { secretsEncrypted: true }));
    assert.equal(config.model.engines.gemini.apiKey, 'sk-engine');
    assert.equal(config.customProviders[0].apiKey, 'sk-provider');
    assert.equal(config.apiTokens.github, 'ghp-token');
    assert.equal(config.connectors[0].auth, 'mcp-auth');
    assert.doesNotMatch(JSON.stringify(config), /hasKey|hasAuth|apiTokensSaved|secretsEncrypted/);
  });

  it('une nouvelle valeur remplace l\'ancienne et sa forme chiffrée', () => {
    const config = sample();
    config.model.engines.gemini.apiKeyEncrypted = 'périmé';
    config.apiTokensEncrypted = { github: 'périmé' };
    const pub = toPublicConfig(config);
    pub.model.engines.gemini.apiKey = 'neuve';
    pub.apiTokens.github = 'neuf';
    apply(config, pub);
    assert.equal(config.model.engines.gemini.apiKey, 'neuve');
    assert.equal(config.model.engines.gemini.apiKeyEncrypted, undefined);
    assert.equal(config.apiTokens.github, 'neuf');
    assert.deepEqual(config.apiTokensEncrypted, {});
  });

  it('retirer une entrée supprime son secret, sans résurrection', () => {
    const config = sample();
    config.apiTokensEncrypted = { github: 'chiffré' };
    apply(config, { apiTokens: {}, customProviders: [], connectors: [] });
    assert.deepEqual([config.apiTokens, config.apiTokensEncrypted, config.customProviders, config.connectors], [{}, {}, [], []]);
    apply(config, { apiTokens: { github: '' } });
    assert.equal(config.apiTokens.github, '');
    assert.deepEqual(config.apiTokensEncrypted, {});
  });

  it('un renommage garde la valeur du token', () => {
    const config = sample();
    config.apiTokensEncrypted = { github: 'chiffré' };
    apply(config, { apiTokens: { gh: '' }, apiTokenRenames: { gh: 'github' } });
    assert.deepEqual(config.apiTokens, { gh: 'ghp-token' });
    assert.deepEqual(config.apiTokensEncrypted, { gh: 'chiffré' });
    assert.equal(config.apiTokenRenames, undefined);
  });

  it('un échange de noms ne mélange pas les valeurs', () => {
    const config = { apiTokens: { a: 'va', b: 'vb' } };
    apply(config, { apiTokens: { a: '', b: '' }, apiTokenRenames: { a: 'b', b: 'a' } });
    assert.deepEqual(config.apiTokens, { a: 'vb', b: 'va' });
  });

  it('un renderer ne peut pas injecter de forme chiffrée', () => {
    const config = sample();
    apply(config, {
      customProviders: [{ id: 'p2', apiKeyEncrypted: 'injecté' }],
      connectors: [{ id: 'c2', authEncrypted: 'injecté' }],
      apiTokens: { x: '' }, apiTokensEncrypted: { x: 'injecté' },
      model: { primary: 'gemini', engines: { claude: { apiKeyEncrypted: 'injecté' } } },
    });
    assert.doesNotMatch(JSON.stringify(config), /injecté/);
  });

  it('une mise à jour partielle du modèle garde les autres moteurs', () => {
    const config = sample();
    apply(config, { model: { primary: 'cpu' } });
    assert.equal(config.model.engines.gemini.apiKey, 'sk-engine');
  });
});

describe('processus principal — canaux de configuration', () => {
  const config = sample();
  let registered = false;
  function register() {
    if (registered) return;
    registered = true;
    const { registerIpcHandlers } = require('../src/main/ipc');
    const win = { isDestroyed: () => false, webContents: { once: () => {}, send: () => {}, isDestroyed: () => false } };
    registerIpcHandlers({ visibleWin: win, hiddenWin: win, config });
  }

  it('config:get ne porte aucun secret', async () => {
    register();
    assertNoSecret(await handlers.get(IPC.CONFIG_GET)());
  });

  it('config:set préserve les secrets, chiffre le disque et diffuse masqué', async () => {
    register();
    const pub = await handlers.get(IPC.CONFIG_GET)();
    broadcasts.length = 0;
    const res = await handlers.get(IPC.CONFIG_SET)({ sender: {} }, { ...pub, theme: 'light' });
    assert.equal(res.ok, true, res.error);
    assertNoSecret(res.config);
    assert.ok(broadcasts.length > 0);
    assertNoSecret(broadcasts);
    assert.equal(config.customProviders[0].apiKey, 'sk-provider');
    const disk = fs.readFileSync(path.join(SANDBOX, 'config.json'), 'utf8');
    assertNoSecret(JSON.parse(disk));
    assert.match(disk, /apiTokensEncrypted/);
    const { loadConfig } = require('../src/main/config');
    const reloaded = await loadConfig();
    assert.equal(reloaded.apiTokens.github, 'ghp-token');
    assert.equal(reloaded.connectors[0].auth, 'mcp-auth');
  });

  it('models:list n\'envoie la clé d\'un fournisseur qu\'à son URL enregistrée', async () => {
    register();
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => { calls.push([url, opts.headers.Authorization]); return { ok: true, json: async () => ({ data: [{ id: 'm' }] }) }; };
    try {
      const list = handlers.get(IPC.MODELS_LIST);
      const r = await list({}, { engine: 'openai-compat', providerId: 'p1', apiKey: '', baseUrl: 'https://evil.test/v1' });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(calls[0], ['https://or.test/v1/models', 'Bearer sk-provider']);
      await list({}, { engine: 'openai-compat', providerId: 'p1', apiKey: 'saisie', baseUrl: 'https://nouveau.test/v1' });
      assert.deepEqual(calls[1], ['https://nouveau.test/v1/models', 'Bearer saisie']);
    } finally { global.fetch = original; }
  });
});

describe('interfaces', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  it('la fenêtre principale s\'appuie sur hasKey et ne lit plus aucune clé', () => {
    const app = read('src/renderer-visible/app.js');
    assert.doesNotMatch(app, /\.apiKey\b|apiKeyEncrypted/);
    assert.match(app, /\.hasKey/);
  });

  it('les Paramètres n\'affichent plus les secrets enregistrés', () => {
    const settings = read('src/renderer-settings/settings.js');
    assert.doesNotMatch(settings, /value="\$\{\(prov\.apiKey|value="\$\{value/);
    assert.match(read('src/renderer-settings/settings.html'), /id="sm-secrets-warning"/);
  });
});
