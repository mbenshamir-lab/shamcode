// OpenAiCompatEngine — moteur compatible API OpenAI (chat/completions).
// Fonctionne avec tout proxy OpenAI-compatible : codecraftapi, OpenRouter, Ollama, etc.
// POST {baseUrl}/chat/completions avec Authorization: Bearer {apiKey}
// Supporte le streaming SSE si options.onToken est fourni.

const { LlmEngine, httpError } = require('../base');
const { DEFAULT_TEMPERATURE } = require('../../../shared/constants');

/** Convertit les blocs multimodaux internes au format attendu par chat/completions. */
function _toOpenAiMessage(message) {
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map(b => (b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.mimeType};base64,${b.base64}` } }
      : { type: 'text', text: b.text ?? String(b) })),
  };
}

class OpenAiCompatEngine extends LlmEngine {
  /**
   * @param {{ apiKey: string, baseUrl: string, model?: string }} config
   */
  constructor(config) {
    super();
    this.apiKey  = config.apiKey;
    this.baseUrl = (config.baseUrl || '').replace(/\/$/, '');
    this.model   = config.model || 'gemini-2.0-flash';
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {{ temperature?: number, onToken?: (token: string) => void }} options
   * @returns {Promise<string>}
   */
  async generate(messages, options = {}) {
    if (!this.apiKey)  throw new Error('OPENAI_COMPAT_NO_API_KEY');
    if (!this.baseUrl) throw new Error('OPENAI_COMPAT_NO_BASE_URL');

    const url       = `${this.baseUrl}/chat/completions`;
    const streaming = typeof options.onToken === 'function';

    const payload = {
      model:       this.model,
      messages:    messages.map(_toOpenAiMessage),
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      stream:      streaming,
    };
    // top_p vient du réglage « Top-P » des paramètres — il n'était jamais transmis.
    if (typeof options.topP === 'number') payload.top_p = options.topP;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!res.ok) throw await httpError('OPENAI_COMPAT', res);

    // ── Mode non-streaming ──────────────────────────────────────────────────
    if (!streaming) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OPENAI_COMPAT_EMPTY_RESPONSE');
      const truncated = data.choices[0].finish_reason === 'length';
      if (options.onUsage && (data.usage || truncated)) {
        options.onUsage({
          inputTokens:  data.usage?.prompt_tokens     || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          truncated,
        });
      }
      return text;
    }

    // ── Mode streaming SSE ──────────────────────────────────────────────────
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';
    let buffer    = '';
    let streamUsage = null;
    let finishReason = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (options.signal?.aborted) { reader.cancel(); throw new Error('ANNULÉ'); }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const json  = JSON.parse(data);
          const token = json?.choices?.[0]?.delta?.content;
          if (token) { fullText += token; options.onToken(token); }
          if (json?.usage) streamUsage = json.usage; // dernier chunk avec usage
          if (json?.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
        } catch { /* ligne SSE mal formée — ignorée */ }
      }
    }

    if (!fullText) throw new Error('OPENAI_COMPAT_EMPTY_RESPONSE');
    if (options.onUsage) {
      options.onUsage({
        inputTokens:  streamUsage?.prompt_tokens     || 0,
        outputTokens: streamUsage?.completion_tokens || Math.ceil(fullText.length / 4),
        truncated:    finishReason === 'length',
      });
    }
    return fullText;
  }

  async isReady() {
    if (!this.apiKey)  return { ready: false, error: 'Clé API manquante' };
    if (!this.baseUrl) return { ready: false, error: 'URL de base manquante' };
    return { ready: true, info: `OpenAiCompatEngine → ${this.baseUrl} (${this.model})` };
  }
}

module.exports = { OpenAiCompatEngine };
