// Point d'entrée Electron.
// Flags WebGPU AVANT app.ready — obligatoire.

const { app, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC } = require('../shared/constants');

// Lancement détaché (pipe stdout/stderr fermé par le parent, service Windows) :
// le premier console.* lève EPIPE et tue le processus principal — observé avec
// node-llama-cpp qui journalise via console.warn. Un flux mort ne doit jamais
// faire tomber l'application.
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') {
    stream.on('error', () => { /* EPIPE / flux fermé : ignore */ });
  }
}

// Pas de menus : l'application n'est pas un navigateur. Supprimer le menu global
// retire aussi ses accélérateurs implicites (Ctrl+R reload, Ctrl+0/+ zoom, F12 devtools).
// Sur macOS le menu applicatif est fourni par l'OS : on le laisse tel quel.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

// Dossier de données propre à chaque copie du projet.
// Deux clones portent le même `name` (code-harness), donc le même %APPDATA%\code-harness :
// leurs caches Chromium se disputaient les mêmes verrous (cache_util_win, gpu_disk_cache,
// quota_database). Doit être fixé AVANT app.whenReady(), avant création des caches.
const { resolveUserDataDir, migrateLegacyConfig } = require('./user-data');

// Mode portable / environnement restreint : HARNESS_USER_DATA_DIR force le dossier
// de données (caches Chromium, config, sessions, RAG, logs) sans toucher au dossier
// %APPDATA% — utile quand l'écriture y est refusée (sandbox, poste verrouillé).
const explicitUserData = process.env.HARNESS_USER_DATA_DIR;
const projectRoot = path.join(__dirname, '../..');

/** Vérifie qu'un dossier est réellement inscriptible (pas seulement existant). */
function _canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '1', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

let userDataDir;
if (explicitUserData) {
  userDataDir = path.resolve(explicitUserData);
  fs.mkdirSync(userDataDir, { recursive: true });
} else {
  const preferred = resolveUserDataDir({
    appData: app.getPath('appData'),
    projectRoot,
  });
  // Certains environnements (sandbox, antivirus, session non interactive) refusent
  // l'écriture dans %APPDATA% : on bascule dans le projet plutôt que de laisser
  // sessions/config/backups échouer en EPERM à chaque action.
  userDataDir = _canWrite(preferred) ? preferred : path.join(projectRoot, '.harness-runtime');
  fs.mkdirSync(userDataDir, { recursive: true });
}
app.setPath('userData', userDataDir);

// Les modules hors Electron (config, sessions, backups, RAG, logs) résolvent leur
// dossier via HARNESS_DATA_DIR. Sans cela ils retombaient sur %APPDATA%\code-harness
// et les deux copies partageaient encore config, clés API, sessions et backups.
process.env.HARNESS_DATA_DIR = userDataDir;
migrateLegacyConfig({ appData: app.getPath('appData'), userDataDir });

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
const { stopAll } = require('../harness/tools/process-runner');

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
  // Ici et non sur will-quit : app.exit() ci-dessous n'émet plus aucun événement
  stopAll();
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
