'use strict';

/**
 * Mémoire sémantique persistante inter-sessions (ADR-026).
 *
 * Pourquoi : le scratchpad est in-memory et disparaît à chaque session.
 * L'agent ne pouvait pas mémoriser des décisions d'architecture, des conventions
 * spécifiques au projet, ou des informations stables (clés de config, endpoints, règles).
 * project-notes persiste dans .harness/project-notes.json et survit entre sessions.
 *
 * Design : clé/valeur simple, tags pour la catégorisation, TTL 90j, plafond 100 notes.
 * Pas d'embeddings : la pertinence est calculée par overlap de tokens (suffisant pour
 * des notes courtes et des requêtes textuelles).
 */

const fs   = require('fs');
const path = require('path');

const NOTES_FILE = '.harness/project-notes.json';
const MAX_NOTES  = 100;
const TTL_MS     = 90 * 24 * 60 * 60 * 1000;   // 90 jours

function _notesPath(projectRoot) {
  return path.join(projectRoot, NOTES_FILE);
}

function _load(projectRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(_notesPath(projectRoot), 'utf8'));
    if (Array.isArray(raw.notes)) return raw;
  } catch { /* absent ou corrompu → vide */ }
  return { notes: [] };
}

function _save(projectRoot, data) {
  const p = _notesPath(projectRoot);
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal : lecture seule OK */ }
}

function _trim(notes) {
  const now  = Date.now();
  const fresh = notes.filter(n => !n.ts || (now - n.ts) < TTL_MS);
  return fresh.length > MAX_NOTES ? fresh.slice(-MAX_NOTES) : fresh;
}

// ── API publique ──────────────────────────────────────────────────────────────

function setNote(projectRoot, key, value, tags = []) {
  const data  = _load(projectRoot);
  const idx   = data.notes.findIndex(n => n.key === key);
  const entry = {
    key: String(key),
    value: String(value),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    ts: Date.now(),
  };
  if (idx >= 0) data.notes[idx] = entry;
  else          data.notes.push(entry);
  data.notes = _trim(data.notes);
  _save(projectRoot, data);
  return entry;
}

function getNote(projectRoot, key) {
  const { notes } = _load(projectRoot);
  return notes.find(n => n.key === key) || null;
}

function listNotes(projectRoot) {
  const { notes } = _load(projectRoot);
  return _trim(notes);
}

function deleteNote(projectRoot, key) {
  const data   = _load(projectRoot);
  const before = data.notes.length;
  data.notes   = data.notes.filter(n => n.key !== key);
  const deleted = data.notes.length < before;
  if (deleted) _save(projectRoot, data);
  return deleted;
}

/**
 * Retourne les notes les plus pertinentes pour une tâche.
 * Algorithme : overlap de tokens entre task et (key + value + tags).
 *
 * @param {string} projectRoot
 * @param {string} task
 * @param {number} [maxNotes=5]
 * @returns {{ key: string, value: string, tags: string[], score: number }[]}
 */
function getRelevantNotes(projectRoot, task, maxNotes = 5) {
  const notes = listNotes(projectRoot);
  if (notes.length === 0) return [];

  const taskTokens = new Set(
    String(task).toLowerCase().split(/\W+/).filter(t => t.length > 2),
  );
  if (taskTokens.size === 0) return notes.slice(0, maxNotes);

  const scored = notes.map(n => {
    const text  = `${n.key} ${n.value} ${(n.tags || []).join(' ')}`.toLowerCase();
    const words = text.split(/\W+/).filter(t => t.length > 2);
    let overlap = 0;
    for (const w of words) { if (taskTokens.has(w)) overlap++; }
    return { ...n, score: overlap };
  });

  return scored
    .sort((a, b) => b.score - a.score || (b.ts || 0) - (a.ts || 0))
    .slice(0, maxNotes);
}

/**
 * Formate les notes sélectionnées en bloc de contexte compact.
 * @param {{ key: string, value: string }[]} notes
 * @returns {string}
 */
function notesToContextBlock(notes) {
  if (notes.length === 0) return '';
  const lines = notes.map(n => `- ${n.key} : ${n.value}`).join('\n');
  return `## Mémoire du projet\n${lines}`;
}

module.exports = { setNote, getNote, listNotes, deleteNote, getRelevantNotes, notesToContextBlock };
