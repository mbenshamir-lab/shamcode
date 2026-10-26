'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const htmlSrc = fs.readFileSync(
  path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8'
);
const cssSrc = fs.readFileSync(
  path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8'
);
const appSrc = fs.readFileSync(
  path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8'
);

// ── HTML — structure 4 parties ───────────────────────────────────────────────
describe('Phase 71 — HTML sidebar structure', () => {

  it('contient sb-part-1 avec btn-new-project et btn-search-session', () => {
    assert.ok(htmlSrc.includes('sb-part-1'), 'sb-part-1 absent');
    assert.ok(htmlSrc.includes('btn-new-project'), 'btn-new-project absent');
    assert.ok(htmlSrc.includes('btn-search-session'), 'btn-search-session absent');
  });

  it('contient btn-sidebar-collapse pour le repli', () => {
    assert.ok(htmlSrc.includes('btn-sidebar-collapse'), 'btn-sidebar-collapse absent');
  });

  it('contient sb-part-2 avec connecteurs et compétences', () => {
    assert.ok(htmlSrc.includes('sb-part-2'), 'sb-part-2 absent');
    assert.ok(htmlSrc.includes('nav-connectors'), 'nav-connectors absent');
    assert.ok(htmlSrc.includes('nav-skills'), 'nav-skills absent');
  });

  it('contient sb-part-3 avec sidebar-sessions', () => {
    assert.ok(htmlSrc.includes('sb-part-3'), 'sb-part-3 absent');
    assert.ok(htmlSrc.includes('sidebar-sessions'), 'sidebar-sessions absent');
  });

  it('contient sb-part-4 avec profile (btn-settings supprimé — sidebar-profile ouvre les paramètres)', () => {
    assert.ok(htmlSrc.includes('sb-part-4'), 'sb-part-4 absent');
    assert.ok(htmlSrc.includes('profile-avatar'), 'profile-avatar absent');
    assert.ok(htmlSrc.includes('sidebar-profile'), 'sidebar-profile absent');
  });

  it('contient sb-search-wrap (barre de recherche masquable)', () => {
    assert.ok(htmlSrc.includes('sb-search-wrap'), 'sb-search-wrap absent');
    assert.ok(htmlSrc.includes('sb-search-input'), 'sb-search-input absent');
  });

  it('n\'a plus de btn-sidebar-sessions (bouton "Toutes →")', () => {
    assert.ok(!htmlSrc.includes('btn-sidebar-sessions'), 'btn-sidebar-sessions doit avoir été supprimé');
  });

});

// ── CSS — collapsed state et layout ─────────────────────────────────────────
describe('Phase 71 — CSS sidebar collapsed et layout', () => {

  it('déclare .sb-part-3 avec flex: 0 0 31.25%', () => {
    assert.ok(cssSrc.includes('.sb-part-3'), '.sb-part-3 absent');
    assert.match(
      cssSrc,
      /\.sb-part-3\s*\{[^}]*flex:\s*0 0 31\.25%/,
      '.sb-part-3 doit avoir flex: 0 0 31.25%'
    );
  });

  it('déclare #sidebar.sidebar-collapsed avec width réduite', () => {
    assert.ok(
      cssSrc.includes('sidebar-collapsed'),
      '#sidebar.sidebar-collapsed absent'
    );
    assert.ok(
      cssSrc.includes('44px'),
      'width 44px absent pour sidebar-collapsed'
    );
  });

  it('masque .sb-label en mode collapsed', () => {
    assert.ok(
      cssSrc.includes('.sb-label'),
      '.sb-label absent du CSS'
    );
    assert.ok(
      cssSrc.includes('sidebar-collapsed') && cssSrc.includes('.sb-label'),
      'règle de masquage .sb-label absente'
    );
  });

  it('déclare .sb-icon-btn pour les boutons icône', () => {
    assert.ok(cssSrc.includes('.sb-icon-btn'), '.sb-icon-btn absent');
  });

  it('déclare .sb-search-wrap et .sb-search-input', () => {
    assert.ok(cssSrc.includes('.sb-search-wrap'), '.sb-search-wrap absent');
    assert.ok(cssSrc.includes('.sb-search-input'), '.sb-search-input absent');
  });

  it('déclare .sb-part-4 avec margin-top: auto', () => {
    assert.ok(
      cssSrc.includes('.sb-part-4') && cssSrc.includes('margin-top: auto'),
      '.sb-part-4 avec margin-top: auto absent'
    );
  });

});

// ── JS — liste plate, collapse, recherche ───────────────────────────────────
describe('Phase 71 — JS sidebar logique', () => {

  it('_renderSessionList trie par createdAt décroissant', () => {
    assert.ok(
      appSrc.includes('_renderSessionList'),
      '_renderSessionList absent de app.js'
    );
    assert.ok(
      appSrc.includes('createdAt') && appSrc.includes('sort'),
      'tri par createdAt absent'
    );
  });

  it('btn-sidebar-collapse toggle sidebar-collapsed', () => {
    assert.ok(
      appSrc.includes('btn-sidebar-collapse'),
      'btn-sidebar-collapse absent de app.js'
    );
    assert.ok(
      appSrc.includes('sidebar-collapsed'),
      'sidebar-collapsed absent de app.js'
    );
  });

  it('btn-search-session affiche/masque sb-search-wrap', () => {
    assert.ok(
      appSrc.includes('btn-search-session'),
      'btn-search-session absent de app.js'
    );
    assert.ok(
      appSrc.includes('sb-search-wrap'),
      'sb-search-wrap absent de app.js'
    );
  });

  it('filtre les sessions par texte de tâche', () => {
    assert.ok(
      appSrc.includes('sbSearchInput') && appSrc.includes('toLowerCase'),
      'filtre de recherche absent'
    );
  });

  it('n\'utilise plus _collapsedGroups (groupes supprimés)', () => {
    assert.ok(
      !appSrc.includes('_collapsedGroups'),
      '_collapsedGroups doit être supprimé (liste plate, pas de groupes)'
    );
  });

});
