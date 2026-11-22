'use strict';

// Sélection du modèle : les moteurs locaux n'ont pas de clé API et ne doivent
// jamais afficher « Clé API manquante » dans le sélecteur.

const test = require('node:test');
const assert = require('node:assert/strict');

const { listModels } = require('../src/harness/llm/list-models');

test('list-models — WebLLM retourne son catalogue sans clé API', async () => {
  const models = await listModels({ engine: 'webllm', apiKey: '', baseUrl: '' });
  assert.ok(Array.isArray(models) && models.length >= 4);
  assert.ok(models.some(m => m.includes('Qwen2.5-Coder-3B')));
  assert.ok(models.every(m => m.endsWith('-MLC')), 'ids MLC attendus');
});

test('list-models — CPU ne réclame pas de clé et ne casse pas', async () => {
  const models = await listModels({ engine: 'cpu', apiKey: '', baseUrl: '' });
  assert.deepEqual(models, [], 'le GGUF est choisi par chemin dans Paramètres');
});

test('list-models — un moteur cloud sans clé échoue explicitement', async () => {
  await assert.rejects(
    listModels({ engine: 'gemini', apiKey: '', baseUrl: '' }),
    /Clé API manquante/,
  );
});

test('list-models — l\'IPC résout la clé enregistrée pour les moteurs cloud', async () => {
  const fs = require('fs');
  const path = require('path');
  const ipc = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
  assert.ok(ipc.includes('saved.apiKey'), 'la clé sauvegardée doit être utilisée');
  assert.ok(ipc.includes('listModels({ engine, apiKey: key, baseUrl: url })'), 'appel normalisé');
});

test('status — les moteurs locaux n\'affichent jamais « Clé manquante »', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
  assert.ok(app.includes("const localEngine = primary === 'webllm' || primary === 'cpu'"));
  assert.ok(app.includes('localEngine || !!('), 'clé non requise pour le local');
});

test('données — HARNESS_USER_DATA_DIR permet un mode portable', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.ok(main.includes('HARNESS_USER_DATA_DIR'), 'surcharge du dossier de données');
  assert.ok(main.includes("app.setPath('userData', userDataDir)"), 'userData appliqué');
  assert.ok(main.includes('_canWrite'), 'repli si %APPDATA% refuse l\'écriture');
  assert.ok(main.includes('.harness-runtime'), 'dossier de repli dans le projet');
});

test('stabilité — un stdout fermé (EPIPE) ne doit pas tuer le main', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.ok(main.includes('process.stdout'), 'stdout surveillé');
  assert.ok(main.includes("stream.on('error'"), 'erreurs de flux ignorées');
});
