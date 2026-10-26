'use strict';

/**
 * Process Runner — démarre et surveille des processus en arrière-plan.
 *
 * Outils exposés au LLM :
 *   start_process   — lance un processus (requiert enableShell)
 *   stop_process    — arrête un processus par nom
 *   get_output      — retourne les dernières lignes stdout/stderr
 *   list_processes  — liste tous les processus gérés
 *
 * Le store est un singleton de module → persiste pour toute la session harness.
 * onUpdate() est appelé à chaque changement (injection via config._procUpdate).
 */

const { spawn }  = require('child_process');
const os         = require('os');
const path       = require('path');

const MAX_LINES     = 500;  // ring buffer par processus
const MAX_OUT_CHARS = 6000; // limite de get_output

// ── Singleton ────────────────────────────────────────────────────────────────
// Map<name, ProcessEntry>
const _store = new Map();

// Callbacks enregistrés par la couche principale (IPC) pour diffuser les mises à jour
const _listeners = new Set();

function _notify() {
  const snapshot = listAll();
  for (const fn of _listeners) fn(snapshot);
}

function addListener(fn)    { _listeners.add(fn); }
function removeListener(fn) { _listeners.delete(fn); }

// ── Store interne ─────────────────────────────────────────────────────────────

function _auto_name(command) {
  const base = command.trim().split(/\s+/)[0].split(/[/\\]/).pop().slice(0, 16);
  return `${base}_${Date.now().toString(36)}`;
}

function _append(entry, line) {
  entry.output.push(line);
  if (entry.output.length > MAX_LINES) entry.output.shift();
}

// ── Outils publics ─────────────────────────────────────────────────────────

/**
 * Démarre un processus en arrière-plan.
 * @param {{ command, name?, cwd?, env? }} args
 * @param {string} projectRoot
 * @param {object} config
 */
function startProcess(args = {}, projectRoot = '', config = {}) {
  if (!config.enableShell) {
    return { ok: false, error: 'START_PROCESS_DÉSACTIVÉ — Activez run_shell dans les paramètres' };
  }

  const { command, name: rawName, cwd: rawCwd } = args;
  if (!command?.trim()) return { ok: false, error: 'COMMANDE_VIDE' };

  const name = (rawName?.trim() || _auto_name(command));

  if (_store.has(name)) {
    const existing = _store.get(name);
    if (existing.status === 'running') {
      return { ok: false, error: `PROCESSUS_DÉJÀ_ACTIF: "${name}" tourne déjà (pid ${existing.pid})` };
    }
  }

  const cwd = rawCwd ? path.resolve(rawCwd) : (projectRoot || process.cwd());

  const entry = {
    name,
    command,
    cwd,
    pid:       null,
    status:    'starting',
    output:    [],
    startedAt: new Date().toISOString(),
    exitCode:  null,
    _proc:     null,
  };
  _store.set(name, entry);
  _notify();

  // Démarrage asynchrone — la fonction retourne immédiatement
  const isWin = os.platform() === 'win32';
  const proc  = spawn(command, [], {
    cwd,
    shell:   true,
    env:     { ...process.env, ...(args.env || {}) },
    detached: false,
    // Sur Windows cmd.exe /c handle les scripts npm correctement
    ...(isWin ? {} : {}),
  });

  entry._proc = proc;
  entry.pid   = proc.pid;
  entry.status = 'running';
  _notify();

  proc.stdout?.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) { if (line) _append(entry, `[out] ${line}`); }
    _notify();
  });

  proc.stderr?.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) { if (line) _append(entry, `[err] ${line}`); }
    _notify();
  });

  proc.on('error', (e) => {
    _append(entry, `[sys] Erreur spawn: ${e.message}`);
    entry.status = 'error';
    entry._proc  = null;
    _notify();
  });

  proc.on('close', (code) => {
    entry.status   = code === 0 ? 'stopped' : 'error';
    entry.exitCode = code;
    entry._proc    = null;
    _append(entry, `[sys] Processus terminé (code ${code})`);
    _notify();
  });

  return { ok: true, name, pid: proc.pid, command, cwd };
}

/**
 * Arrête un processus par nom.
 * @param {{ name, force? }} args
 */
function stopProcess(args = {}) {
  const { name, force = false } = args;
  if (!name) return { ok: false, error: 'NOM_MANQUANT' };

  const entry = _store.get(name);
  if (!entry) return { ok: false, error: `PROCESSUS_INTROUVABLE: "${name}"` };

  if (entry.status !== 'running' || !entry._proc) {
    return { ok: false, error: `PROCESSUS_NON_ACTIF: "${name}" est ${entry.status}` };
  }

  try {
    if (os.platform() === 'win32') {
      // Sur Windows, kill() ne propage pas aux enfants — utiliser taskkill
      require('child_process').execSync(`taskkill /PID ${entry.pid} /T /F`, { timeout: 5000 });
    } else {
      process.kill(-entry._proc.pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch {
    // Si le processus est déjà mort, ignorer
    entry._proc?.kill?.('SIGKILL');
  }

  entry.status = 'stopped';
  entry._proc  = null;
  _append(entry, '[sys] Arrêté manuellement');
  _notify();

  return { ok: true, name, stopped: true };
}

/**
 * Retourne les dernières lignes de sortie.
 * @param {{ name, lines? }} args
 */
function getOutput(args = {}) {
  const { name, lines: count = 50 } = args;
  if (!name) return { ok: false, error: 'NOM_MANQUANT' };

  const entry = _store.get(name);
  if (!entry) return { ok: false, error: `PROCESSUS_INTROUVABLE: "${name}"` };

  const cap    = Math.min(Math.max(1, count), 500);
  const lines  = entry.output.slice(-cap);
  const text   = lines.join('\n').slice(-MAX_OUT_CHARS);

  return {
    ok:     true,
    name,
    status: entry.status,
    pid:    entry.pid,
    lines:  lines.length,
    output: text,
  };
}

/**
 * Liste tous les processus gérés.
 */
function listProcesses() {
  const procs = listAll();
  return { ok: true, count: procs.length, processes: procs };
}

// ── Snapshot public ───────────────────────────────────────────────────────────

function listAll() {
  return [..._store.values()].map(e => ({
    name:      e.name,
    command:   e.command,
    cwd:       e.cwd,
    pid:       e.pid,
    status:    e.status,
    exitCode:  e.exitCode,
    startedAt: e.startedAt,
    lastLines: e.output.slice(-3),
  }));
}

module.exports = { startProcess, stopProcess, getOutput, listProcesses, addListener, removeListener, listAll };
