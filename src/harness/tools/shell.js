const { exec } = require('child_process');
const { promisify } = require('util');

// Asynchrone : execSync bloquait le processus principal (donc l'UI et les IPC)
// pendant toute la durée de la commande, jusqu'à 60 s.
const execAsync = promisify(exec);

const SHELL_TIMEOUT = 60000; // 60s max
const MAX_OUTPUT    = 12000; // caractères max retournés
const MAX_BUFFER    = 10 * 1024 * 1024; // 10 Mo — au-delà, exec renvoie ENOBUFS

// Blacklist : commandes destructrices bloquées même si enableShell est actif.
// Ce n'est PAS un sandbox : la vraie protection reste enableShell=false par défaut.
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

  try {
    const { stdout = '', stderr = '' } = await execAsync(args.command, {
      cwd:        projectRoot,
      timeout:    SHELL_TIMEOUT,
      encoding:   'utf8',
      shell:      true,
      maxBuffer:  MAX_BUFFER,
      windowsHide: true,
    });
    return {
      ok: true,
      stdout: stdout.slice(0, MAX_OUTPUT),
      ...(stderr ? { stderr: stderr.slice(0, 500) } : {}),
      truncated: stdout.length > MAX_OUTPUT,
    };
  } catch (e) {
    const stdout = (e.stdout || '').slice(0, MAX_OUTPUT);
    const stderr = (e.stderr || e.message || '').slice(0, 500);
    return { ok: false, error: stderr, stdout, code: e.code ?? -1 };
  }
}

module.exports = { runShell };
