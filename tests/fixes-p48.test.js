/**
 * Tests Phase 48 — Indicateur de progression agent
 * 1. Nouveaux éléments présents dans le source (step badge, elapsed, retry)
 * 2. Timer créé à l'ouverture du bloc, détruit à la fermeture
 * 3. parse_error → _activityParseRetry appelé
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../src/renderer-visible/app.js'),
  'utf8'
);

// ── 1. Source : nouveaux éléments d'interface ────────────────────────────────
describe('app.js — activity progress indicator', () => {
  it('définit _activityTimer', () => {
    assert.ok(src.includes('_activityTimer'), '_activityTimer doit être déclaré');
  });

  it('définit _activityParseErrors', () => {
    assert.ok(src.includes('_activityParseErrors'), '_activityParseErrors doit être déclaré');
  });

  it('définit _activityCurrentLabel', () => {
    assert.ok(src.includes('_activityCurrentLabel'), '_activityCurrentLabel doit être déclaré');
  });

  it('_activityRender produit un activity-step-badge', () => {
    assert.ok(
      src.includes('activity-step-badge'),
      'Le badge d\'étape doit être injecté par _activityRender'
    );
  });

  it('_activityRender produit un activity-elapsed', () => {
    assert.ok(
      src.includes('activity-elapsed'),
      'Le temps écoulé doit être injecté par _activityRender'
    );
  });

  it('_activityRender produit un activity-retry quand parse_error > 0', () => {
    assert.ok(
      src.includes('activity-retry'),
      'Le badge retry doit être conditionnel aux parse_error'
    );
  });

  it('_activityElapsed retourne le format Xs ou XmYs', () => {
    assert.ok(
      src.includes('_activityElapsed'),
      '_activityElapsed doit être défini'
    );
    // Vérifier les deux formats dans le code source
    assert.ok(src.includes('`${secs}s`'), 'Format secondes seules présent');
    assert.ok(src.includes('`${Math.floor(secs / 60)}m${secs % 60}s`'), 'Format minutes présent');
  });

  it('setInterval démarre dans _ensureActivityBlock', () => {
    const block = src.indexOf('function _ensureActivityBlock');
    const fnBody = src.slice(block, block + 800);
    assert.ok(fnBody.includes('setInterval'), 'Le timer doit démarrer dans _ensureActivityBlock');
  });

  it('clearInterval dans _closeActivityBlock', () => {
    const block = src.indexOf('function _closeActivityBlock');
    const fnBody = src.slice(block, block + 400);
    assert.ok(fnBody.includes('clearInterval'), 'Le timer doit être détruit dans _closeActivityBlock');
  });
});

// ── 2. parse_error → _activityParseRetry ──────────────────────────────────────
describe('app.js — parse_error branché sur _activityParseRetry', () => {
  it('parse_error appelle _activityParseRetry (plus silencieux)', () => {
    // Trouver le handler parse_error
    const idx = src.indexOf("event.type === 'parse_error'");
    assert.ok(idx >= 0, 'Le handler parse_error doit exister');
    const handler = src.slice(idx, idx + 200);
    assert.ok(
      handler.includes('_activityParseRetry'),
      '_activityParseRetry doit être appelé dans le handler parse_error'
    );
    assert.ok(
      !handler.includes('// retry silencieux'),
      'L\'ancien commentaire "silencieux" ne doit plus être présent'
    );
  });

  it('_activityParseRetry incrémente _activityParseErrors', () => {
    const fnIdx = src.indexOf('function _activityParseRetry');
    assert.ok(fnIdx >= 0, '_activityParseRetry doit être défini');
    const body = src.slice(fnIdx, fnIdx + 200);
    assert.ok(body.includes('_activityParseErrors++'), 'Doit incrémenter _activityParseErrors');
    assert.ok(body.includes('_activityRender()'), 'Doit re-rendre après incrémentation');
  });
});

// ── 3. CSS — nouveaux sélecteurs ─────────────────────────────────────────────
describe('styles.css — nouveaux sélecteurs activity', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../src/renderer-visible/styles.css'),
    'utf8'
  );

  it('.activity-step-badge défini', () => {
    assert.ok(css.includes('.activity-step-badge'), '.activity-step-badge doit être dans le CSS');
  });

  it('.activity-elapsed défini', () => {
    assert.ok(css.includes('.activity-elapsed'), '.activity-elapsed doit être dans le CSS');
  });

  it('.activity-retry défini', () => {
    assert.ok(css.includes('.activity-retry'), '.activity-retry doit être dans le CSS');
  });

  it('.activity-current-label a text-overflow: ellipsis', () => {
    const idx = css.indexOf('.activity-current-label');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('text-overflow'), '.activity-current-label doit avoir text-overflow pour les longs labels');
  });
});
