# Proposition — Couper les boucles qui n'avancent pas

> **Statut : proposition, aucun code de production écrit.** Décision en §5.
> Complète `PROPOSITION_BOUCLE_AGENT.md` (qui réduit le coût *d'un* tour ; ici on évite les tours *inutiles*).

## 1. Constat (mesuré)

`node scripts/sim-boucles.js` rejoue quatre comportements avec un modèle scripté (aucun appel API) :

| Scénario | Appels LLM avant arrêt | Issue |
|---|---|---|
| A. même appel, même résultat, répété | **8** | `BOUCLE_DÉTECTÉE` |
| B. `replace_code` qui échoue, `old_string` différent à chaque fois | **50** | `MAX_STEPS_ATTEINT` |
| C. cycle `list_dir` / `read_file` | **50** | `MAX_STEPS_ATTEINT` |
| D. recherches toutes différentes, aucune action | **50** | `MAX_STEPS_ATTEINT` |

`LOOP_WARN_AT`/`LOOP_STOP_AT` (agent.js) ne comptent que des appels **strictement identiques**
(signature outil + args + résultat). Dès qu'un argument varie ou que deux appels alternent,
rien ne se déclenche : le run consomme tout son budget d'étapes (≈ 7 000 tokens chacune en cloud)
sans jamais prévenir ni le modèle ni l'utilisateur. Même le cas A attend 8 tours.

Autres angles morts : aucun compteur `llm_calls` par session (les reprises de parse ne sont pas
des étapes), donc impossible de chiffrer le gaspillage sur du trafic réel ; 7 sessions réelles
seulement, trop courtes pour conclure.

## 2. Proposition : détecteur de stagnation, interne à `agent.js`

Une fenêtre glissante sur les dernières étapes, qui mesure le **progrès** et non la répétition :

- **Progrès** = une écriture réussie, un test qui passe, un fichier jamais lu auparavant, ou un
  résultat jamais vu (hash du résultat absent de la fenêtre).
- **Stagnation** = N étapes consécutives sans progrès (échecs répétés sur le même outil/fichier, cycle
  de période 2-3, lectures de résultats déjà vus).
- Paliers : à `N=5` message correctif ciblé (ex. « replace_code a échoué 5 fois sur a.js : relis le
  fichier entier, ou appelle finish en expliquant ce qui bloque ») ; à `N=10` arrêt propre
  `STAGNATION_DÉTECTÉE` avec résumé de ce qui a été tenté.
- Abaisser `LOOP_STOP_AT` de 8 à 5 pour l'appel strictement identique (3 tours économisés).

Périmètre : `agent.js` + 2 constantes dans `shared/constants.js` + un test `tests/loop-efficiency.test.js`
(les 4 scénarios ci-dessus doivent s'arrêter en ≤ 12 appels). Aucune interface publique, aucun IPC,
aucune dépendance. Les 20 tâches d'éval doivent rester vertes (4,2 étapes/tâche aujourd'hui).

## 3. Risques

- **Faux positif** : une tâche légitime d'exploration (lire 10 fichiers neufs) ne doit pas être coupée :
  un fichier neuf compte comme progrès, d'où la définition ci-dessus. Seuil N configurable.
- **Petits modèles (<3B)** : plus enclins aux échecs répétés ; le message correctif doit rester court.

## 4. Mesure

Ajouter `llm_calls` et `stagnation_stops` à `logger.event(run_finish)` (3 lignes) pour chiffrer
sur du trafic réel avant/après.

## 5. Décision demandée

- [ ] **Détecteur + `LOOP_STOP_AT`=5 + compteurs** (recommandé)
- [ ] Compteurs seulement (mesurer d'abord, ne rien couper)
- [ ] Aucune
