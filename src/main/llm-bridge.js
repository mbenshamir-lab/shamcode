const { ipcMain } = require('electron');
const { randomUUID } = require('crypto');
const { IPC } = require('../shared/constants');

/**
 * Pont IPC entre le harness et le renderer caché WebLLM.
 * Retourne une fonction llmGenerate injectable dans runAgent.
 *
 * @param {BrowserWindow} hiddenWin
 * @returns {Function} llmGenerate(messages, options) => Promise<string>
 */
function createLlmBridge(hiddenWin) {
  return function llmGenerate(messages, options = {}) {
    return new Promise((resolve, reject) => {
      const replyChannel = `${IPC.LLM_REPLY}:${randomUUID()}`;

      ipcMain.once(replyChannel, (_, payload) => {
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload.text);
      });

      hiddenWin.webContents.send(IPC.LLM_REQUEST, { messages, options, replyChannel });
    });
  };
}

module.exports = { createLlmBridge };
