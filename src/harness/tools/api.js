/**
 * Outil call_api — appel REST authentifié vers une API tierce.
 * Le token n'est jamais passé en clair dans les args ; il est résolu
 * depuis config.apiTokens par une clé nommée, et n'est envoyé qu'aux domaines
 * déclarés pour elle dans config.apiTokenHosts (ADR-041).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Domaine saisi par l'utilisateur (« api.github.com », « hôte:port » ou URL complète). */
function _allowedHost(entry) {
  const text = String(entry || '').trim();
  if (!text) return null;
  try { return new URL(text.includes('://') ? text : `https://${text}`); } catch { return null; }
}

/**
 * Le modèle choisit l'URL : sans cette liste, une page piégée suffirait à faire sortir un token.
 * @returns {string|null} code d'erreur, ou null si l'envoi est autorisé
 */
function _refuseDestination(rawUrl, tokenName, hosts) {
  const allowed = (Array.isArray(hosts) ? hosts : []).map(_allowedHost).filter(Boolean);
  if (allowed.length === 0) {
    return `DOMAINE_NON_DÉCLARÉ: aucun domaine autorisé pour le token "${tokenName}" — le saisir dans Paramètres > Connecteurs > Tokens API`;
  }
  let target;
  try { target = new URL(rawUrl); } catch { return 'URL_INVALIDE'; }

  const secure = target.protocol === 'https:' || (target.protocol === 'http:' && LOCAL_HOSTS.has(target.hostname));
  if (!secure) return 'HTTPS_REQUIS: un token ne circule qu\'en HTTPS (HTTP admis vers la machine locale)';

  const port  = target.port || (target.protocol === 'https:' ? '443' : '80');
  const match = allowed.some(a => a.hostname === target.hostname && (!a.port || a.port === port));
  return match
    ? null
    : `DOMAINE_NON_AUTORISÉ: "${target.host}" n'est pas déclaré pour le token "${tokenName}"`;
}

async function callApi(args, config) {
  const {
    url,
    method     = 'GET',
    body,
    token_key,
    headers: extraHeaders,
  } = args || {};

  if (!url || typeof url !== 'string') return { ok: false, error: 'URL_MANQUANTE' };

  const requestHeaders = {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  // Résolution du token depuis la config (jamais depuis les args)
  if (token_key) {
    const tokens = config.apiTokens || {};
    const token  = Object.hasOwn(tokens, token_key) ? tokens[token_key] : '';
    if (!token) return { ok: false, error: `TOKEN_INTROUVABLE: "${token_key}" — vérifier Paramètres > Connecteurs > Tokens API` };
    const refusal = _refuseDestination(url, token_key, config.apiTokenHosts?.[token_key]);
    if (refusal) return { ok: false, error: refusal };
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  // Headers supplémentaires (sans écraser Authorization)
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const [k, v] of Object.entries(extraHeaders)) {
      // Avec un token, « Host » est écarté : il redirigerait la requête sur un hébergement partagé
      const name = k.toLowerCase();
      if (name !== 'authorization' && !(token_key && name === 'host')) requestHeaders[k] = v;
    }
  }

  const fetchOpts = {
    method:  method.toUpperCase(),
    headers: requestHeaders,
  };
  if (body !== undefined && body !== null && !['GET', 'HEAD'].includes(fetchOpts.method)) {
    fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    // Une redirection mènerait hors des domaines autorisés : on la rend au modèle
    if (token_key) fetchOpts.redirect = 'manual';
    const res  = await fetch(url, fetchOpts);
    if (token_key && res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: 'REDIRECTION_NON_SUIVIE', location: res.headers.get('location') };
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) return { ok: false, status: res.status, error: `HTTP_${res.status}`, data };
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: 'NETWORK_ERROR', message: err.message };
  }
}

module.exports = { callApi };
