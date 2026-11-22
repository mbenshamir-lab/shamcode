# CODE_INDEX — Fonctions publiques exportées

> Généré le 2026-11-22 par `npm run index`.
> **215 symboles** dans **91 modules**.
> Ne pas modifier manuellement — régénérer avec `npm run index`.

---

## Table des matières

- [src/cli/config-loader.js](#src-cli-config-loader-js) (2)
- [src/cli/output.js](#src-cli-output-js) (8)
- [src/harness/agent.js](#src-harness-agent-js) (1)
- [src/harness/context/budget.js](#src-harness-context-budget-js) (3)
- [src/harness/context/builder.js](#src-harness-context-builder-js) (1)
- [src/harness/context/depgraph.js](#src-harness-context-depgraph-js) (2)
- [src/harness/context/symbols.js](#src-harness-context-symbols-js) (2)
- [src/harness/context/tree.js](#src-harness-context-tree-js) (1)
- [src/harness/context/trimmer.js](#src-harness-context-trimmer-js) (1)
- [src/harness/feedback/advisor.js](#src-harness-feedback-advisor-js) (1)
- [src/harness/feedback/store.js](#src-harness-feedback-store-js) (3)
- [src/harness/goals/model.js](#src-harness-goals-model-js) (6)
- [src/harness/goals/policy.js](#src-harness-goals-policy-js) (5)
- [src/harness/goals/store.js](#src-harness-goals-store-js) (7)
- [src/harness/llm/base.js](#src-harness-llm-base-js) (2)
- [src/harness/llm/list-models.js](#src-harness-llm-list-models-js) (1)
- [src/harness/llm/router.js](#src-harness-llm-router-js) (1)
- [src/harness/mcp/registry.js](#src-harness-mcp-registry-js) (1)
- [src/harness/memory/project-notes.js](#src-harness-memory-project-notes-js) (6)
- [src/harness/memory/scratchpad.js](#src-harness-memory-scratchpad-js) (1)
- [src/harness/memory/sessions.js](#src-harness-memory-sessions-js) (5)
- [src/harness/parser.js](#src-harness-parser-js) (1)
- [src/harness/prompts/by-language.js](#src-harness-prompts-by-language-js) (2)
- [src/harness/prompts/model-policy.js](#src-harness-prompts-model-policy-js) (1)
- [src/harness/prompts/personas.js](#src-harness-prompts-personas-js) (1)
- [src/harness/prompts/profile.js](#src-harness-prompts-profile-js) (1)
- [src/harness/prompts/system.js](#src-harness-prompts-system-js) (1)
- [src/harness/rag/embedder.js](#src-harness-rag-embedder-js) (2)
- [src/harness/rag/indexer.js](#src-harness-rag-indexer-js) (4)
- [src/harness/rag/lexical.js](#src-harness-rag-lexical-js) (1)
- [src/harness/rag/retrieve.js](#src-harness-rag-retrieve-js) (1)
- [src/harness/rag/store.js](#src-harness-rag-store-js) (1)
- [src/harness/safety/backup.js](#src-harness-safety-backup-js) (3)
- [src/harness/safety/diff.js](#src-harness-safety-diff-js) (3)
- [src/harness/safety/harnessignore.js](#src-harness-safety-harnessignore-js) (2)
- [src/harness/safety/path-guard.js](#src-harness-safety-path-guard-js) (1)
- [src/harness/scheduler/runner.js](#src-harness-scheduler-runner-js) (1)
- [src/harness/scheduler/store.js](#src-harness-scheduler-store-js) (4)
- [src/harness/tools/api.js](#src-harness-tools-api-js) (1)
- [src/harness/tools/ask.js](#src-harness-tools-ask-js) (1)
- [src/harness/tools/batch-replace.js](#src-harness-tools-batch-replace-js) (1)
- [src/harness/tools/browser.js](#src-harness-tools-browser-js) (20)
- [src/harness/tools/depgraph-tool.js](#src-harness-tools-depgraph-tool-js) (2)
- [src/harness/tools/deploy.js](#src-harness-tools-deploy-js) (1)
- [src/harness/tools/design.js](#src-harness-tools-design-js) (2)
- [src/harness/tools/diff-file.js](#src-harness-tools-diff-file-js) (1)
- [src/harness/tools/families.js](#src-harness-tools-families-js) (3)
- [src/harness/tools/find-relevant.js](#src-harness-tools-find-relevant-js) (1)
- [src/harness/tools/fix-loop.js](#src-harness-tools-fix-loop-js) (3)
- [src/harness/tools/formatter.js](#src-harness-tools-formatter-js) (2)
- [src/harness/tools/fs.js](#src-harness-tools-fs-js) (6)
- [src/harness/tools/git.js](#src-harness-tools-git-js) (4)
- [src/harness/tools/goal.js](#src-harness-tools-goal-js) (1)
- [src/harness/tools/grep.js](#src-harness-tools-grep-js) (1)
- [src/harness/tools/http-request.js](#src-harness-tools-http-request-js) (2)
- [src/harness/tools/image.js](#src-harness-tools-image-js) (1)
- [src/harness/tools/index.js](#src-harness-tools-index-js) (1)
- [src/harness/tools/lsp.js](#src-harness-tools-lsp-js) (6)
- [src/harness/tools/merge-videos.js](#src-harness-tools-merge-videos-js) (1)
- [src/harness/tools/message-bus.js](#src-harness-tools-message-bus-js) (4)
- [src/harness/tools/notify.js](#src-harness-tools-notify-js) (1)
- [src/harness/tools/orchestrate.js](#src-harness-tools-orchestrate-js) (1)
- [src/harness/tools/process-runner.js](#src-harness-tools-process-runner-js) (7)
- [src/harness/tools/project-info.js](#src-harness-tools-project-info-js) (1)
- [src/harness/tools/project-notes-tool.js](#src-harness-tools-project-notes-tool-js) (1)
- [src/harness/tools/read-url.js](#src-harness-tools-read-url-js) (1)
- [src/harness/tools/restore.js](#src-harness-tools-restore-js) (1)
- [src/harness/tools/rules.js](#src-harness-tools-rules-js) (4)
- [src/harness/tools/run-command.js](#src-harness-tools-run-command-js) (1)
- [src/harness/tools/scratchpad-tool.js](#src-harness-tools-scratchpad-tool-js) (1)
- [src/harness/tools/shell.js](#src-harness-tools-shell-js) (1)
- [src/harness/tools/spawn.js](#src-harness-tools-spawn-js) (4)
- [src/harness/tools/speech.js](#src-harness-tools-speech-js) (2)
- [src/harness/tools/symbols-search.js](#src-harness-tools-symbols-search-js) (1)
- [src/harness/tools/test-runner.js](#src-harness-tools-test-runner-js) (3)
- [src/harness/tools/validate.js](#src-harness-tools-validate-js) (1)
- [src/harness/tools/video.js](#src-harness-tools-video-js) (1)
- [src/harness/tools/web-search.js](#src-harness-tools-web-search-js) (1)
- [src/harness/voice/summarize.js](#src-harness-voice-summarize-js) (1)
- [src/main/apps-manager.js](#src-main-apps-manager-js) (1)
- [src/main/config.js](#src-main-config-js) (2)
- [src/main/ipc.js](#src-main-ipc-js) (1)
- [src/main/llm-bridge.js](#src-main-llm-bridge-js) (1)
- [src/main/notifications.js](#src-main-notifications-js) (2)
- [src/main/safe-keys.js](#src-main-safe-keys-js) (5)
- [src/main/shortcuts.js](#src-main-shortcuts-js) (2)
- [src/main/user-data.js](#src-main-user-data-js) (2)
- [src/main/voice.js](#src-main-voice-js) (3)
- [src/main/windows.js](#src-main-windows-js) (5)
- [src/shared/approval.js](#src-shared-approval-js) (1)
- [src/shared/data-dir.js](#src-shared-data-dir-js) (1)

---

## src/cli/config-loader.js

### `loadCliConfig` — [src/cli/config-loader.js:15](src/cli/config-loader.js)

```js
function loadCliConfig()
```

### `saveCliConfig` — [src/cli/config-loader.js:50](src/cli/config-loader.js)

```js
function saveCliConfig(cfg)
```

> Crée ~/.harness/config.json avec les valeurs fournies.

---

## src/cli/output.js

### `printHeader` — [src/cli/output.js:21](src/cli/output.js)

```js
function printHeader(projectRoot)
```

### `printStep` — [src/cli/output.js:26](src/cli/output.js)

```js
function printStep(step, tool, args)
```

### `printResult` — [src/cli/output.js:34](src/cli/output.js)

```js
function printResult(result)
```

### `printToken` — [src/cli/output.js:48](src/cli/output.js)

```js
function printToken(token)
```

### `printFinish` — [src/cli/output.js:52](src/cli/output.js)

```js
function printFinish(summary)
```

### `printError` — [src/cli/output.js:56](src/cli/output.js)

```js
function printError(msg)
```

### `printInfo` — [src/cli/output.js:60](src/cli/output.js)

```js
function printInfo(msg)
```

### `printAskUser` — [src/cli/output.js:64](src/cli/output.js)

```js
function printAskUser(question, suggestions)
```

---

## src/harness/agent.js

### `runAgent` — [src/harness/agent.js:169](src/harness/agent.js)

```js
async function runAgent({ task, llmGenerate, projectRoot, config = {}, onEvent = () => {}, signal = null })
```

---

## src/harness/context/budget.js

### `isSmallModel` — [src/harness/context/budget.js:29](src/harness/context/budget.js)

```js
function isSmallModel(model)
```

- @param {string} model nom du modèle (ex. « Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC »)

### `isLocalEngine` — [src/harness/context/budget.js:37](src/harness/context/budget.js)

```js
function isLocalEngine(engine)
```

- @param {string} engine nom du moteur (webllm, cpu, gemini, claude, openai-compat…)

### `resolveContextBudget` — [src/harness/context/budget.js:45](src/harness/context/budget.js)

```js
function resolveContextBudget({ engine, model, maxContextChars } = {})
```

- @param {{ engine?: string, model?: string, maxContextChars?: number }} opts

---

## src/harness/context/builder.js

### `buildContext` — [src/harness/context/builder.js:64](src/harness/context/builder.js)

```js
async function buildContext({ task, projectRoot, ragStore, targetFile, maxChars = DEFAULT_BUDGET, topK, fillBudget = ...
```

> Construit le contexte à injecter dans le prompt.   task:        string,   projectRoot: string,   ragStore?:   object,       // rag/store instance (optionnel en MVP)   targetFile?: string,       // chemin relatif du fichier principal de la tâche   maxChars?:   number, }} opts

- @param {{

---

## src/harness/context/depgraph.js

### `buildDepGraph` — [src/harness/context/depgraph.js:157](src/harness/context/depgraph.js)

```js
function buildDepGraph(projectRoot)
```

> Construit ou met à jour le graphe de dépendances du projet. Incrémental : seuls les fichiers dont le SHA1 a changé sont re-analysés.   deps       : { 'src/a.js': ['src/b.js'] }   dependents : { 'src/b.js': ['src/a.js'] }

- @param {string} projectRoot

### `queryFile` — [src/harness/context/depgraph.js:210](src/harness/context/depgraph.js)

```js
function queryFile(projectRoot, relPath)
```

> Retourne imports et importeurs d'un fichier (chemin relatif projet). Reconstruit le graphe si nécessaire.

- @param {string} projectRoot
- @param {string} relPath  ex. 'src/harness/agent.js'

---

## src/harness/context/symbols.js

### `extractSymbols` — [src/harness/context/symbols.js:27](src/harness/context/symbols.js)

```js
function extractSymbols(absPath)
```

> Extrait les symboles d'un fichier source.

- @param {string} absPath - Chemin absolu du fichier

### `symbolSummary` — [src/harness/context/symbols.js:62](src/harness/context/symbols.js)

```js
function symbolSummary(absPath)
```

> Retourne une string courte listant les symboles (pour le contexte LLM).

- @param {string} absPath

---

## src/harness/context/tree.js

### `buildTree` — [src/harness/context/tree.js:28](src/harness/context/tree.js)

```js
function buildTree(root, { maxDepth = 4, maxEntries = 200 } = {})
```

> Construit une arborescence ASCII du projet.

- @param {string} root       - Chemin absolu de la racine
- @param {{ maxDepth?: number, maxEntries?: number }} opts

---

## src/harness/context/trimmer.js

### `trimToBudget` — [src/harness/context/trimmer.js:52](src/harness/context/trimmer.js)

```js
function trimToBudget(parts, maxChars = MAX_CONTEXT_CHARS)
```

- @param {{ type: string, content: string }[]} parts  - Sections à assembler
- @param {number} maxChars                             - Budget total

---

## src/harness/feedback/advisor.js

### `buildFeedbackSummary` — [src/harness/feedback/advisor.js:40](src/harness/feedback/advisor.js)

```js
function buildFeedbackSummary(entries)
```

> Construit un résumé textuel des préférences d'approbation de l'utilisateur. Retourne une chaîne vide si l'historique est trop court.

- @param {{ ts: number, path: string, action: string, approved: boolean }[]} entries

---

## src/harness/feedback/store.js

### `_feedbackPath` — [src/harness/feedback/store.js:17](src/harness/feedback/store.js)

```js
function _feedbackPath(projectRoot)
```

### `recordFeedback` — [src/harness/feedback/store.js:26](src/harness/feedback/store.js)

```js
function recordFeedback({ projectRoot, path: filePath = '', action = '', approved, reason = '' })
```

> Enregistre une décision d'approbation ou de rejet.

- @param {{ projectRoot: string, path?: string, action?: string, approved: boolean, reason?: string }} entry

### `loadFeedback` — [src/harness/feedback/store.js:57](src/harness/feedback/store.js)

```js
function loadFeedback(projectRoot, limit = 50)
```

> Charge les N dernières entrées de feedback.

- @param {string} projectRoot
- @param {number} [limit=50]

---

## src/harness/goals/model.js

### `newGoalId` — [src/harness/goals/model.js:27](src/harness/goals/model.js)

```js
function newGoalId()
```

### `normalizeCriteria` — [src/harness/goals/model.js:63](src/harness/goals/model.js)

```js
function normalizeCriteria(raw)
```

> Valide et normalise les critères fournis par le modèle. Un critère sans vérification machine est refusé : pas de « done » déclaratif.

### `createGoal` — [src/harness/goals/model.js:117](src/harness/goals/model.js)

```js
function createGoal(input = {})
```

> Construit un objectif validé.

- @param {{ objective: string, source: string, criteria: object[], constraints?: string[], budget?: object, projectRoot: string, maxSteps?: number }} input

### `pendingCriteria` — [src/harness/goals/model.js:155](src/harness/goals/model.js)

```js
function pendingCriteria(goal)
```

### `allCriteriaMet` — [src/harness/goals/model.js:160](src/harness/goals/model.js)

```js
function allCriteriaMet(goal)
```

### `goalSummary` — [src/harness/goals/model.js:166](src/harness/goals/model.js)

```js
function goalSummary(goal, { maxLength = 700 } = {})
```

---

## src/harness/goals/policy.js

### `normalizeLevel` — [src/harness/goals/policy.js:37](src/harness/goals/policy.js)

```js
function normalizeLevel(level)
```

### `canDecideAlone` — [src/harness/goals/policy.js:42](src/harness/goals/policy.js)

```js
function canDecideAlone(level, decisionClass)
```

### `validateDecision` — [src/harness/goals/policy.js:51](src/harness/goals/policy.js)

```js
function validateDecision(args = {})
```

> Valide une décision journalisable.

### `evaluateGoalCompletion` — [src/harness/goals/policy.js:117](src/harness/goals/policy.js)

```js
function evaluateGoalCompletion(goal, { trace = [], filesChanged = 0, steps = 0, allowIncomplete = false } = {})
```

> Vérifie qu'un objectif peut être clôturé.

- @param {object} goal
- @param {{ trace?: object[], filesChanged?: number, steps?: number }} ctx

### `shouldWarnBudget` — [src/harness/goals/policy.js:158](src/harness/goals/policy.js)

```js
function shouldWarnBudget(goal, steps)
```

---

## src/harness/goals/store.js

### `goalsDir` — [src/harness/goals/store.js:17](src/harness/goals/store.js)

```js
function goalsDir(projectRoot)
```

### `goalFilePath` — [src/harness/goals/store.js:21](src/harness/goals/store.js)

```js
function goalFilePath(projectRoot, id)
```

### `saveGoal` — [src/harness/goals/store.js:35](src/harness/goals/store.js)

```js
function saveGoal(projectRoot, goal)
```

> Écrit l'objectif de façon atomique.

- @param {string} projectRoot
- @param {object} goal

### `loadGoal` — [src/harness/goals/store.js:55](src/harness/goals/store.js)

```js
function loadGoal(projectRoot, id)
```

### `listGoals` — [src/harness/goals/store.js:64](src/harness/goals/store.js)

```js
function listGoals(projectRoot)
```

### `loadActiveGoal` — [src/harness/goals/store.js:83](src/harness/goals/store.js)

```js
function loadActiveGoal(projectRoot)
```

### `archiveActiveGoal` — [src/harness/goals/store.js:91](src/harness/goals/store.js)

```js
function archiveActiveGoal(projectRoot, reason = 'remplacé par un nouvel objectif')
```

> Archive l'objectif actif avant d'en créer un nouveau.

---

## src/harness/llm/base.js

### `LlmEngine` — [src/harness/llm/base.js:5](src/harness/llm/base.js)

```js
class LlmEngine
```

> Interface commune à tous les moteurs LLM. Chaque moteur doit étendre cette classe.

### `httpError` — [src/harness/llm/base.js:25](src/harness/llm/base.js)

```js
async function httpError(prefix, res)
```

> Erreur d'une réponse HTTP non-OK. retryAfter (secondes) permet au router de respecter le délai demandé par le fournisseur plutôt que de le deviner.

- @param {string}   prefix  ex. 'CLAUDE'
- @param {Response} res

---

## src/harness/llm/list-models.js

### `listModels` — [src/harness/llm/list-models.js:67](src/harness/llm/list-models.js)

```js
async function listModels({ engine, apiKey, baseUrl })
```

- @param {{ engine: string, apiKey: string, baseUrl?: string }} opts

---

## src/harness/llm/router.js

### `LlmRouter` — [src/harness/llm/router.js:32](src/harness/llm/router.js)

```js
class LlmRouter
```

---

## src/harness/mcp/registry.js

### `McpRegistry` — [src/harness/mcp/registry.js:13](src/harness/mcp/registry.js)

```js
class McpRegistry
```

---

## src/harness/memory/project-notes.js

### `setNote` — [src/harness/memory/project-notes.js:52](src/harness/memory/project-notes.js)

```js
function setNote(projectRoot, key, value, tags = [])
```

### `getNote` — [src/harness/memory/project-notes.js:68](src/harness/memory/project-notes.js)

```js
function getNote(projectRoot, key)
```

### `listNotes` — [src/harness/memory/project-notes.js:73](src/harness/memory/project-notes.js)

```js
function listNotes(projectRoot)
```

### `deleteNote` — [src/harness/memory/project-notes.js:78](src/harness/memory/project-notes.js)

```js
function deleteNote(projectRoot, key)
```

### `getRelevantNotes` — [src/harness/memory/project-notes.js:96](src/harness/memory/project-notes.js)

```js
function getRelevantNotes(projectRoot, task, maxNotes = 5)
```

> Retourne les notes les plus pertinentes pour une tâche. Algorithme : overlap de tokens entre task et (key + value + tags).

- @param {string} projectRoot
- @param {string} task
- @param {number} [maxNotes=5]

### `notesToContextBlock` — [src/harness/memory/project-notes.js:123](src/harness/memory/project-notes.js)

```js
function notesToContextBlock(notes)
```

> Formate les notes sélectionnées en bloc de contexte compact.

- @param {{ key: string, value: string }[]} notes

---

## src/harness/memory/scratchpad.js

### `createScratchpad` — [src/harness/memory/scratchpad.js:17](src/harness/memory/scratchpad.js)

```js
function createScratchpad()
```

> Crée un scratchpad en mémoire.

---

## src/harness/memory/sessions.js

### `createSession` — [src/harness/memory/sessions.js:25](src/harness/memory/sessions.js)

```js
function createSession({ task, projectRoot })
```

> Crée une nouvelle session et la persiste sur disque.

- @param {{ task: string, projectRoot: string }} opts

### `updateSession` — [src/harness/memory/sessions.js:48](src/harness/memory/sessions.js)

```js
function updateSession(sessionPath, updates)
```

> Met à jour une session existante (steps, result, scratchpad).

- @param {string} sessionPath
- @param {Partial<object>} updates

### `loadSession` — [src/harness/memory/sessions.js:64](src/harness/memory/sessions.js)

```js
function loadSession(id)
```

> Charge une session depuis son id.

- @param {string} id

### `listSessions` — [src/harness/memory/sessions.js:73](src/harness/memory/sessions.js)

```js
function listSessions()
```

> Liste toutes les sessions, triées par date décroissante.

### `applyRetention` — [src/harness/memory/sessions.js:95](src/harness/memory/sessions.js)

```js
function applyRetention(maxSessions = 100)
```

> Supprime les sessions excédentaires (les plus anciennes).

- @param {number} maxSessions

---

## src/harness/parser.js

### `extractToolCall` — [src/harness/parser.js:33](src/harness/parser.js)

```js
function extractToolCall(rawText)
```

> Extrait un tool call JSON de la réponse brute du LLM. Tolérant : fences markdown, texte avant/après, virgules traînantes.

- @param {string} rawText

---

## src/harness/prompts/by-language.js

### `detectLanguage` — [src/harness/prompts/by-language.js:64](src/harness/prompts/by-language.js)

```js
function detectLanguage(projectRoot)
```

> Détecte le langage dominant d'un projet.

- @param {string} projectRoot

### `getLangRules` — [src/harness/prompts/by-language.js:150](src/harness/prompts/by-language.js)

```js
function getLangRules(lang)
```

> Retourne les règles spécifiques au langage détecté.

- @param {'js'|'ts'|'py'|'rust'|'go'|'java'|'csharp'|'ruby'|'php'|'generic'} lang

---

## src/harness/prompts/model-policy.js

### `resolveModelPolicy` — [src/harness/prompts/model-policy.js:51](src/harness/prompts/model-policy.js)

```js
function resolveModelPolicy({ engine, model, explicit } = {})
```

- @param {{ engine?: string, model?: string, explicit?: string }} opts

---

## src/harness/prompts/personas.js

### `resolvePersona` — [src/harness/prompts/personas.js:110](src/harness/prompts/personas.js)

```js
function resolvePersona(name)
```

> Retourne la définition d'un persona, ou `dev` par défaut.

- @param {string} [name]

---

## src/harness/prompts/profile.js

### `resolvePromptProfile` — [src/harness/prompts/profile.js:22](src/harness/prompts/profile.js)

```js
function resolvePromptProfile({ engine, model, explicit } = {})
```

- @param {{ engine?: string, model?: string, explicit?: string }} opts

---

## src/harness/prompts/system.js

### `buildSystemPrompt` — [src/harness/prompts/system.js:36](src/harness/prompts/system.js)

```js
function buildSystemPrompt(availableTools, projectContext = '', opts = {})
```

- @param {string[]} availableTools
- @param {string}   [projectContext]
- @param {{ systemExtra?: string, skipPlanRule?: boolean, busActive?: boolean, lang?: string, langRules?: string }} [opts]

---

## src/harness/rag/embedder.js

### `tokenize` — [src/harness/rag/embedder.js:50](src/harness/rag/embedder.js)

```js
function tokenize(text)
```

> Tokenise un texte en mots significatifs.

- @param {string} text

### `encode` — [src/harness/rag/embedder.js:80](src/harness/rag/embedder.js)

```js
function encode(text)
```

> Encode un texte en vecteur dense de longueur fixe (TF sublinéaire, normalisé L2).

- @param {string} text

---

## src/harness/rag/indexer.js

### `ragStoreId` — [src/harness/rag/indexer.js:41](src/harness/rag/indexer.js)

```js
function ragStoreId(projectRoot)
```

> Identifiant du store RAG d'un projet. Inclut les versions : un index écrit avec un autre encodage donnerait des vecteurs incomparables.

- @param {string} projectRoot

### `_findBoundaries` — [src/harness/rag/indexer.js:80](src/harness/rag/indexer.js)

```js
function _findBoundaries(lines, ext)
```

> Retourne les indices (0-based) des lignes qui démarrent une déclaration de haut niveau.

- @param {string[]} lines
- @param {string}   ext   extension en minuscules (ex. '.js')

### `chunkFile` — [src/harness/rag/indexer.js:100](src/harness/rag/indexer.js)

```js
function chunkFile(filePath, content, hash)
```

> Découpe un fichier en chunks. Pour les fichiers JS/TS/Python, utilise les frontières de déclarations. Fallback sur un découpage fixe (60 lignes + overlap 15) si aucune frontière détectée.

- @param {string} filePath  - Chemin relatif (pour les ids)
- @param {string} content
- @param {string} hash

### `indexProject` — [src/harness/rag/indexer.js:161](src/harness/rag/indexer.js)

```js
function indexProject(root, store, { onProgress } = {})
```

> Parcourt récursivement un dossier et indexe tous les fichiers source.

- @param {string}   root    - Chemin absolu de la racine du projet
- @param {object}   store   - Instance createStore()
- @param {{ onProgress?: (file: string) => void }} opts

---

## src/harness/rag/lexical.js

### `lexicalScores` — [src/harness/rag/lexical.js:26](src/harness/rag/lexical.js)

```js
function lexicalScores(chunks, terms)
```

- @param {{ path: string, content: string }[]} chunks
- @param {string[]} terms  termes de la requête

---

## src/harness/rag/retrieve.js

### `retrieveRelevant` — [src/harness/rag/retrieve.js:47](src/harness/rag/retrieve.js)

```js
async function retrieveRelevant(store, task, { topK = 5, projectRoot = null } = {})
```

- @param {object}   store        - Instance createStore()
- @param {string}   task         - La tâche (requête)
- @param {{ topK?: number, projectRoot?: string }} opts

---

## src/harness/rag/store.js

### `createStore` — [src/harness/rag/store.js:40](src/harness/rag/store.js)

```js
function createStore(storeId)
```

> Crée un store JSON simple.

- @param {string} storeId  - Identifiant unique (ex: hash du projectRoot)

---

## src/harness/safety/backup.js

### `getBackupDir` — [src/harness/safety/backup.js:6](src/harness/safety/backup.js)

```js
function getBackupDir()
```

### `fileKey` — [src/harness/safety/backup.js:17](src/harness/safety/backup.js)

```js
function fileKey(absPath)
```

> Clé de stockage d'un fichier : hash de son chemin absolu. Deux projets qui ont tous les deux un `src/app.js` ne partagent donc plus le même dossier de backups — restore_file ne peut plus restaurer le fichier d'un autre projet.

- @param {string} absPath

### `snapshot` — [src/harness/safety/backup.js:33](src/harness/safety/backup.js)

```js
function snapshot(absPath, maxBackups = 50)
```

> Copie un fichier dans le dossier de backup avant modification. Ne fait rien si le fichier n'existe pas encore. Applique une rétention : garde au plus maxBackups snapshots (les plus récents) pour ce fichier précis.

- @param {string} absPath   - Chemin absolu du fichier à sauvegarder
- @param {number} [maxBackups=50]

---

## src/harness/safety/diff.js

### `previewDiff` — [src/harness/safety/diff.js:13](src/harness/safety/diff.js)

```js
function previewDiff(oldContent, newContent, filename)
```

> Calcule un patch unifié entre deux contenus.

- @param {string} oldContent
- @param {string} newContent
- @param {string} filename

### `diffStats` — [src/harness/safety/diff.js:22](src/harness/safety/diff.js)

```js
function diffStats(patch)
```

> Retourne des stats lisibles sur un patch.

- @param {string} patch

### `buildWritePreview` — [src/harness/safety/diff.js:40](src/harness/safety/diff.js)

```js
function buildWritePreview(relPath, oldContent, newContent)
```

> Construit un objet d'événement write_preview complet.

- @param {string} relPath
- @param {string} oldContent  — '' si fichier nouveau
- @param {string} newContent

---

## src/harness/safety/harnessignore.js

### `loadHarnessIgnore` — [src/harness/safety/harnessignore.js:64](src/harness/safety/harnessignore.js)

```js
function loadHarnessIgnore(projectRoot)
```

> Charge le fichier .harnessignore depuis la racine du projet. Retourne un objet avec isIgnored(relPath).

- @param {string} projectRoot - Chemin absolu de la racine

### `getIgnore` — [src/harness/safety/harnessignore.js:106](src/harness/safety/harnessignore.js)

```js
function getIgnore(projectRoot)
```

> Version mise en cache de loadHarnessIgnore. Recharge si le fichier a changé depuis la dernière lecture.

- @param {string} projectRoot

---

## src/harness/safety/path-guard.js

### `makeGuard` — [src/harness/safety/path-guard.js:31](src/harness/safety/path-guard.js)

```js
function makeGuard(projectRoot)
```

> Crée un garde-fou FS pour un projectRoot donné. La fonction retournée résout un chemin relatif en absolu et lève une erreur si le chemin sort du projet ou est un symlink sortant.

- @param {string} projectRoot - Chemin absolu du dossier projet

---

## src/harness/scheduler/runner.js

### `SchedulerRunner` — [src/harness/scheduler/runner.js:10](src/harness/scheduler/runner.js)

```js
class SchedulerRunner
```

---

## src/harness/scheduler/store.js

### `listTasks` — [src/harness/scheduler/store.js:4](src/harness/scheduler/store.js)

```js
function listTasks(config)
```

### `addTask` — [src/harness/scheduler/store.js:8](src/harness/scheduler/store.js)

```js
function addTask(config, { label, cron, task, projectRoot, enabled = true })
```

### `deleteTask` — [src/harness/scheduler/store.js:26](src/harness/scheduler/store.js)

```js
function deleteTask(config, id)
```

### `toggleTask` — [src/harness/scheduler/store.js:34](src/harness/scheduler/store.js)

```js
function toggleTask(config, id)
```

---

## src/harness/tools/api.js

### `callApi` — [src/harness/tools/api.js:7](src/harness/tools/api.js)

```js
async function callApi(args, config)
```

> Outil call_api — appel REST authentifié vers une API tierce. Le token n'est jamais passé en clair dans les args ; il est résolu depuis config.apiTokens par une clé nommée.

---

## src/harness/tools/ask.js

### `askUser` — [src/harness/tools/ask.js:9](src/harness/tools/ask.js)

```js
async function askUser({ question, context = '', suggestions = [] }, config, onEvent)
```

- @param {{ question: string, context?: string, suggestions?: string[] }} args
- @param {object}   config
- @param {Function} onEvent

---

## src/harness/tools/batch-replace.js

### `batchReplace` — [src/harness/tools/batch-replace.js:64](src/harness/tools/batch-replace.js)

```js
function batchReplace( { pattern, replacement = '', path: subPath = '.', ext, dry_run = false } = {}, guard, projectR...
```

- @param {{ pattern: string, replacement?: string, path?: string, ext?: string, dry_run?: boolean }} args
- @param {Function} guard
- @param {string}   projectRoot

---

## src/harness/tools/browser.js

### `_setPuppeteerMock` — [src/harness/tools/browser.js:20](src/harness/tools/browser.js)

```js
function _setPuppeteerMock(mock) { _puppeteerOverride = mock; _puppeteer = null; }
```

### `browserOpen` — [src/harness/tools/browser.js:52](src/harness/tools/browser.js)

```js
async function browserOpen(args)
```

### `browserNavigate` — [src/harness/tools/browser.js:93](src/harness/tools/browser.js)

```js
async function browserNavigate(args)
```

### `browserScreenshot` — [src/harness/tools/browser.js:106](src/harness/tools/browser.js)

```js
async function browserScreenshot(args, guard, projectRoot)
```

### `browserClick` — [src/harness/tools/browser.js:132](src/harness/tools/browser.js)

```js
async function browserClick(args)
```

### `browserType` — [src/harness/tools/browser.js:151](src/harness/tools/browser.js)

```js
async function browserType(args)
```

### `browserEvaluate` — [src/harness/tools/browser.js:170](src/harness/tools/browser.js)

```js
async function browserEvaluate(args, config)
```

### `browserGetText` — [src/harness/tools/browser.js:187](src/harness/tools/browser.js)

```js
async function browserGetText(args)
```

### `browserWait` — [src/harness/tools/browser.js:206](src/harness/tools/browser.js)

```js
async function browserWait(args)
```

### `browserGetContent` — [src/harness/tools/browser.js:228](src/harness/tools/browser.js)

```js
async function browserGetContent(args)
```

> Retourne une vue structurée de la page : texte tronqué + liens + boutons + champs. Conçu pour la navigation autonome : le LLM voit ce avec quoi il peut interagir.

### `browserGetDom` — [src/harness/tools/browser.js:289](src/harness/tools/browser.js)

```js
async function browserGetDom(args)
```

### `browserSelect` — [src/harness/tools/browser.js:309](src/harness/tools/browser.js)

```js
async function browserSelect(args)
```

### `browserCheck` — [src/harness/tools/browser.js:325](src/harness/tools/browser.js)

```js
async function browserCheck(args)
```

### `browserKey` — [src/harness/tools/browser.js:341](src/harness/tools/browser.js)

```js
async function browserKey(args)
```

### `browserNewTab` — [src/harness/tools/browser.js:360](src/harness/tools/browser.js)

```js
async function browserNewTab(args)
```

### `browserListTabs` — [src/harness/tools/browser.js:378](src/harness/tools/browser.js)

```js
async function browserListTabs()
```

### `browserSwitchTab` — [src/harness/tools/browser.js:397](src/harness/tools/browser.js)

```js
async function browserSwitchTab(args)
```

### `browserScroll` — [src/harness/tools/browser.js:416](src/harness/tools/browser.js)

```js
async function browserScroll(args)
```

### `browserClose` — [src/harness/tools/browser.js:439](src/harness/tools/browser.js)

```js
async function browserClose()
```

### `disposeBrowser` — [src/harness/tools/browser.js:451](src/harness/tools/browser.js)

```js
async function disposeBrowser()
```

---

## src/harness/tools/depgraph-tool.js

### `findDependents` — [src/harness/tools/depgraph-tool.js:54](src/harness/tools/depgraph-tool.js)

```js
function findDependents({ path: relPath, depth = 1 }, guard, projectRoot)
```

> find_dependents : quels fichiers importent `path` ?

### `findDependencies` — [src/harness/tools/depgraph-tool.js:86](src/harness/tools/depgraph-tool.js)

```js
function findDependencies({ path: relPath, depth = 1 }, guard, projectRoot)
```

> find_dependencies : quels fichiers `path` importe-t-il ?

---

## src/harness/tools/deploy.js

### `deployProject` — [src/harness/tools/deploy.js:134](src/harness/tools/deploy.js)

```js
async function deployProject(args = {}, projectRoot = '', config = {})
```

> Déploie l'application du projet.

- @param {{ platform?, command?, build_first?, timeout? }} args
- @param {string} projectRoot
- @param {object} config

---

## src/harness/tools/design.js

### `generatePalette` — [src/harness/tools/design.js:103](src/harness/tools/design.js)

```js
function generatePalette(args)
```

> Génère une palette WCAG 2.1 à partir d'une couleur de base hexadécimale.

- @param {{ base_color: string }} args

### `readDesignTokens` — [src/harness/tools/design.js:212](src/harness/tools/design.js)

```js
function readDesignTokens(args, guard, projectRoot)
```

> Extrait les design tokens (CSS custom props, variables SCSS, couleurs JS/TS de thème) d'un fichier ou de tout le projet.

- @param {{ path?: string }} args
- @param {Function} guard    safe(relPath) → absPath
- @param {string}   projectRoot

---

## src/harness/tools/diff-file.js

### `diffFile` — [src/harness/tools/diff-file.js:51](src/harness/tools/diff-file.js)

```js
function diffFile({ path: relPath, backup_index = 0 } = {}, guard)
```

---

## src/harness/tools/families.js

### `familiesIn` — [src/harness/tools/families.js:97](src/harness/tools/families.js)

```js
function familiesIn(toolNames)
```

> Familles effectivement disponibles pour le jeu d'outils autorisé.

- @param {string[]} toolNames

### `selectToolsForTask` — [src/harness/tools/families.js:116](src/harness/tools/families.js)

```js
function selectToolsForTask(toolNames, task, config = {})
```

> Sélectionne les outils à exposer dans le prompt pour une tâche donnée. Conserve l'ordre du catalogue original (lisibilité du prompt).

- @param {string[]} toolNames  outils autorisés par la configuration
- @param {string}   task       texte de la tâche
- @param {{ enableLsp?: boolean }} [config]

### `describeFamilies` — [src/harness/tools/families.js:160](src/harness/tools/families.js)

```js
function describeFamilies(toolNames)
```

> Résumé lisible des familles disponibles, pour guider un modèle qui a inventé un outil.

- @param {string[]} toolNames

---

## src/harness/tools/find-relevant.js

### `findRelevantFiles` — [src/harness/tools/find-relevant.js:40](src/harness/tools/find-relevant.js)

```js
async function findRelevantFiles({ task, top_k }, projectRoot)
```

> Trouve les fichiers les plus pertinents pour une tâche.

- @param {{ task: string, top_k?: number }} args
- @param {string} projectRoot

---

## src/harness/tools/fix-loop.js

### `_extractAllToolCalls` — [src/harness/tools/fix-loop.js:38](src/harness/tools/fix-loop.js)

```js
function _extractAllToolCalls(text)
```

> Extrait tous les appels d'outils JSON d'une réponse LLM. Parcourt le texte et isole chaque objet JSON { "tool": ..., "args": ... }.

- @param {string} text

### `_summarizeFailures` — [src/harness/tools/fix-loop.js:74](src/harness/tools/fix-loop.js)

```js
function _summarizeFailures(output)
```

> Résume la sortie de tests pour le LLM : garde les lignes d'échec uniquement. Évite d'envoyer des milliers de lignes de tests qui passent.

- @param {string} output

### `fixLoop` — [src/harness/tools/fix-loop.js:92](src/harness/tools/fix-loop.js)

```js
async function fixLoop(args, guard, projectRoot, config)
```

> Boucle autonome test → analyse → fix.

- @param {{ command?: string, max_iterations?: number }} args
- @param {Function} guard
- @param {string}   projectRoot
- @param {object}   config

---

## src/harness/tools/formatter.js

### `_detectFormatter` — [src/harness/tools/formatter.js:17](src/harness/tools/formatter.js)

```js
function _detectFormatter(relPath, projectRoot)
```

> Détecte quel formateur est disponible pour un fichier donné. Retourne { cmd, formatter } ou null.

### `formatFile` — [src/harness/tools/formatter.js:57](src/harness/tools/formatter.js)

```js
async function formatFile({ path: relPath }, guard, projectRoot)
```

> Formate un fichier avec prettier ou eslint --fix.

- @param {{ path: string }} args
- @param {Function} guard
- @param {string} projectRoot

---

## src/harness/tools/fs.js

### `readFile` — [src/harness/tools/fs.js:68](src/harness/tools/fs.js)

```js
function readFile({ path: relPath, start_line, end_line }, guard, projectRoot = '')
```

> Lit un fichier texte. Supporte une plage de lignes optionnelle (1-indexé, inclusif). Bloque si le chemin est dans .harnessignore du projet.

- @param {{ path: string, start_line?: number, end_line?: number }} args
- @param {Function} guard
- @param {string}   projectRoot - Optionnel, pour appliquer .harnessignore

### `writeFile` — [src/harness/tools/fs.js:104](src/harness/tools/fs.js)

```js
async function writeFile({ path: relPath, content }, guard, config = {}, onEvent = () => {})
```

> Écrit/crée un fichier (crée les dossiers parents si besoin). Si config.requestApproval est fourni, attend l'accord de l'utilisateur.

- @param {{ path: string, content: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `replaceCode` — [src/harness/tools/fs.js:141](src/harness/tools/fs.js)

```js
async function replaceCode({ path: relPath, old_string, new_string }, guard, config = {}, onEvent = () => {})
```

> Remplace une chaîne dans un fichier. Essaie d'abord la correspondance exacte (CRLF normalisé), puis un fallback fuzzy (espaces de fin de ligne strippés). Si config.requestApproval est fourni, attend l'accord de l'utilisateur.

- @param {{ path: string, old_string: string, new_string: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `listDir` — [src/harness/tools/fs.js:223](src/harness/tools/fs.js)

```js
function listDir({ path: relPath = '.', recursive = false, depth = 3 }, guard, projectRoot = '')
```

> Liste les entrées d'un dossier. Supporte le mode récursif (depth ≤ 5, défaut 1). Les entrées correspondant à .harnessignore sont masquées.

- @param {{ path: string, recursive?: boolean, depth?: number }} args
- @param {Function} guard
- @param {string}   projectRoot

### `deleteFile` — [src/harness/tools/fs.js:281](src/harness/tools/fs.js)

```js
async function deleteFile({ path: relPath }, guard, config = {}, onEvent = () => {})
```

> Supprime un fichier du projet après backup et approbation optionnelle.

- @param {{ path: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `moveFile` — [src/harness/tools/fs.js:326](src/harness/tools/fs.js)

```js
async function moveFile({ path: relSrc, dest: relDest }, guard, config = {}, onEvent = () => {})
```

> Déplace (renomme) un fichier dans le projet. Source et destination doivent être dans le projectRoot (vérifié par guard). Backup de la source avant déplacement, approbation optionnelle.

- @param {{ path: string, dest: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

---

## src/harness/tools/git.js

### `gitStatus` — [src/harness/tools/git.js:29](src/harness/tools/git.js)

```js
async function gitStatus(args, guard, projectRoot)
```

> git_status — retourne les fichiers modifiés/ajoutés/supprimés. Lecture seule. Jamais de modification du repo.

### `gitDiff` — [src/harness/tools/git.js:48](src/harness/tools/git.js)

```js
async function gitDiff(args, guard, projectRoot)
```

> git_diff — diff d'un fichier ou du repo entier. Lecture seule. Limité à 4000 caractères.

### `gitCreateBranch` — [src/harness/tools/git.js:73](src/harness/tools/git.js)

```js
async function gitCreateBranch({ name, from }, guard, projectRoot, config = {})
```

> git_create_branch — crée et bascule sur une nouvelle branche. Requiert enableGitWrite dans la config.

- @param {{ name: string, from?: string }} args
- @param {Function} guard
- @param {string} projectRoot
- @param {object} config

### `gitCommit` — [src/harness/tools/git.js:97](src/harness/tools/git.js)

```js
async function gitCommit({ message, paths }, guard, projectRoot, config = {})
```

> git_commit — stage les fichiers listés (ou tout le projet) et crée un commit. Requiert enableGitWrite dans la config.

- @param {{ message: string, paths?: string[] }} args
- @param {Function} guard
- @param {string} projectRoot
- @param {object} config

---

## src/harness/tools/goal.js

### `goalTool` — [src/harness/tools/goal.js:223](src/harness/tools/goal.js)

```js
async function goalTool(args = {}, config = {}, projectRoot = '', onEvent = () => {})
```

- @param {object} args
- @param {object} config
- @param {string} projectRoot
- @param {Function} onEvent

---

## src/harness/tools/grep.js

### `searchGrep` — [src/harness/tools/grep.js:27](src/harness/tools/grep.js)

```js
async function searchGrep(args, guard, projectRoot = '')
```

> Recherche un pattern (string ou regex) dans les fichiers du projet.

- @param {{ pattern: string, path?: string, ext?: string }} args
- @param {Function} guard - path-guard
- @param {string}   projectRoot - Optionnel, pour appliquer .harnessignore

---

## src/harness/tools/http-request.js

### `httpRequest` — [src/harness/tools/http-request.js:42](src/harness/tools/http-request.js)

```js
async function httpRequest(args = {})
```

> Effectue une requête HTTP/HTTPS vers n'importe quelle URL (y compris localhost).

- @param {{ url, method?, headers?, body?, timeout?, max_response_chars? }} args

### `checkService` — [src/harness/tools/http-request.js:147](src/harness/tools/http-request.js)

```js
async function checkService(args = {})
```

> Vérifie si une URL ou un port TCP est accessible.

- @param {{ url?, port?, host?, timeout? }} args

---

## src/harness/tools/image.js

### `generateImage` — [src/harness/tools/image.js:9](src/harness/tools/image.js)

```js
async function generateImage(args, guard, projectRoot, config)
```

---

## src/harness/tools/index.js

### `dispatch` — [src/harness/tools/index.js:58](src/harness/tools/index.js)

```js
async function dispatch(toolName, args, guard, config = {}, onEvent = () => {}, projectRoot = '', mcpRegistry = null)
```

---

## src/harness/tools/lsp.js

### `_pathToUri` — [src/harness/tools/lsp.js:52](src/harness/tools/lsp.js)

```js
function _pathToUri(absPath)
```

### `_uriToPath` — [src/harness/tools/lsp.js:59](src/harness/tools/lsp.js)

```js
function _uriToPath(uri)
```

### `lspHover` — [src/harness/tools/lsp.js:334](src/harness/tools/lsp.js)

```js
async function lspHover(args, guard, projectRoot, config)
```

### `lspDefinition` — [src/harness/tools/lsp.js:361](src/harness/tools/lsp.js)

```js
async function lspDefinition(args, guard, projectRoot, config)
```

### `lspReferences` — [src/harness/tools/lsp.js:387](src/harness/tools/lsp.js)

```js
async function lspReferences(args, guard, projectRoot, config)
```

### `disposeLsp` — [src/harness/tools/lsp.js:409](src/harness/tools/lsp.js)

```js
async function disposeLsp()
```

---

## src/harness/tools/merge-videos.js

### `mergeVideos` — [src/harness/tools/merge-videos.js:12](src/harness/tools/merge-videos.js)

```js
async function mergeVideos(args, guard, projectRoot)
```

> Fusionne plusieurs clips vidéo en un seul fichier via ffmpeg. ffmpeg doit être installé et accessible dans le PATH système. Installation Windows : winget install ffmpeg

---

## src/harness/tools/message-bus.js

### `createSharedBus` — [src/harness/tools/message-bus.js:8](src/harness/tools/message-bus.js)

```js
function createSharedBus()
```

> Crée un bus de messages isolé pour une session multi-agents.

### `enableCollaboration` — [src/harness/tools/message-bus.js:27](src/harness/tools/message-bus.js)

```js
function enableCollaboration(_args, config, onEvent)
```

### `postMessage` — [src/harness/tools/message-bus.js:41](src/harness/tools/message-bus.js)

```js
function postMessage({ to, content }, config, onEvent)
```

### `readMessages` — [src/harness/tools/message-bus.js:55](src/harness/tools/message-bus.js)

```js
function readMessages({ from: filterFrom } = {}, config)
```

---

## src/harness/tools/notify.js

### `notifyUser` — [src/harness/tools/notify.js:9](src/harness/tools/notify.js)

```js
async function notifyUser(args, config)
```

> Outil notify_user — déclenche une notification système via le callback `config.notifyFn` injecté par le processus principal (ipc.js). En mode interactif, notifyFn est absent → la notification est un no-op silencieux (l'agent peut l'appeler sans erreur dans tous les modes).

---

## src/harness/tools/orchestrate.js

### `orchestrate` — [src/harness/tools/orchestrate.js:130](src/harness/tools/orchestrate.js)

```js
async function orchestrate({ objective, phases } = {}, config, onEvent, projectRoot)
```

- @param {{ objective: string, phases: Array<{mode?: 'sequential'|'parallel', agents: Array<{role: string, task: string}>}> }} args
- @param {object}   config
- @param {Function} onEvent
- @param {string}   projectRoot

---

## src/harness/tools/process-runner.js

### `addListener` — [src/harness/tools/process-runner.js:35](src/harness/tools/process-runner.js)

```js
function addListener(fn)    { _listeners.add(fn); }
```

### `removeListener` — [src/harness/tools/process-runner.js:36](src/harness/tools/process-runner.js)

```js
function removeListener(fn) { _listeners.delete(fn); }
```

### `startProcess` — [src/harness/tools/process-runner.js:58](src/harness/tools/process-runner.js)

```js
function startProcess(args = {}, projectRoot = '', config = {})
```

> Démarre un processus en arrière-plan.

- @param {{ command, name?, cwd?, env? }} args
- @param {string} projectRoot
- @param {object} config

### `stopProcess` — [src/harness/tools/process-runner.js:141](src/harness/tools/process-runner.js)

```js
function stopProcess(args = {})
```

> Arrête un processus par nom.

- @param {{ name, force? }} args

### `getOutput` — [src/harness/tools/process-runner.js:176](src/harness/tools/process-runner.js)

```js
function getOutput(args = {})
```

> Retourne les dernières lignes de sortie.

- @param {{ name, lines? }} args

### `listProcesses` — [src/harness/tools/process-runner.js:200](src/harness/tools/process-runner.js)

```js
function listProcesses()
```

> Liste tous les processus gérés.

### `listAll` — [src/harness/tools/process-runner.js:207](src/harness/tools/process-runner.js)

```js
function listAll()
```

---

## src/harness/tools/project-info.js

### `getProjectInfo` — [src/harness/tools/project-info.js:17](src/harness/tools/project-info.js)

```js
function getProjectInfo(_args, projectRoot)
```

- @param {object} _args  - ignoré (aucun paramètre requis)
- @param {string} projectRoot

---

## src/harness/tools/project-notes-tool.js

### `projectNote` — [src/harness/tools/project-notes-tool.js:16](src/harness/tools/project-notes-tool.js)

```js
function projectNote({ action, key, value, tags, task } = {}, _guard, projectRoot)
```

> Outil LLM : mémoire persistante inter-sessions du projet (ADR-026). Actions : set | get | list | delete | search La note est persistée dans .harness/project-notes.json et disponible à la prochaine session. Différent de scratchpad (in-memory, disparaît à la fin).

- @param {{ action, key?, value?, tags?, task? }} args
- @param {Function} _guard   non utilisé (pas d'accès FS direct via path-guard)
- @param {string}   projectRoot

---

## src/harness/tools/read-url.js

### `readUrl` — [src/harness/tools/read-url.js:102](src/harness/tools/read-url.js)

```js
async function readUrl({ url: rawUrl, max_chars } = {})
```

---

## src/harness/tools/restore.js

### `restoreFile` — [src/harness/tools/restore.js:21](src/harness/tools/restore.js)

```js
function restoreFile({ path: relPath, list = false, backup_index = 0 }, guard)
```

> Liste ou restaure un fichier depuis ses backups.   path         : chemin relatif du fichier à restaurer   list         : si true, retourne la liste des backups disponibles sans restaurer   backup_index : index du backup à restaurer (0 = le plus récent, défaut 0)

- @param {{ path: string, list?: boolean, backup_index?: number }} args
- @param {Function} guard

---

## src/harness/tools/rules.js

### `addRule` — [src/harness/tools/rules.js:7](src/harness/tools/rules.js)

```js
async function addRule(args, config)
```

> Ajoute une règle personnalisée dans la config de l'agent. La règle sera injectée dans chaque prompt système dès la prochaine tâche.

### `deleteRule` — [src/harness/tools/rules.js:29](src/harness/tools/rules.js)

```js
async function deleteRule(args, config)
```

> Supprime une règle personnalisée (par son texte exact ou son id).

### `installSkill` — [src/harness/tools/rules.js:51](src/harness/tools/rules.js)

```js
async function installSkill(args, config)
```

> Installe un skill (module de comportement nommé). Un skill a un nom, une description, et un systemPrompt injecté dans chaque session.

### `removeSkill` — [src/harness/tools/rules.js:74](src/harness/tools/rules.js)

```js
async function removeSkill(args, config)
```

> Désinstalle un skill (par son nom ou son id).

---

## src/harness/tools/run-command.js

### `runCommand` — [src/harness/tools/run-command.js:27](src/harness/tools/run-command.js)

```js
function runCommand(command, { cwd, timeout, signal })
```

>   Ne rejette jamais : un échec de commande est un résultat comme un autre.

- @param {string} command
- @param {{ cwd: string, timeout: number, signal?: AbortSignal }} opts

---

## src/harness/tools/scratchpad-tool.js

### `useScratchpad` — [src/harness/tools/scratchpad-tool.js:6](src/harness/tools/scratchpad-tool.js)

```js
function useScratchpad({ action, key, value } = {}, scratchpad)
```

> Outil scratchpad — permet au LLM de prendre des notes intra-session. Le scratchpad est injecté via config._scratchpad depuis agent.js.

---

## src/harness/tools/shell.js

### `runShell` — [src/harness/tools/shell.js:31](src/harness/tools/shell.js)

```js
async function runShell(args, projectRoot, config)
```

> Exécute une commande shell. N'est disponible que si enableShell === true dans la config.

- @param {{ command: string }} args
- @param {string} projectRoot - cwd d'exécution
- @param {object} config

---

## src/harness/tools/spawn.js

### `_buildSubContext` — [src/harness/tools/spawn.js:12](src/harness/tools/spawn.js)

```js
function _buildSubContext(role, task, config, onEvent)
```

> Construit le subConfig et le subOnEvent communs à spawnAgent et spawnParallel. Retourne aussi un collecteur modifiedFiles mis à jour par subOnEvent.

### `_subResult` — [src/harness/tools/spawn.js:50](src/harness/tools/spawn.js)

```js
function _subResult(role, result, modifiedFiles)
```

> Traduit le retour de runAgent pour le parent. Un échec reste un échec : présenté comme « terminé », il ferait construire la suite sur un travail qui n'a pas eu lieu. modifiedFiles reste renseigné, un sous-agent peut échouer après avoir écrit.

### `spawnAgent` — [src/harness/tools/spawn.js:61](src/harness/tools/spawn.js)

```js
async function spawnAgent({ role, task }, config, onEvent, projectRoot)
```

- @param {{ role: string, task: string }} args
- @param {object}   config
- @param {Function} onEvent
- @param {string}   projectRoot

### `spawnParallel` — [src/harness/tools/spawn.js:103](src/harness/tools/spawn.js)

```js
async function spawnParallel({ agents }, config, onEvent, projectRoot)
```

> Lance plusieurs sous-agents en parallèle (Promise.all). Tous partagent le même bus de messages — créé automatiquement si absent.

- @param {{ agents: Array<{role: string, task: string}> }} args

---

## src/harness/tools/speech.js

### `generateSpeech` — [src/harness/tools/speech.js:12](src/harness/tools/speech.js)

```js
async function generateSpeech(args, guard, projectRoot)
```

> Génère un fichier audio WAV depuis un texte via Windows SAPI (Text-To-Speech intégré). Fonctionne hors-ligne, gratuit, aucune dépendance npm. Voix disponibles selon la langue du système Windows (ex : Zira, David, Aria).

### `listSpeechVoices` — [src/harness/tools/speech.js:74](src/harness/tools/speech.js)

```js
async function listSpeechVoices()
```

> Liste les voix SAPI disponibles sur ce Windows. Retourne un tableau de noms utilisables dans args.voice.

---

## src/harness/tools/symbols-search.js

### `findSymbol` — [src/harness/tools/symbols-search.js:68](src/harness/tools/symbols-search.js)

```js
function findSymbol({ name, path: subPath = '.', exact = false }, guard, projectRoot = '')
```

> Recherche un symbole par nom dans le projet.   name  : nom recherché (partiel insensible à la casse par défaut)   path  : sous-dossier à inspecter (défaut '.')   exact : si true, correspondance exacte (sensible à la casse)

- @param {{ name: string, path?: string, exact?: boolean }} args
- @param {Function} guard
- @param {string}   projectRoot

---

## src/harness/tools/test-runner.js

### `_detectRunner` — [src/harness/tools/test-runner.js:19](src/harness/tools/test-runner.js)

```js
function _detectRunner(projectRoot)
```

> Détecte le runner de tests adapté au projet.

- @param {string} projectRoot

### `runTests` — [src/harness/tools/test-runner.js:65](src/harness/tools/test-runner.js)

```js
async function runTests(args, projectRoot, { signal } = {})
```

> Lance les tests du projet. Si args.command est fourni, l'utilise tel quel (parmi les commandes whitelistées).

- @param {{ command?: string }} args
- @param {string} projectRoot
- @param {{ signal?: AbortSignal }} [opts]

### `_keepEnds` — [src/harness/tools/test-runner.js:119](src/harness/tools/test-runner.js)

```js
function _keepEnds(text, max)
```

> Coupe au milieu : les runners listent les échecs et le bilan en fin de sortie.

- @param {string} text
- @param {number} max

---

## src/harness/tools/validate.js

### `validateArgs` — [src/harness/tools/validate.js:72](src/harness/tools/validate.js)

```js
function validateArgs(toolName, args)
```

> Vérifie les arguments obligatoires d'un outil. Les outils sans schéma passent sans contrôle (comportement inchangé).

- @param {string} toolName
- @param {object} args

---

## src/harness/tools/video.js

### `generateVideo` — [src/harness/tools/video.js:12](src/harness/tools/video.js)

```js
async function generateVideo(args, guard, projectRoot, config)
```

---

## src/harness/tools/web-search.js

### `webSearch` — [src/harness/tools/web-search.js:102](src/harness/tools/web-search.js)

```js
async function webSearch({ query, max_results } = {})
```

- @param {{ query: string, max_results?: number }} args

---

## src/harness/voice/summarize.js

### `condenseDictation` — [src/harness/voice/summarize.js:23](src/harness/voice/summarize.js)

```js
async function condenseDictation(raw, llmGenerate)
```

> Condense une dictée transcrite en une consigne claire via le LLM actif. Toujours un texte exploitable en sortie : si le LLM échoue ou répond vide, on retombe sur la transcription brute plutôt que de perdre la dictée.

- @param {string} raw — transcription brute
- @param {(messages: object[], options?: object) => Promise<string>} llmGenerate

---

## src/main/apps-manager.js

### `AppsManager` — [src/main/apps-manager.js:15](src/main/apps-manager.js)

```js
class AppsManager
```

---

## src/main/config.js

### `loadConfig` — [src/main/config.js:77](src/main/config.js)

```js
async function loadConfig()
```

### `saveConfig` — [src/main/config.js:93](src/main/config.js)

```js
async function saveConfig(config)
```

---

## src/main/ipc.js

### `registerIpcHandlers` — [src/main/ipc.js:73](src/main/ipc.js)

```js
function registerIpcHandlers({ visibleWin, hiddenWin, config })
```

> Enregistre tous les handlers IPC. Point d'entrée unique pour toute la communication inter-process.

---

## src/main/llm-bridge.js

### `createLlmBridge` — [src/main/llm-bridge.js:12](src/main/llm-bridge.js)

```js
function createLlmBridge(hiddenWin)
```

> Pont IPC entre le harness et le renderer caché WebLLM. Retourne une fonction llmGenerate injectable dans runAgent.

- @param {BrowserWindow} hiddenWin

---

## src/main/notifications.js

### `notifyTaskComplete` — [src/main/notifications.js:12](src/main/notifications.js)

```js
function notifyTaskComplete({ task, ok, stepCount }, win)
```

> Affiche une notification système Windows et fait clignoter le bouton barre des tâches quand une tâche agent se termine hors focus.

- @param {{ task: string, ok: boolean, stepCount?: number }} params
- @param {import('electron').BrowserWindow} win

### `notifyUser` — [src/main/notifications.js:53](src/main/notifications.js)

```js
function notifyUser(title, body, win)
```

> Notification déclenchée par l'outil notify_user du LLM. Titre et corps fournis par l'agent, pas de lien avec une tâche spécifique.

---

## src/main/safe-keys.js

### `encryptKey` — [src/main/safe-keys.js:20](src/main/safe-keys.js)

```js
function encryptKey(plaintext)
```

> Chiffre une clé API.

- @param {string} plaintext

### `decryptKey` — [src/main/safe-keys.js:52](src/main/safe-keys.js)

```js
function decryptKey(encrypted)
```

> Déchiffre une clé API.

- @param {string} encrypted  - base64

### `resolveApiKey` — [src/main/safe-keys.js:84](src/main/safe-keys.js)

```js
function resolveApiKey(engineCfg = {})
```

> Résout la clé API d'un moteur. Priorité : apiKey en clair (saisie utilisateur) > apiKeyEncrypted (stockage).

- @param {{ apiKey?: string, apiKeyEncrypted?: string }} engineCfg

### `prepareConfigForSave` — [src/main/safe-keys.js:96](src/main/safe-keys.js)

```js
function prepareConfigForSave(config)
```

> Prépare la config à sauvegarder : chiffre les clés en clair et vide apiKey. Modifie une copie de la config — n'altère PAS l'objet en mémoire.

- @param {object} config

### `resolveAllKeys` — [src/main/safe-keys.js:114](src/main/safe-keys.js)

```js
function resolveAllKeys(config)
```

> Résout toutes les clés API après chargement de la config. Renseigne apiKey en mémoire à partir de apiKeyEncrypted. Modifie l'objet config en place (en mémoire uniquement).

- @param {object} config

---

## src/main/shortcuts.js

### `isBlockedShortcut` — [src/main/shortcuts.js:27](src/main/shortcuts.js)

```js
function isBlockedShortcut(input, opts)
```

> Indique si une entrée clavier correspond à un raccourci navigateur à neutraliser.        objet `input` fourni par l'événement Electron `before-input-event`

- @param {{ type?: string, key?: string, control?: boolean, meta?: boolean, shift?: boolean, alt?: boolean }} input
- @param {{ allowDevTools?: boolean }} [opts] — `allowDevTools` laisse passer F12 / Ctrl+Shift+I (dev uniquement)

### `attachShortcutGuard` — [src/main/shortcuts.js:53](src/main/shortcuts.js)

```js
function attachShortcutGuard(win, opts)
```

> Branche le filtre sur une fenêtre : raccourcis bloqués, barre de menus masquée, zoom figé à 100 %. À appeler juste après la création de chaque BrowserWindow interne.

- @param {import('electron').BrowserWindow} win
- @param {{ allowDevTools?: boolean }} [opts]

---

## src/main/user-data.js

### `resolveUserDataDir` — [src/main/user-data.js:61](src/main/user-data.js)

```js
function resolveUserDataDir({ appData, projectRoot })
```

### `migrateLegacyConfig` — [src/main/user-data.js:88](src/main/user-data.js)

```js
function migrateLegacyConfig({ appData, userDataDir })
```

---

## src/main/voice.js

### `normalizeVoiceModel` — [src/main/voice.js:15](src/main/voice.js)

```js
function normalizeVoiceModel(model)
```

### `transcribeAudio` — [src/main/voice.js:50](src/main/voice.js)

```js
function transcribeAudio(audio, model)
```

> Envoie un enregistrement audio à la fenêtre cachée Whisper.

- @param {Buffer|Uint8Array|ArrayBuffer} audio — enregistrement encodé (webm/opus…)
- @param {string} [model] — 'base' | 'small'

### `preloadVoiceModel` — [src/main/voice.js:55](src/main/voice.js)

```js
async function preloadVoiceModel(model)
```

---

## src/main/windows.js

### `createWindows` — [src/main/windows.js:42](src/main/windows.js)

```js
function createWindows(_config)
```

> Crée la fenêtre visible (UI) et la fenêtre cachée (moteur LLM).

### `openSettingsWindow` — [src/main/windows.js:93](src/main/windows.js)

```js
function openSettingsWindow(parentWin)
```

> Ouvre (ou ramène au premier plan) la fenêtre Paramètres. Elle est créée lazily et détruite quand l'utilisateur la ferme.

- @param {BrowserWindow} parentWin — fenêtre principale (pour le centrage)

### `openDesignWindow` — [src/main/windows.js:151](src/main/windows.js)

```js
function openDesignWindow(parentWin)
```

> Ouvre (ou ramène au premier plan) la fenêtre Design Studio.

- @param {BrowserWindow} parentWin

### `getVoiceWindow` — [src/main/windows.js:203](src/main/windows.js)

```js
function getVoiceWindow()
```

> Fenêtre cachée de transcription vocale (Whisper), créée au premier usage seulement : un utilisateur qui n'active pas la dictée ne charge jamais ce renderer.

### `openDonationWindow` — [src/main/windows.js:228](src/main/windows.js)

```js
function openDonationWindow(parentWin, mainWin)
```

> Ouvre la fenêtre de don Chariow. Surveille les navigations pour détecter la confirmation de paiement, puis envoie DONATION_SUCCESS à la fenêtre principale.

- @param {BrowserWindow} parentWin
- @param {BrowserWindow} mainWin  — fenêtre principale (pour l'événement de succès)

---

## src/shared/approval.js

### `approvalRequired` — [src/shared/approval.js:18](src/shared/approval.js)

```js
function approvalRequired({ planMode = false, approvalMode, configApprovalMode } = {})
```

- @param {object} opts
- @param {boolean} [opts.planMode]            - true = mode Plan, false/absent = mode Action
- @param {boolean} [opts.approvalMode]        - choix utilisateur (toggle rapide), prioritaire
- @param {boolean} [opts.configApprovalMode]  - valeur persistée en config, repli

---

## src/shared/data-dir.js

### `getDataDir` — [src/shared/data-dir.js:21](src/shared/data-dir.js)

```js
function getDataDir()
```

> Résout le dossier de données à chaque appel (jamais mis en cache) : les tests et le CLI peuvent changer `APPDATA` / `HARNESS_DATA_DIR` après le require.

---

