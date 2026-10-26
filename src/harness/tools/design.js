'use strict';

/**
 * Outils de design UI/UX (Phase 109).
 *
 * generate_palette   — génère une palette de couleurs WCAG depuis une couleur de base.
 * read_design_tokens — extrait les CSS custom properties des fichiers CSS du projet.
 *
 * Pourquoi sans dépendance : chroma.js pèse 100 ko et nécessite un import npm.
 * L'algorithme HSL + luminance relative WCAG tient en ~80 lignes et couvre 95 % des besoins.
 */

const fs   = require('fs');
const path = require('path');

// ── Utilitaires couleur ──────────────────────────────────────────────────────

function hexToRgb(hex) {
  let s = hex.replace(/^#/, '');
  if (s.length === 3) s = s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return { r: parseInt(s.slice(0,2),16), g: parseInt(s.slice(2,4),16), b: parseInt(s.slice(4,6),16) };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function linearize(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = luminance(rgb1), l2 = luminance(rgb2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

const WHITE = { r:255, g:255, b:255 };
const BLACK = { r:0,   g:0,   b:0   };

// Échelle inspirée Tailwind : 100 (le plus clair) → 900 (le plus foncé)
const STEPS = [
  { step: 100, l: 95 },
  { step: 200, l: 87 },
  { step: 300, l: 77 },
  { step: 400, l: 64 },
  { step: 500, l: 50 },
  { step: 600, l: 38 },
  { step: 700, l: 27 },
  { step: 800, l: 17 },
  { step: 900, l: 9  },
];

// ── generate_palette ─────────────────────────────────────────────────────────

/**
 * Génère une palette WCAG 2.1 à partir d'une couleur de base hexadécimale.
 * @param {{ base_color: string }} args
 * @returns {{ ok: boolean, base: string, palette: object[] }}
 */
function generatePalette(args) {
  const hex = String(args.base_color || '').trim();
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return {
      ok:      false,
      error:   'COULEUR_INVALIDE',
      message: `Couleur invalide : "${hex}". Fournir une valeur hexadécimale valide, ex. #3B82F6 ou #38F`,
    };
  }

  const { h, s } = rgbToHsl(rgb);
  const palette = STEPS.map(({ step, l }) => {
    // Réduire légèrement la saturation aux extrêmes pour un rendu plus naturel
    const sat = Math.round(s * (1 - Math.abs(l - 50) / 200));
    const shadeHex = hslToHex(h, sat, l);
    const shadeRgb = hexToRgb(shadeHex);
    const onWhite  = contrastRatio(shadeRgb, WHITE);
    const onBlack  = contrastRatio(shadeRgb, BLACK);
    const textColor = onWhite >= 4.5 ? '#ffffff' : '#000000';
    return {
      step,
      hex:        shadeHex,
      hsl:        `hsl(${h}, ${sat}%, ${l}%)`,
      on_white:   onWhite,
      on_black:   onBlack,
      text_color: textColor,
      wcag_aa:    (onWhite >= 4.5 || onBlack >= 4.5) ? 'pass' : 'fail',
      wcag_aaa:   (onWhite >= 7   || onBlack >= 7  ) ? 'pass' : 'fail',
    };
  });

  return { ok: true, base: hex, palette };
}

// ── read_design_tokens ───────────────────────────────────────────────────────

const TOKEN_RE    = /--([a-zA-Z0-9-]+)\s*:\s*([^;}\n]+)/g;
const SCSS_VAR_RE = /\$([a-zA-Z0-9_-]+)\s*:\s*([^;!}\n]+)/g;
// Détecte les clés de couleur dans les objets JS/TS : 'key': '#hex' ou "key": "rgba(...)"
const JS_COLOR_RE = /['"]([a-zA-Z0-9_-]+)['"]\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))['"]/g;

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.harness', 'backups']);

function _extractTokens(content, ext) {
  const tokens = [];
  if (ext === '.css') {
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(content)) !== null) {
      tokens.push({ name: `--${m[1]}`, value: m[2].trim(), source: 'css' });
    }
  } else if (ext === '.scss') {
    SCSS_VAR_RE.lastIndex = 0;
    let m;
    while ((m = SCSS_VAR_RE.exec(content)) !== null) {
      // Exclure les lignes qui sont des appels de fonction Sass ou des règles imbriquées
      const val = m[2].trim();
      if (!val.startsWith('(') && !val.startsWith('{')) {
        tokens.push({ name: `$${m[1]}`, value: val, source: 'scss' });
      }
    }
  } else if (ext === '.js' || ext === '.ts' || ext === '.mjs' || ext === '.cjs') {
    JS_COLOR_RE.lastIndex = 0;
    let m;
    while ((m = JS_COLOR_RE.exec(content)) !== null) {
      tokens.push({ name: m[1], value: m[2].trim(), source: 'js' });
    }
  }
  return tokens;
}

const TOKEN_EXTS = new Set(['.css', '.scss', '.js', '.ts', '.mjs', '.cjs']);

function _walkTokenFiles(dir, results, projectRoot, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      _walkTokenFiles(full, results, projectRoot, depth + 1);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (!TOKEN_EXTS.has(ext)) continue;
      // Pour les JS/TS, ne scanner que les fichiers dont le nom suggère un thème/tokens
      if ((ext === '.js' || ext === '.ts' || ext === '.mjs' || ext === '.cjs')
          && !/theme|token|color|colour|palette|design|style/i.test(e.name)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const tokens  = _extractTokens(content, ext);
        if (tokens.length) {
          results.push({ file: path.relative(projectRoot, full).replace(/\\/g, '/'), tokens });
        }
      } catch { /* skip */ }
    }
  }
}

/**
 * Extrait les design tokens (CSS custom props, variables SCSS, couleurs JS/TS de thème)
 * d'un fichier ou de tout le projet.
 * @param {{ path?: string }} args
 * @param {Function} guard    safe(relPath) → absPath
 * @param {string}   projectRoot
 * @returns {{ ok: boolean, files: object[], total: number }}
 */
function readDesignTokens(args, guard, projectRoot) {
  const results = [];

  if (args.path) {
    let absPath;
    try { absPath = guard(args.path); }
    catch (e) { return { ok: false, error: 'CHEMIN_INTERDIT', message: e.message }; }
    if (!fs.existsSync(absPath)) return { ok: false, error: 'FICHIER_INTROUVABLE', message: `Fichier introuvable : ${args.path}` };
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const ext     = path.extname(absPath).toLowerCase();
      const tokens  = _extractTokens(content, ext);
      if (tokens.length) results.push({ file: args.path, tokens });
    } catch (e) { return { ok: false, error: 'LECTURE_ECHOUEE', message: e.message }; }
  } else {
    _walkTokenFiles(projectRoot, results, projectRoot, 0);
  }

  const total = results.reduce((n, f) => n + f.tokens.length, 0);
  return { ok: true, files: results, total };
}

module.exports = { generatePalette, readDesignTokens };
