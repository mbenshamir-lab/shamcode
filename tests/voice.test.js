'use strict';

/**
 * Tests Phase 113 — dictée vocale (Whisper local + condensé LLM)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { condenseDictation, MIN_CHARS_TO_CONDENSE } = require('../src/harness/voice/summarize');

const LONG = 'euh alors je voudrais que tu ajoutes un bouton pour exporter en CSV dans le fichier app point js voilà';

describe('condenseDictation — condensé de la dictée par le LLM', () => {
  it('texte vide → vide, LLM jamais appelé', async () => {
    let called = false;
    const r = await condenseDictation('   ', async () => { called = true; return 'x'; });
    assert.deepEqual(r, { text: '', condensed: false });
    assert.equal(called, false);
  });

  it('dictée courte → texte brut sans appel LLM', async () => {
    let called = false;
    const short = 'lance les tests';
    assert.ok(short.length < MIN_CHARS_TO_CONDENSE);
    const r = await condenseDictation(short, async () => { called = true; return 'x'; });
    assert.deepEqual(r, { text: short, condensed: false });
    assert.equal(called, false);
  });

  it('dictée longue → texte reformulé par le LLM', async () => {
    const r = await condenseDictation(LONG, async () => 'Ajoute un export CSV dans app.js.');
    assert.deepEqual(r, { text: 'Ajoute un export CSV dans app.js.', condensed: true });
  });

  it('le prompt contient la transcription et demande de garder l\'idée principale', async () => {
    let seen;
    await condenseDictation(LONG, async (msgs, opts) => { seen = { msgs, opts }; return 'ok'; });
    assert.equal(seen.msgs[0].role, 'system');
    assert.match(seen.msgs[0].content, /idée principale/);
    assert.equal(seen.msgs[1].content, LONG);
    assert.ok(seen.opts.temperature <= 0.3);
  });

  it('retire les guillemets autour de la réponse', async () => {
    const r = await condenseDictation(LONG, async () => '« Ajoute un export CSV. »');
    assert.equal(r.text, 'Ajoute un export CSV.');
  });

  it('LLM en erreur → repli sur la transcription brute', async () => {
    const r = await condenseDictation(LONG, async () => { throw new Error('réseau'); });
    assert.deepEqual(r, { text: LONG, condensed: false });
  });

  it('LLM qui répond vide → repli sur la transcription brute', async () => {
    const r = await condenseDictation(LONG, async () => '  ');
    assert.deepEqual(r, { text: LONG, condensed: false });
  });

  it('sans llmGenerate → transcription brute', async () => {
    const r = await condenseDictation(LONG, undefined);
    assert.deepEqual(r, { text: LONG, condensed: false });
  });
});

describe('harness/voice — indépendant d\'Electron', () => {
  it('summarize.js n\'importe pas electron', () => {
    assert.ok(!/require\(['"]electron['"]\)/.test(read('src/harness/voice/summarize.js')));
  });
});

describe('constants.js — canaux IPC voix', () => {
  const { IPC } = require('../src/shared/constants');
  it('4 canaux distincts', () => {
    const v = [IPC.VOICE_TRANSCRIBE, IPC.VOICE_REQUEST, IPC.VOICE_REPLY, IPC.VOICE_PROGRESS];
    v.forEach(x => assert.equal(typeof x, 'string'));
    assert.equal(new Set(v).size, 4);
  });
});

describe('config — activation de la dictée', () => {
  it('voiceEnabled est désactivé par défaut', () => {
    const { DEFAULTS } = require('../src/main/config');
    assert.equal(DEFAULTS.voiceEnabled, false);
  });

  it('settings.html : interrupteur sm-enable-voice', () => {
    assert.ok(read('src/renderer-settings/settings.html').includes('id="sm-enable-voice"'));
  });

  it('settings.js : lit et sauvegarde voiceEnabled', () => {
    const js = read('src/renderer-settings/settings.js');
    assert.ok(js.includes("getElementById('sm-enable-voice').checked"));
    assert.ok(/_autoSave\(\{ voiceEnabled:/.test(js));
  });
});

describe('précision de la dictée (base / small)', () => {
  it('voiceModel vaut base par défaut', () => {
    assert.equal(require('../src/main/config').DEFAULTS.voiceModel, 'base');
  });

  it('normalizeVoiceModel : valeur inconnue → base', () => {
    // voice.js requiert electron : on teste la fonction pure via sa source
    const src = read('src/main/voice.js');
    assert.ok(/VOICE_MODELS = \['base', 'small'\]/.test(src));
    assert.ok(/VOICE_MODELS\.includes\(model\) \? model : 'base'/.test(src));
  });

  it('settings : sélecteur + bouton Télécharger + statut', () => {
    const h = read('src/renderer-settings/settings.html');
    assert.ok(h.includes('id="sm-voice-model"') && h.includes('value="small"'));
    assert.ok(h.includes('id="sm-voice-download"') && h.includes('id="sm-voice-status"'));
  });

  it('settings.js : sauvegarde voiceModel et lance le préchargement', () => {
    const js = read('src/renderer-settings/settings.js');
    assert.ok(/_autoSave\(\{ voiceModel:/.test(js));
    assert.ok(js.includes('preloadVoiceModel(model)'));
  });

  it('main : handler voice:preload + modèle transmis à la transcription', () => {
    const ipc = read('src/main/ipc.js');
    assert.ok(ipc.includes('IPC.VOICE_PRELOAD') && ipc.includes('preloadVoiceModel(model)'));
    assert.ok(ipc.includes('transcribeAudio(audio, config.voiceModel)'));
  });

  it('preload-settings.js expose preloadVoiceModel et onVoiceProgress', () => {
    const p = read('src/main/preload-settings.js');
    assert.ok(p.includes('preloadVoiceModel') && p.includes('onVoiceProgress'));
  });

  it('la progression est relayée à toutes les fenêtres sauf la voix', () => {
    assert.ok(/ipcMain\.on\(IPC\.VOICE_PROGRESS[\s\S]{0,200}win\.webContents !== event\.sender/.test(read('src/main/ipc.js')));
  });
});

describe('main — chaîne audio → texte', () => {
  const ipc = read('src/main/ipc.js');

  it('le handler refuse si la dictée est désactivée', () => {
    assert.ok(/IPC\.VOICE_TRANSCRIBE[\s\S]{0,200}voiceEnabled[\s\S]{0,80}VOICE_DISABLED/.test(ipc));
  });

  it('le handler transcrit puis condense via le router', () => {
    assert.ok(ipc.includes('transcribeAudio(audio, config.voiceModel)'));
    assert.ok(/condenseDictation\(raw,[\s\S]{0,80}router\.generate/.test(ipc));
  });

  it('preload.js expose transcribeVoice et onVoiceProgress', () => {
    const p = read('src/main/preload.js');
    assert.ok(p.includes('transcribeVoice') && p.includes('onVoiceProgress'));
  });

  it('la fenêtre voix est créée à la demande, cachée, sans throttling', () => {
    const w = read('src/main/windows.js');
    assert.ok(/function getVoiceWindow\(\)[\s\S]{0,400}show: false[\s\S]{0,400}backgroundThrottling: false/.test(w));
    assert.ok(!/getVoiceWindow\(\)/.test(w.slice(w.indexOf('function createWindows'), w.indexOf('function openSettingsWindow'))),
      'la fenêtre voix ne doit pas être créée au démarrage');
  });

  it('preload-voice.js expose voiceBridge via contextBridge', () => {
    const p = read('src/main/preload-voice.js');
    assert.ok(p.includes("'voiceBridge'") && p.includes('contextBridge'));
  });
});

describe('renderer-voice — Whisper local sans CDN', () => {
  const js = read('src/renderer-voice/voice.js');

  it('importe le build autonome (pas le build « web » à import nu)', () => {
    assert.ok(js.includes('transformers.min.js'));
    assert.ok(!js.includes('transformers.web'));
  });

  it('le fichier importé existe', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'node_modules/@huggingface/transformers/dist/transformers.min.js')));
  });

  it('WASM servi depuis node_modules (pas de CDN)', () => {
    assert.ok(js.includes('onnxruntime-web/dist/'));
    assert.ok(!/https?:\/\//.test(js));
  });

  it('modèles Whisper multilingues base et small', () => {
    assert.ok(js.includes("'onnx-community/whisper-base'"));
    assert.ok(js.includes("'onnx-community/whisper-small'"));
  });

  it('un seul modèle en mémoire : changer de taille recharge', () => {
    assert.ok(/_loadedKey !== key[\s\S]{0,40}_transcriber = null/.test(js));
  });

  it('mode preload : télécharge sans audio', () => {
    assert.ok(/if \(preload\)[\s\S]{0,200}_loadTranscriber\(key\)/.test(js));
  });

  it('voice.html charge voice.js en module', () => {
    assert.ok(/<script type="module" src="voice\.js">/.test(read('src/renderer-voice/voice.html')));
  });
});

describe('renderer-visible — bouton micro', () => {
  it('btn-mic est masqué par défaut dans index.html', () => {
    assert.ok(/id="btn-mic" class="[^"]*\bhidden\b/.test(read('src/renderer-visible/index.html')));
  });

  it('app.js : clic → enregistrement, visibilité liée à voiceEnabled', () => {
    const js = read('src/renderer-visible/app.js');
    assert.ok(js.includes('getUserMedia'));
    assert.ok(js.includes('transcribeVoice'));
    assert.ok(js.includes('cfg?.voiceEnabled'));
    assert.ok((js.match(/_micRefreshVisibility\(/g) || []).length >= 3, 'init + onConfigUpdated + définition');
  });

  it('app.js : le texte dicté est inséré, jamais envoyé automatiquement', () => {
    const js = read('src/renderer-visible/app.js');
    const fin = js.slice(js.indexOf('async function _micFinish'), js.indexOf('async function _micToggle'));
    assert.ok(fin.includes('_insertAtCursor(res.text)'));
    assert.ok(!fin.includes('sendTask'));
  });

  it('commande /dicter déclarée', () => {
    assert.ok(read('src/renderer-visible/app.js').includes("cmd: '/dicter'"));
  });

  it('styles : états recording et processing', () => {
    const css = read('src/renderer-visible/styles.css');
    assert.ok(css.includes('.btn-mic.mic-recording') && css.includes('.btn-mic.mic-processing'));
  });
});

describe('packaging — binaires natifs inutiles exclus', () => {
  it('electron-builder.yml exclut onnxruntime-node et sharp', () => {
    const y = read('electron-builder.yml');
    assert.ok(y.includes('!node_modules/onnxruntime-node/**'));
    assert.ok(y.includes('!node_modules/sharp/**'));
  });

  it('@huggingface/transformers est une dépendance de production', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.dependencies['@huggingface/transformers']);
  });
});
