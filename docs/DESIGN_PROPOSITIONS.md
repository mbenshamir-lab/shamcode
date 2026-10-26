# Propositions design — ShamCode (0.3.0)

Audit mesuré sur `src/renderer-visible/styles.css` (4 921 lignes) et `index.html` (503 lignes).

## Déjà conforme — ne pas toucher

| Point | Mesure |
|---|---|
| Anneau de focus global | `:where(...):focus-visible` + `!important` (l. 97-104), conforme 2.4.7 |
| Mouvement réduit | `@media (prefers-reduced-motion)` (l. 107), conforme 2.3.3 |
| Densité | `--fs-base/--fs-sm/--fs-xs` (bloc DENSITÉ) |
| Contraste accent (dark) | 9,10 / 8,57 / 7,74 — AAA |

---

## P0 — Accessibilité

### 1. Quatre contrastes sous AA

| Paire | Ratio | Correctif | Nouveau |
|---|---|---|---|
| `--error` #ef4444 / `--bg-elevated` | 3,90 | #f87171 | 6,01 |
| `--error` #ef4444 / `--bg` 3 | 4,42 | #f87171 | 5,31 |
| thème clair #dc2626 / bg 3 | 3,95 | #b91c1c | 5,29 |
| `--text-subtle` / `--bg-elevated` | 4,30 | #8f8f9a | ~5,1 |

Le rouge sur fond élevé est aujourd'hui le texte le moins lisible de l'app (diffs, échecs d'outil).

### 2. 147 tailles de police sous 12 px (min 8 px)

234 `font-size` en px hors `:root`, seulement 7 tokenisés. Échelle unique à poser :

- `--text-2xs: 11px` — badges, plancher absolu
- `--text-xs: 12px`
- `--text-sm: 13px`
- `--text-md: 14px` — base
- `--text-lg: 16px`

Bénéfice secondaire : la densité compact/spacious ne redéfinit plus que 5 variables.

---

## P1 — Cohérence

### 3. Aucun responsive : 1 seul `@media` sur 4 921 lignes

- max-width 1200px : `#task-panel { display: none }`
- max-width 900px : sidebar à 56px, `.sb-label` masqué
- max-width 640px : sidebar en `position: absolute; z-index: 40`

### 4. 135 couleurs hex hors tokens

Ce sont elles qui cassent au changement de thème. `batch_replace` par famille, `diff_file` entre chaque lot.

### 5. 92 `border-radius` en dur

Tokens : `--r-sm: 4px`, `--r-md: 6px`, `--r-lg: 10px`, `--r-pill: 999px`.

---

## P2 — Ergonomie

### 6. Topbar : 5 indicateurs de même poids

`#engine-dot`, `#engine-label`, `#engine-state`, `#token-counter`, `#ctx-usage` s'alignent sans hiérarchie. Garder `#engine-state` seul en graisse 500, les autres en `--text-subtle`, séparateurs verticaux.

### 7. Zone de saisie : 8 contrôles de poids égal

`btn-attach` · `mode-toggle` (2) · `btn-approval` · `btn-tdd` · `model-pill` · `persona-select` · envoyer. Deux niveaux : fréquent en bas (joindre · modèle · envoyer), avancé derrière « ⋯ » (mode · validation · TDD · persona).

### 8. Chat vide = zone blanche

3 suggestions cliquables et rappel `Ctrl+L`, sur le patron de `#prompt-examples` déjà présent.

### 9. `#engine-state` sans `aria-live`

Il passe de « Initialisation… » à « Prêt » puis « Erreur » sans annonce. `#active-plan` porte déjà `aria-live="polite"` : même patron à appliquer.

---

## Ordre conseillé

1. Contrastes (2 h, zéro risque de mise en page)
2. Échelle `--text-*` et migration des 147 tailles (1 j, mécanique)
3. Tokens `--r-*` et couleurs (1 j, par lot)
4. Responsive 3 paliers (1/2 j, vérif fenêtre réelle)
5. Toolbar et états vides (1 j, touche `app.js`)
