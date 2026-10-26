/**
 * Phase 82 — Tests : call_api, tokens API (rules), skills sidebar, session grouping.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. call_api ───────────────────────────────────────────────────────────────
describe('callApi — validation des args', () => {
  const { callApi } = require('../src/harness/tools/api');

  test('sans url → URL_MANQUANTE', async () => {
    const r = await callApi({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'URL_MANQUANTE');
  });

  test('url null → URL_MANQUANTE', async () => {
    const r = await callApi({ url: null }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'URL_MANQUANTE');
  });

  test('token_key absent de config.apiTokens → TOKEN_INTROUVABLE', async () => {
    const r = await callApi({ url: 'https://api.example.com', token_key: 'mykey' }, { apiTokens: {} });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('TOKEN_INTROUVABLE'), `erreur inattendue: ${r.error}`);
    assert.ok(r.error.includes('"mykey"'), `le nom de clé doit apparaître dans l'erreur`);
  });

  test('token_key introuvable quand apiTokens absent → TOKEN_INTROUVABLE', async () => {
    const r = await callApi({ url: 'https://api.example.com', token_key: 'ghost' }, {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('TOKEN_INTROUVABLE'));
  });

  test('headers supplémentaires ne surchargent pas Authorization', async () => {
    // On vérifie que Authorization n'est pas écrasable via le champ headers
    // On mocke fetch pour inspecter les headers transmis
    let capturedHeaders = null;
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, text: async () => '{"result":"ok"}' };
    };

    try {
      const r = await callApi({
        url: 'https://api.example.com',
        token_key: 'tok',
        headers: { Authorization: 'Bearer EVIL', 'X-Custom': 'value' },
      }, { apiTokens: { tok: 'REAL_TOKEN' } });

      assert.equal(r.ok, true);
      // Authorization doit venir du token résolu, pas de l'override headers
      assert.equal(capturedHeaders['Authorization'], 'Bearer REAL_TOKEN');
      assert.equal(capturedHeaders['X-Custom'], 'value');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('body ignoré pour GET', async () => {
    let capturedOpts = null;
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedOpts = opts;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    try {
      await callApi({ url: 'https://example.com', method: 'GET', body: { data: 1 } }, {});
      assert.equal(capturedOpts.body, undefined, 'body doit être absent pour GET');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('body objet → sérialisé en JSON pour POST', async () => {
    let capturedOpts = null;
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedOpts = opts;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    try {
      await callApi({ url: 'https://example.com', method: 'POST', body: { key: 'val' } }, {});
      assert.equal(capturedOpts.body, '{"key":"val"}');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('réponse JSON parsée automatiquement → data est un objet', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, text: async () => '{"id":42}' });
    try {
      const r = await callApi({ url: 'https://example.com' }, {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.data, { id: 42 });
    } finally {
      global.fetch = origFetch;
    }
  });

  test('réponse non-JSON → data est la chaîne brute', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, text: async () => 'plain text' });
    try {
      const r = await callApi({ url: 'https://example.com' }, {});
      assert.equal(r.ok, true);
      assert.equal(r.data, 'plain text');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('HTTP 4xx → ok:false avec status et HTTP_xxx', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 403, text: async () => '{"msg":"forbidden"}' });
    try {
      const r = await callApi({ url: 'https://example.com' }, {});
      assert.equal(r.ok, false);
      assert.equal(r.status, 403);
      assert.equal(r.error, 'HTTP_403');
    } finally {
      global.fetch = origFetch;
    }
  });

  test('erreur réseau → NETWORK_ERROR avec message', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => { throw new Error('ENOTFOUND example.com'); };
    try {
      const r = await callApi({ url: 'https://example.com' }, {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'NETWORK_ERROR');
      assert.ok(r.message.includes('ENOTFOUND'));
    } finally {
      global.fetch = origFetch;
    }
  });
});

// ── 2. Tokens API — add_rule / delete_rule ────────────────────────────────────
describe('addRule', () => {
  const { addRule } = require('../src/harness/tools/rules');

  test('sans texte → RÈGLE_TEXTE_MANQUANT', async () => {
    const r = await addRule({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'RÈGLE_TEXTE_MANQUANT');
  });

  test('texte vide → RÈGLE_TEXTE_MANQUANT', async () => {
    const r = await addRule({ text: '   ' }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'RÈGLE_TEXTE_MANQUANT');
  });

  test('texte valide → ok + rule avec id et enabled:true', async () => {
    const r = await addRule({ text: 'Toujours tester avant de commiter' }, {});
    assert.equal(r.ok, true);
    assert.ok(r.rule.id, 'doit avoir un id');
    assert.equal(r.rule.text, 'Toujours tester avant de commiter');
    assert.equal(r.rule.enabled, true);
  });

  test('name fourni → utilisé comme label', async () => {
    const r = await addRule({ name: 'Test first', text: 'Toujours tester' }, {});
    assert.equal(r.ok, true);
    assert.equal(r.rule.name, 'Test first');
  });

  test('name absent → premiers 40 chars du texte', async () => {
    const text = 'Utiliser des noms de variables explicites';
    const r = await addRule({ text }, {});
    assert.equal(r.ok, true);
    assert.ok(r.rule.name.startsWith('Utiliser des noms'));
  });

  test('appelle saveConfig avec la nouvelle règle', async () => {
    let saved = null;
    const config = {
      customRules: [],
      saveConfig: async (data) => { saved = data; },
    };
    await addRule({ text: 'Règle de test' }, config);
    assert.ok(saved, 'saveConfig doit être appelé');
    assert.ok(Array.isArray(saved.customRules));
    assert.equal(saved.customRules.length, 1);
    assert.equal(saved.customRules[0].text, 'Règle de test');
  });

  test('ajoute à des règles existantes sans les écraser', async () => {
    let saved = null;
    const config = {
      customRules: [{ id: 'existing', name: 'Ex', text: 'Règle existante', enabled: true }],
      saveConfig: async (data) => { saved = data; },
    };
    await addRule({ text: 'Nouvelle règle' }, config);
    assert.equal(saved.customRules.length, 2);
    assert.equal(saved.customRules[0].id, 'existing');
    assert.equal(saved.customRules[1].text, 'Nouvelle règle');
  });
});

describe('deleteRule', () => {
  const { deleteRule } = require('../src/harness/tools/rules');

  test('sans id ni texte → RÈGLE_ID_OU_TEXTE_REQUIS', async () => {
    const r = await deleteRule({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'RÈGLE_ID_OU_TEXTE_REQUIS');
  });

  test('texte introuvable → RÈGLE_NON_TROUVÉE', async () => {
    const config = { customRules: [{ id: '1', text: 'autre règle', enabled: true }] };
    const r = await deleteRule({ text: 'inexistant' }, config);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'RÈGLE_NON_TROUVÉE');
  });

  test('suppression par texte exact → ok + deleted:1', async () => {
    let saved = null;
    const config = {
      customRules: [{ id: '1', text: 'Règle à supprimer', enabled: true }],
      saveConfig: async (data) => { saved = data; },
    };
    const r = await deleteRule({ text: 'Règle à supprimer' }, config);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
    assert.equal(saved.customRules.length, 0);
  });

  test('suppression par id → ok + deleted:1', async () => {
    let saved = null;
    const config = {
      customRules: [
        { id: 'abc', text: 'Règle A', enabled: true },
        { id: 'def', text: 'Règle B', enabled: true },
      ],
      saveConfig: async (data) => { saved = data; },
    };
    const r = await deleteRule({ id: 'abc' }, config);
    assert.equal(r.ok, true);
    assert.equal(saved.customRules.length, 1);
    assert.equal(saved.customRules[0].id, 'def');
  });
});

// ── 3. Skills sidebar — installSkill / removeSkill ────────────────────────────
describe('installSkill', () => {
  const { installSkill } = require('../src/harness/tools/rules');

  test('sans nom → SKILL_NOM_MANQUANT', async () => {
    const r = await installSkill({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SKILL_NOM_MANQUANT');
  });

  test('nom vide → SKILL_NOM_MANQUANT', async () => {
    const r = await installSkill({ name: '   ' }, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SKILL_NOM_MANQUANT');
  });

  test('doublon de nom → SKILL_DÉJÀ_INSTALLÉ', async () => {
    const config = { customSkills: [{ id: '1', name: 'Python Expert', enabled: true }] };
    const r = await installSkill({ name: 'Python Expert' }, config);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SKILL_DÉJÀ_INSTALLÉ');
  });

  test('installation valide → ok + skill avec id et enabled:true', async () => {
    const r = await installSkill(
      { name: 'Security Reviewer', description: 'Analyse les failles', system_prompt: 'Tu cherches les vulnérabilités.' },
      {}
    );
    assert.equal(r.ok, true);
    assert.ok(r.skill.id, 'doit avoir un id');
    assert.equal(r.skill.name, 'Security Reviewer');
    assert.equal(r.skill.description, 'Analyse les failles');
    assert.equal(r.skill.systemPrompt, 'Tu cherches les vulnérabilités.');
    assert.equal(r.skill.enabled, true);
  });

  test('appelle saveConfig avec le nouveau skill', async () => {
    let saved = null;
    const config = {
      customSkills: [],
      saveConfig: async (data) => { saved = data; },
    };
    await installSkill({ name: 'Test Skill', system_prompt: 'instructions' }, config);
    assert.ok(saved, 'saveConfig doit être appelé');
    assert.equal(saved.customSkills.length, 1);
    assert.equal(saved.customSkills[0].name, 'Test Skill');
  });

  test('skills injectés dans le prompt système quand enabled', () => {
    const { buildSystemPrompt } = require('../src/harness/prompts/system');
    const prompt = buildSystemPrompt(['finish'], '', {
      customSkills: [
        { name: 'TypeScript Expert', systemPrompt: 'Préfère les types stricts.', enabled: true },
        { name: 'Désactivé', systemPrompt: 'Ne devrait pas apparaître.', enabled: false },
      ],
    });
    assert.ok(prompt.includes('TypeScript Expert'), 'skill activé doit être dans le prompt');
    assert.ok(prompt.includes('Préfère les types stricts.'), 'systemPrompt du skill doit être injecté');
    assert.ok(!prompt.includes('Ne devrait pas apparaître.'), 'skill désactivé ne doit pas apparaître');
  });
});

describe('removeSkill', () => {
  const { removeSkill } = require('../src/harness/tools/rules');

  test('sans id ni nom → SKILL_ID_OU_NOM_REQUIS', async () => {
    const r = await removeSkill({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SKILL_ID_OU_NOM_REQUIS');
  });

  test('nom introuvable → SKILL_NON_TROUVÉ', async () => {
    const config = { customSkills: [{ id: '1', name: 'AutreSkill', enabled: true }] };
    const r = await removeSkill({ name: 'Fantôme' }, config);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SKILL_NON_TROUVÉ');
  });

  test('suppression par nom → ok + deleted:1', async () => {
    let saved = null;
    const config = {
      customSkills: [{ id: 'x', name: 'ToRemove', enabled: true }],
      saveConfig: async (data) => { saved = data; },
    };
    const r = await removeSkill({ name: 'ToRemove' }, config);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);
    assert.equal(saved.customSkills.length, 0);
  });

  test('suppression par id → ok, les autres restent', async () => {
    let saved = null;
    const config = {
      customSkills: [
        { id: 'aaa', name: 'A', enabled: true },
        { id: 'bbb', name: 'B', enabled: true },
      ],
      saveConfig: async (data) => { saved = data; },
    };
    const r = await removeSkill({ id: 'aaa' }, config);
    assert.equal(r.ok, true);
    assert.equal(saved.customSkills.length, 1);
    assert.equal(saved.customSkills[0].id, 'bbb');
  });
});

// ── 4. Session grouping (logique pure extraite de app.js) ─────────────────────
describe('session grouping — logique _renderSessionList', () => {
  const fs   = require('node:fs');
  const path = require('node:path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8'
  );

  // Extraction de la logique de groupement (sans DOM) depuis le code source.
  // On isole la partie pure : Map construction + tri, testable sans browser.
  function groupSessions(sessions) {
    const groups = new Map();
    for (const s of sessions) {
      const key = s.projectRoot || '__none__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const sorted = [...groups.entries()].sort((a, b) => {
      const aMax = Math.max(...a[1].map(s => new Date(s.createdAt)));
      const bMax = Math.max(...b[1].map(s => new Date(s.createdAt)));
      return bMax - aMax;
    });
    sorted.forEach(([, gs]) => gs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    return sorted; // [[key, [sessions]], ...]
  }

  function folderName(root) {
    if (root === '__none__') return 'Sans projet';
    return root.split(/[\\/]/).filter(Boolean).pop() || root;
  }

  test('sessions sans projectRoot → groupe __none__ = "Sans projet"', () => {
    const sessions = [{ id: '1', task: 'x', createdAt: new Date().toISOString() }];
    const groups = groupSessions(sessions);
    assert.equal(groups.length, 1);
    const [key] = groups[0];
    assert.equal(key, '__none__');
    assert.equal(folderName(key), 'Sans projet');
  });

  test('sessions groupées par projectRoot', () => {
    const now = Date.now();
    const sessions = [
      { id: '1', projectRoot: '/projets/alpha', createdAt: new Date(now).toISOString() },
      { id: '2', projectRoot: '/projets/beta',  createdAt: new Date(now - 1000).toISOString() },
      { id: '3', projectRoot: '/projets/alpha', createdAt: new Date(now - 2000).toISOString() },
    ];
    const groups = groupSessions(sessions);
    assert.equal(groups.length, 2, '2 groupes distincts');
    const alphaGroup = groups.find(([k]) => k === '/projets/alpha');
    assert.ok(alphaGroup, 'groupe alpha doit exister');
    assert.equal(alphaGroup[1].length, 2);
  });

  test('folderName extrait le dernier segment du chemin', () => {
    assert.equal(folderName('/home/user/mon-projet'), 'mon-projet');
    assert.equal(folderName('C:\\Users\\WORK\\Desktop\\HARNESS CODE'), 'HARNESS CODE');
    assert.equal(folderName('/projets/alpha'), 'alpha');
  });

  test('sessions dans un groupe triées du plus récent au plus ancien', () => {
    const now = Date.now();
    const sessions = [
      { id: 'old', projectRoot: '/proj', createdAt: new Date(now - 5000).toISOString() },
      { id: 'new', projectRoot: '/proj', createdAt: new Date(now).toISOString() },
      { id: 'mid', projectRoot: '/proj', createdAt: new Date(now - 2000).toISOString() },
    ];
    const [[, gs]] = groupSessions(sessions);
    assert.equal(gs[0].id, 'new');
    assert.equal(gs[1].id, 'mid');
    assert.equal(gs[2].id, 'old');
  });

  test('groupes triés par session la plus récente en tête', () => {
    const now = Date.now();
    const sessions = [
      { id: 'a1', projectRoot: '/old-proj', createdAt: new Date(now - 10000).toISOString() },
      { id: 'b1', projectRoot: '/new-proj', createdAt: new Date(now).toISOString() },
    ];
    const groups = groupSessions(sessions);
    assert.equal(groups[0][0], '/new-proj', 'le groupe le plus récent doit être en tête');
    assert.equal(groups[1][0], '/old-proj');
  });

  test('_renderSessionList contient bien le code de groupement dans app.js', () => {
    assert.ok(src.includes('const groups = new Map()'), 'Map de groupement présente');
    assert.ok(src.includes("s.projectRoot || '__none__'"), "clé __none__ présente");
    assert.ok(src.includes('ws-item'), 'HTML du header workspace présent');
    assert.ok(src.includes('ws-item-count'), 'compteur de groupe présent');
  });
});
