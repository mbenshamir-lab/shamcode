/**
 * Extrait un tool call JSON de la réponse brute du LLM.
 * Tolérant : fences markdown, texte avant/après, virgules traînantes.
 *
 * @param {string} rawText
 * @returns {{ tool: string, args: object } | { error: string }}
 */
function extractToolCall(rawText) {
  if (!rawText || typeof rawText !== 'string') return { error: 'VIDE' };

  let text = rawText.trim();

  // 1. Extraire depuis les fences markdown ```json...``` ou ```...```
  // Greedy sur l'ensemble puis on retire les délimiteurs pour gérer les fences imbriquées.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // 2. Extraire le premier objet JSON (de { jusqu'au dernier })
  const braceStart = text.indexOf('{');
  const braceEnd   = text.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return { error: 'JSON_INTROUVABLE' };
  text = text.slice(braceStart, braceEnd + 1);

  // 3. Réparer les virgules traînantes avant } ou ]
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // 3.5 Réparer les retours à la ligne / tabulations littéraux dans les valeurs de chaîne.
  // Les petits modèles (< 3B) émettent parfois de vrais \n à l'intérieur des strings JSON,
  // ce qui rend le JSON invalide. On échappe uniquement à l'intérieur des guillemets.
  text = text.replace(/("(?:[^"\\]|\\[\s\S])*")/g,
    s => s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  );

  // 4. Parser
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON_INVALIDE: ${e.message}` };
  }

  if (typeof parsed !== 'object' || parsed === null) return { error: 'JSON_NON_OBJET' };
  if (!parsed.tool || typeof parsed.tool !== 'string') return { error: 'OUTIL_MANQUANT' };
  if (typeof parsed.args !== 'object' || parsed.args === null) parsed.args = {};

  // Intention annoncée à l'utilisateur avant l'action (au moins deux phrases)
  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim().slice(0, 300) : '';

  return { tool: parsed.tool, args: parsed.args, ...(intent ? { intent } : {}) };
}

module.exports = { extractToolCall };
