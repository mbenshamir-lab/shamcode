# ShamCode

**🇫🇷 Français** · [🇬🇧 English below](#english)

Agent de code desktop pour Windows, piloté par un LLM. Il tourne en local (WebLLM via WebGPU, ou CPU) avec repli sur des API cloud (Gemini, Claude, ou tout service compatible OpenAI). Développé par **ShamDev**.

## Fonctionnalités

- **LLM local ou cloud** : WebLLM (WebGPU), moteur CPU, Gemini, Claude, endpoint compatible OpenAI, avec chaîne de repli entre moteurs.
- **Outils de fichiers sûrs** : lecture, écriture, remplacement de code, listage — chaque accès passe par un *path-guard* et chaque écriture est précédée d'une sauvegarde.
- **Shell désactivé par défaut** : `run_shell` n'existe que si tu l'actives dans la configuration. Les outils `git_*` sont en lecture seule.
- **Clés API chiffrées** : stockées via `safeStorage` d'Electron (DPAPI sous Windows), jamais en clair ni dans les logs.
- **Dictée vocale** locale (Whisper en WASM), serveur MCP, CLI (`bin/harness.js`), planificateur de tâches.

## Installation (utilisateurs)

1. Va dans l'onglet **Releases** du dépôt et télécharge `ShamCode Setup x.y.z.exe`.
2. Lance l'installeur (Windows 10/11, x64). Il n'est pas signé : Windows SmartScreen peut demander une confirmation.
3. Au premier lancement, ouvre les **Paramètres** et renseigne ton moteur : un modèle local (GPU requis, téléchargement au premier usage) ou une clé API cloud.

Aucune clé ni donnée n'est fournie avec l'application : chaque utilisateur démarre à vide. Tes données sont dans `%APPDATA%\code-harness`.

## Développement

Prérequis : Node.js 20 LTS, Windows.

```bash
npm install
npm start          # lance l'application Electron
npm test           # tests (node --test)
npm run lint
npm run build:win  # génère l'installeur NSIS dans dist/
```

## Architecture

| Dossier | Rôle |
|---|---|
| `src/main/` | Processus Electron (fenêtres, IPC, config, clés chiffrées) |
| `src/harness/` | Logique de l'agent (boucle, outils, parser, routeur LLM). N'importe jamais `electron` |
| `src/renderer-visible/` | Interface utilisateur |
| `src/renderer-hidden/` | Fenêtre cachée qui héberge WebLLM |
| `src/mcp-server/`, `src/cli/` | Serveur MCP et CLI, sans Electron |

Détails : [`docs/MODULES.md`](docs/MODULES.md) et [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Contribuer

Les issues et pull requests sont les bienvenues. Lis d'abord [`CLAUDE.md`](CLAUDE.md) : il décrit les règles d'architecture (harness indépendant d'Electron, path-guard sur chaque outil de fichier, sauvegarde avant écriture, aucune clé en dur) et la politique de changements minimaux. Les tests doivent passer (`npm test`).

## Licence

[MIT](LICENSE)

---

<a id="english"></a>

# ShamCode (English)

A Windows desktop code agent driven by an LLM. It runs locally (WebLLM via WebGPU, or CPU) and falls back to cloud APIs (Gemini, Claude, or any OpenAI-compatible service). Built by **ShamDev**.

## Features

- **Local or cloud LLM**: WebLLM (WebGPU), CPU engine, Gemini, Claude, OpenAI-compatible endpoint, with a fallback chain between engines.
- **Safe file tools**: read, write, replace code, list — every access goes through a path guard and every write is preceded by a backup.
- **Shell off by default**: `run_shell` only exists if you enable it in the configuration. `git_*` tools are read-only.
- **Encrypted API keys**: stored with Electron's `safeStorage` (DPAPI on Windows), never in plain text or logs.
- Local **voice dictation** (Whisper in WASM), MCP server, CLI (`bin/harness.js`), task scheduler.

## Install (users)

1. Open the repository's **Releases** tab and download `ShamCode Setup x.y.z.exe`.
2. Run the installer (Windows 10/11, x64). It is unsigned, so Windows SmartScreen may ask for confirmation.
3. On first launch, open **Settings** and configure your engine: a local model (GPU required, downloaded on first use) or a cloud API key.

No key or data ships with the app: every user starts from a clean slate. Your data lives in `%APPDATA%\code-harness`.

## Development

Requirements: Node.js 20 LTS, Windows.

```bash
npm install
npm start          # run the Electron app
npm test           # tests (node --test)
npm run lint
npm run build:win  # build the NSIS installer into dist/
```

## Contributing

Issues and pull requests are welcome. Read [`CLAUDE.md`](CLAUDE.md) first: it lists the architecture rules (harness independent of Electron, path guard on every file tool, backup before write, no hardcoded keys) and the minimal-change policy. Tests must pass (`npm test`).

## License

[MIT](LICENSE)
