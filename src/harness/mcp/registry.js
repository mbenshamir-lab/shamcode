'use strict';
/**
 * Registre MCP — gère plusieurs connexions McpClient.
 * Responsabilités :
 *   • initialiser les connecteurs activés (config.connectors)
 *   • exposer la liste unifiée des outils MCP (nom préfixé par connecteur)
 *   • router toolName → client correct
 *   • disposer proprement tous les clients
 */

const { McpClient } = require('./client');

class McpRegistry {
  constructor() {
    /** @type {Map<string, McpClient>} connectorId → client */
    this._clients = new Map();
    /** @type {Map<string, { client: McpClient, rawName: string }>} toolKey → binding */
    this._toolMap = new Map();
    /** @type {Array<{ name: string, description: string, inputSchema?: object }>} */
    this._toolDefs = [];
  }

  /**
   * Initialise tous les connecteurs actifs de la config.
   * Les erreurs de connexion sont non-bloquantes (le connecteur est ignoré + log).
   *
   * @param {Array} connectors  - config.connectors
   * @param {Function} log      - (msg: string) => void — pour remonter les infos à l'UI
   */
  async init(connectors = [], log = () => {}) {
    const active = connectors.filter(c => c.enabled && c.url);

    for (const conn of active) {
      try {
        const client = new McpClient(conn);
        const tools  = await client.connect();
        this._clients.set(conn.id, client);

        for (const tool of tools) {
          // Préfixe pour éviter les collisions de noms entre connecteurs
          const key = `mcp_${_slugify(conn.name)}_${tool.name}`;
          this._toolMap.set(key, { client, rawName: tool.name });
          this._toolDefs.push({
            name:        key,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema ?? {},
            _connName:   conn.name,
          });
        }
        log(`MCP connecté : ${conn.name} (${tools.length} outil(s))`);
      } catch (err) {
        log(`MCP échec connexion [${conn.name}] : ${err.message}`);
      }
    }
  }

  /** Retourne les définitions d'outils au format attendu par le prompt système. */
  get toolDefs() { return this._toolDefs; }

  /** Retourne les lignes de description prêtes pour availableTools[]. */
  get toolDescriptions() {
    return this._toolDefs.map(t =>
      `${t.name} — args: ${JSON.stringify(t.inputSchema?.properties ?? {})} — (MCP: ${t._connName}) ${t.description}`
    );
  }

  /**
   * Appelle un outil MCP par son nom préfixé (ex. mcp_github_list_repos).
   * @param {string} toolKey
   * @param {object} args
   * @returns {Promise<{ ok: boolean, content?: string, error?: string }>}
   */
  async call(toolKey, args = {}) {
    const binding = this._toolMap.get(toolKey);
    if (!binding) {
      return { ok: false, error: `OUTIL_MCP_INCONNU: ${toolKey}` };
    }
    return binding.client.callTool(binding.rawName, args);
  }

  /** True si le nom correspond à un outil MCP enregistré. */
  has(toolKey) {
    return this._toolMap.has(toolKey);
  }

  /** Dispose tous les clients (à appeler en fin d'agent). */
  dispose() {
    for (const client of this._clients.values()) {
      try { client.dispose(); } catch {}
    }
    this._clients.clear();
    this._toolMap.clear();
  }
}

/** Transforme un nom libre en slug sûr pour un nom d'outil. */
function _slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

module.exports = { McpRegistry };
