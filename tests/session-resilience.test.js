'use strict';

// Résilience : si le dossier de sessions n'est pas inscriptible (ACL Windows,
// disque plein…), le chat doit répondre quand même — pas afficher EPERM.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-resilience-'));
process.env.APPDATA = DATA;

const { runAgent } = require('../src/harness/agent');

test('agent — dossier de sessions non inscriptible : la tâche aboutit', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-resilience-projet-'));
  const blocked = path.join(DATA, 'bloque');
  fs.writeFileSync(blocked, 'fichier', 'utf8');
  const previous = process.env.HARNESS_DATA_DIR;
  process.env.HARNESS_DATA_DIR = blocked;

  try {
    const result = await runAgent({
      task: 'bonjour',
      llmGenerate: async () => JSON.stringify({ tool: 'finish', args: { summary: 'bonjour' } }),
      projectRoot: project,
      config: { maxSteps: 3, autonomyLevel: 'off' },
      onEvent: () => {},
    });
    assert.ok(result.ok, result.error);
    assert.equal(result.summary, 'bonjour');
  } finally {
    if (previous === undefined) delete process.env.HARNESS_DATA_DIR;
    else process.env.HARNESS_DATA_DIR = previous;
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(blocked, { force: true });
  }
});
