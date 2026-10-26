/** Sortie colorée pour le CLI harness. */

const R = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const RED   = '\x1b[31m';
const GRAY  = '\x1b[90m';
const YELLOW = '\x1b[33m';

const TOOL_ICONS = {
  plan: '📋', read_file: '📖', write_file: '✏️ ', replace_code: '🔧',
  list_dir: '📁', find_symbol: '🔍', search_grep: '🔎', run_tests: '🧪',
  get_project_info: 'ℹ️ ', restore_file: '↩️ ', diff_file: '🔀',
  batch_replace: '⚡', read_url: '🌐', scratchpad: '📝',
  delete_file: '🗑️ ', move_file: '📦', git_status: '📊',
  git_diff: '📊', run_shell: '💻', ask_user: '❓', finish: '✅',
};

function printHeader(projectRoot) {
  process.stdout.write(`\n${CYAN}${BOLD}╔══ ShamCode CLI ══╗${R}\n`);
  process.stdout.write(`${GRAY}   ${projectRoot}${R}\n\n`);
}

function printStep(step, tool, args) {
  const icon = TOOL_ICONS[tool] || '🔧';
  const preview = args && Object.keys(args).length
    ? ` ${DIM}${JSON.stringify(args).slice(0, 80)}${R}`
    : '';
  process.stdout.write(`${GRAY}[${step}]${R} ${icon} ${CYAN}${BOLD}${tool}${R}${preview}\n`);
}

function printResult(result) {
  if (!result.ok) {
    process.stdout.write(`    ${RED}✗ ${result.error}${R}\n`);
    return;
  }
  // Résumé court des clés utiles (pas content ni ok)
  const skip = new Set(['ok', 'content', 'diff_lines', 'matches', 'results', 'entries']);
  const parts = Object.entries(result)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
    .slice(0, 4);
  if (parts.length) process.stdout.write(`    ${GRAY}${parts.join('  ')}${R}\n`);
}

function printToken(token) {
  process.stdout.write(token);
}

function printFinish(summary) {
  process.stdout.write(`\n${GREEN}${BOLD}✓ ${summary}${R}\n\n`);
}

function printError(msg) {
  process.stderr.write(`${RED}${BOLD}Erreur : ${msg}${R}\n`);
}

function printInfo(msg) {
  process.stdout.write(`${YELLOW}${msg}${R}\n`);
}

function printAskUser(question, suggestions) {
  process.stdout.write(`\n${YELLOW}${BOLD}❓ ${question}${R}\n`);
  if (suggestions && suggestions.length) {
    suggestions.forEach((s, i) => process.stdout.write(`   ${GRAY}${i + 1}. ${s}${R}\n`));
  }
}

module.exports = { printHeader, printStep, printResult, printToken, printFinish, printError, printInfo, printAskUser };
