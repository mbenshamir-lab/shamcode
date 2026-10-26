# DECISIONS — Architecture Decision Records

> Une entrée par décision structurante.
> Format : contexte → décision → conséquences → alternatives rejetées.
> Ne pas modifier une entrée existante — ajouter une nouvelle entrée si la décision évolue.
> Numérotation séquentielle, jamais réutilisée.

---

## ADR-001 : Le harness n'importe jamais Electron

**Date** : 2026-10-15 (Phase 1)
**Contexte** : L'agent de code doit être testable sans lancer Electron. Les tests Node.js standard (`node --test`) n'ont pas accès aux APIs Electron.
**Décision** : `src/harness/` n'importe jamais `electron`. La fonction `llmGenerate` est injectée en paramètre dans `runAgent`. Toute dépendance Electron reste dans `src/main/`.
**Conséquences** : Tests unitaires du harness exécutables avec un simple mock de `llmGenerate`. Découplage total logique/runtime.
**Alternatives rejetées** : Import conditionnel `try { require('electron') } catch {}` — fragile au refactoring, masque les erreurs de couplage.

---

## ADR-002 : path-guard sur chaque outil FS

**Date** : 2026-10-16 (Phase 3)
**Contexte** : Le LLM peut produire des chemins arbitraires (traversal, chemins absolus hors projet). Sur Windows, les séquences `..\\` et les chemins absolus `C:\` sont des vecteurs réels.
**Décision** : Toute fonction qui lit ou écrit un fichier appelle `makeGuard(projectRoot)` avant l'opération. Le guard throw si le chemin résolu sort du `projectRoot`.
**Conséquences** : Toute opération FS hors projet est bloquée à la source, pas à l'appel. Les outils `read_file`, `write_file`, `replace_code`, `list_dir`, `delete_file`, `move_file`, `browserScreenshot` passent tous par le guard.
**Alternatives rejetées** : Validation à la couche IPC uniquement — trop tardif, ne protège pas le CLI ni le MCP server.

---

## ADR-003 : backup avant toute écriture

**Date** : 2026-10-16 (Phase 3)
**Contexte** : Le LLM peut produire un `write_file` ou `replace_code` incorrect. La récupération doit être possible sans git.
**Décision** : `write_file` et `replace_code` appellent `backup.snapshot(absPath)` avant d'agir. L'outil `restore_file` expose la récupération à l'agent lui-même.
**Conséquences** : Toute écriture est réversible. L'agent peut s'auto-corriger via `restore_file` si le résultat est mauvais.
**Alternatives rejetées** : Compter sur git — le projet cible peut ne pas être un repo git.

---

## ADR-004 : Clés API via safeStorage + config.js, jamais en dur

**Date** : 2026-10-16 (Phase 5)
**Contexte** : Les clés API (Gemini, Anthropic, OpenAI-compat) ne doivent jamais apparaître dans les logs, les crashdumps ou le code source.
**Décision** : `safe-keys.js` chiffre avec `safeStorage` Electron (AES lié au profil OS). `config.js` résout les clés au chargement. Jamais de clé en clair dans le code, jamais dans les logs via `logger.js`.
**Conséquences** : Les clés sont illisibles sur disque. Comportement variable selon install Electron (testé en Phase 1 — voir point de vigilance dans CLAUDE.md).
**Alternatives rejetées** : `.env` fichier — lisible en clair, commitable par erreur. Variables d'environnement OS — non portable entre sessions utilisateur.

---

## ADR-005 : CommonJS dans main/ et harness/, ESM dans renderer-hidden/

**Date** : 2026-10-15 (Phase 1)
**Contexte** : WebLLM (`@mlc-ai/web-llm`) est un module ESM pur. Node.js 20 + Electron 30 supportent les deux, mais pas le mélange sans précaution.
**Décision** : `src/main/` et `src/harness/` restent CommonJS (`require`). `src/renderer-hidden/` est ESM pur (WebLLM). `engines/cpu.js` utilise `import()` dynamique pour charger `node-llama-cpp` (ESM) depuis CJS.
**Conséquences** : Pas de migration globale à ESM. Le renderer hidden reste isolé. L'import dynamique dans `cpu.js` est le seul point de mélange CJS/ESM.
**Alternatives rejetées** : Migration complète à ESM — risque de casser les tests `node --test` et la compatibilité Electron sans gain fonctionnel immédiat.

---

## ADR-006 : `enableShell = false` par défaut

**Date** : 2026-10-18 (Phase 70, correctif sécurité)
**Contexte** : `run_shell` et `browserEvaluate` donnent accès au shell système. Activés par défaut, ils représentent un vecteur d'exécution arbitraire si le LLM est compromis ou produit du contenu malveillant.
**Décision** : `config.js` initialise `enableShell: false`. `run_shell` et `browserEvaluate` vérifient `config.enableShell === true` avant d'agir. L'utilisateur active explicitement dans les paramètres.
**Conséquences** : L'agent est en mode lecture/écriture FS uniquement par défaut. Shell disponible uniquement après consentement explicite.
**Alternatives rejetées** : Whitelist de commandes seule — insuffisante face aux injections via arguments.

---

## ADR-007 : Séparation renderer-settings (BrowserWindow isolée)

**Date** : 2026-10-18 (Phase 75)
**Contexte** : Le dialog paramètres inline (`<dialog>`) dans le renderer principal créait des conflits de hoisting JS, une race condition sur le thème (optimistic update impossible), et ~350 lignes de code mélangées avec la logique chat.
**Décision** : Les paramètres sont une `BrowserWindow` Electron séparée avec son propre preload (`preload-settings.js`) et son propre renderer (`renderer-settings/`). Singleton : focus si déjà ouverte. `CONFIG_UPDATED` broadcasté à tous les renderers après chaque save.
**Conséquences** : Isolation complète de la logique paramètres. Optimistic update possible (Object.assign AVANT await). La fenêtre principale reçoit les changements via `onConfigUpdated` sans rechargement.
**Alternatives rejetées** : Dialog HTML inline — trop de couplage avec l'état du chat. iframe isolée — même process, pas de vrai isolation IPC.

---

## ADR-008 : Serveur MCP sans SDK externe

**Date** : 2026-10-17 (Phase 33)
**Contexte** : Les SDKs MCP officiels ajoutent des dépendances significatives et un niveau d'abstraction qui complique le debug. Le protocole MCP (JSON-RPC 2.0 sur stdio) est suffisamment simple pour être implémenté directement.
**Décision** : `src/mcp-server/server.js` implémente JSON-RPC 2.0 sur stdin/stdout sans dépendance externe. Protocole MCP version 2024-11-05. 16 outils exposés via `tool-schemas.js`.
**Conséquences** : Zéro dépendance supplémentaire. Debug direct dans le code. À maintenir si le protocole MCP évolue.
**Alternatives rejetées** : `@modelcontextprotocol/sdk` — overhead de dépendance pour un protocole stable qu'on maîtrise.

---

## ADR-009 : RAG bag-of-words TF sans dépendance ML

**Date** : 2026-10-16 (Phase 4)
**Contexte** : Le RAG sémantique (embeddings réels) nécessite `@xenova/transformers` ou un appel API, ajoutant ~500 MB ou une latence réseau à chaque indexation.
**Décision** : `embedder.js` implémente un vecteur TF (term frequency) normalisé. Similarité cosinus dans `store.js`. Fallback silencieux si `@xenova` est absent.
**Conséquences** : RAG fonctionnel sans téléchargement de modèle. Qualité de retrieval inférieure aux embeddings réels — acceptable pour des fichiers de code structuré où les mots-clés dominent la sémantique.
**Alternatives rejetées** : Embeddings via API Gemini/OpenAI — latence et coût à chaque indexation. `@xenova/transformers` — 500 MB de dépendance pour un gain marginal sur du code.

---

## ADR-010 : `replace_code` normalise CRLF avant comparaison

**Date** : 2026-10-16 (Phase 2, point de vigilance critique)
**Contexte** : Sur Windows, les fichiers peuvent avoir des fins de ligne CRLF (`\r\n`). Le LLM génère des blocs avec LF (`\n`). La correspondance exacte échoue silencieusement si la normalisation n'est pas faite.
**Décision** : `replace_code` normalise le contenu du fichier ET le bloc `old_content` en LF avant comparaison. L'écriture préserve les fins de ligne du fichier original.
**Conséquences** : `replace_code` est robuste sur Windows. Aucune perte de fins de ligne lors de l'écriture.
**Alternatives rejetées** : Normalisation côté LLM (dans le prompt) — non fiable sur les petits modèles.

---

## ADR-011 : `node --test` sans Jest ni Mocha

**Date** : 2026-10-15 (Phase 1)
**Contexte** : Jest et Mocha ajoutent des dépendances et un runner externe. Node.js 20 LTS inclut un test runner natif suffisant pour les besoins du projet.
**Décision** : Tous les tests utilisent `node --test` (stdlib). Commande : `npm test` → `node --test tests/*.test.js`.
**Conséquences** : Zéro dépendance test externe. Syntaxe `describe`/`it`/`assert` native Node. Compatible avec les mocks via injection de paramètres (pas de `jest.mock`).
**Alternatives rejetées** : Jest — overhead de configuration, transformation Babel non nécessaire. Mocha — dépendance supplémentaire sans gain sur ce projet.

---

## ADR-012 : `backgroundThrottling: false` sur le renderer hidden

**Date** : 2026-10-18 (Phase 79, point de vigilance critique)
**Contexte** : Electron throttle les renderers en arrière-plan par défaut. WebLLM génère dans le renderer hidden — si ce renderer est throttlé, la génération s'arrête ou ralentit massivement.
**Décision** : La fenêtre cachée (`llm.html`) est créée avec `backgroundThrottling: false` dans ses `webPreferences`.
**Conséquences** : La génération WebLLM est fluide même si la fenêtre principale est au premier plan.
**Alternatives rejetées** : Garder le renderer visible — expose l'UI WebLLM à l'utilisateur, complexifie l'architecture.

---

## ADR-014 : Renommage Sham.md → AGENTS.md + structure imposée

**Date** : 2026-10-20
**Contexte** : Le fichier guide projet s'appelait "Sham.md" — nom cryptique sans signification évidente. Les utilisateurs ne savaient pas quoi y mettre (format libre). L'industrie converge vers `AGENTS.md` (OpenAI) comme standard émergent.
**Décision** :
1. Renommer en `AGENTS.md` (candidats de fallback : `agents.md`, `Sham.md`, `SHAM.md` pour les projets existants).
2. Le LLM reçoit un template structuré (`## Stack`, `## Conventions critiques`, `## Ce qu'il ne faut jamais modifier`, `## Pièges connus`) à utiliser lors de la création.
3. L'injection conditionnelle par section (point C de la recommandation) est reportée — trop complexe pour une session unique.
**Conséquences** : Nom auto-descriptif, aligné avec l'industrie. Template guide la qualité du contenu. Projets existants avec `Sham.md` continuent de fonctionner via les candidats de fallback.
**Alternatives rejetées** : `.cursorrules` (trop lié à Cursor), `CLAUDE.md` dans le projet cible (confusion avec le CLAUDE.md du harness lui-même).

---

## ADR-017 : Suppression des fournisseurs vidéo/image câblés en dur — tout passe par customProviders

**Date** : 2026-10-23
**Contexte** : Les fournisseurs vidéo (Runway, Luma, Stability) et image (DALL-E, Flux, Stability) étaient câblés en dur dans les outils et dans les paramètres avec des champs de clé API dédiés. Cette approche rendait difficile l'ajout de nouveaux modèles sans modifier le code. Les modèles évoluent rapidement.
**Décision** : Suppression de `videoProviders` et `imageProviders` de config. Tout fournisseur vidéo/image est désormais enregistré via `customProviders` (nom + baseUrl + clé API), exactement comme le moteur LLM. Les outils `generate_video` et `generate_image` utilisent uniquement l'API générique OpenAI-compatible. L'utilisateur choisit son fournisseur en configurant un customProvider.
**Conséquences** : Runway natif (format propriétaire) et Flux (fal.ai) ne sont plus utilisables directement — l'utilisateur doit trouver un proxy OpenAI-compatible ou attendre que ces providers exposent un endpoint standard. DALL-E reste compatible via `baseUrl: https://api.openai.com/v1`. L'ajout de nouveaux fournisseurs ne nécessite plus de modification du code.
**Alternatives rejetées** : Garder les implémentations natives ET ajouter customProviders — dette technique croissante, deux systèmes à maintenir.

---

## ADR-015 : Améliorations multi-agent — spawn parallèle, bus partagé, modified files (Phase 85)

**Date** : 2026-10-22 (Phase 85)
**Contexte** : Le système multi-agent (spawn_agent, message-bus) était fonctionnel mais séquentiel seulement, avec maxSteps hardcodé à 15 et sans retour des fichiers modifiés par le sous-agent.
**Décision** : 5 améliorations ciblées — (1) spawn.js retourne modifiedFiles, (2) maxSteps configurable par profil dans profiles.js, (3) visibilité UI des fichiers modifiés dans la card finalisée, (4) outil spawn_parallel pour lancer N sous-agents en Promise.all avec bus partagé automatique, (5) bus auto-créé dans spawn_parallel si pas déjà actif.
**Conséquences** : L'agent peut déléguer des tâches indépendantes en parallèle. Le résultat d'un sous-agent inclut la liste des fichiers qu'il a modifiés, visible dans l'UI. Chaque profil peut adapter son budget d'étapes.
**Alternatives rejetées** : Spawn parallèle via threads Worker — complexité inutile, le harness est I/O-bound et les sous-agents partagent le même LLM séquentiel de toute façon.

---

## ADR-013 : Briefing obligatoire avant toute exécution (Phase 67)

**Date** : 2026-10-18 (Phase 67)
**Contexte** : Les utilisateurs ne comprennent pas ce que l'agent va faire avant qu'il le fasse. Mauvaises surprises fréquentes sur les projets non familiers.
**Décision** : L'outil `plan` est obligatoire comme première action dans TOUS les modes (Action et Plan). La première réponse reformule la demande + annonce la suite en langage simple. Le briefing est affiché dans le chat avant que le travail démarre.
**Conséquences** : L'utilisateur lit toujours la compréhension de l'agent avant exécution. Coût : 1 étape supplémentaire par tâche.
**Alternatives rejetées** : Briefing optionnel — oublié par le LLM sur les petits modèles. Briefing en texte libre sans outil structuré — non parseable, non affichable dans l'UI.


## ADR-016 : Exemples rapides de prompts vidéo/image (Phase 93)

**Date** : 2026-10-23 (Phase 93)
**Contexte** : Les outils generate_video et generate_image requièrent des prompts structurés (provider, ratio, durée…). L'utilisateur voulait des exemples cliquables pour se lancer sans connaître la syntaxe.
**Décision** : Deux listes d'exemples gérées dans les Paramètres > Agent (après les clés API), stockées en config (videoPromptExamples / imagePromptExamples). Dans l'interface principale, des chips cliquables apparaissent au-dessus de la saisie quand elle est vide et focalisée — un clic pré-remplit le champ. Des exemples par défaut sont fournis dans DEFAULTS.
**Conséquences** : Onboarding amélioré pour les outils multimédia. L'utilisateur peut personnaliser librement sa liste. Zéro impact sur le harness (données pures de présentation).
**Alternatives rejetées** : Tooltip/aide contextuelle — non actionnable, l'utilisateur doit quand même saisir. Exemples hardcodés non éditables — trop rigides, chaque projet a ses conventions de prompt.

## ADR-018 : Sélection dynamique du catalogue d'outils (Phase 95)

**Date** : 2026-10-23 (Phase 95)
**Contexte** : Le prompt système portait les 72 descriptions d'outils à chaque étape — 12 189 caractères, 32 % du prompt (mesuré). Une tâche donnée en mobilise trois à six. Sur un modèle 3B, chaque option supplémentaire est une occasion d'erreur de sélection, et le contexte utile est plafonné par ce catalogue.
**Décision** : Le catalogue est filtré par familles (`src/harness/tools/families.js`, ADR-018) : noyau toujours présent (plan, read/write/replace, list_dir, search_grep, run_tests, get_project_info, scratchpad, ask_user, note_user, finish), familles bon marché toujours présentes quand elles sont autorisées (édition, recherche, LSP), familles lourdes chargées sur déclencheurs textuels (exécution, web, navigateur, git, média, agents, configuration). Le catalogue complet reste en mémoire : un outil non listé reste **appelable** (le dispatch ne change pas), et un nom inventé produit désormais `OUTIL_INCONNU — familles disponibles : …`. Pas de filtrage pour les sous-agents (liste déjà curatée par profil) ni pour les tâches planifiées (aucun utilisateur pour corriger). Échappatoire : `config.dynamicTools = false`.
**Conséquences** : Prompt système mesuré 21 843 → 16 230 caractères sur une tâche de correction (−26 %), 22 outils exposés au lieu de 54 (selon configuration). Aucune régression : 1051 tests, eval 14/14. Limite assumée : la sélection dépend de mots-clés, donc un outil utile peut manquer ; il reste appelable et l'erreur guide le modèle.
**Alternatives rejetées** : Outil-méta `list_tools` avec reconstruction du prompt système en cours de boucle — casse le cache KV du moteur et complique la fenêtre glissante. Filtrage sémantique par embeddings — dépendance et latence pour un gain marginal face à des déclencheurs lexicaux. Conserver 72 outils en améliorant seulement les descriptions — ne règle pas la dilution de l'attention.

## ADR-019 : Contrat de sortie vérifiable — preuves de finish et validation d'arguments (Phase 96)

**Date** : 2026-10-23 (Phase 96)
**Contexte** : `finish` était purement déclaratif : le modèle pouvait terminer sans avoir relu le fichier écrit ni lancé les tests, ce qui produit le « il a fini mais ça ne marche pas ». Par ailleurs, un appel incomplet (`read_file` sans `path`) remontait l'erreur de l'implémentation (`readFileSync` sur `undefined`), incompréhensible pour un petit modèle, qui répétait la même erreur.
**Décision** : (1) `finish` accepte un tableau `checks` (`{kind:'file',path}` ou `{kind:'test',command,result}`) ; quand des fichiers ont été modifiés et qu'aucune vérification ne les couvre, l'agent relance **une seule fois** le modèle avec un exemple, puis accepte s'il insiste. (2) `tools/validate.js` valide les champs obligatoires de 29 outils avant `dispatch` et renvoie `ARGUMENT_MANQUANT` / `ARGUMENT_TYPE` avec un exemple JSON. (3) Le nudge `run_tests` n'est émis que si un runner de tests est détecté dans le projet.
**Conséquences** : La terminaison devient vérifiable et l'échec de forme devient corrigeable en un aller-retour. Coût : au plus une étape supplémentaire par tâche qui écrit, et aucune pour une tâche de lecture. Les schémas sont volontairement partiels (champs réellement obligatoires uniquement) pour ne pas refuser des appels légitimes.
**Alternatives rejetées** : Bloquer le finish jusqu'à preuve complète — boucle infinie sur un modèle qui n'obéit pas ; le renudge unique garde la main à l'utilisateur. Schémas JSON complets sur les 72 outils — maintenance lourde et faux positifs (ex. `browser_click` sélecteur *ou* coordonnées). Validation dans chaque outil plutôt que dans `dispatch` — 72 points d'oubli au lieu d'un.

## ADR-020 : État de tâche reconstruit depuis la trace (Phase 97)

**Date** : 2026-10-23 (Phase 97)
**Contexte** : au-delà de 26 messages, la fenêtre glissante supprimait les messages anciens en laissant une note « relis les fichiers dont tu as besoin ». Sur une tâche longue, cela faisait perdre le plan validé, la liste des fichiers déjà lus et modifiés, et le dernier échec rencontré — le modèle relisait tout, ou pire, modifiait un fichier qu'il n'avait plus en tête.
**Décision** : l'agent reconstruit un **état de tâche** à partir de la seule trace (aucun appel LLM) : objectif du plan, fichiers lus, fichiers modifiés (avec mention « non relu » tant qu'aucune relecture n'a suivi), dernier échec, progression. Il est exploité à deux endroits : un rappel compact (~120 car.) ajouté au compteur d'étapes de chaque itération, et un bloc complet injecté dans la note de compaction de la fenêtre glissante. Le message d'omission ne dit plus « relis tout » mais « utilise l'état ci-dessous plutôt que de tout relire ».
**Conséquences** : l'information utile survit à la compaction sans coût de génération et sans changer le format des messages (pas de message système supplémentaire, donc aucun risque sur les conversions Gemini/Claude). Le rappel reste borné (3 fichiers + compteurs). Limite : l'état ne connaît que ce que la trace contient ; le contenu des fichiers relus reste à redemander.
**Alternatives rejetées** : Message système additionnel mis à jour à chaque étape — deux messages système cassent la conversion de certains moteurs et le cache KV. Scratchpad obligatoire — dépend de la discipline du modèle, et un petit modèle l'oublie. Résumé par le LLM à la compaction — coût, latence et non-déterminisme pour une information déjà disponible dans la trace.

## ADR-021 : Contexte de la session précédente dans la tâche (Phase 98)

**Date** : 2026-10-23 (Phase 98)
**Contexte** : au second tour sur un même projet, l'agent ne savait rien de ce que le premier avait fait. La seule mémoire transmise était trois échanges résumés et tronqués (400/600 car.), sans la liste des fichiers modifiés : le modèle relisait tout, ou repartait d'hypothèses périmées. Les données existaient pourtant dans les sessions persistées (`steps` = trace complète).
**Décision** : avant chaque tâche, le renderer récupère la dernière session terminée du même `projectRoot` (`listSessions` puis `getSession`), en extrait un bloc « ÉTAT DE LA SESSION PRÉCÉDENTE » (dernier résultat, fichiers modifiés — dédupliqués, écritures échouées ignorées —, nombre de fichiers lus) plafonné à 700 caractères, et le préfixe à la tâche envoyée au harness. Aucun changement de contrat côté harness : c'est le même canal `agent:run`.
**Conséquences** : le second tour part d'un état factuel au lieu d'un résumé. Coût : un aller-retour IPC par tâche (lecture de session), non bloquant pour l'affichage. Limite : le bloc ne contient pas le contenu des fichiers, seulement leurs chemins — l'agent doit relire ce qu'il veut modifier.
**Alternatives rejetées** : Passer le contexte par le harness (charger la session dans `runAgent`) — duplique une logique d'UI et couple le harness au stockage de sessions. Envoyer la trace complète — des milliers de caractères pour un gain nul (les chemins suffisent). Résumé par le LLM à chaque tour — coût et latence pour une information déjà déterministe.

## ADR-022 : Plan révisable une seule fois après lecture (Phase 99)

**Date** : 2026-10-23 (Phase 99)
**Contexte** : le plan est produit avant toute lecture (règle 4 : « utilise plan si écriture et ≥ 3 étapes »), donc il devine le contenu des fichiers. C'est pourtant ce plan que l'utilisateur valide : un plan faux est approuvé puis contredit à l'étape 2. Le corriger imposait de sortir du flux (relancer la tâche).
**Décision** : le modèle peut rappeler `plan` **une seule fois** après ses lectures, avec `"revised": true` et des étapes qui nomment les fichiers visés. Le plan révisé porte `revised: true` (événement `plan_ready`), l'UI remplace le bandeau épinglé et ajoute la carte corrigée dans le fil. Un troisième appel est refusé par `_executePlan` (`PLAN_DEJA_RÉVISÉ`) via un compteur porté par la config.
**Conséquences** : un plan peut être corrigé sans quitter la tâche, et la boucle ne peut pas se transformer en ping-pong de planification. Coût : au plus une étape supplémentaire, et seulement si le modèle juge son plan faux.
**Alternatives rejetées** : Plan produit après lecture (variante dure) — change l'ordre validé en Phase 67 et le rôle de briefing avant exécution. Révision illimitée — observée comme une boucle sur les petits modèles. Révision implicite sans marqueur — impossible à distinguer d'un second plan erroné dans l'UI.

## ADR-023 : Classement RAG par IDF + mots vides français (Phase 100)

**Date** : 2026-10-23 (Phase 100)
**Contexte** : après le passage à une dimension fixe, la similarité était calculée mais le classement restait fruste : sans IDF, un mot présent partout pesait autant qu'un terme rare, et les mots interrogatifs français (« que », « où », « dans », « comment ») n'étaient pas filtrés. Mesure : sur la question « Que fait padLabel() ? », `README.md` sortait premier avec 0,22 devant `src/format.js` à 0,10, simplement parce qu'il partageait « que » et « dans ».
**Décision** : deux compléments dans le même encodage. (1) `embedder.js` filtre désormais les mots de liaison et interrogatifs français (le vocabulaire de code est conservé). (2) `store.js` pondère la similarité cosinus par l'IDF calculé sur le corpus, avec un tableau de poids précalculé par dimension (256 valeurs) pour éviter un appel de `Map` par composante. `EMBEDDER_VERSION` passe à 3 : les index existants sont réindexés.
**Conséquences** : le fichier qui contient la réponse passe devant le document qui partage des mots de liaison (mesuré : `src/format.js` 0,22 / `README.md` 0,00). Coût : un parcours du corpus par recherche (≈ 865 chunks × 256 dimensions sur ce dépôt, quelques millisecondes), fait en mémoire sur les données déjà chargées.
**Alternatives rejetées** : IDF persisté dans le store — invalide dès qu'un fichier change, et pèse en écriture. Stockage des termes bruts par chunk (vrai BM25) — change le format du store et double sa taille ; à reconsidérer si le RAG doit passer à l'échelle. Embeddings neuronaux — dépendance et coût GPU pour un gain non démontré sur des requêtes courtes en français.

## ADR-024 : Profils de prompt selon le moteur (Phase 101)

**Date** : 2026-10-23 (Phase 101)
**Contexte** : le même prompt système part pour tous les moteurs — 11 règles, 4 protocoles (TDD, bus, shell, configuration), des standards de qualité et des exemples de résumé. Un Qwen2.5-Coder-3B ne peut pas tenir autant de consignes simultanées : l'adhérence se dégrade avant même la fenêtre de contexte. À l'inverse, retirer ces sections pour un modèle cloud serait une perte nette.
**Décision** : deux profils (`src/harness/prompts/profile.js`). `standard` — le prompt actuel, inchangé. `minimal` — retire cinq sections optionnelles (standards de qualité, exemple de résumé, directives de configuration, `note_user`, `ask_user` détaillé) et limite les exemples few-shot à trois blocs communs + un exemple de langage. Le profil est déduit du moteur et du modèle (`webllm`/`cpu` + 1B–3B → `minimal`, sinon `standard`), avec une échappatoire explicite `config.promptProfile`. Le retrait se fait par paires d'ancres (`_dropSection`) : si une ancre disparaît lors d'une modification future, la section est conservée, jamais corrompue.
**Conséquences** : prompt mesuré 16 431 → **12 177 caractères (−26 %)** sur une tâche de correction, sections optionnelles effectivement absentes, règles non négociables / format JSON / catalogue / AGENTS.md conservés. Le prompt `standard` reste identique au caractère près (empreinte inchangée), donc aucune régression pour les modèles cloud.
**Alternatives rejetées** : Trois profils (small/mid/full) — le profil `mid` n'apportait rien de mesurable entre 7B et cloud, et multipliait les chemins de test. Prompt entièrement distinct par moteur — duplication de maintenance. Reconstruction du prompt par blocs nommés — refonte complète de `system.js` pour un gain identique, avec un risque de divergence entre les deux profils.

---

## ADR-025 : Graphe de dépendances statique import/export (Phase 103)

**Date** : 2026-10-24 (Phase 103)
**Contexte** : L'agent n'avait aucune visibilité sur les relations d'importation entre fichiers. Sur un grand projet, il ne savait pas quels fichiers seraient impactés par une modification, ni ce qu'un fichier cible importait. Il relisait tout ou devinait — source d'erreurs sur les tâches transversales.
**Décision** : `src/harness/context/depgraph.js` (NOUVEAU) — graphe incrémental par regex (relatifs uniquement, JS/TS/JSX/MJS/CJS/Python). SHA1 par fichier, persisté dans `.harness/depgraph.json` (version 2). `src/harness/tools/depgraph-tool.js` (NOUVEAU) — deux outils : `find_dependents` (qui importe ce fichier ?) et `find_dependencies` (ce fichier importe quoi ?), BFS optionnel profondeur 4 max. `context/builder.js` enrichit automatiquement le contexte du fichier cible avec ses importeurs et ses dépendances directes. Les deux outils sont dans la famille `recherche`, toujours exposés.
**Conséquences** : L'agent connaît la zone d'impact avant toute modification. La liste des fichiers importeurs est injectée dans le prompt à chaque tâche si un fichier cible est identifié. Zéro dépendance npm supplémentaire. 1076/1076 tests verts.
**Alternatives rejetées** : tree-sitter (binaires natifs, compilation node-gyp sur Windows peu fiable en CI) ; TypeScript Compiler API (JS/TS uniquement, 50 Mo de dépendances, démarrage lent) ; LSP workspace/symbol (nécessite un serveur LSP démarré, opt-in uniquement — le LSP reste disponible séparément via `enableLsp`).

---

## ADR-027 : Chunking sémantique par frontières de déclarations (Phase 106)

**Date** : 2026-10-24 (Phase 106)
**Contexte** : Le RAG découpait les fichiers à 60 lignes fixes avec 15 lignes d'overlap. Une fonction étendue sur 30 lignes à partir de la ligne 50 était tronquée : le chunk 0-60 contenait la moitié du code, le chunk 45-105 l'autre moitié. Aucun des deux ne donnait un contexte complet au LLM, et leur embedding reflétait une sémantique incomplète.
**Décision** : `_findBoundaries(lines, ext)` détecte les débuts de déclarations de haut niveau en JS/TS (col 0 : `function`, `class`, `const/let/var = function/arrow`) et Python (`def`, `class`). `chunkFile` découpe par ces frontières : chaque chunk = une unité sémantique entière. Sous-découpage automatique si la déclaration est trop longue. Fallback sur le découpage fixe (60l + overlap 15) si aucune frontière trouvée (JSON, Markdown, etc.). `CHUNKER_VERSION = 1` ajouté dans le storeId pour invalider les stores existants.
**Conséquences** : Les chunks contiennent des fonctions/classes complètes → embeddings plus cohérents → RAG plus précis sur les tâches de code. Les fichiers non-code conservent le découpage fixe éprouvé. 1130/1130 tests verts.
**Alternatives rejetées** : tree-sitter (binaires natifs, CI fragile) ; LSP symbol indexing (opt-in, demande un serveur lancé) ; overlap seul sans frontières (améliore le recall mais pas la précision sémantique).

---

## ADR-026 : Mémoire sémantique persistante inter-sessions (`project_note`)

**Date** : 2026-10-24 (Phase 105)
**Contexte** : Le scratchpad (`scratchpad`) est in-memory et disparaît à la fin de chaque session. L'agent ne pouvait pas mémoriser des décisions d'architecture, des conventions spécifiques au projet, des endpoints ou des règles stables — il les redécouvrait à chaque session en relisant des fichiers ou en posant des questions.
**Décision** : `src/harness/memory/project-notes.js` (NOUVEAU) — store clé/valeur persisté dans `.harness/project-notes.json`. TTL 90 jours, plafond 100 notes, pas d'embeddings : la pertinence est calculée par overlap de tokens (suffisant pour des notes courtes). `src/harness/tools/project-notes-tool.js` (NOUVEAU) — outil `project_note` avec actions set/get/list/delete/search. Ajouté dans CORE (toujours exposé). `context/builder.js` injecte automatiquement les notes pertinentes dans le contexte via `getRelevantNotes`. `context/trimmer.js` ajoute le type `notes` (share 10 %).
**Conséquences** : L'agent peut mémoriser et retrouver des informations stables sans relire les fichiers. Les notes les plus pertinentes apparaissent automatiquement dans le contexte. 1109/1109 tests verts.
**Alternatives rejetées** : embeddings vectoriels (coût CPU, dépendance, over-engineering pour des notes courtes) ; fichier texte libre (pas interrogeable programmatiquement) ; extension du scratchpad (in-memory, cycle de vie trop court).

---

## ADR-028 : Dictée vocale — Whisper local (Transformers.js) + condensé LLM (Phase 113)

**Date** : 2026-10-24 (Phase 113)
**Contexte** : saisir une tâche à la voix, comme chez les concurrents, avec des composants libres. Contraintes : pas de service payant, fonctionnement hors-ligne après le premier téléchargement, respect des règles d'architecture (harness sans Electron, aucun accès disque côté renderers, aucune clé API).
**Décision** : `@huggingface/transformers` (Apache-2.0) + modèle `onnx-community/whisper-base` (MIT), exécutés en WASM dans une fenêtre cachée dédiée (`src/renderer-voice/`), créée **à la demande** (`getVoiceWindow()`) — un utilisateur qui n'active pas la fonction ne charge rien. Parcours : clic micro (`MediaRecorder`) → clic d'arrêt → audio envoyé par IPC `voice:transcribe` → Whisper transcrit → `condenseDictation()` (harness, `llmGenerate` injecté) reformule en gardant l'idée principale → texte inséré dans le champ, jamais envoyé automatiquement. Activation par `config.voiceEnabled` (défaut `false`, interrupteur dans Paramètres → Agent). Dictées < 40 caractères : pas d'appel LLM. LLM en erreur ou réponse vide : repli sur la transcription brute.
**Conséquences** : le modèle (~75 Mo) est téléchargé une fois au premier usage (progression relayée à l'UI) puis servi par le cache. Mesuré en Electron : phrase de 17 s transcrite à l'identique en 17 s (modèle en cache). `onnxruntime-node` et `sharp` (~290 Mo, natifs) sont exclus du paquet (`electron-builder.yml`) car inutiles en WASM. On importe `dist/transformers.min.js` (autonome) : le build `transformers.web.js` contient un import nu `onnxruntime-web/webgpu` invalide en `file://`. WASM mono-thread (`file://` n'est pas cross-origin isolated). Langue fixée d'après la langue de l'UI (Whisper détecte mal sur phrase courte ; une langue forcée ≠ langue parlée fait boucler le modèle).
**Alternatives rejetées** : `webkitSpeechRecognition` (ne fonctionne pas dans Electron sans clés Google, audio envoyé à Google) ; whisper.cpp binaire/natif (empaquetage Windows plus lourd) ; Vosk (précision française insuffisante sur le vocabulaire technique) ; API OpenAI/Gemini (payant, non libre) ; chargement via CDN comme WebLLM (exige une connexion au premier lancement).
