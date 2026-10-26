'use strict';

/**
 * Tests Phase 110 — Design Studio window (vérifications statiques)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── constants.js — canaux IPC design ─────────────────────────────────────

describe('constants.js — IPC design', () => {
  const { IPC } = require('../src/shared/constants');

  it('DESIGN_OPEN est défini', () => {
    assert.equal(typeof IPC.DESIGN_OPEN, 'string');
    assert.ok(IPC.DESIGN_OPEN.length > 0);
  });

  it('DESIGN_CLOSE est défini', () => {
    assert.equal(typeof IPC.DESIGN_CLOSE, 'string');
  });

  it('DESIGN_READ_TOKENS est défini', () => {
    assert.equal(typeof IPC.DESIGN_READ_TOKENS, 'string');
  });

  it('DESIGN_WRITE_FILE est défini', () => {
    assert.equal(typeof IPC.DESIGN_WRITE_FILE, 'string');
  });

  it('les 4 canaux design sont distincts', () => {
    const vals = [IPC.DESIGN_OPEN, IPC.DESIGN_CLOSE, IPC.DESIGN_READ_TOKENS, IPC.DESIGN_WRITE_FILE];
    assert.equal(new Set(vals).size, 4, 'des canaux IPC design sont dupliqués');
  });
});

// ── preload-design.js ─────────────────────────────────────────────────────

describe('preload-design.js — surface API', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/preload-design.js'), 'utf8');

  it('expose getConfig', ()           => assert.ok(src.includes('getConfig')));
  it('expose readDesignTokens', ()    => assert.ok(src.includes('readDesignTokens')));
  it('expose writeFile', ()           => assert.ok(src.includes('writeFile')));
  it('expose closeWindow', ()         => assert.ok(src.includes('closeWindow')));
  it('utilise contextBridge', ()      => assert.ok(src.includes('contextBridge')));
  it('expose via designApi', ()       => assert.ok(src.includes("'designApi'")));
  it('invoque DESIGN_READ_TOKENS', () => assert.ok(src.includes('DESIGN_READ_TOKENS')));
  it('invoque DESIGN_WRITE_FILE', ()  => assert.ok(src.includes('DESIGN_WRITE_FILE')));
});

// ── windows.js — openDesignWindow ────────────────────────────────────────

describe('windows.js — openDesignWindow', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/windows.js'), 'utf8');

  it('exporte openDesignWindow', () => assert.ok(src.includes('openDesignWindow')));
  it('utilise preload-design.js',  () => assert.ok(src.includes('preload-design.js')));
  it('charge design.html',         () => assert.ok(src.includes('design.html')));
  it('frame:false',                () => assert.ok(src.includes('frame: false')));
  it('singleton : _designWin',     () => assert.ok(src.includes('_designWin')));
  it('nettoie sur closed',         () => assert.ok(src.includes("_designWin = null")));
});

// ── ipc.js — handlers design ─────────────────────────────────────────────

describe('ipc.js — handlers design', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/ipc.js'), 'utf8');

  it('importe openDesignWindow',        () => assert.ok(src.includes('openDesignWindow')));
  it('handler DESIGN_OPEN',             () => assert.ok(src.includes('IPC.DESIGN_OPEN')));
  it('handler DESIGN_CLOSE',            () => assert.ok(src.includes('IPC.DESIGN_CLOSE')));
  it('handler DESIGN_READ_TOKENS',      () => assert.ok(src.includes('IPC.DESIGN_READ_TOKENS')));
  it('handler DESIGN_WRITE_FILE',       () => assert.ok(src.includes('IPC.DESIGN_WRITE_FILE')));
  it('utilise readDesignTokens du harness', () => assert.ok(src.includes("require('../harness/tools/design')")));
  it('utilise path-guard sur write',    () => assert.ok(src.includes('makeGuard')));
});

// ── preload.js — openDesign exposé ───────────────────────────────────────

describe('preload.js — openDesign', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/preload.js'), 'utf8');

  it('expose openDesign', ()      => assert.ok(src.includes('openDesign')));
  it('invoque DESIGN_OPEN', ()    => assert.ok(src.includes('IPC.DESIGN_OPEN')));
});

// ── renderer-visible/app.js — bouton Design Studio ───────────────────────

describe('app.js — bouton Design Studio', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');

  it('contient btn-design-studio',  () => assert.ok(src.includes('btn-design-studio')));
  it('contient _openDesign()',      () => assert.ok(src.includes('_openDesign')));
  it('appelle window.harness.openDesign', () => assert.ok(src.includes('openDesign')));
});

// ── index.html — bouton sidebar ───────────────────────────────────────────

describe('index.html — bouton Design Studio', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/index.html'), 'utf8');

  it('contient btn-design-studio',  () => assert.ok(html.includes('btn-design-studio')));
  it('contient 🎨 dans la sidebar', () => assert.ok(html.includes('🎨')));
  it('contient le texte Design Studio', () => assert.ok(html.includes('Design Studio')));
});

// ── renderer-design — fichiers existent ──────────────────────────────────

describe('renderer-design — fichiers présents', () => {
  it('design.html existe', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/renderer-design/design.html')));
  });
  it('design.js existe', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/renderer-design/design.js')));
  });
  it('design.css existe', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/renderer-design/design.css')));
  });
});

// ── design.html — structure des 4 onglets ────────────────────────────────

describe('design.html — 4 onglets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.html'), 'utf8');

  it('onglet Palette',           () => assert.ok(html.includes('data-tab="palette"')));
  it('onglet Contraste WCAG',    () => assert.ok(html.includes('data-tab="contrast"')));
  it('onglet Tokens CSS',        () => assert.ok(html.includes('data-tab="tokens"')));
  it('onglet Export',            () => assert.ok(html.includes('data-tab="export"')));
  it('bouton fermer',            () => assert.ok(html.includes('btn-close')));
  it('titlebar drag region',     () => assert.ok(html.includes('titlebar')));
  it('load design.js',           () => assert.ok(html.includes('design.js')));
  it('load design.css',          () => assert.ok(html.includes('design.css')));
});

// ── design.js — fonctions color utilities ────────────────────────────────

describe('design.js — utilitaires couleur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.js'), 'utf8');

  it('contient hexToRgb',      () => assert.ok(src.includes('function hexToRgb')));
  it('contient rgbToHsl',      () => assert.ok(src.includes('function rgbToHsl')));
  it('contient hslToRgb',      () => assert.ok(src.includes('function hslToRgb')));
  it('contient luminance',     () => assert.ok(src.includes('function luminance')));
  it('contient contrastRatio', () => assert.ok(src.includes('function contrastRatio')));
  it('contient generatePaletteData', () => assert.ok(src.includes('function generatePaletteData')));
  it('contient buildHarmony',  () => assert.ok(src.includes('function buildHarmony')));
  it('contient findCompliantFgColors', () => assert.ok(src.includes('function findCompliantFgColors')));
  it('STEPS contient 9 tons',  () => {
    const match = src.match(/const STEPS\s*=\s*\[[\s\S]*?\]/);
    assert.ok(match, 'STEPS non trouvé');
    const steps = (match[0].match(/\d{3}/g) || []).filter(n => [100,200,300,400,500,600,700,800,900].includes(+n)).length;
    assert.equal(steps, 9, `STEPS doit avoir 9 entrées, trouvé ${steps}`);
  });
  it('pas de caractères cyrilliques', () => {
    assert.ok(!/[а-яА-Я]/.test(src), 'caractères cyrilliques détectés dans design.js');
  });
});

// ── design.js — simulation daltonisme ────────────────────────────────────

describe('design.js — simulation daltonisme (CVD)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.js'), 'utf8');

  it('contient simulateCVD',     () => assert.ok(src.includes('function simulateCVD')));
  it('contient CVD_MATRICES',    () => assert.ok(src.includes('CVD_MATRICES')));
  it('couvre deuteranopia',      () => assert.ok(src.includes('deuteranopia')));
  it('couvre protanopia',        () => assert.ok(src.includes('protanopia')));
  it('couvre tritanopia',        () => assert.ok(src.includes('tritanopia')));
  it('couvre achromatopsia',     () => assert.ok(src.includes('achromatopsia')));
  it('contient CVD_LABELS',      () => assert.ok(src.includes('CVD_LABELS')));
  it('contient _renderCvdGrid',  () => assert.ok(src.includes('_renderCvdGrid')));
  it('contient _cvdFilter',      () => assert.ok(src.includes('_cvdFilter')));
  it('contient cvd-filter-btn',  () => assert.ok(src.includes('cvd-filter-btn')));
});

// ── design.html — UI simulation daltonisme ────────────────────────────────

describe('design.html — UI simulation daltonisme', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.html'), 'utf8');

  it('contient les boutons cvd-filter-btn', () => assert.ok(html.includes('cvd-filter-btn')));
  it('contient data-cvd="deuteranopia"',    () => assert.ok(html.includes('data-cvd="deuteranopia"')));
  it('contient data-cvd="protanopia"',      () => assert.ok(html.includes('data-cvd="protanopia"')));
  it('contient data-cvd="tritanopia"',      () => assert.ok(html.includes('data-cvd="tritanopia"')));
  it('contient data-cvd="achromatopsia"',   () => assert.ok(html.includes('data-cvd="achromatopsia"')));
  it('contient cvd-grid pour le contraste', () => assert.ok(html.includes('cvd-grid')));
});

// ── design.js — éditeur de courbe ────────────────────────────────────────

describe('design.js — éditeur de courbe de luminosité', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.js'), 'utf8');

  it('contient DEFAULT_L',           () => assert.ok(src.includes('DEFAULT_L')));
  it('contient _curveL',             () => assert.ok(src.includes('_curveL')));
  it('contient _renderCurveEditor',  () => assert.ok(src.includes('_renderCurveEditor')));
  it('contient _updateCurvePath',    () => assert.ok(src.includes('_updateCurvePath')));
  it('contient _catmullRomPath',     () => assert.ok(src.includes('_catmullRomPath')));
  it('contient btn-curve-reset',     () => assert.ok(src.includes('btn-curve-reset')));
  it('contient btn-curve-tailwind',  () => assert.ok(src.includes('btn-curve-tailwind')));
  it('generatePaletteData accepte customL', () => assert.ok(src.includes('customL')));
});

// ── design.html — UI éditeur de courbe ───────────────────────────────────

describe('design.html — UI éditeur de courbe', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.html'), 'utf8');

  it('contient section-curve',       () => assert.ok(html.includes('section-curve')));
  it('contient curve-svg',           () => assert.ok(html.includes('curve-svg')));
  it('contient curve-handles',       () => assert.ok(html.includes('curve-handles')));
  it('contient btn-curve-reset',     () => assert.ok(html.includes('btn-curve-reset')));
  it('contient btn-curve-tailwind',  () => assert.ok(html.includes('btn-curve-tailwind')));
});

// ── design.js — export W3C Design Tokens ─────────────────────────────────

describe('design.js — export W3C tokens', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.js'), 'utf8');
  it('contient format w3c',   () => assert.ok(src.includes("fmt === 'w3c'")));
  it('contient $type: color', () => assert.ok(src.includes("$type: 'color'")));
});

describe('design.html — bouton W3C', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer-design/design.html'), 'utf8');
  it('contient data-fmt="w3c"', () => assert.ok(html.includes('data-fmt="w3c"')));
});

// ── harness/tools/design.js — scan multi-format ──────────────────────────

describe('harness/tools/design.js — scan multi-format tokens', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/design.js'), 'utf8');

  it('contient SCSS_VAR_RE',       () => assert.ok(src.includes('SCSS_VAR_RE')));
  it('contient JS_COLOR_RE',       () => assert.ok(src.includes('JS_COLOR_RE')));
  it('contient _extractTokens',    () => assert.ok(src.includes('function _extractTokens')));
  it('contient _walkTokenFiles',   () => assert.ok(src.includes('function _walkTokenFiles')));
  it('scanne .scss',               () => assert.ok(src.includes(".scss'")));
  it('scanne .js/.ts',             () => assert.ok(src.includes(".js'")));
  it('retourne source css/scss/js', () => {
    assert.ok(src.includes("source: 'css'"));
    assert.ok(src.includes("source: 'scss'"));
    assert.ok(src.includes("source: 'js'"));
  });
});
