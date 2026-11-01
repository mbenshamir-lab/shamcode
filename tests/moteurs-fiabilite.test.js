'use strict';
/**
 * Non-régression du lot moteurs : requêtes refusées par les modèles récents, réponses
 * coupées, pannes passagères, cache de prompt, images. `fetch` est simulé : aucun appel réseau.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'moteurs-fiabilite-'));
process.env.APPDATA = tmpBase;

const { ClaudeEngine }       = require('../src/harness/llm/engines/claude');
const { GeminiEngine }       = require('../src/harness/llm/engines/gemini');
const { OpenAiCompatEngine } = require('../src/harness/llm/engines/openai-compat');
const { LlmRouter }          = require('../src/harness/llm/router');
const { runAgent }           = require('../src/harness/agent');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

/** Simule une réponse JSON et mémorise le corps envoyé. */
function mockFetch(payload, sent = []) {
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => payload };
  };
  return sent;
}

const textReply = (extra = {}) => ({
  content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

const messages = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'tâche' }];
const sampling = { temperature: 0.1, topP: 1 };

describe('ClaudeEngine — requête', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5-1']) {
    it(`${model} : ni temperature ni top_p`, async () => {
      const sent = mockFetch(textReply());
      await new ClaudeEngine({ apiKey: 'k', model }).generate(messages, sampling);
      assert.equal('temperature' in sent[0], false);
      assert.equal('top_p' in sent[0], false);
    });
  }

  for (const model of ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022']) {
    it(`${model} : temperature seule`, async () => {
      const sent = mockFetch(textReply());
      await new ClaudeEngine({ apiKey: 'k', model }).generate(messages, sampling);
      assert.equal(sent[0].temperature, 0.1);
      assert.equal('top_p' in sent[0], false);
    });
  }

  it('max_tokens laisse la place à un fichier, sauf plafond de Claude 3', async () => {
    const sent = mockFetch(textReply());
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate(messages);
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-3-opus-20240229' }).generate(messages);
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate(messages, { maxTokens: 400 });
    assert.deepEqual(sent.map(b => b.max_tokens), [16000, 4096, 400]);
  });

  it('met en cache le prompt système et le dernier message seulement', async () => {
    const sent = mockFetch(textReply());
    const history = [...messages, { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }];
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate(history);
    assert.deepEqual(sent[0].system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    assert.equal(sent[0].messages[0].content, 'tâche');
    assert.deepEqual(sent[0].messages[2].content, [{ type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }]);
  });

  it('marque le dernier bloc d\'un message avec image', async () => {
    const sent = mockFetch(textReply());
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate([{ role: 'user', content: [
      { type: 'text', text: 'vois' },
      { type: 'image', base64: 'QUJD', mimeType: 'image/png' },
    ] }]);
    const [text, image] = sent[0].messages[0].content;
    assert.equal(text.cache_control, undefined);
    assert.deepEqual(image.cache_control, { type: 'ephemeral' });
  });
});

describe('ClaudeEngine — réponse', () => {
  it('ignore un bloc de réflexion placé avant le texte', async () => {
    mockFetch(textReply({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'réponse' }] }));
    const out = await new ClaudeEngine({ apiKey: 'k', model: 'claude-opus-5-5' }).generate(messages);
    assert.equal(out, 'réponse');
  });

  it('compte le cache dans le contexte et le signale à part', async () => {
    mockFetch(textReply({ usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 5 } }));
    let usage;
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate(messages, { onUsage: u => { usage = u; } });
    assert.equal(usage.inputTokens, 1000);
    assert.equal(usage.cachedTokens, 900);
  });

  it('signale une réponse coupée', async () => {
    mockFetch(textReply({ stop_reason: 'max_tokens' }));
    let usage;
    await new ClaudeEngine({ apiKey: 'k', model: 'claude-haiku-4-5' }).generate(messages, { onUsage: u => { usage = u; } });
    assert.equal(usage.truncated, true);
  });
});

describe('GeminiEngine', () => {
  const reply = (finishReason = 'STOP') => ({
    candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  });

  it('impose le JSON uniquement sur demande', async () => {
    const sent = mockFetch(reply());
    const engine = new GeminiEngine({ apiKey: 'k', model: 'gemini-3.5-flash' });
    await engine.generate(messages, { jsonMode: true });
    await engine.generate(messages, {});
    assert.equal(sent[0].generationConfig.responseMimeType, 'application/json');
    assert.equal(sent[1].generationConfig.responseMimeType, undefined);
  });

  it('n\'impose pas le JSON à un modèle Gemma', async () => {
    const sent = mockFetch(reply());
    await new GeminiEngine({ apiKey: 'k', model: 'gemma-3-27b-it' }).generate(messages, { jsonMode: true });
    assert.equal(sent[0].generationConfig.responseMimeType, undefined);
  });

  it('signale une réponse coupée', async () => {
    mockFetch(reply('MAX_TOKENS'));
    let usage;
    await new GeminiEngine({ apiKey: 'k' }).generate(messages, { onUsage: u => { usage = u; } });
    assert.equal(usage.truncated, true);
  });
});

describe('OpenAiCompatEngine', () => {
  const engine = () => new OpenAiCompatEngine({ apiKey: 'k', baseUrl: 'http://x/v1' });
  const reply = (finish_reason = 'stop') => ({ choices: [{ message: { content: 'ok' }, finish_reason }] });

  it('convertit les images au format chat/completions', async () => {
    const sent = mockFetch(reply());
    await engine().generate([{ role: 'user', content: [
      { type: 'text', text: 'vois' },
      { type: 'image', base64: 'QUJD', mimeType: 'image/png', name: 'a.png' },
    ] }], {});
    assert.deepEqual(sent[0].messages[0].content, [
      { type: 'text', text: 'vois' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
  });

  it('signale une réponse coupée, même sans bloc usage', async () => {
    mockFetch(reply('length'));
    let usage;
    await engine().generate(messages, { onUsage: u => { usage = u; } });
    assert.equal(usage.truncated, true);
  });
});

describe('router — pannes passagères', () => {
  /** Moteur échouant `failures` fois avec `error` avant de répondre. */
  function setup(error, failures, fallback = false) {
    const calls = [];
    const engine = (name, left) => ({ factory: () => ({
      isReady: async () => ({ ready: true }),
      generate: async () => {
        calls.push(name);
        if (left-- > 0) throw error;
        return `réponse ${name}`;
      },
    }) });
    const chain = fallback ? ['a', 'b'] : ['a'];
    const router = new LlmRouter(chain, { a: engine('a', failures), b: engine('b', 0) }, {});
    const waits = [];
    router._sleep = async (ms) => { waits.push(ms); };
    return { router, calls, waits };
  }

  it('réessaie sur 429 avec un délai croissant', async () => {
    const { router, calls, waits } = setup(new Error('CLAUDE_HTTP_429: quota'), 2);
    assert.equal(await router.generate([], {}), 'réponse a');
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [1000, 3000]);
  });

  it('respecte Retry-After', async () => {
    const err = Object.assign(new Error('GEMINI_HTTP_429: quota'), { retryAfter: 7 });
    const { router, waits } = setup(err, 1);
    await router.generate([], {});
    assert.deepEqual(waits, [7000]);
  });

  it('bascule sans attendre si Retry-After est trop long', async () => {
    const err = Object.assign(new Error('CLAUDE_HTTP_429: quota'), { retryAfter: 600 });
    const { router, calls, waits } = setup(err, 9, true);
    assert.equal(await router.generate([], {}), 'réponse b');
    assert.deepEqual(calls, ['a', 'b']);
    assert.deepEqual(waits, []);
  });

  it('bascule sur le secours une fois les essais épuisés', async () => {
    const { router, calls } = setup(new Error('CLAUDE_HTTP_529: surcharge'), 9, true);
    assert.equal(await router.generate([], {}), 'réponse b');
    assert.deepEqual(calls, ['a', 'a', 'a', 'b']);
  });

  it('ne réessaie pas une erreur définitive', async () => {
    const { router, calls } = setup(new Error('CLAUDE_HTTP_400: invalide'), 9, true);
    await router.generate([], {});
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('le Stop interrompt l\'attente', async () => {
    const { router, calls } = setup(new Error('CLAUDE_HTTP_429: quota'), 9, true);
    router._sleep = async () => { throw new Error('ANNULÉ'); };
    await assert.rejects(router.generate([], {}), /ANNULÉ/);
    assert.deepEqual(calls, ['a']);
  });
});

describe('boucle agent — réponse coupée', () => {
  it('demande de découper plutôt que de renvoyer le même contenu', async () => {
    const dir = path.join(tmpBase, 'cut');
    fs.mkdirSync(dir, { recursive: true });
    const seen = [];
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: {}, llmGenerate: async (msgs, opts) => {
      seen.push(String(msgs.at(-1).content)); // capturé ici : le tableau continue de grandir
      if (++n === 1) {
        opts.onUsage({ inputTokens: 1, outputTokens: 1, truncated: true });
        return '{"tool":"write_file","args":{"path":"a.js","content":"const a';
      }
      opts.onUsage({ inputTokens: 1, outputTokens: 1 });
      return '{"tool":"finish","args":{"summary":"fin"}}';
    } });
    assert.ok(seen[1].includes('limite de tokens'), seen[1]);
  });

  it('garde la consigne de format pour un JSON simplement invalide', async () => {
    const dir = path.join(tmpBase, 'bad');
    fs.mkdirSync(dir, { recursive: true });
    const seen = [];
    let n = 0;
    await runAgent({ task: 't', projectRoot: dir, config: {}, llmGenerate: async (msgs) => {
      seen.push(String(msgs.at(-1).content));
      return ++n === 1 ? 'pas de json' : '{"tool":"finish","args":{"summary":"fin"}}';
    } });
    assert.ok(seen[1].startsWith('Format invalide'), seen[1]);
  });
});
