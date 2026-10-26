/**
 * Phase 81 — Améliorations "meilleur agent"
 * 4 axes : parser robuste, vérif après écriture, BLOC_INTROUVABLE, budget précoce.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. Parser : réparation des \n littéraux dans les strings JSON ─────────────
describe('parser — newlines littéraux dans les valeurs', () => {
  const { extractToolCall } = require('../src/harness/parser');

  test('répare un \\n littéral dans le champ content', () => {
    // Simule un petit modèle qui insère un vrai saut de ligne dans le JSON
    const raw = '{"tool":"write_file","args":{"path":"a.js","content":"line1\nline2"}}';
    const result = extractToolCall(raw);
    assert.equal(result.error, undefined, `Ne devrait pas échouer : ${result.error}`);
    assert.equal(result.tool, 'write_file');
    // Le contenu doit contenir \n comme séquence d'échappement, pas un saut réel
    assert.ok(result.args.content.includes('\n'), 'le contenu doit inclure une nouvelle ligne');
  });

  test('répare un \\r\\n littéral (Windows) dans le champ content', () => {
    const raw = '{"tool":"replace_code","args":{"path":"b.js","old_string":"a\r\nb","new_string":"c"}}';
    const result = extractToolCall(raw);
    assert.equal(result.error, undefined, `Ne devrait pas échouer : ${result.error}`);
    assert.equal(result.tool, 'replace_code');
  });

  test('ne casse pas un JSON propre sans newlines', () => {
    const raw = '{"tool":"finish","args":{"summary":"ok"}}';
    const result = extractToolCall(raw);
    assert.equal(result.error, undefined);
    assert.equal(result.tool, 'finish');
    assert.equal(result.args.summary, 'ok');
  });

  test('ne casse pas les \\n déjà échappés correctement', () => {
    const raw = '{"tool":"write_file","args":{"path":"c.js","content":"line1\\nline2"}}';
    const result = extractToolCall(raw);
    assert.equal(result.error, undefined);
    // JSON.parse("line1\\nline2") donne "line1\nline2" (avec vrai saut)
    assert.ok(result.args.content.includes('\n'));
  });

  test('répare un \\t littéral dans une valeur', () => {
    const raw = '{"tool":"write_file","args":{"path":"d.js","content":"a\tb"}}';
    const result = extractToolCall(raw);
    assert.equal(result.error, undefined);
    assert.equal(result.tool, 'write_file');
  });
});

// ── 2. Agent : vérification obligatoire après write_file / replace_code ───────
describe('agent — nudge vérification après écriture', () => {
  const { runAgent } = require('../src/harness/agent');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  function tmpDir() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    return d;
  }

  test('resultMsg contient VÉRIFICATION OBLIGATOIRE après write_file réussi', async () => {
    const dir = tmpDir();
    const capturedMsgs = [];
    let step = 0;

    const llmGenerate = async () => {
      step++;
      if (step === 1) return JSON.stringify({ tool: 'plan', args: { objective: 'test', goals: [], steps: [] } });
      if (step === 2) return JSON.stringify({ tool: 'write_file', args: { path: 'hello.txt', content: 'hello' } });
      // Le 3e appel doit recevoir le nudge de vérification — on capture les messages
      return JSON.stringify({ tool: 'finish', args: { summary: 'done' } });
    };

    const events = [];
    await runAgent({
      task: 'créer hello.txt',
      llmGenerate: async (msgs, opts) => {
        capturedMsgs.push([...msgs]);
        return llmGenerate(msgs, opts);
      },
      projectRoot: dir,
      config: { maxSteps: 10 },
      onEvent: e => events.push(e),
    });

    // Le message résultat envoyé après write_file (3e message user) doit contenir le nudge
    const afterWriteMsg = capturedMsgs[2]?.slice(-1)[0];
    assert.ok(afterWriteMsg, 'doit y avoir un message après write_file');
    assert.ok(
      afterWriteMsg.content.includes('VÉRIFICATION OBLIGATOIRE'),
      `Le message après write_file doit contenir VÉRIFICATION OBLIGATOIRE.\nObtenu: ${afterWriteMsg.content.slice(0, 300)}`
    );

    try { fs.rmSync(dir, { recursive: true }); } catch {}
  });

  test('resultMsg contient le guidage BLOC_INTROUVABLE après replace_code raté', async () => {
    const dir = tmpDir();
    // Créer un fichier cible
    fs.writeFileSync(path.join(dir, 'target.js'), 'const x = 1;\n');

    let step = 0;
    const capturedMsgs = [];

    const llmGenerate = async () => {
      step++;
      if (step === 1) return JSON.stringify({ tool: 'plan', args: { objective: 'fix', goals: [], steps: [] } });
      if (step === 2) return JSON.stringify({
        tool: 'replace_code',
        args: { path: 'target.js', old_string: 'BLOC_QUI_NEXISTE_PAS', new_string: 'const x = 2;' },
      });
      return JSON.stringify({ tool: 'finish', args: { summary: 'done' } });
    };

    await runAgent({
      task: 'fixer target.js',
      llmGenerate: async (msgs, opts) => {
        capturedMsgs.push([...msgs]);
        return llmGenerate(msgs, opts);
      },
      projectRoot: dir,
      config: { maxSteps: 10 },
      onEvent: () => {},
    });

    const afterReplaceMsg = capturedMsgs[2]?.slice(-1)[0];
    assert.ok(afterReplaceMsg, 'doit y avoir un message après replace_code');
    assert.ok(
      afterReplaceMsg.content.includes('BLOC_INTROUVABLE') ||
      afterReplaceMsg.content.includes('Relis le fichier entier'),
      `Le message doit mentionner BLOC_INTROUVABLE ou guider vers read_file.\nObtenu: ${afterReplaceMsg.content.slice(0, 400)}`
    );

    try { fs.rmSync(dir, { recursive: true }); } catch {}
  });
});

// ── 3. Agent : avertissement précoce à 5 étapes ───────────────────────────────
describe('agent — budget précoce à 5 étapes', () => {
  const { runAgent } = require('../src/harness/agent');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  test('avertissement ⚠️ présent dans le message à 5 étapes restantes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-budget-'));
    const capturedMsgs = [];
    let step = 0;
    const MAX = 10; // maxSteps, 5e étape → 5 restantes

    const llmGenerate = async () => {
      step++;
      if (step === 1) return JSON.stringify({ tool: 'plan', args: { objective: 'x', goals: [], steps: [] } });
      if (step === 2) return JSON.stringify({ tool: 'read_file', args: { path: 'nonexistent.js' } });
      if (step === 3) return JSON.stringify({ tool: 'read_file', args: { path: 'nonexistent2.js' } });
      if (step === 4) return JSON.stringify({ tool: 'read_file', args: { path: 'nonexistent3.js' } });
      if (step === 5) return JSON.stringify({ tool: 'read_file', args: { path: 'nonexistent4.js' } });
      return JSON.stringify({ tool: 'finish', args: { summary: 'done' } });
    };

    await runAgent({
      task: 'tâche longue',
      llmGenerate: async (msgs, opts) => {
        capturedMsgs.push([...msgs]);
        return llmGenerate(msgs, opts);
      },
      projectRoot: dir,
      config: { maxSteps: MAX },
      onEvent: () => {},
    });

    // À l'étape 5, remaining = 10-5 = 5 → doit déclencher le warning précoce
    const msg5 = capturedMsgs[5]?.slice(-1)[0];
    assert.ok(msg5, 'doit y avoir un message à l\'étape 5');
    assert.ok(
      msg5.content.includes('⚠️') || msg5.content.includes('prévois'),
      `Le message à l'étape 5 doit contenir ⚠️ ou "prévois".\nObtenu: ${msg5?.content?.slice(0, 300)}`
    );

    try { fs.rmSync(dir, { recursive: true }); } catch {}
  });
});

// ── 4. Prompt système : règle 9 présente ─────────────────────────────────────
describe('system.js — règle 9 vérification après écriture', () => {
  const { buildSystemPrompt } = require('../src/harness/prompts/system');

  test('le prompt contient la règle de vérification après write/replace', () => {
    const prompt = buildSystemPrompt(['read_file', 'write_file', 'finish'], '');
    assert.ok(
      prompt.includes('write_file ou replace_code réussi'),
      'Le prompt doit mentionner la règle de vérification après écriture'
    );
    assert.ok(
      prompt.includes('read_file') && prompt.includes('intégration'),
      'Le prompt doit mentionner read_file et intégration dans la règle 9'
    );
  });

  test('la règle 9 est numérotée après la règle 8', () => {
    const prompt = buildSystemPrompt(['finish'], '');
    const idx8 = prompt.indexOf('8.');
    const idx9 = prompt.indexOf('9.');
    assert.ok(idx8 !== -1, 'La règle 8 doit exister');
    assert.ok(idx9 !== -1, 'La règle 9 doit exister');
    assert.ok(idx9 > idx8, 'La règle 9 doit venir après la règle 8');
  });
});
