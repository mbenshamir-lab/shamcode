# Code Harness — Règles pour l'agent IA

## Contexte
Application desktop Electron (Windows) : agent de code local piloté par LLM.
Spec complète : `CAHIER_DES_CHARGES.txt` (source de vérité absolue).
Passation vivante : `PASSATION.md` (état courant, prochaine étape).

---

## Règles d'architecture — NON-NÉGOCIABLES

1. **Le harness ne connaît pas Electron.**
   `src/harness/` n'importe jamais `electron`. Il reçoit `llmGenerate` en paramètre.

2. **Seul le harness touche le disque.**
   `src/renderer-visible/` et `src/renderer-hidden/` n'accèdent jamais au FS.
   Toutes les écritures passent par `path-guard.js`.

3. **path-guard sur chaque outil FS.**
   Toute fonction qui lit ou écrit un fichier appelle `makeGuard(projectRoot)` avant.

4. **backup avant toute écriture.**
   `write_file` et `replace_code` appellent `backup.snapshot()` avant d'agir.

5. **Clés API jamais en dur.**
   Toujours via `config.js` + `safeStorage` d'Electron. Jamais dans le code, jamais dans les logs.

---

## Stack technique

| Couche | Technologie |
|---|---|
| Runtime | Node.js 20 LTS + Electron 30+ |
| UI | HTML/CSS/JS vanilla (Svelte si complexité croît) |
| LLM local | WebLLM (@mlc-ai/web-llm) via WebGPU, renderer caché |
| LLM cloud | Gemini API officielle + Anthropic API officielle |
| Tests | `node --test` (pas de Jest, pas de Mocha) |
| Packaging | electron-builder → NSIS .exe |
| Modules | CommonJS dans `src/main/` et `src/harness/` — ESM dans `src/renderer-hidden/` (WebLLM) |

---

## Conventions de code

- **Commentaires** : français accepté, anglais aussi. Toujours le POURQUOI, jamais le QUOI.
- **Logs** : utiliser `src/harness/logger.js` uniquement. Zéro `console.log` en production.
- **Types** : JSDoc pour les fonctions publiques. TypeScript optionnel mais bienvenu.
- **Erreurs** : retourner `{ ok: false, error: 'CODE_ERREUR' }` — jamais throw dans les outils.
- **Lint** : ESLint + Prettier (config à créer en Phase 2).

---

## Canaux IPC — référence

```
main → hidden   : llm:request
hidden → main   : llm:reply:<uuid>  |  llm:ready  |  llm:progress
main → visible  : llm:status  |  agent:event
visible → main  : agent:run  |  config:get  |  config:set  |  engine:test
```

---

## Sécurité shell

- `enableShell = false` par défaut. Ne jamais inverser sans vérification de la config.
- `run_shell` n'est disponible que si `enableShell === true` dans la config chargée.
- `git_*` : lecture seule, jamais de modification du repo.

---

## Tests — couverture attendue

```
tests/parser.test.js   → extractToolCall (tous les cas de malformation JSON)
tests/tools.test.js    → read/write/replace/list + path-guard + backup
tests/agent.test.js    → boucle, retry, MAX_STEPS, trace
tests/router.test.js   → fallback chain, clé manquante, tous down
```

Commande : `npm test` → `node --test tests/`
Le harness doit être testable sans lancer Electron (llmGenerate est un mock).

---

## Modèles locaux (WebLLM) — référence rapide

| Modèle | VRAM | Usage |
|---|---|---|
| Qwen2.5-Coder-1.5B-q4f16_1-MLC | 2 Go | Tests rapides |
| Qwen2.5-Coder-3B-q4f16_1-MLC | 4 Go | Défaut recommandé |
| Qwen2.5-Coder-7B-q4f16_1-MLC | 8 Go | Prod avec bon GPU |
| Qwen2.5-Coder-14B-q4f16_1-MLC | 14 Go | RTX 3090+ |

---

## Points de vigilance critiques (à lire avant chaque session)

1. **`backgroundThrottling: false`** sur la fenêtre cachée — OBLIGATOIRE sinon la génération s'arrête.
2. **`replace_code` correspondance exacte** — CRLF vs LF sur Windows, espaces de fin. Normaliser avant comparaison.
3. **WebGPU flags** — `--enable-unsafe-webgpu` + `--enable-features=Vulkan,WebGPU` dans `main.js`.
4. **petits modèles < 3B** — le parser doit être ultra-tolérant, 2 retries sur JSON invalide minimum.
5. **safeStorage** — tester tôt (Phase 1), comportement variable selon install Electron.

---

## Règles de conservatisme — APPLICATION EN PRODUCTION

> L'application fonctionne. Chaque modification non demandée est un risque.

### Ce qui est interdit sans demande explicite

1. **Zéro refactoring opportuniste.**
   Ne pas renommer, réorganiser, ni extraire de fonctions sous prétexte de "nettoyer".
   Si le code existant fonctionne, il reste intact.

2. **Zéro ajout de fonctionnalité non demandée.**
   Ne pas ajouter de gestion d'erreur, de validation, de log, de fallback ou d'option
   si l'utilisateur n'a pas décrit ce besoin. "C'est une bonne idée" n'est pas une demande.

3. **Zéro modification des fichiers non concernés.**
   Toucher uniquement les fichiers directement liés à la demande.
   Ne pas "profiter" d'une ouverture de fichier pour corriger d'autres choses.

4. **Zéro changement cosmétique.**
   Pas de reformatage, pas de réordonnancement d'imports, pas d'ajout de commentaires
   explicatifs sur du code qui existait avant la session.

5. **Zéro migration technique non demandée.**
   Ne pas proposer de passer à TypeScript, ESM, un autre framework ou une autre API
   sans que l'utilisateur l'ait explicitement demandé.

### Ce qui est autorisé

- Corriger exactement ce qui est cassé ou demandé.
- Ajouter du code uniquement là où c'est nécessaire pour que la demande fonctionne.
- Mettre à jour les tests existants si une modification casse leur assertion (et expliquer pourquoi).
- Créer un nouveau test pour une nouvelle fonctionnalité demandée.

### Proposition obligatoire avant les changements structurants

Un changement est **structurant** s'il remplit l'une de ces conditions :
- Il touche plus de 2 modules distincts (ex. harness + main + renderer).
- Il modifie ou supprime une interface publique (signature de fonction exportée, canal IPC, schéma MCP, contrat `{ ok, error }`).
- Il introduit une nouvelle dépendance `npm`.

**Processus pour un changement structurant :**
1. Rédiger un document de proposition : description du problème, options envisagées avec leurs trade-offs, option recommandée et raison.
2. Ne pas écrire de code. Attendre la validation explicite de l'utilisateur.
3. Après validation, enregistrer la décision dans `docs/DECISIONS.md` (nouveau ADR).
4. Implémenter uniquement l'option validée.

> Un "c'est logique" ou "c'est la suite naturelle" n'est pas une validation. La validation est un message explicite de l'utilisateur.

---

### Processus obligatoire avant toute modification

1. Lire le fichier cible en entier.
2. Identifier la ligne ou le bloc précis à modifier.
3. Ne toucher que ce bloc — pas une ligne de plus.
4. Expliquer en une phrase pourquoi cette modification est nécessaire.

---

## Phase actuelle et prochaine action

→ Voir `PASSATION.md` pour l'état exact et le point de reprise.
