# Eval du harnais

Mesure ce que **le harness** fait d'une trajectoire d'agent : taille du prompt,
contexte injecté, nudges, récupération après erreur, garde-fous, budget d'étapes.

Le « modèle » n'est pas un vrai LLM : c'est un **script rejoué** (`tasks.js`), donc
l'eval est déterministe, hors-ligne, sans clé API, et s'exécute en quelques secondes.
Ce n'est pas un benchmark de modèle — c'est une **baseline de régression** : elle dit
si une modification de prompt, de contexte ou de boucle améliore ou dégrade le
comportement observable.

## Lancer

```bash
npm run eval                          # rapport lisible
npm run eval -- --json                # sortie machine
npm run eval -- --task=nominal-fix,truncation
npm run eval -- --strict              # exit 1 si une tâche échoue (hors défauts connus)
npm run eval -- --keep                # conserve les bacs à sable pour inspection
```

## Comparer deux versions (A/B de prompt)

```bash
npm run eval -- --save=tests/eval/baseline.json   # avant modification
# …modifier le prompt / la boucle…
npm run eval -- --compare=tests/eval/baseline.json
```

La comparaison affiche les deltas de score, d'étapes, de taille de prompt, d'erreurs,
et les changements de statut tâche par tâche. L'**empreinte du prompt** (8 premiers
caractères du SHA-256 du prompt système) identifie la version testée : si elle ne
change pas, la modification n'a pas touché le prompt.

Règle d'adoption (cf. `docs/ANALYSE_PROMPT.md` §7) : aucune optimisation n'est adoptée
si le score baisse, ou si aucun coût ne s'améliore de plus de 15 %.

## Ce qui est mesuré par tâche

| Métrique | Origine |
|---|---|
| `steps` | longueur de la trace |
| `systemChars`, `promptHash` | prompt système au premier appel |
| `parseErrors` | événements `parse_error` |
| `toolErrors`, `errors[]` | résultats d'outil `ok: false` |
| `truncatedResults` | messages contenant « tronqué » |
| `nudges.{verification,tests,relire,urgent,remaining}` | messages de retour d'outil |
| `durationMs` | temps de la tâche |

## Les 19 tâches

| id | projet | ce qu'elle vérifie |
|---|---|---|
| `nominal-fix` | bugfix | trajectoire complète plan → lecture → correction → tests → finish |
| `recover-json` | bugfix | récupération après une réponse non-JSON |
| `recover-block` | bugfix | récupération après `BLOC_INTROUVABLE` + guidage de relecture |
| `path-guard` | bugfix | refus d'une lecture hors projet, sans casser la suite |
| `approval-reject` | feature | refus d'écriture : aucun fichier créé |
| `feature-create` | feature | ajout de fonction + export, code existant préservé |
| `verify-nudge` | bugfix | le nudge de vérification est-il émis ? (et accepté sans relecture) |
| `prompt-profile` | bugfix | profil `minimal` : sections optionnelles retirées, règles essentielles gardées |
| `plan-revision` | bugfix | plan révisé une fois après lecture ; 3e plan refusé |
| `compaction-state` | mixed | 15 étapes : l'état de tâche survit à la fenêtre glissante |
| `finish-proof` | bugfix | `finish` sans preuve → refusé, relancé, puis accepté avec `checks` |
| `arg-validation` | bugfix | argument manquant nommé + exemple, puis appel corrigé accepté |
| `context-rag` | mixed | un fichier pertinent est-il classé dans les 2 premiers extraits RAG ? |
| `context-budget` | large | à budget serré (4 000 car.), arbre **et** extraits survivent-ils (tronqués) ? |
| `tool-selection` | mixed | catalogue filtré : navigateur chargé, média absent, outil inventé guidé |
| `truncation` | large | troncature d'une lecture longue + pagination |
| `budget-stop` | bugfix | arrêt propre sur `MAX_STEPS` + avertissements |
| `ambiguity` | mixed | `ask_user` avant toute écriture |
| `multi-file` | mixed | coût en étapes d'une tâche à deux fichiers |

## Défauts trouvés par l'eval (corrigés le 2026-10-23)

L'eval a été écrite avant les correctifs : elle a révélé deux défauts réels, aujourd'hui
corrigés. Les tâches `truncation` et `context-rag` restent les garde-fous de ces
corrections — les affaiblir ou les retirer rouvrirait la porte aux régressions.

1. **Cache de `read_file` ignorant la plage de lignes** (corrigé dans `src/harness/agent.js`).
   La clé de cache ne contenait que le chemin : une seconde lecture paginée du même
   fichier renvoyait « déjà lu à l'étape N — contenu identique ». Conséquence : un fichier
   de plus de 6 000 caractères ne pouvait jamais être lu en entier. La clé inclut
   désormais `start_line`/`end_line`, et l'invalidation après écriture supprime toutes les
   plages d'un même chemin.

2. **Similarité RAG toujours nulle** (corrigé dans `src/harness/rag/embedder.js`).
   Les vecteurs de chunks avaient des longueurs différentes (21, 40, 48, 52 mesurées)
   parce que le vocabulaire global grandissait pendant l'indexation ; `cosineSim` renvoie
   0 dès que les longueurs diffèrent, donc le « top-5 » était les 5 premiers chunks du
   parcours (README classé premier alors que la réponse était ailleurs). L'encodage est
   désormais à **dimension fixe** (hachage des termes dans 256 seaux, TF sublinéaire,
   normalisation L2), et `EMBEDDER_VERSION` entre dans l'identifiant du store : les
   anciens index sont réindexés au lieu d'être relus avec un vocabulaire différent.

   Classement complété le même jour : mots de liaison et interrogatifs français filtrés,
   similarité pondérée par l'IDF du corpus. `src/format.js` passe devant `README.md` sur
   la question « Que fait padLabel() ? » (0,22 contre 0,00), et la tâche `context-rag`
   vérifie que le fichier pertinent est dans les 2 premiers extraits.

## Ajouter une tâche

1. Créer `fixtures/<nom>/` (projet minimal, quelques fichiers).
2. Ajouter une entrée dans `tasks.js` : `id`, `fixture`, `task` (consigne **avec
   critère de succès**), `script` (trajectoire rejouée, objets JSON ou chaînes brutes),
   `config` éventuel, `checks(ctx)`.
3. `ctx` expose : `result`, `events`, `trace`, `metrics`, `system`, `read(relPath)`.
4. Lancer `npm run eval -- --task=<id>`.

Un `script` peut contenir des erreurs réalistes (JSON malformé, mauvais bloc, chemin
hors projet) : c'est précisément ce que le harness doit rattraper.
