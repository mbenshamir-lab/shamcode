# Code Harness — Mémoire projet

## Stack
- Electron 30 + Node 20 (CommonJS dans `src/main`, `src/harness`, `src/cli` ; ESM dans `src/renderer-hidden`, `src/renderer-voice`).
- LLM : WebLLM/WebGPU (renderer caché), Gemini, OpenAI-compat, Claude — via `src/harness/llm/router.js`.
- Whisper local : `@huggingface/transformers` + `onnxruntime-web` (WASM), jamais `onnxruntime-node`.
- Tests : `node --test tests/*.test.js` (~1342 tests). Index de symboles : `npm run index` → `docs/CODE_INDEX.md`.
- `docs/courbe-fusion-fer.html` : page autonome (366 l., CSS inline dans `<style>`, tokens `--fs-*`/`--bg*` locaux, SVG `viewBox`). Aucune dépendance, aucun build, ne suit pas `styles.css`.

## Conventions critiques
- `src/harness/**` n'importe JAMAIS `electron` : `llmGenerate` est injecté en paramètre.
- Aucun accès disque depuis les renderers : tout passe par le harness et `safety/path-guard.js`.
- `backup.snapshot()` avant chaque `write_file` / `replace_code` ; `diff_file` / `restore_file` pour vérifier et annuler.
- Clés API uniquement via `src/main/config.js` + `safeStorage` (`src/main/safe-keys.js`).
- Contexte fenêtré : `_windowMessages` / `_windowTailStart` (agent.js:128,143) prennent `opts {keepPairs, threshold}`, alimentés par `config.windowKeepPairs` / `config.windowThreshold` (agent.js:154) ; `undefined` retombe sur `shared/constants.js`.
- Outils : retournent `{ ok:false, error:'CODE' }`, jamais de `throw`.
- Logs via `src/harness/logger.js`.
- **Périmètre des sous-agents** : `agent.js` construit `strictTools` (Set) quand `config._subAgent` ou `config.planMode` est vrai ; tout outil hors Set → `{ok:false, error:'OUTIL_HORS_PERIMETRE'}` + événement `tool_blocked`, sans `dispatch`. Couvert par `tests/agent.test.js` (« analyzer : write_file refusé »). Ne jamais court-circuiter ce garde-fou.
- **Validation de plan en sous-agent** : `agents/profiles.js` porte `requirePlanApproval` (true pour refactorer, test-writer, debugger, doc-writer ; absent pour analyzer). `tools/spawn.js:_buildSubContext` le traduit en `requestPlanApproval`, mais uniquement si `config.requestPlanApproval` est une fonction — un sous-agent n'a jamais de validation humaine implicite.

## Ce qu'il ne faut jamais modifier
- `docs/CODE_INDEX.md` (généré).
- `data/` et `.harness/` (sessions, backups, index RAG).
- `electron-builder.yml` exclusions (`onnxruntime-node`, `sharp`, `@img`) : ~290 Mo évités.

## Lancer l'app
- `npm start` (= `electron .`) : processus long → lancement en arrière-plan, jamais bloquant.
- Au démarrage, erreurs `disk_cache` / `gpu_disk_cache` (Accès refusé 0x5) : bénignes, cache verrouillé sous Windows.

## Mesures de référence (analyse 0.3.0)
- `src/` : 104 fichiers, ~18 800 lignes ; monolithe `renderer-visible/app.js` = 4 197 lignes.
- `tests/` : 75 fichiers ; `npm test` → **1359 pass / 0 fail** (vérifié, ~33 s). PASSATION annonçait 1342.
- `docs/MODULES.md` n'a pas été mis à jour pour `lsp.js`, `merge-videos.js`, `voice/summarize.js`.
- Dépendances : 5 prod + 7 dev, toutes réellement importées (aucune fantôme).
- Pas de dépôt git : seul `data/backups` permet de revenir en arrière.

## UI / Accessibilité (mesuré 0.3.0)
- Contrastes mesurés (dark) : accent **9,10/8,57/7,74** (AAA), success 7,30, diff-hunk 9,97, kw-search 6,11, kw-net 9,20, `--text-muted`/bg4 5,67 — conformes. **Restent sous AA** : `--error` #ef4444 sur `--bg-elevated` **3,90** et sur `--bg` 3 **4,42** (→ #f87171 donne 6,01/5,31) ; `--text-subtle`/bg4 **4,30** (AA large seulement) ; thème clair #dc2626 sur bg 3 **3,95** (→ #b91c1c donne 5,29).
- Focus : **corrigé** — anneau global `:where(...):focus-visible` + `!important` (l. 97-104), `prefers-reduced-motion` présent (l. 107). WCAG 2.4.7 et 2.3.3 OK.
- Reste à faire : **1 seul `@media`** sur 4 921 lignes (aucun responsive) ; `styles.css` porte **234 `font-size` px hors `:root`** dont **147 < 12px** (min 8px) avec seulement **7 tokenisés**, **135 couleurs hex** et **92 `border-radius`** en dur.
- Audit design chiffré et priorisé (P0/P1/P2) : `docs/DESIGN_PROPOSITIONS.md` ; mesures brutes en note `design:audit`.
- CSS hors feuilles : `settings.html` 1 bloc `<style>` + 29 `style=` ; `design.html` 14 `style=`.
- Barre de saisie, ligne basse : `index.html:262-275` regroupe `<span id="ctx-usage">` et `<select id="persona-select">` dans `div.persona-row` ; `styles.css:230-254` pose `align-items: flex-end` pour coller les deux sur la même ligne de base. Les tests comptent 1359 pass / 0 fail.

## Pièges connus
- `src/` peut apparaître absent sur un `list_dir` racine précoce (cache/scan) : re-lister avant de conclure.
- Renommage ShamCode partiel : `package.json` garde `"name": "code-harness"` (identifiants techniques volontairement stables). Le test `tests/project-info.test.js` a été réaligné — plus aucun rouge (vérifié 1359/1359).
- `npm start` relancé trop vite : `cache_util_win` / `disk_cache` / `gpu_disk_cache` en erreur, la fenêtre s'ouvre quand même (processus `running`).
- Même avec `user-data.js` en place, relancer juste après `stop_process` rejoue `cache_util_win` / `gpu_disk_cache` (verrous Chromium pas encore libérés). Bénin : le processus reste `running`, la fenêtre s'ouvre.
- `context/trimmer.js` : parts de départ `rag 70 % / tree 30 % / symbols 15 % / notes 10 %`, mais **deux passes** — plafonds d'abord, puis reliquat redistribué aux sections non servies ; `symbols` et `notes` ne sont plus affamées à 12 k.
- `tools/families.js` : familles chargées par regex sur la tâche ; `HEAVY` (navigateur, media, agents) exige un terme `STRONG` **ou** ≥ 2 mots-clés distincts (`_distinctMatches`) — un mot ambigu isolé (« login », « image », « agent ») ne charge plus 18 outils. Reste large par choix : rater une famille coûte un aller-retour. Déclencheurs exportés en `FAMILY_TRIGGERS`, forçage via `config.forceFamilies`.
- Un test par phase (`tests/fixes-pNN.test.js`, `tests/phase-NN.test.js`) : la suite est le registre des régressions.
- Tests CSS : asserter les tokens (`font-size: var(--text-xs)`), jamais des px en dur — sinon le test bloque toute tokenisation.
- Fenêtre voix créée à la demande, téléchargement du modèle jusqu'à 30 min : ne pas réduire le timeout.
- Deux copies du projet lancées en parallèle (« HARNESS CODE » et « HARNESS CODE - Copie ») partagent `name: code-harness` → même `%APPDATA%\code-harness` → erreurs `cache_util_win` / `gpu_disk_cache` / `quota_database` au démarrage. **Corrigé** : `src/main/user-data.js` + `app.setPath('userData', …)` en tête de `src/main/main.js` (l.13-17, avant `whenReady`). La copie « - Copie » reçoit `%APPDATA%\code-harness-<sha1 du chemin>` (marqueur `.project-path`), l'original garde l'historique ; un nom de doublon (`- Copie`, `(1)`) ne revendique jamais le dossier partagé. Tests : `tests/user-data.test.js`. Reste à faire une fois : fermer les deux copies pour purger les anciens verrous Chromium.
- `PASSATION.md` est la source de vérité de l'état courant (phase en cours, blocages).
- Suite **1342/1342** : l'assertion périmée de `tests/fixes-p71.test.js` (25 % → 31.25 %) est scopée par regex ancrée, fin du dernier rouge.
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
- Supporté : titres `#`→`h4` / `##`→`h5` / `###`+→`h6`, puces `- *`, listes `1.`, `**gras**`, `*italique*`, `` `code` ``, blocs fencés colorés + bouton Copier, chemins de fichiers cliquables (`_linkifyFiles`), blocs ```sparkline.
- Non supporté (texte brut) : citations `>`, règles `---`, liens `[t](url)`, images `![..]`, `~~barré~~`, puces imbriquées.
- `_sparkline(code)` (app.js:1865) : split sur `[\s,;]+`, `Number.parseFloat`, filtre les non-finies ; `''` si < 2 valeurs → repli sur bloc de code brut. Produit `.sparkline` > `svg` > `polyline` + `.sparkline-last`.
- CSS `.sparkline` dans `styles.css` (l.2225-2263) : `polyline` sans `fill`, `stroke: var(--accent)`, `vector-effect: non-scaling-stroke` — sans lui la courbe est invisible.
- Exemples prêts à copier-coller : `docs/EXEMPLES_RENDU.md`.
- `_renderMarkdown` (`src/renderer-visible/app.js:1862`) gère code fencé, gras/italique, titres, listes, liens fichiers, sparkline et **tableaux** : **ni images, ni citations**. `tests/lib/app-module.js:46` l'extrait par regex sur `function _renderMarkdown(text) {` — changer la signature casse 3 fichiers de tests.
- Aucune `Content-Security-Policy` déclarée dans le projet : tout `<img src>` injecté serait chargé sans filtre, à cadrer via `path-guard` si des illustrations sont ajoutées.
- Shell = **cmd.exe** : `head`, `Select-String`, `findstr` sur pipes Unicode indisponibles ou infidèles ; filtrer la sortie via `node -e` + `spawnSync`.
- Démarrage app : `npm start` (= `electron .`) — les `ERROR:disk_cache.cc` / `gpu_disk_cache.cc` / `quota_database.cc` (Accès refusé, cache creation failed) sont bénins et n'empêchent pas l'ouverture de la fenêtre ; ils apparaissent surtout après un `stop_process force`.
- **`stop_process` ne tue que le wrapper `npm`**, pas les enfants `electron.exe` : ils survivent et gardent les verrous du userData. Avant toute relance, purger :
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*<dossier projet>*' } | Stop-Process -Force`
  (`wmic` n'existe plus sur les Windows récents — utiliser `Get-CimInstance`, pas `wmic process`.)

## Design 0.3.0 — propositions implémentées
- `styles.css` : contrastes P0, échelle `--text-*` (plancher 11px), rayons `--r-*`, couleurs vers tokens.
- Bloc final : topbar hiérarchisée, `.chat-empty` masqué après le 1er message, 3 `@media` (1200/900/640).
- `index.html` : `#engine-state` en `aria-live="polite"`, `#chat-empty` en premier enfant de `#messages`.
