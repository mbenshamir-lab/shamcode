const { BrowserWindow, app } = require('electron');
const path = require('path');
const { IPC } = require('../shared/constants');
const { attachShortcutGuard } = require('./shortcuts');

const ICON_PATH = path.join(app.getAppPath(), 'assets', 'icons', 'app.ico');

let _settingsWin  = null;
let _designWin    = null;
let _voiceWin     = null;
let _donationWin  = null;

const DONATION_URL = 'https://rqxgytgh.mychariow.shop/prd_0ggsmhqq';

// Patterns d'URL indiquant une confirmation de paiement Chariow
const CONFIRM_URL_PATTERNS = ['/order', '/confirmation', '/success', '/receipt', '/purchase', '/merci', '/thank'];
// Mots-clés dans le contenu de la page indiquant un paiement réussi
const CONFIRM_TEXT_KEYS    = ['merci', 'thank you', 'commande confirm', 'order confirm', 'paiement r', 'payment success', 'achat confirm'];

function _isConfirmationUrl(url) {
  if (!url.includes('chariow')) return false;
  if (/\/(auth|login|register|stores\/store_)/.test(url)) return false;
  const path = url.split('?')[0].toLowerCase();
  return CONFIRM_URL_PATTERNS.some(p => path.includes(p));
}

function _onDonationConfirmed(mainWin, win) {
  if (win && !win.isDestroyed()) {
    // Laisser 1,5 s à l'utilisateur pour voir la page de confirmation
    setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 1500);
  }
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(IPC.DONATION_SUCCESS);
    mainWin.focus();
  }
}

/**
 * Crée la fenêtre visible (UI) et la fenêtre cachée (moteur LLM).
 * @returns {{ visibleWin: BrowserWindow, hiddenWin: BrowserWindow }}
 */
function createWindows(_config) {
  const visibleWin = new BrowserWindow({
    width: 1000,
    height: 750,
    title: 'ShamCode',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // nécessaire pour require() dans le preload (Electron 20+)
    },
  });

  // backgroundThrottling: false — CRITIQUE sinon génération stoppée en background
  // sandbox: false — requis pour require() dans preload-hidden.js
  const hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-hidden.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false,
    },
  });

  visibleWin.loadFile(path.join(__dirname, '..', 'renderer-visible', 'index.html'));
  hiddenWin.loadFile(path.join(__dirname, '..', 'renderer-hidden', 'llm.html'));

  // La fenêtre cachée (moteur LLM) empêche `window-all-closed` : sans ça, fermer la
  // fenêtre visible laissait l'app vivante et ses événements IPC visaient une fenêtre détruite.
  visibleWin.on('closed', () => { if (process.platform !== 'darwin') app.quit(); });

  // L'interface est une application, pas un onglet : aucun raccourci navigateur.
  // En développement on laisse F12 / Ctrl+Shift+I pour pouvoir déboguer.
  attachShortcutGuard(visibleWin, { allowDevTools: !app.isPackaged });

  return { visibleWin, hiddenWin };
}

/**
 * Ouvre (ou ramène au premier plan) la fenêtre Paramètres.
 * Elle est créée lazily et détruite quand l'utilisateur la ferme.
 * @param {BrowserWindow} parentWin — fenêtre principale (pour le centrage)
 * @returns {BrowserWindow}
 */
function openSettingsWindow(parentWin) {
  // Déjà ouverte → on la ramène devant (sinon un clic sur le bouton semble sans effet
  // quand la fenêtre est passée derrière la fenêtre principale).
  if (_settingsWin && !_settingsWin.isDestroyed()) {
    if (_settingsWin.isMinimized()) _settingsWin.restore();
    _settingsWin.show();
    _settingsWin.focus();
    if (typeof _settingsWin.moveTop === 'function') _settingsWin.moveTop();
    return _settingsWin;
  }

  const parentOk  = parentWin && !parentWin.isDestroyed();
  const [px, py] = parentOk ? parentWin.getPosition() : [0, 0];
  const [pw, ph] = parentOk ? parentWin.getSize()     : [1000, 750];

  _settingsWin = new BrowserWindow({
    width:  800,
    height: 620,
    x: Math.round(px + (pw - 800) / 2),
    y: Math.round(py + (ph - 620) / 2),
    title: 'Paramètres — ShamCode',
    icon: ICON_PATH,
    // Fenêtre fille : elle reste au-dessus de l'application, on ne la « perd »
    // jamais derrière la fenêtre principale.
    parent: parentOk ? parentWin : undefined,
    frame: false,          // titre personnalisé avec drag region
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  _settingsWin.loadFile(path.join(__dirname, '..', 'renderer-settings', 'settings.html'));
  _settingsWin.setMenuBarVisibility(false);
  attachShortcutGuard(_settingsWin, { allowDevTools: !app.isPackaged });

  // Affichage explicite une fois la page prête : la fenêtre apparaît déjà remplie
  // (plus de flash blanc ni de fenêtre vide au premier clic).
  _settingsWin.once('ready-to-show', () => {
    _settingsWin.show();
    _settingsWin.focus();
  });

  _settingsWin.on('closed', () => { _settingsWin = null; });

  return _settingsWin;
}

/**
 * Ouvre (ou ramène au premier plan) la fenêtre Design Studio.
 * @param {BrowserWindow} parentWin
 * @returns {BrowserWindow}
 */
function openDesignWindow(parentWin) {
  if (_designWin && !_designWin.isDestroyed()) {
    if (_designWin.isMinimized()) _designWin.restore();
    _designWin.show();
    _designWin.focus();
    if (typeof _designWin.moveTop === 'function') _designWin.moveTop();
    return _designWin;
  }

  const parentOk  = parentWin && !parentWin.isDestroyed();
  const [px, py]  = parentOk ? parentWin.getPosition() : [0, 0];
  const [pw, ph]  = parentOk ? parentWin.getSize()     : [1000, 750];

  _designWin = new BrowserWindow({
    width:  980,
    height: 700,
    x: Math.round(px + (pw - 980) / 2),
    y: Math.round(py + (ph - 700) / 2),
    title: 'Design Studio — ShamCode',
    icon: ICON_PATH,
    parent: parentOk ? parentWin : undefined,
    frame: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-design.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  _designWin.loadFile(path.join(__dirname, '..', 'renderer-design', 'design.html'));
  _designWin.setMenuBarVisibility(false);
  attachShortcutGuard(_designWin, { allowDevTools: !app.isPackaged });

  _designWin.once('ready-to-show', () => {
    _designWin.show();
    _designWin.focus();
  });

  _designWin.on('closed', () => { _designWin = null; });

  return _designWin;
}

/**
 * Fenêtre cachée de transcription vocale (Whisper), créée au premier usage seulement :
 * un utilisateur qui n'active pas la dictée ne charge jamais ce renderer.
 * @returns {BrowserWindow}
 */
function getVoiceWindow() {
  if (_voiceWin && !_voiceWin.isDestroyed()) return _voiceWin;

  _voiceWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-voice.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  _voiceWin.loadFile(path.join(__dirname, '..', 'renderer-voice', 'voice.html'));
  _voiceWin.on('closed', () => { _voiceWin = null; });
  return _voiceWin;
}

/**
 * Ouvre la fenêtre de don Chariow.
 * Surveille les navigations pour détecter la confirmation de paiement,
 * puis envoie DONATION_SUCCESS à la fenêtre principale.
 * @param {BrowserWindow} parentWin
 * @param {BrowserWindow} mainWin  — fenêtre principale (pour l'événement de succès)
 */
function openDonationWindow(parentWin, mainWin) {
  if (_donationWin && !_donationWin.isDestroyed()) {
    if (_donationWin.isMinimized()) _donationWin.restore();
    _donationWin.show();
    _donationWin.focus();
    return _donationWin;
  }

  const parentOk = parentWin && !parentWin.isDestroyed();
  const [px, py]  = parentOk ? parentWin.getPosition() : [0, 0];
  const [pw, ph]  = parentOk ? parentWin.getSize()     : [1000, 750];

  _donationWin = new BrowserWindow({
    width:  900,
    height: 680,
    x: Math.round(px + (pw - 900) / 2),
    y: Math.round(py + (ph - 680) / 2),
    title: 'Faire un don — ShamCode',
    icon: ICON_PATH,
    parent: parentOk ? parentWin : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Pas de preload : fenêtre web externe, pas d'accès harness
    },
  });

  _donationWin.setMenuBarVisibility(false);
  _donationWin.loadURL(DONATION_URL);

  let confirmed = false;

  // Détection par URL
  _donationWin.webContents.on('did-navigate', (_, url) => {
    if (confirmed) return;
    if (_isConfirmationUrl(url)) {
      confirmed = true;
      _onDonationConfirmed(mainWin, _donationWin);
    }
  });

  // Détection par contenu de page (cas où l'URL ne suffit pas)
  _donationWin.webContents.on('dom-ready', async () => {
    if (confirmed) return;
    const url = _donationWin.webContents.getURL();
    // Ne pas analyser les pages d'authentification ou la boutique admin
    if (/\/(auth|login|register|stores\/store_)/.test(url)) return;
    try {
      const text = await _donationWin.webContents.executeJavaScript(
        `(document.title + ' ' + (document.body ? document.body.innerText : '')).substring(0, 1200).toLowerCase()`
      );
      if (CONFIRM_TEXT_KEYS.some(k => text.includes(k))) {
        confirmed = true;
        _onDonationConfirmed(mainWin, _donationWin);
      }
    } catch { /* page non scripable — on ignore */ }
  });

  _donationWin.on('closed', () => { _donationWin = null; });

  return _donationWin;
}

module.exports = { createWindows, openSettingsWindow, openDesignWindow, getVoiceWindow, openDonationWindow };
