/**
 * Schémas JSON des outils harness pour le serveur MCP.
 * Le LLM client (Claude Desktop, VS Code, etc.) reçoit ces schémas
 * et appelle les outils directement — aucun moteur LLM côté serveur.
 */

const TOOL_SCHEMAS = [
  {
    name: 'read_file',
    description: 'Lit le contenu d\'un fichier du projet (ou une plage de lignes).',
    inputSchema: {
      type: 'object',
      properties: {
        path:       { type: 'string',  description: 'Chemin relatif au dossier projet' },
        start_line: { type: 'integer', description: 'Ligne de début (1-indexé, inclusif)' },
        end_line:   { type: 'integer', description: 'Ligne de fin (1-indexé, inclusif)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Crée ou écrase un fichier (backup automatique avant écriture).',
    inputSchema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Chemin relatif au dossier projet' },
        content: { type: 'string', description: 'Contenu complet du fichier' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'replace_code',
    description: 'Remplace une chaîne exacte dans un fichier (fuzzy si espaces en fin de ligne). Backup auto.',
    inputSchema: {
      type: 'object',
      properties: {
        path:       { type: 'string', description: 'Chemin relatif au dossier projet' },
        old_string: { type: 'string', description: 'Chaîne exacte à remplacer' },
        new_string: { type: 'string', description: 'Chaîne de remplacement' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'Liste les fichiers et dossiers d\'un répertoire.',
    inputSchema: {
      type: 'object',
      properties: {
        path:      { type: 'string',  description: 'Chemin relatif (défaut : racine du projet)' },
        recursive: { type: 'boolean', description: 'Lister récursivement' },
        depth:     { type: 'integer', description: 'Profondeur max (1–5, défaut 3)' },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Supprime un fichier (backup automatique avant suppression).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif au dossier projet' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Déplace ou renomme un fichier (backup automatique).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Source (chemin relatif)' },
        dest: { type: 'string', description: 'Destination (chemin relatif)' },
      },
      required: ['path', 'dest'],
    },
  },
  {
    name: 'search_grep',
    description: 'Recherche un pattern (regex ou littéral) dans les fichiers du projet.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern:       { type: 'string',  description: 'Pattern regex à rechercher' },
        path:          { type: 'string',  description: 'Sous-dossier de départ (optionnel)' },
        ext:           { type: 'string',  description: 'Filtrer par extension (ex : .js)' },
        context_lines: { type: 'integer', description: 'Lignes de contexte autour du match (0–5)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Trouve une fonction, classe ou variable par nom dans le projet (avec numéro de ligne).',
    inputSchema: {
      type: 'object',
      properties: {
        name:  { type: 'string',  description: 'Nom (partiel ou exact) du symbole' },
        path:  { type: 'string',  description: 'Sous-dossier de recherche (optionnel)' },
        exact: { type: 'boolean', description: 'Correspondance exacte uniquement' },
      },
      required: ['name'],
    },
  },
  {
    name: 'batch_replace',
    description: 'Remplace un pattern regex dans tous les fichiers du projet. Backup avant chaque écriture.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern:     { type: 'string',  description: 'Pattern regex à remplacer' },
        replacement: { type: 'string',  description: 'Texte de remplacement (défaut : chaîne vide)' },
        path:        { type: 'string',  description: 'Sous-dossier de départ (optionnel)' },
        ext:         { type: 'string',  description: 'Filtrer par extension (ex : .js)' },
        dry_run:     { type: 'boolean', description: 'Simuler sans écrire (liste les fichiers concernés)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_project_info',
    description: 'Lit les métadonnées du projet (nom, version, dépendances, scripts). Détecte Node/Rust/Go/Python.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_tests',
    description: 'Lance la suite de tests du projet (auto-détecte npm/cargo/pytest/go test).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Commande de test manuelle (ex : npm test)' },
      },
    },
  },
  {
    name: 'restore_file',
    description: 'Restaure un fichier depuis son backup (annule une modification).',
    inputSchema: {
      type: 'object',
      properties: {
        path:         { type: 'string',  description: 'Chemin relatif au dossier projet' },
        list:         { type: 'boolean', description: 'Lister les backups disponibles' },
        backup_index: { type: 'integer', description: 'Index du backup (0 = plus récent)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'diff_file',
    description: 'Affiche le diff entre le fichier courant et son backup.',
    inputSchema: {
      type: 'object',
      properties: {
        path:         { type: 'string',  description: 'Chemin relatif au dossier projet' },
        backup_index: { type: 'integer', description: 'Index du backup (0 = plus récent)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'git_status',
    description: 'Fichiers modifiés dans le repo git (lecture seule).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Diff git des fichiers modifiés (lecture seule).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Fichier spécifique (optionnel)' },
      },
    },
  },
  {
    name: 'read_url',
    description: 'Lit le contenu textuel d\'une page web (documentation, README GitHub, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        url:       { type: 'string',  description: 'URL HTTP/HTTPS publique' },
        max_chars: { type: 'integer', description: 'Nombre max de caractères retournés (défaut : 5000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'http_request',
    description: 'Effectue une requête HTTP/HTTPS vers une app locale ou distante (teste une API, envoie des données, vérifie un endpoint).',
    inputSchema: {
      type: 'object',
      properties: {
        url:                 { type: 'string',  description: 'URL cible (localhost autorisé)' },
        method:              { type: 'string',  description: 'Méthode HTTP : GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (défaut : GET)', enum: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] },
        headers:             { type: 'object',  description: 'En-têtes HTTP supplémentaires (objet clé→valeur)' },
        body:                { description: 'Corps de la requête (string ou objet JSON)' },
        timeout:             { type: 'integer', description: 'Timeout en ms (défaut : 10000)' },
        max_response_chars:  { type: 'integer', description: 'Taille max de la réponse retournée (défaut : 5000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'check_service',
    description: 'Vérifie si un service (URL ou port TCP) est accessible. Utile avant/après un déploiement ou démarrage de serveur.',
    inputSchema: {
      type: 'object',
      properties: {
        url:     { type: 'string',  description: 'URL à tester (HEAD HTTP)' },
        port:    { type: 'integer', description: 'Port TCP à tester' },
        host:    { type: 'string',  description: 'Hôte pour le test TCP (défaut : localhost)' },
        timeout: { type: 'integer', description: 'Timeout en ms (défaut : 5000)' },
      },
    },
  },
  {
    name: 'deploy',
    description: 'Déploie l\'application du projet. Détecte automatiquement la plateforme (Vercel, Netlify, Fly.io, Railway, Docker, npm deploy). Nécessite enableDeploy dans la config.',
    inputSchema: {
      type: 'object',
      properties: {
        platform:    { type: 'string', description: 'Plateforme cible : auto, vercel, netlify, fly, railway, docker, npm-deploy, github-pages (défaut : auto)', enum: ['auto','vercel','netlify','fly','railway','docker','npm-deploy','github-pages'] },
        command:     { type: 'string', description: 'Commande de déploiement personnalisée (override)' },
        build_first: { type: 'boolean', description: 'Exécuter le build avant le déploiement (défaut : true)' },
        timeout:     { type: 'integer', description: 'Timeout total en secondes (défaut : 300, max : 600)' },
      },
    },
  },
  {
    name: 'start_process',
    description: 'Démarre un processus en arrière-plan (serveur de dev, watcher de build, script long…). Requiert enableShell dans la config. Le processus tourne jusqu\'à stop_process ou la fin de session.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string',  description: 'Commande à exécuter (ex: npm run dev)' },
        name:    { type: 'string',  description: 'Nom unique pour identifier le processus (auto-généré si omis)' },
        cwd:     { type: 'string',  description: 'Dossier de travail (défaut : projectRoot)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'stop_process',
    description: 'Arrête un processus en arrière-plan par son nom.',
    inputSchema: {
      type: 'object',
      properties: {
        name:  { type: 'string',  description: 'Nom du processus (voir list_processes)' },
        force: { type: 'boolean', description: 'Forcer SIGKILL au lieu de SIGTERM (défaut : false)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_output',
    description: 'Retourne les dernières lignes de sortie (stdout + stderr) d\'un processus en arrière-plan.',
    inputSchema: {
      type: 'object',
      properties: {
        name:  { type: 'string',  description: 'Nom du processus' },
        lines: { type: 'integer', description: 'Nombre de lignes à retourner (défaut : 50, max : 500)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_processes',
    description: 'Liste tous les processus gérés dans cette session (en cours, arrêtés, en erreur).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

module.exports = { TOOL_SCHEMAS };
