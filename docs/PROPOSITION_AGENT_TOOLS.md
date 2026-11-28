# Proposition — `agent-tools` (Rust) et sobriété en tokens

**Date** : 2026-11-28 · **Statut** : option B validée et implémentée (ADR-045)

## 1. Problème

Les consignes proposées visent à réduire les tokens en confiant les outils à un binaire Rust
`agent-tools` (sous-commandes `fs`, `git`, `search`, `run`, `net`), exposé par une CLI ou par un
serveur MCP à un seul outil.

Les tokens dépendent de ce que le modèle lit (prompt système, schémas, résultats), pas du langage
qui exécute l'outil. À format de sortie égal, Rust ne fait gagner aucun token. La proposition
sépare donc les deux sujets : **format** et **langage**.

## 2. Mesures

Prises sur la copie de travail (modifications non commitées comprises), Node v26.5.1, sans
inférence. Tailles en caractères ; tokens estimés à 4 caractères par token.

| Prompt système (tâche de correction, mini-projet) | Total | Dont catalogue | Outils |
|---|---|---|---|
| Cloud | 18 532 (~4 630 tk) | 4 968 (27 %) | 26 |
| Cloud, `dynamicTools: false` | 24 964 | 11 400 (46 %) | 60 |
| Local 3B | 12 989 (~3 250 tk) | 4 285 (33 %) | 26 |

- **Schémas MCP** : 23 outils, 8 931 caractères (~2 230 tk).
- **`search_grep`, 50 résultats** : JSON actuel contre texte groupé par fichier.

| Motif (dossier) | JSON | Groupé | Écart |
|---|---|---|---|
| `function` (racine) | 9 022 | 2 772 | −69 % |
| `function` (src) | 5 384 | 2 934 | −46 % |
| `require` (src) | 5 475 | 3 020 | −45 % |
| `TOOLS` (src) | 6 170 | 3 767 | −39 % |
| `ok: false` (src) | 6 539 | 4 127 | −37 % |

- **NDJSON** (demandé par les consignes), motif `function` à la racine : 8 998 contre 9 022,
  soit −0,3 %. Il ne règle rien : le chemin et les clés restent répétés à chaque ligne.
- **Troncature locale** : un résultat est coupé à 6 000 caractères en local (24 000 en cloud).
  Trois des cinq cas ci-dessus dépassent 6 000 en JSON, aucun en format groupé.
- **Vitesse** : une recherche sans résultat sur tout le dépôt prend 706 ms (médiane de 5). Une
  étape locale mesurée dans ADR-044 prend 30 à 75 s, soit environ 1 à 2 % pour la recherche.

## 3. Conflits entre les consignes et le projet

| Consigne | Conflit |
|---|---|
| Binaire `fs` qui écrit | `path-guard`, `.harnessignore`, sauvegarde, aperçu, approbation et attestation d'écriture (ADR-038) sont à réécrire en Rust, donc en double |
| Sous-commandes `run`, `net` | Risque de contourner `enableShell = false`, l'environnement filtré (ADR-034, 042) et les domaines autorisés des tokens (ADR-041) |
| Générer des scripts shell au lieu d'appels | Exige le shell, désactivé par défaut (ADR-006) |
| Un seul outil avec `action` | Le périmètre strict (mode plan, sous-agents), `validate.js` et les familles (ADR-018) reposent sur les noms d'outils |
| Schéma de 200 tokens au maximum | Environ 35 caractères par outil pour les 23 outils MCP : trop peu pour décrire les arguments |
| Pas de wrapper Node | Le harness entier est en Node |
| Binaire Rust | Nouvelle chaîne de compilation (`cargo` et `rustc` absents du PATH), binaire à empaqueter et à signer ; ADR-025, 027 et 036 ont écarté tree-sitter, notamment pour ses binaires natifs |

## 4. Options

| Option | Gain en tokens | Coût et risque |
|---|---|---|
| **A. Ne rien changer** | Aucun | Nul. La troncature locale des recherches reste |
| **B. Format compact en JavaScript** | −37 à −69 % sur les résultats de recherche mesurés | Faible : texte réinjecté au modèle seulement, contrat `{ ok, matches }` inchangé |
| **C. Recherche Rust en lecture seule**, repli JavaScript | Aucun de plus que B | Moyen : toolchain, empaquetage, deux implémentations ; gain de temps d'environ 0,7 s au mieux par recherche complète sur ce dépôt |
| **D. Consignes complètes** : binaire unique remplaçant les outils | Non mesuré au-delà du format | Élevé : réécriture des garde-fous, interfaces publiques modifiées, régressions probables |
| **E. MCP à un seul outil** (indépendant de Rust) | Au plus ~2 230 tk pour un client MCP, moins le schéma restant | Moyen : casse le schéma MCP public ; sans effet sur la boucle interne de l'agent |

## 5. Recommandation : option B

Elle traite le gaspillage mesuré sans dépendance, sans binaire et sans toucher aux garde-fous.
Rust (option C) se justifierait si une mesure montrait que les outils pèsent dans le temps d'une
tâche, par exemple sur un très gros dépôt.

Périmètre si validée :

1. `src/harness/agent.js` : pour `search_grep` réussi, injecter dans le message un texte groupé
   (le chemin une fois, puis `ligne:texte` ; `ligne-texte` pour les lignes de contexte).
2. La trace, l'interface et le serveur MCP gardent le résultat structuré actuel.
3. Un test sur le format, dont le cas `context_lines` et la troncature.
4. ADR-045 dans `docs/DECISIONS.md`.

`agent.js` porte déjà des modifications non commitées : les commiter avant.

## 6. Limites

- La fréquence de `search_grep` dans de vraies tâches n'est pas mesurée : le gain par tâche est
  inconnu.
- L'effet du format sur la compréhension d'un modèle 3B n'est pas testé : un essai avec un modèle
  réel reste nécessaire.
- Le prompt système reste le premier poste, repayé à chaque appel sans cache. Le réduire est un
  sujet distinct, non traité ici.

## 7. Constats annexes

- `CAHIER_DES_CHARGES.txt`, cité par `CLAUDE.md` comme source de vérité, est introuvable dans ce
  dossier.
- `CLAUDE.md` dit que `git_*` est en lecture seule, alors que `git_create_branch` et `git_commit`
  existent.
