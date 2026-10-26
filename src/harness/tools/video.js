'use strict';
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS  = 300_000; // 5 min max

// ── Point d'entrée ────────────────────────────────────────────────────────────

async function generateVideo(args, guard, projectRoot, config) {
  const provider = String(args.provider || _detectProvider(config) || '').trim();
  if (!provider) {
    return { ok: false, error: 'AUCUN_FOURNISSEUR — ajoutez un fournisseur dans Paramètres > Agent > Fournisseurs IA avec un nom, une URL de base et une clé API' };
  }

  const cp = _getCustomProvider(provider, config);
  if (!cp?.baseUrl) return { ok: false, error: `FOURNISSEUR_INCONNU : ${provider}. Ajoutez-le dans Paramètres > Agent > Fournisseurs IA avec une baseUrl` };
  if (!cp?.apiKey)  return { ok: false, error: `CLÉ_MANQUANTE pour ${provider}` };

  const outName = String(args.output || `video_${Date.now()}.mp4`);
  let outPath;
  try {
    outPath = guard ? guard(outName) : path.resolve(projectRoot || '.', outName);
  } catch (err) {
    return { ok: false, error: `CHEMIN_INVALIDE : ${err.message}` };
  }

  try {
    const videoData = await _customVideoGenerate(args, cp.apiKey, cp.baseUrl, cp.model);

    if (videoData.url) {
      await _downloadBinary(videoData.url, outPath);
    } else if (videoData.base64) {
      fs.writeFileSync(outPath, Buffer.from(videoData.base64, 'base64'));
    } else {
      return { ok: false, error: 'RÉPONSE_VIDE du fournisseur vidéo' };
    }

    const sizeKo = Math.round(fs.statSync(outPath).size / 1024);
    return { ok: true, content: `Vidéo générée → ${outName} (${sizeKo} Ko, fournisseur : ${provider})` };
  } catch (err) {
    return { ok: false, error: err.message || 'ERREUR_GÉNÉRATION' };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _detectProvider(config) {
  const cp = (config?.customProviders || []).find(p => p.apiKey && p.baseUrl && p.name);
  return cp?.name || null;
}

function _getCustomProvider(name, config) {
  // Comparaison insensible à la casse : le nom saisi par l'utilisateur ("Agnes Ai")
  // ne doit pas casser la recherche dans customProviders.
  const wanted = String(name || '').toLowerCase();
  return (config?.customProviders || []).find(p => String(p.name || '').toLowerCase() === wanted) || null;
}

// ── Fournisseur générique (API OpenAI Videos-compatible, 3 patterns de réponse) ─

async function _customVideoGenerate(args, key, baseUrl, defaultModel) {
  const base = baseUrl.replace(/\/$/, '');
  const body = {
    prompt:       String(args.prompt || '').slice(0, 2000),
    seconds:      String(Number(args.duration) || 5),
    aspect_ratio: args.ratio || '16:9',
    mode:         args.image ? 'keyframe' : 'text',
  };
  if (args.model || defaultModel) body.model = args.model || defaultModel;
  if (args.size)  body.size = args.size;
  if (args.image) body.first_frame = String(args.image);

  const res = await _jsonPost(`${base}/videos`, { 'Authorization': `Bearer ${key}` }, body);
  if (res.error) throw new Error(`Custom video — ${res.error?.message || JSON.stringify(res.error)}`);

  // Pattern 1 : réponse synchrone avec url directe
  if (res.url) return { url: res.url };
  // Pattern 2 : format OpenAI data[]
  if (res.data?.[0]?.url) return { url: res.data[0].url };
  // Pattern 3 : job asynchrone (video_id / task_id / id) → polling GET /videos/{id}
  const videoId = res.video_id || res.id || res.task_id;
  if (videoId) {
    return _poll(async () => {
      const r = await _jsonGet(`${base}/videos/${videoId}`, { 'Authorization': `Bearer ${key}` });
      const status = String(r.status || r.state || '');
      if (['completed', 'succeeded', 'done', 'success'].includes(status.toLowerCase())) {
        const url = r.url || r.assets?.video || r.output?.[0] || r.data?.[0]?.url;
        if (!url) throw new Error(`Custom video — statut ${status} mais aucune url dans : ${JSON.stringify(r)}`);
        return { done: true, data: { url } };
      }
      if (['failed', 'error', 'cancelled'].includes(status.toLowerCase())) {
        throw new Error(`Custom video — échec : ${r.error || r.failure_reason || JSON.stringify(r)}`);
      }
      return { done: false };
    });
  }

  throw new Error(`Custom video — réponse inattendue (ni url, ni data, ni id) : ${JSON.stringify(res)}`);
}

// ── Helpers réseau ────────────────────────────────────────────────────────────

function _jsonPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(payload.length), ...headers },
    };
    const req = (u.protocol === 'https:' ? https : http).request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function _jsonGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers };
    const req = (u.protocol === 'https:' ? https : http).request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function _downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    const file = fs.createWriteStream(dest);
    get(url, res => {
      if (res.statusCode >= 300 && res.headers.location) {
        file.close();
        return _downloadBinary(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function _poll(checkFn) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await checkFn();
    if (res.done) return res.data;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`TIMEOUT — génération vidéo dépassée (${POLL_TIMEOUT_MS / 1000}s)`);
}

module.exports = { generateVideo };
