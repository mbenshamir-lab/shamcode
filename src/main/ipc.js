const { ipcMain, BrowserWindow, dialog } = require('electron');
const crypto = require('crypto');
const { IPC, APPS_IPC, PROCS_IPC, MAX_CONTEXT_CHARS } = require('../shared/constants');
const { openSettingsWindow, openDesignWindow, openDonationWindow } = require('./windows');
const { approvalRequired } = require('../shared/approval');
const { notifyTaskComplete, notifyUser: _notifyUser } = require('./notifications');
const { listAll: listAllProcs, addListener: addProcListener, removeProcListener } = require('../harness/tools/process-runner');
const { AppsManager } = require('./apps-manager');
const { createSharedBus } = require('../harness/tools/message-bus');
const { listModels }         = require('../harness/llm/list-models');
const { GeminiEngine }       = require('../harness/llm/engines/gemini');
const { OpenAiCompatEngine } = require('../harness/llm/engines/openai-compat');
const { LlmRouter }          = require('../harness/llm/router');
const { registry }           = require('../harness/llm/registry');
const { saveConfig }         = require('./config');
const { transcribeAudio, preloadVoiceModel } = require('./voice');
const { condenseDictation }  = require('../harness/voice/summarize');
const { resolveAllKeys }     = require('./safe-keys');
const { runAgent }           = require('../harness/agent');
const { resolveContextBudget } = require('../harness/context/budget');
const { makeGuard }          = require('../harness/safety/path-guard');
const { listSessions, loadSession } = require('../harness/memory/sessions');
const fs = require('fs');

let _currentAbortController = null;
const _pendingApprovals = new Map(); // id → resolve(boolean)

/**
 * Crée le bridge IPC entre le main process et le renderer caché WebLLM.
 * sendRequest() ouvre un canal unique par requête, avec timeout 120s.
 */
function _createWebLlmBridge(hiddenWin) {
  let _ready = false;
  let _error = null;

  return {
    _onReady: (ready, error) => { _ready = ready; _error = error || null; },
    isReady:  () => Promise.resolve(_ready),
    getError: () => _error,

    sendRequest: (messages, options) => new Promise((resolve, reject) => {
      const replyChannel = crypto.randomBytes(8).toString('hex');
      const fullChannel  = `${IPC.LLM_REPLY}:${replyChannel}`;

      const timer = setTimeout(() => {
        ipcMain.removeAllListeners(fullChannel);
        reject(new Error('WebLLM timeout (300s)'));
      }, 300_000);

      ipcMain.once(fullChannel, (_, result) => {
        clearTimeout(timer);
        if (result.error) reject(new Error(result.error));
        else resolve(result.text);
      });

      hiddenWin.webContents.send(IPC.LLM_REQUEST, { messages, options, replyChannel });
    }),
  };
}

// La fenêtre visible peut être fermée pendant qu'une tâche, un ping ou un
// événement de progression est encore en vol : webContents.send lèverait
// « Object has been destroyed » dans le main process (boîte d'erreur fatale).
function _sendVisible(win, channel, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * Enregistre tous les handlers IPC.
 * Point d'entrée unique pour toute la communication inter-process.
 */
function registerIpcHandlers({ visibleWin, hiddenWin, config }) {

  // Créer le bridge WebLLM (communication main ↔ renderer caché)
  const webLlmBridge = _createWebLlmBridge(hiddenWin);

  // ── AppsManager : registre des apps connectées ──────────────────────────────
  const appsManager = new AppsManager((apps) => {
    _sendVisible(visibleWin, APPS_IPC.UPDATE, apps);
  });
  appsManager.startPeriodicPing();

  ipcMain.handle(APPS_IPC.REGISTER, (_, { url, name } = {}) => {
    if (url) appsManager.register(url, name);
    return { ok: true };
  });
  ipcMain.handle(APPS_IPC.REMOVE,   (_, { url } = {}) => { appsManager.remove(url);   return { ok: true }; });
  ipcMain.handle(APPS_IPC.SUSPEND,  (_, { url } = {}) => { appsManager.suspend(url);  return { ok: true }; });
  ipcMain.handle(APPS_IPC.RESUME,   (_, { url } = {}) => { appsManager.resume(url);   return { ok: true }; });
  ipcMain.handle(APPS_IPC.PING,     async ()           => { await appsManager.pingAll(); return { ok: true }; });

  // ── ProcessRunner : processus en arrière-plan ────────────────────────────────
  const _procUpdateCb = (procs) => { _sendVisible(visibleWin, PROCS_IPC.UPDATE, procs); };
  addProcListener(_procUpdateCb);
  ipcMain.handle(PROCS_IPC.LIST, () => ({ ok: true, processes: listAllProcs() }));

  // Envoyer la config au renderer caché dès que la page est chargée
  hiddenWin.webContents.once('did-finish-load', () => {
    const webllmCfg = config.model?.engines?.webllm || {};
    hiddenWin.webContents.send(IPC.LLM_CONFIG, {
      model: webllmCfg.model || 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    });
  });

  // LLM prêt (hidden → main → visible + mise à jour bridge)
  ipcMain.on(IPC.LLM_READY, (_, payload) => {
    webLlmBridge._onReady(payload.ready === true, payload.error || null);
    _sendVisible(visibleWin, IPC.LLM_STATUS, payload);
  });

  // Progression chargement modèle
  ipcMain.on(IPC.LLM_PROGRESS, (_, payload) => {
    _sendVisible(visibleWin, IPC.LLM_STATUS, { type: 'progress', ...payload });
  });

  // Vider le cache disque du modèle WebLLM (déclenché depuis la fenêtre Paramètres)
  ipcMain.handle(IPC.LLM_CLEAR_CACHE, () => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'Timeout (10 s)' }), 10000);
    ipcMain.once(IPC.LLM_CACHE_CLEARED, (_, result) => {
      clearTimeout(timer);
      resolve(result);
    });
    hiddenWin.webContents.send(IPC.LLM_CLEAR_CACHE);
  }));

  // Réponse utilisateur à une question de l'agent
  ipcMain.handle(IPC.ASK_USER_RESPONSE, async (_, { id, answer }) => {
    const resolve = _pendingApprovals.get(id);
    if (resolve) { _pendingApprovals.delete(id); resolve(answer); }
    return { ok: true };
  });

  // Décision d'approbation écriture (visible → main)
  ipcMain.handle(IPC.WRITE_DECISION, async (_, { id, approved }) => {
    const resolve = _pendingApprovals.get(id);
    if (resolve) { _pendingApprovals.delete(id); resolve(approved); }
    return { ok: true };
  });

  // Décision d'approbation plan (visible → main)
  ipcMain.handle(IPC.PLAN_DECISION, async (_, { id, approved }) => {
    const resolve = _pendingApprovals.get(id);
    if (resolve) { _pendingApprovals.delete(id); resolve(approved); }
    return { ok: true };
  });

  // Lancer une tâche — boucle harness complète via le router
  ipcMain.handle(IPC.AGENT_RUN, async (_, { task, projectRoot, approvalMode, multiAgentMode, planMode, images }) => {
    const router = _buildRouter(config, { webllm: webLlmBridge });
    const root   = projectRoot || config.projectRoot || process.cwd();

    _currentAbortController = new AbortController();
    const { signal } = _currentAbortController;

    // requestApproval : envoie WRITE_PENDING à l'UI et attend la décision.
    // En mode Action l'agent est pleinement autorisé → aucune validation demandée.
    const useApproval = approvalRequired({
      planMode,
      approvalMode,
      configApprovalMode: config.approvalMode,
    });
    const requestApproval = useApproval
      ? (preview) => new Promise((resolve) => {
          const id = crypto.randomUUID();
          _pendingApprovals.set(id, resolve);
          _sendVisible(visibleWin, IPC.WRITE_PENDING, { ...preview, id });
        })
      : null;

    // requestPlanApproval : envoie PLAN_PENDING à l'UI et attend l'approbation
    const requestPlanApproval = useApproval
      ? (plan) => new Promise((resolve) => {
          const id = crypto.randomUUID();
          _pendingApprovals.set(id, resolve);
          _sendVisible(visibleWin, IPC.PLAN_PENDING, { ...plan, id });
        })
      : null;

    // Bus de messages partagé — activé si l'utilisateur l'a demandé
    const useMultiAgent = multiAgentMode ?? config.multiAgentMode ?? false;
    const sharedBus = useMultiAgent ? createSharedBus() : null;

    // requestUserInput : envoie ASK_USER_PENDING et attend la réponse textuelle
    const requestUserInput = (payload) => new Promise((resolve) => {
      const id = crypto.randomUUID();
      _pendingApprovals.set(id, resolve);
      _sendVisible(visibleWin, IPC.ASK_USER_PENDING, { ...payload, id });
    });

    // Budget de contexte adapté au moteur qui consomme le prompt :
    // local (webllm/cpu) → court et fonction du modèle ; cloud → réglage utilisateur.
    const primary = config.model?.primary || 'openai-compat';

    // _llmGenerate et _signal : injectés pour que les sous-agents puissent générer
    const agentConfig = {
      ...config,
      planMode:      planMode ?? false,
      // La fenêtre Paramètres enregistre `maxContextChars` — `contextBudget` n'a
      // jamais existé dans la config, le réglage « Budget contexte » était donc
      // sans effet.
      contextBudget: resolveContextBudget({
        engine: primary,
        model: config.model?.engines?.[primary]?.model,
        maxContextChars: config.maxContextChars ?? MAX_CONTEXT_CHARS,
      }),
      requestApproval,
      requestPlanApproval,
      requestUserInput,
      _llmGenerate: (msgs, opts) => router.generate(msgs, opts),
      _signal:      signal,
      _sharedBus:   sharedBus,
      // Permet aux outils add_rule/delete_rule de persister la config et de notifier l'UI
      saveConfig: async (updates) => {
        Object.assign(config, updates);
        await saveConfig(config);
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(IPC.CONFIG_UPDATED, config);
        }
      },
    };

    try {
      const result = await runAgent({
        task,
        projectRoot: root,
        config: { ...agentConfig, _images: images?.length ? images : undefined },
        signal,
        llmGenerate: (msgs, opts) => router.generate(msgs, opts),
        onEvent: (event) => {
          _sendVisible(visibleWin, IPC.AGENT_EVENT, event);
          if (event.type === 'app_connected' && event.url) {
            appsManager.register(event.url);
          }
        },
      });
      notifyTaskComplete({ task, ok: result.ok, stepCount: result.trace?.length }, visibleWin);
      return result;
    } catch (err) {
      notifyTaskComplete({ task, ok: false }, visibleWin);
      const cause = err.cause?.message || err.cause?.code || '';
      return { ok: false, error: cause ? `${err.message} — ${cause}` : err.message };
    } finally {
      _currentAbortController = null;
      router.disposeAll().catch(() => {});
    }
  });

  // Annuler la tâche en cours
  ipcMain.handle(IPC.AGENT_CANCEL, async () => {
    if (_currentAbortController) {
      _currentAbortController.abort();
      // Débloquer toutes les approbations en attente (write, plan, ask_user)
      // pour que les promesses se résolvent et que l'agent puisse vérifier signal.aborted
      for (const [id, resolve] of _pendingApprovals) {
        resolve(false);           // false = rejeté / annulé
        _pendingApprovals.delete(id);
      }
      return { ok: true };
    }
    return { ok: false, error: 'Aucune tâche en cours' };
  });

  // Amener la fenêtre au premier plan (bouton "Voir résultat" depuis une notif)
  ipcMain.handle(IPC.WINDOW_FOCUS, () => {
    if (!visibleWin.isDestroyed()) {
      if (visibleWin.isMinimized()) visibleWin.restore();
      visibleWin.show();
      visibleWin.focus();
      visibleWin.flashFrame(false);
    }
    return { ok: true };
  });

  // Ouvrir un sélecteur de dossier natif
  ipcMain.handle(IPC.FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(visibleWin, {
      properties: ['openDirectory'],
      title: 'Choisir le dossier projet',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Sélecteur de fichier natif (ex. modèle GGUF pour le moteur CPU)
  ipcMain.handle(IPC.FILE_DIALOG, async (_, { filters } = {}) => {
    const result = await dialog.showOpenDialog(visibleWin, {
      properties: ['openFile'],
      title: 'Choisir le fichier modèle',
      filters: filters || [{ name: 'Modèles GGUF', extensions: ['gguf', 'bin'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Lecture d'un fichier du projet pour la visionneuse — lecture seule, confinée au projectRoot
  ipcMain.handle(IPC.FILE_READ, async (_, { path: relPath } = {}) => {
    const root = config.projectRoot;
    if (!root) return { ok: false, error: 'PROJET_NON_DÉFINI' };
    if (!relPath || typeof relPath !== 'string') return { ok: false, error: 'CHEMIN_MANQUANT' };
    try {
      const abs     = makeGuard(root)(relPath);
      const content = fs.readFileSync(abs, 'utf8');
      return { ok: true, path: relPath, content, totalLines: content.split('\n').length };
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: false, error: 'FICHIER_INTROUVABLE' };
      return { ok: false, error: err.message || 'ERREUR_LECTURE' };
    }
  });

  // Sessions — liste
  ipcMain.handle(IPC.SESSIONS_LIST, async () => listSessions());
  // Sessions — détail
  ipcMain.handle(IPC.SESSIONS_GET, async (_, { id }) => loadSession(id));

  // Sessions — export vers fichier choisi par l'utilisateur
  ipcMain.handle(IPC.SESSIONS_EXPORT, async (_, { id }) => {
    const session = loadSession(id);
    if (!session) return { ok: false, error: 'SESSION_NOT_FOUND' };

    const defaultName = `session-${id}-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await dialog.showSaveDialog(visibleWin, {
      title: 'Exporter la session',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return { ok: false, error: 'ANNULÉ' };

    try {
      fs.writeFileSync(result.filePath, JSON.stringify(session, null, 2), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Dictée vocale : audio → Whisper local → condensé par le LLM actif ───────
  // Progression du téléchargement du modèle : fenêtre principale ET Paramètres (bouton « Télécharger »)
  ipcMain.on(IPC.VOICE_PROGRESS, (event, p) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== event.sender) win.webContents.send(IPC.VOICE_PROGRESS, p);
    }
  });

  ipcMain.handle(IPC.VOICE_PRELOAD, async (_, { model } = {}) => {
    try {
      await preloadVoiceModel(model);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'TELECHARGEMENT_ECHEC', detail: err.message };
    }
  });

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_, { audio } = {}) => {
    if (!config.voiceEnabled) return { ok: false, error: 'VOICE_DISABLED' };
    if (!audio || !audio.byteLength) return { ok: false, error: 'AUDIO_VIDE' };
    try {
      const raw = await transcribeAudio(audio, config.voiceModel);
      if (!raw) return { ok: false, error: 'AUCUNE_PAROLE' };
      const router = _buildRouter(config, { webllm: webLlmBridge });
      const { text, condensed } = await condenseDictation(raw, (msgs, opts) => router.generate(msgs, opts));
      return { ok: true, text, raw, condensed };
    } catch (err) {
      return { ok: false, error: 'TRANSCRIPTION_ECHEC', detail: err.message };
    }
  });

  // Config — lecture
  ipcMain.handle(IPC.CONFIG_GET, async () => config);

  // Config — écriture
  ipcMain.handle(IPC.CONFIG_SET, async (event, updates) => {
    const prevPrimary = config.model?.primary;
    Object.assign(config, updates);
    // Changer de moteur principal annule le fournisseur secondaire choisi dans la
    // pastille : sans cela, il resterait en tête de chaîne malgré le nouveau choix
    // (les renderers renvoient l'ancien activeProvider en même temps que le primary).
    if (config.model && config.model.primary !== prevPrimary) config.model.activeProvider = null;
    // Re-décrypter les clés après merge : le renderer envoie apiKey='' (il n'a
    // jamais la clé en clair), ce qui écraserait la valeur décryptée en mémoire.
    resolveAllKeys(config);
    try {
      await saveConfig(config);
      // Broadcast aux renderers qui n'ont pas émis la mise à jour
      const sender = event?.sender;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents !== sender) {
          win.webContents.send(IPC.CONFIG_UPDATED, config);
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Fenêtre Paramètres ────────────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_OPEN, () => {
    try {
      openSettingsWindow(visibleWin);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.SETTINGS_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });

  // ── Fenêtre Don ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DONATION_OPEN, () => {
    try {
      openDonationWindow(visibleWin, visibleWin);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Fenêtre Design Studio ─────────────────────────────────────────────────
  ipcMain.handle(IPC.DESIGN_OPEN, () => {
    try {
      openDesignWindow(visibleWin);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.DESIGN_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });

  ipcMain.handle(IPC.DESIGN_READ_TOKENS, async (_, args = {}) => {
    try {
      const root  = config.projectRoot || process.cwd();
      const { readDesignTokens } = require('../harness/tools/design');
      const { makeGuard }        = require('../harness/safety/path-guard');
      const guard = makeGuard(root);
      return readDesignTokens(args, guard, root);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.DESIGN_WRITE_FILE, async (_, { path: relPath, content } = {}) => {
    try {
      const root  = config.projectRoot || process.cwd();
      const { makeGuard } = require('../harness/safety/path-guard');
      const guard = makeGuard(root);
      const abs   = guard(relPath);
      const fs    = require('fs');
      const fsPath = require('path');
      fs.mkdirSync(fsPath.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Lister les modèles disponibles pour un moteur
  ipcMain.handle(IPC.MODELS_LIST, async (_, { engine, apiKey, baseUrl }) => {
    try {
      // Le champ « clé API » de la fenêtre Paramètres reste vide quand la clé est
      // déjà enregistrée : on retombe sur la clé résolue par loadConfig, sinon
      // « Charger » échouait systématiquement.
      const saved   = config.model?.engines?.[engine] || {};
      const key     = apiKey || saved.apiKey || '';
      const url     = baseUrl || saved.baseUrl || '';
      const models  = await listModels({ engine, apiKey: key, baseUrl: url });
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Planificateur ─────────────────────────────────────────────────────────
  const { SchedulerRunner }             = require('../harness/scheduler/runner');
  const { listTasks, addTask, deleteTask, toggleTask } = require('../harness/scheduler/store');

  const _scheduler = new SchedulerRunner();

  async function _runScheduledTask(scheduledTask) {
    const root   = scheduledTask.projectRoot || config.projectRoot || process.cwd();
    const router = _buildRouter(config, { webllm: webLlmBridge });
    const abort  = new AbortController();
    try {
      const result = await runAgent({
        task:        scheduledTask.task,
        projectRoot: root,
        config: {
          ...config,
          planMode:            false,
          scheduled:           true,
          requestApproval:     null,
          requestPlanApproval: null,
          requestUserInput:    () => Promise.resolve('(tâche planifiée)'),
          notifyFn:            (title, body) => _notifyUser(title, body, visibleWin),
          _llmGenerate: (msgs, opts) => router.generate(msgs, opts),
          _signal:      abort.signal,
        },
        signal:      abort.signal,
        llmGenerate: (msgs, opts) => router.generate(msgs, opts),
        onEvent: (ev) => {
          if (!visibleWin.isDestroyed())
            _sendVisible(visibleWin, IPC.AGENT_EVENT, { ...ev, scheduledTaskId: scheduledTask.id });
        },
      });
      scheduledTask.lastRun = Date.now();
      await saveConfig(config);
      return result;
    } finally {
      router.disposeAll().catch(() => {});
    }
  }

  _scheduler.init(listTasks(config), _runScheduledTask);

  ipcMain.handle(IPC.SCHEDULE_LIST,   () => ({ ok: true, tasks: listTasks(config) }));

  ipcMain.handle(IPC.SCHEDULE_ADD, async (_, taskData) => {
    const res = addTask(config, taskData);
    if (!res.ok) return res;
    await saveConfig(config);
    _scheduler.reload(listTasks(config));
    return res;
  });

  ipcMain.handle(IPC.SCHEDULE_DELETE, async (_, { id } = {}) => {
    const res = deleteTask(config, id);
    if (!res.ok) return res;
    await saveConfig(config);
    _scheduler.reload(listTasks(config));
    return res;
  });

  ipcMain.handle(IPC.SCHEDULE_TOGGLE, async (_, { id } = {}) => {
    const res = toggleTask(config, id);
    if (!res.ok) return res;
    await saveConfig(config);
    _scheduler.reload(listTasks(config));
    return res;
  });

  ipcMain.handle(IPC.SCHEDULE_RUN, async (_, { id } = {}) => {
    const task = listTasks(config).find(t => t.id === id);
    if (!task) return { ok: false, error: 'INTROUVABLE' };
    return _scheduler.runNow(task);
  });

  // Tester une clé API
  ipcMain.handle(IPC.ENGINE_TEST, async (_, { engine: engineName, apiKey }) => {
    try {
      const { registry: reg } = require('../harness/llm/registry');
      const entry = reg[engineName];
      if (!entry) return { ok: false, error: `Moteur inconnu : ${engineName}` };
      // WebLLM n'a aucune API distante : la factory sans bridge lève
      // WEBLLM_NO_BRIDGE, donc le bouton « Tester » échouait toujours. On interroge
      // directement l'état du bridge IPC du renderer caché.
      if (engineName === 'webllm') {
        const ready = await webLlmBridge.isReady();
        if (ready) return { ok: true };
        return { ok: false, error: webLlmBridge.getError() || 'modèle local non chargé' };
      }
      const savedCfg = config.model?.engines?.[engineName] || {};
      // Clé vide → on teste la clé déjà enregistrée (champ jamais pré-rempli).
      const key = apiKey || savedCfg.apiKey || '';
      if (!key) return { ok: false, error: 'Clé API manquante' };
      const testCfg  = { ...savedCfg, apiKey: key };
      const eng = entry.factory(testCfg);
      await eng.generate([{ role: 'user', content: 'ping' }], { temperature: 0 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

/**
 * Construit un LlmRouter selon la config.
 * Chaîne : primary + fallbacks définis dans config.model.
 *
 * Un fournisseur secondaire choisi dans la pastille de modèle du composer
 * (config.model.activeProvider) passe en tête de chaîne : sans cela, le choisir
 * ne modifiait que l'affichage et l'agent continuait sur le moteur principal.
 * Ces fournisseurs n'existent pas dans le registre statique — ils sont déclarés
 * au runtime, sur le même moteur OpenAI-compatible que `openai-compat`.
 */
function _buildRouter(config, bridges = {}) {
  const activeId = config.model?.activeProvider || null;
  const provider = activeId
    ? (config.customProviders || []).find(p => p.id === activeId)
    : null;
  const usable   = provider && provider.baseUrl && provider.apiKey ? provider : null;

  let runtimeRegistry = registry;
  let engines         = config.model?.engines;
  if (usable) {
    runtimeRegistry = {
      ...registry,
      [usable.id]: {
        label:       usable.name || usable.id,
        requiresKey: true,
        offline:     false,
        cost:        'varies',
        factory:     (cfg) => new OpenAiCompatEngine(cfg),
      },
    };
    engines = { ...(config.model?.engines || {}) };
    engines[usable.id] = {
      ...(engines[usable.id] || {}),
      baseUrl: usable.baseUrl,
      apiKey:  usable.apiKey,
      model:   usable.model || engines[usable.id]?.model,
    };
  }

  const primary   = usable ? usable.id : (config.model?.primary || 'openai-compat');
  const fallbacks = config.model?.fallbacks  || [];
  const chain     = [primary, ...fallbacks.filter(f => f !== primary)];
  const routerCfg = usable ? { ...config, model: { ...config.model, engines } } : config;
  return new LlmRouter(chain, runtimeRegistry, routerCfg, bridges);
}

module.exports = { registerIpcHandlers };
