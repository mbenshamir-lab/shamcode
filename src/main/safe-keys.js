/**
 * Chiffrement des clés API via safeStorage d'Electron.
 * Les secrets ne sont jamais stockés en clair dans config.json (ADR-041).
 *
 * Format dans config.json (la forme en clair y est vide ou absente) :
 *   model.engines.<name>.apiKeyEncrypted = "<base64>"
 *   customProviders[].apiKeyEncrypted    = "<base64>"
 *   connectors[].authEncrypted           = "<base64>"
 *   apiTokensEncrypted.<nom>             = "<base64>"
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

/** @returns {boolean} false si les secrets ne sont qu'encodés en base64 (safeStorage inopérant) */
function secretsAreEncrypted() {
  return _dpapiWorks();
}

/** Objets de la config portant un secret, avec le nom du champ concerné. */
function _secretEntries(config) {
  return [
    ...Object.values(config?.model?.engines || {}).map(e => [e, 'apiKey']),
    ...(config?.customProviders || []).map(p => [p, 'apiKey']),
    ...(config?.connectors || []).map(c => [c, 'auth']),
  ];
}

/**
 * Prépare la config à sauvegarder : chiffre les secrets en clair et les vide.
 * Un secret déjà vide garde sa forme chiffrée : indéchiffrable aujourd'hui, il n'est pas perdu.
 * Modifie une copie de la config — n'altère PAS l'objet en mémoire.
 * @param {object} config
 * @returns {object} config sérialisable
 */
function prepareConfigForSave(config) {
  const out = JSON.parse(JSON.stringify(config));
  for (const [entry, field] of _secretEntries(out)) {
    if (entry[field]) {
      entry[`${field}Encrypted`] = encryptKey(entry[field]);
      entry[field] = '';
    }
  }
  if (out.apiTokens) {
    // Reconstruite à partir des noms présents : un token retiré ne laisse rien derrière lui
    const sealed = [];
    for (const [name, value] of Object.entries(out.apiTokens)) {
      const encrypted = value ? encryptKey(value) : out.apiTokensEncrypted?.[name];
      if (encrypted) sealed.push([name, encrypted]);
      out.apiTokens[name] = '';
    }
    out.apiTokensEncrypted = Object.fromEntries(sealed);
  }
  return out;
}

/**
 * Résout tous les secrets après chargement de la config.
 * Renseigne les champs en clair à partir de leur forme chiffrée.
 * Modifie l'objet config en place (en mémoire uniquement).
 * @param {object} config
 */
function resolveAllKeys(config) {
  for (const [entry, field] of _secretEntries(config)) {
    const sealed = entry[`${field}Encrypted`];
    if (!entry[field] && sealed) entry[field] = decryptKey(sealed);
  }
  for (const [name, sealed] of Object.entries(config?.apiTokensEncrypted || {})) {
    const tokens = config.apiTokens;
    if (tokens && Object.hasOwn(tokens, name) && !tokens[name]) tokens[name] = decryptKey(sealed);
  }
}

module.exports = {
  encryptKey, decryptKey, resolveApiKey, prepareConfigForSave, resolveAllKeys, secretsAreEncrypted,
};
