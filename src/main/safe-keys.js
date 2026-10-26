/**
 * Chiffrement des clés API via safeStorage d'Electron.
 * Les clés ne sont jamais stockées en clair dans config.json.
 *
 * Format dans config.json :
 *   model.engines.<name>.apiKeyEncrypted = "<base64>"
 *   model.engines.<name>.apiKey          = "" (vide ou absent)
 *
 * safeStorage utilise le trousseau OS (Windows: DPAPI, Mac: Keychain).
 * Comportement variable selon l'installation Electron — fallback base64 si indisponible.
 */

const { safeStorage } = require('electron');

/**
 * Chiffre une clé API.
 * @param {string} plaintext
 * @returns {string} base64
 */
function encryptKey(plaintext) {
  if (!plaintext) return '';
  // On teste le round-trip DPAPI avant de s'en servir : sur certaines installations
  // Electron, isEncryptionAvailable() renvoie true mais encrypt/decrypt échouent.
  if (_dpapiWorks()) {
    return safeStorage.encryptString(plaintext).toString('base64');
  }
  // Fallback : base64 (APPDATA est déjà protégé par les permissions OS)
  return Buffer.from(plaintext, 'utf8').toString('base64');
}

/** Teste si DPAPI fonctionne en round-trip. Résultat mis en cache. */
let _dpapiCache = null;
function _dpapiWorks() {
  if (_dpapiCache !== null) return _dpapiCache;
  if (!safeStorage.isEncryptionAvailable()) { _dpapiCache = false; return false; }
  try {
    const probe = 'ok';
    const enc   = safeStorage.encryptString(probe);
    const dec   = safeStorage.decryptString(enc);
    _dpapiCache = (dec === probe);
  } catch {
    _dpapiCache = false;
  }
  return _dpapiCache;
}

/**
 * Déchiffre une clé API.
 * @param {string} encrypted  - base64
 * @returns {string} plaintext
 */
function decryptKey(encrypted) {
  if (!encrypted) return '';

  // Tentative 1 : DPAPI (safeStorage)
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const result = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      if (_isPrintable(result)) return result;
      // DPAPI a renvoyé des octets illisibles → la clé a été sauvegardée autrement.
    } catch { /* DPAPI indisponible ou contexte changé — on tente le fallback */ }
  }

  // Tentative 2 : fallback base64 (clé sauvegardée sans DPAPI)
  try {
    const result = Buffer.from(encrypted, 'base64').toString('utf8');
    if (_isPrintable(result)) return result;
  } catch { /* ignore */ }

  return '';
}

/** Vérifie que la chaîne est de l'ASCII imprimable (clé API valide). */
function _isPrintable(str) {
  return typeof str === 'string' && str.length > 0 && /^[\x20-\x7E]+$/.test(str);
}

/**
 * Résout la clé API d'un moteur.
 * Priorité : apiKey en clair (saisie utilisateur) > apiKeyEncrypted (stockage).
 * @param {{ apiKey?: string, apiKeyEncrypted?: string }} engineCfg
 * @returns {string}
 */
function resolveApiKey(engineCfg = {}) {
  if (engineCfg.apiKey) return engineCfg.apiKey;
  if (engineCfg.apiKeyEncrypted) return decryptKey(engineCfg.apiKeyEncrypted);
  return '';
}

/**
 * Prépare la config à sauvegarder : chiffre les clés en clair et vide apiKey.
 * Modifie une copie de la config — n'altère PAS l'objet en mémoire.
 * @param {object} config
 * @returns {object} config sérialisable
 */
function prepareConfigForSave(config) {
  const out = JSON.parse(JSON.stringify(config));
  const engines = out?.model?.engines || {};
  for (const [, engineCfg] of Object.entries(engines)) {
    if (engineCfg.apiKey) {
      engineCfg.apiKeyEncrypted = encryptKey(engineCfg.apiKey);
      engineCfg.apiKey = '';
    }
  }
  return out;
}

/**
 * Résout toutes les clés API après chargement de la config.
 * Renseigne apiKey en mémoire à partir de apiKeyEncrypted.
 * Modifie l'objet config en place (en mémoire uniquement).
 * @param {object} config
 */
function resolveAllKeys(config) {
  const engines = config?.model?.engines || {};
  for (const engineCfg of Object.values(engines)) {
    if (!engineCfg.apiKey && engineCfg.apiKeyEncrypted) {
      engineCfg.apiKey = decryptKey(engineCfg.apiKeyEncrypted);
    }
  }
}

module.exports = { encryptKey, decryptKey, resolveApiKey, prepareConfigForSave, resolveAllKeys };
