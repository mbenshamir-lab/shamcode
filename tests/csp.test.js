'use strict';

// Chaque renderer déclare une CSP : sans elle, tout HTML injecté (sortie du modèle,
// nom de fichier, contenu de page) pouvait charger une ressource distante.
// Les fenêtres visibles n'autorisent ni eval ni script distant ; les fenêtres
// techniques (WebLLM, Whisper) ont les dérogations minimales pour leur WASM/CDN.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function html(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function csp(rel) {
  const m = html(rel).match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  return m ? m[1] : '';
}

const SIMPLE = [
  'src/renderer-visible/index.html',
  'src/renderer-settings/settings.html',
  'src/renderer-design/design.html',
];

test('CSP — les fenêtres visibles déclarent une politique', () => {
  for (const rel of SIMPLE) {
    const policy = csp(rel);
    assert.ok(policy, `CSP absente dans ${rel}`);
    assert.match(policy, /default-src 'self'/, `${rel} : default-src manquant`);
    assert.match(policy, /object-src 'none'/, `${rel} : object-src manquant`);
    assert.ok(!policy.includes("'unsafe-eval'"), `${rel} : unsafe-eval interdit`);
    assert.ok(!/script-src[^;]*https?:/.test(policy), `${rel} : script distant interdit`);
  }
});

test('CSP — WebLLM autorise son CDN mais pas de script arbitraire', () => {
  const policy = csp('src/renderer-hidden/llm.html');
  assert.ok(policy, 'CSP absente dans llm.html');
  assert.match(policy, /script-src[^;]*https:\/\/esm\.run/);
  assert.match(policy, /worker-src[^;]*blob:/);
});

test('CSP — Whisper autorise le WASM local et le téléchargement du modèle', () => {
  const policy = csp('src/renderer-voice/voice.html');
  assert.ok(policy, 'CSP absente dans voice.html');
  assert.match(policy, /wasm-unsafe-eval/);
  assert.match(policy, /connect-src[^;]*https:/);
  assert.match(policy, /worker-src[^;]*blob:/);
});
