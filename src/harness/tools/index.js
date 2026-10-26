/**
 * Dispatcher des outils exposés au LLM.
 * @param {string} toolName
 * @param {object} args
 * @param {Function} guard       - safe(relPath) → absPath
 * @param {object}  config
 * @param {Function} onEvent     - callback pour write_preview et autres événements
 * @param {string}  projectRoot  - nécessaire pour git_* et run_shell
 * @returns {Promise<object>} { ok, ... }
 */

const { TOOLS } = require('../../shared/constants');
const { validateArgs } = require('./validate');
const { readFile, writeFile, replaceCode, listDir, deleteFile, moveFile } = require('./fs');
const { findSymbol } = require('./symbols-search');
const { runTests }       = require('./test-runner');
const { getProjectInfo } = require('./project-info');
const { restoreFile }    = require('./restore');
const { useScratchpad }  = require('./scratchpad-tool');
const { diffFile }       = require('./diff-file');
const { batchReplace }   = require('./batch-replace');
const { readUrl }        = require('./read-url');
const { httpRequest, checkService } = require('./http-request');
const { deployProject }  = require('./deploy');
const { startProcess, stopProcess, getOutput, listProcesses } = require('./process-runner');
const { searchGrep }     = require('./grep');
const { gitStatus, gitDiff, gitCreateBranch, gitCommit } = require('./git');
const { runShell } = require('./shell');
const { spawnAgent, spawnParallel } = require('./spawn');
const { orchestrate } = require('./orchestrate');
const { enableCollaboration, postMessage, readMessages } = require('./message-bus');
const { askUser } = require('./ask');
const { addRule, deleteRule, installSkill, removeSkill } = require('./rules');
const { webSearch } = require('./web-search');
const { lspHover, lspDefinition, lspReferences } = require('./lsp');
const { fixLoop } = require('./fix-loop');
const { callApi } = require('./api');
const { formatFile } = require('./formatter');
const { findRelevantFiles } = require('./find-relevant');
const { notifyUser }        = require('./notify');
const { generateVideo }     = require('./video');
const { generateImage }     = require('./image');
const { mergeVideos }       = require('./merge-videos');
const { generateSpeech, listSpeechVoices } = require('./speech');
const { findDependents, findDependencies } = require('./depgraph-tool');
const { projectNote } = require('./project-notes-tool');
const { generatePalette, readDesignTokens } = require('./design');
const {
  browserOpen, browserNavigate, browserScreenshot,
  browserClick, browserType, browserEvaluate,
  browserGetText, browserGetContent, browserGetDom,
  browserSelect, browserCheck, browserKey,
  browserNewTab, browserListTabs, browserSwitchTab,
  browserScroll, browserWait, browserClose,
} = require('./browser');

async function dispatch(toolName, args, guard, config = {}, onEvent = () => {}, projectRoot = '', mcpRegistry = null) {
  // Validation d'arguments avant toute exécution : une erreur explicite (champ + exemple)
  // coûte un aller-retour au modèle ; une erreur d'implémentation en coûte plusieurs.
  const invalid = validateArgs(toolName, args);
  if (!invalid.ok) return invalid;

  switch (toolName) {
    case TOOLS.PLAN:
      return _executePlan(args, config, onEvent);
    case TOOLS.SPAWN_AGENT:
      return spawnAgent(args, config, onEvent, projectRoot);
    case TOOLS.SPAWN_PARALLEL:
      return spawnParallel(args, config, onEvent, projectRoot);
    case TOOLS.ORCHESTRATE:
      return orchestrate(args, config, onEvent, projectRoot);
    case TOOLS.ENABLE_COLLABORATION:
      return enableCollaboration(args, config, onEvent);
    case TOOLS.POST_MESSAGE:
      return postMessage(args, config, onEvent);
    case TOOLS.READ_MESSAGES:
      return readMessages(args, config);
    case TOOLS.ASK_USER:
      return askUser(args, config, onEvent);
    case TOOLS.NOTE_USER: {
      const msg = String(args.message || '').trim();
      if (!msg) return { ok: false, error: 'MESSAGE_MANQUANT' };
      onEvent({ type: 'note_user', message: msg, level: args.level || 'info' });
      return { ok: true };
    }
    case TOOLS.READ_FILE:
      return readFile(args, guard, projectRoot);
    case TOOLS.WRITE_FILE:
      return writeFile(args, guard, { ...config, _guard: guard, _projectRoot: projectRoot }, onEvent);
    case TOOLS.REPLACE_CODE:
      return replaceCode(args, guard, config, onEvent);
    case TOOLS.LIST_DIR:
      return listDir(args, guard, projectRoot);
    case TOOLS.FINISH:
      return { ok: true, finished: true, summary: args.summary || 'Tâche terminée.' };
    case TOOLS.DELETE_FILE:
      return deleteFile(args, guard, config, onEvent);
    case TOOLS.MOVE_FILE:
      return moveFile(args, guard, config, onEvent);
    case TOOLS.FIND_SYMBOL:
      return findSymbol(args, guard, projectRoot);
    case TOOLS.FIND_DEPENDENTS:
      return findDependents(args, guard, projectRoot);
    case TOOLS.FIND_DEPENDENCIES:
      return findDependencies(args, guard, projectRoot);
    case TOOLS.PROJECT_NOTE:
      return projectNote(args, guard, projectRoot);
    case TOOLS.RUN_TESTS:
      return runTests(args, projectRoot);
    case TOOLS.GET_PROJECT_INFO:
      return getProjectInfo(args, projectRoot);
    case TOOLS.RESTORE_FILE:
      return restoreFile(args, guard);
    case TOOLS.SCRATCHPAD_TOOL:
      return useScratchpad(args, config._scratchpad);
    case TOOLS.DIFF_FILE:
      return diffFile(args, guard);
    case TOOLS.BATCH_REPLACE:
      return batchReplace(args, guard, projectRoot);
    case TOOLS.READ_URL:
      return readUrl(args);
    case TOOLS.HTTP_REQUEST: {
      const r = await httpRequest(args);
      if (args.url) onEvent({
        type: 'app_connected', url: args.url,
        status: r.ok ? 'active' : 'error', statusCode: r.status,
      });
      return r;
    }
    case TOOLS.CHECK_SERVICE: {
      const r = await checkService(args);
      const u = args.url || (args.port ? `http://${args.host || 'localhost'}:${args.port}` : null);
      if (u) onEvent({ type: 'app_connected', url: u, status: r.reachable ? 'active' : 'error' });
      return r;
    }
    case TOOLS.DEPLOY:
      return deployProject(args, projectRoot, config);
    case TOOLS.START_PROCESS:
      return startProcess(args, projectRoot, config);
    case TOOLS.STOP_PROCESS:
      return stopProcess(args);
    case TOOLS.GET_OUTPUT:
      return getOutput(args);
    case TOOLS.LIST_PROCESSES:
      return listProcesses();
    case TOOLS.SEARCH_GREP:
      return searchGrep(args, guard, projectRoot);
    case TOOLS.GIT_STATUS:
      return gitStatus(args, guard, projectRoot);
    case TOOLS.GIT_DIFF:
      return gitDiff(args, guard, projectRoot);
    case TOOLS.GIT_CREATE_BRANCH:
      return gitCreateBranch(args, guard, projectRoot, config);
    case TOOLS.GIT_COMMIT:
      return gitCommit(args, guard, projectRoot, config);
    case TOOLS.FORMAT_FILE:
      return formatFile(args, guard, projectRoot);
    case TOOLS.FIND_RELEVANT_FILES:
      return findRelevantFiles(args, projectRoot);
    case TOOLS.RUN_SHELL:
      return runShell(args, projectRoot, config);
    case TOOLS.ADD_RULE:
      return addRule(args, config);
    case TOOLS.DELETE_RULE:
      return deleteRule(args, config);
    case TOOLS.INSTALL_SKILL:
      return installSkill(args, config);
    case TOOLS.REMOVE_SKILL:
      return removeSkill(args, config);
    case TOOLS.CALL_API:
      return callApi(args, config);
    case TOOLS.BROWSER_OPEN:
      return browserOpen(args);
    case TOOLS.BROWSER_NAVIGATE:
      return browserNavigate(args);
    case TOOLS.BROWSER_SCREENSHOT:
      return browserScreenshot(args, guard, projectRoot);
    case TOOLS.BROWSER_CLICK:
      return browserClick(args);
    case TOOLS.BROWSER_TYPE:
      return browserType(args);
    case TOOLS.BROWSER_EVALUATE:
      return browserEvaluate(args, config);
    case TOOLS.BROWSER_GET_TEXT:
      return browserGetText(args);
    case TOOLS.BROWSER_GET_CONTENT:
      return browserGetContent(args);
    case TOOLS.BROWSER_GET_DOM:
      return browserGetDom(args);
    case TOOLS.BROWSER_SELECT:
      return browserSelect(args);
    case TOOLS.BROWSER_CHECK:
      return browserCheck(args);
    case TOOLS.BROWSER_KEY:
      return browserKey(args);
    case TOOLS.BROWSER_NEW_TAB:
      return browserNewTab(args);
    case TOOLS.BROWSER_LIST_TABS:
      return browserListTabs();
    case TOOLS.BROWSER_SWITCH_TAB:
      return browserSwitchTab(args);
    case TOOLS.BROWSER_SCROLL:
      return browserScroll(args);
    case TOOLS.BROWSER_WAIT:
      return browserWait(args);
    case TOOLS.BROWSER_CLOSE:
      return browserClose();
    case TOOLS.WEB_SEARCH:
      return webSearch(args);
    case TOOLS.NOTIFY_USER:
      return notifyUser(args, config);
    case TOOLS.GENERATE_VIDEO:
      return generateVideo(args, guard, projectRoot, config);
    case TOOLS.GENERATE_IMAGE:
      return generateImage(args, guard, projectRoot, config);
    case TOOLS.MERGE_VIDEOS:
      return mergeVideos(args, guard, projectRoot);
    case TOOLS.GENERATE_SPEECH:
      return generateSpeech(args, guard, projectRoot);
    case TOOLS.LIST_SPEECH_VOICES:
      return listSpeechVoices();
    case TOOLS.LSP_HOVER:
      return lspHover(args, guard, projectRoot, config);
    case TOOLS.LSP_DEFINITION:
      return lspDefinition(args, guard, projectRoot, config);
    case TOOLS.LSP_REFERENCES:
      return lspReferences(args, guard, projectRoot, config);
    case TOOLS.FIX_LOOP:
      return fixLoop(args, guard, projectRoot, config);
    case TOOLS.GENERATE_PALETTE:
      return generatePalette(args);
    case TOOLS.READ_DESIGN_TOKENS:
      return readDesignTokens(args, guard, projectRoot);
    default:
      // Tentative de dispatch vers un outil MCP enregistré
      if (mcpRegistry && mcpRegistry.has(toolName)) {
        return mcpRegistry.call(toolName, args);
      }
      return { ok: false, error: `OUTIL_INCONNU: ${toolName}` };
  }
}

/**
 * Affiche le plan à l'utilisateur et attend son approbation.
 * Sans requestPlanApproval → approve silencieux (mode test / pas de blocage).
 */
async function _executePlan(args, config, onEvent) {
  const { objective, goals = [], steps = [] } = args;
  if (!objective) return { ok: false, error: 'PLAN_SANS_OBJECTIF' };

  // Un seul plan révisé : au-delà, le modèle tourne en boucle sur la planification
  // au lieu d'agir. Le compteur vit dans config (une tâche = une config).
  config._planCalls = (config._planCalls || 0) + 1;
  if (config._planCalls > 2) {
    return { ok: false, error: 'PLAN_DEJA_RÉVISÉ — un seul plan révisé est autorisé ; passe aux modifications ou termine avec finish.' };
  }

  // `revised` : le plan corrigé après lecture remplace le premier dans l'UI
  const plan = { objective, goals, steps, ...(args.revised ? { revised: true } : {}) };

  if (config.requestPlanApproval) {
    const approved = await config.requestPlanApproval(plan);
    if (!approved) return { ok: false, error: 'PLAN_REJETÉ_PAR_UTILISATEUR' };
  } else {
    onEvent({ type: 'plan_ready', plan });
  }

  return { ok: true, planned: true };
}

module.exports = { dispatch };
