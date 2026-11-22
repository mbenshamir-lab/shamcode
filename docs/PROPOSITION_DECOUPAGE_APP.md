# Proposition — découpage de `src/renderer-visible/app.js`

> **Statut : proposition, non implémentée.** Changement structurant au sens de
> `CLAUDE.md` (interface publique + plusieurs modules) : il attend une validation
> explicite. Ce document décrit le problème, les options et l'option recommandée.

## 1. Constat mesuré (2026-11-22)

| Mesure | Valeur |
|---|---|
| Lignes | 4 350 |
| Fonctions | 170 |
| `addEventListener` | 106 |
| `innerHTML` | 75 |
| Domaine couvert | chat, markdown, sessions, personas, orchestration, sous-agents, plan, design, apps, processus, réglages |

Le fichier est chargé comme script classique (`<script src="app.js">`), sans build,
et il s'exécute dans une IIFE : toutes les fonctions sont privées, aucune frontière
n'est exprimable. Les tests qui ont besoin d'une fonction la **ré-extrayent par regex**
(`tests/lib/app-module.js`), ce qui rend la moindre signature fragile.

## 2. Options

### A. Statu quo
Coût nul, mais : conflits de merge sur un seul fichier, revue difficile, tests couplés
au texte source, risque d'effet de bord entre panneaux.

### B. Modules classiques, namespace `window.ShamUI` (recommandé)
Extraire par lots les fonctions **pures** dans des fichiers chargés avant `app.js` :
`js/markdown.js` (`_renderMarkdown`, `_sparkline`, `_linkifyFiles`, `_highlight`),
`js/sessions.js` (rendu liste/détail), `js/orchestration.js` (cartes `_orch*`),
`js/design-panel.js`. Chaque fichier expose un objet sur `window.ShamUI`.
- Aucun build, aucun changement de `file://`, aucun changement de CSP.
- `app.js` garde le câblage DOM et l'état global.
- Les tests chargent le module directement (`require`-like via `vm`) au lieu d'extraire.
- Risque faible et progressif : un lot par PR.

### C. Passer le renderer en ESM (`<script type="module">`)
Plus propre (`import`/`export`), mais change l'ordre d'exécution (defer), l'accès aux
globals, et impose de convertir tous les renderers + les tests d'extraction. Risque
moyen, gain supérieur à B à long terme.

### D. Bundler (Vite/esbuild)
Ajoute une dépendance npm, une étape de build, et contredit la règle « pas de migration
technique non demandée ». Rejeté pour l'instant.

## 3. Découpage proposé (option B, 4 lots)

| Lot | Cible | Lignes estimées | Dépendances |
|---|---|---|---|
| 1 | `js/markdown.js` | ~330 | aucune (pur texte) |
| 2 | `js/orchestration.js` | ~300 | `_escHtml`, DOM chat |
| 3 | `js/sessions.js` | ~250 | IPC `listSessions`/`getSession` |
| 4 | `js/design-panel.js` | ~180 | IPC design |

Le lot 1 est le plus sûr : il est déjà couvert par 8 tests dédiés et n'a aucun accès
DOM hors chaîne retournée.

## 4. Contraintes à respecter

- `tests/lib/app-module.js:46` extrait `_renderMarkdown` par regex : à mettre à jour
  dans le même lot, sinon 3 fichiers de tests cassent.
- `index.html` doit charger les nouveaux scripts **avant** `app.js`.
- CSP : scripts locaux, donc aucune directive à changer.
- Zéro changement de comportement : les tests existants doivent passer sans adaptation
  autre que le chargement.

## 5. Recommandation

Commencer par le lot 1 (markdown) seul, mesurer le diff et les tests, puis décider des
lots suivants. Ne pas toucher au câblage d'état (`_currentSession`, `_orchState`,
`currentConfig`) : il reste dans `app.js` pour éviter une dépendance circulaire.

## 6. Décision attendue

Valider l'option B et l'ordre des lots, ou préférer C. Tant que ce document n'est pas
validé, `app.js` reste intact.
