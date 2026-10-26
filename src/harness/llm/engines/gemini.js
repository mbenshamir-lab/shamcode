// GeminiEngine — appel direct à l'API Google Generative Language.
// POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// Conversion des rôles : 'assistant' → 'model', message system → systemInstruction.
// Supporte le streaming SSE via streamGenerateContent si options.onToken est fourni.

const { LlmEngine } = require('../base');
const { DEFAULT_TEMPERATURE } = require('../../../shared/constants');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiEngine extends LlmEngine {
  /**
   * @param {{ apiKey: string, model?: string }} config
   */
  constructor(config) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.0-flash';
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {{ temperature?: number, onToken?: (token: string) => void }} options
   * @returns {Promise<string>}
   */
  async generate(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('GEMINI_NO_API_KEY');
    }

    const streaming = typeof options.onToken === 'function';

    // Extraire le message system s'il existe
    let systemInstruction;
    const chatMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        const parts = Array.isArray(msg.content)
          ? msg.content.map(b => b.type === 'image'
              ? { inlineData: { mimeType: b.mimeType, data: b.base64 } }
              : { text: b.text ?? String(b) })
          : [{ text: msg.content }];
        chatMessages.push({ role: msg.role === 'assistant' ? 'model' : msg.role, parts });
      }
    }

    const body = {
      contents: chatMessages,
      generationConfig: { temperature: options.temperature ?? DEFAULT_TEMPERATURE },
    };
    // Top-P du panneau Paramètres (jamais transmis auparavant).
    if (typeof options.topP === 'number') body.generationConfig.topP = options.topP;
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const endpoint = streaming ? 'streamGenerateContent' : 'generateContent';
    const keyParam = streaming ? `alt=sse&key=${this.apiKey}` : `key=${this.apiKey}`;
    const url = `${BASE_URL}/${this.model}:${endpoint}?${keyParam}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GEMINI_HTTP_${res.status}: ${err.slice(0, 200)}`);
    }

    // ── Mode non-streaming ──────────────────────────────────────────────────
    if (!streaming) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');
      if (options.onUsage && data.usageMetadata) {
        options.onUsage({
          inputTokens:  data.usageMetadata.promptTokenCount     || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
        });
      }
      return text;
    }

    // ── Mode streaming SSE ──────────────────────────────────────────────────
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';
    let buffer    = '';
    let usageMeta = null;

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
        try {
          const json  = JSON.parse(data);
          const token = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) { fullText += token; options.onToken(token); }
          if (json?.usageMetadata) usageMeta = json.usageMetadata;
        } catch { /* ligne SSE mal formée — ignorée */ }
      }
    }

    if (!fullText) throw new Error('GEMINI_EMPTY_RESPONSE');
    if (options.onUsage) {
      options.onUsage({
        inputTokens:  usageMeta?.promptTokenCount     || 0,
        outputTokens: usageMeta?.candidatesTokenCount || Math.ceil(fullText.length / 4),
      });
    }
    return fullText;
  }

  async isReady() {
    if (!this.apiKey) {
      return { ready: false, error: 'Clé API Gemini manquante' };
    }
    return { ready: true, info: `GeminiEngine (${this.model})` };
  }
}

module.exports = { GeminiEngine };
