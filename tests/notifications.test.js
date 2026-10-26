'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// notifications.js importe Electron — on le stub avant require
const Module = require('module');
const _orig = Module._resolveFilename;
Module._resolveFilename = function(req, ...args) {
  if (req === 'electron') return req;
  return _orig.call(this, req, ...args);
};
require.cache['electron'] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    Notification: class {
      static isSupported() { return true; }
      constructor(opts) { this._opts = opts; }
      on()   {}
      show() { this._shown = true; }
    },
  },
};

const { notifyTaskComplete } = require('../src/main/notifications');

// Fabrique un mock BrowserWindow minimal
function makeWin({ focused = false, destroyed = false, minimized = false } = {}) {
  return {
    isDestroyed:  () => destroyed,
    isFocused:    () => focused,
    isMinimized:  () => minimized,
    flashFrame:   () => {},
    restore:      () => {},
    show:         () => {},
    focus:        () => {},
  };
}

describe('notifyTaskComplete', () => {

  it('ne plante pas si win est null', () => {
    assert.doesNotThrow(() => notifyTaskComplete({ task: 'test', ok: true }, null));
  });

  it('ne plante pas si win est détruite', () => {
    assert.doesNotThrow(() => notifyTaskComplete({ task: 'test', ok: true }, makeWin({ destroyed: true })));
  });

  it('fonctionne quand la fenêtre est en arrière-plan (non focalisée)', () => {
    const win = makeWin({ focused: false });
    let flashed = false;
    win.flashFrame = (v) => { flashed = v; };
    assert.doesNotThrow(() => notifyTaskComplete({ task: 'Ma tâche', ok: true, stepCount: 3 }, win));
    assert.equal(flashed, true, 'doit flasher quand non focalisée');
  });

  it('ne flashe pas si la fenêtre est déjà focalisée', () => {
    const win = makeWin({ focused: true });
    let flashed = false;
    win.flashFrame = () => { flashed = true; };
    notifyTaskComplete({ task: 'Ma tâche', ok: true }, win);
    assert.equal(flashed, false, 'ne doit pas flasher si déjà en avant-plan');
  });

  it('fonctionne pour une tâche échouée', () => {
    const win = makeWin({ focused: false });
    assert.doesNotThrow(() => notifyTaskComplete({ task: 'Fail task', ok: false }, win));
  });

  it('tronque les tâches longues sans planter', () => {
    const longTask = 'a'.repeat(200);
    const win = makeWin();
    assert.doesNotThrow(() => notifyTaskComplete({ task: longTask, ok: true, stepCount: 10 }, win));
  });

});
