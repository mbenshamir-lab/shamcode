/**
 * Dossier de données commun aux modules qui ne connaissent pas Electron.
 *
 * Le processus principal fixe `HARNESS_DATA_DIR` après `app.setPath('userData', …)`
 * (voir src/main/user-data.js) : deux copies du projet ne partagent alors plus
 * config, sessions, backups, index RAG ni logs. Hors Electron (CLI, eval, tests),
 * on retombe sur l'emplacement historique `%APPDATA%\code-harness`, ce qui garde
 * les données existantes et les tests inchangés.
 */

const path = require('path');
const os   = require('os');

const APP_DIR_NAME = 'code-harness';

/**
 * Résout le dossier de données à chaque appel (jamais mis en cache) : les tests
 * et le CLI peuvent changer `APPDATA` / `HARNESS_DATA_DIR` après le require.
 * @returns {string} chemin absolu
 */
function getDataDir() {
  if (process.env.HARNESS_DATA_DIR) return path.resolve(process.env.HARNESS_DATA_DIR);
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME);
}

module.exports = { getDataDir, APP_DIR_NAME };
