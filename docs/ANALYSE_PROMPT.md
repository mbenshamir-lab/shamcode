# Le mécanisme du prompt — analyse et optimisation

> Hypothèse de départ, énoncée par l'utilisateur : « un agent de code est efficace
> lorsqu'on lui fournit un prompt efficace ; il aura alors un bon retour ».
> Ce document teste cette hypothèse sur le code réel de ShamCode, mesure où le signal
> se perd entre l'intention humaine et le résultat, puis propose des optimisations
> classées par gain attendu. **Aucun code n'a été modifié** : les changements proposés
> touchent plusieurs modules et relèvent du processus de validation (`CLAUDE.md`).

---

## 0. Thèse, corrigée

L'hypothèse est vraie mais incomplète. Le résultat d'un agent ne dépend pas du prompt
de l'utilisateur seul, mais de **cinq grandeurs multiplicatives** :

```
résultat ≈ clarté de la tâche
         × pertinence du contexte injecté
         × précision du contrat de sortie (format, outils, définition de « fini »)
         × qualité de la boucle de vérification
         × budget disponible (étapes, tokens, fenêtre)
```

Un prompt parfait avec un contexte hors sujet donne zéro. Un prompt vague avec un
contexte exact et une boucle de vérification stricte donne souvent un bon résultat —
c'est précisément le travail du harness. **L'agent n'annule pas un mauvais prompt : il
l'amplifie.** D'où deux chantiers distincts, tous deux traités ici :

- **A. Le prompt côté machine** (prompt système, contexte, contrat, boucle) — 90 % du code.
- **B. Le prompt côté humain** (formuler la tâche) — traité en §6, car c'est là que
  l'utilisateur croit que tout se joue, et c'est le levier le moins coûteux à activer.

---

## 1. Le mécanisme réel, en six étages

Chaque étage peut **gagner** ou **perdre** du signal. Le résultat final est le produit
des six, pas la somme.

```
[A] Intention humaine
     │  « corrige le bug de login »
     ▼
[B] Habillage de la tâche ................. app.js:298-319
     │  + fichiers joints, + 3 derniers échanges tronqués (400/600 car.)
     ▼
[C] Contexte projet ...................... agent.js:283-294, context/builder.js
     │  arbre (3,6 k car.) + RAG top-5 (≈10,4 k car.) + AGENTS.md (≤4 k) + règles langage
     ▼
[D] Contrat système ...................... prompts/system.js (272 lignes)
     │  rôle, 11 règles, format JSON, plan, intent, AGENTS.md, catalogue de 72 outils
     ▼
[E] Boucle ............................... agent.js:373-585
     │  génération → parse → dispatch → résultat tronqué → nudge → génération…
     ▼
[F] Clôture .............................. agent.js:443-452, memory/sessions
     │  finish{summary} → session persistée → UI
     ▼
   Résultat affiché + fichiers modifiés
```

### Ce que chaque étage fait aujourd'hui (et son angle mort)

| Étage | Ce que le code fait | Angle mort |
|---|---|---|
| A | Rien : la tâche est passée telle quelle | Aucune reformulation, aucune demande de précision proactive |
| B | Concatène l'historique (3 échanges, résumés tronqués) et les fichiers joints | L'historique ne dit pas **quels fichiers ont été modifiés** ni **ce qui a échoué** |
| C | Arbre + RAG top-5 + AGENTS.md + règles langage, budget 12 000 car. | Le budget force un choix binaire RAG **ou** arbre (§3, F2) |
| D | 23 672 car. de prompt, dont 32 % de catalogue d'outils | 72 outils visibles en permanence ; 11 règles + 5 protocoles à respecter simultanément |
| E | Fenêtre glissante à 26 messages, troncature à 6 000 car., 2 retries de parse, 25 étapes | La compaction **supprime** au lieu de **résumer** ; la troncature est muette |
| F | `finish{summary}` libre | Aucune preuve de vérification exigée : « fini » est déclaratif |

---

## 2. Mesures (reproductibles)

Relevés sur ce dépôt, avec les modules réels (`system.js`, `agent.js`, `trimmer.js`,
`indexer.js`, `tree.js`).

| Mesure | Valeur | Source |
|---|---:|---|
| Outils déclarés | **72** | `shared/constants.js` → `TOOLS` |
| Texte du catalogue d'outils | **12 189 car.** | descriptions `allToolDefs` |
| Part du catalogue dans le prompt | **32 %** | `agent.js:251` + `system.js:32` |
| Instructions statiques (hors outils, hors contexte) | 10 958 car. | `system.js` |
| dont few-shot | 2 303 car. | `prompts/examples.js` |
| **Prompt système sans contexte** | **23 672 car. ≈ 5 900 tokens** | mesure |
| **Prompt système avec contexte 12 k + AGENTS 4 k** | **39 775 car. ≈ 9 900 tokens** | mesure |
| Arbre du projet (maxDepth 4, 150 entrées) | 3 673 car. (avec en-tête) | `context/tree.js` |
| Chunk RAG moyen (60 lignes) | 2 078 car. (médiane 2 013, p90 3 024) | `rag/indexer.js` |
| RAG top-5 typique | **≈ 10 400 car.** | 5 × 2 078 |
| Budget contexte par défaut | 12 000 car. | `context/builder.js:11` |
| Troncature d'un résultat d'outil | 6 000 car. | `agent.js:53` |
| Fenêtre glissante | 26 messages / 10 paires | `agent.js:54-55` |
| Étapes max | 25 | `constants.js` |
| Reprises de parse | 2 | `config.retryOnParseError` |
| Historique multi-tour | 3 échanges × 400/600 car. | `app.js:52-56` |

### Le résultat qui compte

Simulation du trimmer avec les valeurs mesurées :

| RAG disponible | Arbre | RAG | Budget utilisé |
|---|---|---|---:|
| 8 000 car. | gardé | gardé | 11 674 |
| 9 000 car. | **perdu** | gardé | 9 000 |
| 10 400 car. (top-5 typique) | **perdu** | gardé | 10 400 |
| 12 000 car. | **perdu** | gardé | 12 000 |
| 13 000 car. | gardé | **perdu** | **3 673** |

Deux conséquences, vérifiées et non théoriques :

1. **Le contexte est binaire** : au-delà de ~8 300 car. de RAG (soit 4 chunks moyens),
   l'arborescence disparaît — alors que la règle 5 du prompt dit « ne lis que les
   fichiers liés » et que l'agent s'appuie sur l'arbre pour naviguer. Cas typique :
   5 chunks ≈ 10 400 car. → arbre perdu.
2. **Quand le RAG dépasse 12 k, il est jeté en entier** et **69 % du budget reste
   inutilisé** (8 327 car. libres), avec un contexte réduit à un arbre de fichiers. Comme
   un chunk fait 2 078 car. en moyenne et que le top-5 peut inclure des chunks de 3 000 à
   11 481 car., ce cas n'est pas rare sur un projet réel.

**Corrigé le 2026-10-23 (levier L2).** Le trimmer alloue désormais une part du budget par
section (rag 70 %, tree 30 %, symbols 15 %) et **tronque sur une frontière de ligne** avec
un marqueur explicite, au lieu de jeter la section. Mesures après correctif sur ce dépôt
(arbre 3 673 car., chunks ~10 400 car.) :

| Budget | Avant | Après |
|---|---:|---:|
| 2 000 car. | **0** (tout jeté) | 1 933 car. (arbre + 1 extrait tronqué) |
| 4 000 car. | 3 673 car. (arbre seul) | 3 897 car. (les deux, tronqués) |
| 8 000 car. | 3 673 car. (arbre seul) | 7 926 car. (les deux, tronqués) |
| 24 000 car. | 10 315 car. (les deux, entiers) | 10 315 car. (inchangé) |

Les blocs de code coupés sont refermés (```), pour ne pas laisser une fence ouverte dans le
prompt. Un budget local a par ailleurs été défini par modèle (1B–3B : 4 000 ; 7B/14B et
moteur CPU : 8 000 ; cloud : réglage utilisateur) — auparavant, WebLLM recevait 2 000 et le
moteur CPU était traité comme un cloud.

---

## 3. Diagnostic : les onze fuites de signal

Classées par gravité décroissante. Chaque fuite indique où elle se produit et ce qu'elle
coûte.

### F1 — Le catalogue d'outils occupe 32 % du prompt

À chaque appel, le modèle lit 12 189 car. de descriptions pour 72 outils, alors qu'une
tâche donnée en mobilise 3 à 6. Coûts : dilution de l'attention (mesurable sur les
petits modèles), sélection d'outil moins fiable, et surtout **un modèle 3B doit arbitrer
entre 72 options à chaque étape** — c'est la première cause d'appels d'outils absurdes.

Le mode Plan limite déjà la liste à 7 outils (`agent.js:218`). Le mode normal, lui,
n'a aucune restriction : 72.

### F2 — Le budget contexte est binaire et mal priorisé

`trimmer.js` **jette une section entière** si elle ne tient pas, au lieu de la tronquer.
Combiné à `PRIORITY = ['system','task','target_files','rag','tree','symbols']` où
`system`, `task` et `target_files` **ne sont jamais émis par `builder.js`** (qui ne pousse
que `tree`, `symbols`, `rag`), le résultat est : RAG prioritaire, arbre sacrifié, et
section la plus prioritaire = celle qui a le moins de valeur ajoutée par caractère.

### F3 — La troncature des résultats est muette

`_truncateResult` coupe à 6 000 car. et ajoute « […] tronqué — N caractères omis ».
Pour `read_file`, cela signifie qu'un fichier de plus de ~150 lignes est présenté
partiel, avec `totalLines` en métadonnée mais **aucune consigne de pagination**.
Le modèle peut alors produire un `replace_code` dont l'`old_string` vient d'une zone
qu'il n'a jamais vue, ou conclure « le fichier ne contient pas X ».

### F4 — Le plan est produit avant toute lecture

`system.js:245-265` impose `plan` en première action, avant `read_file`. Le plan est donc
une **devinette sur le contenu des fichiers**. Or c'est ce plan que l'utilisateur valide
en mode approbation : un plan faux est approuvé, puis contredit à l'étape 2. La règle 4
atténue (plan seulement si ≥ 3 étapes et écriture) mais ne corrige pas l'ordre.

### F5 — Aucune définition de « fini »

`finish` n'exige qu'un `summary`. Rien n'oblige à déclarer ce qui a été vérifié, quel
test est passé, quel fichier a été relu. Les nudges (`VÉRIFICATION OBLIGATOIRE`,
`TESTS`) poussent à vérifier, mais **le modèle peut terminer sans** — et c'est exactement
le scénario « il a fini mais ça ne marche pas » que l'utilisateur décrit comme « mauvais
retour ».

### F6 — La vérification coûte cher et n'est pas mesurée

Pour chaque fichier écrit : 1 étape `write_file` + 1 étape `read_file` imposée + 1 étape
`run_tests` suggérée + l'écriture d'`AGENTS.md` en fin de tâche (2 étapes de plus).
Une tâche de 3 fichiers consomme ≈ 12 étapes sur 25 **avant** les erreurs. Le nudge est
correct sur le fond, mais il est appliqué sans distinction : relire immédiatement est
utile pour un gros `replace_code`, inutile pour un `write_file` de 10 lignes.

### F7 — La compaction perd au lieu de résumer

Au-delà de 26 messages, `_windowMessages` garde `[system, task]` + les 10 dernières paires
et insère « N messages anciens omis — relis les fichiers ». On perd : le plan validé, les
décisions prises, les erreurs rencontrées, la liste des fichiers déjà modifiés. Le
scratchpad existe (`scratchpad` tool) mais **n'est ni obligatoire ni injecté** : c'est un
outil optionnel que le modèle doit penser à utiliser.

### F8 — La mémoire multi-tour est un résumé de résumés

`app.js:311-319` réinjecte 3 échanges sous forme `Utilisateur : … / Agent : …`, tronqués
à 400/600 car. Un second tour sur le même projet ne sait donc pas : quels fichiers ont
été touchés, quel test échoue encore, quelle décision a été prise. L'information existe
pourtant dans `sessions` (`steps`, `trace`).

**Corrigé le 2026-10-23** (ADR-021) : avant chaque tâche, le renderer charge la dernière
session terminée du même projet (`listSessions` → `getSession`) et préfixe la tâche d'un
bloc déterministe de ≤ 700 car. : dernier résultat, fichiers modifiés (dédupliqués,
écritures échouées ignorées), nombre de fichiers déjà lus. L'historique d'échanges reste
en place pour le fil de discussion ; c'est l'état factuel qui manquait.

### F9 — Les conventions du projet ne sont pas lues

Seuls `AGENTS.md`/`Sham.md` sont cherchés (`agent.js:36`). `CLAUDE.md`, `.cursorrules`,
`.github/copilot-instructions.md`, `CONTRIBUTING.md`, `README.md` — les fichiers où les
projets réels écrivent leurs conventions — sont ignorés. Ironie : sur **ce** dépôt, le
harness ne lit pas `CLAUDE.md` qui contient précisément les règles à respecter. En
outre, `AGENTS_MAX_CHARS = 4000` coupe **au caractère** (pas à la section), donc peut
tronquer une règle en pleine phrase.

**Corrigé le 2026-10-23** : `_readAgentsFile` cherche d'abord `AGENTS.md`/`Sham.md`
(4 000 car.), puis un fichier de consignes existant — `CLAUDE.md`, `.cursorrules`,
`.cursor/rules`, `.github/copilot-instructions.md`, `CONTRIBUTING.md` — plafonné à
2 000 car. et coupé sur une frontière de ligne. Un projet déjà outillé n'a plus besoin de
dupliquer ses règles dans AGENTS.md pour être compris.

### F10 — Le contrat de sortie n'est pas validé, seulement parsé

`extractToolCall` est tolérant sur la forme JSON, mais `dispatch` reçoit les arguments
tels quels : un `path` manquant produit une erreur d'outil générique, pas une erreur de
schéma. Le catalogue est en prose hétérogène (`"path": "..." (opt)` vs `"x"?:`), ce qui
augmente le taux d'arguments invalides — et chaque erreur d'argument coûte une étape.

### F11 — Le RAG ne classe rien (mis en évidence par l'eval)

Constat mesuré avec `npm run eval` : sur la fixture `mixed`, les vecteurs de chunks
stockés pendant l'indexation ont des longueurs différentes — **21, 40, 48, 52** — parce
que `embedder.js` utilise un vocabulaire global (`VOCAB`) qui grandit à chaque appel de
`encode()`. Comme `cosineSim` renvoie `0` dès que deux vecteurs n'ont pas la même
longueur, **toutes les similarités valent 0** : le « top-5 » retourné est en réalité les
premiers chunks du parcours du disque. Mesure : pour la question « où est calculé le
total d'une commande ? », `README.md` est classé premier alors que la réponse est dans
`src/cart.js`.

Trois conséquences, cumulatives :

1. La section « Extraits pertinents » du prompt **n'est pas pertinente** : elle consomme
   jusqu'à 12 000 caractères de contexte sans apporter l'information cherchée.
2. Le vocabulaire persiste d'une tâche à l'autre dans le même processus : le contexte
   dépend de l'historique de la session, pas de la tâche (non-reproductibilité du prompt).
3. Les vecteurs sont persistés sur disque et relus à la session suivante alors que le
   vocabulaire est reconstruit dans un autre ordre : les chunks indexés hier ne sont plus
   comparables à la requête d'aujourd'hui.

Correctif appliqué le 2026-10-23 : encodage à **dimension fixe** (hachage FNV-1a des
tokens dans 256 seaux, TF sublinéaire, normalisation L2) et `EMBEDDER_VERSION` intégré à
l'identifiant du store pour forcer la réindexation. Mesure après correctif : similarités
non nulles (0,44 / 0,21 / 0,16 sur la fixture), fichier pertinent classé dans les 2
premiers extraits, 12/12 tâches d'eval. Limite résiduelle : sans IDF, un court document
contenant les mots de la question peut devancer le fichier de code qui contient la
réponse — sujet de classement, distinct de la comparabilité corrigée ici.

Classement corrigé le même jour (ADR-023) : mots de liaison et interrogatifs français
filtrés, similarité pondérée par l'IDF du corpus. Mesure : sur « Que fait padLabel() ? »,
`src/format.js` passe premier (0,22) et `README.md` tombe à 0,00 — il ne gagnait auparavant
que par les mots « que » et « dans ».

---

## 4. Les six leviers d'optimisation

Classés par **gain attendu / coût**. Les extraits sont des propositions, pas du code
appliqué.

### L1 — Sélection dynamique des outils (gain le plus élevé)

**Principe** : n'exposer que les familles pertinentes + un noyau toujours présent, et
rendre le reste accessible par un outil de découverte.

Répartition proposée :

- **Noyau permanent (7)** : `plan`, `read_file`, `write_file`, `replace_code`, `search_grep`, `finish`, `ask_user`.
- **Familles chargées à la demande** : `fs_avancé` (delete/move/batch/restore/diff), `analyse` (find_symbol, LSP, project_info, find_relevant), `exécution` (run_shell, tests, process, deploy, http), `web` (read_url, web_search, call_api), `navigateur` (17 outils), `git`, `média`, `agents`, `configuration` (rules/skills).
- **Détection** : mots-clés de la tâche + extensions mentionnées + config active
  (`enableShell`, `enableLsp`, providers média). Repli : si le modèle appelle un outil
  absent, le résultat contient `OUTIL_NON_CHARGÉ — familles disponibles : …` et l'outil
  est injecté pour l'étape suivante (auto-extension, une seule fois).

**Effet mesuré attendu** : catalogue de 12 189 → ~3 500 car. (−8 700 car., **−37 % de
prompt**), liste de 72 → 15–20 outils, meilleure précision de sélection sur les petits
modèles.

**Risque** : un outil utile absent. Mitigation par l'auto-extension ci-dessus.

**Appliqué le 2026-10-23** (`tools/families.js` + filtrage dans `agent.js`, ADR-018).
Écarts avec la proposition, mesurés :

- le noyau retenu fait **22 outils** sur 54 disponibles en configuration par défaut
  (13 cœur + 6 édition + 4 recherche, LSP en plus si activé) : un peu plus que les 15–20
  visés, parce que les gestes d'édition (supprimer, déplacer, restaurer, diff) coûtent peu
  et servent souvent ;
- prompt système mesuré sur une tâche de correction : **21 843 → 16 230 car. (−26 %)**,
  pas −37 % : les instructions fixes (~11 000 car.) ne dépendent pas du catalogue ;
- une tâche qui parle de navigateur remonte à ~18 500 car. (famille navigateur chargée) —
  c'est le prix normal d'une tâche qui en a besoin ;
- l'auto-extension est devenue plus simple : un outil non listé reste appelable, et un nom
  inventé renvoie `OUTIL_INCONNU — familles disponibles : …`.

Détail mesuré par tâche (jeu d'outils par défaut) :

| Tâche | Outils exposés | Outils retirés |
|---|---:|---:|
| « Corrige la boucle de sum() » | 22 | 32 |
| « npm test vert, corrige src/math.js » | 24 | 30 |
| « Ouvre le navigateur et clique » | 42 | 12 |

### L2 — Budget contexte adaptatif et trimmer qui tronque

**Principe** : budget **par moteur** (local 3B : 6 000 car. ; local 7B : 12 000 ;
cloud : 32 000) et troncature de la section la plus basse au lieu de son rejet.

```js
// trimmer.js — remplacer le "tout ou rien"
for (const part of sorted) {
  const room = maxChars - used;
  if (room <= 0) break;
  if (part.content.length <= room) { kept.push(part); used += part.content.length; }
  else { kept.push({ ...part, content: _cut(part.content, room) }); used = maxChars; break; }
}
```

Compléter par : ordre de priorité réellement émis (`tree` < `rag`), et un en-tête de
section conservé quand la section est coupée (`## Extraits pertinents (tronqué)`).

**Effet** : supprime le gaspillage mesuré (3 673 car. utilisés sur 12 000) et garantit un
contexte non vide. **Coût** : faible. **Risque** : contexte tronqué en milieu de fichier →
l'indiquer explicitement dans le texte de la section.

**Appliqué le 2026-10-23** (`context/trimmer.js`, `context/budget.js`, `main/ipc.js`,
`tests/fixes-p46.test.js`). Écarts avec la proposition initiale, assumés :

- les parts sont **relatives** (rag 70 %, tree 30 %, symbols 15 %) plutôt que des valeurs
  absolues par moteur : un budget divisé par deux reste cohérent ;
- le budget local dépend du **modèle** (1B–3B : 4 000 ; 7B/14B et CPU : 8 000), le cloud
  garde le réglage utilisateur (`maxContextChars`, 12 000 par défaut) ;
- le moteur `cpu` est désormais reconnu comme local (il était traité comme un cloud) ;
- la troncature referme les blocs de code ouverts.

`tests/fixes-p46.test.js` a été mis à jour : il verrouillait la constante `isLocal ? 2000`,
remplacée par le budget par modèle. Le comportement visé (contexte local réduit) est
conservé et testé. L'eval gagne la tâche `context-budget` (budget 4 000 → arbre **et**
extraits présents, budget respecté, troncature signalée).

### L3 — Un contrat de sortie vérifiable

Trois ajouts, tous peu coûteux :

1. **`finish` avec preuves** :
   ```json
   {"tool":"finish","args":{"summary":"…","checks":[
     {"kind":"file","path":"src/auth.js","action":"read"},
     {"kind":"test","command":"npm test","result":"pass","count":1048}]}}
   ```
   Validation dans `agent.js` : si la tâche a modifié un fichier et que `checks` est vide
   ou ne mentionne pas ce fichier → un seul renudge, puis acceptation.
2. **Validation d'arguments avant `dispatch`** : schéma minimal par outil
   (`required: ['path']`, types), erreur explicite
   `ARGUMENT_MANQUANT: path — exemple : {...}`. Gain immédiat sur les petits modèles.
3. **Nudges gradués** : relecture obligatoire seulement après `replace_code` (> 40 lignes)
   ou après une écriture sur fichier critique ; `run_tests` seulement si un test a été
   modifié **ou** si le projet en a (détection via `get_project_info`).

**Effet** : attaque directement F5 et F10 ; réduit F6 de ~2 étapes par fichier.

**Appliqué le 2026-10-23** (`tools/validate.js`, `tools/index.js`, `agent.js`,
`prompts/system.js`, ADR-019). Écarts avec la proposition, assumés :

- le renudge de `finish` n'a lieu **que si un fichier a été modifié** : une tâche de
  lecture ou une question se termine sans preuve, sans coût supplémentaire ;
- la preuve acceptée est soit un `kind: "file"` qui cite un fichier modifié, soit un
  `kind: "test"` avec `result: "pass"` — un modèle peut donc prouver par le test sans
  relire chaque fichier ;
- un seul renudge par tâche (`_finishNudgeSent`), puis acceptation : un oubli coûte une
  étape, jamais une boucle ;
- la validation d'arguments couvre **29 outils** (pas les 72) et uniquement les champs
  réellement obligatoires : `browser_click` accepte sélecteur **ou** coordonnées, donc il
  est exclu ; `plan` et `finish` gardent leurs erreurs dédiées (`PLAN_SANS_OBJECTIF`,
  logique de preuve) ;
- le nudge `run_tests` n'est plus émis si le projet **n'a pas** de runner détecté
  (`_detectRunner`) — avant, on réclamait un outil qui échouait systématiquement.

Mesures : `finish-proof` (write + finish sans preuve) → refusé, relancé, accepté en
3 étapes ; `arg-validation` → `ARGUMENT_MANQUANT: "path" — read_file attend
{"path":"src/app.js"}`, puis l'appel corrigé passe. Aucune régression : 1051 tests,
eval 16/16.

### L4 — Planifier après reconnaissance

**Principe** : remplacer « plan en première action » par « briefing + 1 à 3 lectures,
puis plan ». Le plan gagne en exactitude (il cite de vrais fichiers) et l'utilisateur
approuve un plan qui tient.

Deux variantes, à trancher :

- **Variante douce** (recommandée) : conserver `plan` en première action mais exiger que
  ses `steps` nomment les fichiers pressentis, et autoriser **une** révision du plan
  (`plan` ré-appelable une fois après les lectures, avec `revised: true`), le second plan
  remplaçant la carte UI.
- **Variante dure** : `plan` devient une action de *fin de phase lecture* ; le premier
  appel est une simple `intent` affichée.

**Appliqué le 2026-10-23 — variante douce** (ADR-022, `prompts/system.js`,
`tools/index.js`) : règle 4 étendue (« si après avoir lu les fichiers ton plan s'avère
faux, rappelle plan UNE SEULE FOIS avec "revised": true »), plan révisé marqué
`revised: true` (l'UI remplace le bandeau épinglé), et troisième appel refusé
(`PLAN_DEJA_RÉVISÉ`) par un compteur porté par la config. La variante dure est écartée :
elle changerait l'ordre validé en Phase 67 (briefing avant exécution).

### L5 — Compaction déterministe (état de tâche)

**Principe** : ne pas compter sur le modèle pour se souvenir, ni sur le scratchpad
optionnel. Construire une **carte d'état** à partir de la trace, sans appel LLM :

```
ÉTAT DE LA TÂCHE (reconstruit automatiquement)
Plan validé : 1) lire auth.js 2) corriger le token 3) tester
Fichiers lus      : src/auth.js (l. 1-180), src/db.js
Fichiers modifiés : src/auth.js (replace_code, étape 4, vérifié étape 5)
Échecs            : npm test → 2 échecs (auth.test.js:22, :31) — étape 6
Reste             : 11 étapes
```

Injectée à chaque étape (ou toutes les 3 étapes) **et** conservée quand la fenêtre
glissante s'active. Coût : ~500 car. par étape, récupérés en supprimant les messages
anciens. Effet : supprime le « relis les fichiers » et les relectures redondantes.

**Appliqué le 2026-10-23** (`agent.js`, ADR-020). Écarts avec la proposition :

- l'état complet (~500 car.) n'est injecté **que dans la note de compaction** ; à chaque
  étape, un rappel compact (~120 car.) est ajouté au compteur d'étapes existant — aucun
  message supplémentaire, donc aucun risque de conversion Gemini/Claude ni de cache KV ;
- il est calculé depuis la trace seule : objectif du plan, fichiers lus (compteur),
  fichiers modifiés avec mention **« non relu »** tant qu'aucune lecture n'a suivi, dernier
  échec (outil + code) ;
- la mention « non relu » recoupe le nudge de vérification et la preuve exigée par
  `finish` : trois signaux cohérents plutôt qu'un seul ;
- la note d'omission ne dit plus « relis les fichiers » mais « utilise l'état ci-dessous ».

Mesuré par la tâche `compaction-state` (15 étapes, 32 messages) : la note de compaction
porte l'état et nomme `src/cart.js` ; le compteur affiche `lus: N`.

### L6 — Deux profils de prompt selon le moteur

Un modèle 3B ne peut pas tenir 11 règles + 5 protocoles + 72 outils. Proposer :

| Profil | Règles | Outils | Few-shot | Contexte |
|---|---|---|---|---|

**Appliqué le 2026-10-23 — deux profils au lieu de trois** (ADR-024,
`prompts/profile.js`) : `minimal` (local 1B–3B) retire cinq sections optionnelles
(standards de qualité, exemple de résumé, directives de configuration, `note_user`,
`ask_user` détaillé) et limite les exemples à trois blocs communs + un exemple de langage.
Mesure : **16 431 → 12 177 caractères (−26 %)** sur une tâche de correction. Le profil
`standard` reste identique au caractère près (empreinte inchangée). Le profil `mid` a été
écarté : rien de mesurable entre un 7B et le cloud, et un chemin de test de plus.
| `local-small` (WebLLM ≤ 3B) | 6 règles (JSON, un outil, lis avant d'écrire, exact-match, vérifie, finis) | 12–15 | 2 exemples | 6 k car. |
| `local-mid` (7B–14B) | 9 règles | 20–25 | 3 exemples | 12 k car. |
| `cloud` (Gemini/Claude/OpenAI) | texte actuel | selon L1 | 3 exemples | 32 k car. |

Détection : `engine` + nom du modèle. Effet attendu : sur 1,5B/3B, gain de fiabilité de
format et de choix d'outil bien supérieur à tout réglage de température.

---

## 5. Tableau de synthèse

| Levier | Fuite visée | Gain attendu | Coût | Risque | Priorité |
|---|---|---|---|---|---|
| L1 outils dynamiques | F1 | −37 % de prompt, +précision d'outil | M | Moyen (outil manquant) | **P0** |
| L2 budget + trimmer | F2, F3 | contexte toujours non vide, −gaspillage | S | Faible | **P0** |
| L3 contrat vérifiable | F5, F10, F6 | « fini » prouvé, −2 étapes/fichier | M | Faible | **P0** |
| L4 plan après lecture | F4 | plans justes, approbations utiles | M | Moyen (UI plan) | **Fait** |
| L5 état de tâche | F7, F8 | −relectures, meilleure continuité multi-tour | M | Faible | **Fait** |
| L6 profils moteur | F1, F7 | fiabilité locale | M | Faible | **Fait** |
| Conventions élargies | F9 | respect des règles du projet | S | Faible | P1 |
| Validation de schéma | F10 | −erreurs d'arguments | S | Faible | **P0** |

S = ≤ 1 journée, M = 1 à 3 jours, pour un mainteneur assisté.

---

## 6. Le prompt côté humain (le levier gratuit)

Puisque l'utilisateur part de l'idée « bon prompt → bon retour », voici ce que le
produit peut enseigner — et ce qu'il peut **imposer** sans changer le modèle.

### 6.1 Les cinq informations qu'un harness ne peut pas deviner

1. **Le résultat attendu, observable** (« la page de login accepte `a@b.fr` »), pas
   l'action (« corrige le login »).
2. **Le périmètre** : fichiers, dossier, ou « ne touche pas à X ».
3. **La preuve** : comment on saura que c'est bon (test, commande, URL).
4. **Les contraintes** : pas de nouvelle dépendance, compatibilité, style.
5. **Le mode** : corriger / explorer / expliquer.

### 6.2 Transformation automatique proposée (étage B)

Une passe de **reformulation locale, sans LLM** : si la tâche contient un verbe d'action
mais aucun critère de succès, l'UI ajoute un bloc discret :

```
TÂCHE : « corrige le login »
COMPLÉTÉ AUTOMATIQUEMENT (modifiable) :
- attendu   : (à préciser — ex. « le formulaire accepte un email valide et rejette un mot de passe vide »)
- périmètre : src/auth/**, tests/auth/**
- preuve    : npm test
```

L'utilisateur complète en 10 secondes ; l'agent travaille sur une cible. C'est la
modification la moins chère du lot et celle qui change le plus le taux de réussite perçu.

### 6.3 Exemples

| Prompt faible | Prompt efficace |
|---|---|
| « corrige le bug » | « `POST /login` renvoie 500 quand `email` est vide (repro : tests/auth.test.js:22). Attendu : 400 + message. Ne touche qu'à `src/auth/*`. Preuve : `npm test` vert. » |
| « ajoute une API » | « Ajoute `GET /health` qui renvoie `{ok:true}`, sans dépendance, dans `src/routes/`. Test dans `tests/health.test.js`. Preuve : `npm test`. » |
| « optimise » | « La liste des 5 000 items met 4 s (mesure : `npm run bench`). Objectif < 500 ms sans changer l'API publique. Preuve : bench + tests verts. » |

---

## 7. Protocole de mesure (à faire avant d'optimiser)

Optimiser sans mesurer revient à changer le prompt au hasard. Le protocole minimal :

1. **12 tâches fixes**, versionnées dans `tests/eval/tasks/*.md`, représentatives :
   3 corrections de bug, 3 ajouts de fonctionnalité, 2 refactors, 2 lectures/analyses,
   2 tâches ambiguës (pour tester `ask_user`). Petits projets (< 50 fichiers) pour que
   l'eval tourne en < 10 min.
2. **3 moteurs** : Qwen2.5-Coder-7B local, Gemini flash, Claude (si clé disponible).
3. **5 métriques par tâche** :
   - réussite binaire (tests du projet verts + critère observable) ;
   - étapes consommées / 25 ;
   - caractères de prompt envoyés ; tokens in/out ;
   - nombre d'erreurs d'outil et de parse ;
   - temps mur.
4. **A/B** : l'eval fournit déjà la clé de comparaison — l'**empreinte du prompt**
   (SHA-256 tronqué, `npm run eval -- --save/--compare`). Comparer deux versions sur les
   mêmes 12 tâches, 2 répétitions (température 0,1 donc faible variance).
5. **Seuil de décision** : une optimisation n'est adoptée que si le taux de réussite ne
   baisse pas **et** qu'au moins une métrique de coût s'améliore de > 15 %.

Sans cette étape, L1–L6 ne sont que des hypothèses plausibles — le §4 indique d'ailleurs
« gain attendu », pas « gain mesuré ».

---

## 8. Ce qu'il ne faut pas faire

1. **Allonger le prompt pour corriger un défaut** : chaque règle ajoutée coûte de
   l'adhérence aux autres. Règle : toute règle ajoutée doit en remplacer une.
2. **Supprimer le JSON au profit de texte libre** : le parseur tolérant + le format
   contraint sont ce qui rend les petits modèles utilisables. Le coût d'échappement
   (`\n` dans `content`) est réel mais inférieur au coût d'un parse échoué.
3. **Baisser la température ou changer de modèle comme premier levier** : à 0,1 sur
   Qwen-Coder, le gain est marginal comparé à L1/L3.
4. **Ajouter des étapes de « réflexion »** (chain-of-thought explicite) : sur les petits
   modèles, cela consomme le budget d'étapes sans améliorer le résultat ; les nudges
   ciblés (F5, F6) sont plus efficaces.
5. **Optimiser sans eval** : voir §7.
6. **Toucher au prompt système sans versionner** : sans `PROMPT_VERSION` en session,
   toute régression est indétectable.

---

## 9. Plan d'application proposé

**P0 — 1 session** (mesurable, réversible)
1. ~~Socle de mesure~~ **FAIT** : `tests/eval/` (12 tâches, empreinte du prompt,
   `npm run eval`, baseline dans `tests/eval/baseline.json`). Deux défauts réels y sont
   déjà documentés : cache `read_file` (plage ignorée) et RAG à similarité nulle (F11).
2. ~~Corriger F11~~ **FAIT** : embedder à dimension fixe + version de store → 12/12
   tâches d'eval, similarités non nulles.
3. ~~L2~~ **FAIT** : parts par section + troncature à la ligne + budget par modèle
   (`context/trimmer.js`, `context/budget.js`, `main/ipc.js`) → contexte non vide à tous
   les budgets, tâche d'eval `context-budget`.
4. Validation de schéma des arguments dans `dispatch` (fichier `tools/index.js`).
5. ~~L1~~ **FAIT** : sélection par familles (`tools/families.js`, ADR-018) → 22 outils
   exposés au lieu de 54, prompt −26 % mesuré, tâche d'eval `tool-selection`.

**P1 — 1 à 2 sessions**
5. L3 : `finish{checks}` + nudges gradués.
6. ~~L5~~ **FAIT** : état de tâche reconstruit depuis la trace (ADR-020) — rappel compact
   à chaque étape, bloc complet dans la note de compaction, tâche `compaction-state`.
7. F9 : découverte élargie des fichiers de conventions (cap 4 k car. total, coupe à la
   section).
8. L6 : profils de prompt par moteur.

**P2 — continu**
9. Eval étendue (tâches réelles multi-fichiers) + suivi des tendances ; IDF du RAG et L6
   ensuite.

**Chemin critique** : l'étape 1 (version + eval) doit précéder L1 et L3, sans quoi on ne
saura jamais si le nouveau prompt est meilleur que l'ancien.

---

## 10. Conclusion

Le mécanisme est **globalement bien conçu** : format contraint, parseur tolérant, nudges
ciblés, fenêtre glissante, cache de lecture. L'hypothèse de l'utilisateur est vraie à la
marge : la qualité du prompt humain compte, mais elle est **filtrée par six étages** dont
trois fuient aujourd'hui plus que le prompt n'apporte.

Trois chiffres résument l'état et l'objectif :

| | Avant correctifs | Maintenant | Objectif (L3) |
|---|---:|---:|---:|
| Prompt système (tâche de correction) | 23 672 car. | **16 864 car.** (standard) · **12 177** (minimal 3B) | — |
| Outils exposés par tâche | 72 | 22 (jusqu'à 42 selon la tâche) | 15–20 |
| Contexte utile garanti | 3 673 car. ou rien | 1 900–11 900 car. selon budget, arbre **et** extraits | ≥ 10 000 car. utiles |
| Preuve exigée à `finish` | aucune | fichier relu **ou** test passé (`checks`) | idem |
| Mémoire longue tâche | plan perdu à 26 messages | état reconstruit (lus/modifiés/échec) | idem |

Ce sont des **hypothèses de travail** : elles doivent être validées par le protocole §7
avant d'être annoncées comme des gains.

---

## Annexe — reproductibilité des mesures

Les valeurs de §2 ont été obtenues sans modifier le dépôt, avec un script Node temporaire
qui : (1) extrait `allToolDefs` de `src/harness/agent.js` et en mesure la longueur ;
(2) appelle `buildSystemPrompt` avec ces descriptions ; (3) mesure `chunkFile` sur les 92
fichiers de `src/` (491 chunks) ; (4) simule `trimToBudget` avec un arbre réel. Les
commandes équivalentes :

```bash
# taille du prompt système (hors/avec contexte)
node -e "…"            # voir script joint en session
# tailles de chunks RAG
node -e "require('./src/harness/rag/indexer').chunkFile(...)"
# comportement du trimmer
node -e "require('./src/harness/context/trimmer').trimToBudget([...], 12000)"
```

Fichiers lus pour cette analyse : `prompts/system.js`, `prompts/examples.js`,
`prompts/by-language.js`, `context/builder.js`, `context/trimmer.js`, `context/tree.js`,
`rag/indexer.js`, `rag/retrieve.js`, `agent.js`, `parser.js`, `feedback/advisor.js`,
`shared/constants.js`, `main/ipc.js` (câblage `AGENT_RUN`), `renderer-visible/app.js`
(habillage de la tâche).

**Suite** : le harnais d'eval décrit en §7 est implémenté (`tests/eval/`, `npm run eval`).
Il a confirmé F11 par la mesure (similarités nulles, `README.md` classé premier) et mis au
jour un second défaut : le cache de `read_file` ignorait la plage de lignes. Les deux sont
corrigés. Baseline actuelle : **12/12 tâches, 50/50 vérifications, empreinte `1e3fd019`**.
