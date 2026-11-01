const { runCommand } = require('./run-command');
const { _keepEnds }  = require('./test-runner');

const SHELL_TIMEOUT = 60000; // 60s max
const MAX_OUTPUT    = 12000; // caractères max retournés

// Blacklist : commandes destructrices bloquées même si enableShell est actif
const BLOCKED_PATTERNS = [
  /rm\s+-rf?\s+[/\\]/i,          // rm -rf /  rm -r /
  /rd\s+\/s\s+\/q\s+[a-z]:\\/i, // rd /s /q C:\
  /format\s+[a-z]:/i,            // format C:
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\/(sd|hd|nvme)/i,
  /del\s+\/[fqs]+\s+[a-z]:\\/i,  // del /f /q /s C:\
];

function _isBlocked(command) {
  return BLOCKED_PATTERNS.some(re => re.test(command));
}

/**
 * Exécute une commande shell.
 * N'est disponible que si enableShell === true dans la config.
 * @param {{ command: string }} args
 * @param {string} projectRoot - cwd d'exécution
 * @param {object} config
 */
async function runShell(args, projectRoot, config) {
  if (!config?.enableShell) {
    return { ok: false, error: 'SHELL_DISABLED — activez run_shell dans les paramètres' };
  }

  if (!args.command?.trim()) return { ok: false, error: 'COMMANDE_VIDE' };

  if (_isBlocked(args.command)) {
    return { ok: false, error: `COMMANDE_BLOQUÉE (destructrice): ${args.command.slice(0, 80)}` };
  }

  const run = await runCommand(args.command, { cwd: projectRoot, timeout: SHELL_TIMEOUT, signal: config._signal });
  if (run.aborted) return { ok: false, error: 'ANNULÉ' };

  const stdout = _keepEnds(run.stdout, MAX_OUTPUT);
  if (run.code === 0 && !run.timedOut) {
    return { ok: true, stdout, truncated: run.stdout.length > MAX_OUTPUT };
  }
  const error = run.timedOut
    ? `COMMANDE_DÉLAI_DÉPASSÉ (${SHELL_TIMEOUT / 1000}s) — utilise start_process pour une commande longue`
    : (run.stderr || run.message).slice(0, 500);
  return { ok: false, error, stdout, code: run.code };
}

module.exports = { runShell };
