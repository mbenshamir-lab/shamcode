'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isBlockedShortcut, attachShortcutGuard } = require('../src/main/shortcuts');

const key = (k, mods) => ({ type: 'keyDown', key: k, ...(mods || {}) });

test('raccourcis navigateur — touches seules', async (t) => {
  await t.test('F5 / F7 / F12 sont bloquées', () => {
    assert.equal(isBlockedShortcut(key('F5')), true);
    assert.equal(isBlockedShortcut(key('F7')), true);
    assert.equal(isBlockedShortcut(key('F12')), true);
  });

  await t.test('une touche de saisie normale passe', () => {
    assert.equal(isBlockedShortcut(key('a')), false);
    assert.equal(isBlockedShortcut(key('Enter')), false);
    assert.equal(isBlockedShortcut(key('Tab')), false);
  });
});

test('raccourcis navigateur — Ctrl / Cmd (Windows, Linux, macOS)', async (t) => {
  await t.test('Ctrl+R, Ctrl+P, Ctrl+F, Ctrl+U, Ctrl+D sont bloquées', () => {
    for (const k of ['r', 'p', 'f', 'u', 'd']) {
      assert.equal(isBlockedShortcut(key(k, { control: true })), true, `Ctrl+${k}`);
    }
  });

  await t.test('Cmd+R et Cmd+P sont bloquées sur macOS', () => {
    assert.equal(isBlockedShortcut(key('r', { meta: true })), true);
    assert.equal(isBlockedShortcut(key('p', { meta: true })), true);
  });

  await t.test('le zoom Ctrl +/-/0 est bloqué', () => {
    for (const k of ['+', '=', '-', '_', '0']) {
      assert.equal(isBlockedShortcut(key(k, { control: true })), true, `Ctrl+${k}`);
    }
  });
});

test('les raccourcis de l\'application restent intacts', async (t) => {
  await t.test('Ctrl+L (envoi du message) passe', () => {
    assert.equal(isBlockedShortcut(key('l', { control: true })), false);
  });

  await t.test('Ctrl+C / V / X / A / Z passent', () => {
    for (const k of ['c', 'v', 'x', 'a', 'z']) {
      assert.equal(isBlockedShortcut(key(k, { control: true })), false, `Ctrl+${k}`);
    }
  });

  await t.test('Ctrl+Shift+L et Ctrl+Entrée passent', () => {
    assert.equal(isBlockedShortcut(key('l', { control: true, shift: true })), false);
    assert.equal(isBlockedShortcut(key('Enter', { control: true })), false);
  });
});

test('devtools et navigation', async (t) => {
  await t.test('F12 et Ctrl+Shift+I sont bloquées par défaut', () => {
    assert.equal(isBlockedShortcut(key('F12')), true);
    assert.equal(isBlockedShortcut(key('i', { control: true, shift: true })), true);
    assert.equal(isBlockedShortcut(key('j', { control: true, shift: true })), true);
  });

  await t.test('allowDevTools laisse passer F12 et Ctrl+Shift+I', () => {
    const opts = { allowDevTools: true };
    assert.equal(isBlockedShortcut(key('F12'), opts), false);
    assert.equal(isBlockedShortcut(key('i', { control: true, shift: true }), opts), false);
    // Le reste demeure bloqué en développement.
    assert.equal(isBlockedShortcut(key('r', { control: true }), opts), true);
  });

  await t.test('Alt+←/→ ne navigue pas dans l\'historique', () => {
    assert.equal(isBlockedShortcut(key('ArrowLeft', { alt: true })), true);
    assert.equal(isBlockedShortcut(key('ArrowRight', { alt: true })), true);
  });
});

test('isBlockedShortcut — entrées limites', async (t) => {
  await t.test('seul keyDown est examiné', () => {
    assert.equal(isBlockedShortcut({ type: 'keyUp', key: 'r', control: true }), false);
  });

  await t.test('entrée absente ou sans clé', () => {
    assert.equal(isBlockedShortcut(null), false);
    assert.equal(isBlockedShortcut(undefined), false);
    assert.equal(isBlockedShortcut({ type: 'keyDown' }), false);
    assert.equal(isBlockedShortcut({ type: 'keyDown', key: 42 }), false);
  });
});

test('attachShortcutGuard — robustesse', async (t) => {
  await t.test('refuse une fenêtre absente ou détruite', () => {
    assert.equal(attachShortcutGuard(null), false);
    assert.equal(attachShortcutGuard({ isDestroyed: () => true }), false);
    assert.equal(attachShortcutGuard({ isDestroyed: () => false }), false);
  });

  await t.test('pose le filtre et masque la barre de menus', () => {
    const handlers = {};
    const calls = [];
    const win = {
      isDestroyed: () => false,
      setMenuBarVisibility: (v) => calls.push(['menu', v]),
      setAutoHideMenuBar: (v) => calls.push(['autoHide', v]),
      webContents: {
        on: (evt, fn) => { handlers[evt] = fn; },
        setVisualZoomLevelLimits: () => Promise.resolve(),
      },
    };

    assert.equal(attachShortcutGuard(win), true);
    assert.deepEqual(calls, [['menu', false], ['autoHide', true]]);
    assert.equal(typeof handlers['before-input-event'], 'function');

    let prevented = 0;
    const event = { preventDefault: () => { prevented += 1; } };
    handlers['before-input-event'](event, key('r', { control: true }));
    handlers['before-input-event'](event, key('l', { control: true }));
    assert.equal(prevented, 1, 'seul Ctrl+R est annulé');
  });
});
