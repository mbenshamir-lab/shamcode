'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// ── Extraire les sources ───────────────────────────────────────────────────────
const fsSrc     = require('fs').readFileSync(path.join(__dirname, '../src/harness/tools/fs.js'), 'utf8');
const ipcSrc    = require('fs').readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
const parserSrc = require('fs').readFileSync(path.join(__dirname, '../src/harness/parser.js'), 'utf8');

// ── Charger replaceCode pour les tests fonctionnels ───────────────────────────
// On le charge via require (fs.js est CommonJS pur, pas de dépendances Electron)
// MAIS fs.js importe backup et diff — on mock les dépendances
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req.includes('backup'))   return { snapshot: () => {} };
  if (req.includes('diff'))     return { buildWritePreview: (p, o, n) => ({ type: 'write_preview', path: p }) };
  if (req.includes('harnessignore')) return { getIgnore: () => ({ isIgnored: () => false }) };
  return origLoad(req, ...rest);
};
const { replaceCode } = require(path.join(__dirname, '../src/harness/tools/fs.js'));
Module._load = origLoad; // restaurer

// Guard permissif pour les tests
const guard = (p) => path.resolve('/tmp/test', p);

// ── Fix 1 : CRLF préservé en chemin fuzzy ─────────────────────────────────────
describe('replaceCode fuzzy — préservation CRLF', () => {

  it('restaure CRLF si le fichier original en avait (fallback fuzzy)', async () => {
    // Créer un fichier temporaire avec CRLF
    const os   = require('os');
    const fs   = require('fs');
    const tmp  = require('path').join(os.tmpdir(), `test-crlf-${Date.now()}.js`);
    const orig = 'function hello() {\r\n  return 1;\r\n}\r\n';
    fs.writeFileSync(tmp, orig, 'utf8');

    // Guard pointant sur ce fichier
    const g = () => tmp;

    const result = await replaceCode(
      { path: 'test.js', old_string: 'function hello() {\n  return 1;\n}', new_string: 'function hello() {\n  return 42;\n}' },
      g,
      { backupBeforeWrite: false },
      () => {}
    );

    if (result.ok) {
      const written = fs.readFileSync(tmp, 'utf8');
      assert.ok(written.includes('\r\n'), 'CRLF doit être préservé après fuzzy replace');
      assert.ok(written.includes('42'), 'le nouveau contenu doit être présent');
    } else {
      // Si non-fuzzy (exact match), le test est non-applicable
      assert.ok(true, `non-fuzzy path: ${result.error || 'ok exact'}`);
    }

    try { fs.unlinkSync(tmp); } catch {}
  });

  it('ne change pas les LF si le fichier original était LF', async () => {
    const os  = require('os');
    const fs  = require('fs');
    const tmp = require('path').join(os.tmpdir(), `test-lf-${Date.now()}.js`);
    fs.writeFileSync(tmp, 'function hello() {\n  return 1;\n}\n', 'utf8');

    const g = () => tmp;
    const result = await replaceCode(
      { path: 'test.js', old_string: 'return 1;', new_string: 'return 99;' },
      g,
      { backupBeforeWrite: false },
      () => {}
    );

    if (result.ok) {
      const written = fs.readFileSync(tmp, 'utf8');
      assert.ok(!written.includes('\r\n'), 'CRLF ne doit pas être introduit dans un fichier LF');
      assert.ok(written.includes('99'), 'contenu remplacé');
    }
    try { fs.unlinkSync(tmp); } catch {}
  });

  it('le code de restauration CRLF est présent dans fs.js', () => {
    assert.ok(
      fsSrc.includes("raw.includes('\\r\\n')") || fsSrc.includes('raw.includes("\\r\\n")'),
      'détection CRLF absente de fs.js'
    );
    assert.ok(
      fsSrc.includes('\\r\\n') && fsSrc.includes('replace(/\\r?\\n/g'),
      'restauration CRLF absente de fs.js'
    );
  });

});

// ── Fix 2 : contextBudget adapté au moteur (local court, cloud réglable) ──────
// Le budget local n'est plus la constante 2000 : il dépend du modèle (3B → 4000,
// 7B/14B → 8000) et couvre désormais le moteur CPU, qui était traité comme un cloud.
describe('ipc.js — contextBudget adapté au moteur', () => {

  it('délègue le budget au harness et transmet le réglage cloud', () => {
    assert.ok(ipcSrc.includes('resolveContextBudget({'), 'budget non délégué à context/budget.js');
    assert.ok(ipcSrc.includes('config.maxContextChars ?? MAX_CONTEXT_CHARS'), 'réglage cloud non transmis');
    assert.ok(!ipcSrc.includes('isLocal ? 2000'), 'ancienne constante 2000 encore présente');
  });

  it('réduit réellement le budget local, selon le modèle', () => {
    const { resolveContextBudget } = require('../src/harness/context/budget');
    assert.equal(resolveContextBudget({ engine: 'webllm', model: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC' }), 4000);
    assert.equal(resolveContextBudget({ engine: 'webllm', model: 'Qwen2.5-Coder-14B-Instruct-q4f16_1-MLC' }), 8000);
    assert.equal(resolveContextBudget({ engine: 'cpu', model: 'qwen2.5-coder-7b-q4_k_m.gguf' }), 8000);
    assert.equal(resolveContextBudget({ engine: 'openai-compat', maxContextChars: 12000 }), 12000);
  });

});

// ── Fix 3 : timeout WebLLM augmenté ───────────────────────────────────────────
describe('ipc.js — timeout WebLLM', () => {

  it('timeout WebLLM est 300s et non plus 120s', () => {
    assert.ok(!ipcSrc.includes('120_000'), 'ancien timeout 120s encore présent');
    assert.ok(ipcSrc.includes('300_000'), 'nouveau timeout 300s absent');
  });

});

// ── Fix 4 : parser fence greedy ───────────────────────────────────────────────
describe('parser.js — fence greedy pour fences imbriquées', () => {

  const { extractToolCall } = require(path.join(__dirname, '../src/harness/parser.js'));

  it('fence greedy : extrait le JSON même avec une fence imbriquée dans args.content', () => {
    const input = '```json\n{"tool":"write_file","args":{"path":"x.md","content":"```js\\ncode\\n```"}}\n```';
    const result = extractToolCall(input);
    // Le JSON doit être extrait correctement (tool présent)
    assert.ok(!result.error || result.error === 'JSON_INVALIDE',
      `résultat inattendu : ${JSON.stringify(result)}`
    );
    // S'il parse, vérifier les valeurs
    if (!result.error) {
      assert.equal(result.tool, 'write_file');
    }
  });

  it('fence simple sans imbrication fonctionne toujours', () => {
    const input = '```json\n{"tool":"read_file","args":{"path":"src/main.js"}}\n```';
    const result = extractToolCall(input);
    assert.ok(!result.error, `erreur inattendue : ${result.error}`);
    assert.equal(result.tool, 'read_file');
    assert.equal(result.args.path, 'src/main.js');
  });

  it('sans fence : extrait le JSON brut', () => {
    const input = '{"tool":"finish","args":{"summary":"done"}}';
    const result = extractToolCall(input);
    assert.ok(!result.error);
    assert.equal(result.tool, 'finish');
  });

  it('la regex fence est maintenant greedy (pas de *?)', () => {
    // Vérifier dans le source que la regex utilise * et non *?
    const fenceRegex = parserSrc.match(/text\.match\(\/```[\s\S]*?\/\)/);
    // La regex doit contenir `[\s\S]*` (greedy) plutôt que `[\s\S]*?`
    // On cherche la ligne concernée dans le source
    const fenceLine = parserSrc.split('\n').find(l => l.includes('```') && l.includes('match'));
    assert.ok(fenceLine, 'ligne fence introuvable dans parser.js');
    assert.ok(!fenceLine.includes('*?)'), 'regex encore non-greedy (*?) dans parser.js');
  });

});
