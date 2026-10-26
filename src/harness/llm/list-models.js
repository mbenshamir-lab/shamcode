// Récupère la liste des modèles disponibles pour un moteur donné.
// Utilisé par le panneau Paramètres pour populer dynamiquement le combobox.

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

// Modèles connus par provider — utilisés comme filet si l'API retourne une liste partielle
const STATIC_MODELS = {
  deepseek: [
    // V4 (courants, oct. 2026)
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    // Anciens alias — peuvent être dépréciés depuis juil. 2026
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  gemini: [
    // Gemini 3 (courants, 2026)
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    // Gemini 2.5 (stable mais dépréciés oct. 2026)
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    // Gemini 2.0 (plus anciens)
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    // Gemma
    'gemma-3-27b-it',
    'gemma-3-12b-it',
  ],
  claude: [
    // Claude 4.x (courants, 2026)
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-0',
    'claude-sonnet-4-0',
    // Claude 3.5 (legacy)
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
};

/** Fusionne la liste API avec les modèles statiques connus, sans doublon, triée. */
function _merge(apiList, staticList) {
  const set = new Set([...apiList, ...staticList]);
  return [...set].sort();
}

/**
 * @param {{ engine: string, apiKey: string, baseUrl?: string }} opts
 * @returns {Promise<string[]>} liste triée d'ids de modèles
 */
async function listModels({ engine, apiKey, baseUrl }) {
  if (!apiKey) throw new Error('Clé API manquante');

  if (engine === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const api = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    return _merge(api, STATIC_MODELS.gemini);
  }

  if (engine === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const api = (data.data || []).map(m => m.id);
    return _merge(api, STATIC_MODELS.claude);
  }

  // openai-compat ou deepseek
  // Pour deepseek : si une baseUrl custom est fournie (agrégateur), on l'utilise.
  // Sinon, on tombe sur l'API officielle DeepSeek.
  const base = (engine === 'deepseek')
    ? (baseUrl || '').replace(/\/$/, '') || DEEPSEEK_BASE
    : (baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('URL de base manquante pour openai-compat');

  try {
    const res = await fetch(`${base}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Plusieurs agrégateurs ont des formats légèrement différents de l'OpenAI standard.
    const raw = Array.isArray(data.data)   ? data.data
              : Array.isArray(data.models) ? data.models
              : Array.isArray(data)        ? data
              : [];
    const apiList = raw.map(m => m.id || m.model_id || m.name).filter(Boolean);
    // On retourne exactement ce que l'API déclare — pas de merge statique.
    // Les modèles statiques sont un filet de secours uniquement si l'API est injoignable.
    if (apiList.length) return apiList.sort();
  } catch { /* API injoignable → filet de secours ci-dessous */ }

  const staticFallback = engine === 'deepseek' ? STATIC_MODELS.deepseek : [];
  if (!staticFallback.length) throw new Error('URL de base manquante ou API inaccessible pour openai-compat');
  return staticFallback.sort();
}

module.exports = { listModels, DEEPSEEK_BASE, STATIC_MODELS };
