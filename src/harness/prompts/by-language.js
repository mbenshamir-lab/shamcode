/**
 * Détection du langage principal du projet et règles associées.
 * Compte les extensions de fichiers pour choisir le langage dominant.
 */

const fs   = require('fs');
const path = require('path');

// Extensions → langage normalisé
const EXT_MAP = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js',
  '.ts': 'ts', '.tsx': 'ts',
  '.jsx': 'js',
  '.py': 'py',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
};

// Dossiers à ignorer lors du scan
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.venv', 'vendor', 'out', '.next']);

/**
 * Compte les fichiers par langage dans un projet.
 * @param {string} root
 * @param {number} [maxFiles=2000] — limite pour ne pas bloquer
 * @returns {Record<string, number>}
 */
function _countByLang(root, maxFiles = 2000) {
  const counts = {};
  let total = 0;

  function walk(dir) {
    if (total >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const lang = EXT_MAP[ext];
        if (lang) { counts[lang] = (counts[lang] || 0) + 1; total++; }
      }
    }
  }

  walk(root);
  return counts;
}

/**
 * Détecte le langage dominant d'un projet.
 * @param {string} projectRoot
 * @returns {'js'|'ts'|'py'|'rust'|'go'|'java'|'csharp'|'ruby'|'php'|'generic'}
 */
function detectLanguage(projectRoot) {
  try {
    const counts = _countByLang(projectRoot);
    if (Object.keys(counts).length === 0) return 'generic';

    // TypeScript > JavaScript si ts est présent en quantité significative
    if (counts['ts'] && counts['ts'] >= (counts['js'] || 0) * 0.3) {
      return 'ts';
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  } catch {
    return 'generic';
  }
}

const RULES = {
  js: `LANGAGE : JavaScript
- const/let uniquement (jamais var).
- Modules CommonJS (require/module.exports) sauf si le projet utilise ESM.
- Fonctions fléchées pour les callbacks, function classique pour les exports nommés.
- Gestion d'erreur explicite : retourner { ok: false, error } ou throw — jamais ignorer silencieusement.
- Pas de console.log en dehors du développement.`,

  ts: `LANGAGE : TypeScript
- Types explicites sur toutes les signatures de fonctions publiques.
- Préférer les interfaces aux types pour les objets, les types pour les unions.
- Jamais de any sauf si absolument inévitable (commenter pourquoi).
- const/let uniquement. Import/export ES6.
- Utiliser les guards de type (is, as) plutôt que les assertions forcées.`,

  py: `LANGAGE : Python
- Indentation : 4 espaces (jamais de tabulations).
- PEP 8 : lignes ≤ 88 chars (black), nommage snake_case, classes PascalCase.
- Type hints sur les signatures de fonctions publiques.
- Gestion d'erreur : exceptions explicites, jamais bare except.
- f-strings pour le formatage de chaînes.
- Docstrings Google style sur les fonctions publiques.`,

  rust: `LANGAGE : Rust
- Pas de unwrap() ni expect() en dehors des tests — utiliser ? ou un match explicite.
- Gestion d'erreur avec Result<T, E> et propagation via ?.
- Respecter l'ownership et le borrow checker : ne pas cloner inutilement.
- Documenter les fonctions publiques avec ///.
- Préférer les itérateurs fonctionnels aux boucles impératives quand lisible.`,

  go: `LANGAGE : Go
- Gestion d'erreur explicite : if err != nil — jamais ignorer une erreur.
- Pas de panic() en dehors de l'initialisation ou des invariants critiques.
- Nommage : camelCase pour les identifiants non exportés, PascalCase pour les exportés.
- Interfaces petites (1-2 méthodes idéalement).
- Commentaires de documentation sur toutes les fonctions exportées (// NomFonction ...).`,

  java: `LANGAGE : Java
- Nommage PascalCase pour classes/interfaces, camelCase pour méthodes/champs, UPPER_SNAKE pour constantes.
- Gérer les checked exceptions ou les convertir en unchecked avec un message clair.
- Préférer les streams Java 8+ aux boucles for classiques pour les transformations.
- Immuabilité par défaut : final sur les champs qui ne changent pas.`,

  csharp: `LANGAGE : C#
- Nommage PascalCase pour membres publics, camelCase pour privés/locaux.
- async/await pour les opérations asynchrones — jamais .Result ou .Wait().
- Gérer les nulls avec ? et ?? — activer le contexte nullable si possible.
- LINQ pour les transformations de collections.`,

  ruby: `LANGAGE : Ruby
- Indentation : 2 espaces.
- snake_case pour méthodes/variables, PascalCase pour classes/modules.
- Préférer la syntaxe block { } pour les one-liners, do...end pour les multi-lignes.
- Gérer les erreurs avec rescue explicite — pas de rescue Exception.`,

  php: `LANGAGE : PHP
- PHP 8.0+ : utiliser les types déclarés, les unions de types, les match expressions.
- PSR-12 pour le style de code.
- Gérer les erreurs avec des exceptions — pas de fonctions qui retournent false.
- Pas d'eval(), extract() ou de fonctions de suppression d'erreurs (@).`,

  generic: '',
};

/**
 * Retourne les règles spécifiques au langage détecté.
 * @param {'js'|'ts'|'py'|'rust'|'go'|'java'|'csharp'|'ruby'|'php'|'generic'} lang
 * @returns {string}  — chaîne prête à injecter dans le prompt, ou '' si générique
 */
function getLangRules(lang) {
  return RULES[lang] || '';
}

module.exports = { detectLanguage, getLangRules };
