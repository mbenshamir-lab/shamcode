// UI principale — aucune logique métier ici.
// Communication uniquement via window.harness (exposé par preload.js).

const ERROR_MESSAGES = {
  'ANNULÉ':              { msg: 'Tâche annulée.' },
  'MAX_STEPS_ATTEINT':   { msg: 'Limite d\'étapes atteinte.', hint: 'Reformule ta tâche en sous-tâches plus courtes.' },
  'LLM_ERREUR':          { msg: 'Erreur de communication avec le LLM.', hint: 'Vérifie ta connexion et la clé API.', action: 'open-settings' },
  'FORBIDDEN':           { msg: 'Accès refusé (403).', hint: 'Clé API incorrecte ou révoquée.', action: 'open-settings' },
  'UNAUTHORIZED':        { msg: 'Clé API non autorisée (401).', hint: 'Renseigne une clé valide dans les paramètres.', action: 'open-settings' },
  'QUOTA_EXCEEDED':      { msg: 'Quota API dépassé (429).', hint: 'Attends quelques secondes ou utilise un moteur de secours.' },
  'ENOTFOUND':           { msg: 'Serveur inaccessible.', hint: 'Vérifie ta connexion Internet et l\'URL de base.', action: 'open-settings' },
  'ECONNREFUSED':        { msg: 'Connexion refusée.', hint: 'Vérifie l\'URL de base dans les paramètres.', action: 'open-settings' },
  'GUARD_VIOLATION':     { msg: 'Accès refusé : chemin hors du projet.', hint: 'L\'agent a tenté d\'accéder à un fichier hors du projet.' },
  'CLEF_API_MANQUANTE':  { msg: 'Aucune clé API configurée.', hint: 'Ouvre les paramètres pour renseigner ta clé API.', action: 'open-settings' },
};

function parseError(rawError) {
  if (!rawError) return { msg: 'Erreur inconnue.' };
  for (const [code, info] of Object.entries(ERROR_MESSAGES)) {
    if (rawError.includes(code)) return info;
  }
  const m401 = rawError.match(/401/); if (m401) return ERROR_MESSAGES['UNAUTHORIZED'];
  const m403 = rawError.match(/403/); if (m403) return ERROR_MESSAGES['FORBIDDEN'];
  const m429 = rawError.match(/429/); if (m429) return ERROR_MESSAGES['QUOTA_EXCEEDED'];
  return { msg: rawError };
}

window.addEventListener('DOMContentLoaded', async () => {
  const btnSend   = document.getElementById('btn-send');
  const btnCancel = document.getElementById('btn-cancel');
  const taskInput = document.getElementById('task-input');
  const engineLabel    = document.getElementById('engine-label');
  const engineState    = document.getElementById('engine-state');
  const engineDot      = document.getElementById('engine-dot');
  const projectLabel   = document.getElementById('project-root-label');
  const messagesEl     = document.getElementById('messages');
  const tokenCounter   = document.getElementById('token-counter');
  const ctxUsageEl     = document.getElementById('ctx-usage');

  // ── Config ───────────────────────────────────────────────────────────────
  let currentConfig  = {};
  let approvalMode   = true;
  let multiAgentMode = false;
  let _agentMode     = 'plan';    // 'plan' | 'action'
  let _tddMode       = false;     // true = cycle Red→Green→Refactor actif
  let _attachedFiles  = [];        // [{ name, content }]
  let _attachedImages = [];        // [{ name, base64, mimeType }]
  let _taskQueue      = [];        // [{ rawTask, files, images }] — tâches en attente
  let _isRunning      = false;     // vrai pendant qu'un runAgent est en cours
  let _lastUsageEngine = null;    // moteur utilisé sur le dernier step
  let _chatHistory    = [];        // [{user: string, agent: string}] — max 3 derniers échanges
  const HISTORY_MAX   = 3;
  const HISTORY_USER_MAX  = 400;   // chars max par message utilisateur injecté
  let _mcpRtOk   = 0;             // connecteurs MCP connectés dans la session courante
  let _mcpRtFail = 0;             // connecteurs MCP en échec dans la session courante
  const HISTORY_AGENT_MAX = 600;   // chars max par réponse agent injectée

  // Coût estimé $/M tokens pour les moteurs connus
  const COST_PER_M = {
    gemini:          { in: 0.10,  out: 0.40  },
    claude:          { in: 0.80,  out: 4.00  },
    deepseek:        { in: 0.14,  out: 0.28  },
    'openai-compat': null,   // dépend du proxy
    webllm:          { in: 0,     out: 0     },
  };

  // Fenêtre de contexte approximative par moteur (tokens) — sert à l'indicateur
  const CONTEXT_WINDOW = {
    gemini:          1_048_576,
    claude:            200_000,
    deepseek:          128_000,
    'openai-compat':   128_000,
    webllm:             32_768,
    default:           128_000,
  };

  function _fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function _updateTokenCounter(totalIn, totalOut, engine) {
    if (!tokenCounter) return;
    const cost = COST_PER_M[engine];
    let costStr = '';
    if (cost !== null && cost !== undefined && (totalIn + totalOut) > 0) {
      const usd = (totalIn * cost.in + totalOut * cost.out) / 1_000_000;
      if (cost.in === 0 && cost.out === 0) {
        costStr = ' · local';
      } else if (usd < 0.001) {
        costStr = ' · <$0.001';
      } else {
        costStr = ` · ~$${usd.toFixed(3)}`;
      }
    }
    const cloudIcon = (!engine || engine === 'webllm' || engine === 'unknown') ? '' : '☁ ';
    tokenCounter.textContent = `${cloudIcon}↑${_fmtTokens(totalIn)} ↓${_fmtTokens(totalOut)}${costStr}`;
    tokenCounter.classList.remove('hidden');
    tokenCounter.dataset.engine = engine || '';
  }

  /**
   * Indicateur de consommation de la mémoire contextuelle :
   * tokens envoyés à la dernière requête / fenêtre du moteur.
   */
  function _updateContextUsage(tokens, engine) {
    if (!ctxUsageEl || !tokens) return;
    const used  = Math.max(0, Math.round(tokens));
    const win   = CONTEXT_WINDOW[engine] || CONTEXT_WINDOW.default;
    const pct   = Math.min(100, Math.round((used / win) * 100));
    const level = pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
    ctxUsageEl.textContent = `ctx ${pct}%`;
    ctxUsageEl.title = `Mémoire contextuelle : ≈ ${used} / ${win} tokens (${pct}%) — fenêtre du moteur`;
    ctxUsageEl.className = `ctx-usage ${level}`;
  }

  function _resetContextUsage() {
    if (!ctxUsageEl) return;
    ctxUsageEl.classList.add('hidden');
    ctxUsageEl.textContent = '';
    ctxUsageEl.title = '';
  }

  // ── Mode Plan / Action ───────────────────────────────────────────────────
  const btnModePlan   = document.getElementById('btn-mode-plan');
  const btnModeAction = document.getElementById('btn-mode-action');

  function _setMode(mode) {
    _agentMode = mode;
    btnModePlan.classList.toggle('mode-btn-active', mode === 'plan');
    btnModeAction.classList.toggle('mode-btn-active', mode === 'action');
    // feedback visuel sur le footer
    document.getElementById('input-area').dataset.mode = mode;
    // En mode Action l'agent exécute sans validation → le toggle est neutralisé
    _refreshApprovalToggle();
  }
  btnModePlan.addEventListener('click',   () => _setMode('plan'));
  btnModeAction.addEventListener('click', () => _setMode('action'));

  // ── Toggle TDD ────────────────────────────────────────────────────────────
  const btnTddToggle  = document.getElementById('btn-tdd-toggle');
  const tddToggleLabel = document.getElementById('tdd-toggle-label');

  const TDD_LABELS = { red: '🔴 RED', green: '🟢 GREEN', refactor: '🔵 REFACTOR' };

  function _setTddMode(on) {
    _tddMode = on;
    btnTddToggle.classList.toggle('tdd-on',  on);
    btnTddToggle.classList.toggle('tdd-off', !on);
    if (!on) {
      btnTddToggle.removeAttribute('data-phase');
      tddToggleLabel.textContent = 'TDD';
    }
  }

  function _updateTddPhase(phase) {
    if (!_tddMode) return;
    btnTddToggle.dataset.phase = phase;
    tddToggleLabel.textContent = TDD_LABELS[phase] || 'TDD';
  }

  btnTddToggle.addEventListener('click', () => _setTddMode(!_tddMode));

  // ── Toggle approbation des écritures ─────────────────────────────────────
  const btnApprovalToggle    = document.getElementById('btn-approval-toggle');
  const approvalToggleLabel  = document.getElementById('approval-toggle-label');
  const _lockSvg  = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>`;
  const _lockOpenSvg = `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M11 1a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5V3a3 3 0 0 1 6 0v4a.5.5 0 0 1-1 0V3a2 2 0 0 0-2-2z"/></svg>`;

  /** Le contrôle de validation ne s'applique qu'au mode Plan. */
  function _approvalApplies() {
    return _agentMode === 'plan';
  }

  /**
   * Valeur réellement transmise au harness.
   * Mode Action = l'agent est pleinement autorisé : jamais de validation.
   */
  function _effectiveApprovalMode() {
    return _approvalApplies() ? approvalMode : false;
  }

  function _refreshApprovalToggle() {
    const applies = _approvalApplies();
    // Neutralisé en mode Action — le réglage ne concerne que le mode Plan
    btnApprovalToggle.disabled = !applies;
    if (approvalMode) {
      btnApprovalToggle.className = 'btn-approval-toggle approval-on';
      btnApprovalToggle.title = applies
        ? 'Validation activée — cliquer pour désactiver (auto-appliquer)'
        : 'Mode Action : l\'agent écrit sans validation — le contrôle s\'applique au mode Plan';
      btnApprovalToggle.innerHTML = _lockSvg + '<span id="approval-toggle-label">Validation</span>';
    } else {
      btnApprovalToggle.className = 'btn-approval-toggle approval-off';
      btnApprovalToggle.title = applies
        ? 'Auto-apply activé — cliquer pour réactiver la validation'
        : 'Mode Action : l\'agent écrit sans validation — le contrôle s\'applique au mode Plan';
      btnApprovalToggle.innerHTML = _lockOpenSvg + '<span id="approval-toggle-label">Auto-apply</span>';
    }
    btnApprovalToggle.classList.toggle('approval-neutral', !applies);
  }

  btnApprovalToggle.addEventListener('click', async () => {
    if (!_approvalApplies()) return; // neutralisé en mode Action
    approvalMode = !approvalMode;
    // Garder le snapshot local aligné — sinon _refreshStatusBar réapplique l'ancienne valeur
    currentConfig = { ...currentConfig, approvalMode };
    _refreshApprovalToggle();
    // Synchroniser avec la config persistée
    const cfgEl = document.getElementById('cfg-approval-mode');
    if (cfgEl) cfgEl.checked = approvalMode;
    await window.harness.setConfig({ approvalMode });
  });

  _setMode('action'); // Mode action par défaut — l'agent est pleinement autorisé

  // ── Personas ──────────────────────────────────────────────────────────────
  const personaSelect = document.getElementById('persona-select');

  function _setPersona(id) {
    personaSelect.value = id;
    window.harness.setConfig({ activePersona: id }).catch(() => {});
  }

  personaSelect.addEventListener('change', () => _setPersona(personaSelect.value));

  // ── Dictée vocale ─────────────────────────────────────────────────────────
  // Clic 1 : enregistre. Clic 2 : arrête → Whisper transcrit → l'IA condense →
  // le texte est inséré dans le champ (jamais envoyé automatiquement).
  const btnMic = document.getElementById('btn-mic');
  let _micRecorder = null;
  let _micStream   = null;
  let _micChunks   = [];
  let _micModelNoticeShown = false;

  function _micSetState(state) {
    btnMic.classList.toggle('mic-recording',  state === 'recording');
    btnMic.classList.toggle('mic-processing', state === 'processing');
    btnMic.disabled = state === 'processing';
    btnMic.title = state === 'recording'  ? 'Arrêter et transcrire'
                 : state === 'processing' ? 'Transcription en cours…'
                 : 'Dicter (cliquer pour parler)';
  }

  function _micRefreshVisibility(cfg) {
    btnMic.classList.toggle('hidden', !cfg?.voiceEnabled);
  }

  function _insertAtCursor(text) {
    const start  = taskInput.selectionStart ?? taskInput.value.length;
    const end    = taskInput.selectionEnd ?? start;
    const before = taskInput.value.slice(0, start);
    const sep    = before && !/\s$/.test(before) ? ' ' : '';
    taskInput.value = before + sep + text + taskInput.value.slice(end);
    const pos = (before + sep + text).length;
    taskInput.setSelectionRange(pos, pos);
    taskInput.dispatchEvent(new Event('input'));
    taskInput.focus();
  }

  function _voiceErrorMessage(res) {
    if (res?.error === 'AUCUNE_PAROLE') return '🎤 Aucune parole détectée — réessaie en parlant plus près du micro.';
    if (res?.error === 'VOICE_DISABLED') return '🎤 La dictée est désactivée (Paramètres → Agent).';
    return `🎤 Transcription impossible${res?.detail ? ' : ' + res.detail : '.'}`;
  }

  async function _micFinish() {
    _micStream?.getTracks().forEach(t => t.stop());
    _micStream = null;
    const blob = new Blob(_micChunks, { type: _micRecorder?.mimeType || 'audio/webm' });
    _micChunks = [];
    _micSetState('processing');
    try {
      const res = await window.harness.transcribeVoice(await blob.arrayBuffer());
      if (res?.ok) _insertAtCursor(res.text);
      else _appendSystemMessage(_voiceErrorMessage(res));
    } catch (err) {
      _appendSystemMessage(`🎤 Dictée impossible : ${err.message}`);
    } finally {
      _micSetState('idle');
    }
  }

  async function _micToggle() {
    if (_micRecorder && _micRecorder.state === 'recording') { _micRecorder.stop(); return; }
    try {
      _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      _appendSystemMessage('🎤 Micro inaccessible — autorise l\'accès au micro (Windows → Confidentialité → Microphone).');
      return;
    }
    _micChunks = [];
    _micRecorder = new MediaRecorder(_micStream);
    _micRecorder.ondataavailable = (e) => { if (e.data.size) _micChunks.push(e.data); };
    _micRecorder.onstop = _micFinish;
    _micRecorder.start();
    _micSetState('recording');
  }

  btnMic.addEventListener('click', _micToggle);

  window.harness.onVoiceProgress((p) => {
    if (!_micModelNoticeShown && p?.status === 'initiate') {
      _micModelNoticeShown = true;
      _appendSystemMessage('⬇ Téléchargement du modèle vocal (première dictée uniquement, ~75 Mo)…');
    }
    if (p?.status === 'progress_total' && typeof p.progress === 'number') {
      btnMic.title = `Téléchargement du modèle vocal… ${Math.round(p.progress)} %`;
    }
  });

  // ── Attachement fichiers ─────────────────────────────────────────────────
  const btnAttach   = document.getElementById('btn-attach');
  const fileInput   = document.getElementById('file-input');
  const attachChips = document.getElementById('attach-chips');

  btnAttach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) {
      try {
        if (file.type.startsWith('image/')) {
          const base64 = await _fileToBase64(file);
          _attachedImages.push({ name: file.name, base64, mimeType: file.type });
          _renderImageChip(file.name);
        } else {
          const content = await file.text();
          _attachedFiles.push({ name: file.name, content });
          _renderAttachChip(file.name);
        }
      } catch { /* fichier illisible ignoré */ }
    }
    fileInput.value = '';
  });

  // Coller une image depuis le presse-papier (Ctrl+V dans la zone de saisie)
  document.getElementById('task-input')?.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      try {
        const base64 = await _fileToBase64(file);
        const name = `image-${Date.now()}.${item.type.split('/')[1] || 'png'}`;
        _attachedImages.push({ name, base64, mimeType: item.type });
        _renderImageChip(name);
      } catch { /* ignoré */ }
    }
  });

  /** Lit un File et retourne son contenu en base64 pur (sans préfixe data:...). */
  function _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function _renderImageChip(name) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip attach-chip-image';
    chip.dataset.name = name;
    chip.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/></svg>
      <span>${name}</span>
      <button class="attach-chip-remove" title="Retirer">✕</button>`;
    chip.querySelector('.attach-chip-remove').addEventListener('click', () => {
      _attachedImages = _attachedImages.filter(i => i.name !== name);
      chip.remove();
    });
    attachChips.appendChild(chip);
  }

  function _renderAttachChip(name) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    chip.dataset.name = name;
    chip.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg>
      <span>${name}</span>
      <button class="attach-chip-remove" title="Retirer">✕</button>`;
    chip.querySelector('.attach-chip-remove').addEventListener('click', () => {
      _attachedFiles = _attachedFiles.filter(f => f.name !== name);
      chip.remove();
    });
    attachChips.appendChild(chip);
  }

  function _buildTaskWithAttachments(task) {
    if (_attachedFiles.length === 0) return task;
    const ctx = _attachedFiles.map(f =>
      `=== Fichier joint : ${f.name} ===\n${f.content}\n===`
    ).join('\n\n');
    return `${task}\n\nFICHIERS JOINTS PAR L'UTILISATEUR :\n${ctx}`;
  }

  function _trunc(s, max) {
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  // Injecte les derniers échanges comme contexte de conversation
  function _buildTaskWithContext(task) {
    if (_chatHistory.length === 0) return task;
    const lines = _chatHistory.map((h, i) => {
      const u = _trunc(h.user, HISTORY_USER_MAX);
      const a = _trunc(h.agent, HISTORY_AGENT_MAX);
      return `Échange ${i + 1} :\n  Utilisateur : ${u}\n  Agent : ${a}`;
    }).join('\n');
    return `CONTEXTE DES ÉCHANGES PRÉCÉDENTS (pour référence uniquement) :\n${lines}\n\nTÂCHE ACTUELLE :\n${task}`;
  }

  // Contexte de la session précédente (même projet) — évite de refaire le tour du
  // propriétaire au second tour : le modèle sait ce qui a déjà été lu et modifié.
  function _buildPreviousSessionContext(session) {
    if (!session || !Array.isArray(session.steps) || session.steps.length === 0) return '';
    const mods = [];
    const reads = new Set();
    for (const s of session.steps) {
      if (!s || !s.result || s.result.ok !== true || !s.args || !s.args.path) continue;
      if (s.tool === 'write_file' || s.tool === 'replace_code' || s.tool === 'delete_file' || s.tool === 'move_file') {
        if (mods.indexOf(s.args.path) === -1) mods.push(s.args.path);
      }
      if (s.tool === 'read_file') reads.add(s.args.path);
    }
    if (mods.length === 0 && reads.size === 0) return '';

    const lines = ['ÉTAT DE LA SESSION PRÉCÉDENTE (même projet — ne pas tout relire) :'];
    const summary = session.result && session.result.summary ? String(session.result.summary) : '';
    if (summary) lines.push(`- dernier résultat : ${summary.slice(0, 200).replace(/\s+/g, ' ')}`);
    if (mods.length) {
      const shown = mods.slice(0, 5).join(', ');
      lines.push(`- fichiers modifiés : ${shown}${mods.length > 5 ? ` (+${mods.length - 5})` : ''}`);
    }
    if (reads.size) lines.push(`- fichiers déjà lus : ${reads.size}`);

    const text = lines.join('\n');
    return text.length > 700 ? `${text.slice(0, 700)}…` : text;
  }

  // Récupère la dernière session terminée du projet et en extrait son état.
  async function _previousSessionContext(projectRoot) {
    if (!projectRoot || !window.harness || !window.harness.listSessions) return '';
    try {
      const sessions = await window.harness.listSessions();
      const match = (sessions || [])
        .filter(s => s && s.projectRoot === projectRoot && s.result)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      if (!match) return '';
      const full = await window.harness.getSession(match.id);
      return _buildPreviousSessionContext(full);
    } catch {
      return '';
    }
  }

  function _clearAttachments() {
    _attachedFiles  = [];
    _attachedImages = [];
    attachChips.innerHTML = '';
  }

  // ── Sidebar sessions — déclarées ici pour éviter TDZ lors de l'init ────────
  const sidebarSessions = document.getElementById('sidebar-sessions');
  let _allSessions = [];

  function _renderSessionList(sessions) {
    sidebarSessions.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      sidebarSessions.innerHTML = '<div class="sidebar-empty">Aucun workspace</div>';
      return;
    }

    // Grouper par projectRoot → un workspace = une ligne
    const groups = new Map();
    for (const s of sessions) {
      const key = s.projectRoot || '__none__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    // Trier les workspaces par session la plus récente en tête
    const sorted = [...groups.entries()].sort((a, b) => {
      const aMax = Math.max(...a[1].map(s => new Date(s.createdAt)));
      const bMax = Math.max(...b[1].map(s => new Date(s.createdAt)));
      return bMax - aMax;
    });

    for (const [root, groupSessions] of sorted) {
      const folderName = root === '__none__'
        ? 'Sans projet'
        : root.split(/[\\/]/).filter(Boolean).pop() || root;

      // Sessions triées du plus récent au plus ancien
      groupSessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const collapseKey = `ws-grp-${root}`;
      let isOpen = false;
      try { isOpen = sessionStorage.getItem(collapseKey) === '1'; } catch {}

      // En-tête workspace
      const header = document.createElement('div');
      header.className = 'ws-item' + (isOpen ? ' ws-open' : '');
      header.title = root === '__none__' ? '' : root;
      header.innerHTML = `
        <svg class="ws-item-chevron" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
        </svg>
        <svg class="ws-item-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a2 2 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707z"/>
        </svg>
        <span class="ws-item-name">${_escHtml(folderName)}</span>
        <span class="ws-item-count">${groupSessions.length}</span>`;

      // Corps avec les sessions
      const body = document.createElement('div');
      body.className = 'ws-body' + (isOpen ? '' : ' hidden');

      for (const s of groupSessions) {
        const ok   = s.result?.ok !== false;
        const date = new Date(s.createdAt).toLocaleString('fr-FR', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const sItem = document.createElement('div');
        sItem.className = `sidebar-item ${ok ? 'ok' : 'fail'}`;
        sItem.title = s.task || '(sans tâche)';
        sItem.innerHTML = `
          <div class="sidebar-item-task">${_escHtml(s.task || '(sans tâche)')}</div>
          <div class="sidebar-item-meta">${date}</div>`;
        sItem.addEventListener('click', () => _resumeSession(s));
        body.appendChild(sItem);
      }

      header.addEventListener('click', () => {
        const nowOpen = header.classList.toggle('ws-open');
        body.classList.toggle('hidden', !nowOpen);
        try { sessionStorage.setItem(collapseKey, nowOpen ? '1' : '0'); } catch {}
      });

      sidebarSessions.appendChild(header);
      sidebarSessions.appendChild(body);
    }
  }

  async function _loadSidebarSessions() {
    try {
      const sessions = await window.harness.listSessions();
      _allSessions = (sessions || []).slice().sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      _renderSessionList(_allSessions);
    } catch (err) {
      console.error('[sessions] erreur chargement:', err);
    }
  }

  // ── Model pill ──────────────────────────────────────────────────────────────
  // Déclaré AVANT le bloc d'initialisation : _refreshStatusBar() appelle
  // _updateModelPill() de façon synchrone, et une const déclarée plus bas
  // provoquait un ReferenceError (zone morte temporelle) qui annulait toute
  // l'application de la config (thème, accent, police, densité, sessions).
  const modelPill         = document.getElementById('model-pill');
  const modelPillLabel    = document.getElementById('model-pill-label');
  const modelChipIcon     = document.getElementById('model-chip-icon');
  const modelChipProvider = document.getElementById('model-chip-provider');
  const modelDropdown     = document.getElementById('model-dropdown');
  const modelDropdownList = document.getElementById('model-dropdown-list');
  const modelDropdownRefresh = document.getElementById('model-dropdown-refresh');
  const modelDropdownFilter  = document.getElementById('model-dropdown-filter');
  const modelDropdownCount   = document.getElementById('model-dropdown-count');

  const _ENGINE_ICONS   = { webllm: '⬡', cpu: '▣' };
  const _ENGINE_LABELS  = { webllm: 'WebLLM', cpu: 'CPU', gemini: 'Gemini', claude: 'Anthropic', 'openai-compat': 'API' };

  // Fournisseur secondaire réellement actif (choisi dans la pastille de modèle).
  // `activeProvider` est l'id d'une entrée de config.customProviders ; il n'est
  // retenu que si le fournisseur est complet, sinon on retombe sur le moteur
  // principal — même règle que _buildRouter côté main.
  function _activeProviderOf(cfg) {
    const id = cfg?.model?.activeProvider;
    if (!id) return null;
    return (cfg?.customProviders || []).find(p => p.id === id && p.baseUrl && p.apiKey) || null;
  }

  function _updateModelPill(cfg) {
    if (!modelPillLabel) return;
    const primary   = cfg?.model?.primary || 'openai-compat';
    const engineCfg = cfg?.model?.engines?.[primary] || {};
    const active    = _activeProviderOf(cfg);
    const model     = active
      ? (active.model || cfg?.model?.engines?.[active.id]?.model || '—')
      : (engineCfg.model || '—');
    const icon      = active ? '⚡' : (_ENGINE_ICONS[primary] || '⚡');
    const provider  = active ? (active.name || 'Secondaire') : (_ENGINE_LABELS[primary] || primary);
    const name      = model.split(':')[0]; // retire suffixe :free, :pro…
    if (modelChipIcon)     modelChipIcon.textContent     = icon;
    if (modelChipProvider) modelChipProvider.textContent = provider;
    modelPillLabel.textContent = name;
  }

  try {
    currentConfig = await window.harness.getConfig();
    approvalMode   = currentConfig?.approvalMode   ?? true;
    multiAgentMode = currentConfig?.multiAgentMode ?? false;
    _refreshApprovalToggle();
    _refreshStatusBar(currentConfig);
    _applyVisualSettings(currentConfig);
    _micRefreshVisibility(currentConfig);
    if (currentConfig.activePersona) _setPersona(currentConfig.activePersona);
    _loadSidebarSessions();
  } catch (err) {
    // Un échec ici bloquait silencieusement TOUTE l'application de la config
    // (thème, accent, police, densité, sessions) sans laisser de trace.
    console.error('[config] échec de l\'initialisation:', err);
    engineState.textContent = 'Erreur config';
    engineDot.className = 'engine-dot error';
  }

  function _refreshStatusBar(cfg) {
    const primary   = cfg?.model?.primary || 'openai-compat';
    const engineCfg = cfg?.model?.engines?.[primary] || {};
    const active    = _activeProviderOf(cfg);
    const model     = active ? (active.model || primary) : (engineCfg.model || primary);
    engineLabel.textContent = model;
    const hasKey = active ? !!active.apiKey : !!(engineCfg.apiKey || engineCfg.apiKeyEncrypted);
    engineState.textContent = hasKey ? 'Prêt' : 'Clé manquante';
    engineDot.className = 'engine-dot ' + (hasKey ? 'ready' : 'error');
    const root = cfg?.projectRoot || '';
    projectLabel.textContent = root ? _shortPath(root) : 'Aucun projet';
    projectLabel.title = root || 'Aucun dossier configuré';
    approvalMode   = cfg?.approvalMode   ?? true;
    multiAgentMode = cfg?.multiAgentMode ?? false;
    _refreshApprovalToggle();
    // Badge Shell dans la sidebar
    const badgeShell = document.getElementById('badge-shell');
    if (badgeShell) {
      const shellOn = !!(cfg?.enableShell);
      badgeShell.textContent = shellOn ? 'Activé' : 'Désactivé';
      badgeShell.className   = 'snav-conn-badge' + (shellOn ? ' snav-conn-on' : '');
    }
    const badgeDeploy = document.getElementById('badge-deploy');
    if (badgeDeploy) {
      const deployOn = !!(cfg?.enableDeploy);
      badgeDeploy.textContent = deployOn ? 'Activé' : 'Désactivé';
      badgeDeploy.className   = 'snav-conn-badge' + (deployOn ? ' snav-conn-on' : '');
    }
    // Badge MCP dans la sidebar
    const badgeMcp = document.getElementById('badge-mcp');
    if (badgeMcp) {
      const mcpCount = (cfg?.connectors || []).filter(c => c.enabled).length;
      badgeMcp.textContent = mcpCount > 0 ? `${mcpCount} actif${mcpCount > 1 ? 's' : ''}` : '—';
      badgeMcp.className   = 'snav-conn-badge' + (mcpCount > 0 ? ' snav-conn-on' : '');
    }
    // Pill modèle dans le footer
    _updateModelPill(cfg);
    // Profil bas de sidebar
    const profileEngine = document.getElementById('profile-engine');
    if (profileEngine) profileEngine.textContent = (active ? (active.name || active.id) : primary) + ' · ' + (hasKey ? 'Connecté' : 'Non configuré');
  }

  // ── Model pill (déclarations remontées avant l'initialisation) ──────────────

  modelPill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !modelDropdown.classList.contains('hidden');
    if (isOpen) { _closeModelDropdown(); return; }
    _openModelDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!modelDropdown.classList.contains('hidden') && !modelPill.parentElement.contains(e.target)) {
      _closeModelDropdown();
    }
  });

  function _closeModelDropdown() {
    modelDropdown.classList.add('hidden');
    modelPill.classList.remove('open');
    modelDropdownFilter.value = '';
    // Si l'utilisateur ferme sans choisir, restaurer l'affichage du modèle courant
    _updateModelPill(currentConfig);
  }

  async function _openModelDropdown() {
    modelDropdown.classList.remove('hidden');
    modelPill.classList.add('open');
    // Effacer le chip pour inviter à choisir
    if (modelChipIcon)     modelChipIcon.textContent     = '○';
    if (modelChipProvider) modelChipProvider.textContent = 'Choisir';
    modelPillLabel.textContent = '—';
    // Vider le filtre et recharger la liste sans pré-sélection
    modelDropdownFilter.value = '';
    modelDropdownList.innerHTML = '';
    await _loadModelsIntoPill();
    modelDropdownFilter.focus();
  }

  async function _loadModelsIntoPill(force = false) {
    const primary   = currentConfig?.model?.primary || 'openai-compat';
    const engineCfg = currentConfig?.model?.engines?.[primary] || {};
    const secondary = (currentConfig?.customProviders || []).filter(p => p.apiKey && p.baseUrl);

    // Cache mémorisé (sauf si force=true, déclenché par ↻)
    if (!force && Array.isArray(engineCfg.availableModels) && engineCfg.availableModels.length) {
      _renderModelGroups(primary, engineCfg.availableModels, secondary);
      return;
    }

    // Appel API live avec la vraie clé
    modelDropdownList.innerHTML = '<div class="model-dropdown-loading">Chargement…</div>';
    try {
      const apiKey  = engineCfg.apiKey || '';
      const baseUrl = engineCfg.baseUrl || '';
      const res = await window.harness.listModels({ engine: primary, apiKey, baseUrl });
      if (!res.ok) throw new Error(res.error);
      const models = res.models;
      // Mémorise la liste fraîche
      const updated = {
        ...currentConfig,
        model: {
          ...currentConfig.model,
          engines: {
            ...currentConfig.model?.engines,
            [primary]: { ...engineCfg, availableModels: models },
          },
        },
      };
      await window.harness.setConfig(updated);
      currentConfig = updated;
      _renderModelGroups(primary, models, secondary);
    } catch (err) {
      modelDropdownList.innerHTML = `<div class="model-dropdown-empty">✗ ${err.message}<br><small>Ouvre Paramètres → Modèle → Charger pour mémoriser la liste.</small></div>`;
    }
  }

  function _makeModelItem(id, onSelect) {
    const item = document.createElement('button');
    item.className = 'model-dropdown-item';
    item.textContent = id;
    item.addEventListener('click', onSelect);
    item.addEventListener('keydown', e => {
      const visible = () => Array.from(modelDropdownList.querySelectorAll('.model-dropdown-item'))
        .filter(el => el.style.display !== 'none');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const list = visible(); const idx = list.indexOf(item);
        if (idx < list.length - 1) list[idx + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const list = visible(); const idx = list.indexOf(item);
        if (idx > 0) list[idx - 1].focus(); else modelDropdownFilter.focus();
      } else if (e.key === 'Escape') {
        _closeModelDropdown();
      }
    });
    return item;
  }

  function _renderModelGroups(primaryEngine, primaryModels, secondaryProviders) {
    modelDropdownList.innerHTML = '';
    const hasSecondary = (secondaryProviders || []).some(p => p.availableModels?.length);
    let totalCount = primaryModels.length;

    const activeprimary = currentConfig?.model?.engines?.[primaryEngine]?.model;
    const activeProv    = currentConfig?.model?.activeProvider || null;

    if (hasSecondary) {
      const h = document.createElement('div');
      h.className = 'model-dropdown-group-header';
      h.textContent = `LLM — ${primaryEngine}`;
      modelDropdownList.appendChild(h);
    }
    primaryModels.forEach(id => {
      const item = _makeModelItem(id, async () => {
        const pe = currentConfig?.model?.primary || 'openai-compat';
        // Choisir un modèle du moteur principal désactive le fournisseur secondaire.
        const updated = { ...currentConfig, model: { ...currentConfig.model, activeProvider: null, engines: { ...currentConfig.model?.engines, [pe]: { ...currentConfig.model?.engines?.[pe], model: id } } } };
        await window.harness.setConfig(updated);
        currentConfig = updated;
        _refreshStatusBar(currentConfig);
        _closeModelDropdown();
      });
      if (id === activeprimary && !activeProv) item.classList.add('selected');
      modelDropdownList.appendChild(item);
    });

    (secondaryProviders || []).forEach(prov => {
      if (!prov.availableModels?.length) return;
      totalCount += prov.availableModels.length;
      const h = document.createElement('div');
      h.className = 'model-dropdown-group-header';
      h.textContent = prov.name;
      modelDropdownList.appendChild(h);
      const activeSec = activeProv === prov.id ? prov.model : null;
      prov.availableModels.forEach(id => {
        const item = _makeModelItem(id, async () => {
          const providers = (currentConfig.customProviders || []).map(p => p.id === prov.id ? { ...p, model: id } : p);
          // activeProvider : le moteur choisi passe réellement en tête de chaîne
          // (avant, seule la pastille changeait et l'agent restait sur le principal).
          const updated = { ...currentConfig, customProviders: providers, model: { ...currentConfig.model, activeProvider: prov.id } };
          await window.harness.setConfig(updated);
          currentConfig = updated;
          _refreshStatusBar(currentConfig);
          _closeModelDropdown();
        });
        if (id === activeSec) item.classList.add('selected');
        modelDropdownList.appendChild(item);
      });
    });

    if (modelDropdownCount) modelDropdownCount.textContent = `${totalCount} modèle${totalCount > 1 ? 's' : ''}`;
    if (!totalCount) modelDropdownList.innerHTML = '<div class="model-dropdown-empty">Aucun modèle disponible — chargez depuis Paramètres → Modèle ↻</div>';
  }

  // Compat : appelé depuis les anciens chemins
  function _renderModelList(models) {
    const primary = currentConfig?.model?.primary || 'openai-compat';
    _renderModelGroups(primary, models, currentConfig?.customProviders || []);
  }


  modelDropdownRefresh.addEventListener('click', async (e) => {
    e.stopPropagation();
    modelDropdownList.innerHTML = '';
    modelDropdownFilter.value = '';
    await _loadModelsIntoPill(true); // force = bypass cache
    modelDropdownFilter.focus();
  });

  // Filtre en temps réel sur la liste de modèles
  modelDropdownFilter.addEventListener('input', () => {
    const q = modelDropdownFilter.value.toLowerCase();
    Array.from(modelDropdownList.querySelectorAll('.model-dropdown-item')).forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  // Navigation clavier depuis le champ filtre
  modelDropdownFilter.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = modelDropdownList.querySelector('.model-dropdown-item:not([style*="display: none"])');
      first?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = modelDropdownList.querySelector('.model-dropdown-item:not([style*="display: none"])');
      first?.click();
    } else if (e.key === 'Escape') {
      _closeModelDropdown();
    }
  });
  // Empêche le clic sur le champ filtre de fermer le dropdown
  modelDropdownFilter.addEventListener('click', e => e.stopPropagation());

  function _shortPath(p) {
    const parts = p.replace(/\\/g, '/').split('/');
    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
  }

  // ── Chat ToDo — variables d'état (déclarées tôt, utilisées partout) ─────────
  let _chatTodoEl      = null;
  let _chatTodoItems   = [];
  let _chatTodoStepIdx = 0;
  let _chatTodoHead    = null;
  let _chatTodoCountEl = null;
  let _chatTodoObjective = '';
  let _lastToolIntent  = '';   // intention du dernier outil (briefing du plan)

  // ── Plan actif épinglé au-dessus de la zone de saisie ──────────────────────
  const activePlanEl   = document.getElementById('active-plan');
  const apObjectiveEl  = document.querySelector('#active-plan .ap-objective');
  const apProgressEl   = document.querySelector('#active-plan .ap-progress');
  const apStepsEl      = document.querySelector('#active-plan .ap-steps');
  let   _activePlan    = null;
  let   _apItems       = [];   // <li> des étapes affichées dans le bandeau

  // ── Task Panel (4 cadres à 1/4 de hauteur, un seul déplié) ─────────────────
  const _tp = {
    panel:     document.getElementById('task-panel'),
    title:     document.getElementById('task-panel-title'),
    idle:      document.getElementById('tp-idle'),
    progress:  document.getElementById('tp-progress'),
    progressPct: document.getElementById('tp-progress-pct'),
    progressFill: document.getElementById('tp-progress-fill'),
    progressCounts: document.getElementById('tp-progress-counts'),
    objective: document.getElementById('tp-objective'),
    objText:   document.getElementById('tp-objective-text'),
    todos:     document.getElementById('tp-todos'),
    todosList: document.getElementById('tp-todos-list'),
    execution: document.getElementById('tp-execution'),
    execList:  document.getElementById('tp-exec-list'),
    execEmpty: document.getElementById('tp-exec-empty'),
    btnClear:  document.getElementById('btn-task-panel-clear'),
  };
  let _tpSteps = []; // { label, status: 'pending'|'running'|'done'|'error' }

  function _tpShow(el)  { el?.classList.remove('tp-section-hidden'); }
  function _tpHide(el)  { el?.classList.add('tp-section-hidden'); }

  /**
   * Tendance globale de l'exécution du plan : % + répartition des tâches.
   * @param {number} done  tâches terminées
   * @param {number} total tâches du plan
   */
  function _tpRenderProgress(done, total) {
    if (!_tp.progress) return;
    _tpShow(_tp.progress);
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (_tp.progressPct) _tp.progressPct.textContent = `${pct} %`;
    if (_tp.progressFill) {
      _tp.progressFill.style.width = `${pct}%`;
      _tp.progressFill.classList.toggle('tp-progress-done', total > 0 && done >= total);
    }
    if (_tp.progressCounts) {
      const active = done < total ? 1 : 0;
      const pending = Math.max(0, total - done - active);
      _tp.progressCounts.textContent =
        `${done} faite${done > 1 ? 's' : ''} · ${active} en cours · ${pending} restante${pending > 1 ? 's' : ''}`;
    }
  }

  /** Synchronise le cadre Plan avec l'avancement réel (toDo du chat). */
  function _tpSyncPlanProgress() {
    const total = _chatTodoItems.length;
    const done  = Math.min(_chatTodoStepIdx, total);
    _tpRenderProgress(done, total);
    const list = _tp.todosList?.querySelectorAll('.tp-todo-item');
    if (!list?.length) return;
    list.forEach((li, i) => {
      li.className = 'tp-todo-item ' + (i < done ? 'done' : i === done ? 'active' : 'pending');
    });
  }

  function _tpReset() {
    _tpSteps = [];
    _tp.title.textContent = 'Tâches';
    // Panneaux plan : masquer progression/objectif/todos, montrer idle
    _tpHide(_tp.progress); _tpHide(_tp.objective); _tpHide(_tp.todos);
    _tp.objText.textContent = '';
    _tp.todosList.innerHTML = '';
    if (_tp.progressPct) _tp.progressPct.textContent = '0 %';
    if (_tp.progressFill) _tp.progressFill.style.width = '0%';
    if (_tp.progressCounts) _tp.progressCounts.textContent = '';
    _tp.idle.style.display = 'flex';
    // Panneau exécution : vider la liste, montrer l'état vide
    _tp.execList.innerHTML = '';
    if (_tp.execEmpty) _tp.execEmpty.classList.remove('hidden');
    // Réinitialiser le todo du chat
    _chatTodoEl    = null;
    _chatTodoItems = [];
    _chatTodoStepIdx = 0;
  }

  // ── Cadres du Task Panel : 1/4 de hauteur, un seul déplié à la fois ──────
  const _tpPanels = {
    apps:  { el: document.getElementById('apps-panel'),     header: document.querySelector('#apps-panel .ca-header') },
    procs: { el: document.getElementById('procs-panel'),    header: document.querySelector('#procs-panel .pr-header') },
    plan:  { el: document.getElementById('tp-plan-panel'),  header: document.querySelector('#tp-plan-panel .tp-panel-header') },
    exec:  { el: document.getElementById('tp-exec-panel'),  header: document.querySelector('#tp-exec-panel .tp-panel-header') },
  };

  function _tpAnyExpanded() {
    return Object.values(_tpPanels).some(p => p.el?.classList.contains('tp-panel-expanded'));
  }

  /**
   * Ouvre un cadre (hauteur plafonnée à 1/4, les autres restent en en-tête) ;
   * un second clic sur le cadre ouvert replie tout.
   * Un seul cadre peut être ouvert : c'est l'utilisateur qui choisit.
   */
  function _tpToggleExpanded(key) {
    const target = _tpPanels[key]?.el;
    if (!target) return;
    const wasExpanded = target.classList.contains('tp-panel-expanded');
    Object.entries(_tpPanels).forEach(([k, { el }]) => {
      if (!el) return;
      if (wasExpanded) {                        // second clic → tout replié
        el.classList.remove('tp-panel-expanded');
        el.classList.add('tp-panel-collapsed');
        return;
      }
      const open = k === key;
      el.classList.toggle('tp-panel-expanded', open);
      el.classList.toggle('tp-panel-collapsed', !open);
    });
  }

  function _tpCollapse(key)  { _tpPanels[key]?.el?.classList.add('tp-panel-collapsed'); }
  // Reveal sans voler le choix de l'utilisateur : si un cadre est déjà ouvert, on n'y touche pas.
  function _tpExpand(key) {
    if (_tpAnyExpanded()) return;
    _tpPanels[key]?.el?.classList.remove('tp-panel-collapsed');
  }

  Object.entries(_tpPanels).forEach(([key, { el, header }]) => {
    if (!el || !header) return;
    // Au démarrage, les 4 cadres sont repliés (en-têtes seuls) — état posé dans index.html
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // ignorer les boutons internes
      _tpToggleExpanded(key);
    });
  });

  function _tpSetPlan(plan) {
    _tpExpand('plan');
    _tp.idle.style.display = 'none';
    if (plan.objective) {
      _tp.objText.textContent = plan.objective;
      _tpShow(_tp.objective);
    }
    if (plan.steps?.length) {
      _tp.todosList.innerHTML = '';
      plan.steps.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = 'tp-todo-item pending';
        li.dataset.idx = i;
        li.textContent = s;
        li.title = s;                      // étape complète au survol
        _tp.todosList.appendChild(li);
      });
      _tpShow(_tp.todos);
    }
    // Tendance globale remise à zéro pour ce nouveau plan
    _tpRenderProgress(0, plan.steps?.length || 0);
    _tp.title.textContent = plan.objective ? _shortStr(plan.objective, 22) : 'Tâches';
  }

  function _tpAddExecStep(label, status = 'running') {
    _tpExpand('exec');
    // Masquer l'état vide dès qu'on ajoute un item
    if (_tp.execEmpty) _tp.execEmpty.classList.add('hidden');
    // Marquer la précédente running comme done
    const prev = _tp.execList.querySelector('.tp-exec-item.running');
    if (prev) prev.className = 'tp-exec-item done';
    const item = document.createElement('div');
    item.className = `tp-exec-item ${status}`;
    item.innerHTML = `<span class="tp-exec-icon"></span><span class="tp-exec-label">${_escHtml(label)}</span>`;
    _tp.execList.appendChild(item);
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _tpFinish(ok) {
    const running = _tp.execList.querySelector('.tp-exec-item.running');
    if (running) running.className = 'tp-exec-item ' + (ok ? 'done' : 'error');
    _tp.todosList.querySelectorAll('.tp-todo-item.pending').forEach(li => li.classList.replace('pending','done'));
    const active = _tp.todosList.querySelectorAll('.tp-todo-item.active');
    active.forEach(li => li.classList.replace('active', ok ? 'done' : 'pending'));
    // Tendance finale : 100 % si succès
    if (ok && _tp.todosList.childElementCount > 0) {
      _tpRenderProgress(_tp.todosList.childElementCount, _tp.todosList.childElementCount);
    }
  }

  function _shortStr(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

  _tp.btnClear.addEventListener('click', _tpReset);
  _tpReset();

  // ── Resize panels ──────────────────────────────────────────────────────────
  function _initResizeHandle(handleEl, targetEl, { min, max, fromRight = false }) {
    let startX, startW;
    handleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = targetEl.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const delta = fromRight ? startX - e.clientX : e.clientX - startX;
        targetEl.style.width = Math.max(min, Math.min(max, startW + delta)) + 'px';
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  const sidebarEl   = document.getElementById('sidebar');
  const taskPanelEl = document.getElementById('task-panel');
  const resizeSidebar = document.getElementById('resize-sidebar');
  const resizeTask    = document.getElementById('resize-task');
  if (resizeSidebar && sidebarEl)   _initResizeHandle(resizeSidebar, sidebarEl,   { min: 160, max: 420 });
  if (resizeTask    && taskPanelEl) _initResizeHandle(resizeTask,    taskPanelEl, { min: 180, max: 480, fromRight: true });

  // ── État de repli des colonnes (sidebar + task panel) ────────────────────
  // Aligne la visibilité des poignées sur la classe de repli de chaque colonne.
  function _syncCollapseHandles() {
    if (resizeSidebar && sidebarEl) {
      resizeSidebar.style.display = sidebarEl.classList.contains('sidebar-collapsed') ? 'none' : '';
    }
    if (resizeTask && taskPanelEl) {
      resizeTask.style.display = taskPanelEl.classList.contains('tp-collapsed') ? 'none' : '';
    }
  }

  // ── Toggle task panel ────────────────────────────────────────────────────
  const btnTpToggle = document.getElementById('btn-tp-toggle');
  if (btnTpToggle && taskPanelEl) {
    btnTpToggle.addEventListener('click', () => {
      taskPanelEl.classList.toggle('tp-collapsed');
      _syncCollapseHandles();
    });
  }

  // Au démarrage, les deux colonnes sont repliées.
  if (sidebarEl)   sidebarEl.classList.add('sidebar-collapsed');
  if (taskPanelEl) taskPanelEl.classList.add('tp-collapsed');
  _syncCollapseHandles();

  // ── Streaming LLM (smart — affiche uniquement le message finish) ─────────
  let _streamDiv     = null;
  let _streamBuf     = '';      // accumulateur brut de tokens LLM
  let _streamInMsg   = false;   // on est en train d'extraire args.summary
  let _streamMsgOff  = -1;      // offset dans _streamBuf où commence la valeur summary

  // Extrait le texte visible du message finish depuis un buffer brut de tokens LLM.
  // Retourne null si le buffer ne contient pas encore un appel finish avec summary.
  function _extractFinishMessage(buf) {
    if (!/"finish"/.test(buf)) return null;
    const m = buf.match(/"summary"\s*:\s*"/);
    if (!m) return null;
    const raw = buf.slice(m.index + m[0].length);
    const endMatch = raw.match(/(?<!\\)"/);
    const visible = endMatch ? raw.slice(0, endMatch.index) : raw;
    return visible
      .replace(/\\n/g,  '\n')
      .replace(/\\t/g,  '\t')
      .replace(/\\"/g,  '"')
      .replace(/\\\\/g, '\\');
  }

  function _appendStreamToken(token) {
    _streamBuf += token;

    if (!_streamInMsg) {
      if (/"summary"\s*:\s*"/.test(_streamBuf) && /"finish"/.test(_streamBuf)) {
        const m = _streamBuf.match(/"summary"\s*:\s*"/);
        if (m) { _streamInMsg = true; _streamMsgOff = m.index + m[0].length; }
      }
    }

    if (_streamInMsg && _streamMsgOff >= 0) {
      const raw = _streamBuf.slice(_streamMsgOff);
      const endMatch = raw.match(/(?<!\\)"/);
      const visible = endMatch ? raw.slice(0, endMatch.index) : raw;
      const decoded = visible
        .replace(/\\n/g,  '\n')
        .replace(/\\t/g,  '\t')
        .replace(/\\"/g,  '"')
        .replace(/\\\\/g, '\\');

      if (decoded) {
        if (!_streamDiv) {
          _clearWelcome();
          _streamDiv = document.createElement('div');
          _streamDiv.className = 'message message-streaming';
          messagesEl.appendChild(_streamDiv);
        }
        _streamDiv.textContent = decoded;
        _streamDiv.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  function _clearStreamDiv() {
    if (_streamDiv) { _streamDiv.remove(); _streamDiv = null; }
    _streamBuf    = '';
    _streamInMsg  = false;
    _streamMsgOff = -1;
  }

  // ── Événements agent ──────────────────────────────────────────────────────
  try {
    window.harness.onAgentEvent((event) => {
      if (event.type === 'llm_token') {
        _appendStreamToken(event.token);
      } else if (event.type === 'thinking') {
        // L'agent réfléchit : animation dédiée tant que le LLM génère
        _activityThinking();
      } else if (event.type === 'context_usage') {
        // Consommation de la mémoire contextuelle (estimation du prompt envoyé)
        _updateContextUsage(event.estimatedTokens, _lastUsageEngine || currentConfig?.model?.primary);
      } else if (event.type === 'tool_call') {
        // Ne pas effacer la div finish — le message stream doit rester visible
        if (event.tool !== 'finish') _clearStreamDiv();
        _lastToolIntent = event.intent || '';
        _activityStep(event.tool, event.args, event.intent);
        _tpAddExecStep(_toolLabel(event.tool, event.args));
        _advanceChatTodo(true);
      } else if (event.type === 'parse_error') {
        _clearStreamDiv();
        _activityParseRetry();
      } else if (event.type === 'tool_result' && event.result && !event.result.ok) {
        _activityError(event.result.error);
        _tpAddExecStep(event.result.error?.slice(0, 40) || 'Erreur', 'error');
      } else if (event.type === 'note_user') {
        _appendNoteUser(event.message, event.level || 'info');
      } else if (event.type === 'plan_ready') {
        _clearStreamDiv();
        _tpSetPlan(event.plan);
        // Briefing : le plan plié dans le chat + bandeau épinglé au-dessus de la saisie
        _appendChatTodo(event.plan, _lastToolIntent);
        _planPinShow(event.plan);
      } else if (event.type === 'collaboration_enabled') {
        _clearStreamDiv();
        _appendCollaborationBanner();
      } else if (event.type === 'bus_message') {
        _stripPush('bus', event);
      } else if (event.type === 'orchestration_start') {
        _clearStreamDiv();
        _appendOrchestrationCard(event);
      } else if (event.type === 'orchestration_phase_start') {
        _orchPhaseStart(event);
      } else if (event.type === 'orchestration_phase_done') {
        _orchPhaseDone(event);
      } else if (event.type === 'orchestration_done') {
        _orchDone(event);
      } else if (event.type === 'sub_agent_start') {
        // Vue orchestrée : la ligne de phase remplace la carte individuelle
        if (_orchState) _orchAgentTick(event.phase);
        else { _clearStreamDiv(); _appendSubAgentCard(event); }
      } else if (event.type === 'sub_agent_event') {
        if (!_orchState) _updateSubAgentCard(event);
      } else if (event.type === 'sub_agent_done') {
        if (!_orchState) _finalizeSubAgentCard(event);
      } else if (event.type === 'write_preview') {
        _stripPush('writes', event);
      } else if (event.type === 'mcp_status') {
        if (event.msg?.includes('connecté :')) _mcpRtOk++;
        else if (event.msg?.includes('échec')) _mcpRtFail++;
        _updateMcpBadge(_mcpRtOk, _mcpRtFail);
      } else if (event.type === 'finish') {
        _tpFinish(true);
        _finalizeChatTodo(true);
        _planPinHide();
        _stripCloseAll(true);
        _mcpRtOk = 0; _mcpRtFail = 0; _updateMcpBadge(0, 0);
        if (_tddMode) _updateTddPhase('refactor');
      } else if (event.type === 'tdd_phase') {
        _updateTddPhase(event.phase);
      } else if (event.type === 'cancelled') {
        _clearStreamDiv();
        _orchCancel();
        _activityCancel();
        _tpFinish(false);
        _finalizeChatTodo(false);
        _planPinHide();
        _stripCloseAll(false);
        _mcpRtOk = 0; _mcpRtFail = 0; _updateMcpBadge(0, 0);
      } else if (event.type === 'agents_missing') {
        _appendAgentsMissingHint();
      } else if (event.type === 'llm_usage') {
        _lastUsageEngine = event.engine || 'unknown';
        _updateTokenCounter(event.totalIn, event.totalOut, event.engine);
        // Si le moteur remonte l'usage réel, il fait foi pour la mémoire contextuelle
        if (event.inputTokens) _updateContextUsage(event.inputTokens, event.engine);
      }
      // session_start, context_ready, agents_loaded → silencieux
    });
  } catch { /* indisponible */ }

  // ── Approbation d'écriture ────────────────────────────────────────────────
  try {
    window.harness.onWritePending((event) => {
      _clearStreamDiv();
      _appendApprovalCard(event);
    });
  } catch { /* indisponible */ }

  // ── Question de clarification de l'agent ─────────────────────────────────
  try {
    window.harness.onAskUserPending((event) => {
      _clearStreamDiv();
      _appendAskUserCard(event);
    });
  } catch { /* indisponible */ }

  // ── Approbation de plan ───────────────────────────────────────────────────
  try {
    window.harness.onPlanPending((event) => {
      _clearStreamDiv();
      _appendPlanCard(event, event.id);
      _tpSetPlan(event);
    });
  } catch { /* indisponible */ }

  // ── Statut WebLLM ─────────────────────────────────────────────────────────
  try {
    window.harness.onLlmStatus((payload) => {
      if (payload.type === 'progress') {
        const pct = Math.round((payload.progress || 0) * 100);
        engineLabel.textContent = `WebLLM ${pct}%`;
        engineState.textContent = payload.text?.slice(0, 30) || 'Chargement…';
        engineDot.className = 'engine-dot busy';
      } else if (payload.ready) {
        engineLabel.textContent = payload.model || 'WebLLM';
        engineState.textContent = 'Prêt (local)';
        engineDot.className = 'engine-dot ready';
      } else if (payload.ready === false) {
        engineState.textContent = payload.error ? `WebLLM : ${payload.error.slice(0, 60)}` : 'WebLLM indisponible';
        engineDot.className = 'engine-dot error';
      }
    });
  } catch { /* ignoré */ }

  // ── Envoi tâche ───────────────────────────────────────────────────────────
  btnSend.addEventListener('click', () => sendTask());
  btnCancel.addEventListener('click', async () => {
    try { await window.harness.cancelAgent(); } catch { /* ignoré */ }
  });

  let _lastSentTask = ''; // pour Arrow Up

  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendTask();
      return;
    }
    // Arrow Up dans un textarea vide → rappelle la dernière tâche envoyée
    if (e.key === 'ArrowUp' && taskInput.value === '' && _lastSentTask) {
      e.preventDefault();
      taskInput.value = _lastSentTask;
      taskInput.dispatchEvent(new Event('input')); // auto-resize
      taskInput.setSelectionRange(taskInput.value.length, taskInput.value.length);
      return;
    }
    // Escape → annule la tâche en cours (si en loading)
    if (e.key === 'Escape' && btnCancel && !btnCancel.disabled) {
      btnCancel.click();
      return;
    }
  });

  // Ctrl+L (ou Cmd+L) → efface le chat (uniquement si pas de tâche en cours)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && btnSend && !btnSend.disabled) {
      e.preventDefault();
      messagesEl.innerHTML = '';
      _chatHistory = [];
      _updateContextBadge();
    }
  });

  // Auto-resize textarea
  taskInput.addEventListener('input', () => {
    taskInput.style.height = 'auto';
    taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
    _updatePromptExamples();
  });

  // ── Exemples rapides vidéo / image ────────────────────────────────────────
  const _promptExamplesEl = document.getElementById('prompt-examples');

  function _renderPromptExamples() {
    if (!_promptExamplesEl) return;
    _promptExamplesEl.innerHTML = '';
    const videoEx = Array.isArray(currentConfig?.videoPromptExamples) ? currentConfig.videoPromptExamples : [];
    const imageEx = Array.isArray(currentConfig?.imagePromptExamples) ? currentConfig.imagePromptExamples : [];
    if (!videoEx.length && !imageEx.length) return;

    function _addGroup(label, items, cssClass) {
      if (!items.length) return;
      const group = document.createElement('div');
      group.className = 'pe-group';
      const heading = document.createElement('span');
      heading.className = 'pe-group-label';
      heading.textContent = label;
      group.appendChild(heading);
      items.forEach(text => {
        const chip = document.createElement('button');
        chip.className = `pe-chip ${cssClass}`;
        chip.type = 'button';
        chip.title = text;
        chip.textContent = text.length > 55 ? text.slice(0, 52) + '…' : text;
        chip.addEventListener('mousedown', (e) => {
          e.preventDefault();
          taskInput.value = text;
          taskInput.dispatchEvent(new Event('input'));
          taskInput.focus();
          _promptExamplesEl.classList.add('hidden');
        });
        group.appendChild(chip);
      });
      _promptExamplesEl.appendChild(group);
    }

    _addGroup('Vidéo', videoEx, 'pe-chip-video');
    _addGroup('Image', imageEx, 'pe-chip-image');
  }

  function _updatePromptExamples() {
    if (!_promptExamplesEl) return;
    const empty = taskInput.value.trim() === '';
    _promptExamplesEl.classList.toggle('hidden', !empty);
  }

  taskInput.addEventListener('focus', () => {
    _renderPromptExamples();
    _updatePromptExamples();
  });
  taskInput.addEventListener('blur', () => {
    setTimeout(() => _promptExamplesEl?.classList.add('hidden'), 150);
  });

  // ── Popup commandes slash ─────────────────────────────────────────────────
  const slashMenu = document.getElementById('slash-menu');

  // action: fn → exécution directe (pas d'envoi au LLM)
  // pas d'action → remplit le textarea et attend la saisie
  function _slashFill(text) {
    taskInput.value = text;
    taskInput.dispatchEvent(new Event('input'));
    taskInput.focus();
  }

  const SLASH_COMMANDS = [
    // ── Modèle ────────────────────────────────────────────────────────────────
    { group: 'Modèle',
      cmd: '/modele',        label: 'Changer de modèle',          hint: 'ouvre le sélecteur',
      icon: '🤖',
      action: () => document.getElementById('model-pill')?.click() },

    // ── Mode agent ────────────────────────────────────────────────────────────
    { group: 'Mode',
      cmd: '/plan',          label: 'Passer en mode Plan',         hint: 'lecture et analyse uniquement',
      icon: '👁',
      action: () => document.getElementById('btn-mode-plan')?.click() },
    { group: 'Mode',
      cmd: '/action',        label: 'Passer en mode Action',       hint: 'écriture et exécution activées',
      icon: '⚡',
      action: () => document.getElementById('btn-mode-action')?.click() },
    { group: 'Mode',
      cmd: '/tdd',           label: 'Activer / couper le mode TDD', hint: 'test d\'abord, puis implémentation',
      icon: '🧪',
      action: () => btnTddToggle.click() },
    { group: 'Mode',
      cmd: '/validation',    label: 'Activer / couper la validation', hint: 'écritures à approuver (mode Plan)',
      icon: '🔒',
      action: () => {
        if (btnApprovalToggle.disabled) {
          _appendSystemMessage('ℹ La validation des écritures ne s\'applique qu\'en mode Plan (`/plan`).');
          return;
        }
        btnApprovalToggle.click();
      } },
    { group: 'Mode',
      cmd: '/stop',          label: 'Arrêter l\'agent',            hint: 'annule la tâche en cours',
      icon: '⏹',
      action: () => { if (!btnCancel.disabled) btnCancel.click(); } },

    // ── Rôles ─────────────────────────────────────────────────────────────────
    { group: 'Rôle',
      cmd: '/role',          label: 'Changer de rôle',             hint: 'ouvre le sélecteur de rôle',
      icon: '🎭',
      action: () => { personaSelect.focus(); personaSelect.showPicker?.(); } },
    { group: 'Rôle',
      cmd: '/review',        label: 'Revue de code',               hint: 'rôle Reviewer + relecture du diff',
      icon: '👁',
      action: () => {
        _setPersona('reviewer');
        taskInput.value = 'Relis mes changements (git diff) et donne un verdict.';
        taskInput.dispatchEvent(new Event('input'));
        taskInput.focus();
      } },
    { group: 'Rôle',
      cmd: '/audit',         label: 'Audit de sécurité',           hint: 'rôle Sécurité + cible à auditer',
      icon: '🔒',
      action: () => {
        _setPersona('securite');
        taskInput.value = 'Audite la sécurité de : ';
        taskInput.dispatchEvent(new Event('input'));
        taskInput.focus();
      } },

    // ── Design & projet ───────────────────────────────────────────────────────
    { group: 'Design & projet',
      cmd: '/palette',       label: 'Générer une palette WCAG',    hint: 'ex. #3B82F6',
      icon: '🎨',
      action: () => _slashFill('Génère une palette WCAG à partir de la couleur : ') },
    { group: 'Design & projet',
      cmd: '/tokens',        label: 'Lister les tokens CSS',       hint: 'couleurs, typo, espacements du projet',
      icon: '🧩',
      action: () => _slashFill('Liste les tokens de design (CSS/SCSS/JS) du projet.') },
    { group: 'Design & projet',
      cmd: '/note',          label: 'Mémoriser une note de projet', hint: 'convention, décision, endpoint…',
      icon: '📝',
      action: () => _slashFill('Mémorise cette note de projet : ') },
    { group: 'Design & projet',
      cmd: '/impact',        label: 'Impact d\'un fichier',        hint: 'qui l\'importe, ce qu\'il importe',
      icon: '🕸',
      action: () => _slashFill('Quels fichiers sont impactés si je modifie : ') },

    // ── Recherche & exécution ─────────────────────────────────────────────────
    { group: 'Recherche & exécution',
      cmd: '/web',           label: 'Recherche web',               hint: 'documentation, CVE…',
      icon: '🌐',
      action: () => _slashFill('Recherche sur le web : ') },
    { group: 'Recherche & exécution',
      cmd: '/tests',         label: 'Lancer les tests',            hint: 'et analyser les échecs',
      icon: '✅',
      action: () => _slashFill('Lance les tests du projet et analyse les échecs.') },
    { group: 'Recherche & exécution',
      cmd: '/commit',        label: 'Commit des changements',      hint: 'si l\'écriture Git est activée',
      icon: '📦',
      action: () => _slashFill('Fais un commit des changements avec un message clair.') },

    // ── Médias ────────────────────────────────────────────────────────────────
    { group: 'Médias',
      cmd: '/image',         label: 'Générer une image',           hint: 'décris l\'image',
      icon: '🖼',
      action: () => _slashFill('Génère une image : ') },
    { group: 'Médias',
      cmd: '/video',         label: 'Générer une vidéo',           hint: 'décris la scène',
      icon: '🎬',
      action: () => _slashFill('Génère une vidéo : ') },
    { group: 'Médias',
      cmd: '/voix',          label: 'Générer une voix',            hint: 'texte à lire à voix haute',
      icon: '🔊',
      action: () => _slashFill('Génère un fichier audio qui lit ce texte : ') },

    // ── Règles ────────────────────────────────────────────────────────────────
    { group: 'Règles & Skills',
      cmd: '/add_rule',      label: 'Ajouter une règle',           hint: 'retiens que… / à partir de maintenant…',
      icon: '📌' },
    { group: 'Règles & Skills',
      cmd: '/delete_rule',   label: 'Supprimer une règle',         hint: 'oublie… / supprime la règle…',
      icon: '🗑' },
    { group: 'Règles & Skills',
      cmd: '/install_skill', label: 'Installer un skill',          hint: 'crée un skill… / ajoute un module…',
      icon: '🔧' },
    { group: 'Règles & Skills',
      cmd: '/remove_skill',  label: 'Désinstaller un skill',       hint: 'désinstalle le skill…',
      icon: '✂' },

    // ── Interface ─────────────────────────────────────────────────────────────
    { group: 'Interface',
      cmd: '/dicter',        label: 'Dicter au micro',             hint: 'transcrit puis résume dans le champ',
      icon: '🎤',
      action: () => {
        if (btnMic.classList.contains('hidden')) {
          _appendSystemMessage('🎤 Active d\'abord la dictée vocale : Paramètres → Agent → Dictée vocale.');
          return;
        }
        btnMic.click();
      } },
    { group: 'Interface',
      cmd: '/joindre',       label: 'Joindre un fichier ou une image', hint: 'ouvre le sélecteur de fichiers',
      icon: '📎',
      action: () => document.getElementById('btn-attach')?.click() },
    { group: 'Interface',
      cmd: '/planifier',     label: 'Ouvrir le Planificateur',     hint: 'tâches récurrentes',
      icon: '⏰',
      action: () => document.getElementById('btn-nav-scheduler')?.click() },
    { group: 'Interface',
      cmd: '/recherche',     label: 'Chercher dans les sessions',  hint: 'filtre la liste des sessions',
      icon: '🔍',
      action: () => document.getElementById('btn-search-session')?.click() },
    { group: 'Interface',
      cmd: '/design',        label: 'Ouvrir le Design Studio',     hint: 'palettes, contraste, tokens',
      icon: '🎨',
      action: _openDesign },
    { group: 'Interface',
      cmd: '/parametres',    label: 'Ouvrir les paramètres',       hint: 'moteur, thème, dossier…',
      icon: '⚙',
      action: () => _openSettings() },
    { group: 'Interface',
      cmd: '/effacer',       label: 'Effacer le chat',             hint: 'vide l\'historique visible',
      icon: '🧹',
      action: () => {
        messagesEl.innerHTML = '';
        _chatHistory = [];
        _updateContextBadge();
        taskInput.focus();
      } },
  ];
  let _slashActiveIdx = 0;

  function _slashVisible() { return !slashMenu.classList.contains('hidden'); }

  function _slashShow(filtered) {
    if (!filtered.length) { _slashHide(); return; }

    // Construire HTML avec séparateurs de groupe
    let html = '';
    let lastGroup = null;
    filtered.forEach((c, i) => {
      if (c.group !== lastGroup) {
        html += `<div class="slash-group-label">${c.group}</div>`;
        lastGroup = c.group;
      }
      const badge = c.action ? '<span class="slash-item-badge">Direct</span>' : '';
      html += `<div class="slash-item${i === _slashActiveIdx ? ' slash-active' : ''}" data-idx="${i}">
        <span class="slash-item-icon">${c.icon || ''}</span>
        <span class="slash-item-cmd">${c.cmd}</span>
        <span class="slash-item-desc">${c.label}</span>
        ${badge}
        <span class="slash-item-hint">${c.hint}</span>
      </div>`;
    });

    slashMenu.innerHTML = html;
    slashMenu.classList.remove('hidden');
    slashMenu.querySelectorAll('.slash-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        _slashSelect(filtered[+el.dataset.idx]);
      });
    });
  }

  function _slashHide() {
    slashMenu.classList.add('hidden');
    slashMenu.innerHTML = '';
    _slashActiveIdx = 0;
  }

  function _slashSelect(cmd) {
    _slashHide();
    if (typeof cmd.action === 'function') {
      // Commande directe : vide le champ et exécute
      taskInput.value = '';
      taskInput.dispatchEvent(new Event('input'));
      cmd.action();
    } else {
      // Commande LLM : remplit le champ pour complétion
      taskInput.value = cmd.cmd + ' ';
      taskInput.dispatchEvent(new Event('input'));
      taskInput.focus();
    }
  }

  function _slashUpdate() {
    const val = taskInput.value;
    if (!val.startsWith('/')) { _slashHide(); return; }
    const query = val.slice(1).toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(query));
    _slashActiveIdx = Math.min(_slashActiveIdx, Math.max(filtered.length - 1, 0));
    _slashShow(filtered);
  }

  taskInput.addEventListener('input', _slashUpdate);

  taskInput.addEventListener('keydown', (e) => {
    if (!_slashVisible()) return;
    const val = taskInput.value;
    const query = val.startsWith('/') ? val.slice(1).toLowerCase() : '';
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(query));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _slashActiveIdx = (_slashActiveIdx + 1) % filtered.length;
      _slashShow(filtered);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _slashActiveIdx = (_slashActiveIdx - 1 + filtered.length) % filtered.length;
      _slashShow(filtered);
    } else if (e.key === 'Tab' || (e.key === 'Enter' && filtered.length)) {
      if (filtered.length) { e.preventDefault(); _slashSelect(filtered[_slashActiveIdx]); }
    } else if (e.key === 'Escape') {
      _slashHide();
    }
  }, true); // capture phase : avant le handler "Enter → sendTask"

  taskInput.addEventListener('blur', () => {
    setTimeout(_slashHide, 120);
  });

  async function sendTask() {
    const rawTask = taskInput.value.trim();
    if (!rawTask) return;
    _lastSentTask = rawTask; // mémoriser pour Arrow Up

    // Si un agent tourne déjà, empiler dans la queue et informer l'utilisateur
    if (_isRunning) {
      const queuedFiles  = [..._attachedFiles];
      const queuedImages = [..._attachedImages];
      _taskQueue.push({ rawTask, files: queuedFiles, images: queuedImages });
      _clearAttachments();
      taskInput.value = '';
      taskInput.style.height = 'auto';
      _appendSystemMessage(`⏳ Tâche mise en file d'attente (${_taskQueue.length} en attente) : « ${rawTask.slice(0, 80)}… »`);
      return;
    }

    _isRunning = true;
    _mcpRtOk = 0; _mcpRtFail = 0;
    const taskWithFiles   = _buildTaskWithAttachments(rawTask);
    let   task            = _buildTaskWithContext(taskWithFiles);
    _clearWelcome();
    _tpReset();
    // Réinitialiser le compteur de tokens pour la nouvelle session
    tokenCounter.classList.add('hidden');
    tokenCounter.textContent = '';
    tokenCounter.dataset.engine = '';
    _lastUsageEngine = null;
    _resetContextUsage();
    // Afficher le message utilisateur (sans le contenu des fichiers joints pour lisibilité)
    const attachSuffix = _attachedFiles.length
      ? ` *(${_attachedFiles.length} fichier${_attachedFiles.length > 1 ? 's' : ''} joint${_attachedFiles.length > 1 ? 's' : ''})*`
      : '';
    _appendUserMessage(rawTask + attachSuffix);
    _clearAttachments();
    taskInput.value = '';
    taskInput.style.height = 'auto';
    setLoading(true);

    const projectRoot = currentConfig?.projectRoot || undefined;
    const planMode    = _agentMode === 'plan';
    // Mode Action = pleine autorisation : aucune validation demandée pour les écritures
    const approvalForRun = _effectiveApprovalMode();
    _stripCloseAll(false); // filet : aucun bandeau « en cours » hérité d'un run précédent
    _planPinHide();        // idem pour le plan épinglé
    _orchReset();          // idem pour la carte d'orchestration repliée

    // Le second tour sur un même projet repart de ce que la session précédente a fait
    // (fichiers lus/modifiés, dernier résultat) — sans bloquer le démarrage du run.
    const prevContext = await _previousSessionContext(projectRoot);
    if (prevContext) task = `${prevContext}\n\n${task}`;
    let taskOk = false;
    try {
      const images = _attachedImages.length > 0 ? _attachedImages.map(({ name, base64, mimeType }) => ({ name, base64, mimeType })) : undefined;
      if (_tddMode) _updateTddPhase('red');
      const response = await window.harness.runAgent({ task, projectRoot, approvalMode: approvalForRun, multiAgentMode, planMode, tddMode: _tddMode, images });
      taskOk = !!response.ok;
      _clearStreamDiv();
      _closeActivityBlock(response.ok ? 'done' : 'done');
      if (response.ok) {
        const agentSummary = response.summary || '(tâche terminée)';
        _appendAgentMessage(agentSummary, response.trace);
        // Enregistrer l'échange pour le contexte multi-tour
        _chatHistory.push({ user: rawTask, agent: agentSummary });
        if (_chatHistory.length > HISTORY_MAX) _chatHistory.shift();
        _updateContextBadge();
      } else {
        appendErrorMessage(response.error || 'Erreur inconnue');
      }
    } catch (err) {
      _clearStreamDiv();
      _closeActivityBlock('done');
      appendErrorMessage(err.message || 'Erreur réseau inattendue');
    } finally {
      setLoading(false);
      _planPinHide();
      _stripCloseAll(taskOk);
      _loadSidebarSessions();
      _isRunning = false;
      // Dépiler la prochaine tâche si la queue n'est pas vide
      if (_taskQueue.length > 0) {
        const next = _taskQueue.shift();
        _attachedFiles  = next.files;
        _attachedImages = next.images;
        taskInput.value = next.rawTask;
        // Rendre les chips visuels pour les fichiers/images de la prochaine tâche
        if (_taskQueue.length > 0) {
          _appendSystemMessage(`▶ Démarrage de la prochaine tâche en file (${_taskQueue.length} restante${_taskQueue.length > 1 ? 's' : ''}).`);
        }
        setTimeout(() => sendTask(), 100);
      }
    }
  }

  // Affiche un badge discret indiquant combien d'échanges sont en contexte
  function _updateContextBadge() {
    let badge = document.getElementById('ctx-badge');
    if (_chatHistory.length === 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'ctx-badge';
      badge.title = 'Échanges en contexte — cliquer pour effacer';
      badge.addEventListener('click', () => { _chatHistory = []; _updateContextBadge(); });
      const row = document.querySelector('.persona-row');
      if (row) row.prepend(badge);
      else {
        const footer = document.getElementById('input-area');
        if (footer) footer.prepend(badge);
      }
    }
    badge.textContent = `↺ ${_chatHistory.length} en mémoire`;
  }

  function setLoading(loading) {
    btnSend.disabled   = loading;
    btnCancel.disabled = !loading;
    if (loading) {
      engineDot.className = 'engine-dot busy';
      engineState.textContent = 'En cours…';
    } else {
      _refreshStatusBar(currentConfig);
    }
  }

  // ── Helpers de rendu ──────────────────────────────────────────────────────
  function _clearWelcome() {
    const wc = messagesEl.querySelector('.welcome-card');
    if (wc) wc.remove();
  }

  function _argsStr(args) {
    if (!args) return '';
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }

  // Notification légère : fichier AGENTS.md absent (une seule fois par session)
  let _agentsHintShown = false;
  function _appendAgentsMissingHint() {
    if (_agentsHintShown) return;
    _agentsHintShown = true;
    const hint = document.createElement('div');
    hint.className = 'sham-hint';
    hint.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>
      <span>Pas de <strong>AGENTS.md</strong> — l'agent le créera automatiquement à la fin de la prochaine tâche.</span>`;
    messagesEl.appendChild(hint);
    hint.scrollIntoView({ behavior: 'smooth' });
    // Se ferme automatiquement après 5 secondes
    setTimeout(() => hint.remove(), 5000);
  }

  function _appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message message-user';
    div.style.whiteSpace = 'pre-wrap';
    div.textContent = text;
    messagesEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  // Coloration syntaxique légère — tokenise sans dépendance externe
  function _highlight(code, lang) {
    // Ordre : strings d'abord (évite de tokeniser leur contenu), puis autres
    const rules = [
      // Strings (simple et double quotes, backticks)
      [/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, '<span class="hl-str">$1</span>'],
      // Commentaires ligne
      [/(\/\/[^\n]*|#[^\n]*)/g, '<span class="hl-cmt">$1</span>'],
      // Commentaires bloc
      [/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-cmt">$1</span>'],
      // Nombres
      [/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>'],
      // Mots-clés JS/TS/Python/Go/Rust communs
      [/\b(function|const|let|var|class|return|if|else|for|while|switch|case|break|continue|import|export|from|default|async|await|try|catch|finally|new|delete|typeof|instanceof|void|null|undefined|true|false|def|pass|yield|lambda|with|as|in|not|and|or|is|elif|except|raise|import|from|package|func|type|interface|struct|map|chan|go|defer|select|fallthrough|pub|fn|mut|impl|use|mod|match|enum|trait|self|super|where|let|ref|move|static|unsafe)\b/g,
        '<span class="hl-kw">$1</span>'],
    ];
    let out = code;
    for (const [re, tpl] of rules) {
      out = out.replace(re, tpl);
    }
    return out;
  }

  // ── Fichiers du projet évoqués dans le chat → liens colorés et cliquables ──
  const _FILE_EXT = 'js|ts|jsx|tsx|py|go|rs|java|cs|rb|php|html|css|scss|json|yml|yaml|md|txt|sh|bat|toml|xml|csv|env|ini|cfg|sql|vue|svelte|lock';
  const _FILE_LINK_RE = new RegExp(
    `(?<![\\w/.\\-])((?:[\\w.\\-]+[\\\\/])*[\\w.\\-]+\\.(?:${_FILE_EXT}))(?::(\\d+))?`,
    'g',
  );

  /** Transforme les chemins de fichiers d'un fragment de texte en liens cliquables. */
  function _linkifyText(text) {
    return String(text).replace(_FILE_LINK_RE, (match, filePath, line) => {
      const pathAttr = _escAttr(filePath);
      const lineAttr = line ? ` data-line="${_escAttr(line)}"` : '';
      const label    = line ? `${filePath}:${line}` : filePath;
      return `<button class="file-link" data-path="${pathAttr}"${lineAttr} title="Ouvrir ${pathAttr}">${label}</button>`;
    });
  }

  /** Applique la détection de fichiers hors des balises HTML et des blocs de code. */
  function _linkifyFiles(html) {
    return String(html)
      .split(/(<pre[\s\S]*?<\/pre>)/)          // blocs de code : intacts
      .map(part => {
        if (part.startsWith('<pre')) return part;
        return part
          .split(/(<[^>]+>)/)                  // balises : intactes
          .map(seg => (seg.startsWith('<') ? seg : _linkifyText(seg)))
          .join('');
      })
      .join('');
  }

  /**
   * Courbe SVG inline depuis des valeurs numériques (une par ligne ou séparées par des espaces).
   * Retourne '' si aucune valeur exploitable — l'appelant retombe alors sur un bloc de code.
   */
  function _sparkline(code) {
    const values = String(code || '')
      .split(/[\s,;]+/)
      .map(v => Number.parseFloat(v))
      .filter(v => Number.isFinite(v));
    if (values.length < 2) return '';

    const W = 260, H = 48, PAD = 3;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = (W - PAD * 2) / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const last = values[values.length - 1];
    return (
      `<div class="sparkline">` +
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" ` +
      `aria-label="Courbe de ${values.length} valeurs, de ${min} à ${max}">` +
      `<polyline points="${pts.join(' ')}" />` +
      `</svg>` +
      `<span class="sparkline-last">${last}</span>` +
      `</div>`
    );
  }

  // Rendu Markdown léger — sans dépendance externe
  function _renderMarkdown(text) {
    // Escape HTML pour éviter XSS sur les parties non-code
    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 0. Normalisation : pas de sauts de ligne superflus (3+ → 2, bords nettoyés)
    text = String(text ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    // 1. Blocs de code fencés (```lang\n...\n```)
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const escapedCode = esc(code.replace(/\n$/, ''));
      if (lang === 'sparkline') {
        const spark = _sparkline(code);
        if (spark) { codeBlocks.push(spark); return `\x00CODE${idx}\x00`; }
      }
      const highlighted = lang ? _highlight(escapedCode, lang) : escapedCode;
      const langLabel = lang ? `<span class="cb-lang">${esc(lang)}</span>` : '';
      const copyBtn = `<button class="cb-copy" title="Copier" onclick="
        navigator.clipboard.writeText(this.closest('.code-block').querySelector('code').innerText)
          .then(() => { this.textContent = '✓'; setTimeout(() => this.textContent = 'Copier', 1500); });
      ">Copier</button>`;
      const cls = lang ? ` class="lang-${esc(lang)}"` : '';
      codeBlocks.push(
        `<div class="code-block">`+
        `<div class="cb-header">${langLabel}${copyBtn}</div>`+
        `<pre><code${cls}>${highlighted}</code></pre>`+
        `</div>`
      );
      return `\x00CODE${idx}\x00`;
    });

    // Escape le reste (texte hors blocs code)
    const parts = text.split('\x00');
    text = parts.map((p, i) => {
      if (p.startsWith('CODE') && codeBlocks[parseInt(p.slice(4), 10)] !== undefined) {
        return '\x00' + p + '\x00';
      }
      return esc(p);
    }).join('');

    // 2. Inline : code, gras, italique — appliqué à un fragment (titre, puce, ligne)
    //    Les chemins de fichiers deviennent des liens cliquables (visionneuse).
    function inline(s) {
      const out = s
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');
      return _linkifyFiles(out);
    }

    // 3. Analyse ligne par ligne : chaque bloc reste un bloc (fini les <ul> dans <p>)
    // Une ligne vide entre deux puces ne casse pas la liste (rendu compact).
    text = text
      .replace(/(^[ \t]*[-*] .+)\n[ \t]*\n(?=[ \t]*[-*] )/gm, '$1\n')
      .replace(/(^[ \t]*\d+\. .+)\n[ \t]*\n(?=[ \t]*\d+\. )/gm, '$1\n');

    // Tableaux Markdown : en-tête « | a | b | » suivi d'une ligne « |---|---| »
    const _isTableRow = (l) => {
      const t = l.trim();
      return t.length > 1 && t.includes('|') && (t.startsWith('|') || t.endsWith('|'));
    };
    const _isTableSep = (l) => _isTableRow(l) && l.includes('-') && /^\|?[\s:|-]+\|[\s:|-]*$/.test(l.trim());
    const _splitRow = (l) => {
      let t = l.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|')) t = t.slice(0, -1);
      return t.split('|').map(c => c.trim());
    };
    const _cellAlign = (s) => {
      const a = s.trim();
      if (a.startsWith(':') && a.endsWith(':')) return 'center';
      if (a.endsWith(':')) return 'right';
      if (a.startsWith(':')) return 'left';
      return '';
    };
    const _renderTable = (header, aligns, rows) => {
      const cols = Math.max(header.length, ...rows.map(r => r.length), 1);
      const cell = (tag, txt, k) => {
        const align = aligns[k] ? ` class="t-${aligns[k]}"` : '';
        return `<${tag}${align}>${inline(txt || '')}</${tag}>`;
      };
      const head = '<thead><tr>' +
        Array.from({ length: cols }, (_, k) => cell('th', header[k], k)).join('') +
        '</tr></thead>';
      const body = rows.length
        ? '<tbody>' + rows.map(r =>
            '<tr>' + Array.from({ length: cols }, (_, k) => cell('td', r[k], k)).join('') + '</tr>'
          ).join('') + '</tbody>'
        : '';
      return `<div class="md-table"><table>${head}${body}</table></div>`;
    };

    const out   = [];
    let para    = [];   // lignes du paragraphe en cours
    let list    = null; // { tag: 'ul' | 'ol', items: [] }

    const flushPara = () => {
      if (!para.length) return;
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (!list) return;
      out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+$/, '');
      let m;

      if (!line.trim()) {                       // ligne vide → fin des blocs courants
        flushPara(); flushList(); continue;
      }
      if (line.includes('\x00CODE')) {          // bloc de code déjà construit
        flushPara(); flushList(); out.push(line); continue;
      }
      if (_isTableRow(line) && _isTableSep((lines[i + 1] || '').replace(/\s+$/, ''))) {
        flushPara(); flushList();
        const header = _splitRow(line);
        const aligns = _splitRow(lines[i + 1]).map(_cellAlign);
        i++;                                    // saute la ligne de séparation
        const rows = [];
        while (i + 1 < lines.length && _isTableRow(lines[i + 1].replace(/\s+$/, ''))) {
          rows.push(_splitRow(lines[++i].replace(/\s+$/, '')));
        }
        out.push(_renderTable(header, aligns, rows));
        continue;
      }
      if ((m = line.match(/^(#{1,4})\s+(.+)$/))) {
        flushPara(); flushList();
        const level = m[1].length;
        const tag   = level === 1 ? 'h4' : level === 2 ? 'h5' : 'h6';
        out.push(`<${tag}>${inline(m[2])}</${tag}>`);
        continue;
      }
      if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
        continue;
      }
      if ((m = line.match(/^\s*\d+\.\s+(.+)$/))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
        continue;
      }
      flushList();                              // texte courant → nouveau paragraphe
      para.push(line);
    }
    flushPara(); flushList();

    // 4. Réinjecter les blocs de code
    return out.join('\n')
      .replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i, 10)]);
  }

  // Extrait les fichiers touchés depuis la trace agent
  function _extractModifiedFiles(trace) {
    if (!Array.isArray(trace)) return [];
    const WRITE_TOOLS = new Set(['write_file', 'replace_code', 'delete_file', 'move_file', 'batch_replace']);
    const seen = new Map(); // path → action (dernière action gagne)
    for (const entry of trace) {
      if (!entry?.tool || !WRITE_TOOLS.has(entry.tool)) continue;
      const a = entry.args || {};
      const p = a.path || a.dest;
      if (!p) continue;
      const action = entry.tool === 'delete_file' ? 'del'
                   : entry.tool === 'move_file'   ? 'mv'
                   : 'edit';
      seen.set(p, action);
      if (entry.tool === 'move_file' && a.dest) seen.set(a.dest, 'mv');
    }
    return [...seen.entries()].map(([p, a]) => ({ path: p, action: a }));
  }

  function _appendAgentMessage(text, trace) {
    const div = document.createElement('div');
    div.className = 'message message-agent';

    // Corps du message : la réponse est toujours affichée en entier
    const body = document.createElement('div');
    body.className = 'msg-body';
    div.appendChild(body);

    // Extrait les suggestions proactives pour les rendre en chips cliquables
    const SUGG_MARKER = '\n---\n**À explorer :**\n';
    let mainText = text;
    let suggestions = [];
    const suggIdx = text.indexOf(SUGG_MARKER);
    if (suggIdx !== -1) {
      mainText = text.slice(0, suggIdx);
      const suggBlock = text.slice(suggIdx + SUGG_MARKER.length);
      suggestions = suggBlock.split('\n')
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2).trim())
        .filter(Boolean);
    }

    body.innerHTML = _renderMarkdown(mainText);

    // Clic sur un fichier du projet évoqué dans la réponse → visionneuse
    body.addEventListener('click', (e) => {
      const link = e.target.closest('.file-link');
      if (link) _openFile(link.dataset.path, Number(link.dataset.line) || null);
    });

    // Bouton copier — texte brut sans les chips de fichiers
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy';
    copyBtn.textContent = 'Copier';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ Copié';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = 'Copier'; copyBtn.classList.remove('copied'); }, 1500);
      });
    });
    div.appendChild(copyBtn);

    // Résumé des fichiers modifiés
    const files = _extractModifiedFiles(trace);
    if (files.length > 0) {
      const SHOW = 3;
      const shown  = files.slice(0, SHOW);
      const hidden = files.slice(SHOW);
      const icons  = { edit: '✎', del: '✕', mv: '→' };
      const chips  = shown.map(f =>
        `<span class="tf-chip tf-${f.action}" data-path="${_escAttr(f.path)}" title="Ouvrir ${_escHtml(f.path)}">`+
        `${icons[f.action]} ${_escHtml(f.path.split(/[\\/]/).pop())}`+
        `</span>`
      ).join('');
      const more = hidden.length
        ? `<span class="tf-more" title="${hidden.map(f => f.path).join('\n')}" `+
          `onclick="this.parentElement.classList.toggle('tf-expanded')">`+
          `+${hidden.length}</span>`+
          `<span class="tf-hidden">${hidden.map(f =>
            `<span class="tf-chip tf-${f.action}" data-path="${_escAttr(f.path)}" title="Ouvrir ${_escHtml(f.path)}">${icons[f.action]} ${_escHtml(f.path.split(/[\\/]/).pop())}</span>`
          ).join('')}</span>`
        : '';
      const bar = document.createElement('div');
      bar.className = 'trace-files';
      bar.innerHTML = chips + more;
      // Clic sur une pastille de fichier → visionneuse
      bar.addEventListener('click', (e) => {
        const chip = e.target.closest('.tf-chip');
        if (chip?.dataset.path) _openFile(chip.dataset.path);
      });
      div.appendChild(bar);
    }


    // Chips suggestions proactives de l'agent
    if (suggestions.length > 0) {
      const suggBar = document.createElement('div');
      suggBar.className = 'msg-suggestions';
      for (const s of suggestions) {
        const chip = document.createElement('button');
        chip.className = 'sugg-chip';
        chip.textContent = s;
        chip.addEventListener('click', () => {
          taskInput.value = s;
          taskInput.dispatchEvent(new Event('input'));
          taskInput.focus();
        });
        suggBar.appendChild(chip);
      }
      div.appendChild(suggBar);
    }

    messagesEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Plan dans le chat : toujours plié (une ligne), dépliable au clic ───────
  // Le suivi "en cours" est affiché en évidence au-dessus de la zone de saisie
  // (#active-plan) ; le chat ne garde qu'un résumé plié.
  function _syncChatTodoCount() {
    if (!_chatTodoCountEl) return;
    const total = _chatTodoItems.length;
    const done  = Math.min(_chatTodoStepIdx, total);
    _chatTodoCountEl.textContent = total ? `${done}/${total}` : '';
  }

  function _appendChatTodo(plan, brief = '') {
    if (!plan?.steps?.length) return;
    _chatTodoEl      = document.createElement('div');
    _chatTodoEl.className = 'chat-todo chat-todo-folded';
    _chatTodoItems   = [];
    _chatTodoStepIdx = 0;
    _chatTodoObjective = plan.objective || 'Plan';

    // Briefing lisible AVANT l'exécution : ce que l'agent a compris + la suite prévue
    const briefText = String(brief || '').trim();
    if (briefText) {
      const b = document.createElement('div');
      b.className = 'chat-todo-brief';
      b.textContent = briefText;
      b.title = briefText;
      _chatTodoEl.appendChild(b);
    }

    // En-tête plié : chevron + « Plan » + objectif + compteur
    const head = document.createElement('div');
    head.className = 'chat-todo-head';
    head.title = _chatTodoObjective;
    head.innerHTML =
      `<span class="chat-todo-chevron">▸</span>` +
      `<span class="chat-todo-kind">Plan</span>` +
      `<span class="chat-todo-objective">${_escHtml(_chatTodoObjective)}</span>` +
      `<span class="chat-todo-count">0/${plan.steps.length}</span>`;
    _chatTodoEl.appendChild(head);
    _chatTodoHead     = head;
    _chatTodoCountEl  = head.querySelector('.chat-todo-count');

    const ul = document.createElement('ul');
    ul.className = 'chat-todo-list hidden';
    plan.steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'chat-todo-item pending';
      const num = document.createElement('span');
      num.className = 'chat-todo-num';
      num.textContent = `${i + 1}.`;
      const check = document.createElement('span');
      check.className = 'chat-todo-check';
      const label = document.createElement('span');
      label.className = 'chat-todo-label';
      label.textContent = s;
      label.title = s;
      li.appendChild(num);
      li.appendChild(check);
      li.appendChild(label);
      ul.appendChild(li);
      _chatTodoItems.push(li);
    });
    _chatTodoEl.appendChild(ul);

    // Plié par défaut ; un clic déplie / replie
    let expanded = false;
    const setExpanded = (v) => {
      expanded = v;
      ul.classList.toggle('hidden', !expanded);
      const chev = head.querySelector('.chat-todo-chevron');
      if (chev) chev.textContent = expanded ? '▾' : '▸';
    };
    head.addEventListener('click', () => setExpanded(!expanded));

    messagesEl.appendChild(_chatTodoEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    _activityToBottom();   // la ligne d'action en cours reste sous le plan plié

    _advanceChatTodo(false);
  }

  function _advanceChatTodo(completeCurrent = true) {
    if (!_chatTodoItems.length) return;
    if (completeCurrent && _chatTodoStepIdx > 0) {
      const prev = _chatTodoItems[_chatTodoStepIdx - 1];
      if (prev) { prev.className = 'chat-todo-item done'; }
    }
    if (_chatTodoStepIdx < _chatTodoItems.length) {
      _chatTodoItems[_chatTodoStepIdx].className = 'chat-todo-item active';
      _chatTodoStepIdx++;
    }
    _syncChatTodoCount();
    _tpSyncPlanProgress();
    _planPinSync();
  }

  function _finalizeChatTodo(ok) {
    if (!_chatTodoItems.length) return;
    // Toutes les étapes sont exécutées — la ligne reste pliée dans le chat
    _chatTodoItems.forEach(li => { li.className = 'chat-todo-item done'; });
    _chatTodoStepIdx = _chatTodoItems.length;
    _syncChatTodoCount();
    _tpSyncPlanProgress();
    if (!_chatTodoEl) return;
    _chatTodoEl.classList.add(ok ? 'chat-todo-ok' : 'chat-todo-ko');
    const kind = _chatTodoHead?.querySelector('.chat-todo-kind');
    if (kind) kind.textContent = ok ? '✓ Plan' : '✕ Plan';
  }

  // ── Bandeau « Plan » épinglé au-dessus de la zone de saisie ──────────────
  // Affiche l'objectif ET toutes les étapes pour suivre la progression ;
  // retiré dès que le plan est totalement exécuté.
  function _planPinShow(plan) {
    if (!activePlanEl) return;
    _activePlan = plan || null;
    activePlanEl.classList.remove('hidden');
    if (apObjectiveEl) {
      apObjectiveEl.textContent = plan?.objective || 'Plan en cours';
      apObjectiveEl.title = plan?.objective || '';
    }

    // Toutes les étapes, avec leur numéro et leur état
    _apItems = [];
    if (apStepsEl) {
      apStepsEl.innerHTML = '';
      (plan?.steps || []).forEach((step, i) => {
        const li = document.createElement('li');
        li.className = 'ap-step-item pending';
        const box = document.createElement('span');
        box.className = 'ap-step-box';
        const num = document.createElement('span');
        num.className = 'ap-step-num';
        num.textContent = `${i + 1}.`;
        const text = document.createElement('span');
        text.className = 'ap-step-text';
        text.textContent = step;
        li.title = step;
        li.appendChild(box);
        li.appendChild(num);
        li.appendChild(text);
        apStepsEl.appendChild(li);
        _apItems.push(li);
      });
    }
    _planPinSync();
  }

  function _planPinSync() {
    if (!activePlanEl || !_activePlan) return;
    const total = _activePlan.steps?.length || 0;
    const done  = Math.min(_chatTodoStepIdx, total);
    if (apProgressEl) apProgressEl.textContent = total ? `${done}/${total}` : '';
    _apItems.forEach((li, i) => {
      li.className = 'ap-step-item ' + (i < done ? 'done' : i === done ? 'active' : 'pending');
    });
    // La ligne courante reste visible si la liste défile
    const current = _apItems[Math.min(done, Math.max(0, total - 1))];
    if (current && done < total) current.scrollIntoView({ block: 'nearest' });
  }

  function _planPinHide() {
    if (!activePlanEl) return;
    activePlanEl.classList.add('hidden');   // plan totalement exécuté → disparaît
    _activePlan = null;
    _apItems = [];
    if (apStepsEl) apStepsEl.innerHTML = '';
  }

  // ── Bloc d'activité — remplace les _appendInfo techniques ───────────────
  let _activityBlock = null;
  let _activityList  = null;
  let _activityCurrent = null;
  let _activityStepCount = 0;
  let _activityStartTs = 0;
  let _activityTimer = null;
  let _activityParseErrors = 0;
  let _activityCurrentLabel = '';
  let _activityCurrentParts = null;   // { keyword, detail, kind } de l'étape courante
  let _activityIntent = null;         // ligne « je vais … » affichée avant l'action

  // Mot-clé mis en évidence + famille de couleur pour chaque outil
  const _TOOL_KEYWORDS = {
    read_file:            { keyword: 'Lire',                  kind: 'read'   },
    list_dir:             { keyword: 'Lister',                kind: 'read'   },
    get_project_info:     { keyword: 'Projet',                kind: 'read'   },
    diff_file:            { keyword: 'Diff',                  kind: 'read'   },
    write_file:           { keyword: 'Écriture',              kind: 'write'  },
    replace_code:         { keyword: 'Modification en cours', kind: 'write'  },
    batch_replace:        { keyword: 'Modification en cours', kind: 'write'  },
    delete_file:          { keyword: 'Suppression',           kind: 'write'  },
    move_file:            { keyword: 'Déplacement',           kind: 'write'  },
    restore_file:         { keyword: 'Restauration',          kind: 'write'  },
    search_grep:          { keyword: 'Grep',                  kind: 'search' },
    find_symbol:          { keyword: 'Recherche',             kind: 'search' },
    run_shell:            { keyword: 'Exécution',             kind: 'exec'   },
    run_tests:            { keyword: 'Tests',                 kind: 'exec'   },
    start_process:        { keyword: 'Processus',             kind: 'exec'   },
    stop_process:         { keyword: 'Processus',             kind: 'exec'   },
    get_output:           { keyword: 'Processus',             kind: 'exec'   },
    list_processes:       { keyword: 'Processus',             kind: 'exec'   },
    deploy:               { keyword: 'Déploiement',           kind: 'exec'   },
    read_url:             { keyword: 'Lecture web',           kind: 'net'    },
    http_request:         { keyword: 'Requête',               kind: 'net'    },
    check_service:        { keyword: 'Vérification',          kind: 'net'    },
    git_status:           { keyword: 'Git',                   kind: 'misc'   },
    git_diff:             { keyword: 'Git',                   kind: 'misc'   },
    scratchpad:           { keyword: 'Note',                  kind: 'misc'   },
    plan:                 { keyword: 'Plan',                  kind: 'misc'   },
    ask_user:             { keyword: 'Question',              kind: 'misc'   },
    finish:               { keyword: 'Résumé',                kind: 'misc'   },
    spawn_agent:          { keyword: 'Sous-agent',            kind: 'misc'   },
    enable_collaboration: { keyword: 'Multi-agents',          kind: 'misc'   },
    post_message:         { keyword: 'Message',               kind: 'misc'   },
    read_messages:        { keyword: 'Messages',              kind: 'misc'   },
  };

  /** Adresse / indication courte associée à un appel d'outil (pure). */
  function _toolDetail(tool, args = {}) {
    const base = (p) => String(p || '').split(/[\\/]/).pop();
    switch (tool) {
      case 'read_file':     return base(args.path) + (args.start_line ? `:${args.start_line}` : '');
      case 'list_dir':      return args.path || '.';
      case 'write_file':
      case 'replace_code':
      case 'delete_file':
      case 'restore_file':
      case 'diff_file':     return args.path || '';
      case 'move_file':     return `${args.path || ''} → ${args.dest || ''}`;
      case 'search_grep':   return `« ${String(args.pattern || '').slice(0, 32)} »${args.path ? ' · ' + args.path : ''}`;
      case 'batch_replace': return `« ${String(args.pattern || '').slice(0, 32)} »${args.path ? ' · ' + args.path : ''}`;
      case 'find_symbol':   return args.name || '';
      case 'run_shell':
      case 'start_process': return String(args.command || '').slice(0, 60);
      case 'run_tests':     return String(args.command || 'tests du projet').slice(0, 60);
      case 'stop_process':
      case 'get_output':    return args.name || '';
      case 'read_url':      return String(args.url || '').slice(0, 60);
      case 'http_request':  return `${String(args.method || 'GET').toUpperCase()} ${String(args.url || '').slice(0, 50)}`;
      case 'check_service': return args.url || `${args.host || 'localhost'}:${args.port ?? '?'}`;
      case 'git_diff':      return args.path || '';
      case 'scratchpad':    return args.key || args.action || '';
      case 'spawn_agent':   return args.role || '';
      case 'post_message':  return args.to || '';
      case 'deploy':        return args.platform || 'auto';
      case 'plan':          return String(args.objective || '').slice(0, 60);
      case 'ask_user':      return String(args.question || '').slice(0, 60);
      default:              return '';
    }
  }

  /** { keyword, detail, kind } — le mot-clé est mis en évidence dans l'UI (pure). */
  function _toolParts(tool, args = {}) {
    const meta = _TOOL_KEYWORDS[tool] || { keyword: tool, kind: 'misc' };
    return { keyword: meta.keyword, detail: _toolDetail(tool, args), kind: meta.kind };
  }

  // Libellé texte (panneau Exécution) : mot-clé + adresse
  function _toolLabel(tool, args) {
    const { keyword, detail } = _toolParts(tool, args);
    return detail ? `${keyword} ${detail}` : keyword;
  }

  function _activityElapsed() {
    const secs = Math.floor((Date.now() - _activityStartTs) / 1000);
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${secs % 60}s`;
  }

  function _activityRender() {
    if (!_activityCurrent || !_activityBlock) return;
    const stepBadge = `<span class="activity-step-badge">Étape ${_activityStepCount}</span>`;
    const elapsed   = `<span class="activity-elapsed">${_activityElapsed()}</span>`;
    const retry     = _activityParseErrors > 0
      ? `<span class="activity-retry">${_activityParseErrors} retry</span>`
      : '';
    // Mot-clé coloré + adresse/indication sur la même ligne que l'animation
    const p  = _activityCurrentParts;
    const kw = p ? `<span class="act-kw act-kw-${p.kind}">${_escHtml(p.keyword)}</span>` : '';
    const dt = p?.detail
      ? `<span class="act-detail" title="${_escHtml(p.detail)}">${_escHtml(p.detail)}</span>`
      : '';
    _activityCurrent.innerHTML =
      `<span class="activity-spinner"></span>${stepBadge}<span class="activity-current-label">${kw}${dt}</span>${retry}${elapsed}`;
  }

  function _ensureActivityBlock() {
    if (_activityBlock) return;
    _activityStartTs = Date.now();
    _activityParseErrors = 0;
    _activityBlock = document.createElement('div');
    _activityBlock.className = 'activity-block';

    _activityCurrent = document.createElement('div');
    _activityCurrent.className = 'activity-current';
    _activityBlock.appendChild(_activityCurrent);

    // Intention annoncée par l'agent avant l'action
    _activityIntent = document.createElement('div');
    _activityIntent.className = 'activity-intent hidden';
    _activityBlock.appendChild(_activityIntent);

    messagesEl.appendChild(_activityBlock);

    // Met à jour le compteur de temps toutes les secondes
    _activityTimer = setInterval(() => _activityRender(), 1000);
  }

  /** L'agent réfléchit : animation dédiée pendant la génération du LLM. */
  function _activityThinking() {
    _ensureActivityBlock();
    _activityCurrentParts = { keyword: 'Réflexion en cours', detail: '', kind: 'think' };
    _activityCurrentLabel = 'Réflexion en cours';
    _activityCurrent.className = 'activity-current active thinking';
    if (_activityIntent) { _activityIntent.textContent = ''; _activityIntent.classList.add('hidden'); }
    _activityRender();
    _activityToBottom();
  }

  function _activityStep(tool, args, intent) {
    _ensureActivityBlock();
    _activityStepCount++;
    _activityCurrentParts = _toolParts(tool, args);
    _activityCurrentLabel = _toolLabel(tool, args); // conservé pour les messages d'erreur
    _activityCurrent.className = 'activity-current active';
    // Ce que l'agent s'apprête à faire, affiché avant l'action
    if (_activityIntent) {
      const text = (intent || '').trim();
      _activityIntent.textContent = text ? `« ${text} »` : '';
      _activityIntent.title = text;
      _activityIntent.classList.toggle('hidden', !text);
    }
    _activityRender();
    _activityToBottom();   // l'action en cours reste la dernière ligne du chat
    _activityBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Garde la ligne d'activité en bas de la conversation (dernier élément). */
  function _activityToBottom() {
    if (_activityBlock && _activityBlock.isConnected) messagesEl.appendChild(_activityBlock);
  }

  function _activityParseRetry() {
    if (!_activityBlock) return;
    _activityParseErrors++;
    _activityRender();
  }

  function _activityError(errMsg) {
    if (!_activityBlock) return;
    _activityCurrentLabel = errMsg;
    _activityCurrent.innerHTML = `<span class="activity-err-dot">✗</span><span class="activity-err-text">${_escHtml(errMsg)}</span>`;
    _activityCurrent.className = 'activity-current error';
  }

  function _activityCancel() {
    if (!_activityBlock) return;
    _closeActivityBlock('cancelled');
  }

  function _closeActivityBlock(state = 'done') {
    if (!_activityBlock) return;
    if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
    _activityBlock.remove();
    _activityBlock = null;
    _activityList  = null;
    _activityCurrent = null;
    _activityIntent  = null;
    _activityStepCount = 0;
    _activityParseErrors = 0;
    _activityCurrentLabel = '';
    _activityCurrentParts = null;
  }

  function _appendInfo(text) {
    const div = document.createElement('div');
    div.className = 'message message-info';
    div.textContent = text;
    messagesEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  function _appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message message-system';
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function appendErrorMessage(rawError) {
    const parsed = parseError(rawError);
    const div = document.createElement('div');
    div.className = 'message message-error';
    const p = document.createElement('p');
    p.textContent = parsed.msg;
    div.appendChild(p);
    if (parsed.hint) {
      const hint = document.createElement('p');
      hint.className = 'error-hint';
      hint.textContent = parsed.hint;
      div.appendChild(hint);
    }
    // Détail technique — affiché sous le message principal pour aider au diagnostic.
    // Le rawError complet est montré dans un bloc pliable si le message parsé est générique.
    const detail = rawError && rawError !== parsed.msg ? rawError.replace(/^[A-Z_]+:\s*/, '') : null;
    if (detail && detail.length > 2) {
      const details = document.createElement('details');
      details.className = 'error-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Détails techniques';
      const pre = document.createElement('pre');
      pre.className = 'error-raw';
      pre.textContent = detail;
      details.appendChild(summary);
      details.appendChild(pre);
      div.appendChild(details);
    }
    if (parsed.action === 'open-settings') {
      const btn = document.createElement('button');
      btn.className = 'error-action';
      btn.textContent = '⚙ Ouvrir les paramètres';
      btn.addEventListener('click', _openSettings);
      div.appendChild(btn);
    }
    messagesEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Bandeaux d'activité regroupée ────────────────────────────────────────
  // Un seul élément quel que soit le nombre d'événements consécutifs : le chat
  // ne doit pas se remplir d'une carte par écriture ou par message inter-agent.
  const _runStrips = { writes: null, bus: null };

  const RUN_STRIP_RUNNING = {
    writes: 'Modification en cours',
    bus:    'Messages inter-agents',
  };

  /** Accorde un mot au pluriel simple (pur). */
  function _plural(n, sing, plur) {
    return n > 1 ? (plur || sing + 's') : sing;
  }

  /** Libellé final d'un bandeau (pur → testé isolément). */
  function _runStripLabel(kind, n, ok = true) {
    if (kind === 'writes') {
      return ok
        ? `${n} ${_plural(n, 'modification')} appliquée${n > 1 ? 's' : ''}`
        : `${n} ${_plural(n, 'modification')} interrompue${n > 1 ? 's' : ''}`;
    }
    return `${n} ${_plural(n, 'message')} inter-agent${n > 1 ? 's' : ''}`;
  }

  /** Info courte affichée à droite du libellé (pur). */
  function _runStripMeta(kind, entry) {
    if (kind === 'bus') return entry.from || '';
    const base = String(entry.path || '').split(/[\\/]/).pop();
    const add  = entry.stats?.additions ?? 0;
    const del  = entry.stats?.deletions ?? 0;
    return `${base} +${add}/-${del}`;
  }

  function _stripOpen(kind) {
    const existing = _runStrips[kind];
    if (existing && existing.el.isConnected) return existing;
    _runStrips[kind] = null;

    const el = document.createElement('div');
    el.className = `run-strip running run-strip-${kind}`;
    const head = document.createElement('div');
    head.className = 'run-strip-head';
    head.innerHTML = `<span class="run-strip-spin"></span>` +
      `<span class="run-strip-label">${_escHtml(RUN_STRIP_RUNNING[kind] || 'En cours')}</span>` +
      `<span class="run-strip-meta"></span>` +
      `<span class="run-strip-count">1</span>`;
    el.appendChild(head);
    messagesEl.appendChild(el);

    const state = { el, head, count: 0, entries: [] };
    _runStrips[kind] = state;
    return state;
  }

  function _stripPush(kind, entry) {
    const st = _stripOpen(kind);
    st.entries.push(entry);
    st.count += 1;
    const meta = st.head.querySelector('.run-strip-meta');
    if (meta) meta.textContent = _runStripMeta(kind, entry);
    const count = st.head.querySelector('.run-strip-count');
    if (count) count.textContent = String(st.count);
    _activityToBottom();   // le bandeau d'écriture ne passe pas sous l'action en cours
    st.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Liste dépliable des événements regroupés. */
  function _buildStripItems(kind, entries) {
    if (!entries.length) return null;
    const ul = document.createElement('ul');
    ul.className = 'run-strip-items';
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = 'run-strip-item';
      if (kind === 'writes') {
        const add = e.stats?.additions ?? 0;
        const del = e.stats?.deletions ?? 0;
        const icon = e.isDelete ? '🗑' : e.isMove ? '→' : '✎';
        li.innerHTML = `<span class="rsi-icon">${icon}</span>` +
          `<code class="rsi-path">${_escHtml(e.path || '')}</code>` +
          `<span class="rsi-stats"><span class="add">+${add}</span><span class="del">-${del}</span></span>`;
        if (e.patch) {
          const pre = document.createElement('pre');
          pre.className = 'run-strip-diff hidden';
          _colorDiff(pre, e.patch);
          li.appendChild(pre);
          li.addEventListener('click', (ev) => {
            if (ev.target === pre) return;
            pre.classList.toggle('hidden');
          });
        }
      } else {
        li.innerHTML = `<span class="rsi-bus-from">${_escHtml(e.from || '')}</span>` +
          `<span class="rsi-bus-arrow">→</span>` +
          `<span class="rsi-bus-to">${_escHtml(e.to === 'all' ? 'tous' : (e.to || ''))}</span>` +
          `<span class="rsi-bus-text">${_escHtml(e.content || '')}</span>`;
      }
      ul.appendChild(li);
    }
    return ul;
  }

  /** Ferme un bandeau : ligne unique + compteur, dépliable. */
  function _stripClose(kind, ok = true) {
    const st = _runStrips[kind];
    if (!st) return false;
    _runStrips[kind] = null;
    if (!st.el.isConnected) return false;

    st.el.classList.remove('running');
    st.el.classList.add(ok ? 'done' : 'error');
    const head = st.head;
    head.querySelector('.run-strip-spin')?.remove();
    head.querySelector('.run-strip-count')?.remove();
    const meta = head.querySelector('.run-strip-meta');
    if (meta) meta.remove();
    const label = head.querySelector('.run-strip-label');
    if (label) label.textContent = _runStripLabel(kind, st.count, ok);

    const icon = document.createElement('span');
    icon.className = 'run-strip-icon';
    icon.textContent = ok ? '✓' : '✕';
    head.insertBefore(icon, head.firstChild);

    const items = _buildStripItems(kind, st.entries);
    if (items) {
      items.classList.add('hidden');
      st.el.appendChild(items);
      const chevron = document.createElement('span');
      chevron.className = 'run-strip-chevron';
      chevron.textContent = '▸';
      head.appendChild(chevron);
      head.addEventListener('click', () => {
        const hidden = items.classList.toggle('hidden');
        chevron.textContent = hidden ? '▸' : '▾';
      });
    }
    return true;
  }

  function _stripCloseAll(ok = true) {
    _stripClose('writes', ok);
    _stripClose('bus', ok);
  }

  /** Découpe un patch en lignes sans la ligne vide finale (pur). */
  function _patchLines(patch) {
    const lines = String(patch || '').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  function _colorDiff(pre, patch) {
    // Chaque ligne est un bloc : pas de « \n » ajouté (ligne vide finale supprimée)
    for (const line of _patchLines(patch)) {
      const span = document.createElement('span');
      span.textContent = line;
      if (line.startsWith('+') && !line.startsWith('+++'))      span.className = 'diff-line-add';
      else if (line.startsWith('-') && !line.startsWith('---')) span.className = 'diff-line-del';
      else if (line.startsWith('@@'))                           span.className = 'diff-line-hunk';
      else                                                       span.className = 'diff-line-ctx';
      pre.appendChild(span);
    }
  }

  function _updateMcpBadge(ok, fail) {
    const badge = document.getElementById('badge-mcp');
    if (!badge) return;
    if (ok === 0 && fail === 0) {
      const n = (currentConfig?.connectors || []).filter(c => c.enabled).length;
      badge.textContent = n > 0 ? `${n} actif${n > 1 ? 's' : ''}` : '—';
      badge.className   = 'snav-conn-badge sb-label' + (n > 0 ? ' snav-conn-on' : '');
    } else if (fail > 0 && ok === 0) {
      badge.textContent = `${fail} échec${fail > 1 ? 's' : ''}`;
      badge.className   = 'snav-conn-badge sb-label snav-conn-error';
    } else {
      const label = ok > 0 ? `${ok} connecté${ok > 1 ? 's' : ''}` + (fail > 0 ? ` · ${fail} ✕` : '') : '—';
      badge.textContent = label;
      badge.className   = 'snav-conn-badge sb-label snav-conn-on';
    }
  }

  /**
   * Transforme un patch unifié en lignes appariées avant/après.
   * Retourne un tableau de { hunk?, text?, left, right, ctx? }.
   */
  function _parseSideBySide(patch) {
    const lines = _patchLines(patch);
    const rows  = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('---') || line.startsWith('+++')) { i++; continue; }
      if (line.startsWith('@@')) {
        rows.push({ hunk: true, text: line });
        i++;
        continue;
      }
      if (line.startsWith('-') || line.startsWith('+')) {
        const dels = [];
        while (i < lines.length && lines[i].startsWith('-') && !lines[i].startsWith('---')) {
          dels.push(lines[i].slice(1));
          i++;
        }
        const adds = [];
        while (i < lines.length && lines[i].startsWith('+') && !lines[i].startsWith('+++')) {
          adds.push(lines[i].slice(1));
          i++;
        }
        const len = Math.max(dels.length, adds.length);
        for (let j = 0; j < len; j++) {
          rows.push({
            left:  j < dels.length ? dels[j] : null,
            right: j < adds.length ? adds[j] : null,
          });
        }
      } else {
        const text = line.startsWith(' ') ? line.slice(1) : line;
        rows.push({ ctx: true, left: text, right: text });
        i++;
      }
    }
    return rows;
  }

  function _buildSideBySideDiff(patch, isMove) {
    if (isMove) {
      const d = document.createElement('div');
      d.className = 'approval-diff-text';
      d.textContent = patch;
      return d;
    }
    const container = document.createElement('div');
    container.className = 'approval-diff-side';
    const leftCol  = document.createElement('div');
    leftCol.className  = 'diff-col diff-col-old';
    const rightCol = document.createElement('div');
    rightCol.className = 'diff-col diff-col-new';
    for (const row of _parseSideBySide(patch)) {
      if (row.hunk) {
        const lh = document.createElement('div');
        lh.className = 'diff-hunk-sep';
        lh.textContent = row.text;
        leftCol.appendChild(lh);
        rightCol.appendChild(lh.cloneNode(true));
        continue;
      }
      const ld = document.createElement('div');
      const rd = document.createElement('div');
      if (row.ctx) {
        ld.className = rd.className = 'diff-line ctx';
        ld.textContent = rd.textContent = row.left ?? '';
      } else {
        ld.className  = row.left  !== null ? 'diff-line del'   : 'diff-line empty';
        rd.className  = row.right !== null ? 'diff-line add'   : 'diff-line empty';
        ld.textContent = row.left  ?? '';
        rd.textContent = row.right ?? '';
      }
      leftCol.appendChild(ld);
      rightCol.appendChild(rd);
    }
    container.appendChild(leftCol);
    container.appendChild(rightCol);
    return container;
  }

  function _collapseApprovalCard(card, diffEl, actionsEl, statusLabel) {
    actionsEl.remove();
    diffEl.classList.add('approval-diff-collapsed');
    const titleEl = card.querySelector('.approval-title');
    if (titleEl) titleEl.textContent = statusLabel;
    const chevron = document.createElement('span');
    chevron.className = 'approval-chevron';
    chevron.textContent = '▸';
    card.querySelector('.approval-header').appendChild(chevron);
    card.classList.add('approval-done');
    // toggle diff au clic sur le header
    card.querySelector('.approval-header').addEventListener('click', () => {
      const expanded = !diffEl.classList.contains('approval-diff-collapsed');
      diffEl.classList.toggle('approval-diff-collapsed', expanded);
      chevron.textContent = expanded ? '▸' : '▾';
    });
  }

  function _appendApprovalCard(event) {
    const { id, path: filePath, patch, stats, isDelete = false, isMove = false, dest = '' } = event;
    const { additions = 0, deletions = 0 } = stats || {};

    const card = document.createElement('div');
    card.className = 'approval-card' + (isDelete ? ' approval-card-delete' : isMove ? ' approval-card-move' : '');
    card.dataset.id = id;

    const header = document.createElement('div');
    header.className = 'approval-header';
    const actionLabel = isDelete ? 'Suppression en attente' : isMove ? `Déplacement en attente → ${dest}` : 'Modification en attente';
    const icon        = isDelete ? '🗑' : isMove ? '📁' : '⚠';
    header.innerHTML = `
      <span class="approval-icon">${icon}</span>
      <span class="approval-title">${actionLabel}</span>
      <code class="approval-path">${filePath}</code>
      <span style="margin-left:8px;font-size: var(--text-2xs)"><span style="color:var(--diff-add)">+${additions}</span> <span style="color:var(--diff-del)">-${deletions}</span></span>
    `;
    card.appendChild(header);

    const pre = _buildSideBySideDiff(patch || '', isMove);
    card.appendChild(pre);

    const actions = document.createElement('div');
    actions.className = 'approval-actions';

    const btnReject = document.createElement('button');
    btnReject.className = 'btn-danger';
    btnReject.textContent = '✕ Rejeter';
    btnReject.addEventListener('click', async () => {
      await window.harness.approveWrite({ id, approved: false });
      card.classList.add('rejected');
      _collapseApprovalCard(card, pre, actions, '✕ Rejeté');
    });

    const btnAccept = document.createElement('button');
    btnAccept.className = 'btn-success';
    btnAccept.textContent = '✓ Accepter';
    btnAccept.addEventListener('click', async () => {
      await window.harness.approveWrite({ id, approved: true });
      card.classList.add('accepted');
      _collapseApprovalCard(card, pre, actions, '✓ Accepté');
    });

    actions.appendChild(btnReject);
    actions.appendChild(btnAccept);
    card.appendChild(actions);

    messagesEl.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
  }

  function _collapsePlanCard(card, objEl, actionsEl, statusLabel) {
    const short = objEl.textContent.length > 60 ? objEl.textContent.slice(0, 60) + '…' : objEl.textContent;
    actionsEl.remove();
    objEl.remove();
    card.innerHTML = `<span class="plan-done-icon">${statusLabel}</span><span class="plan-done-text">${_escHtml(short)}</span>`;
    card.style.cursor = 'default';
  }

  // ── Plan card (approbation uniquement — objectif + boutons) ─────────────
  function _appendPlanCard(plan, approvalId) {
    const { objective = '' } = plan || {};
    if (!approvalId) return; // plan automatique → Task Panel seulement

    const card = document.createElement('div');
    card.className = 'plan-card';

    const objEl = document.createElement('div');
    objEl.className = 'plan-objective-text';
    objEl.textContent = objective || 'Plan en attente d\'approbation';
    card.appendChild(objEl);

    const actions = document.createElement('div');
    actions.className = 'plan-actions';

    const btnReject = document.createElement('button');
    btnReject.className = 'btn-ghost plan-btn-reject';
    btnReject.textContent = 'Rejeter';
    btnReject.addEventListener('click', async () => {
      await window.harness.approvePlan({ id: approvalId, approved: false });
      card.classList.add('plan-rejected', 'plan-done');
      _collapsePlanCard(card, objEl, actions, '✕ Rejeté');
    });

    const btnAccept = document.createElement('button');
    btnAccept.className = 'btn-primary';
    btnAccept.textContent = 'Lancer →';
    btnAccept.addEventListener('click', async () => {
      await window.harness.approvePlan({ id: approvalId, approved: true });
      card.classList.add('plan-accepted', 'plan-done');
      _collapsePlanCard(card, objEl, actions, '✓ Lancé');
    });

    actions.appendChild(btnReject);
    actions.appendChild(btnAccept);
    card.appendChild(actions);

    messagesEl.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Ask user card ─────────────────────────────────────────────────────────
  function _appendAskUserCard({ id, question, context, suggestions = [] }) {
    const card = document.createElement('div');
    card.className = 'ask-card';

    // Juste la question, sans badge/header verbeux
    const qEl = document.createElement('div');
    qEl.className = 'ask-question';
    qEl.textContent = question;
    card.appendChild(qEl);

    if (context) {
      const ctx = document.createElement('div');
      ctx.className = 'ask-context';
      ctx.textContent = context;
      card.appendChild(ctx);
    }

    const input = document.createElement('textarea');
    input.className = 'ask-textarea';
    input.placeholder = suggestions.length > 0 ? 'Ou saisissez votre réponse…' : 'Votre réponse…';
    input.rows = 2;

    // Chips de suggestions — au-dessus de la zone de saisie (pas dans inputRow)
    if (suggestions.length > 0) {
      const chipsRow = document.createElement('div');
      chipsRow.className = 'ask-suggestions';
      suggestions.forEach(s => {
        const chip = document.createElement('button');
        chip.className = 'ask-suggestion-chip';
        chip.textContent = s;
        chip.type = 'button';
        chip.addEventListener('click', () => {
          input.value = s;
          input.focus();
          chipsRow.querySelectorAll('.ask-suggestion-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
        });
        chipsRow.appendChild(chip);
      });
      card.appendChild(chipsRow);
    }

    const btn = document.createElement('button');
    btn.className = 'ask-submit';
    btn.textContent = 'Répondre';

    const submitFn = async () => {
      const answer = input.value.trim();
      if (!answer) return;
      btn.disabled = true;
      input.disabled = true;
      await window.harness.answerUser({ id, answer });
      // Compacter la carte : question + réponse sur une ligne
      card.innerHTML = '';
      card.className = 'ask-card ask-card-done';
      const short = answer.length > 80 ? answer.slice(0, 80) + '…' : answer;
      card.innerHTML = `<span class="ask-done-q">${_escHtml(question)}</span><span class="ask-done-arrow">→</span><span class="ask-done-a">${_escHtml(short)}</span>`;
    };

    btn.addEventListener('click', submitFn);

    // Ctrl+Enter ou Enter seul (sans Shift) pour envoyer
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFn(); }
    });

    const inputRow = document.createElement('div');
    inputRow.className = 'ask-input-row';
    inputRow.appendChild(input);
    inputRow.appendChild(btn);
    card.appendChild(inputRow);

    messagesEl.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => input.focus(), 50);
  }

  // ── Note inline (trouvaille agent) ───────────────────────────────────────
  function _appendNoteUser(message, level) {
    const el = document.createElement('div');
    el.className = `agent-note agent-note-${level}`;
    const icon = level === 'error' ? '✕' : level === 'warn' ? '⚠' : '◆';
    el.innerHTML = `<span class="agent-note-icon">${icon}</span><span class="agent-note-msg">${_escHtml(message)}</span>`;
    messagesEl.appendChild(el);
    el.scrollIntoView({ block: 'nearest' });
  }

  // ── Collaboration banner ─────────────────────────────────────────────────
  function _appendCollaborationBanner() {
    const el = document.createElement('div');
    el.className = 'activity-info-line';
    el.innerHTML = `<span class="activity-spinner"></span>Mode multi-agents activé`;
    messagesEl.appendChild(el);
  }

  // ── Sub-agent card ────────────────────────────────────────────────────────
  const _subAgentCards = new Map(); // role+task → { card, bodyEl, stepCount }

  function _appendSubAgentCard(event) {
    const { role, label, color, task } = event;
    const key = role + '|' + task;

    const card = document.createElement('div');
    card.className = 'subagent-card';
    card.style.setProperty('--sa-color', color);

    card.innerHTML = `
      <div class="subagent-header">
        <span class="subagent-role-badge">${label.toUpperCase()}</span>
        <span class="subagent-task-text">${_escHtml(task)}</span>
      </div>
      <div class="subagent-body"></div>
    `;

    const bodyEl = card.querySelector('.subagent-body');
    _subAgentCards.set(key, { card, bodyEl, stepCount: 0 });
    messagesEl.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth' });
  }

  function _updateSubAgentCard(event) {
    const { role, task, subEvent } = event;
    const key = role + '|' + task;
    const entry = _subAgentCards.get(key);
    if (!entry) return;
    const { bodyEl } = entry;

    if (subEvent.type === 'tool_call') {
      entry.stepCount++;
      const label = _toolLabel(subEvent.tool, subEvent.args);

      // Archiver l'étape courante en ligne "done"
      const prev = bodyEl.querySelector('.sa-current');
      if (prev && prev.dataset.label) {
        const done = document.createElement('div');
        done.className = 'subagent-step';
        done.innerHTML = `<span class="sa-tick">✓</span>${_escHtml(prev.dataset.label)}`;
        bodyEl.insertBefore(done, prev);
        prev.remove();
        // Garder max 3 lignes archivées
        const rows = bodyEl.querySelectorAll('.subagent-step');
        if (rows.length > 3) rows[0].remove();
      }

      // Ligne courante avec spinner
      const cur = document.createElement('div');
      cur.className = 'sa-current';
      cur.dataset.label = label;
      cur.innerHTML = `<span class="sa-spinner"></span>${_escHtml(label)}`;
      bodyEl.appendChild(cur);
      bodyEl.scrollIntoView({ behavior: 'smooth' });

    } else if (subEvent.type === 'parse_error') {
      // silencieux — retry transparent dans les sous-agents aussi
    }
  }

  function _finalizeSubAgentCard(event) {
    const { role, task, result, modifiedFiles } = event;
    const key = role + '|' + task;
    const entry = _subAgentCards.get(key);
    if (!entry) return;

    entry.bodyEl.querySelector('.sa-current')?.remove();
    _subAgentCards.delete(key);

    // Compacter la card en une ligne cliquable
    const { card, stepCount } = entry;
    const headerEl = card.querySelector('.subagent-header');
    const bodyEl   = entry.bodyEl;
    const label    = headerEl?.querySelector('.subagent-task-text')?.textContent || task;
    const roleLabel = headerEl?.querySelector('.subagent-role-badge')?.textContent || role;
    const filesHint = modifiedFiles?.length
      ? ` · ${modifiedFiles.length} fichier${modifiedFiles.length > 1 ? 's' : ''}`
      : '';
    const summaryText = result.ok
      ? `✓ ${roleLabel} · ${label} (${stepCount} étape${stepCount > 1 ? 's' : ''}${filesHint})`
      : `✗ ${roleLabel} · ${result.error || 'Échec'}`;

    card.classList.add('subagent-card-done');
    card.innerHTML = `<div class="subagent-done-row"><span class="subagent-done-text">${_escHtml(summaryText)}</span><span class="subagent-done-chevron">▸</span></div>`;
    const detailHtml = bodyEl.innerHTML;
    let expanded = false;
    card.querySelector('.subagent-done-row').addEventListener('click', () => {
      expanded = !expanded;
      card.querySelector('.subagent-done-chevron').textContent = expanded ? '▾' : '▸';
      let detail = card.querySelector('.subagent-done-detail');
      if (expanded && !detail) {
        detail = document.createElement('div');
        detail.className = 'subagent-done-detail';
        detail.innerHTML = detailHtml;
        card.appendChild(detail);
      } else if (!expanded && detail) {
        detail.remove();
      }
    });
  }

  // ── Orchestration card — vue compacte d'un plan multi-phases ──────────────
  // Une seule carte pour toute l'orchestration : chaque phase tient sur une
  // ligne et les sous-agents ne créent plus de carte (cf. routage plus haut).
  let _orchState = null;

  function _appendOrchestrationCard(event) {
    const card = document.createElement('div');
    card.className = 'orch-card';
    card.innerHTML = `
      <div class="orch-header">
        <span class="orch-title">Orchestration</span>
        <span class="orch-objective">${_escHtml(event.objective || '')}</span>
        <span class="orch-counter"></span>
      </div>
      <div class="orch-phases"></div>
      <div class="orch-footer"></div>
    `;
    _orchState = { card, totalPhases: event.totalPhases || 0, doneCount: 0, rows: new Map() };
    messagesEl.appendChild(card);
    _orchRefreshCounter();
    card.scrollIntoView({ block: 'nearest' });
  }

  function _orchRefreshCounter() {
    if (!_orchState) return;
    const el = _orchState.card.querySelector('.orch-counter');
    const total = _orchState.totalPhases;
    if (el) el.textContent = `${_orchState.doneCount}/${total} phase${total > 1 ? 's' : ''}`;
  }

  function _orchPhaseStart(event) {
    if (!_orchState) return;
    let row = _orchState.rows.get(event.phase);
    if (!row) {
      row = document.createElement('div');
      row.className = 'orch-phase running';
      row.innerHTML = `
        <span class="orch-phase-dot"></span>
        <span class="orch-phase-num">Phase ${event.phase}</span>
        <span class="orch-phase-mode">${event.mode === 'parallel' ? 'parallèle' : 'séquentiel'}</span>
        <span class="orch-phase-roles">${_escHtml((event.roles || []).join(', '))}</span>
        <span class="orch-phase-agents"></span>
      `;
      _orchState.rows.set(event.phase, row);
      _orchState.card.querySelector('.orch-phases').appendChild(row);
    }
    row.classList.add('running');
  }

  // Compte les sous-agents réellement démarrés dans une phase parallèle.
  function _orchAgentTick(phase) {
    if (!_orchState) return;
    const row = _orchState.rows.get(phase);
    if (!row) return;
    const count = Number(row.dataset.agents || 0) + 1;
    row.dataset.agents = String(count);
    const badge = row.querySelector('.orch-phase-agents');
    if (badge && count > 1) badge.textContent = `${count} agents`;
  }

  function _orchPhaseDone(event) {
    if (!_orchState) return;
    const row = _orchState.rows.get(event.phase);
    if (row) {
      row.classList.remove('running');
      row.classList.add(event.ok ? 'ok' : 'fail');
      const dot = row.querySelector('.orch-phase-dot');
      if (dot) dot.textContent = event.ok ? '✓' : '✕';
    }
    _orchState.doneCount++;
    _orchRefreshCounter();
  }

  function _orchDone(event) {
    if (!_orchState) return;
    const { card } = _orchState;
    const ok = Boolean(event.ok);
    const files = event.modifiedFiles || [];
    const filesHint = files.length ? ` · ${files.length} fichier${files.length > 1 ? 's' : ''}` : '';
    const stopped = event.executedPhases < event.totalPhases
      ? ` · arrêt après la phase ${event.executedPhases}`
      : '';
    const footer = card.querySelector('.orch-footer');
    if (footer) {
      footer.classList.add(ok ? 'ok' : 'fail');
      footer.textContent = `${ok ? '✓' : '✕'} ${event.executedPhases}/${event.totalPhases} phases${stopped}${filesHint}`;
    }
    card.classList.add(ok ? 'done' : 'failed');
    _orchState = null;
  }

  function _orchReset() {
    _orchState = null;
  }

  // Interruption utilisateur : la carte cesse d'attendre et les phases en cours sont closes.
  function _orchCancel() {
    if (!_orchState) return;
    const { card, doneCount, totalPhases } = _orchState;
    for (const row of _orchState.rows.values()) {
      if (!row.classList.contains('running')) continue;
      row.classList.remove('running');
      row.classList.add('fail');
      const dot = row.querySelector('.orch-phase-dot');
      if (dot) dot.textContent = '⏹';
    }
    const footer = card.querySelector('.orch-footer');
    if (footer) footer.textContent = `⏹ interrompu · ${doneCount}/${totalPhases} phases`;
    card.classList.add('failed');
    _orchState = null;
  }

  /** Échappe une valeur destinée à un attribut HTML. */
  function _escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _colorApprovalDiff(pre, patch) {
    for (const line of _patchLines(patch)) {
      const span = document.createElement('span');
      span.textContent = line;
      if (line.startsWith('+') && !line.startsWith('+++'))      span.className = 'add';
      else if (line.startsWith('-') && !line.startsWith('---')) span.className = 'del';
      else if (line.startsWith('@@'))                           span.className = 'hunk';
      else                                                       span.className = 'ctx';
      pre.appendChild(span);
    }
  }

  // ── Bouton "Nouveau projet" ───────────────────────────────────────────────
  document.getElementById('btn-new-project').addEventListener('click', async () => {
    try {
      const folder = await window.harness.selectFolder();
      if (!folder) return;
      const res = await window.harness.setConfig({ projectRoot: folder });
      if (res?.ok !== false) {
        currentConfig = currentConfig || {};
        currentConfig.projectRoot = folder;
        _refreshStatusBar(currentConfig);
        _loadSidebarSessions();
        // Remettre le chat à zéro pour le nouveau projet
        messagesEl.innerHTML = `
          <div class="welcome-card">
            <div class="welcome-icon">⬡</div>
            <h2>ShamCode</h2>
            <p>Projet ouvert : <strong>${folder.split(/[\\/]/).pop()}</strong><br>Décris ta tâche ci-dessous pour commencer.</p>
          </div>`;
        _tpReset();
        _agentsHintShown = false; // réinitialiser pour le nouveau projet
        _chatHistory = [];
        _updateContextBadge();
        taskInput.value = '';
        taskInput.style.height = 'auto';
        _clearAttachments();
      }
    } catch { /* ignoré */ }
  });

  // ── Sections nav — flyout latéral ────────────────────────────────────────
  const _snavPanels = [];

  // Ferme tous les flyouts (clic extérieur)
  document.addEventListener('click', () => {
    _snavPanels.forEach(({ btn, body }) => {
      body.classList.add('collapsed');
      btn.classList.remove('active');
    });
  });

  function _initNavSection(btnId, bodyId) {
    const btn  = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;
    _snavPanels.push({ btn, body });
    // Toutes les sections démarrent fermées en mode flyout
    body.classList.add('collapsed');
    btn.classList.remove('active');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !body.classList.contains('collapsed');
      // Ferme tous
      _snavPanels.forEach(({ btn: b, body: bo }) => {
        bo.classList.add('collapsed');
        b.classList.remove('active');
      });
      if (isOpen) return;
      // Positionne et ouvre le flyout
      const sidebar = document.getElementById('sidebar');
      const sRect   = sidebar ? sidebar.getBoundingClientRect() : { right: 260 };
      const bRect   = btn.getBoundingClientRect();
      body.style.left = (sRect.right + 4) + 'px';
      body.style.top  = Math.min(bRect.top, window.innerHeight - body.offsetHeight - 12) + 'px';
      body.classList.remove('collapsed');
      btn.classList.add('active');
      // Recale si le panel dépasse en bas après le rendu
      requestAnimationFrame(() => {
        const panelH = body.offsetHeight;
        const maxTop = window.innerHeight - panelH - 8;
        if (parseFloat(body.style.top) > maxTop) body.style.top = Math.max(8, maxTop) + 'px';
      });
    });
    // Les clics dans le flyout ne le ferment pas
    body.addEventListener('click', (e) => e.stopPropagation());
  }

  _initNavSection('btn-nav-rules',       'nav-rules-body');
  _initNavSection('btn-nav-skills',      'nav-skills-body');
  _initNavSection('btn-nav-connectors',  'nav-connectors-body');
  _initNavSection('btn-nav-scheduler',   'nav-scheduler-body');

  // ── Planificateur sidebar ─────────────────────────────────────────────────

  function _cronLabel(cron) {
    const map = {
      '0 9 * * 1-5': 'Lun–Ven 9h',
      '0 9 * * *':   'Quotidien 9h',
      '0 8 * * 1':   'Lundi 8h',
      '0 */2 * * *': 'Toutes les 2h',
    };
    return map[cron] || cron;
  }

  function _renderSchedulerTasks(tasks) {
    const list = document.getElementById('scheduler-task-list');
    if (!list) return;
    if (!tasks || tasks.length === 0) {
      list.innerHTML = '<div class="snav-empty sb-label">Aucune tâche planifiée</div>';
      return;
    }
    list.innerHTML = tasks.map(t => `
      <div class="snav-sched-item" data-id="${_esc(t.id)}">
        <span class="snav-sched-label sb-label" title="${_esc(t.task)}">${_esc(t.label)}</span>
        <span class="snav-sched-cron sb-label">${_esc(_cronLabel(t.cron))}</span>
        <div class="snav-sched-actions">
          <button class="snav-sched-toggle sb-label" data-id="${_esc(t.id)}" title="${t.enabled ? 'Désactiver' : 'Activer'}">${t.enabled ? '●' : '○'}</button>
          <button class="snav-sched-run sb-label" data-id="${_esc(t.id)}" title="Lancer maintenant">▶</button>
          <button class="snav-sched-del sb-label" data-id="${_esc(t.id)}" title="Supprimer">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.snav-sched-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.harness.scheduleToggle(btn.dataset.id);
        _reloadSchedulerTasks();
      });
    });
    list.querySelectorAll('.snav-sched-run').forEach(btn => {
      btn.addEventListener('click', () => window.harness.scheduleRun(btn.dataset.id));
    });
    list.querySelectorAll('.snav-sched-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.harness.scheduleDelete(btn.dataset.id);
        _reloadSchedulerTasks();
      });
    });
  }

  async function _reloadSchedulerTasks() {
    try {
      const res = await window.harness.scheduleList();
      _renderSchedulerTasks(res?.tasks || []);
    } catch { /* ignoré */ }
  }

  // Charger les tâches quand la section s'ouvre
  document.getElementById('btn-nav-scheduler')?.addEventListener('click', () => {
    _reloadSchedulerTasks();
  });

  // Formulaire d'ajout inline
  const _schedForm   = document.getElementById('scheduler-add-form');
  const _schedAddBtn = document.getElementById('btn-scheduler-add');
  const _schedCronPreset  = document.getElementById('sched-cron-preset');
  const _schedCronCustom  = document.getElementById('sched-cron-custom');

  _schedAddBtn?.addEventListener('click', () => {
    _schedForm?.classList.remove('hidden');
    _schedAddBtn.classList.add('hidden');
  });

  document.getElementById('btn-sched-cancel')?.addEventListener('click', () => {
    _schedForm?.classList.add('hidden');
    _schedAddBtn?.classList.remove('hidden');
  });

  _schedCronPreset?.addEventListener('change', () => {
    const custom = _schedCronPreset.value === 'custom';
    _schedCronCustom?.classList.toggle('hidden', !custom);
  });

  document.getElementById('btn-sched-save')?.addEventListener('click', async () => {
    const label = document.getElementById('sched-label')?.value.trim();
    const task  = document.getElementById('sched-task')?.value.trim();
    const cron  = _schedCronPreset?.value === 'custom'
      ? (_schedCronCustom?.value.trim() || '')
      : (_schedCronPreset?.value || '');
    if (!label || !task || !cron) return;
    const res = await window.harness.scheduleAdd({ label, task, cron });
    if (res?.ok) {
      document.getElementById('sched-label').value = '';
      document.getElementById('sched-task').value  = '';
      _schedCronPreset.value = '0 9 * * 1-5';
      _schedCronCustom?.classList.add('hidden');
      _schedForm?.classList.add('hidden');
      _schedAddBtn?.classList.remove('hidden');
      _reloadSchedulerTasks();
    }
  });

  // ── Shell toggle dans les connecteurs ────────────────────────────────────
  document.getElementById('connector-shell').addEventListener('click', async () => {
    try {
      const newVal = !(currentConfig?.enableShell);
      await window.harness.setConfig({ enableShell: newVal });
      currentConfig = { ...currentConfig, enableShell: newVal };
      _refreshStatusBar(currentConfig);
    } catch { /* ignoré */ }
  });

  // ── Deploy toggle dans les connecteurs ───────────────────────────────────
  const connectorDeploy = document.getElementById('connector-deploy');
  if (connectorDeploy) {
    connectorDeploy.addEventListener('click', async () => {
      try {
        const newVal = !(currentConfig?.enableDeploy);
        await window.harness.setConfig({ enableDeploy: newVal });
        currentConfig = { ...currentConfig, enableDeploy: newVal };
        _refreshStatusBar(currentConfig);
      } catch { /* ignoré */ }
    });
  }

  // ── Compétences et règles ─────────────────────────────────────────────────
  const navRulesBody  = document.getElementById('nav-rules-body');
  const navSkillsBody = document.getElementById('nav-skills-body');
  let _rules  = [];
  let _skills = [];

  async function _loadRules() {
    try {
      const cfg = await window.harness.getConfig();
      _rules  = Array.isArray(cfg.customRules)  ? cfg.customRules  : [];
      _skills = Array.isArray(cfg.customSkills) ? cfg.customSkills : [];
      _renderSidebarRules();
      _renderSidebarSkills();
    } catch { /* ignoré */ }
  }

  async function _saveRules() {
    try {
      await window.harness.setConfig({ customRules: _rules });
      currentConfig = { ...currentConfig, customRules: [..._rules] };
    } catch { /* ignoré */ }
  }

  function _renderSidebarRules() {
    navRulesBody.innerHTML = '';

    if (_rules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'snav-empty sb-label';
      empty.textContent = 'Aucune règle définie';
      navRulesBody.appendChild(empty);
    }

    _rules.forEach((rule) => {
      const item = document.createElement('div');
      item.className = 'snav-rule-item' + (rule.enabled ? '' : ' snav-rule-disabled');
      item.innerHTML = `
        <label class="snav-rule-toggle" title="${rule.enabled ? 'Désactiver' : 'Activer'}">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-id="${rule.id}">
          <span class="snav-rule-check"></span>
        </label>
        <div class="snav-rule-content">
          <span class="snav-rule-name">${_escHtml(rule.name || rule.text.slice(0, 40))}</span>
          <span class="snav-rule-text">${_escHtml(rule.text)}</span>
        </div>
        <button class="snav-rule-delete" data-id="${rule.id}" title="Supprimer">✕</button>`;
      item.querySelector('input').addEventListener('change', async (e) => {
        const r = _rules.find(r => r.id === e.target.dataset.id);
        if (r) { r.enabled = e.target.checked; await _saveRules(); _renderSidebarRules(); }
      });
      item.querySelector('.snav-rule-delete').addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        _rules = _rules.filter(r => r.id !== id);
        await _saveRules(); _renderSidebarRules();
      });
      navRulesBody.appendChild(item);
    });

    // Bouton ajouter
    const addBtn = document.createElement('button');
    addBtn.className = 'snav-add-btn';
    addBtn.id = 'btn-add-rule';
    addBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg> Ajouter une règle`;
    addBtn.addEventListener('click', () => _showAddRuleInput());
    navRulesBody.appendChild(addBtn);
  }

  function _renderSidebarSkills() {
    navSkillsBody.innerHTML = '';

    if (_skills.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'snav-empty sb-label';
      empty.textContent = 'Aucun skill installé';
      navSkillsBody.appendChild(empty);
    }

    _skills.forEach(skill => {
      const item = document.createElement('div');
      item.className = 'snav-rule-item' + (skill.enabled !== false ? '' : ' snav-rule-disabled');
      item.innerHTML = `
        <span class="snav-skill-badge" title="${_escHtml(skill.description || '')}">⚡</span>
        <div class="snav-rule-content">
          <span class="snav-rule-name">${_escHtml(skill.name)}</span>
          ${skill.description ? `<span class="snav-rule-text">${_escHtml(skill.description)}</span>` : ''}
        </div>`;
      navSkillsBody.appendChild(item);
    });

    // Bouton ajouter
    const addBtn = document.createElement('button');
    addBtn.className = 'snav-add-btn';
    addBtn.id = 'btn-add-skill';
    addBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg> Ajouter un skill`;
    addBtn.addEventListener('click', () => _showAddSkillInput());
    navSkillsBody.appendChild(addBtn);
  }

  function _showAddSkillInput() {
    if (document.getElementById('skill-add-input-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'skill-add-input-wrap';
    wrap.className = 'snav-rule-add-wrap';
    wrap.innerHTML = `
      <input id="skill-add-name" class="snav-rule-input" type="text" placeholder="Nom du skill (obligatoire)" maxlength="60">
      <input id="skill-add-desc" class="snav-rule-input" type="text" placeholder="Description courte (optionnel)" maxlength="120">
      <textarea id="skill-add-prompt" class="snav-rule-input" placeholder="Instructions du skill (comportement, règles…)" rows="3"></textarea>
      <div class="snav-rule-add-actions">
        <button id="skill-add-confirm" class="snav-rule-btn-ok">Ajouter</button>
        <button id="skill-add-cancel" class="snav-rule-btn-cancel">Annuler</button>
      </div>`;
    navSkillsBody.insertBefore(wrap, document.getElementById('btn-add-skill'));
    const nameInput = wrap.querySelector('#skill-add-name');
    nameInput.focus();
    wrap.querySelector('#skill-add-confirm').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const description  = wrap.querySelector('#skill-add-desc').value.trim();
      const systemPrompt = wrap.querySelector('#skill-add-prompt').value.trim();
      _skills.push({ id: crypto.randomUUID(), name, description, systemPrompt, enabled: true });
      try {
        await window.harness.setConfig({ customSkills: _skills });
        currentConfig = { ...currentConfig, customSkills: [..._skills] };
      } catch { /* ignoré */ }
      _renderSidebarSkills();
    });
    wrap.querySelector('#skill-add-cancel').addEventListener('click', () => wrap.remove());
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrap.remove(); });
  }

  function _showAddRuleInput() {
    if (document.getElementById('rule-add-input-wrap')) return; // déjà ouvert
    const wrap = document.createElement('div');
    wrap.id = 'rule-add-input-wrap';
    wrap.className = 'snav-rule-add-wrap';
    wrap.innerHTML = `
      <input id="rule-add-name" class="snav-rule-input" type="text" placeholder="Nom court (ex: Style strict)" maxlength="40">
      <textarea id="rule-add-input" class="snav-rule-input" placeholder="Ex: Toujours utiliser TypeScript strict…" rows="2"></textarea>
      <div class="snav-rule-add-actions">
        <button id="rule-add-confirm" class="snav-rule-btn-ok">Ajouter</button>
        <button id="rule-add-cancel" class="snav-rule-btn-cancel">Annuler</button>
      </div>`;
    navRulesBody.insertBefore(wrap, document.getElementById('btn-add-rule'));
    const nameInput = wrap.querySelector('#rule-add-name');
    const textInput = wrap.querySelector('#rule-add-input');
    nameInput.focus();
    wrap.querySelector('#rule-add-confirm').addEventListener('click', async () => {
      const text = textInput.value.trim();
      if (!text) return;
      const name = nameInput.value.trim() || text.slice(0, 40) + (text.length > 40 ? '…' : '');
      _rules.push({ id: crypto.randomUUID(), name, text, enabled: true });
      await _saveRules(); _renderSidebarRules();
    });
    wrap.querySelector('#rule-add-cancel').addEventListener('click', () => {
      wrap.remove();
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); wrap.querySelector('#rule-add-confirm').click(); }
      if (e.key === 'Escape') wrap.remove();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') wrap.remove();
    });
  }

  function _escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Visionneuse de fichiers du projet (fenêtre flottante, onglets) ────────
  const fileViewerEl = document.getElementById('file-viewer');
  const fvTabsEl     = document.getElementById('fv-tabs');
  const fvContentEl  = document.getElementById('fv-content');
  const fvEmptyEl    = document.getElementById('fv-empty');
  const fvCloseEl    = document.getElementById('fv-close');
  const fvHeadEl     = document.getElementById('fv-head');
  const _fvFiles     = new Map();   // chemin → { tab, content, error }
  let   _fvActive    = null;

  /** Langage de coloration déduit de l'extension. */
  function _langFromPath(p) {
    const ext = String(p || '').split('.').pop().toLowerCase();
    const map = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts',
      py: 'py', go: 'go', rs: 'rs', java: 'java', cs: 'cs', rb: 'ruby', php: 'php',
      html: 'html', htm: 'html', css: 'css', scss: 'css', json: 'json', md: 'md',
      sh: 'sh', bat: 'sh', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    };
    return map[ext] || '';
  }

  function _fvSetEmpty(show) {
    fvEmptyEl?.classList.toggle('hidden', !show);
    fvContentEl?.classList.toggle('hidden', show);
  }

  /** Affiche le contenu d'un onglet (coloration + numéros de ligne). */
  function _fvRender(key, line) {
    const entry = _fvFiles.get(key);
    if (!entry || !fvContentEl) return;
    const lang = _langFromPath(key);
    if (entry.content == null) {
      fvContentEl.textContent = 'Chargement…';
      _fvSetEmpty(false);
      return;
    }
    fvContentEl.innerHTML = String(entry.content).split('\n').map((l, i) => {
      const escaped = _escHtml(l);
      const body    = (!entry.error && lang) ? _highlight(escaped, lang) : escaped;
      const active  = line && (i + 1) === line ? ' fv-line-active' : '';
      return `<span class="fv-line${active}">${body}</span>`;
    }).join('');
    _fvSetEmpty(false);
    if (line) {
      fvContentEl.querySelector('.fv-line-active')?.scrollIntoView({ block: 'center' });
    } else {
      const box = fvContentEl.parentElement;
      if (box) box.scrollTop = 0;
    }
  }

  function _fvActivate(key, line) {
    _fvActive = key;
    _fvFiles.forEach((v, k) => v.tab.classList.toggle('active', k === key));
    _fvRender(key, line);
  }

  function _fvCloseTab(key) {
    const entry = _fvFiles.get(key);
    if (!entry) return;
    entry.tab.remove();
    _fvFiles.delete(key);
    if (_fvActive !== key) return;
    const next = [..._fvFiles.keys()][0];
    if (next) { _fvActivate(next); return; }
    _fvActive = null;
    fvContentEl.innerHTML = '';
    _fvSetEmpty(true);
  }

  /**
   * Ouvre (ou active) un fichier du projet dans la visionneuse.
   * @param {string} filePath chemin relatif au projet
   * @param {number|null} line ligne à mettre en évidence
   */
  async function _openFile(filePath, line = null) {
    if (!fileViewerEl || !filePath) return;
    const key = String(filePath).replace(/^\.\//, '').replace(/\\/g, '/');
    fileViewerEl.classList.remove('hidden');

    if (_fvFiles.has(key)) { _fvActivate(key, line); return; }

    const tab = document.createElement('button');
    tab.className = 'fv-tab';
    tab.dataset.path = key;
    tab.title = key;
    tab.innerHTML = `<span class="fv-tab-name">${_escHtml(key.split('/').pop())}</span>` +
      `<span class="fv-tab-close" title="Fermer">✕</span>`;
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.fv-tab-close')) { _fvCloseTab(key); return; }
      _fvActivate(key);
    });
    fvTabsEl.appendChild(tab);

    const entry = { tab, content: null, error: false };
    _fvFiles.set(key, entry);
    _fvActivate(key, line);

    try {
      const res = await window.harness.readProjectFile(key);
      const current = _fvFiles.get(key);
      if (!current) return;                    // onglet fermé pendant la lecture
      if (!res?.ok) { current.content = `⚠ ${res?.error || 'ERREUR_LECTURE'}`; current.error = true; }
      else { current.content = res.content ?? ''; }
      if (_fvActive === key) _fvRender(key, line);
    } catch (err) {
      const current = _fvFiles.get(key);
      if (!current) return;
      current.content = `⚠ ${err.message}`;
      current.error = true;
      if (_fvActive === key) _fvRender(key, line);
    }
  }

  function _fvHide() {
    fileViewerEl?.classList.add('hidden');
  }

  fvCloseEl?.addEventListener('click', _fvHide);

  // Déplacement de la fenêtre par son en-tête
  (function _initFvDrag() {
    if (!fileViewerEl || !fvHeadEl) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    fvHeadEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = fileViewerEl.getBoundingClientRect();
      dragging = true;
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      fileViewerEl.style.right = 'auto';
      fileViewerEl.style.bottom = 'auto';
      fileViewerEl.style.left = `${rect.left}px`;
      fileViewerEl.style.top  = `${rect.top}px`;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      fileViewerEl.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
      fileViewerEl.style.top  = `${Math.max(0, e.clientY - offsetY)}px`;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  })();

  _loadRules();

  // ── Bouton collapse sidebar ──────────────────────────────────────────────
  const btnCollapse = document.getElementById('btn-sidebar-collapse');
  btnCollapse.addEventListener('click', () => {
    sidebarEl.classList.toggle('sidebar-collapsed');
    _syncCollapseHandles();
  });

  // ── Recherche de sessions ────────────────────────────────────────────────
  const sbSearchWrap  = document.getElementById('sb-search-wrap');
  const sbSearchInput = document.getElementById('sb-search-input');

  // btn-search-session affiche/masque la barre de recherche
  document.getElementById('btn-search-session')?.addEventListener('click', () => {
    sbSearchWrap.classList.toggle('hidden');
    if (!sbSearchWrap.classList.contains('hidden')) sbSearchInput.focus();
    else { sbSearchInput.value = ''; _renderSessionList(_allSessions); }
  });

  sbSearchInput.addEventListener('input', () => {
    const q = sbSearchInput.value.trim().toLowerCase();
    if (!q) { _renderSessionList(_allSessions); return; }
    _renderSessionList(_allSessions.filter(s =>
      (s.task || '').toLowerCase().includes(q)
    ));
  });

  sbSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      sbSearchInput.value = '';
      sbSearchInput.blur();
      _renderSessionList(_allSessions);
    }
  });

  // ── Reprise de session (légère) ──────────────────────────────────────────
  async function _resumeSession(sessionSummary) {
    // Charger la session complète
    let session = null;
    try {
      session = await window.harness.getSession(sessionSummary.id);
    } catch { /* ignore */ }
    const s = session || sessionSummary;

    // Mettre à jour le projet si besoin
    if (s.projectRoot && s.projectRoot !== currentConfig?.projectRoot) {
      await window.harness.setConfig({ projectRoot: s.projectRoot });
      currentConfig = { ...currentConfig, projectRoot: s.projectRoot };
      _refreshStatusBar(currentConfig);
    }

    // Remettre le chat à zéro et afficher le résumé de la session reprise
    messagesEl.innerHTML = '';
    _agentsHintShown = false;
    if (s.task) _appendUserMessage(s.task);
    if (s.result?.summary) {
      _appendAgentMessage(`✓ ${s.result.summary}`);
    } else if (s.result?.error) {
      appendErrorMessage(s.result.error);
    }
    // Badge de reprise
    const badge = document.createElement('div');
    badge.className = 'session-resume-badge';
    badge.textContent = `↩ Session reprise — ${new Date(s.createdAt).toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`;
    messagesEl.appendChild(badge);

    // Pré-remplir le task panel avec les étapes de la session
    _tpReset();
    _tp.idle.style.display = 'none';
    _tp.title.textContent = _shortStr(s.task || 'Session', 22);
    if (s.task) {
      _tp.objText.textContent = s.task;
      _tpShow(_tp.objective);
    }
    if (s.steps?.length) {
      if (_tp.execEmpty) _tp.execEmpty.classList.add('hidden');
      s.steps.forEach(step => {
        if (!step.tool) return;
        const item = document.createElement('div');
        const ok = step.result?.ok !== false;
        item.className = `tp-exec-item ${ok ? 'done' : 'error'}`;
        item.innerHTML = `<span class="tp-exec-icon"></span><span class="tp-exec-label">${_escHtml(_toolLabel(step.tool, step.args))}</span>`;
        _tp.execList.appendChild(item);
      });
    }

    // Pré-remplir le champ de saisie pour continuer
    const summary = s.result?.summary;
    taskInput.value = summary
      ? `Suite de la session précédente.\n\nRésumé : ${summary}\n\nContinue en : `
      : `Suite de la session précédente (tâche : "${s.task || '?'}"). `;
    taskInput.style.height = 'auto';
    taskInput.style.height = Math.min(taskInput.scrollHeight, 120) + 'px';
    taskInput.focus();
    taskInput.setSelectionRange(taskInput.value.length, taskInput.value.length);
  }

  // ── Fenêtre Paramètres (BrowserWindow isolée) ────────────────────────────
  const btnSettings = document.getElementById('btn-settings');

  /**
   * Ouvre la fenêtre Paramètres.
   * Les erreurs sont affichées dans le chat : un échec silencieux faisait croire
   * que le bouton ne répondait pas (ex. handler IPC absent du process principal).
   */
  async function _openSettings() {
    if (!window.harness || typeof window.harness.openSettings !== 'function') {
      appendErrorMessage('Paramètres indisponibles — pont applicatif non chargé : redémarre l\'application.');
      return;
    }
    try {
      const res = await window.harness.openSettings();
      if (res && res.ok === false) {
        appendErrorMessage(`Paramètres indisponibles — ${res.error || 'ERREUR_INCONNUE'}. Redémarre l'application.`);
      }
    } catch (err) {
      appendErrorMessage(`Paramètres indisponibles — ${err?.message || String(err)}. Redémarre l'application.`);
    }
  }

  btnSettings?.addEventListener('click', _openSettings);
  document.querySelector('.sidebar-profile')?.addEventListener('click', _openSettings);

  // ── Fenêtre Design Studio (BrowserWindow isolée) ──────────────────────────
  const btnDesignStudio = document.getElementById('btn-design-studio');

  async function _openDesign() {
    if (!window.harness || typeof window.harness.openDesign !== 'function') {
      appendErrorMessage('Design Studio indisponible — pont applicatif non chargé : redémarre l\'application.');
      return;
    }
    try {
      const res = await window.harness.openDesign();
      if (res && res.ok === false) {
        appendErrorMessage(`Design Studio indisponible — ${res.error || 'ERREUR_INCONNUE'}. Redémarre l'application.`);
      }
    } catch (err) {
      appendErrorMessage(`Design Studio indisponible — ${err.message}`);
    }
  }

  btnDesignStudio?.addEventListener('click', _openDesign);

  // ── Bouton Don ────────────────────────────────────────────────────────────
  const btnDonate = document.getElementById('btn-donate');

  async function _openDonation() {
    if (!window.harness || typeof window.harness.openDonation !== 'function') {
      appendErrorMessage('Don indisponible — pont applicatif non chargé : redémarre l\'application.');
      return;
    }
    try {
      const res = await window.harness.openDonation();
      if (res && res.ok === false) {
        appendErrorMessage(`Don indisponible — ${res.error || 'ERREUR_INCONNUE'}.`);
      }
    } catch (err) {
      appendErrorMessage(`Don indisponible — ${err.message}.`);
    }
  }

  btnDonate?.addEventListener('click', _openDonation);

  window.harness.onDonationSuccess(() => {
    _appendAgentMessage(
      '❤️ **Merci infiniment pour votre don !**\n\nVotre soutien nous permet de continuer à développer ShamCode. ' +
      'Chaque contribution compte et est profondément appréciée. Merci de faire partie de cette aventure ! 🙏'
    );
  });
  // Sync depuis la fenêtre settings via broadcast config:updated
  window.harness.onConfigUpdated((newConfig) => {
    currentConfig = newConfig;
    approvalMode   = newConfig?.approvalMode   ?? true;
    multiAgentMode = newConfig?.multiAgentMode ?? false;
    _refreshApprovalToggle();
    _refreshStatusBar(newConfig);
    _applyVisualSettings(newConfig);
    _micRefreshVisibility(newConfig);
    _rules  = Array.isArray(newConfig.customRules)  ? newConfig.customRules  : [];
    _skills = Array.isArray(newConfig.customSkills) ? newConfig.customSkills : [];
    _renderSidebarRules();
    _renderSidebarSkills();
    _renderPromptExamples();
    // Vider la liste du dropdown pour forcer un rechargement depuis le nouveau cache
    if (modelDropdownList) modelDropdownList.innerHTML = '';
    // Invalider la liste de modèles en cache pour qu'elle se recharge au prochain
    // ouverture du pill — évite d'afficher l'ancien modèle surligné.
    if (modelDropdown.classList.contains('hidden')) {
      modelDropdownList.innerHTML = '';
    }
  });

  function _applyVisualSettings(cfg) {
    const theme = cfg?.theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    const accent = cfg?.accentColor;
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent-hover', accent + 'cc');
      document.documentElement.style.setProperty('--accent-muted', accent + '33');
    }

    const font = cfg?.codeFont;
    if (font) {
      // Le choix de police s'applique à TOUTE l'application (interface + code).
      // Avant, seule la police du code changeait : avec une police absente du
      // système, le rendu restait identique d'un bout à l'autre.
      // Pile identique pour --mono et --font : une police absente retombe sur
      // Cascadia/Consolas au lieu de Segoe UI (réglage qui semblait sans effet).
      const family = font === 'monospace' ? 'monospace' : `'${font}'`;
      const stack  = `${family}, 'Cascadia Code', 'Consolas', monospace`;
      document.documentElement.style.setProperty('--mono', stack);
      document.documentElement.style.setProperty('--font', stack);
    }

    document.body.setAttribute('data-density', cfg?.density || 'normal');
  }

  // ── Panel Sessions (dialog complet) ──────────────────────────────────────
  const sessionsDialog   = document.getElementById('sessions-dialog');
  const btnSessionsClose = document.getElementById('btn-sessions-close');
  const sessionsList     = document.getElementById('sessions-list');

  btnSessionsClose.addEventListener('click', () => sessionsDialog.close());

  function _renderSessionsDialog(sessions) {
    if (!sessions || sessions.length === 0) {
      sessionsList.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Aucune session enregistrée.</p>';
      return;
    }
    sessionsList.innerHTML = '';
    for (const s of sessions) {
      const ok = s.result?.ok !== false;
      const item = document.createElement('div');
      item.className = `session-item ${ok ? 'ok' : 'fail'}`;
      const date = new Date(s.createdAt).toLocaleString('fr-FR');
      item.innerHTML = `
        <div class="session-task">${s.task || '(sans tâche)'}</div>
        <div class="session-meta">${date} — ${s.steps?.length || 0} étape(s) — ${ok ? '✓' : '✗'}</div>
      `;

      let detailEl = null;
      item.addEventListener('click', async () => {
        // Toggle : fermer si déjà ouvert
        if (detailEl && detailEl.parentNode) {
          detailEl.remove();
          detailEl = null;
          return;
        }
        const detail = await window.harness.getSession(s.id).catch(() => null);
        if (!detail) return;

        detailEl = document.createElement('div');
        detailEl.className = 'session-detail';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn-secondary session-export-btn';
        exportBtn.textContent = '⬇ Exporter JSON';
        exportBtn.title = 'Enregistrer la trace complète en JSON';
        exportBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const result = await window.harness.exportSession(s.id).catch(() => ({ ok: false }));
          if (result.ok) {
            exportBtn.textContent = '✓ Exporté';
            exportBtn.disabled = true;
            setTimeout(() => {
              exportBtn.textContent = '⬇ Exporter JSON';
              exportBtn.disabled = false;
            }, 3000);
          }
        });

        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(detail, null, 2);

        detailEl.appendChild(exportBtn);
        detailEl.appendChild(pre);
        item.after(detailEl);
      });

      sessionsList.appendChild(item);
    }
  }

  // ── Panel Applications connectées ─────────────────────────────────────────

  const appsListEl  = document.getElementById('apps-list');
  const appsAddForm = document.getElementById('apps-add-form');
  const appsAddInput = document.getElementById('apps-add-input');
  const btnAppsAdd  = document.getElementById('btn-apps-add');
  const btnAppsPing = document.getElementById('btn-apps-ping');
  const btnAppsConfirm = document.getElementById('apps-add-confirm');

  function _relativeTime(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 5)  return 'à l\'instant';
    if (diff < 60) return `il y a ${diff}s`;
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
    return `il y a ${Math.floor(diff / 3600)}h`;
  }

  function _statusTitle(status) {
    switch (status) {
      case 'active':    return 'Connecté — cliquer pour suspendre';
      case 'error':     return 'Hors ligne — cliquer pour réessayer';
      case 'pending':   return 'Vérification en cours…';
      case 'suspended': return 'Suspendu — cliquer pour reprendre';
      default:          return status;
    }
  }

  function _renderApps(apps) {
    if (!apps || apps.length === 0) {
      appsListEl.innerHTML = `
        <div class="ca-empty">
          <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18" opacity="0.25"><path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1A1.5 1.5 0 0 1 8.5 6v1H14a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0V8h-5v.5a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 2 7h5.5V6A1.5 1.5 0 0 1 6 4.5v-1z"/></svg>
          <span>Aucune app connectée</span>
        </div>`;
      return;
    }
    appsListEl.innerHTML = '';
    for (const app of apps) {
      const item = document.createElement('div');
      item.className = 'ca-item';
      item.dataset.url = app.url;

      // Bouton statut (dot coloré)
      const dot = document.createElement('button');
      dot.className = `ca-dot ${app.status}`;
      dot.title = _statusTitle(app.status);
      dot.addEventListener('click', async () => {
        if (app.status === 'active' || app.status === 'pending') {
          await window.harness.suspendApp(app.url).catch(() => {});
        } else {
          await window.harness.resumeApp(app.url).catch(() => {});
        }
      });

      // Infos
      const info = document.createElement('div');
      info.className = 'ca-item-info';
      const latency = app.latency_ms != null ? `${app.latency_ms}ms · ` : '';
      info.innerHTML = `
        <span class="ca-item-name" title="${app.url}">${app.name}</span>
        <span class="ca-item-detail">${latency}${_relativeTime(app.lastCheck)}</span>`;

      // Bouton supprimer
      const removeBtn = document.createElement('button');
      removeBtn.className = 'ca-item-remove';
      removeBtn.title = 'Retirer du panneau';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.harness.removeApp(app.url).catch(() => {});
      });

      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(removeBtn);
      appsListEl.appendChild(item);
    }
  }

  // Écoute les mises à jour en temps réel
  if (window.harness.onAppsUpdate) {
    window.harness.onAppsUpdate(_renderApps);
  }

  // Bouton "+" → affiche/masque le formulaire
  btnAppsAdd?.addEventListener('click', () => {
    appsAddForm.classList.toggle('hidden');
    if (!appsAddForm.classList.contains('hidden')) appsAddInput.focus();
  });

  // Valider l'ajout
  async function _confirmAddApp() {
    const url = appsAddInput.value.trim();
    if (!url) return;
    await window.harness.registerApp(url).catch(() => {});
    appsAddInput.value = '';
    appsAddForm.classList.add('hidden');
  }
  btnAppsConfirm?.addEventListener('click', _confirmAddApp);
  appsAddInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmAddApp();
    if (e.key === 'Escape') { appsAddForm.classList.add('hidden'); }
  });

  // Bouton refresh — ping immédiat
  btnAppsPing?.addEventListener('click', async () => {
    btnAppsPing.style.opacity = '0.5';
    await window.harness.pingApps().catch(() => {});
    setTimeout(() => { btnAppsPing.style.opacity = ''; }, 800);
  });

  // Mise à jour de l'horodatage "il y a X s" toutes les 10s
  setInterval(() => {
    const items = appsListEl.querySelectorAll('.ca-item');
    items.forEach(item => {
      const detail = item.querySelector('.ca-item-detail');
      if (detail) {
        const text = detail.textContent;
        // le texte "il y a Xs" change naturellement — pas de re-render complet
      }
    });
  }, 10_000);

  // ── PANNEAU PROCESSUS ACTIFS ─────────────────────────────────────────────

  const procsListEl  = document.getElementById('procs-list');
  const procsBadgeEl = document.getElementById('procs-badge');

  function _renderProcs(procs) {
    if (!procs || procs.length === 0) {
      procsListEl.innerHTML = '<div class="pr-empty"><span>Aucun processus</span></div>';
      if (procsBadgeEl) { procsBadgeEl.textContent = '0'; procsBadgeEl.classList.add('hidden'); }
      return;
    }

    // Auto-déplier quand un processus est actif
    _tpExpand('procs');

    const running = procs.filter(p => p.status === 'running' || p.status === 'starting').length;
    if (procsBadgeEl) {
      procsBadgeEl.textContent = String(running);
      procsBadgeEl.classList.toggle('hidden', running === 0);
    }

    procsListEl.innerHTML = procs.map(p => {
      const dot   = `<span class="pr-dot ${p.status}" title="${_procStatusLabel(p.status)}"></span>`;
      const name  = `<span class="pr-name" title="${_esc(p.command)}">${_esc(p.name)}</span>`;
      const cmd   = `<span class="pr-cmd">${_esc(p.command.slice(0, 30))}</span>`;
      const kill  = p.status === 'running'
        ? `<button class="pr-kill" data-name="${_esc(p.name)}" title="Arrêter">✕</button>`
        : '';
      return `<div class="pr-item">${dot}${name}${cmd}${kill}</div>`;
    }).join('');

    // Bind kill buttons
    procsListEl.querySelectorAll('.pr-kill').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // stop_process : l'outil harness gère le kill ; ici on demande juste via IPC
        // Pas de stop IPC direct exposé — le LLM appelle stop_process.
        // On peut simuler en émettant un événement interne pour l'affichage.
        btn.disabled = true;
        btn.textContent = '…';
      });
    });
  }

  function _procStatusLabel(status) {
    switch (status) {
      case 'running':  return 'En cours';
      case 'starting': return 'Démarrage…';
      case 'stopped':  return 'Arrêté';
      case 'error':    return 'Erreur';
      default:         return status;
    }
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Charge la liste initiale
  if (window.harness.listProcesses) {
    window.harness.listProcesses().then(r => { if (r?.processes) _renderProcs(r.processes); }).catch(() => {});
  }

  // Écoute les mises à jour en temps réel
  if (window.harness.onProcsUpdate) {
    window.harness.onProcsUpdate(_renderProcs);
  }

}); // fin DOMContentLoaded
