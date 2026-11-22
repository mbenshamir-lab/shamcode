'use strict';

// Le logger écrit dans <dataDir>/logs : il doit suivre HARNESS_DATA_DIR comme les
// autres modules de données (sinon deux copies mélangent leurs journaux).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logger = require('../src/harness/logger');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-log-'));
}

test('logger — écrit dans HARNESS_DATA_DIR/logs', () => {
  const dir = tmpDir();
  const previous = process.env.HARNESS_DATA_DIR;
  process.env.HARNESS_DATA_DIR = dir;
  try {
    logger.enable();
    logger.info('test', 'message de test', { champ: 1 });

    const file = logger.currentPath();
    assert.ok(file.startsWith(path.join(dir, 'logs')), `chemin inattendu : ${file}`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.equal(entry.lvl, 'info');
    assert.equal(entry.mod, 'test');
    assert.equal(entry.msg, 'message de test');
    assert.equal(entry.data.champ, 1);
  } finally {
    logger.disable();
    logger.enable();
    if (previous === undefined) delete process.env.HARNESS_DATA_DIR;
    else process.env.HARNESS_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logger — disable() coupe l’écriture', () => {
  const dir = tmpDir();
  const previous = process.env.HARNESS_DATA_DIR;
  process.env.HARNESS_DATA_DIR = dir;
  try {
    logger.disable();
    logger.error('test', 'ne doit pas être écrit');
    assert.ok(!fs.existsSync(logger.currentPath()), 'aucun fichier attendu quand le logger est coupé');
  } finally {
    logger.enable();
    if (previous === undefined) delete process.env.HARNESS_DATA_DIR;
    else process.env.HARNESS_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logger — une exécution d\'agent laisse une trace exploitable', async () => {
  const dir     = tmpDir();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-log-proj-'));
  fs.writeFileSync(path.join(project, 'a.js'), 'const a = 1;\n');

  const previous = process.env.HARNESS_DATA_DIR;
  process.env.HARNESS_DATA_DIR = dir;
  try {
    logger.enable();
    const { runAgent } = require('../src/harness/agent');

    const replies = [
      '{"tool":"outil_inexistant","args":{}}',
      '{"tool":"finish","args":{"summary":"fini"}}',
    ];
    const llmGenerate = async () => replies.shift() ?? '{"tool":"finish","args":{"summary":"fini"}}';

    await runAgent({ task: 'tâche de test', llmGenerate, projectRoot: project, config: { maxSteps: 3 } });

    const entries = fs.readFileSync(logger.currentPath(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(entries.some(e => String(e.msg).includes('run_start')), 'démarrage non journalisé');
    assert.ok(entries.some(e => e.mod === 'tool' && e.data?.tool === 'outil_inexistant'),
      'échec d\'outil non journalisé');
    assert.ok(entries.some(e => String(e.msg).includes('run_finish')), 'fin d\'exécution non journalisée');
  } finally {
    if (previous === undefined) delete process.env.HARNESS_DATA_DIR;
    else process.env.HARNESS_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
