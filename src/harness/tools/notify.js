'use strict';

/**
 * Outil notify_user — déclenche une notification système via le callback
 * `config.notifyFn` injecté par le processus principal (ipc.js).
 * En mode interactif, notifyFn est absent → la notification est un no-op
 * silencieux (l'agent peut l'appeler sans erreur dans tous les modes).
 */
async function notifyUser(args, config) {
  const title = String(args.title || 'ShamCode').slice(0, 80);
  const body  = String(args.body  || args.message || '').slice(0, 200);
  if (typeof config?.notifyFn === 'function') {
    try { await config.notifyFn(title, body); } catch { /* ignoré */ }
  }
  return { ok: true, content: `Notification : ${title}` };
}

module.exports = { notifyUser };
