// Registre des moteurs LLM disponibles.
// { label, requiresKey, offline, cost, factory, baseUrl? }

const { OpenAiCompatEngine } = require('./engines/openai-compat');
const { GeminiEngine }       = require('./engines/gemini');
const { ClaudeEngine }       = require('./engines/claude');
const { WebLlmEngine }       = require('./engines/webllm');
const { CpuEngine }          = require('./engines/cpu');
const { DEEPSEEK_BASE }      = require('./list-models');

const registry = {
  'openai-compat': {
    label:       'OpenAI-Compatible (proxy, Ollama…)',
    requiresKey: true,
    offline:     false,
    cost:        'varies',
    factory:     (cfg)        => new OpenAiCompatEngine(cfg),
  },
  deepseek: {
    label:       'DeepSeek (cloud)',
    requiresKey: true,
    offline:     false,
    cost:        'paid',
    baseUrl:     DEEPSEEK_BASE,
    factory:     (cfg)        => new OpenAiCompatEngine({ baseUrl: DEEPSEEK_BASE, ...cfg }),
  },
  gemini: {
    label:       'Gemini (cloud gratuit)',
    requiresKey: true,
    offline:     false,
    cost:        'free-quota',
    factory:     (cfg)        => new GeminiEngine(cfg),
  },
  claude: {
    label:       'Claude (cloud payant)',
    requiresKey: true,
    offline:     false,
    cost:        'paid',
    factory:     (cfg)        => new ClaudeEngine(cfg),
  },
  webllm: {
    label:       'Local (WebLLM)',
    requiresKey: false,
    offline:     true,
    cost:        'free',
    // factory injectée au runtime avec le bridge IPC
    factory:     (cfg, bridge) => new WebLlmEngine(cfg, bridge),
  },
  cpu: {
    label:       'Local CPU (node-llama-cpp)',
    requiresKey: false,
    offline:     true,
    cost:        'free',
    factory:     (cfg)         => new CpuEngine(cfg),
  },
};

module.exports = { registry };
