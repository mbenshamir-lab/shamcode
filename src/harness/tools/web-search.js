/**
 * Outil web_search — recherche DuckDuckGo sans clé API.
 * Scrap le endpoint HTML public, extrait titre + URL + snippet pour chaque résultat.
 */

const https = require('https');
const { URL } = require('url');

const TIMEOUT_MS   = 12000;
const MAX_RESULTS  = 8;
const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';

function _fetch(rawUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch { return reject(new Error('URL_INVALIDE')); }

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        timeout:  TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; code-harness/1.0)',
          'Accept':     'text/html,*/*',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        },
      },
      (res) => {
        // Suit une redirection unique
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return _fetch(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP_${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', (e) => reject(new Error(`ERREUR_RÉSEAU: ${e.code || e.message}`)));
      },
    );
    req.on('error', (e) => reject(new Error(`ERREUR_RÉSEAU: ${e.code || e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.end();
  });
}

/** Extrait les balises HTML d'une chaîne et décode les entités courantes. */
function _clean(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Transforme une URL relative DDG en URL absolue de la cible. */
function _resolveUrl(raw) {
  // DDG encapsule les URLs dans //duckduckgo.com/l/?uddg=<encoded>
  const m = raw.match(/uddg=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* fallback */ }
  }
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

/**
 * Parse le HTML DDG et retourne un tableau de { title, url, snippet }.
 * DDG retourne les résultats dans des blocs <div class="result results_links...">
 */
function _parseResults(html, maxResults) {
  const results = [];

  // Chaque résultat est un bloc <a class="result__a" href="...">TITRE</a>
  // suivi d'un bloc <a class="result__snippet">SNIPPET</a>
  const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  let m;
  while ((m = blockRe.exec(html)) !== null && results.length < maxResults) {
    const url     = _resolveUrl(m[1]);
    const title   = _clean(m[2]);
    const snippet = _clean(m[4]);
    // Filtre les publicités DDG (URL interne ou vide)
    if (!url || url.includes('duckduckgo.com') || !title) continue;
    results.push({ title, url, snippet });
  }

  return results;
}

/**
 * @param {{ query: string, max_results?: number }} args
 * @returns {Promise<{ ok: boolean, results?: Array, query?: string, error?: string }>}
 */
async function webSearch({ query, max_results } = {}) {
  if (!query || !String(query).trim()) {
    return { ok: false, error: 'QUERY_MANQUANTE' };
  }
  const q = String(query).trim();
  const maxR = Math.min(Math.max(1, max_results ?? 5), MAX_RESULTS);

  const searchUrl = DDG_ENDPOINT + '?q=' + encodeURIComponent(q) + '&kl=fr-fr';

  try {
    const html    = await _fetch(searchUrl);
    const results = _parseResults(html, maxR);

    if (results.length === 0) {
      return { ok: true, query: q, results: [], message: 'Aucun résultat trouvé.' };
    }
    return { ok: true, query: q, results };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { webSearch };
