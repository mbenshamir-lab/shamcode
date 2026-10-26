/**
 * Outils internes de l'eval : bac à sable de projet et modèle « rejoué ».
 *
 * Aucune dépendance externe, aucun accès réseau : le modèle est un script
 * déterministe, ce qui mesure le HARNESS (prompt, contexte, nudges, garde-fous)
 * et non la qualité d'un modèle particulier.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Copie un projet de démonstration dans un dossier temporaire isolé.
 * @param {string} fixtureName
 * @returns {string} racine absolue du projet temporaire
 */
function makeSandbox(fixtureName) {
  const src = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(src)) throw new Error(`FIXTURE_INTROUVABLE: ${fixtureName}`);
  // Le nom du dossier projet doit être stable : il apparaît dans l'arborescence
  // injectée au prompt, donc dans l'empreinte du prompt (comparaisons A/B).
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shamcode-eval-'));
  const root = path.join(base, fixtureName);
  fs.cpSync(src, root, { recursive: true });
  return root;
}

/**
 * Crée une fonction llmGenerate qui rejoue un script de réponses.
 * Une réponse peut être une chaîne (texte brut, y compris malformé) ou un objet
 * (sérialisé en JSON, comme le ferait un modèle bien dressé).
 * Le script est « collant » : la dernière réponse est répétée si la boucle continue,
 * ce qui simule un modèle qui s'entête.
 *
 * @param {Array<string|object>} script
 * @returns {Function & { calls: Array<Array<{role: string, content: string}>> }}
 */
function createReplay(script) {
  if (!Array.isArray(script) || script.length === 0) throw new Error('SCRIPT_VIDE');
  let i = 0;

  const fn = async (messages) => {
    // Copie compacte : on ne garde que le texte, pour l'analyse après coup
    fn.calls.push(messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })));

    const next = i < script.length ? script[i++] : script[script.length - 1];
    return typeof next === 'string' ? next : JSON.stringify(next);
  };
  fn.calls = [];
  return fn;
}

/** Lit un fichier du projet temporaire ; retourne '' s'il est absent. */
function readProjectFile(root, relPath) {
  try { return fs.readFileSync(path.join(root, relPath), 'utf8'); }
  catch { return ''; }
}

/** Supprime un dossier temporaire sans faire échouer l'eval si le FS résiste. */
function removeSandbox(root) {
  const base = path.dirname(root);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignoré */ }
  if (path.basename(base).startsWith('shamcode-eval-')) {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignoré */ }
  }
}

module.exports = { makeSandbox, createReplay, readProjectFile, removeSandbox, FIXTURES_DIR };
