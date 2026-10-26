// Neutralise le comportement « navigateur » d'Electron.
// L'application embarque Chromium : sans ce garde, F12 ouvre les DevTools et
// Ctrl+R recharge l'interface (perte de la conversation en cours), Ctrl+P imprime, etc.
// Les raccourcis propres à l'app (envoi Ctrl+L, copier/coller, Entrée) ne sont jamais filtrés.

// Touches bloquées quelle que soit la plateforme (Windows/Linux/macOS).
const BLOCKED_KEYS = new Set(['f5', 'f7', 'f12']);

// Touches bloquées seulement avec Ctrl (Windows/Linux) ou Cmd (macOS).
// 'r' reload · 'p' print · 'f'/'g' find · 'h'/'j' historique/téléchargements · 'n'/'t'/'w' fenêtres et onglets
// 'u' code source · 'd' favori · '+ = - 0' zoom (le rendu doit rester à 100 %)
const BLOCKED_MOD_KEYS = new Set([
  'r', 'p', 'f', 'g', 'h', 'j', 'n', 't', 'w', 'u', 'd',
  '+', '=', '-', '_', '0'
]);

// DevTools : F12, Ctrl+Shift+I / J / C
const DEVTOOLS_SHIFT_KEYS = new Set(['i', 'j', 'c']);

/**
 * Indique si une entrée clavier correspond à un raccourci navigateur à neutraliser.
 * @param {{ type?: string, key?: string, control?: boolean, meta?: boolean, shift?: boolean, alt?: boolean }} input
 *        objet `input` fourni par l'événement Electron `before-input-event`
 * @param {{ allowDevTools?: boolean }} [opts] — `allowDevTools` laisse passer F12 / Ctrl+Shift+I (dev uniquement)
 * @returns {boolean} true si l'entrée doit être annulée
 */
function isBlockedShortcut(input, opts) {
  if (!input || input.type !== 'keyDown') return false;
  const key = typeof input.key === 'string' ? input.key.toLowerCase() : '';
  if (!key) return false;

  const allowDevTools = Boolean(opts && opts.allowDevTools);
  const mod = Boolean(input.control || input.meta);
  const devToolsKey = key === 'f12' || (mod && input.shift && DEVTOOLS_SHIFT_KEYS.has(key));
  if (devToolsKey) return !allowDevTools;

  if (BLOCKED_KEYS.has(key)) return true;

  // Alt+←/→ : navigation arrière/avant dans l'historique de la page
  if (input.alt && (key === 'arrowleft' || key === 'arrowright')) return true;

  if (!mod) return false;
  return BLOCKED_MOD_KEYS.has(key);
}

/**
 * Branche le filtre sur une fenêtre : raccourcis bloqués, barre de menus masquée,
 * zoom figé à 100 %. À appeler juste après la création de chaque BrowserWindow interne.
 * @param {import('electron').BrowserWindow} win
 * @param {{ allowDevTools?: boolean }} [opts]
 * @returns {boolean} true si le garde a été posé
 */
function attachShortcutGuard(win, opts) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  const wc = win.webContents;
  if (!wc || typeof wc.on !== 'function') return false;

  const allowDevTools = Boolean(opts && opts.allowDevTools);

  if (typeof win.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false);
  if (typeof win.setAutoHideMenuBar === 'function') win.setAutoHideMenuBar(true);

  wc.on('before-input-event', (event, input) => {
    if (isBlockedShortcut(input, { allowDevTools })) event.preventDefault();
  });

  // Pincement / Ctrl+molette : la mise en page ne doit pas se déformer.
  if (typeof wc.setVisualZoomLevelLimits === 'function') {
    try {
      const res = wc.setVisualZoomLevelLimits(1, 1);
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch { /* API indisponible sur certaines versions — sans conséquence */ }
  }

  return true;
}

module.exports = { isBlockedShortcut, attachShortcutGuard, BLOCKED_KEYS, BLOCKED_MOD_KEYS };
