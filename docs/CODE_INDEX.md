# CODE_INDEX — Fonctions publiques exportées

> Généré le 2026-10-20 par `npm run index`.
> **110 symboles** dans **54 modules**.
> Ne pas modifier manuellement — régénérer avec `npm run index`.

---

## Table des matières

- [src/cli/config-loader.js](#src-cli-config-loader-js) (2)
- [src/cli/output.js](#src-cli-output-js) (8)
- [src/harness/agent.js](#src-harness-agent-js) (1)
- [src/harness/context/builder.js](#src-harness-context-builder-js) (1)
- [src/harness/context/symbols.js](#src-harness-context-symbols-js) (2)
- [src/harness/context/tree.js](#src-harness-context-tree-js) (1)
- [src/harness/context/trimmer.js](#src-harness-context-trimmer-js) (1)
- [src/harness/llm/base.js](#src-harness-llm-base-js) (1)
- [src/harness/llm/list-models.js](#src-harness-llm-list-models-js) (1)
- [src/harness/llm/router.js](#src-harness-llm-router-js) (1)
- [src/harness/mcp/registry.js](#src-harness-mcp-registry-js) (1)
- [src/harness/memory/scratchpad.js](#src-harness-memory-scratchpad-js) (1)
- [src/harness/memory/sessions.js](#src-harness-memory-sessions-js) (5)
- [src/harness/parser.js](#src-harness-parser-js) (1)
- [src/harness/prompts/by-language.js](#src-harness-prompts-by-language-js) (2)
- [src/harness/prompts/system.js](#src-harness-prompts-system-js) (1)
- [src/harness/rag/embedder.js](#src-harness-rag-embedder-js) (3)
- [src/harness/rag/indexer.js](#src-harness-rag-indexer-js) (2)
- [src/harness/rag/retrieve.js](#src-harness-rag-retrieve-js) (1)
- [src/harness/rag/store.js](#src-harness-rag-store-js) (1)
- [src/harness/safety/backup.js](#src-harness-safety-backup-js) (1)
- [src/harness/safety/diff.js](#src-harness-safety-diff-js) (3)
- [src/harness/safety/harnessignore.js](#src-harness-safety-harnessignore-js) (2)
- [src/harness/safety/path-guard.js](#src-harness-safety-path-guard-js) (1)
- [src/harness/tools/api.js](#src-harness-tools-api-js) (1)
- [src/harness/tools/ask.js](#src-harness-tools-ask-js) (1)
- [src/harness/tools/batch-replace.js](#src-harness-tools-batch-replace-js) (1)
- [src/harness/tools/browser.js](#src-harness-tools-browser-js) (11)
- [src/harness/tools/deploy.js](#src-harness-tools-deploy-js) (1)
- [src/harness/tools/diff-file.js](#src-harness-tools-diff-file-js) (1)
- [src/harness/tools/fs.js](#src-harness-tools-fs-js) (6)
- [src/harness/tools/git.js](#src-harness-tools-git-js) (2)
- [src/harness/tools/grep.js](#src-harness-tools-grep-js) (1)
- [src/harness/tools/http-request.js](#src-harness-tools-http-request-js) (2)
- [src/harness/tools/index.js](#src-harness-tools-index-js) (1)
- [src/harness/tools/message-bus.js](#src-harness-tools-message-bus-js) (4)
- [src/harness/tools/process-runner.js](#src-harness-tools-process-runner-js) (7)
- [src/harness/tools/project-info.js](#src-harness-tools-project-info-js) (1)
- [src/harness/tools/read-url.js](#src-harness-tools-read-url-js) (1)
- [src/harness/tools/restore.js](#src-harness-tools-restore-js) (1)
- [src/harness/tools/rules.js](#src-harness-tools-rules-js) (4)
- [src/harness/tools/scratchpad-tool.js](#src-harness-tools-scratchpad-tool-js) (1)
- [src/harness/tools/shell.js](#src-harness-tools-shell-js) (1)
- [src/harness/tools/spawn.js](#src-harness-tools-spawn-js) (1)
- [src/harness/tools/symbols-search.js](#src-harness-tools-symbols-search-js) (1)
- [src/harness/tools/test-runner.js](#src-harness-tools-test-runner-js) (2)
- [src/main/apps-manager.js](#src-main-apps-manager-js) (1)
- [src/main/config.js](#src-main-config-js) (2)
- [src/main/ipc.js](#src-main-ipc-js) (1)
- [src/main/llm-bridge.js](#src-main-llm-bridge-js) (1)
- [src/main/notifications.js](#src-main-notifications-js) (1)
- [src/main/safe-keys.js](#src-main-safe-keys-js) (5)
- [src/main/windows.js](#src-main-windows-js) (2)
- [src/shared/approval.js](#src-shared-approval-js) (1)

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

### `runAgent` — [src/harness/agent.js:83](src/harness/agent.js)

```js
async function runAgent({ task, llmGenerate, projectRoot, config = {}, onEvent = () => {}, signal = null })
```

---

## src/harness/context/builder.js

### `buildContext` — [src/harness/context/builder.js:25](src/harness/context/builder.js)

```js
async function buildContext({ task, projectRoot, ragStore, targetFile, maxChars = DEFAULT_BUDGET })
```

> Construit le contexte à injecter dans le prompt.   task:        string,   projectRoot: string,   ragStore?:   object,       // rag/store instance (optionnel en MVP)   targetFile?: string,       // chemin relatif du fichier principal de la tâche   maxChars?:   number, }} opts

- @param {{

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

### `trimToBudget` — [src/harness/context/trimmer.js:18](src/harness/context/trimmer.js)

```js
function trimToBudget(parts, maxChars = 12000)
```

- @param {{ type: string, content: string }[]} parts  - Sections à assembler
- @param {number} maxChars                             - Budget total

---

## src/harness/llm/base.js

### `LlmEngine` — [src/harness/llm/base.js:5](src/harness/llm/base.js)

```js
class LlmEngine
```

> Interface commune à tous les moteurs LLM. Chaque moteur doit étendre cette classe.

---

## src/harness/llm/list-models.js

### `listModels` — [src/harness/llm/list-models.js:10](src/harness/llm/list-models.js)

```js
async function listModels({ engine, apiKey, baseUrl })
```

- @param {{ engine: string, apiKey: string, baseUrl?: string }} opts

---

## src/harness/llm/router.js

### `LlmRouter` — [src/harness/llm/router.js:13](src/harness/llm/router.js)

```js
class LlmRouter
```

> Router LLM — chaîne de fallback entre moteurs. Stratégie : essaie le primaire, puis les fallbacks dans l'ordre. Chaque moteur passe d'abord par isReady() avant generate(). Si tous échouent, retourne la dernière erreur.   const router = new LlmRouter(['openai-compat', 'gemini', 'claude'], registry, config);   const text = await router.generate(messages);

---

## src/harness/mcp/registry.js

### `McpRegistry` — [src/harness/mcp/registry.js:13](src/harness/mcp/registry.js)

```js
class McpRegistry
```

---

## src/harness/memory/scratchpad.js

### `createScratchpad` — [src/harness/memory/scratchpad.js:17](src/harness/memory/scratchpad.js)

```js
function createScratchpad()
```

> Crée un scratchpad en mémoire.

---

## src/harness/memory/sessions.js

### `createSession` — [src/harness/memory/sessions.js:26](src/harness/memory/sessions.js)

```js
function createSession({ task, projectRoot })
```

> Crée une nouvelle session et la persiste sur disque.

- @param {{ task: string, projectRoot: string }} opts

### `updateSession` — [src/harness/memory/sessions.js:44](src/harness/memory/sessions.js)

```js
function updateSession(sessionPath, updates)
```

> Met à jour une session existante (steps, result, scratchpad).

- @param {string} sessionPath
- @param {Partial<object>} updates

### `loadSession` — [src/harness/memory/sessions.js:60](src/harness/memory/sessions.js)

```js
function loadSession(id)
```

> Charge une session depuis son id.

- @param {string} id

### `listSessions` — [src/harness/memory/sessions.js:69](src/harness/memory/sessions.js)

```js
function listSessions()
```

> Liste toutes les sessions, triées par date décroissante.

### `applyRetention` — [src/harness/memory/sessions.js:91](src/harness/memory/sessions.js)

```js
function applyRetention(maxSessions = 100)
```

> Supprime les sessions excédentaires (les plus anciennes).

- @param {number} maxSessions

---

## src/harness/parser.js

### `extractToolCall` — [src/harness/parser.js:8](src/harness/parser.js)

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

## src/harness/prompts/system.js

### `buildSystemPrompt` — [src/harness/prompts/system.js:15](src/harness/prompts/system.js)

```js
function buildSystemPrompt(availableTools, projectContext = '', opts = {})
```

- @param {string[]} availableTools
- @param {string}   [projectContext]
- @param {{ systemExtra?: string, skipPlanRule?: boolean, busActive?: boolean, lang?: string, langRules?: string }} [opts]

---

## src/harness/rag/embedder.js

### `tokenize` — [src/harness/rag/embedder.js:22](src/harness/rag/embedder.js)

```js
function tokenize(text)
```

> Tokenise un texte en mots significatifs.

- @param {string} text

### `encode` — [src/harness/rag/embedder.js:56](src/harness/rag/embedder.js)

```js
function encode(text)
```

> Encode un texte en vecteur dense (bag-of-words TF normalisé).

- @param {string} text

### `resetVocab` — [src/harness/rag/embedder.js:82](src/harness/rag/embedder.js)

```js
function resetVocab()
```

> Réinitialise le vocabulaire global (utile entre deux indexations).

---

## src/harness/rag/indexer.js

### `chunkFile` — [src/harness/rag/indexer.js:34](src/harness/rag/indexer.js)

```js
function chunkFile(filePath, content, hash)
```

> Découpe un fichier en chunks avec overlap.

- @param {string} filePath  - Chemin relatif (pour les ids)
- @param {string} content
- @param {string} hash

### `indexProject` — [src/harness/rag/indexer.js:65](src/harness/rag/indexer.js)

```js
function indexProject(root, store, { onProgress } = {})
```

> Parcourt récursivement un dossier et indexe tous les fichiers source.

- @param {string}   root    - Chemin absolu de la racine du projet
- @param {object}   store   - Instance createStore()
- @param {{ onProgress?: (file: string) => void }} opts

---

## src/harness/rag/retrieve.js

### `retrieveRelevant` — [src/harness/rag/retrieve.js:13](src/harness/rag/retrieve.js)

```js
async function retrieveRelevant(store, task, { topK = 5 } = {})
```

- @param {object}   store   - Instance createStore()
- @param {string}   task    - La tâche (requête)
- @param {{ topK?: number }} opts

---

## src/harness/rag/store.js

### `createStore` — [src/harness/rag/store.js:20](src/harness/rag/store.js)

```js
function createStore(storeId)
```

> Crée un store JSON simple.

- @param {string} storeId  - Identifiant unique (ex: hash du projectRoot)

---

## src/harness/safety/backup.js

### `snapshot` — [src/harness/safety/backup.js:21](src/harness/safety/backup.js)

```js
function snapshot(absPath, maxBackups = 50)
```

> Copie un fichier dans le dossier de backup avant modification. Ne fait rien si le fichier n'existe pas encore. Applique une rétention : garde au plus maxBackups snapshots (les plus récents).

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

### `makeGuard` — [src/harness/safety/path-guard.js:12](src/harness/safety/path-guard.js)

```js
function makeGuard(projectRoot)
```

> Crée un garde-fou FS pour un projectRoot donné. La fonction retournée résout un chemin relatif en absolu et lève une erreur si le chemin sort du projet ou est un symlink sortant.

- @param {string} projectRoot - Chemin absolu du dossier projet

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

### `_setPuppeteerMock` — [src/harness/tools/browser.js:17](src/harness/tools/browser.js)

```js
function _setPuppeteerMock(mock) { _puppeteerOverride = mock; _puppeteer = null; }
```

### `browserOpen` — [src/harness/tools/browser.js:49](src/harness/tools/browser.js)

```js
async function browserOpen(args)
```

### `browserNavigate` — [src/harness/tools/browser.js:90](src/harness/tools/browser.js)

```js
async function browserNavigate(args)
```

### `browserScreenshot` — [src/harness/tools/browser.js:103](src/harness/tools/browser.js)

```js
async function browserScreenshot(args, guard, projectRoot)
```

### `browserClick` — [src/harness/tools/browser.js:129](src/harness/tools/browser.js)

```js
async function browserClick(args)
```

### `browserType` — [src/harness/tools/browser.js:148](src/harness/tools/browser.js)

```js
async function browserType(args)
```

### `browserEvaluate` — [src/harness/tools/browser.js:167](src/harness/tools/browser.js)

```js
async function browserEvaluate(args, config)
```

### `browserGetText` — [src/harness/tools/browser.js:184](src/harness/tools/browser.js)

```js
async function browserGetText(args)
```

### `browserWait` — [src/harness/tools/browser.js:203](src/harness/tools/browser.js)

```js
async function browserWait(args)
```

### `browserClose` — [src/harness/tools/browser.js:221](src/harness/tools/browser.js)

```js
async function browserClose()
```

### `disposeBrowser` — [src/harness/tools/browser.js:233](src/harness/tools/browser.js)

```js
async function disposeBrowser()
```

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

## src/harness/tools/diff-file.js

### `diffFile` — [src/harness/tools/diff-file.js:55](src/harness/tools/diff-file.js)

```js
function diffFile({ path: relPath, backup_index = 0 } = {}, guard)
```

---

## src/harness/tools/fs.js

### `readFile` — [src/harness/tools/fs.js:34](src/harness/tools/fs.js)

```js
function readFile({ path: relPath, start_line, end_line }, guard, projectRoot = '')
```

> Lit un fichier texte. Supporte une plage de lignes optionnelle (1-indexé, inclusif). Bloque si le chemin est dans .harnessignore du projet.

- @param {{ path: string, start_line?: number, end_line?: number }} args
- @param {Function} guard
- @param {string}   projectRoot - Optionnel, pour appliquer .harnessignore

### `writeFile` — [src/harness/tools/fs.js:70](src/harness/tools/fs.js)

```js
async function writeFile({ path: relPath, content }, guard, config = {}, onEvent = () => {})
```

> Écrit/crée un fichier (crée les dossiers parents si besoin). Si config.requestApproval est fourni, attend l'accord de l'utilisateur.

- @param {{ path: string, content: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `replaceCode` — [src/harness/tools/fs.js:103](src/harness/tools/fs.js)

```js
async function replaceCode({ path: relPath, old_string, new_string }, guard, config = {}, onEvent = () => {})
```

> Remplace une chaîne dans un fichier. Essaie d'abord la correspondance exacte (CRLF normalisé), puis un fallback fuzzy (espaces de fin de ligne strippés). Si config.requestApproval est fourni, attend l'accord de l'utilisateur.

- @param {{ path: string, old_string: string, new_string: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `listDir` — [src/harness/tools/fs.js:182](src/harness/tools/fs.js)

```js
function listDir({ path: relPath = '.', recursive = false, depth = 3 }, guard, projectRoot = '')
```

> Liste les entrées d'un dossier. Supporte le mode récursif (depth ≤ 5, défaut 1). Les entrées correspondant à .harnessignore sont masquées.

- @param {{ path: string, recursive?: boolean, depth?: number }} args
- @param {Function} guard
- @param {string}   projectRoot

### `deleteFile` — [src/harness/tools/fs.js:240](src/harness/tools/fs.js)

```js
async function deleteFile({ path: relPath }, guard, config = {}, onEvent = () => {})
```

> Supprime un fichier du projet après backup et approbation optionnelle.

- @param {{ path: string }} args
- @param {Function} guard
- @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
- @param {Function} onEvent

### `moveFile` — [src/harness/tools/fs.js:285](src/harness/tools/fs.js)

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

## src/harness/tools/index.js

### `dispatch` — [src/harness/tools/index.js:39](src/harness/tools/index.js)

```js
async function dispatch(toolName, args, guard, config = {}, onEvent = () => {}, projectRoot = '', mcpRegistry = null)
```

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

## src/harness/tools/read-url.js

### `readUrl` — [src/harness/tools/read-url.js:102](src/harness/tools/read-url.js)

```js
async function readUrl({ url: rawUrl, max_chars } = {})
```

---

## src/harness/tools/restore.js

### `restoreFile` — [src/harness/tools/restore.js:27](src/harness/tools/restore.js)

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

## src/harness/tools/scratchpad-tool.js

### `useScratchpad` — [src/harness/tools/scratchpad-tool.js:6](src/harness/tools/scratchpad-tool.js)

```js
function useScratchpad({ action, key, value } = {}, scratchpad)
```

> Outil scratchpad — permet au LLM de prendre des notes intra-session. Le scratchpad est injecté via config._scratchpad depuis agent.js.

---

## src/harness/tools/shell.js

### `runShell` — [src/harness/tools/shell.js:30](src/harness/tools/shell.js)

```js
async function runShell(args, projectRoot, config)
```

> Exécute une commande shell. N'est disponible que si enableShell === true dans la config.

- @param {{ command: string }} args
- @param {string} projectRoot - cwd d'exécution
- @param {object} config

---

## src/harness/tools/spawn.js

### `spawnAgent` — [src/harness/tools/spawn.js:13](src/harness/tools/spawn.js)

```js
async function spawnAgent({ role, task }, config, onEvent, projectRoot)
```

- @param {{ role: string, task: string }} args
- @param {object}   config
- @param {Function} onEvent
- @param {string}   projectRoot

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

### `runTests` — [src/harness/tools/test-runner.js:64](src/harness/tools/test-runner.js)

```js
async function runTests(args, projectRoot)
```

> Lance les tests du projet. Si args.command est fourni, l'utilise tel quel (parmi les commandes whitelistées).

- @param {{ command?: string }} args
- @param {string} projectRoot

---

## src/main/apps-manager.js

### `AppsManager` — [src/main/apps-manager.js:15](src/main/apps-manager.js)

```js
class AppsManager
```

---

## src/main/config.js

### `loadConfig` — [src/main/config.js:50](src/main/config.js)

```js
async function loadConfig()
```

### `saveConfig` — [src/main/config.js:66](src/main/config.js)

```js
async function saveConfig(config)
```

---

## src/main/ipc.js

### `registerIpcHandlers` — [src/main/ipc.js:62](src/main/ipc.js)

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

## src/main/windows.js

### `createWindows` — [src/main/windows.js:12](src/main/windows.js)

```js
function createWindows(_config)
```

> Crée la fenêtre visible (UI) et la fenêtre cachée (moteur LLM).

### `openSettingsWindow` — [src/main/windows.js:51](src/main/windows.js)

```js
function openSettingsWindow(parentWin)
```

> Ouvre (ou ramène au premier plan) la fenêtre Paramètres. Elle est créée lazily et détruite quand l'utilisateur la ferme.

- @param {BrowserWindow} parentWin — fenêtre principale (pour le centrage)

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

