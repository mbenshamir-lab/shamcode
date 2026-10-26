// Renderer caché — chargement et exécution du modèle WebLLM via WebGPU.
// Module ESM (type="module" dans llm.html). Jamais visible par l'utilisateur.

const bridge = window.llmBridge; // exposé par preload-hidden.js
const DEFAULT_MODEL = 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC';

// ── Attendre la config du main process (modèle, options) ─────────────────────
// Enregistré AVANT l'import : le main envoie llm:config au did-finish-load, qui
// arrive avant la fin d'un await de premier niveau — sinon le message est perdu
// et le modèle par défaut est chargé au lieu de celui choisi dans les paramètres.
const engineConfig = await new Promise(resolve => {
  const t = setTimeout(() => resolve({ model: DEFAULT_MODEL }), 5000);
  bridge.onConfig(cfg => { clearTimeout(t); resolve(cfg); });
});

// Import dynamique : si le CDN est inaccessible, on capture l'erreur et on
// signale l'échec via notifyReady au lieu de planter silencieusement.
let CreateMLCEngine;
try {
  const mod = await import('https://esm.run/@mlc-ai/web-llm');
  CreateMLCEngine = mod.CreateMLCEngine;
} catch (err) {
  bridge.notifyReady({ ready: false, error: `Import WebLLM échoué : ${err.message}` });
  throw err; // arrêter l'exécution du module
}

const modelId = engineConfig.model || DEFAULT_MODEL;

// ── Moteur WebLLM ─────────────────────────────────────────────────────────────
let engine = null;

async function init() {
  try {
    if (!navigator.gpu) {
      throw new Error('WebGPU non disponible — GPU non supporté ou pilotes trop anciens');
    }

    // Adaptateur sans shader-f16 (GPU débloqué par --ignore-gpu-blocklist, rendu
    // logiciel) : un modèle q4f16 ne peut pas y être chargé. On prend la variante
    // q4f32 du même modèle, identique en taille de vocabulaire et de qualité.
    let model = modelId;
    if (/-q4f16_1-/.test(model)) {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter || !adapter.features.has('shader-f16')) {
        model = model.replace('-q4f16_1-', '-q4f32_1-');
      }
    }

    engine = await CreateMLCEngine(model, {
      initProgressCallback: ({ progress = 0, text = '' }) => {
        bridge.notifyProgress({ progress, text });
      },
    });

    bridge.notifyReady({ ready: true, model });
  } catch (err) {
    // L'erreur remonte au main qui la transmet à l'UI — le router bascule sur cloud
    bridge.notifyReady({ ready: false, error: err.message });
  }
}

// ── Écouter les requêtes de génération ───────────────────────────────────────
bridge.onRequest(async ({ messages, options = {}, replyChannel }) => {
  if (!engine) {
    bridge.sendReply(replyChannel, { error: 'Moteur WebLLM non chargé — en attente ou erreur de démarrage' });
    return;
  }
  try {
    const result = await engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens:  options.maxTokens  ?? 4096,
    });
    bridge.sendReply(replyChannel, { text: result.choices[0].message.content });
  } catch (err) {
    bridge.sendReply(replyChannel, { error: err.message });
  }
});

// ── Décharger le modèle à la fermeture de l'app ──────────────────────────────
bridge.onUnload(async () => {
  if (engine) {
    try { await engine.unload(); } catch { /* ignoré — déjà libéré ou non supporté */ }
    engine = null;
  }
});

// ── Vider le cache disque du modèle (bouton "Supprimer le modèle") ────────────
bridge.onClearCache(async () => {
  try {
    if (engine) {
      try { await engine.unload(); } catch { /* ignoré */ }
      engine = null;
    }
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    bridge.notifyCacheClear({ ok: true });
  } catch (err) {
    bridge.notifyCacheClear({ ok: false, error: err.message });
  }
});

// ── Démarrer ──────────────────────────────────────────────────────────────────
init();
