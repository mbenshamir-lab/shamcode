'use strict';

/**
 * Stockage des objectifs : un fichier JSON par objectif, dans
 * `<projectRoot>/.harness/goals/`. Écriture atomique (tmp + rename) pour ne jamais
 * laisser un objectif à moitié écrit si l'app est interrompue.
 *
 * Le store ne connaît pas Electron et ne lit que sous le projet (path-guard).
 */

const fs = require('fs');
const path = require('path');
const { makeGuard } = require('../safety/path-guard');

const GOALS_SUBDIR = '.harness/goals';

function goalsDir(projectRoot) {
  return makeGuard(projectRoot)(GOALS_SUBDIR);
}

function goalFilePath(projectRoot, id) {
  if (!/^[a-z0-9-]+$/i.test(String(id || ''))) throw new Error('GOAL_ID_INVALIDE');
  return makeGuard(projectRoot)(`${GOALS_SUBDIR}/${id}.json`);
}

function _now() {
  return new Date().toISOString();
}

/**
 * Écrit l'objectif de façon atomique.
 * @param {string} projectRoot
 * @param {object} goal
 */
function saveGoal(projectRoot, goal) {
  const dir = goalsDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  const file = goalFilePath(projectRoot, goal.id);
  const tmp  = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify({ ...goal, updatedAt: _now() }, null, 2);

  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* déjà absent */ }
    throw error;
  }
}

/**
 * @returns {object|null}
 */
function loadGoal(projectRoot, id) {
  try {
    return JSON.parse(fs.readFileSync(goalFilePath(projectRoot, id), 'utf8'));
  } catch {
    return null;
  }
}

/** Tous les objectifs du projet, du plus récent au plus ancien. */
function listGoals(projectRoot) {
  let dir;
  try { dir = goalsDir(projectRoot); } catch { return []; }

  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  } catch {
    return [];
  }
}

/** Objectif actif du projet (le plus récent), ou null. */
function loadActiveGoal(projectRoot) {
  return listGoals(projectRoot).find(g => g.status === 'active') || null;
}

/**
 * Archive l'objectif actif avant d'en créer un nouveau.
 * @returns {object|null} l'objectif archivé
 */
function archiveActiveGoal(projectRoot, reason = 'remplacé par un nouvel objectif') {
  const current = loadActiveGoal(projectRoot);
  if (!current) return null;
  current.status = 'abandoned';
  current.abandonReason = String(reason).slice(0, 200);
  saveGoal(projectRoot, current);
  return current;
}

module.exports = {
  GOALS_SUBDIR,
  goalFilePath,
  goalsDir,
  saveGoal,
  loadGoal,
  listGoals,
  loadActiveGoal,
  archiveActiveGoal,
};
