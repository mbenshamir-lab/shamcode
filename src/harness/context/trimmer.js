/**
 * Ajuste un assemblage de sections au budget de caractères disponible.
 *
 * Politique (v2) : chaque section reçoit une part du budget, et ce qui dépasse est
 * TRONQUÉ sur une frontière de ligne avec un marqueur explicite. L'ancienne politique
 * jetait la section entière quand elle ne tenait pas : à 12 000 caractères, un RAG de
 * 10 400 faisait disparaître l'arborescence, et un RAG de 13 000 disparaissait
 * lui-même en laissant 69 % du budget inutilisé. Le modèle recevait donc soit un
 * contexte amputé, soit un contexte vide, sans jamais savoir qu'il manquait quelque chose.
 *
 * Parts : rag 70 % (le contenu le plus utile par caractère), tree 30 % (navigation),
 * symbols 15 %. Le budget restant est consommé dans l'ordre, jamais dépassé.
 */

const { MAX_CONTEXT_CHARS } = require('../../shared/constants');

const ORDER = ['rag', 'tree', 'symbols', 'notes'];
const SHARE = { rag: 0.70, tree: 0.30, symbols: 0.15, notes: 0.10 };
const MIN_USEFUL = 80;      // sous cette taille, un marqueur mange tout le contenu
const MARKER_RESERVE = 70;  // place réservée au marqueur de troncature

function _rank(part) {
  const i = ORDER.indexOf(part.type);
  return i === -1 ? ORDER.length : i;
}

/**
 * Tronque proprement une section sur une frontière de ligne.
 * @param {string} content
 * @param {number} room     caractères disponibles pour cette section
 * @param {string} type     nom de la section, pour le marqueur
 * @returns {string}
 */
function _truncateSection(content, room, type) {
  if (room <= MIN_USEFUL) return '';
  let cut = content.slice(0, Math.max(0, room - MARKER_RESERVE));
  const lastNewline = cut.lastIndexOf('\n');
  // Couper sur une ligne entière sauf si cela sacrifierait plus de 40 % de l'extrait
  if (lastNewline > cut.length * 0.6) cut = cut.slice(0, lastNewline);
  const omitted = content.length - cut.length;
  // Ne pas laisser un bloc de code ouvert : la section est coupée en plein extrait
  const fences = (cut.match(/```/g) || []).length;
  const close = fences % 2 === 1 ? '\n```' : '';
  return `${cut}${close}\n[… ${type} tronqué — ${omitted} caractères omis]`;
}

/**
 * @param {{ type: string, content: string }[]} parts  - Sections à assembler
 * @param {number} maxChars                             - Budget total
 * @returns {string}
 */
function trimToBudget(parts, maxChars = MAX_CONTEXT_CHARS) {
  const budget = Math.max(0, Number(maxChars) || 0);
  if (budget === 0 || !Array.isArray(parts)) return '';

  const ordered = parts
    .filter(p => p && typeof p.content === 'string' && p.content.trim().length > 0)
    .sort((a, b) => _rank(a) - _rank(b));

  // Passe 1 : part statique par section, tronquée sur une frontière de ligne.
  const slots = [];
  let used = 0;

  for (const part of ordered) {
    const remaining = budget - used;
    if (remaining <= MIN_USEFUL) break;

    const share = SHARE[part.type] ?? 1;
    const cap = Math.max(0, Math.min(remaining, Math.round(budget * share)));
    if (cap <= MIN_USEFUL) {
      slots.push({ part, text: '' });
      continue;
    }

    const text = part.content.length <= cap
      ? part.content
      : _truncateSection(part.content, cap, part.type);
    slots.push({ part, text });
    if (text) used += text.length + 1; // +1 pour le '\n' de jointure
  }

  // Passe 2 : le reliquat profite aux sections non servies, dans l'ordre de priorité.
  // Sans cela, une section à faible part (symbols 15 %, notes 10 %) restait vide alors
  // que le budget n'était pas consommé, et le modèle ne voyait jamais ces informations.
  let leftover = budget - used;
  if (leftover > MIN_USEFUL) {
    for (const slot of slots) {
      if (leftover <= MIN_USEFUL) break;
      const { part, text } = slot;
      if (text.length >= part.content.length) continue;

      const room = Math.min(part.content.length, text.length + leftover);
      const grown = part.content.length <= room
        ? part.content
        : _truncateSection(part.content, room, part.type);
      if (grown.length <= text.length) continue;

      leftover -= grown.length - text.length;
      slot.text = grown;
    }
  }

  return slots.map(s => s.text).filter(Boolean).join('\n');
}

module.exports = { trimToBudget };
