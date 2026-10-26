'use strict';
/**
 * Tests pour process-runner.js
 * Couvre : startProcess (guards), stopProcess, getOutput, listProcesses, listeners
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Require en dernier pour éviter que le singleton garde l'état entre tests via le cache
// On recharge le module pour chaque describe via un helper
let runner;
function _reload() {
  // Vider le cache pour repartir d'un singleton propre
  const key = require.resolve('../src/harness/tools/process-runner');
  delete require.cache[key];
  runner = require('../src/harness/tools/process-runner');
}

/**
 * Attend qu'une condition devienne vraie (sondage) au lieu d'un délai fixe.
 * Les tests spawnent de vrais processus : sous charge (suite complète lancée en
 * parallèle) un délai fixe de 500-800 ms n'est pas fiable.
 */
async function _waitFor(predicate, timeoutMs = 8000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(res => setTimeout(res, stepMs));
  }
  return false;
}

describe('startProcess', () => {
  before(_reload);

  test('refuse si enableShell est false (absent)', () => {
    const r = runner.startProcess({ command: 'echo hello' }, '', {});
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /DÉSACTIVÉ/);
  });

  test('refuse si command vide', () => {
    const r = runner.startProcess({ command: '' }, '', { enableShell: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'COMMANDE_VIDE');
  });

  test('refuse si command absent', () => {
    const r = runner.startProcess({}, '', { enableShell: true });
    assert.strictEqual(r.ok, false);
  });

  test('démarre un processus et retourne ok + pid', async () => {
    const r = runner.startProcess({ command: 'node -e "process.exit(0)"', name: 'test-exit0' }, '', { enableShell: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.name, 'test-exit0');
    assert.ok(r.pid > 0, 'pid doit être positif');
    // Laisser le processus se terminer
    await new Promise(res => setTimeout(res, 500));
  });

  test('refuse un doublon de nom actif', async () => {
    // Démarrer un processus qui tourne longtemps
    const r1 = runner.startProcess({
      command: 'node -e "setTimeout(()=>{},5000)"',
      name:    'doublon-proc',
    }, '', { enableShell: true });
    assert.strictEqual(r1.ok, true);

    const r2 = runner.startProcess({ command: 'echo hi', name: 'doublon-proc' }, '', { enableShell: true });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.error, /DÉJÀ_ACTIF/);

    // Nettoyage
    runner.stopProcess({ name: 'doublon-proc', force: true });
    await new Promise(res => setTimeout(res, 200));
  });
});

describe('stopProcess', () => {
  before(_reload);

  test('retourne erreur si nom manquant', () => {
    const r = runner.stopProcess({});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NOM_MANQUANT');
  });

  test('retourne erreur si processus inconnu', () => {
    const r = runner.stopProcess({ name: 'inexistant-xyz' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /INTROUVABLE/);
  });

  test('arrête un processus en cours', async () => {
    runner.startProcess({
      command: 'node -e "setTimeout(()=>{},10000)"',
      name:    'proc-to-stop',
    }, '', { enableShell: true });

    await new Promise(res => setTimeout(res, 100));
    const r = runner.stopProcess({ name: 'proc-to-stop' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stopped, true);
    await new Promise(res => setTimeout(res, 200));
  });

  test('retourne erreur si processus déjà arrêté', async () => {
    runner.startProcess({
      command: 'node -e "process.exit(0)"',
      name:    'proc-already-dead',
    }, '', { enableShell: true });
    await _waitFor(() => {
      const entry = runner.listProcesses().processes.find(p => p.name === 'proc-already-dead');
      return !entry || entry.status !== 'running';
    });
    const r = runner.stopProcess({ name: 'proc-already-dead' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /NON_ACTIF/);
  });
});

describe('getOutput', () => {
  before(_reload);

  test('retourne erreur si nom manquant', () => {
    const r = runner.getOutput({});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NOM_MANQUANT');
  });

  test('retourne erreur si processus inconnu', () => {
    const r = runner.getOutput({ name: 'fantome' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /INTROUVABLE/);
  });

  test('retourne les lignes stdout après exécution', async () => {
    runner.startProcess({
      command: 'node -e "console.log(\'ligne-test-42\')"',
      name:    'proc-output',
    }, '', { enableShell: true });

    await _waitFor(() => runner.getOutput({ name: 'proc-output', lines: 10 }).output.includes('ligne-test-42'));
    const r = runner.getOutput({ name: 'proc-output', lines: 10 });
    assert.strictEqual(r.ok, true);
    assert.ok(r.output.includes('ligne-test-42'), `Sortie attendue, reçu: ${r.output}`);
  });

  test('plafonne lines à 500', async () => {
    runner.startProcess({ command: 'node -e "process.exit(0)"', name: 'proc-cap' }, '', { enableShell: true });
    await new Promise(res => setTimeout(res, 300));
    const r = runner.getOutput({ name: 'proc-cap', lines: 9999 });
    assert.strictEqual(r.ok, true);
    assert.ok(r.lines <= 500);
  });
});

describe('listProcesses', () => {
  before(_reload);

  test('retourne ok et tableau vide quand aucun processus', () => {
    const r = runner.listProcesses();
    assert.strictEqual(r.ok, true);
    assert.ok(Array.isArray(r.processes));
    assert.strictEqual(r.processes.length, 0);
  });

  test('retourne le processus démarré', async () => {
    runner.startProcess({ command: 'node -e "setTimeout(()=>{},3000)"', name: 'list-proc' }, '', { enableShell: true });
    await new Promise(res => setTimeout(res, 100));
    const r = runner.listProcesses();
    assert.strictEqual(r.ok, true);
    const found = r.processes.find(p => p.name === 'list-proc');
    assert.ok(found, 'processus introuvable dans la liste');
    assert.strictEqual(found.status, 'running');
    runner.stopProcess({ name: 'list-proc', force: true });
    await new Promise(res => setTimeout(res, 200));
  });
});

describe('listeners', () => {
  before(_reload);

  test('addListener est appelé lors du démarrage puis à la fin', async () => {
    const events = [];
    const cb = (procs) => events.push(procs.map(p => p.status));
    runner.addListener(cb);

    runner.startProcess({ command: 'node -e "process.exit(0)"', name: 'listener-proc' }, '', { enableShell: true });
    await _waitFor(() => {
      const last = events[events.length - 1] || [];
      return events.length >= 2 && (last.includes('stopped') || last.includes('error'));
    });
    runner.removeListener(cb);

    assert.ok(events.length >= 2, `Au moins 2 notifications attendues, reçu: ${events.length}`);
    // Le premier doit inclure 'running'
    assert.ok(events.some(e => e.includes('running')));
    // Le dernier doit inclure 'stopped' ou 'error' (code 0 → stopped)
    const last = events[events.length - 1];
    assert.ok(last.includes('stopped') || last.includes('error'));
  });
});
