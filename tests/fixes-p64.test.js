/**
 * Tests Phase 64 — Réflexion animée, intention annoncée, mémoire contextuelle
 *
 * 1. parser.js — le champ "intent" est extrait (borné, facultatif)
 * 2. agent.js — émet `thinking` + `context_usage`, transmet l'intention au tool_call
 * 3. prompt — l'intention est obligatoire et documentée (+ exemples)
 * 4. app.js / index.html / styles.css — animation, ligne d'intention, jauge de contexte
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { extractToolCall } = require('../src/harness/parser');
const { runAgent }        = require('../src/harness/agent');
const { buildSystemPrompt } = require('../src/harness/prompts/system');
const { getExamples }     = require('../src/harness/prompts/examples');

const src  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-p64-'));
  process.env.APPDATA = d;
  return d;
}

describe('parser — intention du tool call', () => {
  it('extrait intent', () => {
    const r = extractToolCall('{"tool":"read_file","intent":"Lire a.js","args":{"path":"a.js"}}');
    assert.equal(r.intent, 'Lire a.js');
    assert.equal(r.tool, 'read_file');
  });

  it('tolère l\'absence d\'intent', () => {
    const r = extractToolCall('{"tool":"read_file","args":{"path":"a.js"}}');
    assert.equal(r.intent, undefined);
    assert.ok(!('intent' in r), 'pas de clé intent vide');
  });

  it('borne l\'intention à 300 caractères', () => {
    const long = 'x'.repeat(600);
    const r = extractToolCall(`{"tool":"read_file","intent":"${long}","args":{}}`);
    assert.equal(r.intent.length, 300);
  });

  it('ignore un intent non textuel', () => {
    const r = extractToolCall('{"tool":"read_file","intent":42,"args":{}}');
    assert.equal(r.intent, undefined);
  });
});

describe('agent — réflexion, contexte et intention', () => {
  it('émet thinking et context_usage avant chaque génération', async () => {
    const dir = tmpDir();
    const events = [];
    await runAgent({
      task: 'lire un fichier',
      projectRoot: dir,
      llmGenerate: async () => '{"tool":"finish","args":{"summary":"ok"}}',
      onEvent: e => events.push(e),
    });
    const thinking = events.filter(e => e.type === 'thinking');
    const ctx      = events.filter(e => e.type === 'context_usage');
    assert.ok(thinking.length >= 1, 'événement thinking attendu');
    assert.ok(ctx.length >= 1, 'événement context_usage attendu');
    assert.ok(ctx[0].estimatedTokens > 0, 'tokens estimés > 0');
    assert.ok(ctx[0].chars > 0, 'caractères du prompt');
  });

  it('transmet l\'intention dans tool_call et dans la trace', async () => {
    const dir = tmpDir();
    const events = [];
    const result = await runAgent({
      task: 'finir',
      projectRoot: dir,
      llmGenerate: async () => '{"tool":"finish","intent":"Terminer la tâche","args":{"summary":"fini"}}',
      onEvent: e => events.push(e),
    });
    const call = events.find(e => e.type === 'tool_call');
    assert.equal(call.intent, 'Terminer la tâche');
    assert.equal(result.trace[0].intent, 'Terminer la tâche');
  });

  it('context_usage reflète la taille réelle du prompt envoyé', async () => {
    const dir = tmpDir();
    const events = [];
    let received = '';
    await runAgent({
      task: 'mesure du contexte',
      projectRoot: dir,
      llmGenerate: async (msgs) => { received = msgs.map(m => m.content).join(''); return '{"tool":"finish","args":{"summary":"ok"}}'; },
      onEvent: e => events.push(e),
    });
    const ctx = events.find(e => e.type === 'context_usage');
    assert.ok(ctx.chars >= received.length * 0.9, 'chars proches du prompt réel');
  });
});

describe('prompt — intention obligatoire', () => {
  const prompt = buildSystemPrompt(['read_file', 'finish']);

  it('le format inclut intent', () => {
    assert.ok(prompt.includes('"intent":'), 'champ intent dans le format');
  });

  it('la règle est explicite : au moins deux phrases', () => {
    assert.ok(prompt.includes('INTENTION — DEUX PHRASES MINIMUM À CHAQUE ACTION'), 'section intention');
    assert.ok(prompt.includes('AU MOINS DEUX phrases'), 'minimum de deux phrases');
    assert.ok(prompt.includes('max 220 caractères'), 'borne de longueur');
  });

  it('les exemples few-shot montrent intent', () => {
    const ex = getExamples('js');
    assert.ok((ex.match(/"intent":/g) || []).length >= 4, 'exemples avec intention');
  });

  it('chaque intention d\'exemple contient au moins deux phrases', () => {
    const langs = ['js', 'ts', 'py', 'rust', 'go'];
    for (const lang of langs) {
      const ex = getExamples(lang);
      const intents = [...ex.matchAll(/"intent":"([^"]+)"/g)].map(m => m[1]);
      assert.ok(intents.length >= 4, `${lang} : intentions présentes`);
      for (const intent of intents) {
        const boundaries = (intent.match(/[.!?]\s+[A-ZÀ-Þ]/g) || []).length;
        assert.ok(boundaries >= 1, `${lang} : « ${intent} » n'a qu'une phrase`);
      }
    }
  });
});

describe('UI — animation, intention et jauge de contexte', () => {
  it('le topbar prévoit la jauge #ctx-usage', () => {
    assert.ok(html.includes('id="ctx-usage"'), 'élément de jauge requis');
  });

  it('_activityThinking affiche une animation dédiée', () => {
    const idx = src.indexOf('function _activityThinking');
    assert.ok(idx !== -1, '_activityThinking requise');
    const block = src.slice(idx, idx + 600);
    assert.ok(block.includes('Réflexion en cours'), 'libellé');
    assert.ok(block.includes("kind: 'think'"), 'famille de couleur');
    assert.ok(block.includes('thinking'), 'classe d\'animation');
  });

  it('l\'intention est affichée avant l\'action', () => {
    const idx = src.indexOf('function _activityStep');
    const block = src.slice(idx, idx + 900);
    assert.ok(block.includes('intent'), 'intention reçue');
    assert.ok(block.includes('_activityIntent.textContent'), 'ligne d\'intention');
  });

  it('les événements thinking / context_usage sont branchés', () => {
    assert.ok(src.includes("event.type === 'thinking'"), 'événement thinking');
    assert.ok(src.includes("event.type === 'context_usage'"), 'événement context_usage');
    assert.ok(src.includes('_updateContextUsage'), 'mise à jour de la jauge');
  });

  it('la jauge calcule un pourcentage par moteur', () => {
    const idx = src.indexOf('function _updateContextUsage');
    const block = src.slice(idx, idx + 800);
    assert.ok(block.includes('CONTEXT_WINDOW'), 'fenêtres par moteur');
    assert.ok(block.includes('Math.round((used / win) * 100)'), 'pourcentage');
    assert.ok(block.includes("pct >= 80 ? 'high'"), 'seuils de couleur');
  });

  it('la jauge repart à zéro pour chaque tâche', () => {
    const idx = src.indexOf('async function sendTask');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('_resetContextUsage()'), 'remise à zéro');
  });

  it('CSS : animation de réflexion, intention et jauge', () => {
    for (const sel of ['.act-kw-think', '.activity-current.thinking .activity-spinner', '.activity-intent', '.ctx-usage', '.ctx-usage.high']) {
      assert.ok(css.includes(sel), `${sel} manquant`);
    }
  });
});
