# Proposition — Réduire les allers-retours de la boucle d'exécution

> **Statut : proposition, aucun code écrit.** Décision attendue en fin de document (§6).
> Périmètre : boucle principale `runAgent` ([agent.js:694](src/harness/agent.js:694)).
> Hors périmètre : orchestration, sous-agents, garde-fous de sécurité (aucun n'est
> affaibli ici).

---

## 1. Le constat

La boucle est **strictement un tour de LLM par action** :

```
for (let step = 1; step <= maxSteps; step++) {   // maxSteps = 50
  _generateOnce(step)      // 1 génération complète (prompt système + contexte + fenêtre)
  extractToolCall(raw)     // parser.js:33 — accepte UN objet { tool, args }
  dispatch(un seul outil)  // 1 exécution
  messages.push(résultat)  // 1 message de résultat
}
```

`extractToolCall` ne sait pas rendre plusieurs appels : un `{ "tools": [...] }` n'est
pas reconnu. **N lectures = N générations.** Chaque génération repaie le prompt
système complet (outils + AGENTS.md + persona + RAG, voir [agent.js:458](src/harness/agent.js:458))
et jusqu'à 26 messages de fenêtre (`WINDOW_THRESHOLD`).

### 1.1 Les quatre surcoûts structurels

| # | Surcoût | Où | Coût |
|---|---|---|---|
| 1 | Relecture obligatoire après chaque écriture | [agent.js:976-978](src/harness/agent.js:976) | **+1 étape par fichier écrit** |
| 2 | `finish` refusé faute de preuve | [agent.js:789](src/harness/agent.js:789) | **+1 étape**, ~1 fois sur 4 (mesuré §2) |
| 3 | Un seul outil par tour (pas de lot) | [parser.js:33](src/harness/parser.js:33) | **+N-1 étapes** pour N lectures |
| 4 | `plan` avant d'agir | [system.js:148](src/harness/prompts/system.js:148) | **+1 étape** au démarrage |

Les surcoûts 1 et 2 sont couplés : c'est la relecture exigée par le modèle qui *fabrique*
la preuve réclamée par `_checkFinishProof`. **Le serveur pourrait la faire lui-même** —
il a déjà le hash du fichier écrit et le résultat de `dispatch`.

### 1.2 Ce qui est déjà optimisé (à ne pas casser)

- Prompt système construit **une fois** avant la boucle → préfixe stable, cache KV
  exploité côté moteur local (ADR-033).
- Cache `read_file` ([agent.js:855-867](src/harness/agent.js:855)) : une relecture
  identique dans la fenêtre renvoie `[déjà lu à l'étape N]` au lieu du contenu.
- Fenêtre glissante avec bloc d'état : le contexte ne grossit pas indéfiniment.
- Troncature des résultats à 6 000 caractères (`MAX_RESULT_CHARS`).
- Sélection dynamique des familles d'outils (ADR-018) : le prompt ne porte que le
  sous-ensemble utile.

---

## 2. Mesures disponibles

Aucune télémétrie agrégée n'existe : il faut lire les sessions pour compter les tours.

**`%APPDATA%\code-harness\sessions` — 100 sessions** (attention : ce sont des
fixtures « créer hello.txt » / « tâche longue », pas du trafic réel) :

| Métrique | Valeur | Lecture |
|---|---|---|
| Étapes moyennes | 4,3 (médiane 4, max 6) | boucle courte |
| `plan` | 100 / 100 sessions | 1 tour systématique |
| `finish` | **133** pour 100 sessions | **33 refus = 33 tours perdus (7,7 % des étapes)** |
| `read_file` | 136 | 1,36 lecture par session, 1 lecture = 1 tour |
| `write_file` / `replace_code` | 33 / 33 | 33 relectures forcées supplémentaires |

Soit **~47 % des étapes sont du protocole** (`plan` + `finish`), avant tout travail utile.

**`.harness-runtime\sessions` — 7 sessions de cette copie** : la session
`ask_user → read_file → read_file → finish` (4 étapes) montre le plancher réel :
**4 générations pour lire 2 fichiers et clore.**

**Limite honnête** : `npm run bench:prompt` mesure la taille du prompt, pas le nombre de
tours, et il est bloqué par le bac à sable lecture seule (`EPERM mkdtemp`). Il n'existe
pas de compteur `llm_calls` par session — `trace.length` sous-estime (les reprises de
parse ne sont pas tracées comme étapes).

---

## 3. Options

### Option A — Lots d'appels dans une réponse

`{"calls":[{ "tool":"read_file","args":{…} }, …]}` accepté par le parser ; l'agent
exécute le lot, s'arrête au premier échec, et renvoie un message de résultats groupés.

- **Gain** : le plus fort — 4 lectures = 1 tour au lieu de 4.
- **Risque** : élevé. Change le contrat du parser (5 fichiers de tests en dépendent :
  `parser`, `agent-fiabilite`, `best-agent`, `fixes-p46`, `fixes-p64`),
  petit modèle qui produit un lot malformé = tour perdu + reprise, et le raisonnement
  « je lis puis je décide » devient « je lis en aveugle ».
- **Surface** : `parser.js`, `agent.js` (boucle + garde-fous `strictTools`), prompt,
  `tests/parser.test.js`, `tests/lib/app-module.js` n'est pas concerné.
- **Effort** : 2-3 jours.

### Option B — Lecture multi-fichiers côté outil

`read_file` accepte `{ "paths": ["a.js","b.js"] }` (ou nouvel outil `read_files`).
Le modèle émet **un seul** appel ; `dispatch` boucle en interne et concatène.

- **Gain** : N lectures → 1 tour, sans toucher au contrat du parser.
- **Risque** : faible. Petit modèle : un argument optionnel de plus, descriptions d'outils
  déjà compactées à 220 caractères en local.
- **Surface** : `tools/index.js`, `tools/fs.js`, description dans `agent.js`, prompt.
- **Effort** : 1 jour.

### Option C — Le serveur vérifie, pas le modèle

1. Après `write_file`/`replace_code`, l'agent relit le fichier **en interne** (hash +
   nombre de lignes) et injecte `[vérifié : sha1…, N lignes]` dans le message de résultat.
   La consigne « VÉRIFICATION OBLIGATOIRE : appelle read_file » disparaît.
2. `_checkFinishProof` accepte cette vérification interne comme preuve (`_fileProven` lit
   un événement de trace dédié au lieu d'exiger un `READ_FILE` du modèle).
3. Les `checks` restent acceptés, mais ne sont plus **exigés** quand la preuve serveur
   existe : plus de refus de `finish` quand l'agent a réellement écrit et vérifié.

- **Gain** : −1 étape par fichier écrit **et** −1 tour par `finish` refusé.
  Sur les 100 sessions mesurées : **−66 étapes sur 430 (≈ 15 %)**, sans changer le
  contrat du LLM.
- **Risque** : moyen mais maîtrisable. **Le garde-fou ne doit pas s'affaiblir** : la
  preuve devient *plus* fiable (hash serveur vs déclaration du modèle), et un fichier
  jamais vérifié garde le refus actuel. Tests existants de `finish` à réaligner
  explicitement.
- **Surface** : `agent.js` uniquement (+ tests `agent.test.js`, `fixes-p*.test.js`).
- **Effort** : 1 jour.

### Option D — `plan` non facturé

Impossible sans A : une réponse ne peut pas porter `plan` **et** une action. Les pis
allers sont : ne plus le suggérer pour les tâches de lecture seule (déjà la règle),
ou le rendre facultatif par config. Gain réel douteux, à écarter pour l'instant.

---

## 4. Comparaison

| Option | Tours gagnés (estimation) | Risque | Effort | Touche le contrat LLM |
|---|---|---|---|---|
| A — lots | jusqu'à −60 % sur les tâches de lecture | élevé | 2-3 j | oui (parser) |
| B — lecture groupée | −40 % sur les lectures | faible | 1 j | non |
| C — preuve serveur | −15 % global, −50 % sur les écritures | moyen | 1 j | non |
| D — plan | ~0 | — | — | — |

Les gains ne s'additionnent pas linéairement : C supprime les tours d'écriture,
B les tours de lecture, A engloberait les deux.

---

## 5. Recommandation

**C puis B, A seulement si la mesure le justifie.**

1. **C d'abord** : c'est le seul gain qui *renforce* le garde-fou au lieu de le
   négocier, et il ne change aucune interface publique. Il attaque les deux surcoûts
   prouvés par les traces (relecture forcée, `finish` refusé).
2. **B ensuite** : faible risque, gain net sur les tâches d'exploration, aucun impact
   sur les petits modèles au-delà d'un argument optionnel.
3. **A en dernier recours** : à n'ouvrir que si, après C+B, la mesure montre encore
   > 3 tours par lecture sur des tâches réelles. Le changement de contrat du parser est
   le point de rupture le plus dangereux pour les modèles < 3B (CLAUDE.md, vigilance 4).

**Mesure avant/après obligatoire** (sinon on ne saura pas si ça vaut le risque) :

- compteur `llm_calls` par session dans `logger.event` (coût nul, 3 lignes) ;
- `node tests/eval/run.js` : 20 tâches / 91 checks doivent rester verts, et le nombre
  d'étapes par tâche **doit baisser** ;
- un test dédié `tests/loop-efficiency.test.js` : « lire 3 fichiers coûte 1 appel LLM »
  (après B) et « écrire puis finir coûte 2 appels » (après C).

**Non-objectifs** : ne pas toucher `MAX_STEPS`, ni les gates objectif/preuve, ni
l'orchestration, ni le cache KV. Aucune dépendance npm.

---

## 6. Décision demandée

Cochez une ligne — je n'écris de code qu'après validation explicite :

- [ ] **C seul** (preuve serveur) — le plus sûr, ~15 % d'étapes en moins
- [ ] **C + B** (recommandé) — ~25-30 % d'étapes en moins sur les tâches réelles
- [ ] **C + B + A** — maximum de gain, risque sur les petits modèles
- [ ] **Aucune** — je garde le comportement actuel

Après validation : ADR-034 dans `docs/DECISIONS.md`, puis implémentation de l'option
choisie uniquement, avec les tests ci-dessus.
