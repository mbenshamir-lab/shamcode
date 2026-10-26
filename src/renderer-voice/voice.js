// Renderer caché « voix » — transcription Whisper locale (Transformers.js, WASM).
// Module ESM. Le modèle n'est chargé qu'à la première dictée, puis mis en cache.

const bridge = window.voiceBridge; // exposé par preload-voice.js
const MODEL_IDS = {
  base:  'onnx-community/whisper-base',   // ~75 Mo — rapide (défaut)
  small: 'onnx-community/whisper-small',  // ~250 Mo — plus précis
};

// Whisper détecte mal la langue sur une phrase très courte : on la fixe d'après l'UI.
const LANGUAGES = { fr: 'french', en: 'english', es: 'spanish', de: 'german', it: 'italian', pt: 'portuguese', ar: 'arabic' };
const language = LANGUAGES[(navigator.language || '').slice(0, 2).toLowerCase()];

// Un seul modèle en mémoire à la fois : changer de taille libère l'ancien.
let _transcriber = null;
let _loadedKey   = null;

function _loadTranscriber(key) {
  if (_loadedKey !== key) { _transcriber = null; _loadedKey = key; }
  if (!_transcriber) {
    _transcriber = (async () => {
      const { pipeline, env } = await import('../../node_modules/@huggingface/transformers/dist/transformers.min.js'); // build autonome : le build « web » importe onnxruntime-web par nom nu (invalide en file://)
      env.allowLocalModels = false; // modèle récupéré sur le Hub puis servi par le cache navigateur
      // WASM local (pas de CDN) ; mono-thread car file:// n'est pas cross-origin isolated.
      env.backends.onnx.wasm.wasmPaths = new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url).href;
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline('automatic-speech-recognition', MODEL_IDS[key], {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => bridge.notifyProgress({ status: p.status, file: p.file, progress: p.progress }),
      });
    })().catch((err) => { _transcriber = null; throw err; });
  }
  return _transcriber;
}

// Whisper attend du PCM 16 kHz mono : l'AudioContext décode et rééchantillonne.
async function _decode(raw) {
  const buffer = raw instanceof ArrayBuffer
    ? raw
    : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(buffer);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

bridge.onRequest(async ({ audio, model, preload, replyChannel }) => {
  const key = MODEL_IDS[model] ? model : 'base';
  try {
    if (preload) { // téléchargement seul (bouton des Paramètres), sans audio
      await _loadTranscriber(key);
      bridge.sendReply(replyChannel, { text: '' });
      return;
    }
    const pcm = await _decode(audio);
    const transcriber = await _loadTranscriber(key);
    const out = await transcriber(pcm, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    bridge.sendReply(replyChannel, { text: (out.text || '').trim() });
  } catch (err) {
    bridge.sendReply(replyChannel, { error: err.message });
  }
});
