# Exemples de test — rendu du chat

Copie un bloc dans la zone de saisie, envoie-le, observe. Chaque cas correspond à une règle réellement implémentée dans `_renderMarkdown()` (`src/renderer-visible/app.js`).

## 1. Courbe (sparkline)

Bloc de code dont le langage est exactement `sparkline` — valeurs séparées par espaces, virgules ou points-virgules.

```sparkline
3 7 4 9 12 8 15 11 18
```

Variante une valeur par ligne (ce que produit souvent un modèle) :

```sparkline
120
135
128
160
150
143
190
```

Attendu : une ligne bleue remonte, le dernier nombre (18 / 190) affiché à droite.

Cas limites volontaires :
- `42` seul — moins de 2 valeurs → `_sparkline()` retourne `''`, repli sur le bloc de code brut.
- `a b c` — aucun nombre exploitable → même repli, aucun plantage.

## 2. Titres

```
# Niveau 1 → h4
## Niveau 2 → h5
### Niveau 3 → h6
#### Niveau 4 → h6
```

Attendu : quatre tailles décroissantes, jamais de `h1` dans la bulle.

## 3. Listes

```
- premier point
- deuxième point
* puce avec astérisque

1. étape un
2. étape deux
```

Astuce implémentée : une ligne vide entre deux puces ne casse pas la liste.

## 4. Mise en forme en ligne

```
**gras**, *italique* et `du code` dans la même phrase.
```

Attendu : trois styles distincts, aucun astérisque visible.

## 5. Liens de fichiers cliquables

```
J'ai modifié src/renderer-visible/app.js et src/main/ipc.js:42.
```

Attendu : deux boutons ouvrant la visionneuse, le second porte `data-line="42"`.

## 6. Bloc de code coloré

```js
const span = max - min || 1;
// commentaire
return points;
```

Attendu : en-tête `js`, bouton Copier, mots-clés colorés, commentaire gris italique.

## 7. Mélange complet

```
## Bilan

**1. Modifié**
- src/renderer-visible/app.js:1865 — `_sparkline()`
- src/renderer-visible/styles.css:2170 — styles de la courbe

**2. Mesure**

```sparkline
0 12 25 31 44 58 61 79 88
```

**3. Reste**
1. tester à la main
2. vérifier le thème clair
```

Attendu : titre h5, deux sections, une courbe, aucun `**` visible.

## 8. Ce qui ne marche PAS (texte brut, pas un bug)

```
| colonne | colonne |
|---------|---------|
| a       | b       |

> citation

---

[lien](https://example.com)

![image](img.png)

~~barré~~
- niveau 1
  - niveau 2 imbriqué
```

Tableaux, citations, règles horizontales, liens markdown, images et puces imbriquées : non implémentés. Les tableaux et les images sont les deux manques les plus visibles.

## 9. Emojis

Aucun code dédié, ils passent tels quels :

```
✅ terminé — ⚠️ attention — ❌ échec
```

## 10. Non-régression XSS

```
<script>alert('xss')</script>
```

Attendu : le texte s'affiche littéralement, aucune alerte (échappement HTML hors blocs de code).
