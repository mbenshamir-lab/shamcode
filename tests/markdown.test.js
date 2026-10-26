'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Fonctions pures du renderer, extraites et recompilées sans DOM
// (cf. tests/lib/app-module.js — prend en charge les dépendances internes)
const { _highlight, _renderMarkdown } = require('./lib/app-module');

describe('_highlight', () => {

  it('colore les mots-clés JS', () => {
    const out = _highlight('const x = 1;', 'js');
    assert.ok(out.includes('hl-kw'), 'doit avoir une classe hl-kw');
    assert.ok(out.includes('const'), 'const doit être présent');
  });

  it('colore les strings', () => {
    const out = _highlight('"hello"', 'js');
    assert.ok(out.includes('hl-str'), 'doit avoir hl-str');
  });

  it('colore les nombres', () => {
    const out = _highlight('42', 'js');
    assert.ok(out.includes('hl-num'), 'doit avoir hl-num');
  });

  it('colore les commentaires //', () => {
    const out = _highlight('// un commentaire', 'js');
    assert.ok(out.includes('hl-cmt'), 'doit avoir hl-cmt');
  });

  it('ne plante pas sur un code vide', () => {
    assert.doesNotThrow(() => _highlight('', 'js'));
    assert.doesNotThrow(() => _highlight('', ''));
  });

});

describe('_renderMarkdown', () => {

  it('échappe le HTML brut', () => {
    const out = _renderMarkdown('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'), 'balise script ne doit pas passer');
    assert.ok(out.includes('&lt;script&gt;'), 'doit être escapé');
  });

  it('rend les blocs de code fencés avec wrapper .code-block', () => {
    const out = _renderMarkdown('```js\nconsole.log("hi");\n```');
    assert.ok(out.includes('code-block'), 'doit avoir .code-block wrapper');
    assert.ok(out.includes('<pre>'), 'doit avoir <pre>');
    assert.ok(out.includes('cb-copy'), 'doit avoir le bouton copie');
    assert.ok(out.includes('cb-lang'), 'doit avoir le label langue');
    assert.ok(out.includes('hl-'), 'doit avoir de la coloration syntaxique');
  });

  it('bouton copie présent même sans langue', () => {
    const out = _renderMarkdown('```\nsome code\n```');
    assert.ok(out.includes('cb-copy'), 'bouton copie même sans langue');
    assert.ok(!out.includes('cb-lang'), 'pas de label langue si non spécifié');
  });

  it('rend le code inline', () => {
    const out = _renderMarkdown('Utilise `npm install` pour installer.');
    assert.ok(out.includes('<code>npm install</code>'), 'code inline rendu');
  });

  it('rend le gras', () => {
    const out = _renderMarkdown('Texte **important** ici.');
    assert.ok(out.includes('<strong>important</strong>'), 'gras rendu');
  });

  it('rend l\'italique', () => {
    const out = _renderMarkdown('Texte *en italique* ici.');
    assert.ok(out.includes('<em>en italique</em>'), 'italique rendu');
  });

  it('rend les titres', () => {
    const out = _renderMarkdown('# Titre 1\n## Titre 2\n### Titre 3');
    assert.ok(out.includes('<h4>'), 'h1 → h4');
    assert.ok(out.includes('<h5>'), 'h2 → h5');
    assert.ok(out.includes('<h6>'), 'h3 → h6');
  });

  it('rend les listes à puces', () => {
    const out = _renderMarkdown('- item a\n- item b\n- item c');
    assert.ok(out.includes('<ul>'), 'doit avoir <ul>');
    assert.ok(out.includes('<li>item a</li>'), 'item a rendu');
  });

  it('rend les listes numérotées', () => {
    const out = _renderMarkdown('1. premier\n2. deuxième');
    assert.ok(out.includes('<ol>'), 'doit avoir <ol>');
    assert.ok(out.includes('<li>premier</li>'), 'premier rendu');
  });

  it('ne double-escape pas le code dans les blocs fencés', () => {
    const out = _renderMarkdown('```html\n<div class="test">hi</div>\n```');
    assert.ok(out.includes('&lt;div'), 'les < sont escapés dans le code');
    // "test" peut être coloré par hl-str mais la balise <div class="test"> ne doit pas être injectée
    assert.ok(!out.includes('<div class="test"'), 'pas d\'injection de <div class="test">');
  });

  it('rendu texte simple sans markup → pas de balises parasites', () => {
    const out = _renderMarkdown('Bonjour le monde');
    assert.ok(out.includes('Bonjour le monde'), 'texte présent');
    assert.ok(!out.includes('<ul>'), 'pas de liste fantôme');
    assert.ok(!out.includes('<h4>'), 'pas de titre fantôme');
  });

  it('texte vide ne plante pas', () => {
    assert.doesNotThrow(() => _renderMarkdown(''));
    assert.doesNotThrow(() => _renderMarkdown('   '));
  });

});

describe('_renderMarkdown — tableaux', () => {

  const POPULATIONS = [
    '**Populations — 10 pays les plus peuplés (est. 2025, ONU)**',
    '| Pays | Population |',
    '|---|---|',
    '| Inde | 1 451 M |',
    '| Chine | 1 419 M |',
    '| États-Unis | 342 M |',
    '| Indonésie | 284 M |',
    '| Pakistan | 251 M |',
    '| Nigéria | 233 M |',
    '| Brésil | 213 M |',
    '| Bangladesh | 174 M |',
    '| Russie | 144 M |',
    '| Éthiopie | 132 M |',
  ].join('\n');

  it('rend le tableau des 10 pays les plus peuplés', () => {
    const out = _renderMarkdown(POPULATIONS);
    assert.ok(out.includes('<div class="md-table"><table>'), 'wrapper .md-table');
    assert.ok(out.includes('<th>Pays</th>'), 'en-tête Pays');
    assert.ok(out.includes('<th>Population</th>'), 'en-tête Population');
    assert.equal((out.match(/<tr>/g) || []).length, 11, '1 en-tête + 10 pays');
  });

  it('conserve les accents et les espaces des nombres', () => {
    const out = _renderMarkdown(POPULATIONS);
    assert.ok(out.includes('<td>États-Unis</td>'), 'États-Unis intact');
    assert.ok(out.includes('<td>Éthiopie</td>'), 'Éthiopie intact');
    assert.ok(out.includes('<td>Nigéria</td>'), 'Nigéria intact');
    assert.ok(out.includes('<td>1 451 M</td>'), 'espace insécable logique conservé');
  });

  it('la ligne |---| n\'apparaît pas dans le corps', () => {
    const out = _renderMarkdown(POPULATIONS);
    assert.ok(!out.includes('---'), 'séparateur consommé');
  });

  it('applique les alignements :---, :---:, ---:', () => {
    const out = _renderMarkdown('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.ok(out.includes('class="t-left"'), 'gauche');
    assert.ok(out.includes('class="t-center"'), 'centre');
    assert.ok(out.includes('class="t-right"'), 'droite');
  });

  it('complète les lignes trop courtes sans casser le tableau', () => {
    const out = _renderMarkdown('| A | B |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    assert.ok(out.includes('<td>1</td>'), 'cellule présente');
    assert.ok(!out.includes('undefined'), 'pas de undefined dans les cellules');
  });

  it('rend le gras et le code inline dans les cellules', () => {
    const out = _renderMarkdown('| A | B |\n|---|---|\n| **gras** | `code` |');
    assert.ok(out.includes('<td><strong>gras</strong></td>'), 'gras dans cellule');
    assert.ok(out.includes('<td><code>code</code></td>'), 'code dans cellule');
  });

  it('un tableau précédé de texte reste un bloc séparé', () => {
    const out = _renderMarkdown('Intro:\n| A | B |\n|---|---|\n| 1 | 2 |');
    assert.ok(out.includes('<p>Intro:</p>'), 'paragraphe fermé');
    assert.ok(out.includes('<div class="md-table">'), 'tableau après paragraphe');
  });

  it('sans ligne de séparation, pas de tableau', () => {
    const out = _renderMarkdown('| a | b |\n| 1 | 2 |');
    assert.ok(!out.includes('md-table'), 'pas de tableau sans séparateur');
  });

});
