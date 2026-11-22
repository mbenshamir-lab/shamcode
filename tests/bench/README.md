# Benchmark sur vrais modèles

`tests/eval` rejoue des réponses écrites à l'avance : il protège des régressions du harness,
mais il ne peut pas dire si l'agent **réussit** une tâche. Ce banc répond à cette question : un
vrai modèle travaille sur un projet, puis le résultat est vérifié **par exécution du code**,
sans tenir compte de ce que l'agent déclare.

**Il consomme des tokens.** Sans `--yes`, il affiche son plan et ne contacte aucune API.

## Auto-contrôle (gratuit)

```bash
npm run bench -- --self-check
```

Chaque tâche doit échouer sur le projet intact et réussir avec sa solution de référence. Ce
contrôle tourne aussi dans `npm test` (`tests/bench.test.js`).

## Comparer deux versions

La référence doit être créée **dans** le dépôt : hors de celui-ci, elle ne trouve pas
`node_modules`.

```bash
git worktree add --detach .claude/worktrees/bench-base 45922ce
```

Une clé est lue dans l'environnement, jamais en argument : `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `DEEPSEEK_API_KEY` ou `OPENAI_COMPAT_API_KEY`.

```bash
npm run bench -- --engine=gemini --model=gemini-3.5-flash --harness=.claude/worktrees/bench-base --label=avant --save=bench-avant.json --yes
```

```bash
npm run bench -- --engine=gemini --model=gemini-3.5-flash --label=apres --save=bench-apres.json --yes
```

```bash
npm run bench -- --compare=bench-avant.json,bench-apres.json
```

Options : `--repeat=2`, `--task=id1,id2`, `--base-url=…` (openai-compat),
`--max-tokens=2500000` (plafond global par mesure), `--task-tokens=150000` (plafond par exécution).

## Lire le verdict

| Verdict | Signification |
|---|---|
| `ADOPTER` | réussite en hausse, ou égale avec un coût réduit de plus de 15 % |
| `REJETER` | réussite en baisse, même si c'est moins cher |
| `SANS_EFFET_MESURABLE` | ni la réussite ni le coût ne bougent assez |
| `NON_COMPARABLE` | moteur ou modèle différent, ou mesure interrompue par un plafond |

C'est la règle de `docs/ANALYSE_PROMPT.md` §7, à un écart près, assumé : une hausse de réussite
suffit à adopter, sans exiger aussi une baisse de coût.

`falseSuccesses` compte les exécutions où l'agent a dit avoir terminé alors que la vérification
échoue : c'est le « il a fini mais ça ne marche pas ».

## Les 12 tâches

| id | Situation |
|---|---|
| `bug-from-tests` | cause visible uniquement dans la sortie des tests |
| `bug-described` | symptôme décrit, fichier non cité |
| `bug-long-file` | bug à la fin d'un fichier plus long que la troncature |
| `feature-coupon` | fonction spécifiée, avec cas d'erreur |
| `feature-dollar` | code contenant `'$'`, piège de `String.replace` |
| `feature-readme` | contenu avec des fences Markdown |
| `refactor-rename` | renommage sur plusieurs fichiers, tests compris |
| `refactor-constant` | extraction d'une constante dupliquée |
| `read-locate`, `read-explain` | analyse sans aucune modification |
| `ambiguous-delete`, `ambiguous-currency` | la question doit précéder l'action |

## Limites

- **Sécurité :** le code écrit par le modèle est exécuté par `run_tests` et par les vérifications,
  sur cette machine, dans un dossier temporaire. Le banc n'ouvre ni shell, ni git, ni recherche
  web, mais du code Node reste du code Node : lance-le sur un poste où c'est acceptable.
- **Petit projet :** 14 fichiers, donc le classement RAG y compte peu. Le banc mesure surtout la
  boucle, les outils et les moteurs. Une tâche sur un gros dépôt reste à ajouter.
- **Variance :** deux répétitions par tâche donnent une tendance, pas une preuve. Un écart d'une
  ou deux exécutions sur 24 n'est pas significatif.
- **Référence et Claude :** l'ancienne version envoie `temperature` et `top_p`, refusés par les
  modèles récents. La comparer sur un tel modèle mesure surtout cette erreur.
- **Résultats :** les fichiers `--save` contiennent des messages d'erreur de fournisseurs, avec
  la clé masquée. Ne les versionne pas sans les relire.
