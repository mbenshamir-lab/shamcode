// Choix du dossier de données Electron (userData).
//
// Deux copies du projet (« HARNESS CODE » et « HARNESS CODE - Copie ») portent le même
// `name` dans package.json : Electron leur attribue donc le même %APPDATA%\code-harness.
// Les deux instances se disputent alors les verrous de cache Chromium — d'où les
// avertissements `cache_util_win`, `gpu_disk_cache` et `quota_database` au démarrage.
//
// Stratégie : la première copie à démarrer revendique le dossier historique (marqueur
// `.project-path`) et garde ses sessions, son index RAG et ses backups. Toute autre copie
// reçoit un dossier suffixé par un hash stable de son propre chemin.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_DIR_NAME = 'code-harness';
const MARKER_NAME = '.project-path';

function _normalize(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function _hash(projectRoot) {
  return crypto.createHash('sha1').update(_normalize(projectRoot)).digest('hex').slice(0, 8);
}

function _readMarker(file) {
  try {
    return _normalize(fs.readFileSync(file, 'utf8').trim());
  } catch {
    return null;
  }
}

// « HARNESS CODE - Copie », « projet (1) », « projet copy » : doublons déclarés.
// Ils ne doivent jamais revendiquer le dossier historique, même démarrés en premier.
function _isDuplicateName(projectRoot) {
  const name = path.basename(path.resolve(projectRoot));
  return /(?:[-_ ](?:copie|copy)\b|\s\(\d+\))\s*$/i.test(name.trim());
}

function _claim(dir, projectRoot) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, MARKER_NAME);
    const current = _readMarker(marker);
    // Un marqueur absent, ou posé par une copie doublon (versions antérieures du module),
    // est réécrit au nom du projet courant : la vraie copie récupère son dossier.
    if (current === null || _isDuplicateName(current)) {
      fs.writeFileSync(marker, path.resolve(projectRoot), 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

// Retourne le chemin userData à utiliser pour ce projet.
// `appData` = app.getPath('appData') ; `projectRoot` = racine du dossier du projet.
function resolveUserDataDir({ appData, projectRoot }) {
  const shared = path.join(appData, APP_DIR_NAME);
  const own = path.join(appData, `${APP_DIR_NAME}-${_hash(projectRoot)}`);

  // Doublon déclaré : jamais le dossier historique, sans même lire le marqueur.
  if (_isDuplicateName(projectRoot)) {
    _claim(own, projectRoot);
    return own;
  }

  const claimed = _readMarker(path.join(shared, MARKER_NAME));
  if (claimed === null || claimed === _normalize(projectRoot)) {
    // Dossier historique libre, ou déjà à nous : on le garde (sessions, RAG, backups).
    _claim(shared, projectRoot);
    return shared;
  }

  // Une autre copie l'a revendiqué : dossier dédié, plus aucun verrou partagé.
  _claim(own, projectRoot);
  return own;
}

module.exports = { resolveUserDataDir, APP_DIR_NAME, MARKER_NAME };
