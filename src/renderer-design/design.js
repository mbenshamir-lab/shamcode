'use strict';

// ── Utilitaires couleur ────────────────────────────────────────────────────

function hexToRgb(hex) {
  const s = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null;
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0)
        : max === gn ? (bn - rn) / d + 2
                     : (rn - gn) / d + 4;
  return { h: Math.round(h / 6 * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h, s, l) {
  const H = h / 360, S = s / 100, L = l / 100;
  if (S === 0) { const v = Math.round(L * 255); return { r: v, g: v, b: v }; }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const hue2rgb = (p, q, t) => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1/6) return p + (q - p) * 6 * tt;
    if (tt < 1/2) return q;
    if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(p, q, H + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, H)       * 255),
    b: Math.round(hue2rgb(p, q, H - 1/3) * 255),
  };
}

function hslToHex(h, s, l) { return rgbToHex(hslToRgb(h, s, l)); }

function linearize(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(c1, c2) {
  const l1 = luminance(c1), l2 = luminance(c2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return parseFloat(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

function wcagBadge(ratio, large = false) {
  const aa = large ? 3.0 : 4.5, aaa = large ? 4.5 : 7.0;
  if (ratio >= aaa) return 'AAA';
  if (ratio >= aa)  return 'AA';
  return 'fail';
}

// ── Simulation daltonisme (Viénot 1999, espace sRGB) ──────────────────────

const CVD_MATRICES = {
  deuteranopia:  [[0.625, 0.375, 0],   [0.700, 0.300, 0],   [0,     0.300, 0.700]],
  protanopia:    [[0.567, 0.433, 0],   [0.558, 0.442, 0],   [0,     0.242, 0.758]],
  tritanopia:    [[0.950, 0.050, 0],   [0,     0.433, 0.567],[0,     0.475, 0.525]],
  achromatopsia: [[0.299, 0.587, 0.114],[0.299, 0.587, 0.114],[0.299, 0.587, 0.114]],
};

const CVD_LABELS = {
  deuteranopia:  'Deutéranopie',
  protanopia:    'Protanopie',
  tritanopia:    'Tritanopie',
  achromatopsia: 'Achromatopsie',
};

function simulateCVD(rgb, type) {
  if (!type) return rgb;
  const m = CVD_MATRICES[type];
  if (!m) return rgb;
  const { r, g, b } = rgb;
  const clamp = v => Math.min(255, Math.max(0, Math.round(v)));
  return {
    r: clamp(m[0][0]*r + m[0][1]*g + m[0][2]*b),
    g: clamp(m[1][0]*r + m[1][1]*g + m[1][2]*b),
    b: clamp(m[2][0]*r + m[2][1]*g + m[2][2]*b),
  };
}

// ── Palette 100→900 ────────────────────────────────────────────────────────

const DEFAULT_L = [95, 87, 76, 63, 50, 40, 30, 20, 9];
const STEPS     = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function generatePaletteData(baseHex, customL) {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(rgb);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0,   g: 0,   b: 0   };
  const lValues = customL || DEFAULT_L;

  return STEPS.map((step, i) => {
    const l       = lValues[i];
    const toneRgb = hslToRgb(h, s, l);
    const toneHex = rgbToHex(toneRgb);
    const onWhite = contrastRatio(toneRgb, white);
    const onBlack = contrastRatio(toneRgb, black);
    const textColor = onWhite >= onBlack ? '#ffffff' : '#000000';
    const textRgb   = textColor === '#ffffff' ? white : black;
    const ratio     = contrastRatio(toneRgb, textRgb);
    return {
      step, hex: toneHex,
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
      on_white: onWhite, on_black: onBlack,
      text_color: textColor,
      wcag_aa:  ratio >= 4.5 ? 'pass' : 'fail',
      wcag_aaa: ratio >= 7.0 ? 'pass' : 'fail',
    };
  });
}

// ── Harmonies ──────────────────────────────────────────────────────────────

function buildHarmony(baseHex, type) {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);
  const hues = {
    mono:     [h, (h+30)%360, (h-30+360)%360, (h+60)%360, (h-60+360)%360],
    comp:     [h, (h+180)%360, (h+150)%360, (h+210)%360, (h+165)%360],
    analogous:[h, (h+30)%360, (h-30+360)%360, (h+60)%360, (h-60+360)%360],
    triadic:  [h, (h+120)%360, (h+240)%360, (h+60)%360, (h+180)%360],
    split:    [h, (h+150)%360, (h+210)%360, (h+30)%360, (h-30+360)%360],
  };
  return (hues[type] || hues.mono).slice(0, 5).map(hue => ({
    hex: hslToHex(hue, s, l), hsl: `hsl(${hue}, ${s}%, ${l}%)`,
  }));
}

const HARMONY_LABELS = {
  mono:'Monochromatique', comp:'Complémentaire',
  analogous:'Analogique', triadic:'Triadique', split:'Split-complémentaire',
};

// ── Auto-fix contraste ─────────────────────────────────────────────────────

function findCompliantFgColors(bgHex, targetRatio = 4.5) {
  const bgRgb = hexToRgb(bgHex);
  if (!bgRgb) return [];
  const { h, s } = rgbToHsl(bgRgb);
  const seen = new Set();
  return Array.from({ length: 21 }, (_, i) => i * 5).map(testL => {
    const testRgb = hslToRgb(h, s, testL);
    return { hex: hslToHex(h, s, testL), ratio: contrastRatio(testRgb, bgRgb) };
  }).filter(r => {
    if (r.ratio < targetRatio || seen.has(r.hex)) return false;
    seen.add(r.hex); return true;
  }).slice(0, 6);
}

// ── État global ────────────────────────────────────────────────────────────

let _palette    = null;
let _baseHex    = '#3B82F6';
let _paletteHex = '#3B82F6';
let _cvdFilter  = '';          // '' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'achromatopsia'
let _curveL     = [...DEFAULT_L];  // L values éditées par la courbe

// ── Toast ──────────────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('visible'), 2200);
}

// ── Tabs ───────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    if (tab === 'export') _renderExport();
  });
});

document.getElementById('btn-close').addEventListener('click', () => {
  if (window.designApi?.closeWindow) window.designApi.closeWindow();
  else window.close();
});

// ── ONGLET PALETTE — contrôles principaux ─────────────────────────────────

const palPicker  = document.getElementById('pal-picker');
const palHexIn   = document.getElementById('pal-hex');

palPicker.addEventListener('input', () => { palHexIn.value = palPicker.value; });
palHexIn.addEventListener('input', () => {
  const rgb = hexToRgb(palHexIn.value);
  if (rgb) palPicker.value = palHexIn.value.length === 7 ? palHexIn.value : rgbToHex(rgb);
});

document.getElementById('btn-gen-palette').addEventListener('click', () => {
  const hex = palHexIn.value.trim();
  if (!hexToRgb(hex)) { showToast('Couleur invalide — entrez un hex valide (#RGB ou #RRGGBB)'); return; }
  _baseHex = _paletteHex = hex;
  _curveL  = [...DEFAULT_L];
  _palette = generatePaletteData(hex, _curveL);
  _renderSwatches();
  _renderHarmonies();
  _renderCurveEditor();
  document.getElementById('section-curve').style.display = '';
  document.getElementById('pal-cvd-row').style.display   = '';
  document.getElementById('palette-empty').style.display = 'none';
});

// ── Simulation daltonisme — palette ───────────────────────────────────────

document.querySelectorAll('.cvd-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _cvdFilter = btn.dataset.cvd;
    document.querySelectorAll('.cvd-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.cvd === _cvdFilter));
    _renderSwatches();
  });
});

// ── Render swatches ────────────────────────────────────────────────────────

function _applySwatchCvd(hexColor) {
  if (!_cvdFilter) return hexColor;
  const rgb = hexToRgb(hexColor);
  if (!rgb) return hexColor;
  return rgbToHex(simulateCVD(rgb, _cvdFilter));
}

function _renderSwatches() {
  if (!_palette) return;
  const grid  = document.getElementById('swatches-grid');
  const title = document.getElementById('swatches-title');
  const label = _cvdFilter ? ` — ${CVD_LABELS[_cvdFilter]}` : '';
  title.textContent = `Palette — ${_baseHex.toUpperCase()}${label}`;
  grid.innerHTML    = '';

  _palette.forEach(tone => {
    const displayHex = _applySwatchCvd(tone.hex);
    const el = document.createElement('div');
    el.className = 'swatch';
    el.title = `Cliquer pour copier ${tone.hex}`;

    const badgesHtml = `
      <span class="badge ${tone.wcag_aa === 'pass' ? 'pass' : 'fail'}">AA ${tone.wcag_aa === 'pass' ? '✓' : '✗'}</span>
      ${tone.wcag_aaa === 'pass' ? '<span class="badge aaa">AAA ✓</span>' : ''}
    `;
    el.innerHTML = `
      <div class="swatch-color" style="background:${displayHex};color:${tone.text_color};">
        <span>${tone.step}</span>
      </div>
      <div class="swatch-info">
        <div class="swatch-step">${tone.step}</div>
        <div class="swatch-hex">${tone.hex.toUpperCase()}</div>
        <div class="swatch-badges">${badgesHtml}</div>
      </div>
    `;
    el.addEventListener('click', () =>
      navigator.clipboard.writeText(tone.hex).then(() => showToast(`Copié : ${tone.hex}`))
    );
    grid.appendChild(el);
  });
  document.getElementById('section-swatches').style.display = '';
}

// ── Render harmonies ───────────────────────────────────────────────────────

function _renderHarmonies() {
  const grid  = document.getElementById('harmonies-grid');
  grid.innerHTML = '';
  ['mono','comp','analogous','triadic','split'].forEach(type => {
    const colors = buildHarmony(_baseHex, type);
    if (!colors) return;
    const card = document.createElement('div');
    card.className = 'harmony-card';
    const sw = colors.map(c =>
      `<div class="harmony-swatch" style="background:${_applySwatchCvd(c.hex)}" title="${c.hex}" data-hex="${c.hex}"></div>`
    ).join('');
    card.innerHTML = `<div class="harmony-name">${HARMONY_LABELS[type]}</div><div class="harmony-swatches">${sw}</div>`;
    card.querySelectorAll('.harmony-swatch').forEach(s => {
      s.addEventListener('click', () =>
        navigator.clipboard.writeText(s.dataset.hex).then(() => showToast(`Copié : ${s.dataset.hex}`))
      );
    });
    grid.appendChild(card);
  });
  document.getElementById('section-harmonies').style.display = '';
}

// ── Éditeur de courbe de luminosité ───────────────────────────────────────

// Positions X dans le SVG pour les 9 steps (0→280, marge 10px)
const CURVE_XS = STEPS.map((_, i) => Math.round(10 + i * (270 / 8)));
const SVG_H    = 110;

function _lToY(l) { return SVG_H - 5 - Math.round(l / 100 * (SVG_H - 10)); }
function _yToL(y) { return Math.max(0, Math.min(100, Math.round((SVG_H - 5 - y) / (SVG_H - 10) * 100))); }

function _catmullRomPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function _updateCurvePath() {
  const pts = CURVE_XS.map((x, i) => ({ x, y: _lToY(_curveL[i]) }));
  const d   = _catmullRomPath(pts);
  document.getElementById('curve-path').setAttribute('d', d);
  // Area fill : fermer vers le bas
  const last = pts[pts.length - 1];
  document.getElementById('curve-area').setAttribute('d', d + ` L ${last.x} ${SVG_H} L ${pts[0].x} ${SVG_H} Z`);
  // Mettre à jour les handles
  document.querySelectorAll('.curve-handle').forEach((circle, i) => {
    circle.setAttribute('cy', _lToY(_curveL[i]));
    circle.setAttribute('title', `L = ${_curveL[i]}`);
  });
}

function _renderCurveEditor() {
  const handlesGroup = document.getElementById('curve-handles');
  handlesGroup.innerHTML = '';

  CURVE_XS.forEach((cx, i) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'curve-handle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', _lToY(_curveL[i]));
    circle.setAttribute('r', '5');

    // Drag logic
    let dragging = false;
    let startY = 0, startL = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const svg = document.getElementById('curve-svg');
      const rect = svg.getBoundingClientRect();
      const scaleY = SVG_H / rect.height;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const svgY = (clientY - rect.top) * scaleY;
      _curveL[i] = _yToL(svgY);
      _updateCurvePath();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onUp);
      // Régénérer la palette avec la courbe éditée
      _palette = generatePaletteData(_baseHex, _curveL);
      _renderSwatches();
    };
    circle.addEventListener('mousedown', (e) => {
      dragging = true; startY = e.clientY; startL = _curveL[i];
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
    });
    circle.addEventListener('touchstart', (e) => {
      dragging = true;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onUp);
      e.preventDefault();
    }, { passive: false });

    handlesGroup.appendChild(circle);
  });

  // Étiquettes X (steps)
  const xLabels = document.getElementById('curve-x-labels');
  xLabels.innerHTML = STEPS.map((s, i) =>
    `<span style="position:absolute;left:${CURVE_XS[i]}px;transform:translateX(-50%)">${s}</span>`
  ).join('');

  _updateCurvePath();
}

// Réinitialiser la courbe
document.getElementById('btn-curve-reset').addEventListener('click', () => {
  _curveL  = [...DEFAULT_L];
  _palette = generatePaletteData(_baseHex, _curveL);
  _updateCurvePath();
  _renderSwatches();
});

// Preset Tailwind (distribution perceptuellement uniforme)
document.getElementById('btn-curve-tailwind').addEventListener('click', () => {
  _curveL  = [96, 89, 78, 64, 49, 37, 26, 16, 8];
  _palette = generatePaletteData(_baseHex, _curveL);
  _updateCurvePath();
  _renderSwatches();
  showToast('Courbe Tailwind appliquée');
});

// ── ONGLET CONTRASTE ───────────────────────────────────────────────────────

const ctFgPicker = document.getElementById('ct-fg-picker');
const ctFgHex    = document.getElementById('ct-fg-hex');
const ctBgPicker = document.getElementById('ct-bg-picker');
const ctBgHex    = document.getElementById('ct-bg-hex');

function _updateContrast() {
  const fgRgb = hexToRgb(ctFgHex.value);
  const bgRgb = hexToRgb(ctBgHex.value);
  if (!fgRgb || !bgRgb) return;

  const ratio = contrastRatio(fgRgb, bgRgb);

  // Aperçu normal
  const box = document.getElementById('ct-preview-box');
  box.style.background = ctBgHex.value;
  document.getElementById('ct-preview-large').style.color = ctFgHex.value;
  document.getElementById('ct-preview-small').style.color = ctFgHex.value;

  // Ratio + classe couleur
  const ratioEl = document.getElementById('ct-ratio');
  ratioEl.textContent = ratio.toFixed(2) + ':1';
  ratioEl.className   = 'ratio-display ' + (ratio >= 7 ? 'good' : ratio >= 4.5 ? 'ok' : 'bad');

  // Table WCAG
  const makeCell = (pass) => `<span class="badge ${pass ? 'pass' : 'fail'}">${pass ? 'Passe ✓' : 'Échoue ✗'}</span>`;
  document.getElementById('ct-aa-normal').innerHTML  = makeCell(ratio >= 4.5);
  document.getElementById('ct-aa-large').innerHTML   = makeCell(ratio >= 3.0);
  document.getElementById('ct-aaa-normal').innerHTML = makeCell(ratio >= 7.0);
  document.getElementById('ct-aaa-large').innerHTML  = makeCell(ratio >= 4.5);

  // Auto-fix
  const fixContainer = document.getElementById('ct-autofix');
  if (ratio >= 4.5) {
    fixContainer.innerHTML = '<span style="color:var(--green);font-size:12px;">✓ Déjà conforme AA</span>';
  } else {
    const suggestions = findCompliantFgColors(ctBgHex.value, 4.5);
    fixContainer.innerHTML = suggestions.length === 0
      ? '<span style="color:var(--text3);font-size:12px;">Aucune suggestion trouvée</span>'
      : suggestions.map(s => `
          <div class="autofix-chip" data-hex="${s.hex}" title="Utiliser ${s.hex}">
            <div class="autofix-chip-swatch" style="background:${s.hex}"></div>
            <span class="autofix-chip-label">${s.hex}</span>
            <span class="autofix-chip-ratio">${s.ratio.toFixed(2)}:1</span>
          </div>`).join('');
    fixContainer.querySelectorAll('.autofix-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        ctFgHex.value = ctFgPicker.value = chip.dataset.hex;
        _updateContrast();
      });
    });
  }

  // Simulation daltonisme
  _renderCvdGrid(fgRgb, bgRgb);
}

function _renderCvdGrid(fgRgb, bgRgb) {
  const grid = document.getElementById('cvd-grid');
  grid.innerHTML = '';
  Object.keys(CVD_MATRICES).forEach(type => {
    const simFg = simulateCVD(fgRgb, type);
    const simBg = simulateCVD(bgRgb, type);
    const simRatio = contrastRatio(simFg, simBg);
    const fgHex = rgbToHex(simFg);
    const bgHex = rgbToHex(simBg);
    const badge = simRatio >= 7 ? 'AAA' : simRatio >= 4.5 ? 'AA' : simRatio >= 3 ? 'AA (gd)' : 'fail';
    const badgeClass = simRatio >= 4.5 ? 'pass' : simRatio >= 3 ? 'ok' : 'fail';
    const card = document.createElement('div');
    card.className = 'cvd-card';
    card.innerHTML = `
      <div class="cvd-preview" style="background:${bgHex};color:${fgHex}">Aa</div>
      <div class="cvd-info">
        <div class="cvd-type">${CVD_LABELS[type]}</div>
        <div class="cvd-ratio">${simRatio.toFixed(2)}:1 <span class="badge ${badgeClass}">${badge}</span></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

ctFgPicker.addEventListener('input', () => { ctFgHex.value = ctFgPicker.value; _updateContrast(); });
ctBgPicker.addEventListener('input', () => { ctBgHex.value = ctBgPicker.value; _updateContrast(); });
ctFgHex.addEventListener('input', () => { if (hexToRgb(ctFgHex.value)) { ctFgPicker.value = ctFgHex.value; _updateContrast(); }});
ctBgHex.addEventListener('input', () => { if (hexToRgb(ctBgHex.value)) { ctBgPicker.value = ctBgHex.value; _updateContrast(); }});

_updateContrast();

// ── ONGLET TOKENS ──────────────────────────────────────────────────────────

let _allTokens = [];

document.getElementById('btn-scan-tokens').addEventListener('click', async () => {
  const btn = document.getElementById('btn-scan-tokens');
  btn.innerHTML = '<span class="spinner"></span>Scan en cours…';
  btn.disabled  = true;
  try {
    const result = await window.designApi.readDesignTokens({});
    _allTokens = [];
    if (result.ok && result.files) {
      result.files.forEach(f =>
        f.tokens.forEach(t => _allTokens.push({ file: f.file, name: t.name, value: t.value.trim(), source: t.source || 'css' }))
      );
    }
    document.getElementById('tokens-sources').style.display = _allTokens.length ? '' : 'none';
    _renderTokens('');
  } catch (err) {
    document.getElementById('tokens-content').innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-msg">${err.message}</div></div>`;
  } finally {
    btn.innerHTML = '🔍 Scanner le projet';
    btn.disabled  = false;
  }
});

document.getElementById('tokens-search').addEventListener('input', e => _renderTokens(e.target.value));

function _guessTokenType(name, value) {
  const n = name.toLowerCase(), v = value.toLowerCase();
  if (/color|colour|bg|background|text|fg|border|shadow|fill|stroke/.test(n)) return 'color';
  if (/^#[0-9a-f]{3,8}$/i.test(v) || v.startsWith('rgb') || v.startsWith('hsl')) return 'color';
  if (/spacing|space|gap|margin|padding|size|width|height|radius/.test(n)) return 'spacing';
  if (/font|text-size|line|letter/.test(n)) return 'typography';
  return 'other';
}

function _renderTokens(filter) {
  const lf       = filter.toLowerCase();
  const filtered = lf
    ? _allTokens.filter(t => t.name.toLowerCase().includes(lf) || t.value.toLowerCase().includes(lf))
    : _allTokens;

  document.getElementById('tokens-stats').textContent = filtered.length
    ? `${filtered.length} token${filtered.length > 1 ? 's' : ''}`
    : '';

  if (filtered.length === 0) {
    document.getElementById('tokens-content').innerHTML = _allTokens.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🗂</div><div class="empty-msg">Cliquez <strong>Scanner le projet</strong> pour extraire les tokens CSS, SCSS et JS/TS</div></div>`
      : `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-msg">Aucun token ne correspond à « ${filter} »</div></div>`;
    return;
  }

  const groups = { color: [], spacing: [], typography: [], other: [] };
  filtered.forEach(t => groups[_guessTokenType(t.name, t.value)].push(t));

  const groupLabels = { color:'🎨 Couleurs', spacing:'📐 Espacement', typography:'🔤 Typographie', other:'⚙ Autres' };
  let html = '';
  for (const [type, tokens] of Object.entries(groups)) {
    if (!tokens.length) continue;
    html += `<div class="token-group">
      <div class="token-group-title">${groupLabels[type]} <span class="token-count">${tokens.length}</span></div>
      <div class="token-list">`;
    tokens.forEach(t => {
      const isColor = type === 'color' || /^#[0-9a-f]{3,8}$/i.test(t.value) || t.value.startsWith('rgb') || t.value.startsWith('hsl');
      const previewHtml = isColor
        ? `<div class="token-preview-swatch" style="background:${t.value}"></div>`
        : type === 'spacing'
          ? `<div class="token-preview-spacing" style="width:${Math.min(100, parseInt(t.value) || 16)}%"></div>`
          : '<div style="width:20px"></div>';
      const srcBadge = `<span class="source-badge ${t.source}" style="font-size:9px;padding:1px 4px">${t.source.toUpperCase()}</span>`;
      html += `<div class="token-row" data-name="${t.name}" data-value="${t.value}" title="Cliquer pour copier">
        ${previewHtml}
        <span class="token-name">${t.name}</span>
        <span class="token-value">${t.value} ${srcBadge}</span>
      </div>`;
    });
    html += '</div></div>';
  }
  document.getElementById('tokens-content').innerHTML = html;

  document.querySelectorAll('.token-row').forEach(row => {
    row.addEventListener('click', () => {
      const name = row.dataset.name;
      // CSS custom props → var(), SCSS → $name, JS → plain name
      const val = name.startsWith('--') ? `var(${name})` : name.startsWith('$') ? name : name;
      navigator.clipboard.writeText(val).then(() => showToast(`Copié : ${val}`));
    });
  });
}

// ── ONGLET EXPORT ──────────────────────────────────────────────────────────

let _exportFormat = 'css';

document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _exportFormat = btn.dataset.fmt;
    document.querySelectorAll('.format-btn').forEach(b => b.classList.toggle('active', b.dataset.fmt === _exportFormat));
    _renderExport();
  });
});

document.getElementById('btn-copy-export').addEventListener('click', () => {
  const code = document.getElementById('export-code').textContent;
  if (code) navigator.clipboard.writeText(code).then(() => showToast('Code copié !'));
});

document.getElementById('btn-write-export').addEventListener('click', async () => {
  const relPath = document.getElementById('export-path').value.trim();
  const content = document.getElementById('export-code').textContent;
  const status  = document.getElementById('write-status');
  if (!relPath)  { showToast('Entrez un chemin de fichier'); return; }
  if (!content)  { showToast('Rien à écrire — générez d\'abord une palette'); return; }
  try {
    status.textContent = '⏳ Écriture…'; status.className = 'write-status'; status.style.display = '';
    const res = await window.designApi.writeFile(relPath, content);
    status.textContent = res.ok ? `✓ Écrit dans ${relPath}` : `✗ Erreur : ${res.error}`;
    status.className   = 'write-status' + (res.ok ? '' : ' error');
  } catch (err) {
    status.textContent = `✗ ${err.message}`; status.className = 'write-status error';
  }
});

function _renderExport() {
  const noP = document.getElementById('export-no-palette');
  const cnt = document.getElementById('export-content');
  if (!_palette) { noP.style.display = ''; cnt.style.display = 'none'; return; }
  noP.style.display = 'none'; cnt.style.display = '';
  document.getElementById('export-code').textContent = _generateExportCode(_exportFormat);
}

function _generateExportCode(fmt) {
  if (!_palette) return '';
  const hex  = _paletteHex.replace('#', '');
  const name = `color-${hex}`;

  if (fmt === 'css') {
    return `:root {\n${_palette.map(t => `  --${name}-${t.step}: ${t.hex};`).join('\n')}\n}`;
  }
  if (fmt === 'tailwind') {
    const inner = _palette.map(t => `      ${t.step}: '${t.hex}',`).join('\n');
    return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        '${name}': {\n${inner}\n        },\n      },\n    },\n  },\n};`;
  }
  if (fmt === 'scss') {
    return `// _tokens.scss\n${_palette.map(t => `$${name}-${t.step}: ${t.hex};`).join('\n')}`;
  }
  if (fmt === 'json') {
    const obj = {};
    _palette.forEach(t => { obj[`${name}-${t.step}`] = t.hex; });
    return JSON.stringify(obj, null, 2);
  }
  if (fmt === 'w3c') {
    // Format W3C Design Tokens (https://design-tokens.github.io/community-group/format/)
    const tokens = {};
    _palette.forEach(t => {
      tokens[`${t.step}`] = { $value: t.hex, $type: 'color' };
    });
    return JSON.stringify({ [name]: tokens }, null, 2);
  }
  return '';
}
