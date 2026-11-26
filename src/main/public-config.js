/**
 * Frontière des secrets (ADR-041) : ce que les renderers reçoivent de la configuration,
 * et comment ce qu'ils renvoient est fusionné avec celle du processus principal.
 * Les renderers ne connaissent d'un secret que son existence.
 */

function _mask(entry, field, flag) {
  const present = !!entry[field];
  delete entry[field];
  delete entry[`${field}Encrypted`];
  entry[flag] = present;
}

/**
 * Copie de la configuration sans aucun secret, avec des indicateurs de présence.
 * @param {object} config
 * @param {{ secretsEncrypted?: boolean }} [opts] false = le chiffrement système est inopérant
 * @returns {object}
 */
function toPublicConfig(config, { secretsEncrypted = true } = {}) {
  const out = JSON.parse(JSON.stringify(config));

  Object.values(out.model?.engines || {}).forEach(e => _mask(e, 'apiKey', 'hasKey'));
  (out.customProviders || []).forEach(p => _mask(p, 'apiKey', 'hasKey'));
  (out.connectors || []).forEach(c => _mask(c, 'auth', 'hasAuth'));

  const tokens = Object.entries(out.apiTokens || {});
  out.apiTokens      = Object.fromEntries(tokens.map(([name]) => [name, '']));
  out.apiTokensSaved = Object.fromEntries(tokens.map(([name, value]) => [name, !!value]));
  delete out.apiTokensEncrypted;

  out.secretsEncrypted = secretsEncrypted;
  return out;
}

/**
 * Entrée reçue d'un renderer : un secret saisi remplace l'ancien ; vide ou absent, l'ancien
 * est conservé. Les formes chiffrées ne viennent jamais du renderer.
 */
function _keepSecret(incoming, saved, field, flag) {
  const sealed = `${field}Encrypted`;
  const { [flag]: _flag, [sealed]: _sealed, ...entry } = incoming;
  if (entry[field]) return entry;
  delete entry[field];
  if (saved?.[field]) entry[field] = saved[field];
  if (saved?.[sealed]) entry[sealed] = saved[sealed];
  return entry;
}

const _byId = (list, id) => (list || []).find(e => e.id === id);

/**
 * Prépare une mise à jour venue d'un renderer avant de l'appliquer à la configuration.
 * Fournisseurs et connecteurs sont rapprochés par `id`, tokens par nom (`apiTokenRenames`
 * { nouveau: ancien } pour un renommage). Une entrée retirée supprime son secret ;
 * un moteur absent de la mise à jour est conservé.
 *
 * @param {object} current - configuration en mémoire du processus principal
 * @param {object} updates - clés de premier niveau envoyées par le renderer
 * @returns {object} mise à jour à appliquer avec Object.assign
 */
function mergeConfigUpdate(current, updates) {
  const {
    secretsEncrypted: _state, apiTokensSaved: _saved, apiTokensEncrypted: _sealed,
    apiTokenRenames: renames = {}, ...out
  } = updates || {};

  if (out.model) {
    const engines = { ...current.model?.engines };
    for (const [name, incoming] of Object.entries(out.model.engines || {})) {
      engines[name] = _keepSecret(incoming, current.model?.engines?.[name], 'apiKey', 'hasKey');
    }
    out.model = { ...out.model, engines };
  }
  if (Array.isArray(out.customProviders)) {
    out.customProviders = out.customProviders.map(p =>
      _keepSecret(p, _byId(current.customProviders, p.id), 'apiKey', 'hasKey'));
  }
  if (Array.isArray(out.connectors)) {
    out.connectors = out.connectors.map(c =>
      _keepSecret(c, _byId(current.connectors, c.id), 'auth', 'hasAuth'));
  }
  if (out.apiTokens) {
    const tokens = [];
    const sealed = [];
    for (const [name, value] of Object.entries(out.apiTokens)) {
      if (value) { tokens.push([name, value]); continue; }
      const renamed = Object.hasOwn(current.apiTokens || {}, renames[name] ?? '');
      const source  = renamed ? renames[name] : name;
      const known   = Object.hasOwn(current.apiTokens || {}, source);
      tokens.push([name, known ? current.apiTokens[source] : '']);
      if (known && current.apiTokensEncrypted?.[source]) sealed.push([name, current.apiTokensEncrypted[source]]);
    }
    out.apiTokens          = Object.fromEntries(tokens);
    out.apiTokensEncrypted = Object.fromEntries(sealed);
  }
  return out;
}

module.exports = { toPublicConfig, mergeConfigUpdate };
