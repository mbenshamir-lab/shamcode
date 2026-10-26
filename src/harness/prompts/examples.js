/**
 * Exemples few-shot par langage.
 * Des exemples concrets calibrent les petits modèles bien plus efficacement
 * que des règles abstraites seules.
 */

// Exemples communs à tous les langages (outils de navigation)
const COMMON_EXAMPLES = `
EXEMPLES DE RÉPONSES VALIDES :

— Si la tâche est ambiguë, demander avant d'agir (avec suggestions quand les options sont connues)
{"tool":"ask_user","intent":"Je vois deux configurations de bundler et je ne peux pas deviner laquelle est active. Je demande à l'utilisateur de trancher avant de toucher au build.","args":{"question":"Je vois deux configs bundler. Lequel est actif ?","context":"La tâche touche la config du build","suggestions":["webpack","vite","les deux"]}}

— Toujours commencer par planifier
{"tool":"plan","intent":"Tu veux ajouter une fonction validateEmail dans src/utils.js. Je vais lire le fichier, ajouter la fonction, mettre l'export à jour, puis vérifier le résultat.","args":{"objective":"Ajouter validateEmail dans src/utils.js","goals":["Regex RFC 5322","Export propre","Testable"],"steps":["Lire src/utils.js pour comprendre les conventions existantes","Ajouter la fonction validateEmail","Mettre à jour l'export","Finish"]}}

— Lire avant de modifier (TOUJOURS)
{"tool":"read_file","intent":"Je lis src/utils.js pour connaître les conventions et les exports existants. Je saurai ensuite exactement où insérer la nouvelle fonction.","args":{"path":"src/utils.js"}}

— Fin de tâche avec résumé précis
{"tool":"finish","intent":"La modification est faite et relue. Je termine avec un résumé court des fichiers touchés et de ce qui reste à vérifier.","args":{"summary":"validateEmail ajoutée dans src/utils.js. Retourne un booléen. Export mis à jour."}}`;

// Exemples spécifiques par langage — montrent les patterns corrects du langage
const LANG_EXAMPLES = {
  js: `
— Modification ciblée JavaScript (replace_code avec correspondance exacte)
{"tool":"replace_code","intent":"Je remplace exactement la ligne d'export de src/utils.js par une version incluant validateEmail. Le reste du module n'est pas touché.","args":{"path":"src/utils.js","old_string":"module.exports = { parseDate };","new_string":"module.exports = { parseDate, validateEmail };"}}

— Écriture d'un nouveau fichier JS
{"tool":"write_file","intent":"Je crée src/validators.js avec la fonction validateEmail et sa regex. Le fichier reste sans dépendance externe pour rester simple à tester.","args":{"path":"src/validators.js","content":"'use strict';\\n\\nconst EMAIL_RE = /^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$/;\\n\\nfunction validateEmail(email) {\\n  return EMAIL_RE.test(email);\\n}\\n\\nmodule.exports = { validateEmail };\\n"}}`,

  ts: `
— Modification ciblée TypeScript
{"tool":"replace_code","intent":"Je remplace la liste d'exports de src/utils.ts pour y ajouter validateEmail. Les types existants ne changent pas.","args":{"path":"src/utils.ts","old_string":"export { parseDate };","new_string":"export { parseDate, validateEmail };"}}

— Écriture d'un nouveau fichier TypeScript
{"tool":"write_file","intent":"Je crée src/validators.ts avec validateEmail typée en entrée et en sortie. Le module ne dépend d'aucun paquet externe.","args":{"path":"src/validators.ts","content":"const EMAIL_RE = /^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$/;\\n\\nexport function validateEmail(email: string): boolean {\\n  return EMAIL_RE.test(email);\\n}\\n"}}`,

  py: `
— Modification ciblée Python (indentation 4 espaces)
{"tool":"replace_code","intent":"J'insère validate_email juste avant parse_date dans utils.py. L'indentation 4 espaces et le style du fichier sont conservés.","args":{"path":"utils.py","old_string":"def parse_date(s: str) -> datetime:","new_string":"def validate_email(email: str) -> bool:\\n    import re\\n    return bool(re.match(r'^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$', email))\\n\\n\\ndef parse_date(s: str) -> datetime:"}}

— Recherche dans le projet Python
{"tool":"search_grep","intent":"Je cherche les fonctions validate déjà présentes dans src. Cela évite de dupliquer une implémentation existante.","args":{"pattern":"def validate","path":"src","ext":".py"}}`,

  rust: `
— Modification ciblée Rust (gestion d'erreur avec Result)
{"tool":"replace_code","intent":"J'ajoute validate_email avant parse_date dans utils.rs. La fonction renvoie un booléen simple, sans changer la signature existante.","args":{"path":"src/utils.rs","old_string":"pub fn parse_date(s: &str) -> Result<DateTime<Utc>, Error> {","new_string":"pub fn validate_email(email: &str) -> bool {\\n    let re = regex::Regex::new(r\\"^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$\\").unwrap();\\n    re.is_match(email)\\n}\\n\\npub fn parse_date(s: &str) -> Result<DateTime<Utc>, Error> {"}}`,

  go: `
— Modification ciblée Go (gestion d'erreur explicite)
{"tool":"replace_code","intent":"J'ajoute ValidateEmail juste avant ParseDate dans utils.go. La vérification reste volontairement minimale pour rester lisible.","args":{"path":"utils.go","old_string":"func ParseDate(s string) (time.Time, error) {","new_string":"// ValidateEmail vérifie le format d'un email.\\nfunc ValidateEmail(email string) bool {\\n    return strings.Contains(email, \\"@\\") && strings.Contains(email, \\".\\")\\n}\\n\\nfunc ParseDate(s string) (time.Time, error) {"}}`,
};

/**
 * Retourne les exemples few-shot pour un langage donné.
 * @param {string} lang
 * @returns {string}
 */
/**
 * Retourne les exemples few-shot pour un langage donné.
 * @param {string} lang
 * @param {number} [maxCommonBlocks] nombre max d'exemples communs (profil minimal)
 * @returns {string}
 */
function getExamples(lang, maxCommonBlocks) {
  const langSpecific = LANG_EXAMPLES[lang] || LANG_EXAMPLES['js'];
  if (!Number.isFinite(maxCommonBlocks)) return `${COMMON_EXAMPLES}${langSpecific}`;
  // Tête (en-tête + N premiers blocs) du tronc commun + un seul exemple de langage
  return `${_takeBlocks(COMMON_EXAMPLES, maxCommonBlocks)}${_takeBlocks(langSpecific, 1)}`;
}

/** Garde l'en-tête et les N premiers blocs (séparés par une ligne commençant par « — »). */
function _takeBlocks(text, maxBlocks) {
  const blocks = text.split(/\n\n(?=— )/);
  return blocks.slice(0, maxBlocks + 1).join('\n\n');
}

module.exports = { getExamples };
