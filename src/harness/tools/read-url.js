/**
 * Outil read_url — récupère le contenu textuel d'une URL HTTP/HTTPS.
 * Bloque les adresses privées/locales pour éviter le SSRF.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const TIMEOUT_MS        = 10000;
const MAX_BYTES         = 2 * 1024 * 1024;   // 2 Mo max en mémoire
const MAX_CHARS_DEFAULT = 5000;
const MAX_CHARS_LIMIT   = 20000;

function _isPrivate(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' || h === '::1' ||
    /^127\./.test(h)  ||
    /^0\./.test(h)    ||
    /^10\./.test(h)   ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  );
}

function _stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _fetch(rawUrl, hopsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch { return reject(new Error('URL_INVALIDE')); }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reject(new Error('PROTOCOLE_NON_AUTORISÉ'));
    }
    if (_isPrivate(parsed.hostname)) {
      return reject(new Error('HÔTE_PRIVÉ_BLOQUÉ'));
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      rawUrl,
      { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'code-harness/1.0', Accept: 'text/html,text/plain,*/*' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (hopsLeft <= 0) return reject(new Error('TROP_DE_REDIRECTIONS'));
          _fetch(res.headers.location, hopsLeft - 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP_${res.statusCode}`));
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        if (
          !contentType.includes('text/') &&
          !contentType.includes('json') &&
          !contentType.includes('xml')
        ) {
          res.resume();
          return reject(new Error('TYPE_NON_SUPPORTÉ'));
        }

        const chunks = [];
        let totalBytes = 0;
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes <= MAX_BYTES) chunks.push(chunk);
        });
        res.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8'), contentType }));
        res.on('error', (e) => reject(new Error(`ERREUR_RÉSEAU: ${e.code || e.message}`)));
      },
    );

    req.on('error', (e) => reject(new Error(`ERREUR_RÉSEAU: ${e.code || e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

async function readUrl({ url: rawUrl, max_chars } = {}) {
  if (!rawUrl) return { ok: false, error: 'URL_MANQUANTE' };

  const maxChars = Math.min(Math.max(100, max_chars ?? MAX_CHARS_DEFAULT), MAX_CHARS_LIMIT);

  try {
    const { raw, contentType } = await _fetch(rawUrl, 5);
    const isHtml  = contentType.includes('text/html');
    const text    = isHtml ? _stripHtml(raw) : raw;
    const content = text.slice(0, maxChars);
    return {
      ok:        true,
      url:       rawUrl,
      content,
      chars:     content.length,
      truncated: text.length > maxChars || undefined,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { readUrl };
