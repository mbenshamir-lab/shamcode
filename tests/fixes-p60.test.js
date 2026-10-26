/**
 * Tests Phase 60 — Rendu en blocs propres + coupe sur frontière de section
 *
 * 1. _renderMarkdown — liste avec puces jamais imbriquée dans un <p>,
 *    sections collées à leur liste, puces séparées par des lignes vides regroupées.
 * 2. _splitSummary — coupe à la frontière de section (pas de titre orphelin).
 * 3. styles.css — espacements serrés entre titre et liste.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

// Fonctions pures du renderer (compilées avec leurs dépendances internes)
const { _renderMarkdown, _splitSummary } = require('./lib/app-module');

/** Vrai si une liste se retrouve à l'intérieur d'un paragraphe (HTML invalide). */
function hasListInsideParagraph(html) {
  return /<p>(?:(?!<\/p>)[\s\S])*<(ul|ol)>/.test(html);
}

describe('_renderMarkdown — blocs propres', () => {
  it('un titre de section et sa liste ne sont pas dans le même paragraphe', () => {
    const html = _renderMarkdown('**1. Bugs**\n- a\n- b\n**2. Tests**\n- c');
    assert.ok(!hasListInsideParagraph(html), `liste dans <p> : ${html}`);
    assert.ok(html.includes('<p><strong>1. Bugs</strong></p>'), 'titre en paragraphe propre');
    assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'), 'liste groupée après le titre');
  });

  it('deux listes séparées par le titre suivant restent distinctes', () => {
    const html = _renderMarkdown('- a\n- b\n**2. Suite**\n- c');
    const lists = html.match(/<ul>/g) || [];
    assert.equal(lists.length, 2, 'deux listes distinctes');
  });

  it('des puces séparées par une ligne vide forment une seule liste', () => {
    const html = _renderMarkdown('- a\n\n- b\n\n- c');
    assert.equal((html.match(/<ul>/g) || []).length, 1, 'une seule liste');
    assert.equal((html.match(/<li>/g) || []).length, 3, 'trois puces');
  });

  it('un titre Markdown suivi d\'une liste reste séparé', () => {
    const html = _renderMarkdown('## Objectif\n- a\n- b');
    assert.ok(!hasListInsideParagraph(html), 'pas de liste dans le paragraphe');
    assert.ok(html.includes('<h5>Objectif</h5>'), 'titre rendu');
  });

  it('paragraphe multi-lignes conserve les retours à la ligne', () => {
    const html = _renderMarkdown('ligne 1\nligne 2');
    assert.ok(html.includes('<br>'), 'saut de ligne conservé dans un paragraphe');
  });

  it('aucun paragraphe vide produit', () => {
    const html = _renderMarkdown('**1. A**\n\n\n- a\n\n');
    assert.ok(!html.includes('<p></p>'), 'pas de paragraphe vide');
  });

  it('le texte simple n\'ajoute pas de liste', () => {
    const html = _renderMarkdown('Bonjour');
    assert.ok(!html.includes('<ul>'), 'pas de liste');
    assert.ok(html.includes('Bonjour'), 'texte présent');
  });
});

describe.skip('_splitSummary — supprimé : les réponses s\'affichent en entier', () => {
  const section = (n, bullets) => `**${n}. Section ${n}**\n` + bullets.map(b => `- ${b}`).join('\n');

  // 5 sections × 4 puces = 25 lignes → dépassement du budget de lignes (12)
  const longSummary = [1, 2, 3, 4, 5].map(n => section(n, [
    'un deux trois quatre cinq',
    'six sept huit neuf dix',
    'onze douze treize quatorze',
    'quinze seize dix-sept dix-huit',
  ])).join('\n');

  // 4 sections à puces très longues → dépassement du budget caractères (900)
  const wideSummary = [1, 2, 3, 4].map(n => section(n, [
    'proposition tres longue avec beaucoup de details techniques et des impacts mesures sur les performances la lisibilite et la maintenance du module principal du jeu',
    'seconde proposition encore plus longue decrivant des tests des cas limites et un plan de migration progressif avec retours arriere possibles a chaque etape',
  ])).join('\n');

  it('ne laisse jamais un titre de section orphelin (budget lignes)', () => {
    const r = _splitSummary(longSummary);
    const lastLine = r.shown.split('\n').pop();
    assert.ok(!/^\*\*\d+\./.test(lastLine), `titre orphelin : ${lastLine}`);
    assert.ok(r.hiddenLines > 0, 'du contenu reste caché');
  });

  it('ne laisse jamais un titre orphelin (budget caractères)', () => {
    const r = _splitSummary(wideSummary);
    const lastLine = r.shown.split('\n').pop();
    assert.ok(!/^\*\*\d+\./.test(lastLine), `titre orphelin : ${lastLine}`);
    assert.ok(r.hiddenLines > 0, 'du contenu reste caché');
  });

  it('la coupe tombe sur un début de section', () => {
    for (const fixture of [longSummary, wideSummary]) {
      const r = _splitSummary(fixture);
      const restFirst = r.rest.find(l => l.trim());
      assert.ok(/^\*\*\d+\./.test(restFirst), `coupe hors section : ${restFirst}`);
    }
  });

  it('le texte affiché reste dans le budget', () => {
    for (const fixture of [longSummary, wideSummary]) {
      const r = _splitSummary(fixture);
      assert.ok(r.shown.length <= 900, `budget dépassé : ${r.shown.length}`);
      assert.ok(r.shown.split('\n').length <= 12, 'budget lignes respecté');
    }
  });

  it('les lignes masquées sont bien comptées', () => {
    const r = _splitSummary(longSummary);
    const visible = r.shown.split('\n').filter(l => l.trim()).length;
    const total   = longSummary.split('\n').filter(l => l.trim()).length;
    assert.equal(visible + r.hiddenLines, total, 'aucune ligne perdue dans le décompte');
  });

  it('un résumé court n\'est pas coupé', () => {
    const r = _splitSummary('**1. A**\n- a');
    assert.equal(r.hiddenLines, 0);
    assert.equal(r.shown, '**1. A**\n- a');
  });
});

describe('styles.css — espacements serrés', () => {
  it('titre de section collé à sa liste', () => {
    assert.ok(css.includes('.message-agent p + ul'), 'règle de proximité');
    assert.ok(css.includes('margin-top: -2px'), 'espace négatif');
  });

  it('puces compactes', () => {
    const idx = css.indexOf('.message-agent li {');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('line-height: 1.45'), 'interligne serré');
    assert.ok(block.includes('margin: 1px 0'), 'marge de puce réduite');
  });
});
