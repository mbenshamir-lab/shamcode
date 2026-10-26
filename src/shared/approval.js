/**
 * Politique de validation des écritures — règle unique, partagée main + renderer.
 *
 * Règle produit : le mode Action est le mode « l'agent est pleinement autorisé ».
 * Aucune validation utilisateur n'y est demandée pour modifier un fichier.
 * La validation ne concerne que le mode Plan, où l'agent n'a pas accès aux
 * outils d'écriture : elle porte donc sur les décisions (le plan) avant de
 * basculer en Action.
 */

/**
 * @param {object} opts
 * @param {boolean} [opts.planMode]            - true = mode Plan, false/absent = mode Action
 * @param {boolean} [opts.approvalMode]        - choix utilisateur (toggle rapide), prioritaire
 * @param {boolean} [opts.configApprovalMode]  - valeur persistée en config, repli
 * @returns {boolean} true si une approbation utilisateur doit être demandée
 */
function approvalRequired({ planMode = false, approvalMode, configApprovalMode } = {}) {
  // Mode Action : autorisation pleine et permanente, aucune validation.
  if (planMode !== true) return false;

  // Mode Plan : respecte le choix utilisateur, puis la config persistée.
  if (typeof approvalMode === 'boolean') return approvalMode;
  if (typeof configApprovalMode === 'boolean') return configApprovalMode;

  // Par défaut on demande la validation — jamais d'écriture silencieuse non voulue.
  return true;
}

module.exports = { approvalRequired };
