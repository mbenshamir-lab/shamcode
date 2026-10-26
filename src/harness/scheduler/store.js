'use strict';
const crypto = require('crypto');

function listTasks(config) {
  return config.scheduledTasks || [];
}

function addTask(config, { label, cron, task, projectRoot, enabled = true }) {
  if (!label || !cron || !task) return { ok: false, error: 'CHAMPS_MANQUANTS' };
  const id = crypto.randomUUID();
  const entry = {
    id,
    label,
    cron,
    task,
    projectRoot: projectRoot || config.projectRoot || '',
    enabled,
    createdAt: Date.now(),
    lastRun: null,
  };
  if (!config.scheduledTasks) config.scheduledTasks = [];
  config.scheduledTasks.push(entry);
  return { ok: true, id };
}

function deleteTask(config, id) {
  if (!config.scheduledTasks) return { ok: false, error: 'INTROUVABLE' };
  const idx = config.scheduledTasks.findIndex(t => t.id === id);
  if (idx === -1) return { ok: false, error: 'INTROUVABLE' };
  config.scheduledTasks.splice(idx, 1);
  return { ok: true };
}

function toggleTask(config, id) {
  const task = (config.scheduledTasks || []).find(t => t.id === id);
  if (!task) return { ok: false, error: 'INTROUVABLE' };
  task.enabled = !task.enabled;
  return { ok: true, enabled: task.enabled };
}

module.exports = { listTasks, addTask, deleteTask, toggleTask };
