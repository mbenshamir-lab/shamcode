# Contribuer à ShamCode / Contributing

Merci de ton intérêt ! / Thanks for your interest!

## Démarrer / Getting started

```bash
git clone https://github.com/mbenshamir-lab/shamcode.git
cd shamcode
npm install
npm start      # lance l'app Electron / run the app
npm test       # doit passer à 100 % / must be 100% green
npm run lint
```

Prérequis / Requirements : Node.js 20 LTS, Windows.

## Règles d'architecture (non négociables) / Architecture rules

1. `src/harness/` n'importe jamais `electron` (le LLM est injecté en paramètre).
2. Seul le harness touche le disque ; les renderers n'accèdent jamais au système de fichiers.
3. Chaque outil de fichier passe par `path-guard` ; chaque écriture est précédée d'une sauvegarde.
4. Aucune clé API en dur, ni dans les logs.
5. Les outils retournent `{ ok: false, error: 'CODE' }` au lieu de lancer une exception.

Détails dans [`CLAUDE.md`](CLAUDE.md) et [`docs/MODULES.md`](docs/MODULES.md).

## Proposer une modification / Pull requests

- Ouvre d'abord une **issue** pour les changements importants (nouvelle dépendance, nouveau canal IPC, changement d'interface publique).
- Fais des changements **minimaux et ciblés** : pas de refactoring ni de reformatage sans rapport avec la PR.
- Ajoute ou mets à jour les **tests** (`node --test`, pas de Jest ni Mocha).
- Vérifie que `npm test` et `npm run lint` passent avant d'ouvrir la PR.

## Signaler un bug / Reporting bugs

Utilise le modèle d'issue « Bug ». N'inclus **jamais** de clé API ni de données personnelles dans une issue.
Pour une faille de sécurité, ne l'ouvre pas en public : contacte le mainteneur via son profil GitHub.
