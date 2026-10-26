/**
 * ClaudeEngine — API officielle Anthropic.
 * POST api.anthropic.com/v1/messages
 * Auth : x-api-key + anthropic-version: 2023-06-01
 */

const { LlmEngine } = require('../base');

class ClaudeEngine extends LlmEngine {
  constructor(config) {
    super();
    this.apiKey = config.apiKey || '';
    this.model  = config.model  || 'claude-3-5-haiku-20241022';
  }

  async generate(messages, options = {}) {
    if (!this.apiKey) throw new Error('CLAUDE_NO_API_KEY');

    // Séparer le message system des autres
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs  = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        if (!Array.isArray(m.content)) return { role, content: m.content };
        // Convertir les blocs multimodaux au format Anthropic
        const content = m.content.map(b => b.type === 'image'
          ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.base64 } }
          : { type: 'text', text: b.text ?? String(b) });
        return { role, content };
      });

    const body = {
      model:      this.model,
      max_tokens: options.maxTokens ?? 4096,
      messages:   userMsgs,
    };
    if (systemMsg) body.system = systemMsg.content;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    // Top-P du panneau Paramètres (jamais transmis auparavant).
    if (typeof options.topP === 'number') body.top_p = options.topP;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`CLAUDE_HTTP_${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('CLAUDE_EMPTY_RESPONSE');
    if (options.onUsage && data.usage) {
      options.onUsage({
        inputTokens:  data.usage.input_tokens  || 0,
        outputTokens: data.usage.output_tokens || 0,
      });
    }
    return text;
  }

  async isReady() {
    if (!this.apiKey) return { ready: false, error: 'Clé API Claude manquante' };
    return { ready: true, info: `ClaudeEngine → ${this.model}` };
  }
}

module.exports = { ClaudeEngine };
