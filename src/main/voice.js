'use strict';

const crypto = require('crypto');
const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');
const { getVoiceWindow } = require('./windows');

// Le premier appel télécharge le modèle Whisper (75–250 Mo) : mesuré à 508 s pour
// « small » sur une connexion lente, d'où une marge de 30 min.
const TIMEOUT_MS = 30 * 60_000;

const VOICE_MODELS = ['base', 'small'];

/** Toute valeur inconnue (config corrompue) retombe sur le modèle par défaut. */
function normalizeVoiceModel(model) {
  return VOICE_MODELS.includes(model) ? model : 'base';
}

async function _send(payload) {
  const win = getVoiceWindow();
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  }

  return new Promise((resolve, reject) => {
    const replyChannel = crypto.randomBytes(8).toString('hex');
    const fullChannel  = `${IPC.VOICE_REPLY}:${replyChannel}`;

    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(fullChannel);
      reject(new Error('Transcription trop longue (timeout)'));
    }, TIMEOUT_MS);

    ipcMain.once(fullChannel, (_, result) => {
      clearTimeout(timer);
      if (result.error) reject(new Error(result.error));
      else resolve(result.text);
    });

    win.webContents.send(IPC.VOICE_REQUEST, { ...payload, replyChannel });
  });
}

/**
 * Envoie un enregistrement audio à la fenêtre cachée Whisper.
 * @param {Buffer|Uint8Array|ArrayBuffer} audio — enregistrement encodé (webm/opus…)
 * @param {string} [model] — 'base' | 'small'
 * @returns {Promise<string>} transcription brute
 */
function transcribeAudio(audio, model) {
  return _send({ audio, model: normalizeVoiceModel(model) });
}

/** Télécharge/charge un modèle sans transcrire (bouton des Paramètres). */
async function preloadVoiceModel(model) {
  await _send({ preload: true, model: normalizeVoiceModel(model) });
}

module.exports = { transcribeAudio, preloadVoiceModel, normalizeVoiceModel, VOICE_MODELS };
