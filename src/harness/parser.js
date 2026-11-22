/** Coupe du premier { au dernier } — null s'il n'y a pas d'objet. */
function _sliceObject(text) {
  const braceStart = text.indexOf('{');
  const braceEnd   = text.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return null;
  return text.slice(braceStart, braceEnd + 1);
}

/**
 * Répare ce que les petits modèles émettent mal : virgules traînantes hors chaînes,
 * retours à la ligne et tabulations littéraux dans les chaînes.
 * Les chaînes sont reconnues d'abord : une virgule d'un `content` est du code à écrire.
 */
function _repairJson(text) {
  return text.replace(/("(?:[^"\\]|\\[\s\S])*")|,(\s*[}\]])/g, (match, str, closing) => (
    str
      ? str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      : closing
  ));
}

function _isObject(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * Extrait un tool call JSON de la réponse brute du LLM.
 * Tolérant : fences markdown, texte avant/après, virgules traînantes.
 *
 * @param {string} rawText
 * @returns {{ tool: string, args: object } | { error: string }}
 */
function extractToolCall(rawText) {
  if (!rawText || typeof rawText !== 'string') return { error: 'VIDE' };

  const text = rawText.trim();

  // Candidats du plus fidèle au plus spéculatif. La fence vient après le découpage par
  // accolades : un `content` contenant ``` ne doit pas être pris pour une fence englobante.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*)```/);
  const candidates = [text, _sliceObject(text), fenceMatch && _sliceObject(fenceMatch[1].trim())]
    .filter(Boolean);
  if (!_sliceObject(text)) return { error: 'JSON_INTROUVABLE' };

  // Un JSON valide passe sans réparation, sinon celle-ci pourrait altérer son contenu.
  let parsed;
  let lastError = null;
  for (const transform of [s => s, _repairJson]) {
    for (const candidate of candidates) {
      try {
        const value = JSON.parse(transform(candidate));
        if (_isObject(value)) { parsed = value; break; }
      } catch (e) {
        lastError = e;
      }
    }
    if (parsed) break;
  }
  if (!parsed) return { error: lastError ? `JSON_INVALIDE: ${lastError.message}` : 'JSON_NON_OBJET' };

  if (!parsed.tool || typeof parsed.tool !== 'string') return { error: 'OUTIL_MANQUANT' };
  if (typeof parsed.args !== 'object' || parsed.args === null) parsed.args = {};

  // Intention annoncée à l'utilisateur avant l'action (au moins deux phrases)
  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim().slice(0, 300) : '';

  return { tool: parsed.tool, args: parsed.args, ...(intent ? { intent } : {}) };
}

module.exports = { extractToolCall };
