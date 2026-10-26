'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

// ── Bug 1 : enableShell false par défaut ──────────────────────────────────────
describe('Bug 1 — enableShell false par défaut', () => {
  it('DEFAULTS.enableShell est false', () => {
    const { DEFAULTS } = require('../src/main/config');
    assert.strictEqual(DEFAULTS.enableShell, false,
      'enableShell doit être false par défaut (CLAUDE.md)');
  });
});

// ── Bug 2 : move_file invalide la destination dans _readCache ─────────────────
describe('Bug 2 — move_file invalide la destination dans _readCache', () => {
  const agentSrc = fs.readFileSync(
    path.join(__dirname, '../src/harness/agent.js'), 'utf8'
  );

  it('le code invalide parsed.args.dest après move_file', () => {
    assert.ok(
      agentSrc.includes('parsed.args.dest'),
      'agent.js doit invalider parsed.args.dest du cache après move_file'
    );
  });

  it('la suppression de dest est conditionnelle à MOVE_FILE', () => {
    assert.ok(
      agentSrc.includes('TOOLS.MOVE_FILE && parsed.args.dest'),
      'la suppression de dest doit être gardée par un test MOVE_FILE'
    );
  });
});

// ── Bug 3 : troncature des résultats sans champ content ──────────────────────
describe('Bug 3 — troncature des résultats sans content', () => {
  const agentSrc = fs.readFileSync(
    path.join(__dirname, '../src/harness/agent.js'), 'utf8'
  );

  // Extraire _truncateResult et la logique de troncature globale
  const MAX_RESULT_CHARS = 6000;

  // Extraire _truncateResult
  const trMatch = agentSrc.match(/function _truncateResult\(result\) \{([\s\S]*?)\n\}/);
  assert.ok(trMatch, '_truncateResult introuvable');

  const trFn = new Function('result', trMatch[1] + '\nreturn result;');

  // Reconstruire la logique du bloc resultForContext depuis le source
  const rcMatch = agentSrc.match(
    /let resultForContext;([\s\S]*?)entry\.result = result;/
  );
  assert.ok(rcMatch, 'bloc resultForContext introuvable');

  const rcCode = `
    const MAX_RESULT_CHARS = ${MAX_RESULT_CHARS};
    function _truncateResult(result) { ${trMatch[1]}
      return result;
    }
    let result = _result;
    ${rcMatch[1]}
    return resultForContext;
  `;
  const buildResultForContext = new Function('_result', rcCode);

  it('résultat avec content long est tronqué via content', () => {
    const longContent = 'x'.repeat(MAX_RESULT_CHARS + 500);
    const r = buildResultForContext({ ok: true, content: longContent });
    assert.ok(typeof r === 'object', 'doit rester un objet');
    assert.ok(r.content.length < longContent.length, 'content doit être tronqué');
    assert.ok(r.content.includes('tronqué'), 'message de troncature attendu');
  });

  it('résultat sans content mais court n\'est pas modifié', () => {
    const r = buildResultForContext({ ok: true, matches: [{ path: 'a.js', line: 1, text: 'foo' }] });
    assert.ok(typeof r === 'object', 'doit rester un objet');
    assert.ok(Array.isArray(r.matches), 'matches doit être présent');
  });

  it('résultat sans content mais long est tronqué en string', () => {
    const bigMatches = Array.from({ length: 200 }, (_, i) => ({
      path: `file${i}.js`, line: i, text: 'x'.repeat(100),
    }));
    const r = buildResultForContext({ ok: true, matches: bigMatches });
    // Doit être tronqué (string ou objet réduit)
    const serialized = typeof r === 'string' ? r : JSON.stringify(r);
    assert.ok(
      serialized.length <= MAX_RESULT_CHARS + 200,
      `résultat trop long : ${serialized.length} chars`
    );
    assert.ok(serialized.includes('tronqué'), 'message de troncature attendu');
  });

  it('résultat en erreur n\'est pas tronqué', () => {
    const r = buildResultForContext({ ok: false, error: 'FICHIER_INTROUVABLE' });
    assert.deepEqual(r, { ok: false, error: 'FICHIER_INTROUVABLE' });
  });

  it('le resultMsg utilise JSON.stringify ou la string selon le type', () => {
    // Vérifier que le source gère le cas string
    assert.ok(
      agentSrc.includes('typeof resultForContext === \'string\''),
      'resultMsg doit tester typeof resultForContext === string'
    );
  });
});
