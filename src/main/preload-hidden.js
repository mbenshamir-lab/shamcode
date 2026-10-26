// Preload fenêtre cachée (WebLLM) — expose window.llmBridge au renderer ESM.
// contextIsolation: true → le renderer ne touche pas directement à ipcRenderer.

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('llmBridge', {
  /** Reçoit la config (modèle) envoyée par le main après did-finish-load */
  onConfig: (cb) => ipcRenderer.once(IPC.LLM_CONFIG, (_, cfg) => cb(cfg)),

  /** Signale que le moteur WebLLM est prêt (ou en erreur) */
  notifyReady: (payload) => ipcRenderer.send(IPC.LLM_READY, payload),

  /** Signale la progression du chargement (progress ∈ [0,1], text = label WL) */
  notifyProgress: (payload) => ipcRenderer.send(IPC.LLM_PROGRESS, payload),

  /** Écoute les requêtes LLM envoyées par le main process */
  onRequest: (cb) => {
    ipcRenderer.on(IPC.LLM_REQUEST, (_, payload) => cb(payload));
  },

  /** Renvoie la réponse (ou l'erreur) sur le canal unique fourni par le main */
  sendReply: (replyChannel, result) => {
    ipcRenderer.send(`${IPC.LLM_REPLY}:${replyChannel}`, result);
  },

  /** Reçoit l'ordre de décharger le modèle avant fermeture */
  onUnload: (cb) => ipcRenderer.once(IPC.LLM_UNLOAD, () => cb()),

  /** Reçoit l'ordre de vider le cache disque du modèle */
  onClearCache: (cb) => ipcRenderer.on(IPC.LLM_CLEAR_CACHE, () => cb()),

  /** Confirme au main que le cache a été vidé (ou non) */
  notifyCacheClear: (result) => ipcRenderer.send(IPC.LLM_CACHE_CLEARED, result),
});
