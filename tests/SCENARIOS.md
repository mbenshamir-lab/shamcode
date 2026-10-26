# SCENARIOS — Catalogue des cas limites à couvrir

> Rédigé en langage naturel. L'agent transforme ces scénarios en tests `node --test`.
> Chaque scénario = une entrée dans un fichier de test dédié (ne pas éparpiller dans les tests existants).
> Convention de nommage : `tests/scenarios-<module>.test.js`
>
> **Avant d'écrire un test** : vérifier qu'il n'existe pas déjà dans `tests/`.
> Un scénario marqué ✅ est déjà couvert. Un scénario marqué ❌ est un vrai manque.

---

## 1. Parser (`src/harness/parser.js`)

### Déjà couverts ✅
- JSON valide direct
- JSON dans fences markdown ` ```json ` et ` ``` `
- JSON avec texte avant/après
- Virgules traînantes réparées
- JSON tronqué → `JSON_INVALIDE`
- Objet sans `tool` → `OUTIL_MANQUANT`
- `args` absent → defaults à `{}`
- Chaîne vide → `VIDE`

### Manquants ❌

**Scénario 1.1 — Vrais sauts de ligne dans les valeurs de string JSON (petits modèles < 3B)**
Un modèle < 3B émet parfois des vrais `\n` à l'intérieur d'une string JSON au lieu de `\\n`.
Exemple : `{"tool":"write_file","args":{"path":"a.js","content":"ligne1\nligne2"}}` où `\n` est un vrai saut de ligne.
→ Attendu : le parser répare et retourne `{ tool: 'write_file', args: { path: 'a.js', content: 'ligne1\nligne2' } }`

**Scénario 1.2 — CRLF dans les valeurs de string**
Même cas avec `\r\n` réels (Windows). Le parser doit les traiter identiquement.
→ Attendu : parse réussi, `\r\n` normalisé en `\n` dans le contenu extrait.

**Scénario 1.3 — JSON enfoui loin dans une longue réponse**
Le LLM produit 500 caractères de raisonnement puis le JSON à la fin.
→ Attendu : `extractToolCall` trouve quand même le JSON et retourne le tool call correct.

**Scénario 1.4 — Plusieurs blocs JSON dans la même réponse**
Le LLM produit deux tool calls sur deux lignes. Le parser doit prendre le premier `{...}` et ignorer le reste.
→ Attendu : retourne le premier tool call uniquement, pas d'erreur.

**Scénario 1.5 — `intent` borné à 300 caractères**
Un `intent` de 500 caractères dans la réponse du LLM.
→ Attendu : `intent` retourné fait exactement 300 caractères, pas plus.

**Scénario 1.6 — `intent` non-textuel (nombre, tableau) ignoré**
`{"tool":"read_file","args":{"path":"a.js"},"intent":42}` — `intent` est un nombre.
→ Attendu : `intent` absent du retour (ignoré silencieusement).

**Scénario 1.7 — `args` explicitement null → defaults à `{}`**
`{"tool":"finish","args":null}` — args est explicitement null.
→ Attendu : `args` retourné vaut `{}`, pas `null`.

---

## 2. Agent (`src/harness/agent.js`)

### Déjà couverts ✅
- Tâche simple → finish avec summary
- Retry sur JSON invalide puis succès
- Trace complète générée
- MAX_STEPS_ATTEINT si jamais finish
- Annulation via AbortSignal
- Erreur LLM → `LLM_ERREUR`
- Sous-agent ne crée pas de session
- Cache `read_file` invalidé après `write_file`
- Nudge VÉRIFICATION OBLIGATOIRE après `write_file` / `replace_code`
- Guidage `BLOC_INTROUVABLE`
- Budget warning ⚠️ à 5 étapes restantes
- `retryOnParseError: 2` → 3 générations avant abandon

### Manquants ❌

**Scénario 2.1 — LLM retourne un nom d'outil inconnu**
`{"tool":"outil_qui_nexiste_pas","args":{}}` — tool name non enregistré dans `dispatch()`.
→ Attendu : l'agent ne crash pas, émet un événement d'erreur, passe au step suivant (retry ou continue selon config), ne s'arrête pas abruptement.

**Scénario 2.2 — `retryOnParseError: 0` → aucun retry**
Config `retryOnParseError: 0`. Le LLM retourne du JSON invalide au premier appel.
→ Attendu : l'agent retourne immédiatement `{ ok: false, error: 'MAX_STEPS_ATTEINT' }` ou `LLM_ERREUR` sans retry.

**Scénario 2.3 — Événement `thinking` émis avant chaque génération**
Vérifier que chaque appel à `llmGenerate` est précédé d'un événement `{ type: 'thinking', step: N }`.
→ Attendu : `events.filter(e => e.type === 'thinking').length === nombre_de_générations`.

**Scénario 2.4 — Événement `context_usage` émis après chaque génération**
→ Attendu : chaque step contient un événement `{ type: 'context_usage', chars, estimatedTokens }` avec `estimatedTokens > 0`.

**Scénario 2.5 — Budget warning URGENT émis à 3 steps restants**
Config `maxSteps: 5`. L'agent tourne depuis 3 steps sans finish.
→ Attendu : à l'étape 3, un message URGENT apparaît dans les messages envoyés au LLM (vérifiable dans la trace ou les événements).

**Scénario 2.6 — Annulation en cours de génération (signal abort pendant llmGenerate)**
L'AbortController est déclenché pendant que `llmGenerate` est en cours d'exécution (pas avant).
→ Attendu : l'agent s'arrête proprement dès la fin de la génération courante, retourne `{ ok: false, error: 'ANNULÉ' }`.

**Scénario 2.7 — `disposeBrowser` appelé à la fin d'un agent qui a utilisé le navigateur**
Simuler un agent qui appelle `browser_open` puis `finish`.
→ Attendu : `disposeBrowser` est appelé exactement une fois lors du finish (libération des ressources).

---

## 3. Tools FS (`src/harness/tools/fs.js`) — Cas limites Windows critiques

### Déjà couverts ✅
- `write_file` crée le fichier et les dossiers parents
- `replace_code` bloc unique → OK
- `replace_code` bloc absent → `BLOC_INTROUVABLE` avec hint
- `replace_code` bloc ambigu → `BLOC_AMBIGU`
- `replace_code` fuzzy : espaces de fin de ligne → OK

### Manquants ❌

**Scénario 3.1 — `replace_code` : fichier CRLF, `old_string` en LF (cas critique Windows)**
Un fichier sur disque contient `\r\n` (CRLF — typique Windows).
Le LLM génère `old_string` avec `\n` (LF — ce que tout LLM produit).
→ Attendu : la correspondance réussit, `ok: true`. La normalisation CRLF→LF doit se faire avant comparaison.
→ Cas critique : c'est le scénario le plus fréquent sur Windows. S'il échoue, `replace_code` est inutilisable.

**Scénario 3.2 — `replace_code` : `new_string` préserve les fins de ligne du fichier original**
Fichier CRLF sur disque. `replace_code` réussit. Vérifier que le fichier résultant est toujours CRLF (pas converti en LF).
→ Attendu : le fichier sur disque après remplacement contient toujours `\r\n`.

**Scénario 3.3 — `read_file` d'un fichier binaire**
Un fichier `.png` ou `.exe` dans le projet est demandé par le LLM.
→ Attendu : retourne `{ ok: false, error: 'FICHIER_BINAIRE' }` ou un message clair. Ne crash pas, ne corrompt pas le contenu.

**Scénario 3.4 — `write_file` vers un chemin de 0 caractères**
`{"tool":"write_file","args":{"path":"","content":"test"}}` — chemin vide.
→ Attendu : `{ ok: false, error: ... }` — le guard ou la validation doit rejeter avant d'écrire.

**Scénario 3.5 — `backup.snapshot()` sur un fichier inexistant (première écriture)**
`write_file` vers un fichier qui n'existe pas encore. `backup.snapshot()` est appelé avant l'écriture.
→ Attendu : pas d'erreur du backup, le fichier est quand même créé correctement.

---

## 4. Router LLM (`src/harness/llm/router.js`)

### Déjà couverts ✅
- Primaire répond → résultat retourné
- Fallback si primaire down
- Tous KO → dernière erreur remontée
- Clé manquante → passe au fallback
- Moteur inconnu ignoré
- Crash réseau → passe au fallback

### Manquants ❌

**Scénario 4.1 — Primaire `isReady()` retourne false → fallback direct sans appel generate**
Le moteur primaire signale `isReady() === false`.
→ Attendu : `generate()` du primaire n'est jamais appelé, le fallback prend le relais immédiatement.

**Scénario 4.2 — `disposeAll()` libère toutes les instances créées**
Créer un router avec deux moteurs, déclencher une génération sur chacun, appeler `disposeAll()`.
→ Attendu : `dispose()` est appelé sur chaque instance qui a été instanciée. Zéro instance restante.

---

## 5. MCP (`src/harness/mcp/client.js` + `registry.js`)

### Déjà couverts ✅
- Découverte d'outils, normalisation réponse, `isError`
- `dispose()`, `tools/list` KO
- Registry ignore connecteurs off/sans URL
- Routing, outil inconnu, log erreur, dispose multi-clients

### Manquants ❌

**Scénario 5.1 — Connecteur stdio qui crash au démarrage**
Le process stdio du connecteur MCP exit immédiatement avec code 1.
→ Attendu : `McpRegistry` initialise sans lui et continue. L'erreur est loguée. Les autres connecteurs fonctionnent.

**Scénario 5.2 — `callTool` avec arguments manquants requis par le schema**
Un outil MCP exige un champ `path` dans son schema. Le LLM l'appelle sans ce champ.
→ Attendu : le registry retourne `{ ok: false, error: ... }` sans appeler le connecteur.
→ Note : ce scénario dépend de si la validation des args est dans le registry ou déléguée au serveur MCP.

---

## 6. Safety — backup (`src/harness/safety/backup.js`)

### Manquants ❌

**Scénario 6.1 — `restore` sur un fichier sans snapshot disponible**
Appeler `restoreFile` sur un fichier qui n'a jamais été modifié par l'agent (pas de backup).
→ Attendu : retourne `{ ok: false, error: 'BACKUP_INTROUVABLE' }` ou similaire. Ne crash pas.

**Scénario 6.2 — `snapshot` + `restore` round-trip complet**
Écrire un fichier, faire un snapshot, modifier le fichier, restaurer.
→ Attendu : le contenu restauré est identique au contenu avant modification.

---

## 7. Config / safeStorage (`src/main/safe-keys.js` + `src/main/config.js`)

### Manquants ❌

**Scénario 7.1 — Clé chiffrée corrompue → fallback base64**
`decryptKey()` reçoit une chaîne chiffrée corrompue (modifiée manuellement).
→ Attendu : le fallback base64 est tenté, ou une erreur propre est retournée. Pas de crash de l'app.

**Scénario 7.2 — `loadConfig()` sur config inexistante (première installation)**
Aucun fichier de config sur le disque.
→ Attendu : retourne une config avec les valeurs par défaut (notamment `enableShell: false`). Pas d'erreur.

**Scénario 7.3 — `enableShell: false` par défaut dans la config initiale**
Vérifier que la config retournée par `loadConfig()` avec un fichier vide a `enableShell: false`.
→ Attendu : `config.enableShell === false` même sans config écrite.

---

## 8. Intégration agent + tools (scénarios end-to-end)

Ces scénarios testent plusieurs couches ensemble. Utiliser `runAgent` avec un mock LLM.

**Scénario 8.1 — `replace_code` CRLF end-to-end via agent**
Fichier CRLF sur disque. L'agent appelle `replace_code` via un mock LLM avec `old_string` en LF.
→ Attendu : `runAgent` retourne `{ ok: true }`, le fichier est bien modifié.

**Scénario 8.2 — Outil inconnu retourné par le LLM → agent continue sans crash**
Séquence : step 1 = `{"tool":"outil_fantome","args":{}}`, step 2 = `{"tool":"finish","args":{"summary":"ok"}}`.
→ Attendu : `runAgent` retourne `{ ok: true, summary: 'ok' }`. Pas de crash sur l'outil inconnu.

**Scénario 8.3 — Lecture du fichier Sham au démarrage**
Un fichier `Sham.md` existe dans le `projectRoot`. L'agent est lancé.
→ Attendu : le contenu du Sham est injecté dans le prompt système (vérifiable via les messages envoyés au LLM ou via la trace).

**Scénario 8.4 — MAX_STEPS atteint avec événements complets**
`maxSteps: 2`. L'agent tourne 2 steps sans finish.
→ Attendu : les événements `tool_call` et `tool_result` sont bien émis pour chaque step AVANT que `MAX_STEPS_ATTEINT` soit retourné. Pas d'événements perdus.
