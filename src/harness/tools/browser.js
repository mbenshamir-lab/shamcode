/**
 * Outils navigateur — wrapper puppeteer-core.
 * Instance singleton par session d'agent.
 * Chrome doit être installé sur la machine (puppeteer-core ne le bundle pas).
 */

// puppeteer-core est ESM-only (v25+) — chargement via import() dynamique.
// _puppeteerOverride est injecté par les tests pour éviter un vrai launch.
let _puppeteer         = null;
let _puppeteerOverride = null;
async function _getPuppeteer() {
  if (_puppeteerOverride) return _puppeteerOverride;
  if (!_puppeteer) _puppeteer = (await import('puppeteer-core')).default;
  return _puppeteer;
}
/** Injecte un mock puppeteer-core (tests uniquement). */
function _setPuppeteerMock(mock) { _puppeteerOverride = mock; _puppeteer = null; }
const path = require('path');
const fs   = require('fs');

// Chemins courants de Chrome sur Windows
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function _findChrome() {
  for (const p of CHROME_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignoré */ }
  }
  return null;
}

// Singleton navigateur — une seule instance par session agent
let _browser = null;
let _page    = null;

/** Retourne le navigateur actif ou lance une erreur si non ouvert. */
function _requireBrowser() {
  if (!_browser || !_page) return { ok: false, error: 'NAVIGATEUR_NON_OUVERT — appelle browser_open en premier' };
  return null;
}

// ── Outils ───────────────────────────────────────────────────────────────────

async function browserOpen(args) {
  const { url = 'about:blank', headless = false } = args || {};

  // Réutilise le navigateur si déjà ouvert
  if (_browser && !_browser.disconnected) {
    try {
      if (url !== 'about:blank') await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true, status: 'réutilisé', url: _page.url() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const executablePath = _findChrome();
  if (!executablePath) {
    return { ok: false, error: 'CHROME_INTROUVABLE — installe Google Chrome ou Microsoft Edge' };
  }

  try {
    const puppeteer = await _getPuppeteer();
    _browser = await puppeteer.launch({
      executablePath,
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    _page = await _browser.newPage();
    await _page.setViewport({ width: 1280, height: 800 });

    if (url !== 'about:blank') {
      await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    _browser.once('disconnected', () => { _browser = null; _page = null; });

    return { ok: true, status: 'ouvert', url: _page.url() };
  } catch (err) {
    _browser = null; _page = null;
    return { ok: false, error: err.message };
  }
}

async function browserNavigate(args) {
  const err = _requireBrowser(); if (err) return err;
  const { url, timeout = 30000 } = args || {};
  if (!url) return { ok: false, error: 'URL_MANQUANTE' };

  try {
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return { ok: true, url: _page.url(), title: await _page.title() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserScreenshot(args, guard, projectRoot) {
  const err = _requireBrowser(); if (err) return err;
  const { path: relPath = 'screenshot.png', selector, full_page = false } = args || {};

  try {
    let absPath;
    try {
      absPath = guard ? guard(relPath) : path.resolve(projectRoot || '.', relPath);
    } catch {
      return { ok: false, error: 'CHEMIN_HORS_PROJET' };
    }

    const options = { path: absPath, fullPage: full_page };
    if (selector) {
      const el = await _page.$(selector);
      if (!el) return { ok: false, error: `SÉLECTEUR_INTROUVABLE: ${selector}` };
      await el.screenshot(options);
    } else {
      await _page.screenshot(options);
    }
    return { ok: true, path: relPath, absPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserClick(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, x, y, timeout = 5000 } = args || {};

  try {
    if (selector) {
      await _page.waitForSelector(selector, { timeout });
      await _page.click(selector);
    } else if (x !== undefined && y !== undefined) {
      await _page.mouse.click(x, y);
    } else {
      return { ok: false, error: 'SELECTOR_OU_COORDS_REQUIS' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserType(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, text, clear = true, timeout = 5000 } = args || {};
  if (!selector) return { ok: false, error: 'SELECTOR_REQUIS' };
  if (text === undefined) return { ok: false, error: 'TEXT_REQUIS' };

  try {
    await _page.waitForSelector(selector, { timeout });
    if (clear) {
      await _page.click(selector, { clickCount: 3 }); // sélectionne tout
      await _page.keyboard.press('Backspace');
    }
    await _page.type(selector, String(text), { delay: 20 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserEvaluate(args, config) {
  const err = _requireBrowser(); if (err) return err;
  // Sécurité : évaluation JS arbitraire nécessite enableShell
  if (!config?.enableShell) {
    return { ok: false, error: 'BROWSER_EVALUATE_DÉSACTIVÉ — active enableShell pour exécuter du JS dans la page' };
  }
  const { script } = args || {};
  if (!script) return { ok: false, error: 'SCRIPT_REQUIS' };

  try {
    const result = await _page.evaluate(new Function(`return (async () => { ${script} })()`));  // eslint-disable-line no-new-func
    return { ok: true, result: JSON.parse(JSON.stringify(result ?? null)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserGetText(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, max_chars = 8000 } = args || {};

  try {
    let text;
    if (selector) {
      await _page.waitForSelector(selector, { timeout: 5000 });
      text = await _page.$eval(selector, el => el.innerText || el.textContent || '');
    } else {
      text = await _page.evaluate(() => document.body.innerText || '');
    }
    const truncated = text.length > max_chars;
    return { ok: true, text: text.slice(0, max_chars), truncated, totalChars: text.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserWait(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, ms, timeout = 10000 } = args || {};

  try {
    if (selector) {
      await _page.waitForSelector(selector, { timeout });
      return { ok: true, found: selector };
    } else {
      const delay = Math.min(ms ?? 1000, 30000);
      await new Promise(r => setTimeout(r, delay));
      return { ok: true, waited: delay };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Retourne une vue structurée de la page : texte tronqué + liens + boutons + champs.
 * Conçu pour la navigation autonome : le LLM voit ce avec quoi il peut interagir.
 */
async function browserGetContent(args) {
  const err = _requireBrowser(); if (err) return err;
  const { max_chars = 4000, max_links = 20, max_elements = 15 } = args || {};

  try {
    const result = await _page.evaluate(({ maxChars, maxLinks, maxElems }) => {
      function bestSelector(el) {
        if (el.id) return `#${el.id}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        const aria = el.getAttribute('aria-label');
        if (aria) return `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        return null;
      }

      const bodyText = (document.body && document.body.innerText) || '';
      const text     = bodyText.slice(0, maxChars);

      const linkEls = Array.from(document.querySelectorAll('a[href]')).slice(0, maxLinks);
      const links   = linkEls.map(a => ({
        text:     (a.innerText || a.title || a.getAttribute('aria-label') || '').trim().slice(0, 80),
        href:     a.getAttribute('href'),
        selector: bestSelector(a) || `a[href="${a.getAttribute('href')}"]`,
      })).filter(l => l.text || l.href);

      const inputEls = Array.from(
        document.querySelectorAll('input:not([type="hidden"]), textarea, select'),
      ).slice(0, maxElems);
      const inputs = inputEls.map(el => ({
        tag:         el.tagName.toLowerCase(),
        type:        el.type || null,
        name:        el.name || null,
        placeholder: el.placeholder || null,
        selector:    bestSelector(el) || el.tagName.toLowerCase(),
      }));

      const btnEls  = Array.from(
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'),
      ).slice(0, maxElems);
      const buttons = btnEls.map(el => ({
        text:     (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60),
        selector: bestSelector(el) || el.tagName.toLowerCase(),
      })).filter(b => b.text);

      return {
        url:       location.href,
        title:     document.title,
        text,
        truncated: bodyText.length > maxChars,
        links,
        inputs,
        buttons,
      };
    }, { maxChars: max_chars, maxLinks: max_links, maxElems: max_elements });

    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Retourne le HTML brut d'un sélecteur (tableaux, listes, structures complexes). */
async function browserGetDom(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, max_chars = 10000 } = args || {};

  try {
    let html;
    if (selector) {
      await _page.waitForSelector(selector, { timeout: 5000 });
      html = await _page.$eval(selector, el => el.innerHTML);
    } else {
      html = await _page.evaluate(() => document.body.innerHTML);
    }
    const truncated = html.length > max_chars;
    return { ok: true, html: html.slice(0, max_chars), truncated };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Sélectionne une option dans un élément <select>. */
async function browserSelect(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, value, timeout = 5000 } = args || {};
  if (!selector) return { ok: false, error: 'SELECTOR_REQUIS' };
  if (value === undefined) return { ok: false, error: 'VALUE_REQUIS' };

  try {
    await _page.waitForSelector(selector, { timeout });
    await _page.select(selector, String(value));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Coche ou décoche une checkbox / radio. */
async function browserCheck(args) {
  const err = _requireBrowser(); if (err) return err;
  const { selector, checked = true, timeout = 5000 } = args || {};
  if (!selector) return { ok: false, error: 'SELECTOR_REQUIS' };

  try {
    await _page.waitForSelector(selector, { timeout });
    const current = await _page.$eval(selector, el => el.checked);
    if (current !== checked) await _page.click(selector);
    return { ok: true, checked };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Appuie sur une touche clavier (Tab, Enter, Escape, ArrowDown…). */
async function browserKey(args) {
  const err = _requireBrowser(); if (err) return err;
  const { key, selector, count = 1 } = args || {};
  if (!key) return { ok: false, error: 'KEY_REQUIS' };

  try {
    if (selector) {
      await _page.waitForSelector(selector, { timeout: 5000 });
      await _page.focus(selector);
    }
    const n = Math.min(Math.max(1, count), 20);
    for (let i = 0; i < n; i++) await _page.keyboard.press(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Ouvre un nouvel onglet et le rend actif. */
async function browserNewTab(args) {
  const err = _requireBrowser(); if (err) return err;
  const { url } = args || {};

  try {
    const page = await _browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pages = await _browser.pages();
    const index = pages.indexOf(page);
    _page = page;
    return { ok: true, index, url: page.url() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Liste tous les onglets ouverts avec leur index, URL et titre. */
async function browserListTabs() {
  const err = _requireBrowser(); if (err) return err;

  try {
    const pages   = await _browser.pages();
    const current = pages.indexOf(_page);
    const tabs    = await Promise.all(pages.map(async (p, i) => ({
      index:  i,
      url:    p.url(),
      title:  await p.title(),
      active: i === current,
    })));
    return { ok: true, tabs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Change l'onglet actif par son index (voir browser_list_tabs). */
async function browserSwitchTab(args) {
  const err = _requireBrowser(); if (err) return err;
  const { index } = args || {};
  if (index === undefined) return { ok: false, error: 'INDEX_REQUIS' };

  try {
    const pages = await _browser.pages();
    if (index < 0 || index >= pages.length) {
      return { ok: false, error: `INDEX_HORS_LIMITES: ${index} (${pages.length} onglets)` };
    }
    _page = pages[index];
    await _page.bringToFront();
    return { ok: true, index, url: _page.url(), title: await _page.title() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Fait défiler la page ou amène un élément en vue. */
async function browserScroll(args) {
  const err = _requireBrowser(); if (err) return err;
  const { direction = 'down', pixels = 500, selector } = args || {};

  try {
    if (selector) {
      await _page.waitForSelector(selector, { timeout: 5000 });
      await _page.$eval(selector, el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } else {
      await _page.evaluate(({ dir, px }) => {
        if      (dir === 'top')    window.scrollTo(0, 0);
        else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
        else if (dir === 'down')   window.scrollBy(0, px);
        else if (dir === 'up')     window.scrollBy(0, -px);
      }, { dir: direction, px: pixels });
    }
    const scrollY = await _page.evaluate(() => window.scrollY);
    return { ok: true, scrollY };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserClose() {
  if (!_browser) return { ok: true, status: 'déjà_fermé' };
  try {
    await _browser.close();
  } catch { /* ignoré */ } finally {
    _browser = null;
    _page    = null;
  }
  return { ok: true, status: 'fermé' };
}

/** Appelée à la fin de session pour libérer les ressources. */
async function disposeBrowser() {
  await browserClose();
}

module.exports = {
  browserOpen,
  browserNavigate,
  browserScreenshot,
  browserClick,
  browserType,
  browserEvaluate,
  browserGetText,
  browserGetContent,
  browserGetDom,
  browserSelect,
  browserCheck,
  browserKey,
  browserNewTab,
  browserListTabs,
  browserSwitchTab,
  browserScroll,
  browserWait,
  browserClose,
  disposeBrowser,
  _setPuppeteerMock,
};
