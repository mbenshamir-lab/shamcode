'use strict';

/**
 * Outils find_dependents et find_dependencies (ADR-025).
 *
 * find_dependents  : qui importe ce fichier dans le projet ?
 * find_dependencies : ce fichier importe quoi dans le projet ?
 *
 * Les deux s'appuient sur le graphe incrémental de depgraph.js.
 * BFS optionnel (depth > 1) pour remonter/descendre la chaîne d'imports.
 */

const path = require('path');
const { buildDepGraph } = require('../context/depgraph');

const MAX_RESULTS = 50;
const MAX_DEPTH   = 4;

function _normalize(relPathRaw, absPath, projectRoot) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

/**
 * BFS dans une map de voisins.
 * @param {string}   start     - nœud de départ (relatif)
 * @param {Object}   neighbors - map relPath → [relPath, ...]
 * @param {number}   depth
 * @returns {string[]}
 */
function _bfs(start, neighbors, depth) {
  const visited = new Set([start]);
  let frontier  = [start];
  let reached   = 0;

  while (frontier.length && reached < Math.min(depth, MAX_DEPTH)) {
    const next = [];
    for (const f of frontier) {
      for (const n of neighbors[f] || []) {
        if (!visited.has(n)) { visited.add(n); next.push(n); }
      }
    }
    frontier = next;
    reached++;
  }

  // Retire le point de départ du résultat
  visited.delete(start);
  return [...visited];
}

/**
 * find_dependents : quels fichiers importent `path` ?
 */
function findDependents({ path: relPath, depth = 1 }, guard, projectRoot) {
  if (!relPath) return { ok: false, error: 'CHEMIN_MANQUANT' };

  let absPath;
  try { absPath = guard(relPath); }
  catch { return { ok: false, error: `CHEMIN_HORS_PROJET: ${relPath}` }; }

  const norm = _normalize(relPath, absPath, projectRoot);

  try {
    const { dependents } = buildDepGraph(projectRoot);
    const depthN = Math.max(1, Math.min(parseInt(depth, 10) || 1, MAX_DEPTH));

    const all = depthN === 1
      ? (dependents[norm] || [])
      : _bfs(norm, dependents, depthN);

    return {
      ok:         true,
      path:       norm,
      dependents: all.slice(0, MAX_RESULTS),
      count:      all.length,
      ...(depthN > 1 ? { depth: depthN } : {}),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * find_dependencies : quels fichiers `path` importe-t-il ?
 */
function findDependencies({ path: relPath, depth = 1 }, guard, projectRoot) {
  if (!relPath) return { ok: false, error: 'CHEMIN_MANQUANT' };

  let absPath;
  try { absPath = guard(relPath); }
  catch { return { ok: false, error: `CHEMIN_HORS_PROJET: ${relPath}` }; }

  const norm = _normalize(relPath, absPath, projectRoot);

  try {
    const { deps } = buildDepGraph(projectRoot);
    const depthN = Math.max(1, Math.min(parseInt(depth, 10) || 1, MAX_DEPTH));

    const all = depthN === 1
      ? (deps[norm] || [])
      : _bfs(norm, deps, depthN);

    return {
      ok:           true,
      path:         norm,
      dependencies: all.slice(0, MAX_RESULTS),
      count:        all.length,
      ...(depthN > 1 ? { depth: depthN } : {}),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { findDependents, findDependencies };
