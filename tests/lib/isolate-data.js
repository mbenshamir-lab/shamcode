'use strict';

// Préchargé par `npm test` (--require) dans chaque processus de test. Sans cela, un test
// qui n'isole pas ses données écrit dans le vrai %APPDATA%\code-harness, et la rétention
// des sessions y efface l'historique de l'utilisateur.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shamcode-test-data-'));
process.env.APPDATA = dir;
// Héritée de l'application (tests lancés par l'agent), elle primerait sur APPDATA
delete process.env.HARNESS_DATA_DIR;

process.on('exit', () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* fichier encore verrouillé */ }
});
