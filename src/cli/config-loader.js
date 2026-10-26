/**
 * Charge la config CLI depuis les variables d'environnement ou ~/.harness/config.json.
 * Découplé de l'app Electron et de safeStorage.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CLI_CONFIG_PATH = path.join(os.homedir(), '.harness', 'config.json');

/**
 * @returns {{ engine, model, apiKey, baseUrl } | null}
 */
function loadCliConfig() {
  // 1. Variables d'environnement (priorité maximale)
  const envKey     = process.env.HARNESS_API_KEY;
  const envEngine  = process.env.HARNESS_ENGINE;
  const envModel   = process.env.HARNESS_MODEL;
  const envBaseUrl = process.env.HARNESS_BASE_URL;

  if (envKey) {
    return {
      engine:  envEngine  || 'openai-compat',
      model:   envModel   || 'gemini-2.0-flash',
      apiKey:  envKey,
      baseUrl: envBaseUrl || 'https://codecraftapi.com/v1',
    };
  }

  // 2. Fichier ~/.harness/config.json (JSON plain, sans chiffrement)
  try {
    const raw = fs.readFileSync(CLI_CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg.apiKey) return null;
    return {
      engine:  cfg.engine  || 'openai-compat',
      model:   cfg.model   || 'gemini-2.0-flash',
      apiKey:  cfg.apiKey,
      baseUrl: cfg.baseUrl || 'https://codecraftapi.com/v1',
    };
  } catch {
    return null;
  }
}

/**
 * Crée ~/.harness/config.json avec les valeurs fournies.
 */
function saveCliConfig(cfg) {
  const dir = path.dirname(CLI_CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLI_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { loadCliConfig, saveCliConfig, CLI_CONFIG_PATH };
