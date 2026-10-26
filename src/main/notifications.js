'use strict';

const { Notification } = require('electron');

/**
 * Affiche une notification système Windows et fait clignoter le bouton barre des tâches
 * quand une tâche agent se termine hors focus.
 *
 * @param {{ task: string, ok: boolean, stepCount?: number }} params
 * @param {import('electron').BrowserWindow} win
 */
function notifyTaskComplete({ task, ok, stepCount }, win) {
  if (!win || win.isDestroyed()) return;

  // Clignotement barre des tâches — seulement si la fenêtre n'est pas au premier plan
  if (!win.isFocused()) {
    win.flashFrame(true);
  }

  if (!Notification.isSupported()) return;

  const title = ok ? '✅ Tâche terminée' : '❌ Tâche échouée';
  const taskShort = _truncate(task || '', 60);
  const steps = _stepLabel(stepCount);
  const body  = steps ? `${steps}${taskShort ? ' — ' + taskShort : ''}` : taskShort;

  const notif = new Notification({ title, body, silent: false });

  notif.on('click', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.flashFrame(false);
  });

  notif.show();
}

function _truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _stepLabel(n) {
  if (!n || n < 1) return '';
  return n === 1 ? '1 étape' : `${n} étapes`;
}

/**
 * Notification déclenchée par l'outil notify_user du LLM.
 * Titre et corps fournis par l'agent, pas de lien avec une tâche spécifique.
 */
function notifyUser(title, body, win) {
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  if (!Notification.isSupported()) return;
  const notif = new Notification({
    title: _truncate(String(title || 'ShamCode'), 80),
    body:  _truncate(String(body  || ''), 200),
    silent: false,
  });
  notif.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus(); win.flashFrame(false);
  });
  notif.show();
}

module.exports = { notifyTaskComplete, notifyUser };
