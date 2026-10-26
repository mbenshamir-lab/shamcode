// Point d'entrée Electron.
// Flags WebGPU AVANT app.ready — obligatoire.

const { app, globalShortcut, Menu } = require('electron');
const path = require('path');
const { IPC } = require('../shared/constants');

// Pas de menus : l'application n'est pas un navigateur. Supprimer le menu global
// retire aussi ses accélérateurs implicites (Ctrl+R reload, Ctrl+0/+ zoom, F12 devtools).
// Sur macOS le menu applicatif est fourni par l'OS : on le laisse tel quel.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

// Dossier de données propre à chaque copie du projet.
// Deux clones portent le même `name` (code-harness), donc le même %APPDATA%\code-harness :
// leurs caches Chromium se disputaient les mêmes verrous (cache_util_win, gpu_disk_cache,
// quota_database). Doit être fixé AVANT app.whenReady(), avant création des caches.
const { resolveUserDataDir } = require('./user-data');
app.setPath('userData', resolveUserDataDir({
  appData: app.getPath('appData'),
  projectRoot: path.join(__dirname, '../..'),
}));

// Hot-reload en développement : redémarre automatiquement quand src/ change.
// app.isPackaged = false en dev (electron .), true dans le .exe distribué.
if (!app.isPackaged) {
  try {
    require('electron-reload')(path.join(__dirname, '../../src'), {
      electron: path.join(__dirname, '../../node_modules/electron/dist/electron.exe'),
      hardResetMethod: 'exit',
      forceHardReset: true,
    });
  } catch { /* electron-reload absent — ignoré */ }
}
const { createWindows } = require('./windows');
const { registerIpcHandlers } = require('./ipc');
const { loadConfig } = require('./config');

// WebGPU — CRITIQUE : doit être appelé avant app.ready
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU');
// Chromium met le GPU en liste noire dès qu'il n'a pas d'accélération matérielle
// (pilote générique Windows) : sans ce flag requestAdapter() renvoie null et
// WebLLM refuse de démarrer sur un moteur « No available adapters ».
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let _hiddenWin = null;

app.whenReady().then(async () => {
  const config = await loadConfig();
  const { visibleWin, hiddenWin } = createWindows(config);
  _hiddenWin = hiddenWin;
  registerIpcHandlers({ visibleWin, hiddenWin, config });

  // Raccourci global : ramène l'app au premier plan depuis n'importe où
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (visibleWin && !visibleWin.isDestroyed()) {
      if (visibleWin.isMinimized()) visibleWin.restore();
      visibleWin.show();
      visibleWin.focus();
      visibleWin.flashFrame(false);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (_hiddenWin && !_hiddenWin.isDestroyed()) {
    e.preventDefault();
    _hiddenWin.webContents.send(IPC.LLM_UNLOAD);
    // Laisser 500 ms au renderer caché pour appeler engine.unload(), puis quitter.
    setTimeout(() => app.exit(0), 500);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
