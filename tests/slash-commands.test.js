'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const start = src.indexOf('const SLASH_COMMANDS = [');
const block = src.slice(start, src.indexOf('let _slashActiveIdx', start));

describe('styles.css — états réduits prioritaires sur la largeur tirée à la main', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');

  it('sidebar réduite : largeur forcée (!important)', () => {
    assert.ok(/#sidebar\.sidebar-collapsed\s*\{\s*width:\s*48px\s*!important/.test(css));
  });

  it('task panel réduit : largeur forcée (!important)', () => {
    assert.ok(/#task-panel\.tp-collapsed\s*\{\s*width:\s*36px\s*!important/.test(css));
  });
});

describe('app.js — commandes slash (Phase 112)', () => {
  const all = ['/tdd', '/validation', '/stop', '/role', '/review', '/audit', '/design',
    '/palette', '/tokens', '/note', '/impact', '/web', '/tests', '/commit',
    '/image', '/video', '/voix', '/joindre', '/planifier', '/recherche'];
  for (const cmd of all) {
    it(`déclare ${cmd}`, () => assert.ok(block.includes(`cmd: '${cmd}'`), `${cmd} absent`));
  }

  it('toutes les commandes sont uniques', () => {
    const cmds = [...block.matchAll(/cmd:\s*'(\/[a-z_]+)'/g)].map(m => m[1]);
    assert.equal(new Set(cmds).size, cmds.length);
  });

  it('/review bascule sur le rôle reviewer', () => {
    assert.ok(/_setPersona\('reviewer'\)/.test(block));
  });

  it('/audit bascule sur le rôle securite', () => {
    assert.ok(/_setPersona\('securite'\)/.test(block));
  });

  it('/validation explique quand le toggle est désactivé', () => {
    assert.ok(block.includes('btnApprovalToggle.disabled'));
  });

  it('/stop ne clique que si l\'agent tourne', () => {
    assert.ok(block.includes('btnCancel.disabled'));
  });

  it('les commandes à pré-remplissage passent par _slashFill', () => {
    for (const cmd of ['/palette', '/tokens', '/note', '/impact', '/web', '/tests', '/commit', '/image', '/video', '/voix']) {
      const re = new RegExp(`cmd: '${cmd}'[\\s\\S]*?action: \\(\\) => _slashFill\\(`);
      assert.ok(re.test(block), `${cmd} sans _slashFill`);
    }
  });

  it('les boutons ciblés par les actions directes existent dans index.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
    for (const id of ['btn-attach', 'btn-nav-scheduler', 'btn-search-session', 'btn-design-studio']) {
      assert.ok(html.includes(`id="${id}"`), `${id} absent`);
    }
  });

  it('/design ouvre le Design Studio', () => {
    assert.ok(/cmd: '\/design'[\s\S]*?action: _openDesign/.test(block));
  });
});
