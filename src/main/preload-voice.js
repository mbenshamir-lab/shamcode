// Preload fenêtre cachée « voix » (Whisper) — expose window.voiceBridge.
// contextIsolation: true → le renderer ne touche pas directement à ipcRenderer.

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('voiceBridge', {
  /** Reçoit les demandes de transcription envoyées par le main */
  onRequest: (cb) => ipcRenderer.on(IPC.VOICE_REQUEST, (_, payload) => cb(payload)),

  /** Renvoie le résultat (ou l'erreur) sur le canal unique fourni par le main */
  sendReply: (replyChannel, result) => ipcRenderer.send(`${IPC.VOICE_REPLY}:${replyChannel}`, result),

  /** Progression du téléchargement du modèle (premier usage uniquement) */
  notifyProgress: (payload) => ipcRenderer.send(IPC.VOICE_PROGRESS, payload),
});
