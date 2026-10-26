const fs   = require('fs');
const path = require('path');
const { MAX_CONTEXT_CHARS, DEFAULT_TEMPERATURE } = require('../shared/constants');

// safe-keys n'est disponible qu'après que l'app Electron soit prête.
// On l'importe de façon paresseuse pour ne pas crasher les tests Node.
let _safeKeys = null;
function getSafeKeys() {
  if (!_safeKeys) {
    try { _safeKeys = require('./safe-keys'); } catch { _safeKeys = null; }
  }
  return _safeKeys;
}

const CONFIG_PATH = path.join(process.env.APPDATA || '', 'code-harness', 'config.json');

const DEFAULTS = {
  version: 1,
  model: {
    primary: 'openai-compat',
    fallbacks: [],
    engines: {
      'openai-compat': { apiKey: '', baseUrl: 'https://codecraftapi.com/v1', model: 'gemini-3.7-flash' },
      webllm:  { model: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC' },
      gemini:  { apiKey: '', model: 'gemini-3.5-flash' },
      claude:  { apiKey: '', model: 'claude-haiku-4-5' },
    },
  },
  projectRoot: null,
  approvalMode: false,
  maxSteps: 25,
  maxContextChars: MAX_CONTEXT_CHARS,
  temperature: DEFAULT_TEMPERATURE,
  enableShell: false,
  voiceEnabled: false,
  voiceModel: 'base',   // 'base' (~75 Mo) | 'small' (~250 Mo, plus précis)
  enableGit: true,
  backupBeforeWrite: true,
  maxBackups: 50,
  sessionsRetention: 100,
  theme: 'dark',
  accentColor: '#6366f1',
  codeFont: 'JetBrains Mono',
  density: 'normal',
  streaming: true,
  topP: 1.0,
  retryOnParseError: 2,
  customRules: [],   // [{ id, text, enabled }]
  skills: [],        // [{ id, name, description, enabled }]
  connectors: [],    // [{ id, name, type, url, args, auth, enabled }]
  customProviders: [],  // [{ id, name, baseUrl, apiKey }]
  videoPromptExamples: [
    'Génère une vidéo de 5s d\'un coucher de soleil sur la mer, ratio 16:9',
    'Clip animé d\'un logo tournant sur fond noir, durée 3s, ratio 1:1',
    'Time-lapse d\'une ville la nuit en format portrait 9:16, durée 4s',
  ],
  imagePromptExamples: [
    'Bannière 16:9 pour un site tech : fond sombre, dégradé bleu/violet, typographie moderne',
    'Logo minimaliste en forme de losange, couleurs or et noir, fond blanc',
    'Illustration d\'un développeur devant son écran, style flat design, palette sombre',
  ],
};

async function loadConfig() {
  let loaded = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    loaded = JSON.parse(raw);
  } catch { /* fichier absent → défauts */ }

  const config = { ...DEFAULTS, ...loaded };

  // Résoudre les clés chiffrées en mémoire (safeStorage)
  const sk = getSafeKeys();
  if (sk) sk.resolveAllKeys(config);

  return config;
}

async function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

  // Chiffrer les clés API avant écriture sur disque
  const sk = getSafeKeys();
  const toWrite = sk ? sk.prepareConfigForSave(config) : config;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
