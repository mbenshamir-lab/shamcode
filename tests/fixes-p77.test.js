'use strict';
/**
 * Tests Phase 77 — Les réglages des Paramètres agissent réellement.
 *
 * Constats corrigés :
 * 1. Au démarrage, la config visuelle n'était jamais appliquée : `_refreshStatusBar`
 *    appelait `_updateModelPill` qui lisait `modelPillLabel`, une `const` déclarée
 *    plus bas → ReferenceError (zone morte temporelle) avalée par le `catch`.
 * 2. La police choisie ne pilotait que `--mono` (code seul) et retombait sur
 *    Consolas : aucune différence visible.
 * 3. La densité ne changeait que la taille de `<body>`, masquée par les règles px.
 * 4. 11 variables CSS étaient utilisées mais jamais définies → survols et fonds
 *    silencieusement ignorés.
 * 5. `contextBudget` (jamais écrit) au lieu de `maxContextChars`, `topP`,
 *    `streaming` et `retryOnParseError` jamais transmis, « Tester / Charger »
 *    exigeait de retaper une clé déjà enregistrée.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const appJs       = read('src/renderer-visible/app.js');
const stylesCss   = read('src/renderer-visible/styles.css');
const settingsJs  = read('src/renderer-settings/settings.js');
const settingsHtml= read('src/renderer-settings/settings.html');
const ipcJs       = read('src/main/ipc.js');
const agentJs     = read('src/harness/agent.js');
const openaiJs    = read('src/harness/llm/engines/openai-compat.js');
const geminiJs    = read('src/harness/llm/engines/gemini.js');
const claudeJs    = read('src/harness/llm/engines/claude.js');

// ── 1. Démarrage : plus de zone morte temporelle ─────────────────────────────
describe('Phase 77 — application de la config au démarrage', () => {

  it('modelPillLabel est déclaré AVANT le bloc d\'initialisation', () => {
    const decl = appJs.indexOf('const modelPillLabel');
    const init = appJs.indexOf('currentConfig = await window.harness.getConfig()');
    assert.ok(decl !== -1, 'déclaration absente');
    assert.ok(init !== -1, 'initialisation absente');
    assert.ok(decl < init, 'modelPillLabel doit être déclaré avant getConfig (TDZ)');
  });

  it('le catch de l\'initialisation journalise l\'erreur (plus d\'échec muet)', () => {
    assert.ok(appJs.includes("console.error('[config] échec de l"), 'log d\'erreur absent');
    assert.ok(appJs.includes("engineState.textContent = 'Erreur config'"), 'message UI absent');
  });

  it('_applyVisualSettings pose le thème, l\'accent, la police et la densité', () => {
    const start = appJs.indexOf('function _applyVisualSettings');
    assert.ok(start !== -1);
    // Découpe jusqu'à la fonction suivante : une fenêtre de taille fixe cassait
    // dès qu'un commentaire était ajouté dans _applyVisualSettings.
    const end   = appJs.indexOf('\n  function ', start + 10);
    const block = appJs.slice(start, end !== -1 ? end : start + 1600);
    assert.ok(block.includes("setAttribute('data-theme'"), 'thème');
    assert.ok(block.includes("setProperty('--accent'"), 'accent');
    assert.ok(block.includes("setProperty('--accent-muted'"), 'accent atténué');
    assert.ok(block.includes("setProperty('--mono'"), 'police du code');
    assert.ok(block.includes("setProperty('--font'"), 'police de l\'interface');
    assert.ok(block.includes("setAttribute('data-density'"), 'densité');
  });
});

// ── 2. Police ────────────────────────────────────────────────────────────────
describe('Phase 77 — police réellement appliquée', () => {

  it('settings.js applique la police à l\'interface ET au code', () => {
    const start = settingsJs.indexOf('function _applyVisualSettings');
    const block = settingsJs.slice(start, start + 1200);
    assert.ok(block.includes("'--font'"), 'police interface absente');
    assert.ok(block.includes("'--mono'"), 'police code absente');
  });

  it('settings.js détecte les polices absentes du système', () => {
    assert.ok(settingsJs.includes('function _fontAvailable'), 'détection absente');
    assert.ok(settingsJs.includes('measureText'), 'mesure canvas absente');
    assert.ok(settingsJs.includes('sm-font-missing'), 'marquage visuel absent');
  });

  it('les polices absentes sont signalées dans la feuille de style', () => {
    assert.ok(stylesCss.includes('.sm-font-card.sm-font-missing'), 'style de police absente');
  });

  it('une police installée d\'office (Consolas) est proposée', () => {
    assert.ok(settingsHtml.includes('data-font="Consolas"'), 'option Consolas absente');
    assert.ok(settingsHtml.includes("Police de l'application"), 'libellé non mis à jour');
  });
});

// ── 3. Densité ───────────────────────────────────────────────────────────────
describe('Phase 77 — densité visible', () => {

  it('définit les tailles de base par densité', () => {
    for (const d of ['compact', 'normal', 'spacious']) {
      assert.ok(stylesCss.includes(`body[data-density="${d}"]`), `densité ${d} absente`);
    }
    assert.ok(stylesCss.includes('--fs-base'), '--fs-base absent');
    assert.ok(stylesCss.includes('--lh-base'), '--lh-base absent');
  });

  it('applique la taille de base aux textes du chat et de la saisie', () => {
    assert.ok(stylesCss.includes('#chat-area .message'), 'messages non concernés');
    assert.ok(stylesCss.includes('#task-input { font-size: var(--fs-base'), 'zone de saisie non concernée');
    assert.ok(stylesCss.includes('.sidebar-item-task'), 'sidebar non concernée');
  });
});

// ── 4. Variables CSS fantômes ────────────────────────────────────────────────
describe('Phase 77 — variables CSS utilisées mais jamais définies', () => {

  const defined = new Set([...stylesCss.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const used    = new Set([...stylesCss.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/gi)].map((m) => m[1]));

  it('toutes les variables utilisées sans repli sont définies', () => {
    const missing = [...used].filter((v) => !defined.has(v));
    assert.deepEqual(missing, [], `variables non définies : ${missing.join(', ')}`);
  });

  it('les alias historiques sont définis', () => {
    for (const v of ['--text-main', '--hover-bg', '--bg-elevated', '--bg-input', '--text3', '--warning']) {
      assert.ok(defined.has(v), `${v} non défini`);
    }
  });
});

// ── 5. Réglages transmis au moteur et au harness ─────────────────────────────
describe('Phase 77 — réglages réellement transmis', () => {

  it('ipc.js utilise maxContextChars (et non un contextBudget inexistant)', () => {
    assert.ok(ipcJs.includes('config.maxContextChars ?? MAX_CONTEXT_CHARS'), 'budget de contexte non câblé');
    assert.ok(!ipcJs.includes('config.contextBudget ?? 12000'), 'ancienne clé fantôme encore présente');
  });

  it('agent.js transmet topP et respecte streaming:false', () => {
    assert.ok(agentJs.includes('topP:        config.topP ?? 1') || agentJs.includes('topP: config.topP ?? 1'), 'topP non transmis');
    assert.ok(agentJs.includes('config.streaming === false'), 'streaming non respecté');
  });

  it('agent.js utilise retryOnParseError', () => {
    assert.ok(agentJs.includes('config.retryOnParseError'), 'retryOnParseError non utilisé');
    assert.ok(agentJs.includes('maxParseRetries'), 'boucle de reprise absente');
  });

  it('les moteurs transmettent top_p quand il est fourni', () => {
    assert.ok(openaiJs.includes('payload.top_p'), 'openai-compat : top_p absent');
    assert.ok(geminiJs.includes('generationConfig.topP'), 'gemini : topP absent');
    assert.ok(claudeJs.includes('body.top_p'), 'claude : top_p absent');
  });

  it('« Tester » et « Charger » retombent sur la clé enregistrée', () => {
    assert.ok(ipcJs.includes('saved.apiKey'), 'clé enregistrée non utilisée (listModels)');
    assert.ok(ipcJs.includes('savedCfg.apiKey'), 'clé enregistrée non utilisée (engine:test)');
  });

  it('l\'URL de base reste modifiable pour DeepSeek', () => {
    assert.ok(settingsJs.includes("engine === 'deepseek'"), 'DeepSeek exclu du champ URL de base');
  });
});

// ── 6. Comportement réel de la boucle d'agent ────────────────────────────────
describe('Phase 77 — boucle agent : options et reprises', () => {
  const { runAgent } = require('../src/harness/agent');

  const tmpDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-p77-'));
    process.env.APPDATA = dir;
    return dir;
  };

  it('transmet temperature + topP au moteur', async () => {
    const dir = tmpDir();
    const seen = [];
    await runAgent({
      task: 'options',
      projectRoot: dir,
      config: { temperature: 0.2, topP: 0.35 },
      llmGenerate: async (_msgs, opts) => { seen.push(opts); return '{"tool":"finish","args":{"summary":"ok"}}'; },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].temperature, 0.2);
    assert.equal(seen[0].topP, 0.35);
    assert.equal(typeof seen[0].onToken, 'function', 'streaming actif par défaut');
  });

  it('streaming:false → aucun onToken fourni au moteur', async () => {
    const dir = tmpDir();
    let opts = null;
    await runAgent({
      task: 'sans streaming',
      projectRoot: dir,
      config: { streaming: false },
      llmGenerate: async (_m, o) => { opts = o; return '{"tool":"finish","args":{"summary":"ok"}}'; },
    });
    assert.equal(opts.onToken, undefined);
  });

  it('retryOnParseError pilote le nombre de reprises avant de consommer une étape', async () => {
    const dir = tmpDir();
    let calls = 0;
    const result = await runAgent({
      task: 'json toujours invalide',
      projectRoot: dir,
      config: { retryOnParseError: 2, maxSteps: 1 },
      llmGenerate: async () => { calls++; return 'pas du json'; },
    });
    assert.equal(calls, 3, '1 essai + 2 reprises');
    assert.equal(result.error, 'MAX_STEPS_ATTEINT');
  });

  it('retryOnParseError: 0 → une seule génération par étape', async () => {
    const dir = tmpDir();
    let calls = 0;
    await runAgent({
      task: 'sans reprise',
      projectRoot: dir,
      config: { retryOnParseError: 0, maxSteps: 1 },
      llmGenerate: async () => { calls++; return 'pas du json'; },
    });
    assert.equal(calls, 1);
  });
});
