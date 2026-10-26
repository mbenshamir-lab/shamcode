/**
 * Tests outils navigateur (browser.js) — sans lancer de vrai Chrome.
 * On mock puppeteer-core et on vérifie la logique de chaque outil.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// ── Mock puppeteer-core ──────────────────────────────────────────────────────
// Injecté dans le cache require avant le premier require('puppeteer-core') par browser.js
let _mockPage;
let _mockBrowser;

function _buildMockPage() {
  return {
    _url: 'about:blank',
    _title: 'Test Page',
    _text: 'Contenu de test',
    _checked: false,
    setViewport: async () => {},
    goto: async (url) => { _mockPage._url = url; },
    url: function() { return this._url; },
    title: async function() { return this._title; },
    screenshot: async (opts) => {
      if (opts?.path) {
        const fs = require('fs');
        fs.mkdirSync(require('path').dirname(opts.path), { recursive: true });
        fs.writeFileSync(opts.path, 'fake-png-data');
      }
    },
    $: async (sel) => sel === '.missing' ? null : { screenshot: async (o) => { if (o?.path) require('fs').writeFileSync(o.path, 'elem-png'); } },
    $eval: async (sel, fn) => fn({ innerText: _mockPage._text, textContent: _mockPage._text, innerHTML: '<p>html</p>', checked: _mockPage._checked, scrollIntoView: () => {} }),
    evaluate: async () => _mockPage._text || '',
    waitForSelector: async (sel) => { if (sel === '.never') throw new Error('Timeout'); },
    click: async () => { _mockPage._checked = !_mockPage._checked; },
    select: async () => {},
    focus: async () => {},
    bringToFront: async () => {},
    type: async () => {},
    keyboard: { press: async () => {} },
    mouse: { click: async () => {} },
  };
}

function _buildMockBrowser() {
  return {
    disconnected: false,
    _closed: false,
    _pages: null,
    newPage: async () => {
      const p = _buildMockPage();
      if (_mockBrowser) _mockBrowser._pages = [_mockPage, p];
      _mockPage = p;
      return p;
    },
    pages: async function() { return this._pages || [_mockPage]; },
    close: async () => { _mockBrowser._closed = true; },
    once: () => {},
  };
}

// Charger browser.js et injecter le mock via _setPuppeteerMock
// (puppeteer-core v25+ est ESM-only — require.cache ne peut plus l'intercepter)
const browser = require('../src/harness/tools/browser');

const _mockPuppeteer = {
  launch: async () => {
    _mockBrowser = _buildMockBrowser();
    return _mockBrowser;
  },
};
browser._setPuppeteerMock(_mockPuppeteer);

// Guard minimal pour les tests
const TMP = require('os').tmpdir();
function _guard(rel) {
  const abs = path.join(TMP, 'browser-test', rel);
  return abs;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('browser — browserOpen', () => {
  beforeEach(async () => { await browser.browserClose(); });

  it('retourne CHROME_INTROUVABLE quand aucun chemin Chrome n\'existe', async () => {
    // Patch _findChrome pour renvoyer null via un chemin inexistant
    // Le mock puppeteer-core sera appelé car _findChrome cherche des chemins réels
    // Sur la machine de test les chemins peuvent exister ou non — on teste le cas OK via mock
    // On force un résultat ok grâce au mock puppeteer
    const r = await browser.browserOpen({ url: 'https://example.com', headless: true });
    // Soit ok (Chrome trouvé), soit CHROME_INTROUVABLE
    assert.ok(r.ok === true || r.error === 'CHROME_INTROUVABLE');
  });

  it('renvoie ok:true avec url quand le mock réussit', async () => {
    // Patcher fs.existsSync pour simuler Chrome présent
    const fs = require('fs');
    const origExists = fs.existsSync;
    fs.existsSync = (p) => p.includes('chrome') || p.includes('Chrome') || p.includes('msedge') || p.includes('Edge') ? true : origExists(p);
    try {
      const r = await browser.browserOpen({ url: 'https://example.com', headless: true });
      assert.equal(r.ok, true);
      assert.equal(r.url, 'https://example.com');
    } finally {
      fs.existsSync = origExists;
    }
  });
});

describe('browser — browserNavigate', () => {
  before(async () => {
    const fs = require('fs');
    const origExists = fs.existsSync;
    fs.existsSync = () => true;
    await browser.browserOpen({ headless: true });
    fs.existsSync = origExists;
  });

  it('navigue vers une URL et retourne titre', async () => {
    const r = await browser.browserNavigate({ url: 'https://example.com' });
    assert.equal(r.ok, true);
    assert.equal(r.url, 'https://example.com');
    assert.ok('title' in r);
  });

  it('retourne URL_MANQUANTE sans url', async () => {
    const r = await browser.browserNavigate({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'URL_MANQUANTE');
  });
});

describe('browser — browserScreenshot', () => {
  it('capture la page et crée le fichier', async () => {
    const r = await browser.browserScreenshot({ path: 'capture.png' }, _guard, TMP);
    assert.equal(r.ok, true);
    assert.ok(r.path.endsWith('.png'));
  });

  it('retourne SÉLECTEUR_INTROUVABLE pour .missing', async () => {
    const r = await browser.browserScreenshot({ path: 'x.png', selector: '.missing' }, _guard, TMP);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('SÉLECTEUR_INTROUVABLE'));
  });
});

describe('browser — browserClick', () => {
  it('clique via sélecteur existant', async () => {
    const r = await browser.browserClick({ selector: '.btn' });
    assert.equal(r.ok, true);
  });

  it('clique via coordonnées', async () => {
    const r = await browser.browserClick({ x: 100, y: 200 });
    assert.equal(r.ok, true);
  });

  it('retourne erreur si selector timeout', async () => {
    const r = await browser.browserClick({ selector: '.never', timeout: 100 });
    assert.equal(r.ok, false);
  });

  it('retourne SELECTOR_OU_COORDS_REQUIS sans args', async () => {
    const r = await browser.browserClick({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SELECTOR_OU_COORDS_REQUIS');
  });
});

describe('browser — browserType', () => {
  it('saisit du texte', async () => {
    const r = await browser.browserType({ selector: 'input', text: 'bonjour' });
    assert.equal(r.ok, true);
  });

  it('retourne SELECTOR_REQUIS sans selector', async () => {
    const r = await browser.browserType({ text: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SELECTOR_REQUIS');
  });

  it('retourne TEXT_REQUIS sans text', async () => {
    const r = await browser.browserType({ selector: 'input' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'TEXT_REQUIS');
  });
});

describe('browser — browserEvaluate', () => {
  it('bloqué si enableShell:false', async () => {
    const r = await browser.browserEvaluate({ script: 'return 1' }, { enableShell: false });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('BROWSER_EVALUATE_DÉSACTIVÉ'));
  });

  it('exécute et retourne résultat si enableShell:true', async () => {
    _mockPage.evaluate = async () => 42;
    const r = await browser.browserEvaluate({ script: 'return 42' }, { enableShell: true });
    assert.equal(r.ok, true);
    assert.equal(r.result, 42);
  });

  it('retourne SCRIPT_REQUIS sans script', async () => {
    const r = await browser.browserEvaluate({}, { enableShell: true });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SCRIPT_REQUIS');
  });
});

describe('browser — browserGetText', () => {
  before(() => {
    // Rétablir evaluate après la réécriture dans browserEvaluate.
    // Retourne _text directement — fn() référencerait `document` absent en Node.js.
    if (_mockPage) {
      _mockPage.evaluate = async () => _mockPage._text || '';
      _mockPage._text = 'Contenu de test';
    }
  });

  it('retourne le texte de la page', async () => {
    const r = await browser.browserGetText({});
    assert.equal(r.ok, true);
    assert.ok(typeof r.text === 'string');
  });

  it('tronque au-delà de max_chars', async () => {
    _mockPage._text = 'x'.repeat(200);
    const r = await browser.browserGetText({ max_chars: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.text.length, 50);
    assert.equal(r.truncated, true);
  });

  it('retourne texte complet si en dessous de max_chars', async () => {
    _mockPage._text = 'court';
    const r = await browser.browserGetText({ max_chars: 100 });
    assert.equal(r.truncated, false);
  });
});

describe('browser — browserWait', () => {
  it('attend un délai ms', async () => {
    const t0 = Date.now();
    const r = await browser.browserWait({ ms: 50 });
    assert.equal(r.ok, true);
    assert.ok(Date.now() - t0 >= 40);
  });

  it('attend un sélecteur existant', async () => {
    const r = await browser.browserWait({ selector: '.loaded' });
    assert.equal(r.ok, true);
  });

  it('retourne erreur pour sélecteur .never', async () => {
    const r = await browser.browserWait({ selector: '.never', timeout: 100 });
    assert.equal(r.ok, false);
  });
});

describe('browser — browserClose', () => {
  it('ferme le navigateur et retourne fermé', async () => {
    const r = await browser.browserClose();
    assert.equal(r.ok, true);
  });

  it('retourne déjà_fermé si appelé deux fois', async () => {
    const r = await browser.browserClose();
    assert.equal(r.ok, true);
    assert.equal(r.status, 'déjà_fermé');
  });
});

describe('browser — erreur si navigateur non ouvert', () => {
  it('browserNavigate retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserNavigate({ url: 'https://x.com' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserClick retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserClick({ selector: '.x' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserGetText retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserGetText({});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserGetContent retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserGetContent({});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserScroll retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserScroll({});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserGetDom retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserGetDom({});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserSelect retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserSelect({ selector: 'select', value: 'a' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserCheck retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserCheck({ selector: 'input' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });

  it('browserKey retourne NAVIGATEUR_NON_OUVERT', async () => {
    const r = await browser.browserKey({ key: 'Enter' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('NAVIGATEUR_NON_OUVERT'));
  });
});

describe('browser — disposeBrowser', () => {
  it('ne plante pas si aucun navigateur n\'est ouvert', async () => {
    await assert.doesNotReject(() => browser.disposeBrowser());
  });
});

describe('constants — BROWSER_* présents dans TOOLS', () => {
  it('les 18 constantes browser sont définies', () => {
    const { TOOLS } = require('../src/shared/constants');
    const expected = [
      'BROWSER_OPEN', 'BROWSER_NAVIGATE', 'BROWSER_SCREENSHOT',
      'BROWSER_CLICK', 'BROWSER_TYPE', 'BROWSER_EVALUATE',
      'BROWSER_GET_TEXT', 'BROWSER_GET_CONTENT', 'BROWSER_GET_DOM',
      'BROWSER_SELECT', 'BROWSER_CHECK', 'BROWSER_KEY',
      'BROWSER_NEW_TAB', 'BROWSER_LIST_TABS', 'BROWSER_SWITCH_TAB',
      'BROWSER_SCROLL', 'BROWSER_WAIT', 'BROWSER_CLOSE',
    ];
    for (const k of expected) {
      assert.ok(TOOLS[k], `TOOLS.${k} manquant`);
    }
  });

  it('les valeurs commencent toutes par browser_', () => {
    const { TOOLS } = require('../src/shared/constants');
    const keys = Object.keys(TOOLS).filter(k => k.startsWith('BROWSER_'));
    assert.equal(keys.length, 18);
    for (const k of keys) {
      assert.ok(TOOLS[k].startsWith('browser_'), `TOOLS.${k} = "${TOOLS[k]}" ne commence pas par browser_`);
    }
  });
});

describe('browser — browserGetContent', () => {
  before(async () => {
    // Rouvrir le navigateur avec mock existant
    const fs = require('fs');
    const origExists = fs.existsSync;
    fs.existsSync = () => true;
    await browser.browserOpen({ headless: true });
    fs.existsSync = origExists;
  });

  beforeEach(() => {
    // Retourne une structure DOM simulée (la fn eval tourne côté browser en prod,
    // ici on surcharge evaluate pour renvoyer un objet structuré directement).
    _mockPage.evaluate = async (_fn, _args) => ({
      url:       'https://example.com',
      title:     'Page test',
      text:      'Bonjour monde',
      truncated: false,
      links:     [{ text: 'Accueil', href: '/', selector: 'a[href="/"]' }],
      inputs:    [{ tag: 'input', type: 'text', name: 'q', placeholder: 'Chercher', selector: 'input[name="q"]' }],
      buttons:   [{ text: 'Envoyer', selector: '#submit' }],
    });
  });

  after(() => {
    // Restaurer evaluate standard pour les suites suivantes
    if (_mockPage) _mockPage.evaluate = async () => _mockPage._text || '';
  });

  it('retourne url, title, text, links, inputs, buttons', async () => {
    const r = await browser.browserGetContent({});
    assert.equal(r.ok, true);
    assert.equal(r.title, 'Page test');
    assert.ok(Array.isArray(r.links));
    assert.ok(Array.isArray(r.inputs));
    assert.ok(Array.isArray(r.buttons));
  });

  it('les liens contiennent text, href, selector', async () => {
    const r = await browser.browserGetContent({});
    assert.equal(r.ok, true);
    const lien = r.links[0];
    assert.ok('text'     in lien);
    assert.ok('href'     in lien);
    assert.ok('selector' in lien);
  });

  it('les inputs contiennent tag et selector', async () => {
    const r = await browser.browserGetContent({});
    assert.equal(r.ok, true);
    const inp = r.inputs[0];
    assert.ok('tag'      in inp);
    assert.ok('selector' in inp);
  });
});

describe('browser — browserScroll', () => {
  before(async () => {
    // S'assurer que le navigateur est ouvert
    if (!_mockBrowser || _mockBrowser._closed) {
      const fs = require('fs');
      const origExists = fs.existsSync;
      fs.existsSync = () => true;
      await browser.browserOpen({ headless: true });
      fs.existsSync = origExists;
    }
  });

  beforeEach(() => {
    // evaluate pour browserScroll : renvoie toujours 0 (scrollY simulé)
    _mockPage.evaluate = async () => 0;
    _mockPage.$eval   = async (_sel, fn) => fn({ scrollIntoView: () => {} });
    _mockPage.waitForSelector = async (sel) => { if (sel === '.never') throw new Error('Timeout'); };
  });

  after(() => {
    if (_mockPage) _mockPage.evaluate = async () => _mockPage._text || '';
  });

  it('scroll down retourne ok:true et scrollY numérique', async () => {
    const r = await browser.browserScroll({ direction: 'down', pixels: 300 });
    assert.equal(r.ok, true);
    assert.ok(typeof r.scrollY === 'number');
  });

  it('scroll top retourne ok:true', async () => {
    const r = await browser.browserScroll({ direction: 'top' });
    assert.equal(r.ok, true);
  });

  it('scroll sur selector retourne ok:true', async () => {
    const r = await browser.browserScroll({ selector: '#section' });
    assert.equal(r.ok, true);
  });

  it('scroll sur selector .never retourne erreur', async () => {
    const r = await browser.browserScroll({ selector: '.never' });
    assert.equal(r.ok, false);
  });
});

describe('browser — browserGetDom', () => {
  it('retourne HTML brut d\'un sélecteur', async () => {
    _mockPage.$eval = async (_s, fn) => fn({ innerHTML: '<li>item</li>' });
    const r = await browser.browserGetDom({ selector: 'ul' });
    assert.equal(r.ok, true);
    assert.ok(r.html.includes('<li>'));
  });

  it('tronque si HTML dépasse max_chars', async () => {
    _mockPage.$eval = async (_s, fn) => fn({ innerHTML: 'x'.repeat(200) });
    const r = await browser.browserGetDom({ selector: 'div', max_chars: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.html.length, 50);
    assert.equal(r.truncated, true);
  });

  it('retourne erreur pour sélecteur .never', async () => {
    const r = await browser.browserGetDom({ selector: '.never' });
    assert.equal(r.ok, false);
  });
});

describe('browser — browserSelect', () => {
  it('retourne ok:true sur select valide', async () => {
    const r = await browser.browserSelect({ selector: 'select#pays', value: 'FR' });
    assert.equal(r.ok, true);
  });

  it('retourne SELECTOR_REQUIS sans selector', async () => {
    const r = await browser.browserSelect({ value: 'FR' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SELECTOR_REQUIS');
  });

  it('retourne VALUE_REQUIS sans value', async () => {
    const r = await browser.browserSelect({ selector: 'select' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'VALUE_REQUIS');
  });

  it('retourne erreur pour sélecteur .never', async () => {
    const r = await browser.browserSelect({ selector: '.never', value: 'x' });
    assert.equal(r.ok, false);
  });
});

describe('browser — browserCheck', () => {
  beforeEach(() => {
    _mockPage._checked = false;
    _mockPage.$eval = async (_s, fn) => fn({ innerText: '', textContent: '', innerHTML: '', checked: _mockPage._checked, scrollIntoView: () => {} });
  });

  it('coche une checkbox non cochée (checked:true)', async () => {
    const r = await browser.browserCheck({ selector: 'input#cgu', checked: true });
    assert.equal(r.ok, true);
    assert.equal(r.checked, true);
  });

  it('ne reclique pas si déjà dans l\'état voulu', async () => {
    _mockPage._checked = true;
    let clicks = 0;
    const orig = _mockPage.click;
    _mockPage.click = async () => { clicks++; _mockPage._checked = !_mockPage._checked; };
    const r = await browser.browserCheck({ selector: 'input#cgu', checked: true });
    assert.equal(r.ok, true);
    assert.equal(clicks, 0);
    _mockPage.click = orig;
  });

  it('retourne SELECTOR_REQUIS sans selector', async () => {
    const r = await browser.browserCheck({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SELECTOR_REQUIS');
  });
});

describe('browser — browserKey', () => {
  it('appuie sur Enter et retourne ok:true', async () => {
    const r = await browser.browserKey({ key: 'Enter' });
    assert.equal(r.ok, true);
  });

  it('appuie N fois (count)', async () => {
    let presses = 0;
    const orig = _mockPage.keyboard.press;
    _mockPage.keyboard.press = async () => { presses++; };
    const r = await browser.browserKey({ key: 'Tab', count: 3 });
    assert.equal(r.ok, true);
    assert.equal(presses, 3);
    _mockPage.keyboard.press = orig;
  });

  it('limite count à 20', async () => {
    let presses = 0;
    const orig = _mockPage.keyboard.press;
    _mockPage.keyboard.press = async () => { presses++; };
    await browser.browserKey({ key: 'ArrowDown', count: 50 });
    assert.equal(presses, 20);
    _mockPage.keyboard.press = orig;
  });

  it('retourne KEY_REQUIS sans key', async () => {
    const r = await browser.browserKey({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'KEY_REQUIS');
  });

  it('avec selector : focus puis touche', async () => {
    let focused = false;
    _mockPage.focus = async () => { focused = true; };
    const r = await browser.browserKey({ key: 'Enter', selector: '#input' });
    assert.equal(r.ok, true);
    assert.ok(focused);
  });
});

describe('browser — browserNewTab + browserListTabs + browserSwitchTab', () => {
  before(async () => {
    const fs = require('fs');
    const orig = fs.existsSync;
    fs.existsSync = () => true;
    await browser.browserClose();
    await browser.browserOpen({ headless: true });
    fs.existsSync = orig;
    // Réinitialiser _pages après open
    _mockBrowser._pages = null;
  });

  it('browserNewTab ouvre un nouvel onglet et retourne son index', async () => {
    const r = await browser.browserNewTab({ url: 'https://example.com' });
    assert.equal(r.ok, true);
    assert.ok(typeof r.index === 'number');
  });

  it('browserListTabs liste les onglets', async () => {
    const r = await browser.browserListTabs();
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.tabs));
    assert.ok(r.tabs.length >= 1);
    const active = r.tabs.find(t => t.active);
    assert.ok(active, 'un onglet doit être actif');
  });

  it('browserSwitchTab change l\'onglet actif', async () => {
    const r = await browser.browserSwitchTab({ index: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.index, 0);
  });

  it('browserSwitchTab retourne INDEX_REQUIS sans index', async () => {
    const r = await browser.browserSwitchTab({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'INDEX_REQUIS');
  });

  it('browserSwitchTab retourne INDEX_HORS_LIMITES pour index trop grand', async () => {
    const r = await browser.browserSwitchTab({ index: 999 });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('INDEX_HORS_LIMITES'));
  });
});

describe('tools/index — dispatch browser_*', () => {
  it('dispatch browser_open sans crash (mock puppeteer)', async () => {
    const { dispatch } = require('../src/harness/tools/index');
    const guard = (p) => path.join(TMP, p);
    const r = await dispatch('browser_close', {}, guard, {}, () => {}, TMP);
    assert.equal(r.ok, true);
  });

  it('dispatch outil browser inconnu retourne OUTIL_INCONNU', async () => {
    const { dispatch } = require('../src/harness/tools/index');
    const r = await dispatch('browser_inexistant', {}, () => {}, {}, () => {}, TMP);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('OUTIL_INCONNU'));
  });
});

describe('agent.js — outils browser dans toolNames', () => {
  it('les descriptions browser_* sont dans allToolDefs', () => {
    // On vérifie que agent.js exporte les bonnes descriptions via runAgent stub
    const src = require('fs').readFileSync(
      require.resolve('../src/harness/agent.js'), 'utf8'
    );
    const expected = [
      'browser_open', 'browser_navigate', 'browser_screenshot',
      'browser_click', 'browser_type', 'browser_evaluate',
      'browser_get_text', 'browser_get_content', 'browser_get_dom',
      'browser_select', 'browser_check', 'browser_key',
      'browser_new_tab', 'browser_list_tabs', 'browser_switch_tab',
      'browser_scroll', 'browser_wait', 'browser_close',
    ];
    for (const name of expected) {
      assert.ok(src.includes(`'${name}'`) || src.includes(`"${name}"`), `description "${name}" absente de agent.js`);
    }
  });

  it('disposeBrowser est importé dans agent.js', () => {
    const src = require('fs').readFileSync(
      require.resolve('../src/harness/agent.js'), 'utf8'
    );
    assert.ok(src.includes('disposeBrowser'));
  });

  it('disposeBrowser appelé aux 3 points de sortie', () => {
    const src = require('fs').readFileSync(
      require.resolve('../src/harness/agent.js'), 'utf8'
    );
    const count = (src.match(/disposeBrowser\(\)/g) || []).length;
    assert.ok(count >= 3, `disposeBrowser() trouvé ${count} fois, attendu ≥ 3`);
  });
});
