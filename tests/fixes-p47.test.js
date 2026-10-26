/**
 * Tests Phase 47 — correctifs ask_user (fréquence + alignement)
 * 1. Le prompt système mentionne explicitement la restriction ask_user
 * 2. La card ask_user a la bonne structure DOM (chips hors inputRow)
 * 3. Enter sans Shift soumet ; Shift+Enter ne soumet pas
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. Prompt système — règle ask_user restrictive ───────────────────────────
describe('system prompt — règle ask_user', () => {
  const { buildSystemPrompt } = require('../src/harness/prompts/system');

  it('contient une restriction explicite sur ask_user (NE PAS ou conditionnel)', () => {
    const p = buildSystemPrompt(['read_file', 'ask_user']);
    // Phase 53 : ask_user autorisé en première action si tâche floue, mais toujours conditionnel
    assert.ok(
      p.includes('NE PAS appeler ask_user') || p.includes('UNIQUEMENT si'),
      'La règle doit toujours conditionner explicitement ask_user'
    );
  });

  it('contient une clause explicite "NE PAS appeler ask_user"', () => {
    const p = buildSystemPrompt(['read_file', 'ask_user']);
    assert.ok(p.includes('NE PAS appeler ask_user'), 'La règle doit interdire explicitement les usages courants');
  });

  it('contient "irréductible" ou "irréversible" (usage conditionnel)', () => {
    const p = buildSystemPrompt(['read_file', 'ask_user']);
    assert.ok(
      p.includes('irréductible') || p.includes('irréversible'),
      'ask_user doit être réservé aux ambiguïtés irréductibles'
    );
  });

  it('ne contient pas d\'ancienne formulation permissive ("si tu as besoin")', () => {
    const p = buildSystemPrompt(['read_file', 'ask_user']);
    // L'ancienne formulation incitait à demander à l'utilisateur dès qu'on avait un doute
    const old = p.includes('si tu as besoin de clarification avant');
    assert.ok(!old, 'L\'ancienne formulation permissive ne doit plus être présente');
  });
});

// ── 2. Structure DOM de la card ask_user ─────────────────────────────────────
// Simulation légère via JSDOM ou vérification du code source de app.js
describe('app.js — _appendAskUserCard structure', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '../src/renderer-visible/app.js'),
    'utf8'
  );

  // Trouver la fonction _appendAskUserCard
  const fnStart = src.indexOf('function _appendAskUserCard');
  assert.ok(fnStart >= 0, '_appendAskUserCard doit exister dans app.js');

  // Extraire le corps de la fonction jusqu'à la prochaine fonction de même niveau
  const fnBody = src.slice(fnStart, fnStart + 3000);

  it('chips appendées à card, pas à inputRow', () => {
    // card.appendChild(chipsRow) doit apparaître AVANT inputRow.appendChild
    const cardAppend  = fnBody.indexOf('card.appendChild(chipsRow)');
    const rowAppend   = fnBody.indexOf('inputRow.appendChild(chipsRow)');
    assert.ok(cardAppend >= 0,  'card.appendChild(chipsRow) doit être présent');
    assert.ok(rowAppend  === -1, 'inputRow.appendChild(chipsRow) ne doit plus exister');
  });

  it('inputRow contient uniquement input et btn', () => {
    // Vérifier que inputRow.appendChild est appelé avec input et btn, pas chipsRow
    const rowSection = fnBody.slice(fnBody.indexOf('inputRow.appendChild'));
    const firstTwo = rowSection.slice(0, 200);
    assert.ok(firstTwo.includes('inputRow.appendChild(input)'), 'inputRow doit contenir input');
    assert.ok(firstTwo.includes('inputRow.appendChild(btn)'), 'inputRow doit contenir btn');
  });

  it('input est déclaré avant la création de chipsRow (pour la closure)', () => {
    const inputDecl  = fnBody.indexOf('const input = document.createElement(\'textarea\')');
    const chipsDecl  = fnBody.indexOf('const chipsRow = document.createElement(\'div\')');
    assert.ok(inputDecl >= 0,  'input doit être déclaré');
    // Si pas de chips, chipsDecl vaut -1 — pas un problème
    if (chipsDecl >= 0) {
      assert.ok(inputDecl < chipsDecl, 'input doit être déclaré avant chipsRow (pour la closure du chip.click)');
    }
  });

  it('Enter sans Shift déclenche submitFn (e.preventDefault)', () => {
    assert.ok(
      fnBody.includes('!e.shiftKey') && fnBody.includes('e.preventDefault()'),
      'Le handler keydown doit bloquer Enter (sans Shift) avec preventDefault'
    );
  });

  it('Shift+Enter ne soumet pas (condition !e.shiftKey)', () => {
    // La condition doit être !e.shiftKey, pas (e.ctrlKey || e.metaKey)
    const hasShiftGuard = fnBody.includes('!e.shiftKey');
    const hasOldCtrl    = fnBody.includes('e.ctrlKey || e.metaKey');
    assert.ok(hasShiftGuard, 'La condition !e.shiftKey doit être présente');
    assert.ok(!hasOldCtrl,   'L\'ancienne condition ctrlKey ne doit plus être présente dans ask-card');
  });
});

// ── 3. CSS — ask-card a un fond et une bordure ────────────────────────────────
describe('styles.css — ask-card visually distinct', () => {
  const fs   = require('fs');
  const path = require('path');
  const css  = fs.readFileSync(
    path.join(__dirname, '../src/renderer-visible/styles.css'),
    'utf8'
  );

  // Extraire le bloc .ask-card
  const start = css.indexOf('.ask-card {');
  assert.ok(start >= 0, '.ask-card doit être défini dans styles.css');
  const block = css.slice(start, css.indexOf('}', start) + 1);

  it('.ask-card a un padding', () => {
    assert.ok(block.includes('padding'), '.ask-card doit avoir un padding');
  });

  it('.ask-card a une border', () => {
    assert.ok(block.includes('border'), '.ask-card doit avoir une bordure');
  });

  it('.ask-card a un background', () => {
    assert.ok(block.includes('background'), '.ask-card doit avoir un background');
  });

  it('.ask-card a un border-radius', () => {
    assert.ok(block.includes('border-radius'), '.ask-card doit avoir un border-radius');
  });
});
