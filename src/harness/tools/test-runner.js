/**
 * Outil run_tests : lance la suite de tests du projet courant.
 * Auto-détecte le runner selon les fichiers présents (package.json, Cargo.toml, etc.).
 * Disponible sans enableShell — limité aux commandes de test reconnues.
 */

const fs   = require('fs');
const path = require('path');
const { runCommand } = require('./run-command');

const TESTS_TIMEOUT = 30000; // 30s — les suites courtes terminent bien avant
const MAX_OUTPUT    = 10000; // caractères max retournés au LLM

/**
 * Détecte le runner de tests adapté au projet.
 * @param {string} projectRoot
 * @returns {{ cmd: string, runner: string } | null}
 */
function _detectRunner(projectRoot) {
  // Node.js / npm
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.test) {
        return { cmd: 'npm test', runner: 'npm' };
      }
    } catch { /* ignore */ }
  }

  // Rust / Cargo
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return { cmd: 'cargo test', runner: 'cargo' };
  }

  // Python — pytest (chercher pytest.ini, setup.cfg, pyproject.toml, ou setup.py)
  const pyMarkers = ['pytest.ini', 'setup.cfg', 'pyproject.toml', 'setup.py', 'requirements.txt'];
  if (pyMarkers.some(f => fs.existsSync(path.join(projectRoot, f)))) {
    return { cmd: 'pytest', runner: 'pytest' };
  }

  // Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return { cmd: 'go test ./...', runner: 'go' };
  }

  // Ruby — RSpec ou minitest
  if (fs.existsSync(path.join(projectRoot, 'Gemfile'))) {
    const haSpec = fs.existsSync(path.join(projectRoot, 'spec'));
    return { cmd: haSpec ? 'bundle exec rspec' : 'bundle exec rake test', runner: 'ruby' };
  }

  return null;
}

/**
 * Lance les tests du projet.
 * Si args.command est fourni, l'utilise tel quel (parmi les commandes whitelistées).
 *
 * @param {{ command?: string }} args
 * @param {string} projectRoot
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {{ ok, runner, exitCode, stdout, stderr, passed?, truncated? }}
 */
async function runTests(args, projectRoot, { signal } = {}) {
  if (!projectRoot) return { ok: false, error: 'RUN_TESTS_SANS_PROJET' };

  let cmd, runner;

  if (args?.command) {
    // Commande manuelle — vérifier qu'elle est dans la whitelist des runners
    const allowed = ['npm test', 'npm run test', 'yarn test', 'pnpm test',
                     'pytest', 'python -m pytest', 'python3 -m pytest',
                     'cargo test', 'go test ./...', 'go test',
                     'bundle exec rspec', 'bundle exec rake test',
                     'mvn test', 'gradle test', 'dotnet test'];
    const trimmed = args.command.trim();
    if (!allowed.some(a => trimmed === a || trimmed.startsWith(a + ' '))) {
      return { ok: false, error: `COMMANDE_TEST_NON_AUTORISÉE: ${trimmed.slice(0, 80)}` };
    }
    cmd    = trimmed;
    runner = 'manuel';
  } else {
    const detected = _detectRunner(projectRoot);
    if (!detected) {
      return { ok: false, error: 'RUNNER_NON_DÉTECTÉ — aucun package.json, Cargo.toml, go.mod ou pytest trouvé' };
    }
    ({ cmd, runner } = detected);
  }

  const run = await runCommand(cmd, { cwd: projectRoot, timeout: TESTS_TIMEOUT, signal });
  if (run.aborted) return { ok: false, error: 'ANNULÉ' };

  if (run.code === 0 && !run.timedOut) {
    const stdout = _keepEnds(run.stdout, MAX_OUTPUT);
    const passed = _inferPassed(stdout, runner);
    return { ok: true, runner, exitCode: 0, stdout, ...(passed != null ? { passed } : {}), ...(run.stdout.length > MAX_OUTPUT ? { truncated: true } : {}) };
  }

  // stderr rejoint stdout pour avoir toute la sortie du runner
  const stdout = _keepEnds(run.stdout + run.stderr, MAX_OUTPUT);
  const passed = _inferPassed(stdout, runner);
  return {
    ok:       false,
    runner,
    exitCode: run.code,
    stdout,
    // Le modèle ne doit pas chercher un bug là où la suite n'a simplement pas fini
    error:    run.timedOut ? `TESTS_DÉLAI_DÉPASSÉ (${TESTS_TIMEOUT / 1000}s)` : 'TESTS_ÉCHOUÉS',
    ...(passed != null ? { passed } : {}),
  };
}

/**
 * Coupe au milieu : les runners listent les échecs et le bilan en fin de sortie.
 * @param {string} text
 * @param {number} max
 */
function _keepEnds(text, max) {
  if (text.length <= max) return text;
  const marker = `\n[… ${text.length - max} caractères omis …]\n`;
  const head = Math.floor((max - marker.length) / 4);
  return text.slice(0, head) + marker + text.slice(-(max - marker.length - head));
}

/**
 * Tente d'inférer si les tests ont passé et combien, selon le runner.
 * Retourne null si non parseable.
 */
function _inferPassed(output, runner) {
  if (!output) return null;

  // npm / node --test : "pass N"
  const nodeMatch = output.match(/pass\s+(\d+)/i);
  if (nodeMatch) return parseInt(nodeMatch[1], 10);

  // pytest : "N passed"
  const pyMatch = output.match(/(\d+)\s+passed/);
  if (pyMatch) return parseInt(pyMatch[1], 10);

  // cargo test : "test result: ok. N passed"
  const cargoMatch = output.match(/test result: ok\.\s+(\d+)\s+passed/);
  if (cargoMatch) return parseInt(cargoMatch[1], 10);

  // go test : "ok"
  if (runner === 'go' && output.includes('ok')) return null; // go n'affiche pas le nombre

  return null;
}

module.exports = { runTests, _detectRunner, _keepEnds };
