'use strict';

// Les générations de fix_loop consomment le plafond de tokens de la tâche.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-budget-'));
process.env.APPDATA = tmpBase;
const { fixLoop } = require('../src/harness/tools/fix-loop');
const { makeGuard } = require('../src/harness/safety/path-guard');
const { runAgent } = require('../src/harness/agent');
after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

let counter = 0;
function project() {
  const root = path.join(tmpBase, `p${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node check.js' } }));
  fs.writeFileSync(path.join(root, 'check.js'), 'process.exit(1);');
  fs.writeFileSync(path.join(root, 'a.js'), 'broken');
  return root;
}

const fix = JSON.stringify({ tool: 'replace_code', args: { path: 'a.js', old_string: 'broken', new_string: 'broken ' } });

describe('fix_loop — plafond de tokens', () => {
  it('ne génère plus quand le plafond est déjà atteint', async () => {
    const root = project();
    let calls = 0;
    const r = await fixLoop({ max_iterations: 3 }, makeGuard(root), root, {
      maxTaskTokens: 1000, _taskTokens: { used: 1000 }, backupBeforeWrite: false,
      _llmGenerate: async () => { calls++; return fix; },
    });
    assert.equal(r.error, 'PLAFOND_TOKENS_ATTEINT');
    assert.equal(calls, 0);
  });

  it('compte chaque génération et s\'arrête au plafond', async () => {
    const root = project();
    const tokens = { used: 0 };
    let calls = 0;
    const r = await fixLoop({ max_iterations: 5 }, makeGuard(root), root, {
      maxTaskTokens: 250, _taskTokens: tokens, backupBeforeWrite: false,
      _llmGenerate: async (_m, opts) => {
        calls++;
        opts.onUsage({ inputTokens: 120, cachedTokens: 20, outputTokens: 30 });
        return calls % 2 ? fix : JSON.stringify({ tool: 'replace_code', args: { path: 'a.js', old_string: 'broken ', new_string: 'broken' } });
      },
    });
    assert.equal(r.error, 'PLAFOND_TOKENS_ATTEINT');
    assert.equal(calls, 2);
    assert.equal(tokens.used, 260);
  });

  it('l\'agent s\'arrête après un fix_loop qui a épuisé le budget', async () => {
    const root = project();
    let i = 0;
    const result = await runAgent({
      task: 'répare les tests', projectRoot: root,
      llmGenerate: async () => JSON.stringify(i++ === 0
        ? { tool: 'fix_loop', args: { max_iterations: 1 } }
        : { tool: 'finish', args: { summary: 's' } }),
      config: {
        autonomyLevel: 'off', enableFixLoop: true, maxTaskTokens: 100, backupBeforeWrite: false,
        _llmGenerate: async (_m, opts) => { opts.onUsage({ inputTokens: 500, outputTokens: 50 }); return fix; },
      },
    });
    assert.equal(result.error, 'PLAFOND_TOKENS_ATTEINT');
  });
});
