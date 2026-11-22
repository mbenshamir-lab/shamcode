#!/usr/bin/env node
'use strict';

/**
 * Benchmark du prompt par moteur (ADR-033).
 *
 * Ne lance aucun modèle : il mesure le prompt système réellement construit par
 * l'agent (outils, rôle, objectif, AGENTS…) pour trois profils. Sert à vérifier
 * que le local est plus court que le cloud, sans mesurer l'inférence.
 *
 * Usage : npm run bench:prompt
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Isoler sessions/RAG du vrai profil utilisateur.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bench-'));
process.env.APPDATA = TMP_DATA;
process.env.HARNESS_DATA_DIR = path.join(TMP_DATA, 'code-harness');

const { runAgent } = require('../src/harness/agent');
const { resolveModelPolicy } = require('../src/harness/prompts/model-policy');

const TASK = 'Corrige la fonction sum() de src/math.js : elle doit ignorer les valeurs non numériques, sans changer sa signature.';
const TOOLS = ['read_file', 'replace_code', 'run_tests', 'search_grep', 'list_dir', 'finish'];

const SCENARIOS = [
  {
    label: 'cloud (Gemini)',
    primary: 'gemini',
    engines: { gemini: { apiKey: 'x', model: 'gemini-3.5-flash' } },
  },
  {
    label: 'local 3B (WebLLM)',
    primary: 'webllm',
    engines: { webllm: { model: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC' } },
  },
  {
    label: 'local 7B (CPU GGUF)',
    primary: 'cpu',
    engines: { cpu: { modelPath: 'C:/models/qwen2.5-coder-7b-q4_k_m.gguf', model: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' } },
  },
];

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bench-proj-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bench', scripts: { test: 'node --test' } }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'math.js'), 'function sum(a) { let s = 0; for (let i = 0; i <= a.length; i++) s += a[i]; return s; }\nmodule.exports = { sum };\n', 'utf8');
  return root;
}

async function measure(scenario, projectRoot) {
  const captured = { system: '', maxTokens: 0 };
  let calls = 0;

  await runAgent({
    task: TASK,
    projectRoot,
    llmGenerate: async (messages, opts = {}) => {
      calls += 1;
      if (calls === 1) {
        captured.system = String(messages[0]?.content || '');
        captured.maxTokens = opts.maxTokens || 0;
      }
      return JSON.stringify({ tool: 'finish', args: { summary: 'ok' } });
    },
    config: {
      model: { primary: scenario.primary, engines: scenario.engines },
      autonomyLevel: 'assisted',
      maxSteps: 2,
      backupBeforeWrite: false,
    },
    onEvent: () => {},
  });

  const policy = resolveModelPolicy({
    engine: scenario.primary,
    model: scenario.engines?.[scenario.primary]?.model,
  });
  return {
    label: scenario.label,
    policy: policy.id,
    chars: captured.system.length,
    tokens: Math.ceil(captured.system.length / 4),
    maxTokens: captured.maxTokens,
    ragTopK: policy.ragTopK,
    historyPairs: policy.historyKeepPairs,
  };
}

(async () => {
  const projectRoot = makeProject();
  const rows = [];
  for (const scenario of SCENARIOS) {
    rows.push(await measure(scenario, projectRoot));
  }

  console.log('Profil                  | Prompt système | ~tokens | maxTokens | RAG topK | historique');
  console.log('------------------------|----------------|---------|-----------|----------|-----------');
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(23)} | ${String(r.chars).padStart(14)} | ${String(r.tokens).padStart(7)} | ${String(r.maxTokens).padStart(9)} | ${String(r.ragTopK).padStart(8)} | ${r.historyPairs} paires`,
    );
  }
  const cloud = rows[0];
  const local = rows[1];
  const saved = cloud.chars > 0 ? Math.round((1 - local.chars / cloud.chars) * 100) : 0;
  console.log(`\nLocal 3B vs cloud : ${saved}% de prompt en moins (${cloud.chars} → ${local.chars} car.).`);

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
