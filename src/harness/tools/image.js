'use strict';
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Point d'entrée ────────────────────────────────────────────────────────────

async function generateImage(args, guard, projectRoot, config) {
  const provider = String(args.provider || _detectProvider(config) || '').trim();
  if (!provider) {
    return { ok: false, error: 'AUCUN_FOURNISSEUR — ajoutez un fournisseur dans Paramètres > Agent > Fournisseurs IA avec un nom, une URL de base et une clé API' };
  }

  const cp = _getCustomProvider(provider, config);
  if (!cp?.baseUrl) return { ok: false, error: `FOURNISSEUR_INCONNU : ${provider}. Ajoutez-le dans Paramètres > Agent > Fournisseurs IA avec une baseUrl` };
  if (!cp?.apiKey)  return { ok: false, error: `CLÉ_MANQUANTE pour ${provider}` };

  const ext     = args.format || 'png';
  const outName = String(args.output || `image_${Date.now()}.${ext}`);
  let outPath;
  try {
    outPath = guard ? guard(outName) : path.resolve(projectRoot || '.', outName);
  } catch (err) {
    return { ok: false, error: `CHEMIN_INVALIDE : ${err.message}` };
  }

  try {
    const imgData = await _customImageGenerate(args, cp.apiKey, cp.baseUrl, cp.model);

    if (imgData.base64) {
      fs.writeFileSync(outPath, Buffer.from(imgData.base64, 'base64'));
    } else if (imgData.url) {
      await _downloadBinary(imgData.url, outPath);
    } else {
      return { ok: false, error: 'RÉPONSE_VIDE du fournisseur image' };
    }

    const sizeKo = Math.round(fs.statSync(outPath).size / 1024);
    return { ok: true, content: `Image générée → ${outName} (${sizeKo} Ko, fournisseur : ${provider})` };
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

// ── Fournisseur générique OpenAI-compatible (/images/generations) ─────────────

async function _customImageGenerate(args, key, baseUrl, defaultModel) {
  const base = baseUrl.replace(/\/$/, '');
  const sizeMap = { '16:9': '1344x768', '9:16': '768x1344', '4:3': '1152x896', '3:4': '896x1152' };
  const size = sizeMap[args.ratio] || '1024x1024';
  const body = {
    prompt: String(args.prompt || '').slice(0, 4000),
    n: 1,
    size,
    response_format: 'url',
  };
  if (args.model || defaultModel) body.model = args.model || defaultModel;
  if (args.quality) body.quality = args.quality;

  const res = await _jsonPost(`${base}/images/generations`, { 'Authorization': `Bearer ${key}` }, body);
  if (res.error) throw new Error(`Custom image — ${res.error?.message || JSON.stringify(res.error)}`);

  const item = res.data?.[0];
  if (!item) throw new Error(`Custom image — réponse inattendue : ${JSON.stringify(res)}`);
  if (item.b64_json) return { base64: item.b64_json };
  if (item.url)      return { url: item.url };
  throw new Error(`Custom image — ni url ni b64_json dans la réponse : ${JSON.stringify(res)}`);
}

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

module.exports = { generateImage };
