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
**Dépend de** : `parser`, `tools/index`, `mcp/registry`, `safety/path-guard`, `prompts/system`, `prompts/by-language`, `context/builder`, `rag/*`, `memory/*`, `tools/browser` (dispose), `shared/constants`

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
| `cpu.js` | node-llama-cpp | Import dynamique ESM depuis CJS |

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

### Outils browser (`browser.js`)
Singletons par session. Tous dépendent de `puppeteer-core`.
`browserOpen`, `browserNavigate`, `browserScreenshot`, `browserClick`, `browserType`, `browserEvaluate` (requiert `enableShell`), `browserGetText`, `browserWait`, `browserClose`, `disposeBrowser`

---

## src/harness/context/

**Rôle** : assemble le contexte injecté dans le prompt système.
- `tree.js` — arborescence filtrée du projet
- `symbols.js` — extraction regex multi-langages (JS/TS/Py/Go/Rust/Java/C#/Ruby/PHP)
- `trimmer.js` — budget 12k chars, priorité : system > task > files > rag > tree
- `builder.js` — `buildContext(projectRoot, task, config)` → string injectée dans le prompt

---

## src/harness/rag/

**Rôle** : recherche sémantique légère (bag-of-words TF, sans dépendance ML externe).
- `store.js` — `createStore(path)` : stockage JSON + similarité cosinus
- `embedder.js` — `embed(text)` : vecteur TF normalisé (fallback si `@xenova` absent)
- `indexer.js` — `indexProject(root, store)` : chunks 60 lignes, overlap 15, SHA1 incrémental
- `retrieve.js` — `retrieve(query, store, k)` : top-k par cosinus

---

## src/harness/memory/

- `sessions.js` — `createSession`, `updateSession`, `loadSession`, `listSessions`, `applyRetention`
- `scratchpad.js` — `createScratchpad()` : set/get/append/delete, `toContextBlock()`, sérialisable JSON

---

## src/harness/prompts/

- `system.js` — `buildSystemPrompt(config, context, tools)` : prompt système complet
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

## src/shared/

Importable depuis main ET harness (pas de dépendance Electron, pas de dépendance FS).
- `constants.js` — `MAX_STEPS`, `TOOLS`, `ENGINES`, `IPC`, `SESSIONS_RETENTION`, `CONTEXT_WINDOW`
- `approval.js` — logique d'approbation partagée

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
