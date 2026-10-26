// Preload fenêtre Paramètres — expose uniquement l'API nécessaire aux settings.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('settingsApi', {
  getConfig:       ()      => ipcRenderer.invoke(IPC.CONFIG_GET),
  setConfig:       (u)     => ipcRenderer.invoke(IPC.CONFIG_SET, u),
  testEngine:      (p)     => ipcRenderer.invoke(IPC.ENGINE_TEST, p),
  listModels:      (p)     => ipcRenderer.invoke(IPC.MODELS_LIST, p),
  selectFolder:    ()      => ipcRenderer.invoke(IPC.FOLDER_DIALOG),
  selectFile:      (opts)  => ipcRenderer.invoke(IPC.FILE_DIALOG, opts),
  closeWindow:     ()      => ipcRenderer.invoke(IPC.SETTINGS_CLOSE),
  clearWebLlmCache: ()    => ipcRenderer.invoke(IPC.LLM_CLEAR_CACHE),
  // Reçoit CONFIG_UPDATED depuis la fenêtre principale (model pill, nouveau projet, etc.)
  onConfigUpdated: (cb)    => ipcRenderer.on(IPC.CONFIG_UPDATED, (_, cfg) => cb(cfg)),

  // ── Dictée vocale : téléchargement d'un modèle Whisper ────────────────────
  preloadVoiceModel: (model) => ipcRenderer.invoke(IPC.VOICE_PRELOAD, { model }),
  onVoiceProgress:   (cb)    => ipcRenderer.on(IPC.VOICE_PROGRESS, (_, p) => cb(p)),

  // ── Planificateur ─────────────────────────────────────────────────────────
  scheduleList:   ()     => ipcRenderer.invoke(IPC.SCHEDULE_LIST),
  scheduleAdd:    (task) => ipcRenderer.invoke(IPC.SCHEDULE_ADD, task),
  scheduleDelete: (id)   => ipcRenderer.invoke(IPC.SCHEDULE_DELETE, { id }),
  scheduleToggle: (id)   => ipcRenderer.invoke(IPC.SCHEDULE_TOGGLE, { id }),
  scheduleRun:    (id)   => ipcRenderer.invoke(IPC.SCHEDULE_RUN,    { id }),
});
