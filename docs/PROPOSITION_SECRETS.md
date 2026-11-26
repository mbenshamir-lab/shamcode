# Proposition — protection des secrets et des tokens d'API

**Date** : 2026-11-26 · **Statut** : validée en entier et implémentée (ADR-041). Choix retenus :
repli base64 avec avertissement, tokens sans domaine refusés.

Changement structurant (CLAUDE.md) : format de `config.json`, contenu renvoyé par les canaux
`config:get` / `config:updated`, trois modules (main, renderers, harness).

## 1. Le problème

| Secret | Sur disque (`config.json`) | Envoyé aux renderers |
|---|---|---|
| `model.engines.<nom>.apiKey` | chiffré | **en clair** |
| `customProviders[].apiKey` | **en clair** | **en clair** |
| `apiTokens.<nom>` | **en clair** | **en clair** |
| `connectors[].auth` | **en clair** | **en clair** |

- La règle 5 (« clés API toujours via `config.js` + `safeStorage` ») n'est tenue que pour les moteurs.
- Toute injection de code dans un renderer donnerait toutes les clés.
- `call_api` envoie le token nommé par le modèle à **n'importe quelle URL** choisie par le modèle.
  Une page web ou un fichier piégé peut donc faire sortir un token.
- Quand `safeStorage` ne fonctionne pas, `safe-keys.js` enregistre en base64 : ce n'est pas
  un chiffrement.

## 2. Chiffrement sur disque

`safe-keys.js` chiffre aussi les trois familles en clair (`apiKeyEncrypted`,
`apiTokensEncrypted`, `authEncrypted`). En mémoire, le processus principal garde les valeurs
déchiffrées : le harness ne change pas.

- Migration automatique : une valeur en clair est chiffrée à la première sauvegarde.
- Si un déchiffrement échoue, le champ chiffré est **conservé**, jamais écrasé par une chaîne vide.
- Retour en arrière : une version antérieure de l'application ne relira pas ces trois familles.
- La CLI (`~/.harness/config.json`) reste en clair : elle n'a pas accès à `safeStorage`.

## 3. Ce que reçoivent les renderers

| Option | Contenu | Pour | Contre |
|---|---|---|---|
| A. Rien ne change | — | aucun risque de régression | les clés restent exposées |
| **B. Masquage (recommandé)** | chaque secret est remplacé par un indicateur `hasKey` | un renderer ne détient plus aucune clé enregistrée | touche les deux interfaces |
| C. Valeur factice (`••••1234`) | la valeur factice signifie « inchangé » | moins de code d'interface | une valeur factice sauvegardée par erreur détruit la clé |

Travail pour B :
- `config:get` et `config:updated` passent par une fonction qui retire les secrets.
- `config:set` fusionne : fournisseurs et connecteurs par `id`, tokens par nom. Champ absent ou
  vide = inchangé ; suppression = retrait de l'entrée.
- `models:list` accepte un `providerId` pour utiliser la clé enregistrée (aujourd'hui la clé
  vient du champ de saisie).
- `app.js` : `p.apiKey` devient `p.hasKey` (pastille de modèle, barre d'état).
- `settings.js` : champs clé et token vides avec la mention « enregistrée ».

Risque principal : `app.js` renvoie la configuration entière à `config:set`. La fusion doit être
couverte par des tests avant tout le reste, sinon une sauvegarde peut effacer des clés.

## 4. Destinations autorisées pour `call_api`

| Option | Principe | Pour | Contre |
|---|---|---|---|
| **A. Domaines par token (recommandé)** | nouvelle table `apiTokenHosts: { <nom>: ["api.github.com"] }` ; sans domaine déclaré ou hors liste, refus | protège aussi en mode Action | une saisie de plus par token |
| B. Approbation à chaque usage | demande à l'utilisateur | aucun réglage | sans effet en mode Action, où rien n'est demandé |
| C. Premier usage mémorisé | le premier domaine est retenu | aucun réglage | le premier appel peut déjà être le piège |

Avec A : HTTPS obligatoire (HTTP admis vers localhost seulement) et redirections non suivies
quand un token est joint. `apiTokens` garde son format ; un champ « Domaines » s'ajoute à
chaque ligne de token. **Les tokens existants sont refusés tant qu'aucun domaine n'est saisi** ;
le message d'erreur indique où le renseigner.

## 5. Recommandation et ordre

1. Domaines par token (§4 A) : le risque le plus exploitable, pour le moins de code.
2. Chiffrement sur disque (§2).
3. Masquage côté renderers (§3 B).

Chaque étape est livrable seule, avec ses tests. Après validation : ADR-041 dans
`docs/DECISIONS.md`.

## 6. Questions à trancher

1. Validez-vous les trois étapes, ou seulement certaines ?
2. Quand `safeStorage` est inopérant : garder le repli base64 avec un avertissement dans les
   Paramètres (recommandé), ou refuser d'enregistrer la clé ?
3. Tokens existants sans domaine : les refuser (recommandé), ou les laisser passer pendant une
   version avec un avertissement ?
