/**
 * Carte du code (ADR-031) : les fichiers les plus importés d'abord, avec ce qu'ils exposent.
 * L'arborescence dit où sont les fichiers, les extraits RAG montrent des fragments ; seule la
 * carte dit lesquels sont centraux, ce qui évite à l'agent de les découvrir en les lisant.
 */

const path = require('path');
const { buildDepGraph } = require('./depgraph');
const { extractSymbols } = require('./symbols');

const MAX_FILES   = 120;
const MAX_SYMBOLS = 8;
const EXCLUDED = /(^|\/)(node_modules|fixtures|__fixtures__|tests?|spec|__tests__|dist|build)\/|\.(test|spec)\.[a-z]+$/i;

/**
 * @param {string} projectRoot
 * @returns {string} section prête pour le contexte, '' si rien à montrer
 */
function buildCodeMap(projectRoot) {
  const { deps, dependents } = buildDepGraph(projectRoot);
  const importers = file => (dependents[file] || []).length;

  const files = Object.keys(deps)
    .filter(file => !EXCLUDED.test(file))
    .sort((a, b) => importers(b) - importers(a) || a.localeCompare(b))
    .slice(0, MAX_FILES);

  const lines = [];
  for (const file of files) {
    // Le préfixe _ marque l'interne dans ce dépôt comme dans la plupart des projets
    const symbols = extractSymbols(path.join(projectRoot, file)).map(s => s.name).filter(n => !n.startsWith('_'));
    if (symbols.length === 0) continue;
    const shown = symbols.slice(0, MAX_SYMBOLS).join(', ');
    const more  = symbols.length > MAX_SYMBOLS ? ` (+${symbols.length - MAX_SYMBOLS})` : '';
    const count = importers(file);
    lines.push(`${file}${count ? ` [importé par ${count}]` : ''} : ${shown}${more}`);
  }

  return lines.length ? `## Carte du code (fichiers les plus importés d'abord)\n${lines.join('\n')}` : '';
}

module.exports = { buildCodeMap };
