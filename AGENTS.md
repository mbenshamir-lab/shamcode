# Code Harness — Mémoire projet

## Stack
- Electron 30 + Node 20 (CommonJS dans `src/main`, `src/harness`, `src/cli` ; ESM dans `src/renderer-hidden`, `src/renderer-voice`).
- LLM : 6 moteurs — WebLLM/WebGPU (renderer caché), CPU GGUF (node-llama-cpp), Gemini, DeepSeek, OpenAI-compat, Claude — via `src/harness/llm/router.js`.
- Whisper local : `@huggingface/transformers` + `onnxruntime-web` (WASM), jamais `onnxruntime-node`.
- Tests : `node --test tests/*.test.js` (**1 415 tests**, 86 fichiers). Index de symboles : `npm run index` → `docs/CODE_INDEX.md`.
- `docs/courbe-fusion-fer.html` : page autonome (366 l., CSS inline dans `<style>`, tokens `--fs-*`/`--bg*` locaux, SVG `viewBox`). Aucune dépendance, aucun build, ne suit pas `styles.css`.

## Conventions critiques
- `src/harness/**` n'importe JAMAIS `electron` : `llmGenerate` est injecté en paramètre.
- Aucun accès disque depuis les renderers : tout passe par le harness et `safety/path-guard.js`.
- `backup.snapshot()` avant chaque `write_file` / `replace_code` ; backups indexés par **chemin absolu** (`backups/<sha1>/<timestamp>/<basename>`, rétention par fichier) ; `diff_file` / `restore_file` pour vérifier et annuler.
- Dossier de données : `shared/data-dir.js` (`HARNESS_DATA_DIR`, posé par `main.js` après `app.setPath('userData', …)`). `HARNESS_USER_DATA_DIR` force un dossier portable ; si `%APPDATA%` refuse l'écriture (EPERM sandbox/antivirus), `main.js` bascule sur `<projet>/.harness-runtime` (gitignoré). Ne jamais recoder `process.env.APPDATA` en dur : deux copies du projet partageraient config, clés, sessions et backups.
- Clés API uniquement via `src/main/config.js` + `safeStorage` (`src/main/safe-keys.js`).
- Contexte fenêtré : `_windowMessages` / `_windowTailStart` (agent.js:128,143) prennent `opts {keepPairs, threshold}`, alimentés par `config.windowKeepPairs` / `config.windowThreshold` (agent.js:154) ; `undefined` retombe sur `shared/constants.js`.
- Outils : retournent `{ ok:false, error:'CODE' }`, jamais de `throw`.
- Logs via `src/harness/logger.js`.
- **Objectifs (ADR-031)** : `shared/constants.js → TOOLS.GOAL` ; `src/harness/goals/{model,store,policy}.js` ; un JSON par objectif dans `<projet>/.harness/goals/` (path-guard, écriture atomique). `finish` est refusé tant qu'un critère n'est pas `met` avec preuve recoupée dans la trace (`read_file`/`run_tests`/`run_shell`) ; deuxième refus ou `MAX_STEPS` → objectif `blocked`. `config.autonomyLevel` (`assisted` par défaut) : D0/D1 seul, D2/D3 demandés. Le budget est plafonné par `config.maxSteps` (le modèle ne peut pas s'octroyer plus). Ne jamais court-circuiter le gate ni créer un objectif sans `source`.
- **Médias (ADR-032)** : `src/renderer-visible/media.js` expose `window.ShamMedia` (chargé avant app.js). Toute image/vidéo affichée passe par `safeRel` + `fileUrl` : chemins relatifs uniquement, `file://` sous le `projectRoot`, refus des absolus/`..`/protocoles. Ne jamais injecter un chemin brut dans `img src` ni autoriser `http(s)`.
- **Performance locale (ADR-033)** : `prompts/model-policy.js` décide du profil, du RAG, de la fenêtre et de `maxTokens` selon le moteur. Cloud = prompt complet, jamais raboté. Local = profil minimal + descriptions d'outils ≤ 220 car. + `maxTokens` réduit. `CpuEngine` garde une session persistante (cache KV) uniquement si l'historique est un préfixe exact ; sinon la session est recréée. Mesurer avec `npm run bench:prompt`.
- **Périmètre des sous-agents** : `agent.js` construit `strictTools` (Set) quand `config._subAgent` ou `config.planMode` est vrai ; tout outil hors Set → `{ok:false, error:'OUTIL_HORS_PERIMETRE'}` + événement `tool_blocked`, sans `dispatch`. Couvert par `tests/agent.test.js` (« analyzer : write_file refusé »). Ne jamais court-circuiter ce garde-fou.
- **Validation de plan en sous-agent** : `agents/profiles.js` porte `requirePlanApproval` (true pour refactorer, test-writer, debugger, doc-writer ; absent pour analyzer). `tools/spawn.js:_buildSubContext` le traduit en `requestPlanApproval`, mais uniquement si `config.requestPlanApproval` est une fonction — un sous-agent n'a jamais de validation humaine implicite.

## Ce qu'il ne faut jamais modifier
- `docs/CODE_INDEX.md` (généré — régénérer avec `npm run index`).
- `data/` et `.harness/` (sessions, backups, index RAG).
- `electron-builder.yml` exclusions (`onnxruntime-node`, `sharp`, `@img`, `@node-llama-cpp/win-x64-cuda*`) : ~845 Mo évités.

## Lancer l'app
- `npm start` (= `electron .`) : processus long → lancement en arrière-plan, jamais bloquant.
- Au démarrage, erreurs `disk_cache` / `gpu_disk_cache` (Accès refusé 0x5) : bénignes, cache verrouillé sous Windows.

## Mesures de référence (audit 2026-11-22)
- `src/` : 121 fichiers, ~27 600 lignes ; `renderer-visible/app.js` = 4 441 l., `styles.css` = 5 169 l., `media.js` = 76 l.
- `tests/` : 86 fichiers ; `npm test` → **1415 pass / 0 fail** (~30-90 s sur Node 26).
- Qualité : `npm run lint` → **0 erreur** (242 avertissements) ; `node tests/eval/run.js` → **20/20 tâches, 91/91 checks**. Les deux tournent en CI.
- Outils : 79 (`shared/constants.js → TOOLS`) ; moteurs : 6 ; personas : 6 ; ADR : 33.
- `docs/MODULES.md` documente désormais `lsp.js`, `merge-videos.js`, `voice/` et `context/budget.js`.
- Dépendances : 5 prod + 7 dev, toutes réellement importées (aucune fantôme).
- Dépôt git : `github.com/mbenshamir-lab/shamcode` (branche `main`), pas de tag de release.
- Packaging : `win-unpacked` 542 Mo, `app.asar` 186 Mo. `build:win:dir` OK ; `build:win` (NSIS) échoue dans ce dossier — l'antivirus verrouille l'installeur fraîchement généré. Reconstruire depuis un dossier exclu.

## UI / Accessibilité (mesuré 2026-11-22)
- Contrastes mesurés (dark) : accent **9,10/8,57/7,74** (AAA), success 7,30, diff-hunk 9,97, kw-search 6,11, kw-net 9,20, `--text-muted`/bg4 5,67 — conformes. **Restent sous AA** : `--error` #ef4444 sur `--bg-elevated` **3,90** et sur `--bg` 3 **4,42** (→ #f87171 donne 6,01/5,31) ; `--text-subtle`/bg4 **4,30** (AA large seulement) ; thème clair #dc2626 sur bg 3 **3,95** (→ #b91c1c donne 5,29).
- Focus : anneau global `:where(...):focus-visible` + `!important`, `prefers-reduced-motion` présent. WCAG 2.4.7 et 2.3.3 OK.
- Responsive : **3 media queries de largeur** (1200/900/640) + `prefers-reduced-motion` ; `styles.css` porte 1 250 `var(--…)`, 15 `font-size` en px, 133 couleurs hex, 145 `border-radius`.
- Audit design chiffré et priorisé (P0/P1/P2) : `docs/DESIGN_PROPOSITIONS.md` ; mesures brutes en note `design:audit`.
- CSS hors feuilles : `settings.html` 1 bloc `<style>` ; `design.html` 14 `style=`.
- Barre de saisie, ligne basse : `index.html` regroupe `<span id="ctx-usage">` et `<select id="persona-select">` dans `div.persona-row` ; `styles.css` pose `align-items: flex-end` pour coller les deux sur la même ligne de base.

## Pièges connus
- `src/` peut apparaître absent sur un `list_dir` racine précoce (cache/scan) : re-lister avant de conclure.
- Renommage ShamCode partiel : `package.json` garde `"name": "code-harness"` (identifiants techniques volontairement stables). Le test `tests/project-info.test.js` a été réaligné — plus aucun rouge (vérifié 1415/1415).
- `npm start` relancé trop vite : `cache_util_win` / `disk_cache` / `gpu_disk_cache` en erreur, la fenêtre s'ouvre quand même (processus `running`).
- Même avec `user-data.js` en place, relancer juste après `stop_process` rejoue `cache_util_win` / `gpu_disk_cache` (verrous Chromium pas encore libérés). Bénin : le processus reste `running`, la fenêtre s'ouvre.
- `context/trimmer.js` : parts de départ `rag 70 % / tree 30 % / symbols 15 % / notes 10 %`, mais **deux passes** — plafonds d'abord, puis reliquat redistribué aux sections non servies ; `symbols` et `notes` ne sont plus affamées à 12 k.
- `tools/families.js` : familles chargées par regex sur la tâche ; `HEAVY` (navigateur, media, agents) exige un terme `STRONG` **ou** ≥ 2 mots-clés distincts (`_distinctMatches`) — un mot ambigu isolé (« login », « image », « agent ») ne charge plus 18 outils. Reste large par choix : rater une famille coûte un aller-retour. Déclencheurs exportés en `FAMILY_TRIGGERS`, forçage via `config.forceFamilies`.
- Un test par phase (`tests/fixes-pNN.test.js`, `tests/phase-NN.test.js`) : la suite est le registre des régressions.
- Tests CSS : asserter les tokens (`font-size: var(--text-xs)`), jamais des px en dur — sinon le test bloque toute tokenisation.
- Fenêtre voix créée à la demande, téléchargement du modèle jusqu'à 30 min : ne pas réduire le timeout.
- Deux copies du projet lancées en parallèle (« HARNESS CODE » et « HARNESS CODE - Copie ») partagent `name: code-harness` et donc `%APPDATA%\code-harness`. **Corrigé** : `src/main/user-data.js` + `app.setPath('userData', …)` en tête de `src/main/main.js`, puis `HARNESS_DATA_DIR` pour config/sessions/RAG/logs/backups (`src/shared/data-dir.js`). La copie « - Copie » reçoit `%APPDATA%\code-harness-<sha1 du chemin>` (marqueur `.project-path`), l'original garde l'historique ; un nom de doublon (`- Copie`, `(1)`) ne revendique jamais le dossier partagé. `config.json` est migré une fois vers le dossier propre. Tests : `tests/user-data.test.js`, `tests/data-dir.test.js`.
- `PASSATION.md` est la source de vérité de l'état courant (phase en cours, blocages).
- Suite **1415/1415** : l'assertion périmée de `tests/fixes-p71.test.js` (25 % → 31.25 %) est scopée par regex ancrée, fin du dernier rouge.
- Les autres assertions CSS restent en `cssSrc.includes(...)` non scopé : un doublon ailleurs dans le CSS peut masquer une régression.

## Rendu de l'orchestration (app.js + styles.css)

- Événements émis par `src/harness/tools/orchestrate.js` : `orchestration_start` / `_phase_start` / `_phase_done` / `_done`.
- Routage `app.js:1216-1231` : `orchestration_start` → `_appendOrchestrationCard` ; `sub_agent_start` ne crée une carte que si `_orchState` est nul.
- `_orchState` (app.js) est la garde globale : non nul = vue orchestrée, les cartes `sub_agent_*` sont supprimées (une seule carte par plan).
- Helpers : `_orchPhaseStart` (ligne de phase), `_orchAgentTick` (compteur « N agents »), `_orchPhaseDone`, `_orchRefreshCounter` (compteur « x/y phases »), `_orchDone` (pied de carte).
- Styles `.orch-card` / `.orch-phase*` / `.orch-footer` dans `styles.css:3506-3600` ; tokens uniquement (`--text-2xs`, `--border-muted`, `--radius-lg`), animations `slideDown` et `fadeIn`.
- **Ne jamais réintroduire une carte par sous-agent pendant une orchestration** : 6 phases × 4 agents = 24 cartes + autant de `scrollIntoView` (app.js:3121) qui font sauter le scroll.

## Rendu markdown du chat (`_renderMarkdown`, app.js)

- Tableaux : détection `| a | b |` + ligne séparatrice `|---|` → `<div class="md-table"><table>` (thead/tbody).
- Alignements `:--` / `:-:` / `--:` → classes `t-left` / `t-center` / `t-right` (styles.css:2220-2222).
- Lignes inégales complétées à la largeur de l'en-tête ; gras et code inline rendus dans les cellules.
- Styles dans `styles.css` §« Tableau Markdown » (l.2171-2223, `.md-table` + `.t-left/center/right`) ; 8 tests dans `tests/markdown.test.js` (suite `_renderMarkdown — tableaux`, l.117-188).
- Supporté : titres `#`→`h4` / `##`→`h5` / `###`+→`h6`, puces `- *`, listes `1.`, `**gras**`, `*italique*`, `` `code` ``, blocs fencés colorés + bouton Copier, chemins de fichiers cliquables (`_linkifyFiles`), blocs ```sparkline, **médias `![alt](chemin)`** et chemins d'images/vidéos nus (`.md-media`).
- Non supporté (texte brut) : citations `>`, règles `---`, liens `[t](url)`, `~~barré~~`, puces imbriquées.
- `_sparkline(code)` (app.js:1865) : split sur `[\s,;]+`, `Number.parseFloat`, filtre les non-finies ; `''` si < 2 valeurs → repli sur bloc de code brut. Produit `.sparkline` > `svg` > `polyline` + `.sparkline-last`.
- CSS `.sparkline` dans `styles.css` (l.2225-2263) : `polyline` sans `fill`, `stroke: var(--accent)`, `vector-effect: non-scaling-stroke` — sans lui la courbe est invisible.
- Exemples prêts à copier-coller : `docs/EXEMPLES_RENDU.md`.
- `_renderMarkdown` (`src/renderer-visible/app.js`) gère code fencé, gras/italique, titres, listes, liens fichiers, sparkline, **tableaux** et **médias** (`.md-media`) : **ni citations, ni HTML brut**. `tests/lib/app-module.js:46` l'extrait par regex sur `function _renderMarkdown(text) {` — changer la signature casse 3 fichiers de tests.
- `Content-Security-Policy` déclarée dans les 5 renderers (`tests/csp.test.js`) : fenêtres visibles sans `unsafe-eval` ni script distant ; `llm.html` autorise esm.run/jsDelivr, `voice.html` autorise le WASM et le téléchargement du modèle.
- Shell = **cmd.exe** : `head`, `Select-String`, `findstr` sur pipes Unicode indisponibles ou infidèles ; filtrer la sortie via `node -e` + `spawnSync`.
- Démarrage app : `npm start` (= `electron .`) — les `ERROR:disk_cache.cc` / `gpu_disk_cache.cc` / `quota_database.cc` (Accès refusé, cache creation failed) sont bénins et n'empêchent pas l'ouverture de la fenêtre ; ils apparaissent surtout après un `stop_process force`.
- **`stop_process` ne tue que le wrapper `npm`**, pas les enfants `electron.exe` : ils survivent et gardent les verrous du userData. Avant toute relance, purger :
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*<dossier projet>*' } | Stop-Process -Force`
  (`wmic` n'existe plus sur les Windows récents — utiliser `Get-CimInstance`, pas `wmic process`.)

## Design 0.3.0 — propositions implémentées
- `styles.css` : contrastes P0, échelle `--text-*` (plancher 11px), rayons `--r-*`, couleurs vers tokens.
- Bloc final : topbar hiérarchisée, `.chat-empty` masqué après le 1er message, 3 `@media` (1200/900/640).
- `index.html` : `#engine-state` en `aria-live="polite"`, `#chat-empty` en premier enfant de `#messages`.
