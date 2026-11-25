/**
 * ClaudeEngine — API officielle Anthropic.
 * POST api.anthropic.com/v1/messages
 * Auth : x-api-key + anthropic-version: 2023-06-01
 */

const { LlmEngine, httpError } = require('../base');

// Liste des modèles acceptant encore temperature/top_p : à partir de Claude 4.7, ces
// champs renvoient une erreur 400. Une liste blanche protège aussi les modèles à venir.
const ACCEPTS_SAMPLING = /^claude-(3|opus-4-[0-6]|sonnet-4-[0-6]|haiku-4-5)/;

// 16 000 laisse passer un write_file courant sans dépasser les délais d'une requête non
// streamée. Les modèles Claude 3 plafonnent à 4 096 (ou 8 192) et refuseraient davantage.
const DEFAULT_MAX_TOKENS = 16000;
const CLAUDE3_MAX_TOKENS = 4096;

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
      max_tokens: options.maxTokens ?? (this.model.startsWith('claude-3') ? CLAUDE3_MAX_TOKENS : DEFAULT_MAX_TOKENS),
      messages:   userMsgs,
    };
    // Le prompt système et le contexte projet sont renvoyés à l'identique à chaque étape :
    // les mettre en cache évite de les repayer plein tarif.
    if (systemMsg) {
      body.system = [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }];
    }
    // Le dernier message prolonge ce cache : entre deux paliers de compaction, l'historique
    // ne fait que s'allonger, donc chaque requête relit le préfixe de la précédente.
    const lastMsg = userMsgs[userMsgs.length - 1];
    if (lastMsg) {
      const blocks = Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: lastMsg.content }];
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
      lastMsg.content = blocks;
    }
    if (ACCEPTS_SAMPLING.test(this.model)) {
      // Un seul des deux : les modèles récents de cette liste refusent la combinaison.
      if (options.temperature !== undefined) body.temperature = options.temperature;
      else if (typeof options.topP === 'number') body.top_p = options.topP;
    }

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

    if (!res.ok) throw await httpError('CLAUDE', res);

    const data = await res.json();
    // Les modèles récents placent un bloc de réflexion avant le texte
    const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) throw new Error('CLAUDE_EMPTY_RESPONSE');
    if (options.onUsage && data.usage) {
      const cachedTokens = data.usage.cache_read_input_tokens || 0;
      options.onUsage({
        // input_tokens exclut le cache : sans ce cumul, la jauge de contexte s'effondrerait
        inputTokens:  (data.usage.input_tokens || 0) + cachedTokens + (data.usage.cache_creation_input_tokens || 0),
        outputTokens: data.usage.output_tokens || 0,
        cachedTokens,
        truncated:    data.stop_reason === 'max_tokens',
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
