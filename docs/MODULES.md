# MODULES — Carte des modules du Code Harness

> Source de vérité sur les frontières de modules, interfaces publiques et dépendances.
> Mettre à jour quand une interface publique change ou qu'un nouveau module est créé.
> Ne pas documenter les détails d'implémentation — uniquement ce qu'un module expose et ce dont il dépend.

---

## Règle de frontière principale

```
src/main/          ← process Electron. Connaît Electron. Ne connaît pas l'UI.
src/harness/       ← logique agent. N'importe JAMAIS electron.
src/renderer-*/    ← UI. N'accède JAMAIS au FS directement.
src/shared/        ← constantes partagées. Aucune dépendance externe.
src/cli/           ← point d'entrée CLI. Connaît Node, pas Electron.
src/mcp-server/    ← serveur MCP stdio. Connaît Node, pas Electron.
```

---

## src/main/

### `main.js`
**Rôle** : point d'entrée Electron. Crée les fenêtres, pose les flags WebGPU, démarre l'app.
**Dépend de** : `windows.js`, `ipc.js`, `config.js`
**Expose** : rien (point d'entrée)
**Invariant** : flags WebGPU posés AVANT `app.ready`.

### `ipc.js`
**Rôle** : câble tous les canaux IPC entre les renderers et le harness.
**Dépend de** : `harness/agent.js` (via `runAgent`), `config.js`, `windows.js`, `LlmRouter`, `McpRegistry`
**Canaux entrants** : `agent:run`, `agent:cancel`, `config:get`, `config:set`, `engine:test`, `settings:open`, `settings:close`, `file:read`, `sessions:list`, `sessions:get`, `file:dialog`
**Canaux sortants** : `agent:event`, `llm:status`, `llm:request`, `config:updated`

### `config.js`
**Rôle** : charge et sauvegarde la config utilisateur. Résout les clés API chiffrées.
**Dépend de** : `safe-keys.js`
**Interface publique** :
- `loadConfig()` → `Promise<config>` — résout toutes les clés
- `saveConfig(config)` → `Promise<void>` — chiffre avant écriture

### `safe-keys.js`
**Rôle** : chiffrement/déchiffrement des clés API via `safeStorage` Electron.
**Interface publique** :
- `encryptKey(plain)` → `string`
- `decryptKey(encrypted)` → `string`
- `prepareConfigForSave(config)` → config avec clés chiffrées
- `resolveAllKeys(config)` → config avec clés déchiffrées

### `windows.js`
**Rôle** : crée et gère les BrowserWindows (principale + paramètres).
**Interface publique** :
- `createMainWindow()` → `BrowserWindow`
- `openSettingsWindow(parentWin)` → `BrowserWindow` (singleton, focus si déjà ouverte)

### `preload.js`
**Rôle** : expose `window.harness` au renderer principal via contextBridge.
**API exposée** : `runAgent`, `cancelAgent`, `onAgentEvent`, `onLlmStatus`, `getConfig`, `setConfig`, `testEngine`, `openSettings`, `onConfigUpdated`, `readProjectFile`, `listSessions`, `getSession`

### `preload-hidden.js`
**Rôle** : expose `window.llmBridge` au renderer WebLLM (hidden).
**API exposée** : relay IPC pour `llm:request` / `llm:reply` / `llm:ready` / `llm:progress`

### `preload-settings.js`
**Rôle** : expose `window.settingsApi` au renderer paramètres.
**API exposée** : `getConfig`, `setConfig`, `testEngine`, `listModels`, `selectFolder`, `selectFile`, `closeWindow`

### `llm-bridge.js`
**Rôle** : crée la fonction `llmGenerate` injectable dans `runAgent` depuis le process principal.
**Dépend de** : `LlmRouter`, `McpRegistry`

---

## src/harness/

### `agent.js`
**Rôle** : boucle principale de l'agent. Orchestre parser → tools → LLM.
**N'importe JAMAIS electron.**
**Interface publique** :
```js
runAgent({
  task,           // string — tâche décrite par l'utilisateur
  llmGenerate,    // async (messages, opts) => string — injecté
  projectRoot,    // string — chemin absolu du dossier projet
  config,         // object — maxSteps, temperature, enableShell...
  onEvent,        // (event) => void — stream vers l'UI
}) → Promise<{ ok, summary?, trace, error? }>
```
**Dépend de** : `parser`, `tools/index`, `mcp/registry`, `safety/path-guard`, `prompts/system`, `prompts/by-language`, `context/builder`, `rag/*`, `memory/*`, `goals/*`, `tools/browser` (dispose), `shared/constants`

### `goals/` — moteur d'objectifs (ADR-031)
- `model.js` — `createGoal()`, `normalizeCriteria()`, `goalSummary()`, `pendingCriteria()` : objectif + critères **vérifiables** (test/fichier/commande) + budget.
- `store.js` — `saveGoal()` (écriture atomique), `loadActiveGoal()`, `listGoals()`, `archiveActiveGoal()` — un JSON par objectif dans `<projet>/.harness/goals/`, sous path-guard.
- `policy.js` — `canDecideAlone()` (D0–D3 × `off|assisted|auto`), `validateDecision()`, `evaluateGoalCompletion()` : preuve recoupée avec la trace (`read_file`, `run_tests`, `run_shell`), budget fichiers/étapes/dépendances.
- Gate : `finish` est refusé tant qu'un critère n'est pas `met` avec preuve ; au deuxième refus (ou à `MAX_STEPS`) l'objectif passe `blocked`.

### `parser.js`
**Rôle** : extrait un tool call JSON depuis la réponse brute du LLM. Ultra-tolérant.
**Interface publique** :
- `extractToolCall(text)` → `{ tool, args, intent? } | null`
**Invariant** : 2 retries minimum sur JSON invalide. Normalise CRLF/LF avant parse.

### `logger.js`
**Rôle** : seul point de log autorisé. Zéro `console.log` en production ailleurs.
**Interface publique** :
- `logger.info(msg, meta?)`, `logger.warn(...)`, `logger.error(...)`, `logger.debug(...)`

---

## src/harness/safety/

### `path-guard.js`
**Rôle** : confine toutes les opérations FS au `projectRoot`.
**Interface publique** :
- `makeGuard(projectRoot)` → `guard(relPath)` — retourne le chemin absolu ou throw

### `backup.js`
**Rôle** : snapshot des fichiers avant écriture. Appelé par `write_file` et `replace_code`.
**Interface publique** :
- `snapshot(absPath)` → `Promise<void>`
- `restore(absPath)` → `Promise<void>`

### `diff.js`
**Rôle** : génère un diff coloré (vert/rouge/bleu) pour le mode review.
**Interface publique** :
- `buildWritePreview(original, proposed)` → `{ hunks, stats }`

### `harnessignore.js`
**Rôle** : lit `.harnessignore` et filtre les chemins exclus.
**Interface publique** :
- `loadIgnore(projectRoot)` → `{ isIgnored(relPath) → bool }`

---

## src/harness/llm/

### `router.js` — `LlmRouter`
**Rôle** : chaîne de fallback entre moteurs LLM.
**Interface publique** :
```js
new LlmRouter(chain, registry, config, bridges)
router.generate(messages, opts) → Promise<string>
router.statusAll()              → { [name]: bool }
router.disposeAll()             → void
```

### `registry.js`
**Rôle** : catalogue des moteurs disponibles avec leurs factories.
**Moteurs** : `openai-compat`, `gemini`, `claude`, `webllm`, `cpu`
**Interface publique** : objet `{ [name]: { factory, offline?, requiresKey?, cost? } }`

### `base.js` — `LlmEngine` (interface)
**Méthodes attendues** : `generate(messages, opts)`, `isReady()`, `dispose()`

### `engines/`
| Fichier | Moteur | Particularité |
|---|---|---|
| `gemini.js` | Gemini API | POST generativelanguage.googleapis.com |
| `openai-compat.js` | OpenAI-compatible | URL de base configurable |
| `claude.js` | Anthropic API | `x-api-key` + `anthropic-version` |
| `webllm.js` | WebLLM (WebGPU) | Délègue au bridge IPC `llm:request` |
| `cpu.js` | node-llama-cpp | Session persistante (cache KV), contexte 4k, KV `Q8_0`, flash attention, Vulkan/CUDA auto |
| `deepseek` (registre) | DeepSeek | Réutilise `OpenAiCompatEngine` avec `DEEPSEEK_BASE` |

---

## src/harness/tools/

### `index.js` — `dispatch()`
**Rôle** : route un tool call vers la bonne implémentation.
**Interface publique** :
```js
dispatch(toolName, args, guard, config, onEvent, projectRoot, mcpRegistry) → Promise<{ ok, ... }>
```
**Invariant** : retourne toujours `{ ok: false, error: 'CODE' }` — jamais throw.

### Outils FS (`fs.js`)
- `readFile(args, guard, projectRoot)` → `{ ok, content, totalLines }`
- `writeFile(args, guard, config, onEvent)` → `{ ok }` — appelle `backup.snapshot()` avant
- `replaceCode(args, guard, config, onEvent)` → `{ ok }` — normalise CRLF avant comparaison
- `listDir(args, guard, projectRoot)` → `{ ok, entries[] }`
- `deleteFile(args, guard)` → `{ ok }`
- `moveFile(args, guard)` → `{ ok }`

### Outil objectif (`goal.js`)
- `goalTool(args, config, projectRoot, onEvent)` — actions `set/status/decide/plan/close/block/get`.
- `set` exige `source` (citation) + critères vérifiables ; `status` exige une preuve ; `decide` applique la matrice D0–D3 ; `close` refuse un critère non prouvé ; `block` exige une raison.
- Désactivé si `autonomyLevel === 'off'` ; absent des sous-agents (périmètre strict).

### Outils shell/process
- `shell.js` — `runShell` : seulement si `enableShell === true`
- `spawn.js` — `spawnAgent` : sous-agent
- `process-runner.js` — `startProcess`, `stopProcess`, `getOutput`, `listProcesses`

### Outils lecture/analyse
- `grep.js` — `searchGrep`
- `git.js` — `gitStatus`, `gitDiff` (lecture seule, jamais d'écriture)
- `symbols-search.js` — `findSymbol`
- `read-url.js` — `readUrl`
- `diff-file.js` — `diffFile`
- `project-info.js` — `getProjectInfo`

### Outils collaboration/agent
- `ask.js` — `askUser`
- `message-bus.js` — `enableCollaboration`, `postMessage`, `readMessages`
- `rules.js` — `addRule`, `deleteRule`, `installSkill`, `removeSkill`
- `api.js` — `callApi`

### Outils LSP (`lsp.js`)
- `lspHover`, `lspDefinition`, `lspReferences` — client LSP stdio, chargé seulement si `config.enableLsp`

### Outils média
- `image.js` — `generateImage`
- `video.js` — `generateVideo`
- `merge-videos.js` — `mergeVideos` (ffmpeg)
- `speech.js` — `generateSpeech`, `listSpeechVoices`
- `design.js` — `generatePalette`, `readDesignTokens`

### Outils browser (`browser.js`)
Singletons par session. Tous dépendent de `puppeteer-core`.
`browserOpen`, `browserNavigate`, `browserScreenshot`, `browserClick`, `browserType`, `browserEvaluate` (requiert `enableShell`), `browserGetText`, `browserWait`, `browserClose`, `disposeBrowser`

---

## src/harness/context/

**Rôle** : assemble le contexte injecté dans le prompt système.
- `tree.js` — arborescence filtrée du projet
- `symbols.js` — extraction regex multi-langages (JS/TS/Py/Go/Rust/Java/C#/Ruby/PHP)
- `trimmer.js` — parts `rag 70 % / tree 30 % / symbols 15 % / notes 10 %`, deux passes (plafonds puis reliquat)
- `budget.js` — `resolveContextBudget({engine, model, maxContextChars})` : 4 000 (petit modèle local), 8 000 (local), sinon `maxContextChars`
- `depgraph.js` — graphe import/export incrémental, persisté dans `.harness/depgraph.json`
- `builder.js` — `buildContext({task, projectRoot, ragStore, maxChars})` → string injectée dans le prompt

---

## src/harness/rag/

**Rôle** : recherche sémantique légère (bag-of-words TF, sans dépendance ML externe).
- `store.js` — `createStore(storeId)` : stockage JSON + similarité cosinus, dans `<dataDir>/rag/`
- `embedder.js` — `embed(text)` : vecteur TF normalisé (fallback si `@xenova` absent)
- `indexer.js` — `indexProject(root, store)` : chunking sémantique par frontières de déclarations (fallback 60 lignes/15), SHA1 incrémental
- `retrieve.js` — `retrieveRelevant(store, task, { topK })` : top-k par cosinus

---

## src/harness/voice/

- `summarize.js` — `condenseDictation(raw, llmGenerate)` : < 40 caractères → texte brut ; erreur ou réponse vide → repli sur la transcription brute

---

## src/harness/memory/

- `sessions.js` — `createSession`, `updateSession`, `loadSession`, `listSessions`, `applyRetention`
- `scratchpad.js` — `createScratchpad()` : set/get/append/delete, `toContextBlock()`, sérialisable JSON

---

## src/harness/prompts/

- `system.js` — `buildSystemPrompt(availableTools, context, opts)` : prompt système complet
- `model-policy.js` — `resolveModelPolicy({engine, model, explicit})` : cloud = prompt complet ; local = profil minimal, RAG/AGENTS/historique réduits, `maxTokens` plus bas (ADR-033)
- `profile.js` — `resolvePromptProfile` : `minimal` (petits modèles) ou `standard`
- `examples.js` — few-shot examples injectés dans le prompt
- `by-language.js` — `detectLanguage(files)`, `getLangRules(lang)` : règles spécifiques au langage

---

## src/harness/mcp/

- `client.js` — `McpClient` : transport stdio (spawn + readline JSON-RPC) et HTTP
- `registry.js` — `McpRegistry` : initialise les connecteurs actifs, préfixe `mcp_<slug>_<tool>`, route `call(key, args)`

---

## src/renderer-visible/

**Règle** : zéro accès FS direct. Tout passe par `window.harness`.
- `index.html` — structure HTML principale
- `media.js` — `window.ShamMedia` : `kindOf`, `safeRel`, `fileUrl`, `findMediaPath` — construit une URL `file://` confinée au projet (refuse absolu, `..`, protocoles)
- `app.js` — logique UI complète (vanilla JS)
- `styles.css` — styles (variables CSS tokens sur `:root`, thèmes, densité)

---

## src/renderer-hidden/

**Règle** : ESM uniquement (WebLLM). Isolé du reste de l'app.
- `engine.js` — charge le modèle WebLLM via `@mlc-ai/web-llm` (WebGPU), écoute `window.llmBridge`

---

## src/renderer-settings/

- `settings.html` — fenêtre paramètres autonome (BrowserWindow isolée)
- `settings.js` — logique paramètres via `window.settingsApi`

---

## src/renderer-design/

- `design.html` / `design.css` / `design.js` — Design Studio (palette, contraste WCAG, tokens, export), 100 % frontend via `window.designApi`

---

## src/renderer-voice/

- `voice.html` / `voice.js` — fenêtre cachée Whisper (Transformers.js + onnxruntime-web WASM), créée à la demande

---

## src/shared/

Importable depuis main ET harness (pas de dépendance Electron, pas de dépendance FS).
- `constants.js` — `MAX_STEPS`, `TOOLS`, `ENGINES`, `IPC`, `SESSIONS_RETENTION`, `CONTEXT_WINDOW`
- `approval.js` — logique d'approbation partagée
- `data-dir.js` — `getDataDir()` : `HARNESS_DATA_DIR` (posé par `main.js`) sinon `%APPDATA%\code-harness` ; base de config, sessions, backups, RAG et logs

---

## src/cli/

- `config-loader.js` — charge config depuis env vars ou `~/.harness/config.json` (sans `safeStorage`)
- `output.js` — sortie colorée ANSI

### `bin/harness.js`
Point d'entrée CLI. Même harness qu'Electron, sans Electron.

---

## src/mcp-server/

- `server.js` — serveur MCP stdio (JSON-RPC 2.0). Sans SDK externe. Dispatch vers `harness/tools/index.js`.
- `tool-schemas.js` — 16 schémas JSON Schema des outils exposés via MCP

---

## Dépendances inter-modules (sens interdit)

```
harness/  →  main/       ✗ interdit
renderer/ →  harness/    ✗ interdit (passe par window.harness)
renderer/ →  FS           ✗ interdit (passe par IPC)
shared/   →  electron     ✗ interdit
```
