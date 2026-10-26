const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { runAgent } = require('../src/harness/agent');
const { PROFILES } = require('../src/harness/agents/profiles');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

// Répertoire temporaire isolé pour chaque test
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agent-'));
  // On envoie les sessions + RAG dans ce répertoire
  process.env.APPDATA = d;
  return d;
}

function mockLlm(responses) {
  let i = 0;
  return async () => responses[i < responses.length ? i++ : responses.length - 1];
}

test('runAgent — tâche simple → finish avec summary', async () => {
  const dir = tmpDir();
  const events = [];
  const result = await runAgent({
    task: 'dis bonjour',
    projectRoot: dir,
    llmGenerate: mockLlm(['{"tool":"finish","args":{"summary":"Bonjour !"}}' ]),
    onEvent: e => events.push(e),
  });
  assert.ok(result.ok);
  assert.equal(result.summary, 'Bonjour !');
  assert.ok(events.some(e => e.type === 'finish'));
});

test('runAgent — retry sur JSON invalide puis succès', async () => {
  const dir = tmpDir();
  const result = await runAgent({
    task: 'test retry',
    projectRoot: dir,
    llmGenerate: mockLlm([
      'blabla pas de json',
      '{"tool":"finish","args":{"summary":"ok après retry"}}',
    ]),
  });
  assert.ok(result.ok);
  assert.equal(result.summary, 'ok après retry');
});

test('runAgent — trace complète générée', async () => {
  const dir = tmpDir();
  const result = await runAgent({
    task: 'trace test',
    projectRoot: dir,
    llmGenerate: mockLlm([
      '{"tool":"list_dir","args":{"path":"."}}',
      '{"tool":"finish","args":{"summary":"trace ok"}}',
    ]),
  });
  assert.ok(result.trace.length >= 2);
  assert.equal(result.trace[0].tool, 'list_dir');
});

test('runAgent — MAX_STEPS_ATTEINT si jamais finish', async () => {
  const dir = tmpDir();
  const result = await runAgent({
    task: 'boucle infinie',
    projectRoot: dir,
    config: { maxSteps: 3 },
    llmGenerate: mockLlm(['{"tool":"list_dir","args":{"path":"."}}' ]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'MAX_STEPS_ATTEINT');
});

test('runAgent — annulation via AbortSignal', async () => {
  const dir = tmpDir();
  const ctrl = new AbortController();
  // Pré-aborter : le signal est déjà annulé avant la première itération
  ctrl.abort();
  const result = await runAgent({
    task: 'cancel test',
    projectRoot: dir,
    signal: ctrl.signal,
    llmGenerate: async () => '{"tool":"finish","args":{"summary":"jamais"}}',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ANNULÉ');
});

test('runAgent — erreur LLM → propagée comme LLM_ERREUR', async () => {
  const dir = tmpDir();
  const result = await runAgent({
    task: 'erreur llm',
    projectRoot: dir,
    llmGenerate: async () => { throw new Error('réseau coupé'); },
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.startsWith('LLM_ERREUR'));
});

test('runAgent — sous-agent ne crée pas de session', async () => {
  const dir = tmpDir();
  const sessionsDir = require('path').join(dir, 'code-harness', 'sessions');

  // Lancer runAgent en mode sous-agent (_subAgent: true)
  const result = await runAgent({
    task: 'sous-tâche test',
    projectRoot: dir,
    config: { _subAgent: true, backupBeforeWrite: false },
    llmGenerate: mockLlm(['{"tool":"finish","args":{"summary":"sous-agent ok"}}' ]),
  });

  assert.ok(result.ok, result.error);
  // Aucun fichier de session ne doit avoir été créé
  const sessionFiles = require('fs').existsSync(sessionsDir)
    ? require('fs').readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
    : [];
  assert.equal(sessionFiles.length, 0, 'Le sous-agent ne doit pas créer de session');
});

test('runAgent — sous-agent analyzer : write_file refusé (hors périmètre)', async () => {
  const dir  = tmpDir();
  const file = 'interdit.txt';
  const events = [];

  const result = await runAgent({
    task: 'analyse en lecture seule',
    projectRoot: dir,
    config: {
      _subAgent: true,
      _allowedTools: PROFILES.analyzer.allowedTools,
      maxSteps: 4,
      backupBeforeWrite: false,
    },
    llmGenerate: mockLlm([
      `{"tool":"write_file","args":{"path":"${file}","content":"x"}}`,
      '{"tool":"finish","args":{"summary":"analyse terminée"}}',
    ]),
    onEvent: e => events.push(e),
  });

  // Le sous-agent termine normalement : le refus ne casse pas la boucle
  assert.ok(result.ok, result.error);

  // Aucun fichier n'a été écrit
  assert.equal(fs.existsSync(path.join(dir, file)), false, 'analyzer ne doit jamais écrire');

  // Le refus est tracé avec son code d'erreur, sans dispatch
  const entry = result.trace.find(t => t.tool === 'write_file');
  assert.ok(entry, 'l\'appel doit apparaître dans la trace');
  assert.match(entry.result.error, /^OUTIL_HORS_PERIMETRE/);

  // L'événement dédié est émis pour l'UI
  const blocked = events.find(e => e.type === 'tool_blocked');
  assert.ok(blocked, 'un événement tool_blocked doit être émis');
  assert.equal(blocked.tool, 'write_file');
});

test('runAgent — cache read_file invalidé après write_file', async () => {
  const dir  = tmpDir();
  const file = 'cache-test.txt';
  fs.writeFileSync(path.join(dir, file), 'contenu initial');

  const readCalls = [];
  // Séquence : read → write → read (le deuxième read doit renvoyer le vrai contenu)
  const responses = [
    `{"tool":"read_file","args":{"path":"${file}"}}`,
    `{"tool":"write_file","args":{"path":"${file}","content":"contenu mis à jour"}}`,
    `{"tool":"read_file","args":{"path":"${file}"}}`,
    '{"tool":"finish","args":{"summary":"cache ok"}}',
  ];

  const result = await runAgent({
    task: 'test cache',
    projectRoot: dir,
    config: { backupBeforeWrite: false },
    llmGenerate: mockLlm(responses),
    onEvent: e => {
      if (e.type === 'tool_result' && e.result?.content) readCalls.push(e.result.content);
    },
  });

  assert.ok(result.ok, result.error);
  // Le second read ne doit PAS retourner "[déjà lu]"
  assert.ok(
    !readCalls[1]?.includes('déjà lu'),
    'Le cache aurait dû être invalidé après write_file',
  );
});
