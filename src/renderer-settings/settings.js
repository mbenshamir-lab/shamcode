// Fenêtre Paramètres — logique isolée, communique via window.settingsApi.
'use strict';

let currentConfig = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null)
      out[k] = _deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

let _statusTimer = null;
function _flashStatus(ok, msg) {
  const el = document.getElementById('sw-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sw-titlebar-status ' + (ok ? 'ok' : 'err');
  clearTimeout(_statusTimer);
  if (ok) _statusTimer = setTimeout(() => { el.textContent = ''; el.className = 'sw-titlebar-status'; }, 1800);
}

// File d'attente des saves : chaque appel est chaîné au précédent.
// Garantit que (1) les saves s'exécutent dans l'ordre, (2) la fermeture
// peut attendre la fin de la file avec un simple "await _saveQueue".
let _saveQueue = Promise.resolve();

// Mise à jour optimiste : currentConfig est synchronisé AVANT l'await,
// de sorte qu'aucun callback ne lise un état périmé même si plusieurs
// saves sont en vol simultanément.
function _autoSave(patch) {
  // Optimistic update synchrone — le prochain appel voit déjà la valeur à jour.
  const merged = _deepMerge(currentConfig, patch);
  Object.assign(currentConfig, merged);

  // Chaîner dans la file pour serialiser les appels IPC.
  _saveQueue = _saveQueue.catch(() => {}).then(async () => {
    try {
      const res = await window.settingsApi.setConfig(currentConfig);
      if (res?.ok === false) { _flashStatus(false, `✗ ${res.error}`); return; }
      _flashStatus(true, '✓');
    } catch (err) { _flashStatus(false, `✗ ${err.message}`); }
  });
  return _saveQueue;
}

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
    // Police appliquée à l'interface ET au code (même règle que la fenêtre
    // principale) : sinon le réglage ne se voyait nulle part.
    // Une police absente du système retombe sur Cascadia/Consolas (pile identique
    // à --mono) : avant, l'interface retombait sur Segoe UI et le clic semblait
    // sans effet, alors que le texte d'aide annonce un repli sur Consolas.
    const family = font === 'monospace' ? 'monospace' : `'${font}'`;
    const stack  = `${family}, 'Cascadia Code', 'Consolas', monospace`;
    document.documentElement.style.setProperty('--mono', stack);
    document.documentElement.style.setProperty('--font', stack);
  }

  document.body.setAttribute('data-density', cfg?.density || 'normal');
}

/**
 * Détecte les polices réellement installées sur la machine.
 * Comparaison de largeur de texte avec le repli monospace : la technique
 * classique (aucune API navigateur ne liste les polices système).
 * Sans cela, choisir « JetBrains Mono » sur une machine qui ne l'a pas ne
 * changeait rien à l'écran, ce qui ressemblait à un bouton cassé.
 */
function _fontAvailable(family) {
  if (family === 'monospace') return true;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const probe = 'mmmmmmmmmmlliWQ@#%';
    const measure = (f) => {
      ctx.font = `72px ${f}`;
      return ctx.measureText(probe).width;
    };
    const base = measure('monospace');
    const withFamily = measure(`'${family}', monospace`);
    return Math.abs(withFamily - base) > 0.5;
  } catch { return true; }
}

// ── Initialisation ────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {

  // Fermeture — attend la fin de la file de saves avant de fermer.
  document.getElementById('btn-sw-close').addEventListener('click', async () => {
    await _saveQueue;
    window.settingsApi.closeWindow();
  });

  // Chargement initial de la config
  try {
    currentConfig = await window.settingsApi.getConfig();
  } catch { currentConfig = {}; }
  _applyVisualSettings(currentConfig);
  _fillSettings(currentConfig);
  _markFontAvailability();

  // ── Onglets ────────────────────────────────────────────────────────────────
  const btnApplyKey = document.getElementById('btn-settings-save');
  document.querySelectorAll('.sm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sm-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sm-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sm-panel-' + btn.dataset.tab).classList.add('active');
      btnApplyKey.style.display = btn.dataset.tab === 'model' ? '' : 'none';
    });
  });

  // ── Remplissage formulaire ─────────────────────────────────────────────────
  function _fillSettings(cfg) {
    const primary = cfg?.model?.primary || 'openai-compat';
    const engCfg  = cfg?.model?.engines?.[primary] || {};

    // Modèle
    document.getElementById('sm-engine').value      = primary;
    document.getElementById('sm-api-key').value     = '';  // jamais affichée
    document.getElementById('sm-base-url').value    = engCfg.baseUrl || '';
    document.getElementById('sm-model-name').value  = engCfg.model   || '';
    document.getElementById('sm-webllm-model').value    = cfg?.model?.engines?.webllm?.model     || 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC';
    document.getElementById('sm-cpu-model-path').value  = cfg?.model?.engines?.cpu?.modelPath   || '';
    const tempVal = cfg?.temperature ?? 0.1;
    document.getElementById('sm-temperature').value = tempVal;
    document.getElementById('sm-temp-val').textContent = tempVal;
    document.getElementById('sm-top-p').value       = cfg?.topP ?? 1.0;
    document.getElementById('sm-streaming').checked = cfg?.streaming ?? true;
    const fallbacks = cfg?.model?.fallbacks || [];
    document.querySelectorAll('.sm-fallback-cb').forEach(cb => { cb.checked = fallbacks.includes(cb.value); });
    document.getElementById('sm-test-result').textContent = '';
    document.getElementById('sm-test-result').className   = 'sm-field-status';
    _smToggleEngineFields(primary);

    // Agent
    document.getElementById('sm-project-root').value    = cfg?.projectRoot || '';
    document.getElementById('sm-approval-mode').checked = cfg?.approvalMode ?? false;
    document.getElementById('sm-multi-agent').checked   = cfg?.multiAgentMode ?? false;
    document.getElementById('sm-max-steps').value       = cfg?.maxSteps ?? 25;
    document.getElementById('sm-retry-parse').value     = cfg?.retryOnParseError ?? 2;
    document.getElementById('sm-enable-web-search').checked = cfg?.enableWebSearch !== false;
    document.getElementById('sm-enable-voice').checked      = !!(cfg?.voiceEnabled);
    document.getElementById('sm-voice-model').value         = cfg?.voiceModel === 'small' ? 'small' : 'base';
    document.getElementById('sm-enable-lsp').checked        = !!(cfg?.enableLsp);
    _smToggleLspConfig(!!(cfg?.enableLsp));
    const lspS = cfg?.lspServers || {};
    document.getElementById('sm-lsp-ts').value = lspS.typescript || '';
    document.getElementById('sm-lsp-py').value = lspS.python    || '';
    document.getElementById('sm-lsp-rs').value = lspS.rust      || '';
    document.getElementById('sm-lsp-go').value = lspS.go        || '';
    document.getElementById('sm-enable-shell').checked     = !!(cfg?.enableShell);
    document.getElementById('sm-enable-git-write').checked = !!(cfg?.enableGitWrite);
    document.getElementById('sm-enable-deploy').checked    = !!(cfg?.enableDeploy);
    document.getElementById('sm-auto-format').checked      = !!(cfg?.autoFormat);
    document.getElementById('sm-auto-backup').checked      = cfg?.backupBeforeWrite ?? true;
    document.getElementById('sm-max-backups').value     = cfg?.maxBackups ?? 50;
    document.getElementById('sm-context-budget').value  = cfg?.maxContextChars ?? 12000;
    document.getElementById('sm-enable-feedback-learning').checked = !!(cfg?.enableFeedbackLearning);
    document.getElementById('sm-enable-fix-loop').checked = !!(cfg?.enableFixLoop);
    _smToggleFixLoopConfig(!!(cfg?.enableFixLoop));
    document.getElementById('sm-fix-loop-max-iter').value = cfg?.fixLoopMaxIterations ?? 5;

    // Génération vidéo / images
    _renderPromptExamples('video', cfg?.videoPromptExamples || []);
    _renderPromptExamples('image', cfg?.imagePromptExamples || []);

    // Autres fournisseurs IA
    _renderCustomProviders(cfg?.customProviders || []);

    // Skills & Règles
    _renderRules(cfg?.customRules || []);
    _renderSkills(cfg?.customSkills || []);

    // MCP
    _renderConnectors(cfg?.connectors || []);
    _renderApiTokens(cfg?.apiTokens || {});

    // Thèmes
    const theme = cfg?.theme || 'dark';
    document.querySelectorAll('.sm-theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
    const accent = cfg?.accentColor || '#6366f1';
    document.querySelectorAll('.sm-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === accent));
    const font = cfg?.codeFont || 'JetBrains Mono';
    document.querySelectorAll('.sm-font-card').forEach(c => c.classList.toggle('active', c.dataset.font === font));
    const density = cfg?.density || 'normal';
    document.querySelectorAll('.sm-density-btn').forEach(b => b.classList.toggle('active', b.dataset.density === density));
  }

  // ── Toggle section config LSP ─────────────────────────────────────────────
  function _smToggleLspConfig(show) {
    const el = document.getElementById('sm-lsp-config');
    if (el) el.classList.toggle('sm-hidden', !show);
  }

  // ── Toggle section config fix-loop ───────────────────────────────────────
  function _smToggleFixLoopConfig(show) {
    const el = document.getElementById('sm-fix-loop-config');
    if (el) el.classList.toggle('sm-hidden', !show);
  }

  // ── Toggle champs moteur ───────────────────────────────────────────────────
  function _smToggleEngineFields(engine) {
    // DeepSeek passe par une URL de base personnalisée : le champ doit rester
    // visible (il était masqué, l'URL devenait donc impossible à corriger).
    const needsBaseUrl   = engine === 'openai-compat' || engine === 'deepseek';
    const isLocalNoKey   = engine === 'webllm' || engine === 'cpu';
    document.getElementById('sm-row-baseurl').style.display       = needsBaseUrl ? '' : 'none';
    document.getElementById('sm-row-deepseek-hint').style.display = engine === 'deepseek' ? '' : 'none';
    document.getElementById('sm-row-webllm').style.display        = engine === 'webllm' ? '' : 'none';
    document.getElementById('sm-row-cpu').style.display           = engine === 'cpu' ? '' : 'none';
    document.getElementById('sm-row-apikey').style.display        = isLocalNoKey ? 'none' : '';
    document.getElementById('sm-row-modelname').style.display     = isLocalNoKey ? 'none' : '';
    document.querySelectorAll('.sm-fallback-item').forEach(item => {
      const isSelf = item.dataset.engine === engine;
      item.style.display = isSelf ? 'none' : '';
      if (isSelf) item.querySelector('input').checked = false;
    });
    document.getElementById('sm-model-list').innerHTML = '';
    document.getElementById('sm-model-dropdown').classList.add('hidden');
    document.getElementById('sm-model-load-status').textContent = '';
  }

  function _markFontAvailability() {
    document.querySelectorAll('.sm-font-card').forEach(card => {
      const available = _fontAvailable(card.dataset.font);
      card.classList.toggle('sm-font-missing', !available);
      if (!available) {
        card.title = `« ${card.dataset.font} » n'est pas installée sur ce système — repli sur Consolas.`;
      } else {
        card.removeAttribute('title');
      }
    });
  }

  // ── Handlers — Onglet Modèle ───────────────────────────────────────────────
  document.getElementById('sm-engine').addEventListener('change', e => {
    const eng    = e.target.value;
    const engCfg = currentConfig?.model?.engines?.[eng] || {};
    _smToggleEngineFields(eng);
    // Mettre à jour les champs avec les valeurs du moteur sélectionné
    document.getElementById('sm-model-name').value = engCfg.model   || '';
    document.getElementById('sm-base-url').value   = engCfg.baseUrl || '';
    document.getElementById('sm-api-key').value    = '';
    _autoSave({ model: { ...currentConfig.model, primary: eng } });
  });
  document.getElementById('sm-temperature').addEventListener('input', e => {
    document.getElementById('sm-temp-val').textContent = parseFloat(e.target.value).toFixed(2);
    _autoSave({ temperature: parseFloat(e.target.value) });
  });
  document.getElementById('sm-top-p').addEventListener('change', e => _autoSave({ topP: parseFloat(e.target.value) || 1 }));
  document.getElementById('sm-streaming').addEventListener('change', e => _autoSave({ streaming: e.target.checked }));
  document.getElementById('sm-base-url').addEventListener('blur', () => {
    const primary = document.getElementById('sm-engine').value;
    const url = document.getElementById('sm-base-url').value.trim();
    const engines = { ...currentConfig?.model?.engines, [primary]: { ...currentConfig?.model?.engines?.[primary], baseUrl: url } };
    _autoSave({ model: { ...currentConfig.model, engines } });
  });
  // Combobox modèle : ouvrir sur clic du champ readonly
  function _smCloseCombo() {
    document.getElementById('sm-model-dropdown').classList.add('hidden');
    document.getElementById('sm-model-filter').value = '';
  }
  function _smOpenCombo() {
    const list = document.getElementById('sm-model-list');
    if (!list.children.length) return; // liste vide : demander ↻ Charger d'abord
    const dd = document.getElementById('sm-model-dropdown');
    dd.classList.remove('hidden');
    const flt = document.getElementById('sm-model-filter');
    flt.value = '';
    Array.from(list.querySelectorAll('.sm-combobox-item')).forEach(el => { el.style.display = ''; });
    flt.focus();
  }
  document.getElementById('sm-model-name').addEventListener('click', _smOpenCombo);
  // Fermer en cliquant hors du combobox
  document.addEventListener('click', e => {
    if (!document.getElementById('sm-model-combobox').contains(e.target)) _smCloseCombo();
  });
  // Filtre en temps réel
  document.getElementById('sm-model-filter').addEventListener('input', () => {
    const q = document.getElementById('sm-model-filter').value.toLowerCase();
    Array.from(document.getElementById('sm-model-list').querySelectorAll('.sm-combobox-item'))
      .forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });
  // Navigation clavier depuis le filtre
  document.getElementById('sm-model-filter').addEventListener('keydown', e => {
    const list = document.getElementById('sm-model-list');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector('.sm-combobox-item:not([style*="display: none"])')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      list.querySelector('.sm-combobox-item:not([style*="display: none"])')?.click();
    } else if (e.key === 'Escape') {
      _smCloseCombo();
    }
  });
  document.getElementById('sm-model-filter').addEventListener('click', e => e.stopPropagation());
  document.getElementById('sm-webllm-model').addEventListener('change', e => {
    const engines = { ...currentConfig?.model?.engines, webllm: { ...currentConfig?.model?.engines?.webllm, model: e.target.value } };
    _autoSave({ model: { ...currentConfig.model, engines } });
  });

  document.getElementById('sm-webllm-clear-cache').addEventListener('click', async () => {
    const btn    = document.getElementById('sm-webllm-clear-cache');
    const status = document.getElementById('sm-webllm-cache-status');
    btn.disabled = true;
    status.textContent = 'Suppression…';
    status.className   = 'sm-field-status';
    const res = await window.settingsApi.clearWebLlmCache().catch(e => ({ ok: false, error: e.message }));
    btn.disabled = false;
    if (res.ok) {
      status.textContent = 'Cache supprimé — le modèle sera re-téléchargé au prochain démarrage.';
      status.className   = 'sm-field-status ok';
    } else {
      status.textContent = `Erreur : ${res.error || 'inconnue'}`;
      status.className   = 'sm-field-status error';
    }
  });
  document.getElementById('sm-cpu-model-path').addEventListener('blur', () => {
    const p = document.getElementById('sm-cpu-model-path').value.trim();
    const engines = { ...currentConfig?.model?.engines, cpu: { ...currentConfig?.model?.engines?.cpu, modelPath: p || undefined } };
    _autoSave({ model: { ...currentConfig.model, engines } });
  });
  document.getElementById('sm-cpu-browse').addEventListener('click', async () => {
    const p = await window.settingsApi.selectFile();
    if (!p) return;
    document.getElementById('sm-cpu-model-path').value = p;
    const engines = { ...currentConfig?.model?.engines, cpu: { ...currentConfig?.model?.engines?.cpu, modelPath: p } };
    _autoSave({ model: { ...currentConfig.model, engines } });
  });
  document.querySelectorAll('.sm-fallback-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const fallbacks = Array.from(document.querySelectorAll('.sm-fallback-cb')).filter(c => c.checked).map(c => c.value);
      _autoSave({ model: { ...currentConfig.model, fallbacks } });
    });
  });

  // Tester connexion
  document.getElementById('sm-test-engine').addEventListener('click', async () => {
    const engine = document.getElementById('sm-engine').value;
    // Champ vide = la clé déjà enregistrée est utilisée côté main.
    const apiKey = document.getElementById('sm-api-key').value.trim();
    const res_el = document.getElementById('sm-test-result');
    res_el.textContent = 'Test en cours…'; res_el.className = 'sm-field-status';
    try {
      const res = await window.settingsApi.testEngine({ engine, apiKey });
      res_el.textContent = res.ok ? '✓ Connexion réussie' : `✗ ${res.error || 'Échec'}`;
      res_el.className   = 'sm-field-status ' + (res.ok ? 'ok' : 'err');
    } catch (err) { res_el.textContent = `✗ ${err.message}`; res_el.className = 'sm-field-status err'; }
  });

  // Afficher/masquer clé API
  document.getElementById('sm-apikey-toggle').addEventListener('click', () => {
    const inp = document.getElementById('sm-api-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Charger liste modèles
  document.getElementById('sm-load-models').addEventListener('click', async () => {
    const engine  = document.getElementById('sm-engine').value;
    const apiKey  = document.getElementById('sm-api-key').value.trim();
    const baseUrl = document.getElementById('sm-base-url').value.trim();
    const status  = document.getElementById('sm-model-load-status');
    const list    = document.getElementById('sm-model-list');
    const current = document.getElementById('sm-model-name').value.trim();
    status.textContent = 'Chargement…'; status.className = 'sm-field-status';
    try {
      const res = await window.settingsApi.listModels({ engine, apiKey, baseUrl });
      if (!res.ok) { status.textContent = `✗ ${res.error}`; status.className = 'sm-field-status err'; return; }
      list.innerHTML = '';
      res.models.forEach(m => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sm-combobox-item' + (m === current ? ' selected' : '');
        btn.textContent = m;
        btn.addEventListener('click', () => {
          document.getElementById('sm-model-name').value = m;
          const primary = document.getElementById('sm-engine').value;
          const engines = { ...currentConfig?.model?.engines, [primary]: { ...currentConfig?.model?.engines?.[primary], model: m } };
          _autoSave({ model: { ...currentConfig.model, engines } });
          _smCloseCombo();
          // Mettre à jour l'état selected visuellement
          list.querySelectorAll('.sm-combobox-item').forEach(el => el.classList.toggle('selected', el.textContent === m));
        });
        btn.addEventListener('keydown', e => {
          const visible = Array.from(list.querySelectorAll('.sm-combobox-item')).filter(el => el.style.display !== 'none');
          const idx = visible.indexOf(btn);
          if (e.key === 'ArrowDown') { e.preventDefault(); visible[idx + 1]?.focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) visible[idx - 1].focus(); else document.getElementById('sm-model-filter').focus(); }
          else if (e.key === 'Escape') { _smCloseCombo(); }
        });
        list.appendChild(btn);
      });
      status.textContent = `${res.models.length} modèle(s) disponible(s)`;
      status.className = 'sm-field-status ok';
      _smOpenCombo();
      // Mémoriser la liste pour le composer (évite un appel API à chaque ouverture du dropdown)
      const _eng = document.getElementById('sm-engine').value;
      const _engines = { ...currentConfig?.model?.engines, [_eng]: { ...currentConfig?.model?.engines?.[_eng], availableModels: res.models } };
      await _autoSave({ model: { ...currentConfig.model, engines: _engines } });
    } catch (err) { status.textContent = `✗ ${err.message}`; status.className = 'sm-field-status err'; }
  });

  // Enregistrer tous les paramètres du modèle (clé optionnelle)
  document.getElementById('btn-settings-save').addEventListener('click', async () => {
    const engine   = document.getElementById('sm-engine').value;
    const apiKey   = document.getElementById('sm-api-key').value.trim();
    const baseUrl  = document.getElementById('sm-base-url').value.trim();
    const modelVal    = document.getElementById('sm-model-name').value.trim();
    const cpuPath     = document.getElementById('sm-cpu-model-path').value.trim();
    const primary  = engine;
    const prevEng  = currentConfig?.model?.engines?.[engine] || {};
    const updEng   = { ...prevEng, baseUrl: baseUrl || prevEng.baseUrl };
    if (modelVal)  updEng.model     = modelVal;
    if (apiKey)    updEng.apiKey    = apiKey;
    if (engine === 'cpu' && cpuPath) updEng.modelPath = cpuPath;
    const engines = { ...currentConfig?.model?.engines, [engine]: updEng };
    await _autoSave({ model: { ...currentConfig.model, primary, engines } });
    if (apiKey) document.getElementById('sm-api-key').value = '';
  });

  // ── Handlers — Onglet Agent ────────────────────────────────────────────────
  document.getElementById('sm-project-root').addEventListener('blur', e => _autoSave({ projectRoot: e.target.value.trim() || null }));
  document.getElementById('sm-approval-mode').addEventListener('change', e => _autoSave({ approvalMode: e.target.checked }));
  document.getElementById('sm-multi-agent').addEventListener('change',   e => _autoSave({ multiAgentMode: e.target.checked }));
  document.getElementById('sm-max-steps').addEventListener('change',     e => _autoSave({ maxSteps: parseInt(e.target.value, 10) || 25 }));
  document.getElementById('sm-retry-parse').addEventListener('change',   e => _autoSave({ retryOnParseError: parseInt(e.target.value, 10) || 2 }));
  document.getElementById('sm-enable-web-search').addEventListener('change', e => _autoSave({ enableWebSearch: e.target.checked }));
  document.getElementById('sm-enable-voice').addEventListener('change', e => _autoSave({ voiceEnabled: e.target.checked }));

  const voiceStatus = document.getElementById('sm-voice-status');
  const voiceDlBtn  = document.getElementById('sm-voice-download');
  let _voiceDownloading = false;
  document.getElementById('sm-voice-model').addEventListener('change', e => {
    voiceStatus.textContent = ''; voiceStatus.className = 'sm-field-status';
    _autoSave({ voiceModel: e.target.value });
  });
  window.settingsApi.onVoiceProgress((p) => {
    if (_voiceDownloading && p?.status === 'progress_total' && typeof p.progress === 'number') {
      voiceStatus.textContent = `Téléchargement… ${Math.round(p.progress)} %`;
    }
  });
  voiceDlBtn.addEventListener('click', async () => {
    const model = document.getElementById('sm-voice-model').value;
    _voiceDownloading = true;
    voiceDlBtn.disabled = true;
    voiceStatus.textContent = 'Téléchargement…'; voiceStatus.className = 'sm-field-status';
    try {
      await _autoSave({ voiceModel: model });
      const res = await window.settingsApi.preloadVoiceModel(model);
      voiceStatus.textContent = res.ok ? '✓ Modèle prêt' : `✗ ${res.detail || res.error || 'Échec'}`;
      voiceStatus.className   = 'sm-field-status ' + (res.ok ? 'ok' : 'err');
    } catch (err) {
      voiceStatus.textContent = `✗ ${err.message}`; voiceStatus.className = 'sm-field-status err';
    } finally {
      _voiceDownloading = false;
      voiceDlBtn.disabled = false;
    }
  });
  document.getElementById('sm-enable-lsp').addEventListener('change', e => {
    _smToggleLspConfig(e.target.checked);
    _autoSave({ enableLsp: e.target.checked });
  });
  const _saveLspServers = () => _autoSave({ lspServers: {
    typescript: document.getElementById('sm-lsp-ts').value.trim() || undefined,
    python:     document.getElementById('sm-lsp-py').value.trim() || undefined,
    rust:       document.getElementById('sm-lsp-rs').value.trim() || undefined,
    go:         document.getElementById('sm-lsp-go').value.trim() || undefined,
  }});
  document.getElementById('sm-lsp-ts').addEventListener('change', _saveLspServers);
  document.getElementById('sm-lsp-py').addEventListener('change', _saveLspServers);
  document.getElementById('sm-lsp-rs').addEventListener('change', _saveLspServers);
  document.getElementById('sm-lsp-go').addEventListener('change', _saveLspServers);
  document.getElementById('sm-enable-feedback-learning').addEventListener('change', e => _autoSave({ enableFeedbackLearning: e.target.checked }));
  document.getElementById('sm-enable-fix-loop').addEventListener('change', e => {
    _smToggleFixLoopConfig(e.target.checked);
    _autoSave({ enableFixLoop: e.target.checked });
  });
  document.getElementById('sm-fix-loop-max-iter').addEventListener('change', e => _autoSave({ fixLoopMaxIterations: parseInt(e.target.value, 10) || 5 }));

  // ── Exemples rapides — vidéo / image ─────────────────────────────────────
  function _renderPromptExamples(type, examples) {
    const listId = type === 'video' ? 'sm-video-examples-list' : 'sm-image-examples-list';
    const configKey = type === 'video' ? 'videoPromptExamples' : 'imagePromptExamples';
    const list = document.getElementById(listId);
    list.innerHTML = '';
    if (!examples.length) {
      list.innerHTML = '<div class="sm-skills-empty">Aucun exemple défini.</div>';
      return;
    }
    examples.forEach((text, idx) => {
      const item = document.createElement('div');
      item.className = 'sm-example-item';
      item.dataset.idx = idx;
      item.innerHTML = `
        <textarea class="sm-example-text" rows="2">${(text || '').replace(/</g, '&lt;')}</textarea>
        <button class="sm-rule-delete" title="Supprimer">×</button>`;
      list.appendChild(item);

      let _t = null;
      item.querySelector('.sm-example-text').addEventListener('input', () => {
        clearTimeout(_t);
        _t = setTimeout(() => {
          const updated = _getExamplesFromDom(listId);
          _autoSave({ [configKey]: updated });
        }, 600);
      });
      item.querySelector('.sm-rule-delete').addEventListener('click', () => {
        const updated = _getExamplesFromDom(listId).filter((_, i) => i !== idx);
        _renderPromptExamples(type, updated);
        _autoSave({ [configKey]: updated });
      });
    });
  }

  function _getExamplesFromDom(listId) {
    const items = document.querySelectorAll(`#${listId} .sm-example-text`);
    return Array.from(items).map(el => el.value.trim()).filter(Boolean);
  }

  document.getElementById('sm-video-add-example').addEventListener('click', () => {
    const current = _getExamplesFromDom('sm-video-examples-list');
    const updated = [...current, ''];
    _renderPromptExamples('video', updated);
    _autoSave({ videoPromptExamples: updated });
    const items = document.querySelectorAll('#sm-video-examples-list .sm-example-text');
    if (items.length) items[items.length - 1].focus();
  });

  document.getElementById('sm-image-add-example').addEventListener('click', () => {
    const current = _getExamplesFromDom('sm-image-examples-list');
    const updated = [...current, ''];
    _renderPromptExamples('image', updated);
    _autoSave({ imagePromptExamples: updated });
    const items = document.querySelectorAll('#sm-image-examples-list .sm-example-text');
    if (items.length) items[items.length - 1].focus();
  });

  // ── Fournisseurs IA ──────────────────────────────────────────────────────
  function _renderCustomProviders(providers) {
    const list = document.getElementById('sm-custom-providers-list');
    list.innerHTML = '';
    if (!providers.length) {
      list.innerHTML = '<div class="sm-custom-providers-empty">Aucun fournisseur personnalisé.</div>';
      return;
    }
    providers.forEach(prov => {
      const row  = document.createElement('div');
      row.className = 'sm-custom-provider-row';
      row.dataset.id = prov.id;
      const dlId = `dl-${prov.id}`;
      const modelOpts = (prov.availableModels || [])
        .map(m => `<option value="${m.replace(/"/g, '&quot;')}">`)
        .join('');
      row.innerHTML = `
        <div class="sm-cp-top">
          <input type="text" class="sm-input sm-custom-provider-name" placeholder="ex: openai" value="${(prov.name || '').replace(/"/g, '&quot;')}" maxlength="40" />
          <input type="text" class="sm-input sm-custom-provider-url"  placeholder="https://api.openai.com/v1" value="${(prov.baseUrl || '').replace(/"/g, '&quot;')}" autocomplete="off" />
          <button class="sm-btn sm-btn-ghost sm-custom-provider-delete" title="Supprimer">×</button>
        </div>
        <input type="password" class="sm-input sm-custom-provider-key" placeholder="Clé API…" value="${(prov.apiKey || '').replace(/"/g, '&quot;')}" autocomplete="off" />
        <div class="sm-cp-model">
          <input type="text" class="sm-input sm-cp-model-input" list="${dlId}" placeholder="Modèle par défaut (optionnel)" value="${(prov.model || '').replace(/"/g, '&quot;')}" autocomplete="off" />
          <datalist id="${dlId}">${modelOpts}</datalist>
          <button class="sm-btn sm-btn-ghost sm-cp-load-models" title="Charger les modèles disponibles">↻</button>
        </div>`;
      list.appendChild(row);

      let _t = null;
      const save = () => {
        clearTimeout(_t);
        _t = setTimeout(() => _autoSave({ customProviders: _getCustomProvidersFromDom() }), 500);
      };
      row.querySelector('.sm-custom-provider-name').addEventListener('input', save);
      row.querySelector('.sm-custom-provider-url').addEventListener('input', save);
      row.querySelector('.sm-custom-provider-key').addEventListener('input', save);
      row.querySelector('.sm-cp-model-input').addEventListener('input', save);
      row.querySelector('.sm-custom-provider-delete').addEventListener('click', () => {
        const updated = (currentConfig.customProviders || []).filter(p => p.id !== prov.id);
        _renderCustomProviders(updated);
        _autoSave({ customProviders: updated });
      });
      row.querySelector('.sm-cp-load-models').addEventListener('click', async () => {
        const btn = row.querySelector('.sm-cp-load-models');
        const key = row.querySelector('.sm-custom-provider-key').value.trim();
        const url = row.querySelector('.sm-custom-provider-url').value.trim();
        if (!key || !url) return;
        btn.textContent = '…'; btn.disabled = true;
        try {
          const res = await window.settingsApi.listModels({ engine: 'openai-compat', apiKey: key, baseUrl: url });
          if (!res.ok) throw new Error(res.error);
          const dl = document.getElementById(dlId);
          dl.innerHTML = res.models.map(m => `<option value="${m.replace(/"/g, '&quot;')}">`).join('');
          const providers = _getCustomProvidersFromDom();
          const idx = providers.findIndex(p => p.id === prov.id);
          if (idx !== -1) providers[idx].availableModels = res.models;
          _autoSave({ customProviders: providers });
        } catch { /* silent */ }
        finally { btn.textContent = '↻'; btn.disabled = false; }
      });
    });
  }

  function _getCustomProvidersFromDom() {
    return Array.from(document.querySelectorAll('#sm-custom-providers-list .sm-custom-provider-row')).map(row => {
      const id     = row.dataset.id;
      const cached = (currentConfig?.customProviders || []).find(p => p.id === id);
      const model  = row.querySelector('.sm-cp-model-input')?.value?.trim();
      const entry  = {
        id,
        name:    row.querySelector('.sm-custom-provider-name').value.trim(),
        baseUrl: row.querySelector('.sm-custom-provider-url').value.trim(),
        apiKey:  row.querySelector('.sm-custom-provider-key').value,
      };
      if (model)                    entry.model          = model;
      if (cached?.availableModels)  entry.availableModels = cached.availableModels;
      return entry;
    }).filter(p => p.name || p.apiKey);
  }

  document.getElementById('sm-add-custom-provider').addEventListener('click', () => {
    const newProv = { id: `prov-${Date.now()}`, name: '', baseUrl: '', apiKey: '' };
    const updated = [...(currentConfig.customProviders || []), newProv];
    _renderCustomProviders(updated);
    _autoSave({ customProviders: updated });
    const rows = document.querySelectorAll('#sm-custom-providers-list .sm-custom-provider-name');
    if (rows.length) rows[rows.length - 1].focus();
  });

  document.getElementById('sm-enable-shell').addEventListener('change',     e => _autoSave({ enableShell: e.target.checked }));
  document.getElementById('sm-enable-git-write').addEventListener('change', e => _autoSave({ enableGitWrite: e.target.checked }));
  document.getElementById('sm-enable-deploy').addEventListener('change',    e => _autoSave({ enableDeploy: e.target.checked }));
  document.getElementById('sm-auto-format').addEventListener('change',      e => _autoSave({ autoFormat: e.target.checked }));
  document.getElementById('sm-auto-backup').addEventListener('change',      e => _autoSave({ backupBeforeWrite: e.target.checked }));
  document.getElementById('sm-max-backups').addEventListener('change',   e => _autoSave({ maxBackups: parseInt(e.target.value, 10) || 50 }));
  document.getElementById('sm-context-budget').addEventListener('change',e => _autoSave({ maxContextChars: parseInt(e.target.value, 10) || 12000 }));

  document.getElementById('sm-choose-folder').addEventListener('click', async () => {
    const folder = await window.settingsApi.selectFolder();
    if (folder) { document.getElementById('sm-project-root').value = folder; _autoSave({ projectRoot: folder }); }
  });

  // ── Handlers — Onglet Skills & Règles ─────────────────────────────────────
  function _renderRules(rules) {
    const list = document.getElementById('sm-rules-list');
    list.innerHTML = '';
    if (!rules.length) {
      list.innerHTML = '<div class="sm-skills-empty">Aucune règle définie.</div>';
      return;
    }
    rules.forEach(rule => {
      const item = document.createElement('div');
      item.className = 'sm-rule-item';
      item.dataset.id = rule.id;
      item.innerHTML = `
        <label class="sm-toggle sm-rule-enabled-toggle" title="${rule.enabled !== false ? 'Désactiver' : 'Activer'}">
          <input type="checkbox" class="sm-rule-enabled" ${rule.enabled !== false ? 'checked' : ''} />
          <span class="sm-toggle-track"></span>
        </label>
        <div class="sm-rule-fields">
          <input type="text" class="sm-rule-name" maxlength="40" placeholder="Nom court (ex: Style strict)" value="${(rule.name || '').replace(/"/g, '&quot;')}">
          <textarea class="sm-rule-text" rows="2" placeholder="Ex: Réponds toujours en français.">${rule.text || ''}</textarea>
        </div>
        <button class="sm-rule-delete" title="Supprimer">×</button>`;
      list.appendChild(item);

      let _ruleTimer = null;
      item.querySelector('.sm-rule-enabled').addEventListener('change', e => {
        rule.enabled = e.target.checked;
        _saveRulesFromDom();
      });
      item.querySelector('.sm-rule-name').addEventListener('input', () => {
        clearTimeout(_ruleTimer);
        _ruleTimer = setTimeout(() => _saveRulesFromDom(), 600);
      });
      item.querySelector('.sm-rule-text').addEventListener('input', () => {
        clearTimeout(_ruleTimer);
        _ruleTimer = setTimeout(() => {
          rule.text = item.querySelector('.sm-rule-text').value;
          _saveRulesFromDom();
        }, 600);
      });
      item.querySelector('.sm-rule-delete').addEventListener('click', () => {
        const rules2 = (currentConfig.customRules || []).filter(r => r.id !== rule.id);
        _renderRules(rules2);
        _autoSave({ customRules: rules2 });
      });
    });
  }

  function _saveRulesFromDom() {
    const rules = [];
    document.querySelectorAll('#sm-rules-list .sm-rule-item').forEach(item => {
      const text = item.querySelector('.sm-rule-text').value;
      const rawName = item.querySelector('.sm-rule-name')?.value?.trim() || '';
      const name = rawName || text.slice(0, 40) + (text.length > 40 ? '…' : '');
      rules.push({
        id: item.dataset.id,
        name,
        text,
        enabled: item.querySelector('.sm-rule-enabled').checked,
      });
    });
    _autoSave({ customRules: rules });
  }

  document.getElementById('sm-add-rule').addEventListener('click', () => {
    const newRule = { id: `rule-${Date.now()}`, name: '', text: '', enabled: true };
    const rules = [...(currentConfig.customRules || []), newRule];
    _renderRules(rules);
    _autoSave({ customRules: rules });
    const items = document.querySelectorAll('#sm-rules-list .sm-rule-item');
    if (items.length) items[items.length - 1].querySelector('.sm-rule-name').focus();
  });

  // ── Handlers — Skills ────────────────────────────────────────────────────
  function _renderSkills(skills) {
    const list = document.getElementById('sm-skills-list');
    list.innerHTML = '';
    if (!skills.length) {
      list.innerHTML = '<div class="sm-skills-empty">Aucun skill installé pour l\'instant.</div>';
      return;
    }
    skills.forEach(skill => {
      const item = document.createElement('div');
      item.className = 'sm-skill-item';
      item.dataset.id = skill.id;
      item.innerHTML = `
        <label class="sm-toggle" title="${skill.enabled !== false ? 'Désactiver' : 'Activer'}">
          <input type="checkbox" class="sm-skill-enabled" ${skill.enabled !== false ? 'checked' : ''} />
          <span class="sm-toggle-track"></span>
        </label>
        <div class="sm-skill-fields">
          <input type="text" class="sm-skill-name-input" maxlength="60" placeholder="Nom du skill" value="${(skill.name || '').replace(/"/g, '&quot;')}">
          <input type="text" class="sm-skill-desc-input" maxlength="120" placeholder="Description courte (optionnel)" value="${(skill.description || '').replace(/"/g, '&quot;')}">
          <textarea class="sm-skill-prompt-input" rows="3" placeholder="Instructions système du skill (comportement, règles, contexte)…">${skill.systemPrompt || ''}</textarea>
        </div>
        <button class="sm-skill-delete" title="Désinstaller">×</button>`;
      list.appendChild(item);
      let _skillTimer = null;
      const debounce = () => { clearTimeout(_skillTimer); _skillTimer = setTimeout(() => _saveSkillsFromDom(), 600); };
      item.querySelector('.sm-skill-enabled').addEventListener('change', () => _saveSkillsFromDom());
      item.querySelector('.sm-skill-name-input').addEventListener('input', debounce);
      item.querySelector('.sm-skill-desc-input').addEventListener('input', debounce);
      item.querySelector('.sm-skill-prompt-input').addEventListener('input', debounce);
      item.querySelector('.sm-skill-delete').addEventListener('click', () => {
        const updated = (currentConfig.customSkills || []).filter(s => s.id !== skill.id);
        _renderSkills(updated);
        _autoSave({ customSkills: updated });
      });
    });
  }

  function _saveSkillsFromDom() {
    const skills = [];
    document.querySelectorAll('#sm-skills-list .sm-skill-item').forEach(item => {
      skills.push({
        id: item.dataset.id,
        name: item.querySelector('.sm-skill-name-input').value.trim(),
        description: item.querySelector('.sm-skill-desc-input').value.trim(),
        systemPrompt: item.querySelector('.sm-skill-prompt-input').value,
        enabled: item.querySelector('.sm-skill-enabled').checked,
      });
    });
    _autoSave({ customSkills: skills });
  }

  document.getElementById('sm-add-skill').addEventListener('click', () => {
    const newSkill = { id: `skill-${Date.now()}`, name: '', description: '', systemPrompt: '', enabled: true };
    const skills = [...(currentConfig.customSkills || []), newSkill];
    _renderSkills(skills);
    _autoSave({ customSkills: skills });
    const items = document.querySelectorAll('#sm-skills-list .sm-skill-item');
    if (items.length) items[items.length - 1].querySelector('.sm-skill-name-input').focus();
  });

  // ── Tokens API REST ───────────────────────────────────────────────────────
  function _renderApiTokens(tokens) {
    const list = document.getElementById('sm-tokens-list');
    list.innerHTML = '';
    const entries = Object.entries(tokens);
    if (!entries.length) {
      list.innerHTML = '<div class="sm-skills-empty">Aucun token configuré.</div>';
      return;
    }
    entries.forEach(([key, value]) => {
      const item = document.createElement('div');
      item.className = 'sm-token-item';
      item.dataset.key = key;
      item.innerHTML = `
        <input type="text"     class="sm-token-key"   placeholder="Nom (ex: github)"  value="${key.replace(/"/g,'&quot;')}">
        <input type="password" class="sm-token-value" placeholder="Bearer token…"     value="${value.replace(/"/g,'&quot;')}">
        <button class="sm-token-delete" title="Supprimer">×</button>`;
      list.appendChild(item);
      let _timer = null;
      const debounce = () => { clearTimeout(_timer); _timer = setTimeout(() => _saveTokensFromDom(), 700); };
      item.querySelector('.sm-token-key').addEventListener('input',   debounce);
      item.querySelector('.sm-token-value').addEventListener('input', debounce);
      item.querySelector('.sm-token-delete').addEventListener('click', () => {
        const updated = _collectTokens();
        delete updated[key];
        _renderApiTokens(updated);
        _autoSave({ apiTokens: updated });
      });
    });
  }

  function _collectTokens() {
    const tokens = {};
    document.querySelectorAll('#sm-tokens-list .sm-token-item').forEach(item => {
      const k = item.querySelector('.sm-token-key').value.trim();
      const v = item.querySelector('.sm-token-value').value;
      if (k) tokens[k] = v;
    });
    return tokens;
  }

  function _saveTokensFromDom() {
    _autoSave({ apiTokens: _collectTokens() });
  }

  document.getElementById('sm-add-token').addEventListener('click', () => {
    const current = _collectTokens();
    const newKey  = `token_${Date.now()}`;
    current[newKey] = '';
    _renderApiTokens(current);
    _autoSave({ apiTokens: current });
    const items = document.querySelectorAll('#sm-tokens-list .sm-token-item');
    if (items.length) {
      const last = items[items.length - 1];
      last.querySelector('.sm-token-key').select();
      last.querySelector('.sm-token-key').focus();
    }
  });

  // ── Handlers — Onglet MCP ─────────────────────────────────────────────────
  function _renderConnectors(conns) {
    const list = document.getElementById('sm-connectors-list');
    list.innerHTML = '';
    if (!conns.length) {
      list.innerHTML = '<div class="sm-connectors-empty">Aucun connecteur MCP configuré.</div>';
      return;
    }
    conns.forEach(conn => {
      const item = document.createElement('div');
      item.className = 'sm-connector-item';
      item.dataset.id = conn.id;
      item.innerHTML = `
        <label class="sm-toggle" title="${conn.enabled !== false ? 'Désactiver' : 'Activer'}">
          <input type="checkbox" class="sm-conn-enabled" ${conn.enabled !== false ? 'checked' : ''} />
          <span class="sm-toggle-track"></span>
        </label>
        <div class="sm-conn-info">
          <div class="sm-conn-name">${conn.name || '—'}</div>
          <div class="sm-conn-meta">${conn.type || 'http'} · ${conn.url || ''}</div>
        </div>
        <button class="sm-conn-delete" title="Supprimer">×</button>`;
      list.appendChild(item);
      item.querySelector('.sm-conn-enabled').addEventListener('change', () => _saveConnectorsFromDom(conns));
      item.querySelector('.sm-conn-delete').addEventListener('click', () => {
        const conns2 = (currentConfig.connectors || []).filter(c => c.id !== conn.id);
        _renderConnectors(conns2);
        _autoSave({ connectors: conns2 });
      });
    });
  }

  function _saveConnectorsFromDom(conns) {
    const updated = (conns || currentConfig.connectors || []).map(c => {
      const item = document.querySelector(`#sm-connectors-list [data-id="${c.id}"]`);
      if (!item) return c;
      return { ...c, enabled: item.querySelector('.sm-conn-enabled').checked };
    });
    _autoSave({ connectors: updated });
  }

  function _smConnTypeUpdate(type) {
    const isStdio = type === 'stdio';
    document.getElementById('sm-conn-row-args').classList.toggle('sm-hidden', !isStdio);
    document.getElementById('sm-conn-url-label').textContent = isStdio ? 'Commande (ex. npx, node, python)' : 'URL du serveur';
    document.getElementById('sm-conn-url').placeholder = isStdio
      ? 'npx @modelcontextprotocol/server-filesystem'
      : 'https://mon-serveur-mcp.com/sse';
  }
  document.getElementById('sm-conn-type').addEventListener('change', e => _smConnTypeUpdate(e.target.value));
  document.getElementById('sm-add-connector').addEventListener('click', () => {
    _smConnTypeUpdate(document.getElementById('sm-conn-type').value);
    document.getElementById('sm-conn-form').classList.remove('sm-hidden');
    document.getElementById('sm-conn-name').focus();
  });
  document.getElementById('sm-conn-cancel').addEventListener('click', () => {
    document.getElementById('sm-conn-form').classList.add('sm-hidden');
    ['sm-conn-name','sm-conn-url','sm-conn-auth','sm-conn-args'].forEach(id => { document.getElementById(id).value = ''; });
  });
  document.getElementById('sm-conn-save').addEventListener('click', () => {
    const name = document.getElementById('sm-conn-name').value.trim();
    const url  = document.getElementById('sm-conn-url').value.trim();
    const type = document.getElementById('sm-conn-type').value;
    if (!name || !url) { _flashStatus(false, '⚠ Nom et commande/URL requis'); return; }
    const argsRaw = document.getElementById('sm-conn-args').value.trim();
    const args = argsRaw ? argsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const newConn = {
      id: `conn-${Date.now()}`, name, type, url, args,
      auth: document.getElementById('sm-conn-auth').value.trim(),
      enabled: true,
    };
    const conns = [...(currentConfig.connectors || []), newConn];
    _renderConnectors(conns);
    _autoSave({ connectors: conns });
    document.getElementById('sm-conn-cancel').click();
  });

  // ── Handlers — Onglet Thèmes (live preview) ───────────────────────────────
  document.querySelectorAll('.sm-theme-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.sm-theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      document.documentElement.setAttribute('data-theme', card.dataset.theme);
      _autoSave({ theme: card.dataset.theme });
    });
  });
  document.querySelectorAll('.sm-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.sm-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      document.documentElement.style.setProperty('--accent', sw.dataset.accent);
      document.documentElement.style.setProperty('--accent-hover', sw.dataset.accent + 'cc');
      _autoSave({ accentColor: sw.dataset.accent });
    });
  });
  document.querySelectorAll('.sm-font-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.sm-font-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      // Même règle que la fenêtre principale : interface + code.
      // Pile identique pour --mono et --font : une police absente retombe sur
      // Cascadia/Consolas au lieu de Segoe UI (clic qui semblait sans effet).
      const family = card.dataset.font === 'monospace' ? 'monospace' : `'${card.dataset.font}'`;
      const stack  = `${family}, 'Cascadia Code', 'Consolas', monospace`;
      document.documentElement.style.setProperty('--mono', stack);
      document.documentElement.style.setProperty('--font', stack);
      _autoSave({ codeFont: card.dataset.font });
    });
  });
  document.querySelectorAll('.sm-density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sm-density-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.setAttribute('data-density', btn.dataset.density);
      _autoSave({ density: btn.dataset.density });
    });
  });

  // ── Sync depuis la fenêtre principale ─────────────────────────────────────
  // Quand la fenêtre principale change la config (model pill, nouveau projet,
  // toggles shell/deploy), on reçoit CONFIG_UPDATED. On re-synchronise
  // currentConfig ET les champs du formulaire pour éviter qu'un _autoSave
  // ultérieur n'écrase les changements de la fenêtre principale.
  window.settingsApi.onConfigUpdated((newConfig) => {
    currentConfig = newConfig;
    _fillSettings(newConfig);
    _applyVisualSettings(newConfig);
  });

  // ── Planificateur ─────────────────────────────────────────────────────────

  function _cronLabel(cron) {
    const map = {
      '0 9 * * 1-5': 'Lun–Ven 9h',
      '0 9 * * *':   'Quotidien 9h',
      '0 8 * * 1':   'Lundi 8h',
      '0 */2 * * *': 'Toutes les 2h',
    };
    return map[cron] || cron;
  }

  async function _smRenderSchedulerTasks() {
    const list = document.getElementById('sm-sched-list');
    if (!list) return;
    try {
      const res = await window.settingsApi.scheduleList();
      const tasks = res?.tasks || [];
      if (tasks.length === 0) {
        list.innerHTML = '<p class="sm-hint">Aucune tâche planifiée.</p>';
        return;
      }
      list.innerHTML = tasks.map(t => `
        <div class="sm-sched-row" data-id="${t.id.replace(/"/g,'&quot;')}">
          <div class="sm-sched-info">
            <span class="sm-sched-label">${t.label.replace(/</g,'&lt;')}</span>
            <span class="sm-sched-cron">${_cronLabel(t.cron)}</span>
          </div>
          <div class="sm-sched-btns">
            <button class="sm-sched-toggle sm-btn sm-btn-secondary" data-id="${t.id}" title="${t.enabled ? 'Désactiver' : 'Activer'}">${t.enabled ? 'Actif' : 'Inactif'}</button>
            <button class="sm-sched-run sm-btn sm-btn-secondary"    data-id="${t.id}" title="Lancer maintenant">▶</button>
            <button class="sm-sched-del sm-btn sm-btn-danger"       data-id="${t.id}" title="Supprimer">✕</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.sm-sched-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.settingsApi.scheduleToggle(btn.dataset.id);
          _smRenderSchedulerTasks();
        });
      });
      list.querySelectorAll('.sm-sched-run').forEach(btn => {
        btn.addEventListener('click', () => window.settingsApi.scheduleRun(btn.dataset.id));
      });
      list.querySelectorAll('.sm-sched-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.settingsApi.scheduleDelete(btn.dataset.id);
          _smRenderSchedulerTasks();
        });
      });
    } catch {
      list.innerHTML = '<p class="sm-hint">Erreur de chargement.</p>';
    }
  }

  // Charger les tâches quand l'onglet devient actif
  document.querySelectorAll('.sm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'scheduler') _smRenderSchedulerTasks();
    });
  });

  // Formulaire d'ajout
  const _smSchedPreset = document.getElementById('sm-sched-cron-preset');
  const _smSchedCustomRow = document.getElementById('sm-sched-custom-row');

  _smSchedPreset?.addEventListener('change', () => {
    const isCustom = _smSchedPreset.value === 'custom';
    if (_smSchedCustomRow) _smSchedCustomRow.style.display = isCustom ? '' : 'none';
  });

  document.getElementById('sm-sched-add')?.addEventListener('click', async () => {
    const label = document.getElementById('sm-sched-label')?.value.trim();
    const task  = document.getElementById('sm-sched-task')?.value.trim();
    const cron  = _smSchedPreset?.value === 'custom'
      ? (document.getElementById('sm-sched-cron-custom')?.value.trim() || '')
      : (_smSchedPreset?.value || '');
    const statusEl = document.getElementById('sm-sched-status');
    if (!label || !task || !cron) {
      if (statusEl) { statusEl.textContent = '✗ Tous les champs sont requis'; statusEl.className = 'sm-field-status err'; }
      return;
    }
    const res = await window.settingsApi.scheduleAdd({ label, task, cron });
    if (res?.ok) {
      document.getElementById('sm-sched-label').value = '';
      document.getElementById('sm-sched-task').value  = '';
      if (statusEl) { statusEl.textContent = '✓ Tâche ajoutée'; statusEl.className = 'sm-field-status ok'; setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sm-field-status'; }, 2000); }
      _smRenderSchedulerTasks();
    } else {
      if (statusEl) { statusEl.textContent = `✗ ${res?.error || 'Erreur'}`; statusEl.className = 'sm-field-status err'; }
    }
  });

});
