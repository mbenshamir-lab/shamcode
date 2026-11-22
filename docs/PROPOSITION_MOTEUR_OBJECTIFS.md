# Proposition — Moteur d'objectifs et autonomie de mise en œuvre

> **Statut : acceptée et implémentée (MVP, phase 1).** Choix validés : option B
> (moteur en session + persistance), niveau par défaut `assisted`, critères
> vérifiables uniquement, objectifs par tâche. UI dédiée et reprise multi-sessions
> restent en phase 2. Voir ADR-031 et `src/harness/goals/`.

---

## 1. Le constat

L'agent sait aujourd'hui **suivre une tâche** et **briefe** l'utilisateur, mais il ne
sait pas **porter un objectif** :

| Brique existante | Ce qu'elle fait | Ce qui manque |
|---|---|---|
| `plan` ([tools/index.js:247](src/harness/tools/index.js:247)) | briefing objectif + étapes, révisable 1 fois | éphémère, pas de critères de réussite, pas de suivi d'avancement |
| `finish` + `_checkFinishProof` ([agent.js:472](src/harness/agent.js:472)) | exige un fichier relu ou un test vert | preuve auto-déclarée, non comparée à la demande |
| `orchestrate` ([orchestrate.js](src/harness/tools/orchestrate.js)) | découpe en phases + sous-agents | one-shot, aucune persistance, pas de réplanification |
| TDD ([agent.js:406](src/harness/agent.js:406)) | phases RED/GREEN/REFACTOR | limité aux tests, pas aux critères fonctionnels |
| `feedback` + `project_note` | mémorise échecs et décisions | pas de journal de décisions lié à un objectif |
| `scheduler` | exécution sans utilisateur | aucune notion de but, de budget ni de checkpoint |

Conséquence : sur une fonctionnalité complète, l'agent **exécute des étapes** mais ne
peut pas répondre à « est-ce que l'objectif est atteint ? », ni « pourquoi ce choix ? »,
ni « que reste-t-il à faire ? ». Il s'arrête quand il estime avoir fini, pas quand les
critères sont prouvés.

## 2. Ce que « autonome » doit vouloir dire

Trois niveaux, réglables par configuration (`autonomyLevel`) :

| Niveau | Comportement | Usage |
|---|---|---|
| `off` | comportement actuel | tâches ponctuelles |
| `assisted` (recommandé par défaut) | l'agent décide seul des choix réversibles, demande pour le structurant, journalise tout | quotidien |
| `auto` | l'agent décide aussi du structurant, mais journalise et reste borné par le budget | tâches planifiées, avec préautorisation explicite |

**L'autonomie n'est pas l'absence de garde-fous.** Elle repose sur quatre limites dures :

1. **Traçabilité** : pas d'objectif sans citation de la demande utilisateur (`source`).
2. **Budget** : étapes, fichiers modifiés, dépendances ajoutées, réplanifications.
3. **Critères vérifiables** : un objectif n'est `done` que si chaque critère a une preuve.
4. **Escalade** : certains choix sortent toujours du périmètre de l'agent (voir §3).

## 3. Politique de décision (« prendre les bonnes décisions »)

Chaque décision est classée et journalisée :

| Classe | Exemples | `assisted` | `auto` |
|---|---|---|---|
| **D0 — locale réversible** | nom de variable, ordre des imports, fichier de test | décide | décide |
| **D1 — projet réversible** | nouveau module interne, refactor local, ajout de test | décide + journal | décide |
| **D2 — structurante** | API publique, IPC, schéma de données, > 3 modules, dépendance npm | **demande** (plan/ADR) | décide + ADR |
| **D3 — irréversible / risquée** | suppression de données, shell destructif, credentials, publication, achat | **demande toujours** | **demande toujours** |

Règles de départage, dans l'ordre : convention existante > test qui passe > plus petit
diff > performance > préférence personnelle. Une dépendance nouvelle est toujours D2.
Un choix D2/D3 refusé n'est jamais contourné : l'objectif passe `blocked`.

**Escalade obligatoire** (même en `auto`) : ambiguïté sur l'objectif, critères
contradictoires, budget consommé à 70 %, deux échecs consécutifs sur le même critère,
secret manquant, action D3.

Chaque décision produit une entrée :
```json
{
  "id": "d3", "class": "D2",
  "question": "Comment persister les objectifs ?",
  "options": ["JSON dans .harness/goals", "SQLite", "notes projet"],
  "choice": "JSON dans .harness/goals",
  "rationale": "zéro dépendance, lisible, atomique par fichier, déjà dans .harness ignoré",
  "reversible": true,
  "at": "2026-11-22T12:00:00Z"
}
```
Le journal est injecté dans le prompt (version courte) et affiché dans l'UI : l'agent
peut expliquer ses choix, l'utilisateur peut les contester.

## 4. Architecture recommandée (option B)

```
src/harness/goals/
  model.js      — schéma, validation, cycle de vie (proposed→active→blocked→done)
  store.js      — lecture/écriture atomique dans <projectRoot>/.harness/goals/<id>.json
  policy.js     — classifyDecision(), canDecideAlone(), shouldEscalate(), budget
src/harness/tools/goal.js — outil unique `goal` (actions set/status/decide/close)
```

### 4.1 Modèle d'objectif (persisté)

```json
{
  "version": 1,
  "id": "g-20261122-a1b2",
  "objective": "Ajouter l'export CSV des sessions",
  "source": "« je veux pouvoir exporter mes sessions en CSV »",
  "status": "active",
  "criteria": [
    { "id": "c1", "text": "bouton Export CSV visible", "verify": { "kind": "test", "command": "npm test -- sessions" }, "status": "pending", "evidence": null }
  ],
  "constraints": ["aucune nouvelle dépendance", "ne pas changer le format JSON des sessions"],
  "plan": [{ "id": "s1", "text": "lire le module sessions", "status": "todo", "files": ["src/harness/memory/sessions.js"] }],
  "decisions": [],
  "attempts": [],
  "budget": { "maxSteps": 30, "maxFiles": 8, "maxNewDeps": 0, "maxReplans": 2 }
}
```

### 4.2 Outil `goal` (un seul outil, plusieurs actions)

| Action | Effet |
|---|---|
| `set` | crée l'objectif ; refuse sans `source` ou sans au moins un critère vérifiable |
| `status` | met à jour un critère/une étape avec **preuve obligatoire** (test, fichier, commande) |
| `decide` | journalise une décision ; refuse D3 sans approbation, D2 en `assisted` sans plan validé |
| `close` | clôt `done` seulement si tous les critères sont `met` ; sinon `blocked` avec raison |

L'outil est dans le noyau (`CORE`) : il doit être disponible même quand les familles
lourdes ne sont pas chargées.

### 4.3 Intégration dans la boucle

1. **Début de tâche** : charger l'objectif actif du projet ; injecter un bloc compact
   (~400 caractères) dans le prompt : objectif, critères restants, budget restant,
   dernière décision.
2. **Pendant** : chaque `goal status` met à jour le store et émet `goal_updated` ;
   `_compactState()` rappelle le critère courant (les petits modèles perdent le fil).
3. **Finish** : si un objectif est actif, le gate vérifie que tous les critères sont
   `met` (preuve liée). Sinon refus unique avec la liste des critères manquants —
   même mécanique que `_checkFinishProof`.
4. **Échec** : deux tentatives ratées sur un critère → réplanification (max 2) ou
   `blocked`. Jamais de boucle infinie.
5. **Budget** : étapes/fichiers/dépendances contrôlés avant l'action, pas après.

### 4.4 Prompt

Ajout d'une section « OBJECTIF ACTIF » (uniquement si un objectif existe) et de la
politique de décision en 5 lignes. Le profil `minimal` garde la version courte : les
petits modèles n'ont pas besoin du journal complet, seulement du critère courant.

### 4.5 UI (phase 2)

Carte objectif dans le fil : objectif, critères avec ✓/✗, décisions, jauge de budget,
bouton Pause. Événements : `goal_created`, `goal_updated`, `goal_criterion`,
`goal_decision`, `goal_blocked`, `goal_done`. Aucune carte par sous-agent (règle
d'orchestration existante).

### 4.6 Évaluation

Trois tâches d'eval déterministes :
- `goal-feature` : fonctionnalité simple + tests → objectif créé, critères prouvés,
  aucun fichier hors périmètre ;
- `goal-ambiguous` : demande incomplète → `ask_user` au lieu d'inventer ;
- `goal-budget` : tâche impossible → `blocked` avec rapport partiel, pas de `finish` silencieux.

Métriques : taux de critères prouvés, étapes, fichiers hors périmètre, décisions
journalisées, dépendances ajoutées (doit rester 0 sans accord).

## 5. Options

| Option | Description | Coût | Risque | Verdict |
|---|---|---|---|---|
| **A. Plan enrichi** | ajouter `criteria` à `plan`, suivre dans la session | faible | pas de persistance, pas de reprise, pas de journal | insuffisant |
| **B. Moteur d'objectifs en session + persistance** | §4, sans exécution planifiée | moyen | prompt plus long, migration | **recommandé (MVP)** |
| **C. Worker autonome multi-sessions** | file d'objectifs, reprise après crash, scheduler, notifications | élevé | autonomie non supervisée, coût, confiance | après B |

## 6. Périmètre du MVP (option B, phase 1)

**Inclus** : modèle + store + policy, outil `goal`, gate `finish`, bloc prompt,
budget, journal de décisions, événements, tests unitaires, 3 tâches d'eval, docs.
**Exclu** : UI dédiée (les événements suffisent), reprise après redémarrage,
exécution planifiée, plusieurs objectifs simultanés.

Fichiers touchés : `src/harness/goals/*` (3 nouveaux), `tools/goal.js` (nouveau),
`shared/constants.js`, `tools/index.js`, `tools/validate.js`, `tools/families.js`,
`agent.js`, `prompts/system.js`, `main/config.js` (2 clés), `main/ipc.js`/preload
(événements), `docs/MODULES.md`, `docs/DECISIONS.md`, tests + eval.

Estimation : ~800 lignes de code, ~350 lignes de tests, 1 à 2 sessions.

## 7. Risques et parades

| Risque | Parade |
|---|---|
| L'agent invente un objectif | `source` obligatoire, citation de la demande |
| Boucle infinie / dérive | budget dur, 2 réplanifications max, `blocked` |
| Faux « terminé » | critères vérifiables + preuve obligatoire |
| Prompt trop long | bloc compact, version minimale pour petits modèles |
| Décisions opaques | journal + rationale + alternatives, visible UI |
| Autonomie dangereuse | D3 toujours demandé, D2 demandé en `assisted` |
| Corruption du store | écriture atomique (tmp + rename), version de schéma |

## 8. Décisions à valider

1. **Option B** (moteur d'objectifs en session, persistant) plutôt que A ou C ?
2. **Niveau par défaut** : `assisted` (recommandé) ou `off` tant que l'UI n'existe pas ?
3. **Critères** : uniquement vérifiables automatiquement, ou autoriser un critère
   « validation manuelle » (qui passe l'objectif en `awaiting_user`) ?
4. **UI** : phase 2, ou inclure une carte minimale dès le MVP ?
5. **Portée** : objectifs par tâche uniquement, ou aussi un backlog d'objectifs produit
   que l'agent reprend d'une session à l'autre ?
