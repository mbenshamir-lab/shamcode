/**
 * Outils filesystem exposés au LLM.
 * Toutes les fonctions reçoivent un `guard` (makeGuard(projectRoot)).
 * Aucune ne peut écrire hors PROJECT_ROOT.
 * Avant chaque écriture : backup + émission d'un write_preview via onEvent.
 * Si config.requestApproval est fourni, l'écriture attend l'approbation de l'utilisateur.
 */

const fs   = require('fs');
const path = require('path');
const { snapshot }          = require('../safety/backup');
const { buildWritePreview } = require('../safety/diff');
const { getIgnore } = require('../safety/harnessignore');
const { formatFile } = require('./formatter');

// Patterns typiques de secrets — faux-positifs tolérés, mieux vaut avertir trop que pas assez
const SECRET_PATTERNS = [
  { re: /sk-[A-Za-z0-9]{20,}/,           label: 'clé OpenAI (sk-)' },
  { re: /ghp_[A-Za-z0-9]{36}/,           label: 'token GitHub (ghp_)' },
  { re: /ghs_[A-Za-z0-9]{36}/,           label: 'token GitHub Actions (ghs_)' },
  { re: /AKIA[A-Z0-9]{16}/,              label: 'clé AWS access (AKIA…)' },
  { re: /AIza[0-9A-Za-z\-_]{35}/,        label: 'clé Google API (AIza…)' },
  { re: /xoxb-[0-9A-Za-z\-]{24,}/,       label: 'token Slack Bot (xoxb-)' },
  { re: /xoxp-[0-9A-Za-z\-]{24,}/,       label: 'token Slack User (xoxp-)' },
  { re: /eyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]{8,}/, label: 'JWT token' },
  { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'clé privée PEM' },
  { re: /(?:api[_-]?key|apikey|api_secret)\s*[=:]\s*["']?[A-Za-z0-9\-_]{20,}["']?/i, label: 'variable api_key' },
  { re: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{8,}["']/i, label: 'mot de passe en dur' },
];

/**
 * Détecte les patterns de secrets dans un contenu.
 * Retourne un tableau de warnings { line, label } ou [] si rien détecté.
 */
function _detectSecrets(content) {
  const warnings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { re, label } of SECRET_PATTERNS) {
      if (re.test(lines[i])) {
        warnings.push({ line: i + 1, label });
        break; // un seul warning par ligne
      }
    }
  }
  return warnings;
}

/** Normalise CRLF → LF pour comparer des blocs de code sur Windows. */
function normLf(str) {
  return str.replace(/\r\n/g, '\n');
}

/** Normalise CRLF + espaces en fin de ligne — fallback fuzzy pour replace_code. */
function normFuzzy(str) {
  return normLf(str).split('\n').map(l => l.trimEnd()).join('\n');
}

/**
 * Lit un fichier texte.
 * Supporte une plage de lignes optionnelle (1-indexé, inclusif).
 * Bloque si le chemin est dans .harnessignore du projet.
 *
 * @param {{ path: string, start_line?: number, end_line?: number }} args
 * @param {Function} guard
 * @param {string}   projectRoot - Optionnel, pour appliquer .harnessignore
 */
function readFile({ path: relPath, start_line, end_line }, guard, projectRoot = '') {
  try {
    // Vérification .harnessignore avant d'accéder au disque
    if (projectRoot && getIgnore(projectRoot).isIgnored(relPath)) {
      return { ok: false, error: 'FICHIER_IGNORÉ: ce fichier est exclu par .harnessignore' };
    }

    const abs   = guard(relPath);
    const raw   = fs.readFileSync(abs, 'utf8');
    const lines = raw.split('\n');
    const total = lines.length;

    if (start_line != null || end_line != null) {
      const from = Math.max(1, start_line ?? 1);
      const to   = Math.min(total, end_line ?? total);
      if (from > total) return { ok: false, error: `START_LINE_HORS_LIMITE: le fichier n'a que ${total} ligne(s)` };
      const slice   = lines.slice(from - 1, to).join('\n');
      const header  = `[Lignes ${from}–${to} / ${total} total — ${relPath}]\n`;
      return { ok: true, content: header + slice, total_lines: total, start_line: from, end_line: to };
    }

    return { ok: true, content: raw, total_lines: total };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Écrit/crée un fichier (crée les dossiers parents si besoin).
 * Si config.requestApproval est fourni, attend l'accord de l'utilisateur.
 *
 * @param {{ path: string, content: string }} args
 * @param {Function} guard
 * @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
 * @param {Function} onEvent
 */
async function writeFile({ path: relPath, content }, guard, config = {}, onEvent = () => {}) {
  try {
    const abs        = guard(relPath);
    const oldContent = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const preview    = buildWritePreview(relPath, oldContent, content);

    if (config.requestApproval) {
      const approved = await config.requestApproval(preview);
      if (!approved) return { ok: false, error: 'REJETÉ_PAR_UTILISATEUR' };
    } else {
      onEvent(preview);
    }

    if (config.backupBeforeWrite !== false) snapshot(abs);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    if (config.autoFormat && config._guard) {
      await formatFile({ path: relPath }, config._guard, config._projectRoot || '').catch(() => {});
    }
    const secretWarnings = _detectSecrets(content);
    return { ok: true, path: relPath, ...(secretWarnings.length ? { secretWarnings } : {}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Remplace une chaîne dans un fichier.
 * Essaie d'abord la correspondance exacte (CRLF normalisé),
 * puis un fallback fuzzy (espaces de fin de ligne strippés).
 * Si config.requestApproval est fourni, attend l'accord de l'utilisateur.
 *
 * @param {{ path: string, old_string: string, new_string: string }} args
 * @param {Function} guard
 * @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
 * @param {Function} onEvent
 */
async function replaceCode({ path: relPath, old_string, new_string }, guard, config = {}, onEvent = () => {}) {
  try {
    const abs  = guard(relPath);
    const raw  = fs.readFileSync(abs, 'utf8');
    const norm = normLf(raw);
    const oldN = normLf(old_string);

    // ── Correspondance exacte ────────────────────────────────────────────────
    const countExact = norm.split(oldN).length - 1;
    if (countExact > 1) return { ok: false, error: 'BLOC_AMBIGU' };

    let final;
    let fuzzy = false;

    const hasCrlf = raw.includes('\r\n');

    if (countExact === 1) {
      const updated = raw.replace(old_string, new_string);
      final = updated !== raw ? updated : norm.replace(oldN, normLf(new_string));
    } else {
      // ── Fallback fuzzy : normalise aussi les espaces en fin de ligne ────────
      const normF = normFuzzy(raw);
      const oldF  = normFuzzy(old_string);
      const countFuzzy = normF.split(oldF).length - 1;
      if (countFuzzy === 0) {
        // Chercher la zone du fichier la plus proche du début de old_string
        const firstLine = oldN.split('\n')[0].trim().slice(0, 80);
        const fileLines = norm.split('\n');
        const matchIdx  = firstLine
          ? fileLines.findIndex(l => l.includes(firstLine))
          : -1;
        let hint;
        if (matchIdx >= 0) {
          const from = Math.max(0, matchIdx - 2);
          const to   = Math.min(fileLines.length, matchIdx + 12);
          hint = `Lignes ${from + 1}–${to} du fichier (zone détectée) :\n${fileLines.slice(from, to).join('\n')}`;
        } else {
          hint = `Début du fichier (20 lignes) :\n${fileLines.slice(0, 20).join('\n')}`;
        }
        return { ok: false, error: 'BLOC_INTROUVABLE', hint };
      }
      if (countFuzzy > 1)   return { ok: false, error: 'BLOC_AMBIGU' };
      final = normF.replace(oldF, normLf(new_string));
      fuzzy = true;
    }

    // Restaurer les fins de ligne d'origine (CRLF) si le fichier en avait —
    // s'applique aux deux chemins (exact + fuzzy) car les normalisations LF.
    if (hasCrlf && !final.includes('\r\n')) {
      final = final.replace(/\r?\n/g, '\r\n');
    }

    const preview = buildWritePreview(relPath, raw, final);

    if (config.requestApproval) {
      const approved = await config.requestApproval(preview);
      if (!approved) return { ok: false, error: 'REJETÉ_PAR_UTILISATEUR' };
    } else {
      onEvent(preview);
    }

    if (config.backupBeforeWrite !== false) snapshot(abs);
    fs.writeFileSync(abs, final, 'utf8');
    const secretWarnings = _detectSecrets(final);
    return { ok: true, path: relPath, ...(fuzzy ? { fuzzy: true } : {}), ...(secretWarnings.length ? { secretWarnings } : {}) };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Liste les entrées d'un dossier.
 * Supporte le mode récursif (depth ≤ 5, défaut 1).
 * Les entrées correspondant à .harnessignore sont masquées.
 *
 * @param {{ path: string, recursive?: boolean, depth?: number }} args
 * @param {Function} guard
 * @param {string}   projectRoot
 */
function listDir({ path: relPath = '.', recursive = false, depth = 3 }, guard, projectRoot = '') {
  const MAX_DEPTH    = 5;
  const MAX_ENTRIES  = 200;  // limite globale pour éviter les listings géants

  try {
    const ignore = projectRoot ? getIgnore(projectRoot) : null;

    function _walk(rel, currentDepth) {
      const abs     = guard(rel);
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      return entries
        .filter(e => {
          if (!ignore) return true;
          const r = path.join(rel, e.name).replace(/\\/g, '/');
          return !ignore.isIgnored(e.isDirectory() ? r + '/' : r);
        })
        .map(e => {
          const item = { name: e.name, type: e.isDirectory() ? 'dir' : 'file', path: path.join(rel, e.name).replace(/\\/g, '/') };
          if (recursive && e.isDirectory() && currentDepth < Math.min(depth, MAX_DEPTH)) {
            try { item.children = _walk(item.path, currentDepth + 1); } catch { item.children = []; }
          }
          return item;
        });
    }

    const items = _walk(relPath, 1);

    // En mode non récursif : format simple rétrocompatible
    if (!recursive) {
      return { ok: true, path: relPath, items: items.map(({ name, type }) => ({ name, type })) };
    }

    // En mode récursif : on aplatit aussi sous forme de liste pour un parsing LLM plus facile
    const flat = [];
    function _flatten(nodes, prefix) {
      for (const node of nodes) {
        flat.push({ path: node.path, type: node.type });
        if (flat.length >= MAX_ENTRIES) return;
        if (node.children) _flatten(node.children, node.path);
      }
    }
    _flatten(items, '');
    const truncated = flat.length >= MAX_ENTRIES;

    return { ok: true, path: relPath, items: flat, recursive: true, ...(truncated ? { truncated: true } : {}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Supprime un fichier du projet après backup et approbation optionnelle.
 *
 * @param {{ path: string }} args
 * @param {Function} guard
 * @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
 * @param {Function} onEvent
 */
async function deleteFile({ path: relPath }, guard, config = {}, onEvent = () => {}) {
  try {
    const abs = guard(relPath);
    if (!fs.existsSync(abs)) return { ok: false, error: 'FICHIER_INTROUVABLE' };

    // Lire le contenu pour afficher dans le preview et pour le backup
    const content = fs.readFileSync(abs, 'utf8');

    // Backup obligatoire avant toute suppression
    if (config.backupBeforeWrite !== false) {
      snapshot(abs, config.maxBackups);
    }

    const preview = {
      type:     'write_preview',
      path:     relPath,
      patch:    content.split('\n').map(l => `- ${l}`).join('\n'),
      stats:    { additions: 0, deletions: content.split('\n').length, hunks: 1 },
      isDelete: true,
    };

    if (config.requestApproval) {
      const approved = await config.requestApproval(preview);
      if (!approved) return { ok: false, error: 'REJETÉ_PAR_UTILISATEUR' };
    } else {
      onEvent(preview);
    }

    fs.unlinkSync(abs);
    return { ok: true, deleted: relPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Déplace (renomme) un fichier dans le projet.
 * Source et destination doivent être dans le projectRoot (vérifié par guard).
 * Backup de la source avant déplacement, approbation optionnelle.
 *
 * @param {{ path: string, dest: string }} args
 * @param {Function} guard
 * @param {{ backupBeforeWrite?: boolean, requestApproval?: Function }} config
 * @param {Function} onEvent
 */
async function moveFile({ path: relSrc, dest: relDest }, guard, config = {}, onEvent = () => {}) {
  try {
    if (!relSrc) return { ok: false, error: 'MOVE_SANS_SOURCE' };
    if (!relDest) return { ok: false, error: 'MOVE_SANS_DESTINATION' };

    const absSrc  = guard(relSrc);
    const absDest = guard(relDest);   // valide que la dest est bien dans projectRoot

    if (!fs.existsSync(absSrc)) return { ok: false, error: 'FICHIER_INTROUVABLE' };
    if (fs.existsSync(absDest)) return { ok: false, error: 'DESTINATION_DÉJÀ_EXISTANTE' };

    // Backup de la source avant toute modification
    if (config.backupBeforeWrite !== false) {
      snapshot(absSrc, config.maxBackups);
    }

    const preview = {
      type:   'write_preview',
      path:   relSrc,
      patch:  `Déplacement : ${relSrc} → ${relDest}`,
      stats:  { additions: 0, deletions: 0, hunks: 0 },
      isMove: true,
      dest:   relDest,
    };

    if (config.requestApproval) {
      const approved = await config.requestApproval(preview);
      if (!approved) return { ok: false, error: 'REJETÉ_PAR_UTILISATEUR' };
    } else {
      onEvent(preview);
    }

    // Créer les dossiers parents de la destination si nécessaire
    fs.mkdirSync(path.dirname(absDest), { recursive: true });

    // Tenter rename atomique ; fallback copy+delete si cross-device
    try {
      fs.renameSync(absSrc, absDest);
    } catch (e) {
      if (e.code === 'EXDEV') {
        fs.copyFileSync(absSrc, absDest);
        fs.unlinkSync(absSrc);
      } else {
        throw e;
      }
    }

    return { ok: true, moved: relSrc, dest: relDest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { readFile, writeFile, replaceCode, listDir, deleteFile, moveFile };
