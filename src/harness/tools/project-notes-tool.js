'use strict';

const { setNote, getNote, listNotes, deleteNote, getRelevantNotes } = require('../memory/project-notes');

/**
 * Outil LLM : mémoire persistante inter-sessions du projet (ADR-026).
 *
 * Actions : set | get | list | delete | search
 * La note est persistée dans .harness/project-notes.json et disponible à la
 * prochaine session. Différent de scratchpad (in-memory, disparaît à la fin).
 *
 * @param {{ action, key?, value?, tags?, task? }} args
 * @param {Function} _guard   non utilisé (pas d'accès FS direct via path-guard)
 * @param {string}   projectRoot
 */
function projectNote({ action, key, value, tags, task } = {}, _guard, projectRoot) {
  if (!projectRoot) return { ok: false, error: 'PROJET_NON_DÉFINI' };

  switch (action) {
    case 'set': {
      if (!key || String(key).trim() === '')   return { ok: false, error: 'CLE_MANQUANTE' };
      if (value === undefined || value === null) return { ok: false, error: 'VALEUR_MANQUANTE' };
      const entry = setNote(projectRoot, key, value, tags);
      return { ok: true, saved: entry.key };
    }
    case 'get': {
      if (!key) return { ok: false, error: 'CLE_MANQUANTE' };
      const n = getNote(projectRoot, key);
      return n
        ? { ok: true, key: n.key, value: n.value, tags: n.tags }
        : { ok: false, error: 'NOTE_INTROUVABLE' };
    }
    case 'list': {
      const notes = listNotes(projectRoot);
      return {
        ok: true,
        notes: notes.map(n => ({ key: n.key, value: String(n.value).slice(0, 120), tags: n.tags })),
        count: notes.length,
      };
    }
    case 'delete': {
      if (!key) return { ok: false, error: 'CLE_MANQUANTE' };
      return { ok: true, deleted: deleteNote(projectRoot, key) };
    }
    case 'search': {
      if (!task || String(task).trim() === '') return { ok: false, error: 'TACHE_MANQUANTE' };
      const results = getRelevantNotes(projectRoot, task, 10);
      return { ok: true, results: results.map(n => ({ key: n.key, value: n.value })) };
    }
    default:
      return { ok: false, error: 'ACTION_INCONNUE', valid_actions: ['set', 'get', 'list', 'delete', 'search'] };
  }
}

module.exports = { projectNote };
