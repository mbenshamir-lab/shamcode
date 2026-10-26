// Profils des sous-agents spécialisés.
// Chaque profil définit : label UI, couleur, outils autorisés, instruction système additionnelle.
// requirePlanApproval : le sous-agent doit faire valider son plan par l'utilisateur
// avant d'agir (propagé par tools/spawn.js vers requestPlanApproval).

const PROFILES = {
  refactorer: {
    label:       'Refactoring',
    color:       '#a371f7',
    description: 'Améliore la qualité du code sans changer le comportement.',
    maxSteps:    20,
    requirePlanApproval: true,
    allowedTools: ['plan', 'read_file', 'replace_code', 'delete_file', 'move_file', 'list_dir', 'search_grep', 'finish'],
    systemExtra:  'Tu améliores la lisibilité et réduis la duplication. Tu ne changes JAMAIS le comportement observable ni les signatures publiques.',
  },
  'test-writer': {
    label:       'Tests',
    color:       '#2f81f7',
    description: 'Écrit des tests unitaires pour le code existant.',
    maxSteps:    25,
    requirePlanApproval: true,
    allowedTools: ['plan', 'read_file', 'write_file', 'replace_code', 'list_dir', 'find_symbol', 'search_grep', 'run_tests', 'finish'],
    systemExtra:  'Tu écris des tests unitaires clairs et complets. Tu utilises le framework de test déjà présent dans le projet.',
  },
  debugger: {
    label:       'Debug',
    color:       '#d29922',
    description: 'Trouve et corrige les bugs.',
    maxSteps:    20,
    requirePlanApproval: true,
    allowedTools: ['plan', 'get_project_info', 'read_file', 'replace_code', 'list_dir', 'find_symbol', 'search_grep', 'run_tests', 'finish'],
    systemExtra:  'Tu cherches méthodiquement la cause racine avant de corriger. Tu ne changes que le strict nécessaire.',
  },
  'doc-writer': {
    label:       'Documentation',
    color:       '#3fb950',
    description: 'Génère la documentation du code.',
    maxSteps:    15,
    requirePlanApproval: true,
    allowedTools: ['plan', 'read_file', 'write_file', 'replace_code', 'list_dir', 'search_grep', 'finish'],
    systemExtra:  'Tu rédiges une documentation claire et utile. Tu documentes les fonctions publiques, modules et décisions d\'architecture.',
  },
  analyzer: {
    label:       'Analyse',
    color:       '#7d8590',
    description: 'Lit et analyse le code sans le modifier.',
    maxSteps:    10,
    allowedTools: ['get_project_info', 'read_file', 'list_dir', 'find_symbol', 'search_grep', 'finish'],
    systemExtra:  'Tu lis, comprends et résumes le code. Tu ne modifies JAMAIS de fichiers.',
  },
};

module.exports = { PROFILES };
