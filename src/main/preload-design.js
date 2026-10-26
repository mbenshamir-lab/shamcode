// Preload fenêtre Design Studio — expose designApi via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('designApi', {
  getConfig:        ()           => ipcRenderer.invoke(IPC.CONFIG_GET),
  readDesignTokens: (args)       => ipcRenderer.invoke(IPC.DESIGN_READ_TOKENS, args),
  writeFile:        (path, content) => ipcRenderer.invoke(IPC.DESIGN_WRITE_FILE, { path, content }),
  closeWindow:      ()           => ipcRenderer.invoke(IPC.DESIGN_CLOSE),
});
