/**
 * Outil call_api — appel REST authentifié vers une API tierce.
 * Le token n'est jamais passé en clair dans les args ; il est résolu
 * depuis config.apiTokens par une clé nommée.
 */

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
    const token  = tokens[token_key];
    if (!token) return { ok: false, error: `TOKEN_INTROUVABLE: "${token_key}" — vérifier Paramètres > Connecteurs > Tokens API` };
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  // Headers supplémentaires (sans écraser Authorization)
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (k.toLowerCase() !== 'authorization') requestHeaders[k] = v;
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
    const res  = await fetch(url, fetchOpts);
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
