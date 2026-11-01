/**
 * Exécute une commande sans bloquer le processus principal.
 * Le harness tourne dans le main Electron : un execSync y fige l'interface et rend le Stop
 * inopérant pendant toute la durée de la commande.
 */

const { exec, execFile } = require('child_process');
const os = require('os');

const MAX_BUFFER = 10 * 1024 * 1024;

/** Arrête la commande et ses enfants : sous Windows, kill() ne touche que le shell. */
function _killTree(child) {
  if (os.platform() === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * @param {string} command
 * @param {{ cwd: string, timeout: number, signal?: AbortSignal }} opts
 * @returns {Promise<{ stdout: string, stderr: string, code: number, timedOut: boolean, aborted: boolean, message: string }>}
 *   Ne rejette jamais : un échec de commande est un résultat comme un autre.
 */
function runCommand(command, { cwd, timeout, signal }) {
  if (signal?.aborted) {
    return Promise.resolve({ stdout: '', stderr: '', code: -1, timedOut: false, aborted: true, message: '' });
  }

  return new Promise((resolve) => {
    let timedOut = false;
    let aborted  = false;

    const child = exec(command, { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code:   err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        timedOut,
        aborted,
        message: err?.message || '',
      });
    });

    // Sans cela, une commande qui lit stdin attendrait jusqu'au délai maximal
    child.stdin?.end();

    const onAbort = () => { aborted = true; _killTree(child); };
    const timer = setTimeout(() => { timedOut = true; _killTree(child); }, timeout);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { runCommand };
