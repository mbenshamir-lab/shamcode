'use strict';

/**
 * http_request : requête HTTP vers une app locale ou distante.
 * check_service : vérifie qu'une URL ou un port TCP répond.
 *
 * Contrairement à read_url, localhost est autorisé (usage intentionnel
 * pour tester un serveur de dev local).
 */

const http  = require('http');
const https = require('https');
const net   = require('net');

const TIMEOUT_DEFAULT   = 10000;
const MAX_CHARS_DEFAULT = 5000;
const MAX_CHARS_LIMIT   = 50000;
const MAX_BODY_BYTES    = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_METHODS   = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseBody(body) {
  if (body === undefined || body === null) return { raw: undefined, contentType: null };
  if (typeof body === 'object') {
    return { raw: JSON.stringify(body), contentType: 'application/json' };
  }
  return { raw: String(body), contentType: null };
}

function _truncate(str, max) {
  if (str.length <= max) return { text: str, truncated: false };
  return { text: str.slice(0, max), truncated: true };
}

// ── httpRequest ───────────────────────────────────────────────────────────────

/**
 * Effectue une requête HTTP/HTTPS vers n'importe quelle URL (y compris localhost).
 * @param {{ url, method?, headers?, body?, timeout?, max_response_chars? }} args
 */
async function httpRequest(args = {}) {
  const {
    url:               rawUrl,
    method:            rawMethod   = 'GET',
    headers:           extraHeaders = {},
    body,
    timeout             = TIMEOUT_DEFAULT,
    max_response_chars: maxChars    = MAX_CHARS_DEFAULT,
  } = args;

  if (!rawUrl) return { ok: false, error: 'URL_MANQUANTE' };

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { return { ok: false, error: 'URL_INVALIDE' }; }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'PROTOCOLE_NON_AUTORISÉ — uniquement http/https' };
  }

  const method = String(rawMethod).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, error: `MÉTHODE_NON_AUTORISÉE: ${rawMethod}` };
  }

  const cap = Math.min(Math.max(100, maxChars), MAX_CHARS_LIMIT);
  const tms = Math.min(Math.max(1000, timeout), 120000);

  const { raw: reqBody, contentType } = _parseBody(body);
  const reqHeaders = {
    'User-Agent': 'code-harness/1.0',
    ...extraHeaders,
  };
  if (reqBody !== undefined) {
    if (contentType && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = contentType;
    }
    reqHeaders['Content-Length'] = Buffer.byteLength(reqBody, 'utf8');
  }

  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = lib.request(rawUrl, { method, headers: reqHeaders, timeout: tms }, (res) => {
      const chunks = [];
      let bytes = 0;
      let overflow = false;

      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) { overflow = true; }
        else { chunks.push(chunk); }
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const ct  = (res.headers['content-type'] || '').toLowerCase();

        let bodyOut;
        if (ct.includes('application/json')) {
          try {
            // Retourner l'objet JSON directement si taille raisonnable
            const parsed = JSON.parse(raw);
            const serialized = JSON.stringify(parsed, null, 2);
            const { text, truncated } = _truncate(serialized, cap);
            bodyOut = text;
            return resolve({
              ok:       true,
              status:   res.statusCode,
              headers:  res.headers,
              body:     bodyOut,
              truncated: truncated || overflow || undefined,
            });
          } catch {
            // JSON invalide → retomber en texte brut
          }
        }

        const { text, truncated } = _truncate(raw, cap);
        resolve({
          ok:       true,
          status:   res.statusCode,
          headers:  res.headers,
          body:     text,
          truncated: truncated || overflow || undefined,
        });
      });

      res.on('error', (e) => resolve({ ok: false, error: `ERREUR_RÉPONSE: ${e.message}` }));
    });

    req.on('error', (e) => resolve({ ok: false, error: `ERREUR_RÉSEAU: ${e.code || e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'TIMEOUT' }); });

    if (reqBody !== undefined) req.write(reqBody);
    req.end();
  });
}

// ── checkService ──────────────────────────────────────────────────────────────

/**
 * Vérifie si une URL ou un port TCP est accessible.
 * @param {{ url?, port?, host?, timeout? }} args
 */
async function checkService(args = {}) {
  const {
    url,
    port,
    host    = 'localhost',
    timeout = 5000,
  } = args;

  if (!url && !port) return { ok: false, error: 'URL_OU_PORT_REQUIS' };

  const tms = Math.min(Math.max(200, timeout), 30000);

  // ── Vérification par URL ───────────────────────────────────────────────────
  if (url) {
    const start = Date.now();
    const result = await httpRequest({ url, method: 'HEAD', timeout: tms, max_response_chars: 10 });
    const latency_ms = Date.now() - start;

    if (result.ok || result.status !== undefined) {
      return {
        ok:         true,
        reachable:  true,
        url,
        status:     result.status,
        latency_ms,
      };
    }
    // Timeout ou erreur réseau
    return {
      ok:        true,
      reachable: false,
      url,
      latency_ms,
      error:     result.error,
    };
  }

  // ── Vérification TCP ──────────────────────────────────────────────────────
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, error: `PORT_INVALIDE: ${port}` };
  }

  return new Promise((resolve) => {
    const start  = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(tms);

    socket.connect(portNum, host, () => {
      const latency_ms = Date.now() - start;
      socket.destroy();
      resolve({ ok: true, reachable: true, host, port: portNum, latency_ms });
    });

    const fail = (reason) => {
      socket.destroy();
      resolve({ ok: true, reachable: false, host, port: portNum, error: reason });
    };

    socket.on('error',   (e) => fail(e.code || e.message));
    socket.on('timeout', ()  => fail('TIMEOUT'));
  });
}

module.exports = { httpRequest, checkService };
