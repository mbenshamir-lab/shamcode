'use strict';

/**
 * Tests Phase 109 — Outils design (generate_palette + read_design_tokens)
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { generatePalette, readDesignTokens } = require('../src/harness/tools/design');
const { TOOLS }      = require('../src/shared/constants');
const { selectToolsForTask } = require('../src/harness/tools/families');

// ── generate_palette ─────────────────────────────────────────────────────────

describe('generate_palette — couleur de base', () => {
  it('retourne 9 tons pour une couleur valide', () => {
    const r = generatePalette({ base_color: '#3B82F6' });
    assert.ok(r.ok, 'doit réussir');
    assert.equal(r.palette.length, 9);
    assert.equal(r.base, '#3B82F6');
  });

  it('les tons couvrent l\'échelle 100→900', () => {
    const r = generatePalette({ base_color: '#3B82F6' });
    const steps = r.palette.map(p => p.step);
    assert.deepEqual(steps, [100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('chaque ton expose hex, hsl, on_white, on_black, text_color, wcag_aa, wcag_aaa', () => {
    const r = generatePalette({ base_color: '#22C55E' });
    for (const tone of r.palette) {
      assert.ok(typeof tone.hex === 'string' && tone.hex.startsWith('#'),   `hex invalide step ${tone.step}`);
      assert.ok(typeof tone.hsl === 'string' && tone.hsl.startsWith('hsl'), `hsl invalide step ${tone.step}`);
      assert.ok(typeof tone.on_white === 'number',  `on_white invalide step ${tone.step}`);
      assert.ok(typeof tone.on_black === 'number',  `on_black invalide step ${tone.step}`);
      assert.ok(['#ffffff', '#000000'].includes(tone.text_color), `text_color invalide step ${tone.step}`);
      assert.ok(['pass', 'fail'].includes(tone.wcag_aa),  `wcag_aa invalide step ${tone.step}`);
      assert.ok(['pass', 'fail'].includes(tone.wcag_aaa), `wcag_aaa invalide step ${tone.step}`);
    }
  });

  it('le ton 100 est plus clair que le ton 900', () => {
    const r = generatePalette({ base_color: '#6366F1' });
    const t100 = r.palette.find(p => p.step === 100);
    const t900 = r.palette.find(p => p.step === 900);
    // Luminosité (on_white inversement proportionnelle : plus clair = moins de contraste sur fond blanc)
    assert.ok(t100.on_white < t900.on_white, '100 doit être plus clair que 900');
  });

  it('les tons foncés passent WCAG AA sur fond blanc', () => {
    const r = generatePalette({ base_color: '#3B82F6' });
    const dark = r.palette.filter(p => p.step >= 700);
    for (const t of dark) {
      assert.ok(t.on_white >= 4.5, `step ${t.step} : contraste sur blanc ${t.on_white} < 4.5`);
    }
  });

  it('accepte notation courte #RGB', () => {
    const r = generatePalette({ base_color: '#38F' });
    assert.ok(r.ok);
    assert.equal(r.palette.length, 9);
  });

  it('renvoie COULEUR_INVALIDE si hex mal formé', () => {
    assert.equal(generatePalette({ base_color: 'bleu'  }).error, 'COULEUR_INVALIDE');
    assert.equal(generatePalette({ base_color: '#GGG'  }).error, 'COULEUR_INVALIDE');
    assert.equal(generatePalette({ base_color: ''       }).error, 'COULEUR_INVALIDE');
  });

  it('renvoie ok:false si base_color absent', () => {
    assert.equal(generatePalette({}).ok, false);
  });
});

// ── read_design_tokens ───────────────────────────────────────────────────────

describe('read_design_tokens — extraction CSS', () => {
  // Crée un répertoire temporaire avec des fichiers CSS de test
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-'));
  const guardOk = rel => path.join(tmpDir, rel);

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('extrait les tokens d\'un fichier CSS simple', () => {
    const cssFile = path.join(tmpDir, 'tokens.css');
    fs.writeFileSync(cssFile, `:root { --color-primary: #3B82F6; --spacing-md: 1rem; }`);
    const r = readDesignTokens({ path: 'tokens.css' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.equal(r.total, 2);
    const names = r.files[0].tokens.map(t => t.name);
    assert.ok(names.includes('--color-primary'), '--color-primary absent');
    assert.ok(names.includes('--spacing-md'),    '--spacing-md absent');
  });

  it('retourne ok:true avec total:0 si aucun token dans le fichier', () => {
    const cssFile = path.join(tmpDir, 'empty.css');
    fs.writeFileSync(cssFile, `body { color: red; }`);
    const r = readDesignTokens({ path: 'empty.css' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.equal(r.total, 0);
    assert.equal(r.files.length, 0);
  });

  it('scanne tous les CSS si path absent', () => {
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'theme.css'), `:root { --bg: #fff; --text: #111; }`);
    const guard = rel => rel ? path.join(tmpDir, rel) : tmpDir;
    const r = readDesignTokens({}, guard, tmpDir);
    assert.ok(r.ok);
    assert.ok(r.total >= 2, `total ${r.total} < 2 (tokens de theme.css manquants)`);
  });

  it('renvoie FICHIER_INTROUVABLE pour un fichier inexistant', () => {
    const r = readDesignTokens({ path: 'inexistant.css' }, guardOk, tmpDir);
    assert.ok(!r.ok);
    assert.equal(r.error, 'FICHIER_INTROUVABLE');
  });

  it('structure retournée : { ok, files:[{ file, tokens:[{ name, value }] }], total }', () => {
    const cssFile2 = path.join(tmpDir, 'structure.css');
    fs.writeFileSync(cssFile2, `:root { --accent: #6366F1; }`);
    const r = readDesignTokens({ path: 'structure.css' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.ok(Array.isArray(r.files));
    const token = r.files[0].tokens[0];
    assert.ok(typeof token.name  === 'string');
    assert.ok(typeof token.value === 'string');
    assert.ok(token.value.includes('#6366F1'));
  });

  it('extrait les variables SCSS ($var: value)', () => {
    const scssFile = path.join(tmpDir, 'tokens.scss');
    fs.writeFileSync(scssFile, `$color-primary: #3B82F6;\n$spacing-lg: 2rem;\n$font-size: 16px;`);
    const r = readDesignTokens({ path: 'tokens.scss' }, guardOk, tmpDir);
    assert.ok(r.ok, 'doit réussir');
    assert.ok(r.total >= 3, `total ${r.total} < 3`);
    const names = r.files[0].tokens.map(t => t.name);
    assert.ok(names.includes('$color-primary'), '$color-primary absent');
    assert.ok(names.includes('$spacing-lg'),    '$spacing-lg absent');
  });

  it('les tokens SCSS ont source:"scss"', () => {
    const scssFile = path.join(tmpDir, 'typed.scss');
    fs.writeFileSync(scssFile, `$accent: #7c6af7;`);
    const r = readDesignTokens({ path: 'typed.scss' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.equal(r.files[0].tokens[0].source, 'scss');
  });

  it('les tokens CSS ont source:"css"', () => {
    const cssFile3 = path.join(tmpDir, 'typed2.css');
    fs.writeFileSync(cssFile3, `:root { --primary: #3B82F6; }`);
    const r = readDesignTokens({ path: 'typed2.css' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.equal(r.files[0].tokens[0].source, 'css');
  });

  it('extrait les couleurs de fichiers JS de thème', () => {
    const jsFile = path.join(tmpDir, 'theme.js');
    fs.writeFileSync(jsFile, `const theme = { colors: { 'primary': '#3B82F6', 'danger': '#ef4444' } };`);
    const r = readDesignTokens({ path: 'theme.js' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.ok(r.total >= 2, `JS colors total ${r.total} < 2`);
    const names = r.files[0].tokens.map(t => t.name);
    assert.ok(names.includes('primary'), 'primary absent du thème JS');
    assert.ok(names.includes('danger'),  'danger absent du thème JS');
  });

  it('les tokens JS ont source:"js"', () => {
    const jsFile2 = path.join(tmpDir, 'colors.js');
    fs.writeFileSync(jsFile2, `module.exports = { 'brand': '#7c6af7' };`);
    const r = readDesignTokens({ path: 'colors.js' }, guardOk, tmpDir);
    assert.ok(r.ok);
    assert.equal(r.files[0].tokens[0].source, 'js');
  });

  it('scanne les .scss en mode projet (path absent)', () => {
    const sub2 = path.join(tmpDir, 'scss-sub');
    fs.mkdirSync(sub2, { recursive: true });
    fs.writeFileSync(path.join(sub2, 'vars.scss'), `$brand: #22c55e; $neutral: #6b7280;`);
    const guard = rel => rel ? path.join(tmpDir, rel) : tmpDir;
    const r = readDesignTokens({}, guard, tmpDir);
    assert.ok(r.ok);
    const allNames = r.files.flatMap(f => f.tokens.map(t => t.name));
    assert.ok(allNames.includes('$brand'), '$brand introuvable dans le scan projet');
  });
});

// ── Intégration : constantes + familles + dispatch ───────────────────────────

describe('constantes et familles design', () => {
  it('TOOLS.GENERATE_PALETTE vaut "generate_palette"', () => {
    assert.equal(TOOLS.GENERATE_PALETTE, 'generate_palette');
  });

  it('TOOLS.READ_DESIGN_TOKENS vaut "read_design_tokens"', () => {
    assert.equal(TOOLS.READ_DESIGN_TOKENS, 'read_design_tokens');
  });

  it('la famille design est chargée sur déclencheur "palette"', () => {
    const tools = selectToolsForTask(
      ['read_file', 'generate_palette', 'read_design_tokens'],
      'génère une palette pour le thème',
      {}
    );
    assert.ok(tools.includes('generate_palette'),    'generate_palette doit être sélectionné');
    assert.ok(tools.includes('read_design_tokens'),  'read_design_tokens doit être sélectionné');
  });

  it('la famille design est chargée sur déclencheur "wcag"', () => {
    const tools = selectToolsForTask(
      ['generate_palette', 'read_design_tokens'],
      'vérifie la conformité WCAG',
      {}
    );
    assert.ok(tools.includes('generate_palette'));
  });

  it('la famille design est chargée sur déclencheur "token"', () => {
    const tools = selectToolsForTask(
      ['generate_palette', 'read_design_tokens'],
      'liste les tokens CSS du projet',
      {}
    );
    assert.ok(tools.includes('read_design_tokens'));
  });

  it('le persona designer force la famille design', () => {
    const { resolvePersona } = require('../src/harness/prompts/personas');
    const { forceFamilies }  = resolvePersona('designer');
    const tools = selectToolsForTask(
      ['generate_palette', 'read_design_tokens', 'read_file'],
      'analyser le code',
      { forceFamilies }
    );
    assert.ok(tools.includes('generate_palette'),   'forcé par persona designer');
    assert.ok(tools.includes('read_design_tokens'), 'forcé par persona designer');
  });
});

// ── HTML — bouton designer ────────────────────────────────────────────────────

describe('index.html — bouton designer', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');

  it('contient l\'option persona designer du combo', () => {
    assert.ok(html.includes('<option value="designer">'), 'option designer absente');
  });

  it('contient l\'icône 🎨', () => {
    assert.ok(html.includes('🎨'), 'icône designer absente');
  });
});

// ── agent.js — descriptions des outils ───────────────────────────────────────

describe('agent.js — descriptions outils design', () => {
  const agentJs = fs.readFileSync(path.join(__dirname, '../src/harness/agent.js'), 'utf8');

  it('contient la description de generate_palette', () => {
    assert.ok(agentJs.includes('generate_palette'), 'description generate_palette absente');
    assert.ok(agentJs.includes('WCAG'),             'mention WCAG absente');
  });

  it('contient la description de read_design_tokens', () => {
    assert.ok(agentJs.includes('read_design_tokens'), 'description read_design_tokens absente');
    assert.ok(agentJs.includes('custom properties') || agentJs.includes('custom prop'), 'mention custom properties absente');
  });
});
