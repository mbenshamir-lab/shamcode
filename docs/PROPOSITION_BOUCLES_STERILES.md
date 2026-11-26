# Proposition — Arrêter les boucles stériles

**Date** : 2026-11-26 · **Statut** : validée en entier et implémentée (ADR-043). Après, les
cinq boucles du §1.1 s'arrêtent à 10, 10, 12, 12 et 15 générations.
Complète `PROPOSITION_STAGNATION.md` (ADR-039).

## 1. Constat

### 1.1 Simulation sur le code actuel

Modèle scripté, limite de 25 étapes, aucune requête réseau vers un modèle.

| Boucle | Générations avant arrêt | Pourquoi rien ne l'arrête |
|---|---|---|
| Réponse toujours illisible | 75 | une réponse illisible sort de la boucle avant les détecteurs |
| Outil interdit répété (mode Plan) | 25 | même sortie anticipée |
| Écriture qui alterne entre A et B | 25 | toute écriture réussie compte comme un progrès |
| Correction puis test, même échec | 25 | chaque écriture remet le compteur à zéro |
| Attente d'un service absent | 25 | les consultations sont exclues des deux détecteurs |
| Témoin : appel identique | 5 | déjà protégé |

### 1.2 Sessions réelles rejouées

Application installée, 22 novembre : 17 sessions, dont 5 réussies. 9 n'ont aucune étape ; les
8 autres (5 succès, 3 échecs) sont rejouées ici. Cette version précédait ADR-039.

| Mesure (maximum par session) | Succès | Échec 1 (292 générations) | Échec 2 (192) | Échec 3 (60) |
|---|---|---|---|---|
| Réponses illisibles d'affilée | 1 | 2 | 1 | 1 |
| Réponses illisibles sur 20 | 2 | **11** | 5 | 1 |
| Consultations d'affilée | 6 | 0 | **23** | 9 |
| Même échec de commande ou de test | 1 | 1 | 3 | 1 |
| Étapes sans progrès, détecteur actuel | 5 | 5 | 7 | 4 |

- **Le détecteur actuel n'aurait arrêté aucun de ces trois échecs** (seuil : 10).
- Les réponses illisibles ne s'enchaînent jamais : un seuil « d'affilée » ne servirait à rien.
- Pendant les 23 consultations, 22 résultats diffèrent : attendre seulement sur résultat
  identique ne servirait à rien non plus.

**Limites** : huit sessions, un seul jour, une ancienne version, moteur non enregistré par session.
Après un avertissement ou un arrêt, la suite réelle d'une session est inconnue. Les seuils
ci-dessous sont des points de départ, pas des valeurs démontrées.

## 2. Piste 1 — Compter les réponses inutilisables

Inutilisable : JSON illisible, aucun outil nommé, ou outil hors périmètre. Chaque génération
compte, reprises comprises.

| Option | Principe | Verdict |
|---|---|---|
| A. Ajouter au compteur de stagnation | un succès le remet à zéro | une alternance 1 sur 2 passe |
| B. Seuil d'échecs d'affilée | simple | réel : jamais plus de 2 |
| **C. Fenêtre glissante (recommandé)** | part des inutilisables sur les 20 dernières | seule à voir l'échec 1 |

**C** : avertissement à 6 sur 20, arrêt `RÉPONSES_INUTILISABLES` à 10 sur 20.

- L'avertissement montre le format attendu et, si aucun outil n'est nommé, **les noms des clés
  reçues** (« reçu : name, arguments »).
- Le journal garde ces noms de clés, jamais les valeurs : on saura enfin pourquoi un modèle
  se trompe.
- Les reprises par étape (`retryOnParseError`) sont inchangées.
- Rejeu : échec 1 averti à la génération 24 et arrêté à la 39 ; aucune autre session touchée.
- Simulation attendue : 75 → 10 générations ; outil interdit 25 → 10.

## 3. Piste 2 — Mesurer le progrès sur l'état du projet

| Option | Principe | Verdict |
|---|---|---|
| A. État déjà vu | une écriture ne compte que si le fichier prend un contenu inédit | arrête l'alternance, pas le test qui échoue |
| B. Même échec répété | compte les échecs identiques de test ou de commande | arrête le test, pas l'alternance sans test |
| **A + B (recommandé)** | les deux | couvre les deux cas |
| C. Ignorer les écritures | seuls les tests comptent | couperait un travail sans tests |

- **A** : l'empreinte vient de la relecture serveur existante (ADR-038) ; une suppression est
  l'état « absent ».
- **B** : signature = outil, commande, sortie sans les durées, dates et heures, code de sortie.
  Avertissement à 3, arrêt `ÉCHEC_RÉPÉTÉ` à 6. Le compteur repart quand le test passe **ou
  quand un fichier jamais modifié est touché** : construire plusieurs fichiers avant que le
  test passe reste possible.
- Simulation attendue : les deux boucles s'arrêtent vers 12 générations au lieu de 25.
- Preuve réelle **faible** : au plus 3 échecs identiques observés. Cette piste repose surtout
  sur la simulation.

## 4. Piste 3 — Attendre sans générer

Concerne `get_output`, `check_service`, `browser_wait`, `list_processes`, `read_messages`.

| Option | Principe | Verdict |
|---|---|---|
| A. Compter comme stagnation | arrêt à 10 | couperait une attente légitime |
| B. Délai sur résultat identique | n'attend que si rien ne change | réel : 22 résultats sur 23 diffèrent |
| **C. Délai sur consultations d'affilée (recommandé)** | quel que soit le résultat | agit sur le cas observé |
| D. Paramètre d'attente dans les outils | le modèle demande à attendre | change les schémas MCP ; le modèle peut l'ignorer |

**C** : à partir de la 3ᵉ consultation d'affilée, le harness attend 2, 4, 8, 16 puis 30 s avant
de l'exécuter. Avertissement à la 8ᵉ, arrêt `ATTENTE_SANS_FIN` à la 15ᵉ, soit environ 5 minutes
d'attente cumulée. Tout autre outil remet le compteur à zéro. Le bouton Stop interrompt
l'attente.

- Gain : chaque génération couvre plus de temps, donc moins de générations pour la même
  attente. Le gain réel **ne se mesure pas** sur les sessions (pas d'horodatage par étape).
- Coût : dans les sessions réussies observées, une suite de 6 consultations aurait pris 30 s
  de plus.
- Une attente de plus de 5 minutes sans autre action serait coupée.
- Simulation attendue : 25 → 15 générations.

## 5. Périmètre et vérification

- `src/harness/agent.js` et un test. Aucune interface publique, aucun canal IPC, aucun schéma,
  aucune dépendance. Trois nouveaux codes d'erreur.
- `scripts/sim-boucles.js` complété avec les cinq boucles du §1.1, avant et après.
- `tests/loop-efficiency.test.js` : chaque boucle s'arrête sous son objectif ; les tests « le
  vrai travail n'est jamais coupé » passent sans modification, plus deux cas ajoutés
  (construire plusieurs fichiers avec un test rouge, attendre un serveur lent).
- `node tests/eval/run.js --strict` : 20 tâches vertes.
- Journal de fin de tâche : générations, réponses inutilisables, secondes d'attente, motif
  d'arrêt.

Après validation : ADR-043 dans `docs/DECISIONS.md`, puis les seules pistes retenues, une par
une, dans l'ordre 1, 2, 3.

## 6. Décisions demandées

1. **Pistes** : 1, 2 et 3 (recommandé), ou seulement certaines ?
2. **Petits modèles locaux**, plus sujets aux réponses illisibles : seuil plus tolérant,
   14 sur 20 (recommandé, sans mesure pour l'appuyer), ou le même que le cloud ?
3. **Même échec répété** : arrêter à 6 (recommandé), ou seulement avertir ?
