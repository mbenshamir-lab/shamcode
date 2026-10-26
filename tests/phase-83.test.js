'use strict';
/**
 * Phase 83 — Tests des nouvelles fonctionnalités :
 * 1. Scanner de secrets (fs.js)
 * 2. Boucle test automatique (nudge agent.js + règle system.js)
 * 3. Git en écriture (git.js + constants.js + agent.js)
 * 4. Formateur post-édition (formatter.js)
 * 5. Input image (agent.js + gemini.js + claude.js)
 * 6. Queue de tâches (app.js — présence du code)
 * 7. Contexte auto find_relevant_files (find-relevant.js + agent.js)
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

const ROOT = path.join(__dirname, '..');

// ── 1. Scanner de secrets ─────────────────────────────────────────────────────
describe('Scanner de secrets — fs.js', () => {
  // Extraire la fonction _detectSecrets du module via require
  // Elle n'est pas exportée → on la charge via le fichier source
  let _detectSecrets;
  before(() => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/fs.js'), 'utf8');
    // Exécuter le module dans un contexte minimal pour accéder à _detectSecrets
    const mod = {};
    // Instancier simplement en requérant le module — mais il a des deps
    // On extrait manuellement la logique en testant le comportement via writeFile mock
    // Plutôt : on crée un wrapper de test
    const fnMatch = src.match(/function _detectSecrets\(content\) \{([\s\S]+?)\n\}/);
    assert.ok(fnMatch, '_detectSecrets doit être définie dans fs.js');
    _detectSecrets = new Function('content', `
      const SECRET_PATTERNS = ${src.match(/const SECRET_PATTERNS = (\[[\s\S]+?\]);/)[1]};
      ${fnMatch[0].slice('function _detectSecrets(content) {'.length, -1)}
    `);
  });

  it('détecte une clé OpenAI (sk-)', () => {
    const content = 'const key = "sk-abcdefghijklmnopqrstuv";\n';
    const w = _detectSecrets(content);
    assert.ok(w.length > 0, 'doit détecter sk-');
    assert.ok(w[0].label.includes('OpenAI'));
  });

  it('détecte un token GitHub (ghp_)', () => {
    const content = `token: ghp_${'A'.repeat(36)}`;
    const w = _detectSecrets(content);
    assert.ok(w.length > 0);
  });

  it('détecte une clé AWS', () => {
    const w = _detectSecrets(`AKIAIOSFODNN7EXAMPLE`);
    assert.ok(w.length > 0);
  });

  it('détecte un JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const w = _detectSecrets(jwt);
    assert.ok(w.length > 0);
  });

  it('ne lève pas de faux positif sur du code normal', () => {
    const content = 'const x = 42;\nfunction foo() { return "hello"; }\n';
    const w = _detectSecrets(content);
    assert.strictEqual(w.length, 0);
  });

  it('detecte un mot de passe en dur', () => {
    const w = _detectSecrets('password: "MonMotDePasse123"');
    assert.ok(w.length > 0);
  });

  it('retourne la ligne concernée', () => {
    const content = 'ligne 1\nconst key = "sk-abcdefghijklmnopqrstuvwxyz";\nligne 3';
    const w = _detectSecrets(content);
    assert.strictEqual(w[0].line, 2);
  });
});

// ── 2. Boucle test automatique ────────────────────────────────────────────────
describe('Boucle test — nudge agent.js + règle system.js', () => {
  it('system.js contient la règle 10 sur run_tests', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/prompts/system.js'), 'utf8');
    assert.ok(src.includes('run_tests'), 'règle 10 doit mentionner run_tests');
    assert.ok(src.includes('suite de tests'), 'règle 10 doit mentionner la suite de tests');
  });

  it('system.js contient la règle 11 sur les secrets', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/prompts/system.js'), 'utf8');
    assert.ok(src.includes('SECRET POTENTIEL'), 'règle 11 doit mentionner SECRET POTENTIEL');
  });

  it('agent.js contient le nudge test 🧪', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes('🧪 TESTS'), 'nudge test doit être présent dans agent.js');
    assert.ok(src.includes('run_tests'), 'nudge test doit mentionner run_tests');
  });

  it('agent.js contient le nudge secrets ⚠️', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes('SECRET POTENTIEL DÉTECTÉ'), 'nudge secrets doit être présent');
    assert.ok(src.includes('secretWarnings'), 'doit vérifier result.secretWarnings');
  });

  it('extensions de code ciblées par le nudge', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes("'.js'"), 'extension .js incluse');
    assert.ok(src.includes("'.py'"), 'extension .py incluse');
    assert.ok(src.includes("'.ts'"), 'extension .ts incluse');
  });
});

// ── 3. Git en écriture ────────────────────────────────────────────────────────
describe('Git en écriture — git.js', () => {
  const { gitCreateBranch, gitCommit } = require(path.join(ROOT, 'src/harness/tools/git.js'));

  it('gitCreateBranch export existe', () => {
    assert.strictEqual(typeof gitCreateBranch, 'function');
  });

  it('gitCommit export existe', () => {
    assert.strictEqual(typeof gitCommit, 'function');
  });

  it('gitCreateBranch refuse si enableGitWrite absent', async () => {
    const guard = p => p;
    const r = await gitCreateBranch({ name: 'test' }, guard, process.cwd(), {});
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('GIT_WRITE_DÉSACTIVÉ'));
  });

  it('gitCommit refuse si enableGitWrite absent', async () => {
    const guard = p => p;
    const r = await gitCommit({ message: 'test' }, guard, process.cwd(), {});
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('GIT_WRITE_DÉSACTIVÉ'));
  });

  it('gitCreateBranch refuse un nom invalide', async () => {
    const guard = p => p;
    const r = await gitCreateBranch({ name: 'my branch with spaces' }, guard, process.cwd(), { enableGitWrite: true });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('INVALIDE') || r.error.includes('NOT_FOUND'));
  });

  it('gitCommit refuse si message manquant', async () => {
    const guard = p => p;
    const r = await gitCommit({}, guard, process.cwd(), { enableGitWrite: true });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('COMMIT_MESSAGE_MANQUANT'));
  });

  it('constants.js contient GIT_CREATE_BRANCH', () => {
    const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
    assert.strictEqual(TOOLS.GIT_CREATE_BRANCH, 'git_create_branch');
  });

  it('constants.js contient GIT_COMMIT', () => {
    const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
    assert.strictEqual(TOOLS.GIT_COMMIT, 'git_commit');
  });

  it('agent.js expose git_create_branch quand enableGitWrite', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes('enableGitWrite') && src.includes('git_create_branch'));
  });
});

// ── 4. Formateur post-édition ──────────────────────────────────────────────────
describe('Formateur — formatter.js', () => {
  const { formatFile, _detectFormatter } = require(path.join(ROOT, 'src/harness/tools/formatter.js'));

  it('formatFile export existe', () => {
    assert.strictEqual(typeof formatFile, 'function');
  });

  it('_detectFormatter export existe', () => {
    assert.strictEqual(typeof _detectFormatter, 'function');
  });

  it('formatFile refuse sans chemin', async () => {
    const guard = p => p;
    const r = await formatFile({}, guard, process.cwd());
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('CHEMIN_MANQUANT'));
  });

  it('_detectFormatter retourne null pour extension inconnue', () => {
    const r = _detectFormatter('foo.xyz', process.cwd());
    assert.strictEqual(r, null);
  });

  it('constants.js contient FORMAT_FILE', () => {
    const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
    assert.strictEqual(TOOLS.FORMAT_FILE, 'format_file');
  });

  it('format_file est dans la liste des outils agent', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes("'format_file'"));
  });

  it('dispatch gère TOOLS.FORMAT_FILE', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/index.js'), 'utf8');
    assert.ok(src.includes('TOOLS.FORMAT_FILE'));
  });
});

// ── 5. Input image ─────────────────────────────────────────────────────────────
describe('Input image — agent + engines', () => {
  it('_buildTaskContent export existe dans agent.js (via source)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes('function _buildTaskContent'), '_buildTaskContent doit être définie');
  });

  it('_buildTaskContent retourne string si pas d\'images', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes("if (!images || images.length === 0) return task"), 'fallback string sans images');
  });

  it('_buildTaskContent retourne tableau avec images', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes("type: 'text', text: task"), 'bloc texte dans le tableau');
    assert.ok(src.includes("type: 'image'"), 'bloc image dans le tableau');
  });

  it('gemini.js gère le contenu Array (inlineData)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/llm/engines/gemini.js'), 'utf8');
    assert.ok(src.includes('inlineData'), 'gemini.js doit convertir les images en inlineData');
    assert.ok(src.includes('Array.isArray'), 'gemini.js doit tester Array.isArray');
  });

  it('claude.js gère le contenu Array (base64 source)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/llm/engines/claude.js'), 'utf8');
    assert.ok(src.includes("type: 'base64'"), 'claude.js doit utiliser source base64');
    assert.ok(src.includes('Array.isArray'), 'claude.js doit tester Array.isArray');
  });

  it('index.html contient un bouton d\'attachement unifié', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/index.html'), 'utf8');
    assert.ok(src.includes('btn-attach'), 'bouton attachement dans le HTML');
    assert.ok(src.includes('file-input'), 'input fichier/image unifié dans le HTML');
  });

  it('app.js contient _attachedImages', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_attachedImages'), '_attachedImages doit être déclaré');
  });

  it('app.js gère le paste d\'image (paste event)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes("'paste'"), 'handler paste doit être présent');
    assert.ok(src.includes('startsWith(\'image/\')'), 'filtre type image dans le paste');
  });
});

// ── 6. Queue de tâches ─────────────────────────────────────────────────────────
describe('Queue de tâches — app.js', () => {
  it('_taskQueue est déclaré', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_taskQueue'), '_taskQueue doit être déclaré');
  });

  it('_isRunning est déclaré', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_isRunning'), '_isRunning doit être déclaré');
  });

  it('sendTask empile dans la queue si _isRunning', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_taskQueue.push'), 'push vers la queue si _isRunning');
    assert.ok(src.includes('mise en file d\'attente'), 'message informatif sur la file');
  });

  it('sendTask dépile la queue après fin de tâche', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_taskQueue.shift()'), 'shift() pour dépiler la queue');
    assert.ok(src.includes('setTimeout(() => sendTask()'), 'relance sendTask depuis la queue');
  });

  it('_isRunning est remis à false dans finally', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('_isRunning = false'), '_isRunning remis à false en finally');
  });

  it('_appendSystemMessage est définie', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
    assert.ok(src.includes('function _appendSystemMessage'), '_appendSystemMessage doit exister');
  });

  it('styles.css contient .message-system', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/styles.css'), 'utf8');
    assert.ok(src.includes('.message-system'), 'style .message-system doit exister');
  });
});

// ── 7. Contexte auto find_relevant_files ──────────────────────────────────────
describe('find_relevant_files — find-relevant.js', () => {
  const { findRelevantFiles } = require(path.join(ROOT, 'src/harness/tools/find-relevant.js'));

  it('export existe', () => {
    assert.strictEqual(typeof findRelevantFiles, 'function');
  });

  it('refuse si task manquante', async () => {
    const r = await findRelevantFiles({}, process.cwd());
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('TASK_MANQUANTE'));
  });

  it('refuse si projectRoot manquant', async () => {
    const r = await findRelevantFiles({ task: 'test' }, '');
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('PROJET_NON_DÉFINI'));
  });

  it('retourne ok:true avec un répertoire valide', async () => {
    const r = await findRelevantFiles({ task: 'agent boucle test', top_k: 5 }, path.join(ROOT));
    assert.strictEqual(r.ok, true);
    assert.ok(Array.isArray(r.files), 'files doit être un tableau');
  });

  it('chaque fichier retourné a path et score', async () => {
    const r = await findRelevantFiles({ task: 'write_file backup guard', top_k: 3 }, path.join(ROOT));
    if (r.files.length > 0) {
      assert.ok(typeof r.files[0].path === 'string', 'path doit être string');
      assert.ok(typeof r.files[0].score === 'number', 'score doit être number');
    }
  });

  it('constants.js contient FIND_RELEVANT_FILES', () => {
    const { TOOLS } = require(path.join(ROOT, 'src/shared/constants.js'));
    assert.strictEqual(TOOLS.FIND_RELEVANT_FILES, 'find_relevant_files');
  });

  it('find_relevant_files est dans les toolNames de l\'agent', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/agent.js'), 'utf8');
    assert.ok(src.includes("'find_relevant_files'"), 'find_relevant_files dans toolNames');
  });

  it('dispatch gère TOOLS.FIND_RELEVANT_FILES', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/harness/tools/index.js'), 'utf8');
    assert.ok(src.includes('TOOLS.FIND_RELEVANT_FILES'), 'case dans le dispatch');
  });
});
