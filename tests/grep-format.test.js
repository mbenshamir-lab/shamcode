'use strict';

// ADR-045 : search_grep est réinjecté au modèle en texte groupé par fichier.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-format-'));
process.env.APPDATA = tmpBase;
const { formatGrepMatches } = require('../src/harness/tools/grep');
const { runAgent } = require('../src/harness/agent');
after(() => { fs.rmSync(tmpBase, { recursive: true, force: true }); });

describe('formatGrepMatches', () => {
  it('écrit le chemin une fois, puis ligne:texte', () => {
    const out = formatGrepMatches([
      { path: 'a.js', line: 3, text: 'foo()' },
      { path: 'a.js', line: 9, text: 'foo(1)' },
      { path: 'b/c.js', line: 1, text: 'foo' },
    ]);
    assert.equal(out, 'a.js\n3:foo()\n9:foo(1)\nb/c.js\n1:foo');
  });

  it('aucun résultat', () => {
    assert.equal(formatGrepMatches([]), 'Aucune correspondance.');
  });

  it('contexte : ligne-texte, chevauchements fusionnés', () => {
    const out = formatGrepMatches([
      { path: 'a.js', line: 2, text: 'x', context: [
        { line: 1, text: 'a', match: false }, { line: 2, text: 'x', match: true }, { line: 3, text: 'x2', match: false },
      ] },
      { path: 'a.js', line: 3, text: 'x2', context: [
        { line: 2, text: 'x', match: false }, { line: 3, text: 'x2', match: true }, { line: 4, text: 'b', match: false },
      ] },
    ]);
    assert.equal(out, 'a.js\n1-a\n2:x\n3:x2\n4-b');
  });
});

describe('agent — résultat de search_grep réinjecté', () => {
  it('le modèle reçoit le texte groupé, la trace garde la structure', async () => {
    const root = path.join(tmpBase, 'p');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.js'), 'const cible = 1;\nconst autre = cible;\n');
    const seen = [];
    let calls = 0;
    const result = await runAgent({
      task: 't', projectRoot: root, config: { maxSteps: 5 },
      llmGenerate: async (messages) => {
        seen.push(String(messages.at(-1).content));
        calls += 1;
        return JSON.stringify(calls === 1
          ? { tool: 'search_grep', args: { pattern: 'cible' } }
          : { tool: 'finish', args: { summary: 'fin' } });
      },
    });
    assert.ok(seen[1].startsWith('Résultat : a.js\n1:const cible = 1;\n2:const autre = cible;'), seen[1]);
    const step = result.trace.find(e => e.tool === 'search_grep');
    assert.equal(step.result.matches.length, 2);
  });
});
