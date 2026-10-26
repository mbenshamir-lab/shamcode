/**
 * Extraction des fonctions pures du renderer (aucun DOM) pour les tests.
 *
 * app.js est un script navigateur : on récupère les fonctions par leur source et
 * on les recompile dans un module isolé. Centralisé ici pour qu'un ajout de
 * dépendance (ex. linkification des fichiers) n'oblige pas à modifier chaque test.
 */

const fs   = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer-visible/app.js'), 'utf8');

/** Récupère le corps d'une fonction déclarée dans app.js. */
function grab(name, re) {
  const m = src.match(re);
  if (!m) throw new Error(`extraction impossible : ${name}`);
  return m[1];
}

// Bloc autonome : détection des fichiers du projet (dépend seulement de _escAttr)
const linkifyStart = src.indexOf('const _FILE_EXT');
const linkifyEnd   = src.indexOf('// Rendu Markdown léger');
if (linkifyStart === -1 || linkifyEnd <= linkifyStart) {
  throw new Error('bloc de détection des fichiers introuvable dans app.js');
}

const code = `
  function _escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  ${src.slice(linkifyStart, linkifyEnd)}

  function _highlight(code, lang) {
    ${grab('_highlight', /function _highlight\(code, lang\) \{([\s\S]*?)\n  \}/)}
  }
  function _renderMarkdown(text) {
    ${grab('_renderMarkdown', /function _renderMarkdown\(text\) \{([\s\S]*?)\n  \}/)}
    return text;
  }
  function _patchLines(patch) {
    ${grab('_patchLines', /function _patchLines\(patch\) \{([\s\S]*?)\n  \}/)}
  }

  module.exports = {
    _renderMarkdown, _highlight, _patchLines,
    _linkifyText, _linkifyFiles,
  };
`;

const mod = new module.constructor();
mod._compile(code, 'app-pure-functions.js');

module.exports = mod.exports;
module.exports.__source = src;
