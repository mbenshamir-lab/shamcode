// Preload fenêtre visible — expose l'API harness via contextBridge.
// contextIsolation: true → aucun accès direct à Node depuis le renderer.

const { contextBridge, ipcRenderer } = require('electron');
const { IPC, APPS_IPC, PROCS_IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('harness', {
  /**
   * Lance une tâche agent.
   * @param {{ task: string, projectRoot?: string }} params
   * @returns {Promise<{ ok: boolean, result?: string, error?: string }>}
   */
  runAgent: (params) => ipcRenderer.invoke(IPC.AGENT_RUN, params),

  /** Écoute les événements de l'agent (traces, steps...) */
  onAgentEvent: (cb) => {
    ipcRenderer.on(IPC.AGENT_EVENT, (_, payload) => cb(payload));
  },

  /** Écoute les demandes d'approbation d'écriture */
  onWritePending: (cb) => {
    ipcRenderer.on(IPC.WRITE_PENDING, (_, payload) => cb(payload));
  },

  /** Envoie la décision d'approbation (accept/reject) */
  approveWrite: (params) => ipcRenderer.invoke(IPC.WRITE_DECISION, params),

  /** Écoute les demandes d'approbation de plan */
  onPlanPending: (cb) => {
    ipcRenderer.on(IPC.PLAN_PENDING, (_, payload) => cb(payload));
  },

  /** Envoie la décision d'approbation du plan */
  approvePlan: (params) => ipcRenderer.invoke(IPC.PLAN_DECISION, params),

  /** Écoute les questions de clarification de l'agent */
  onAskUserPending: (cb) => {
    ipcRenderer.on(IPC.ASK_USER_PENDING, (_, payload) => cb(payload));
  },

  /** Envoie la réponse de l'utilisateur à l'agent */
  answerUser: (params) => ipcRenderer.invoke(IPC.ASK_USER_RESPONSE, params),

  /** Écoute les changements de statut du moteur LLM */
  onLlmStatus: (cb) => {
    ipcRenderer.on(IPC.LLM_STATUS, (_, payload) => cb(payload));
  },

  getConfig:    () => ipcRenderer.invoke(IPC.CONFIG_GET),
  setConfig:    (updates) => ipcRenderer.invoke(IPC.CONFIG_SET, updates),
  openSettings:  () => ipcRenderer.invoke(IPC.SETTINGS_OPEN),
  openDesign:    () => ipcRenderer.invoke(IPC.DESIGN_OPEN),
  openDonation:  () => ipcRenderer.invoke(IPC.DONATION_OPEN),
  onDonationSuccess: (cb) => ipcRenderer.on(IPC.DONATION_SUCCESS, () => cb()),

  /** Dictée : envoie l'enregistrement, renvoie { ok, text } (texte condensé par l'IA) */
  transcribeVoice: (audio) => ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, { audio }),
  /** Progression du téléchargement du modèle vocal (premier usage) */
  onVoiceProgress: (cb) => ipcRenderer.on(IPC.VOICE_PROGRESS, (_, p) => cb(p)),
  onConfigUpdated: (cb) => ipcRenderer.on(IPC.CONFIG_UPDATED, (_, cfg) => cb(cfg)),
  testEngine:   (params)  => ipcRenderer.invoke(IPC.ENGINE_TEST, params),

  /** Liste les modèles disponibles pour un moteur (pour le combobox settings) */
  listModels: (params) => ipcRenderer.invoke(IPC.MODELS_LIST, params),

  /** Annule la tâche en cours */
  cancelAgent:  () => ipcRenderer.invoke(IPC.AGENT_CANCEL),

  /** Ouvre le sélecteur de dossier natif → renvoie le chemin ou null */
  selectFolder: () => ipcRenderer.invoke(IPC.FOLDER_DIALOG),

  /** Liste les sessions passées (résumés) */
  listSessions: () => ipcRenderer.invoke(IPC.SESSIONS_LIST),
  /** Charge le détail d'une session par son id */
  getSession:   (id) => ipcRenderer.invoke(IPC.SESSIONS_GET, { id }),
  /** Exporte une session vers un fichier JSON (dialog natif de sauvegarde) */
  exportSession: (id) => ipcRenderer.invoke(IPC.SESSIONS_EXPORT, { id }),

  // ── Applications connectées ─────────────────────────────────────────────────
  /** Enregistre manuellement une app à surveiller */
  registerApp:  (url, name) => ipcRenderer.invoke(APPS_IPC.REGISTER, { url, name }),
  /** Retire une app du panneau */
  removeApp:    (url)       => ipcRenderer.invoke(APPS_IPC.REMOVE,   { url }),
  /** Suspend le monitoring d'une app (badge gris) */
  suspendApp:   (url)       => ipcRenderer.invoke(APPS_IPC.SUSPEND,  { url }),
  /** Reprend le monitoring d'une app (re-ping immédiat) */
  resumeApp:    (url)       => ipcRenderer.invoke(APPS_IPC.RESUME,   { url }),
  /** Ping immédiat de toutes les apps */
  pingApps:     ()          => ipcRenderer.invoke(APPS_IPC.PING),
  /** Écoute les mises à jour du panneau Apps */
  onAppsUpdate: (cb)        => ipcRenderer.on(APPS_IPC.UPDATE, (_, apps) => cb(apps)),

  // ── Processus en arrière-plan ──────────────────────────────────────────────
  /** Liste les processus actuels */
  listProcesses:    ()       => ipcRenderer.invoke(PROCS_IPC.LIST),
  /** Écoute les mises à jour des processus (démarrage, sortie, arrêt) */
  onProcsUpdate:    (cb)     => ipcRenderer.on(PROCS_IPC.UPDATE, (_, procs) => cb(procs)),

  // ── Fenêtre ─────────────────────────────────────────────────────────────────
  /** Amène la fenêtre au premier plan (utile depuis un bouton "Voir résultat") */
  focusWindow:      ()       => ipcRenderer.invoke(IPC.WINDOW_FOCUS),

  // ── Lecture de fichiers du projet (visionneuse) ─────────────────────────────
  /**
   * Lit un fichier du projet (chemin relatif à la racine), en lecture seule.
   * @param {string} relPath
   */
  readProjectFile:  (relPath) => ipcRenderer.invoke(IPC.FILE_READ, { path: relPath }),

  // ── Planificateur ─────────────────────────────────────────────────────────
  scheduleList:   ()       => ipcRenderer.invoke(IPC.SCHEDULE_LIST),
  scheduleAdd:    (task)   => ipcRenderer.invoke(IPC.SCHEDULE_ADD, task),
  scheduleDelete: (id)     => ipcRenderer.invoke(IPC.SCHEDULE_DELETE, { id }),
  scheduleToggle: (id)     => ipcRenderer.invoke(IPC.SCHEDULE_TOGGLE, { id }),
  scheduleRun:    (id)     => ipcRenderer.invoke(IPC.SCHEDULE_RUN,    { id }),
});
