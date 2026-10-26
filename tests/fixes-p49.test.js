/**
 * Tests Phase 49 — Conditions d'apparition plan/ask_user + Sham obligatoire
 * 1. Prompt système — règle plan restrictive (écriture + ≥ 3 étapes)
 * 2. Prompt système — ask_user interdit comme première action
 * 3. Prompt système — Sham manquant → instruction création obligatoire
 * 4. agent.js — garde ask_user step 1 → redirect vers lecture
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── 1 & 2 & 3 : Prompt système ───────────────────────────────────────────────
describe('system prompt — plan obligatoire (briefing)', () => {
  const { buildSystemPrompt } = require('../src/harness/prompts/system');

  it('la règle plan est conditionnelle (écriture ≥ 3 étapes)', () => {
    const p = buildSystemPrompt(['read_file', 'write_file', 'plan']);
    assert.ok(p.includes('selon ton propre jugement'), 'plan conditionnel');
    assert.ok(p.includes('comporte plusieurs modifications'), 'condition écriture');
    assert.ok(p.includes('risque d\'erreur'), 'condition complexité');
  });

  it('une tâche simple ne déclenche pas le plan (question/salutation)', () => {
    const p = buildSystemPrompt(['read_file', 'write_file', 'plan']);
    assert.ok(p.includes('tâche simple, conversationnelle'), 'exceptions explicites');
    assert.ok(p.includes('finish'), 'réponse directe via finish');
  });

  it('un sous-agent n\'est pas soumis au plan', () => {
    const p = buildSystemPrompt(['plan'], '', { skipPlanRule: true });
    assert.ok(p.includes('pas de plan'), 'exemption sous-agent');
    assert.ok(!p.includes('UNIQUEMENT si la tâche implique'), 'pas de règle plan');
  });

  it('le briefing explique quoi dire à l\'utilisateur (§ Phase 67)', () => {
    const p = buildSystemPrompt(['plan']);
    assert.ok(p.includes('BRIEFING AVANT EXÉCUTION (quand tu utilises plan)'), 'section briefing');
    assert.ok(p.includes('reformule ce que l\'utilisateur demande'), 'phrase 1 = compréhension');
    assert.ok(p.includes('annonce la suite prévue'), 'phrase 2 = suite prévue');
  });
});

describe('system prompt — ask_user usage conditionnel', () => {
  const { buildSystemPrompt } = require('../src/harness/prompts/system');

  it('contient "en PREMIÈRE action" (autorisé si tâche floue)', () => {
    const p = buildSystemPrompt(['read_file', 'ask_user']);
    assert.ok(
      p.includes('PREMIÈRE action'),
      'ask_user doit être autorisé en première action si tâche ambiguë'
    );
  });

  it('contient "en milieu de tâche"', () => {
    const p = buildSystemPrompt(['ask_user']);
    assert.ok(
      p.includes('milieu de tâche'),
      'ask_user doit aussi être cadré pour le milieu de tâche'
    );
  });

  it('ne contient plus "premier réflexe" (ancienne formulation)', () => {
    const p = buildSystemPrompt(['ask_user']);
    assert.ok(
      !p.includes('premier réflexe'),
      'L\'ancienne formulation "premier réflexe" ne doit plus apparaître'
    );
  });

  it('ne contient plus "INTERDIT comme première action"', () => {
    const p = buildSystemPrompt(['ask_user']);
    assert.ok(
      !p.includes('INTERDIT comme première action'),
      'L\'interdiction absolue en première action est levée'
    );
  });
});

describe('system prompt — AGENTS.md mémoire vivante', () => {
  const { buildSystemPrompt } = require('../src/harness/prompts/system');

  it('sans AGENTS.md : aucune section AGENTS injectée dans le prompt', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: false });
    assert.ok(
      !p.includes('FICHIER AGENTS'),
      'Sans AGENTS.md existant, aucune section AGENTS ne doit être injectée'
    );
  });

  it('sans AGENTS.md : la règle AGENTS.md mémoire vivante est toujours présente', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: false });
    assert.ok(
      p.includes('AGENTS.md'),
      'La règle de mise à jour AGENTS.md doit toujours être présente'
    );
  });

  it('sans AGENTS.md : ne demande pas de "proposer à l\'utilisateur"', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: false });
    assert.ok(
      !p.includes('propose à l\'utilisateur'),
      'L\'agent ne doit jamais demander permission pour créer AGENTS.md'
    );
  });

  it('sans AGENTS.md : mentionne write_file pour la création en fin de tâche', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: false });
    assert.ok(
      p.includes('write_file'),
      'La règle AGENTS.md doit mentionner write_file'
    );
  });

  it('avec AGENTS.md : le contenu est injecté et marqué "déjà lu"', () => {
    const p = buildSystemPrompt(['read_file'], '', { agentsExists: true, agentsContent: 'TEST AGENTS' });
    assert.ok(p.includes('TEST AGENTS'), 'Le contenu de AGENTS.md doit être injecté');
    assert.ok(p.includes('déjà lu'), 'AGENTS.md existant doit être marqué comme déjà lu');
  });

  it('avec AGENTS.md : la règle de mise à jour en fin d\'exécution est présente', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: true, agentsContent: 'X' });
    assert.ok(
      p.includes('FIN de chaque tâche') || p.includes('fin de chaque'),
      'La règle de mise à jour AGENTS.md en fin de tâche doit être présente même avec AGENTS.md existant'
    );
  });

  it('sans AGENTS.md : le template de structure est proposé à la création', () => {
    const p = buildSystemPrompt(['write_file'], '', { agentsExists: false });
    assert.ok(p.includes('## Stack'), 'Le template doit contenir ## Stack');
    assert.ok(p.includes('## Conventions critiques'), 'Le template doit contenir ## Conventions critiques');
    assert.ok(p.includes('## Pièges connus'), 'Le template doit contenir ## Pièges connus');
  });
});

// ── 4 : ask_user libre dans agent.js ─────────────────────────────────────────
describe('agent.js — ask_user autorisé en première étape', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(path.join(__dirname, '../src/harness/agent.js'), 'utf8');

  it('le guard ASK_USER_PREMIER_STEP_INTERDIT est supprimé', () => {
    assert.ok(
      !src.includes('ASK_USER_PREMIER_STEP_INTERDIT'),
      'Le hard-block ask_user step 1 ne doit plus exister'
    );
  });

  it('ask_user est toujours un outil reconnu (TOOLS.ASK_USER)', () => {
    assert.ok(
      src.includes('ASK_USER') || src.includes('ask_user'),
      'ask_user doit rester référencé dans agent.js'
    );
  });
});
