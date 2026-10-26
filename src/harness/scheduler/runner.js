'use strict';

// Import dynamique pour pouvoir mocker node-cron dans les tests.
let _cronModule = null;
function _getCron() {
  if (!_cronModule) _cronModule = require('node-cron');
  return _cronModule;
}

class SchedulerRunner {
  constructor(cronModuleOverride = null) {
    this._jobs = new Map();
    this._runAgentFn = null;
    if (cronModuleOverride) _cronModule = cronModuleOverride;
  }

  /**
   * Initialise le runner avec la liste des tâches et la fonction d'exécution.
   * @param {Array}    tasks        - Tâches issues de store.listTasks(config)
   * @param {Function} runAgentFn   - (task) => Promise<{ok, ...}>
   */
  init(tasks, runAgentFn) {
    this._runAgentFn = runAgentFn;
    this._scheduleAll(tasks.filter(t => t.enabled !== false));
  }

  /** Recharge les tâches après un ajout, suppression ou toggle. */
  reload(tasks) {
    for (const job of this._jobs.values()) job.stop();
    this._jobs.clear();
    if (!this._runAgentFn) return;
    this._scheduleAll(tasks.filter(t => t.enabled !== false));
  }

  /** Exécute immédiatement une tâche (bouton "Lancer maintenant"). */
  runNow(task) {
    if (!this._runAgentFn) return Promise.resolve({ ok: false, error: 'NON_INITIALISÉ' });
    return this._runAgentFn(task);
  }

  stop() {
    for (const job of this._jobs.values()) job.stop();
    this._jobs.clear();
  }

  _scheduleAll(tasks) {
    const cron = _getCron();
    for (const task of tasks) {
      if (!cron.validate(task.cron)) continue;
      const job = cron.schedule(task.cron, () => {
        this._runAgentFn(task).catch(() => {});
      });
      this._jobs.set(task.id, job);
    }
  }
}

module.exports = { SchedulerRunner };
