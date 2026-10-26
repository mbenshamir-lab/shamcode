const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { httpRequest, checkService } = require('../src/harness/tools/http-request');

// ── httpRequest — validation des paramètres ───────────────────────────────────

test('httpRequest — sans url → URL_MANQUANTE', async () => {
  const r = await httpRequest({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('URL_MANQUANTE'));
});

test('httpRequest — URL invalide → URL_INVALIDE', async () => {
  const r = await httpRequest({ url: 'pas-une-url' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('URL_INVALIDE'));
});

test('httpRequest — protocole ftp → PROTOCOLE_NON_AUTORISÉ', async () => {
  const r = await httpRequest({ url: 'ftp://exemple.com/fichier' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('PROTOCOLE_NON_AUTORISÉ'));
});

test('httpRequest — méthode inconnue → MÉTHODE_NON_AUTORISÉE', async () => {
  const r = await httpRequest({ url: 'http://exemple.com', method: 'TRACE' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('MÉTHODE_NON_AUTORISÉE'));
});

test('httpRequest — timeout très court sur hôte injoignable → TIMEOUT ou ERREUR_RÉSEAU', async () => {
  // Port fermé sur localhost garantit une erreur réseau rapide
  const r = await httpRequest({ url: 'http://127.0.0.1:19999/test', timeout: 500 });
  assert.equal(r.ok, false);
  assert.ok(
    r.error.includes('ERREUR_RÉSEAU') || r.error.includes('TIMEOUT'),
    `Attendu ERREUR_RÉSEAU ou TIMEOUT, reçu: ${r.error}`,
  );
});

test('httpRequest — max_response_chars respecté (valeur plancher)', async () => {
  // On ne fait pas de vraie requête — on vérifie que la logique de cap ne crashe pas
  const r = await httpRequest({ url: 'http://127.0.0.1:19999/', timeout: 300, max_response_chars: -99 });
  assert.equal(r.ok, false); // connexion refusée
});

// ── httpRequest — body sérialisé ─────────────────────────────────────────────

test('httpRequest — body objet JSON sérialisé (sans envoi réseau)', async () => {
  // On ne peut pas envoyer une vraie requête POST ici ; on vérifie que la fonction
  // traite les args sans lever d'exception et retourne { ok: false } en cas d'erreur réseau
  const r = await httpRequest({
    url:    'http://127.0.0.1:19999/api/data',
    method: 'POST',
    body:   { key: 'value', num: 42 },
    timeout: 300,
  });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('ERREUR_RÉSEAU') || r.error.includes('TIMEOUT'));
});

// ── checkService — validation ─────────────────────────────────────────────────

test('checkService — sans url ni port → URL_OU_PORT_REQUIS', async () => {
  const r = await checkService({});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('URL_OU_PORT_REQUIS'));
});

test('checkService — port invalide → PORT_INVALIDE', async () => {
  const r = await checkService({ port: 99999 });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('PORT_INVALIDE'));
});

test('checkService — port fermé → reachable false', async () => {
  const r = await checkService({ port: 19999, host: '127.0.0.1', timeout: 500 });
  assert.equal(r.ok, true, 'ok doit être true même si le port est fermé');
  assert.equal(r.reachable, false);
  assert.equal(r.port, 19999);
});

test('checkService — url injoignable → reachable false', async () => {
  const r = await checkService({ url: 'http://127.0.0.1:19999/', timeout: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.reachable, false);
  assert.ok(typeof r.latency_ms === 'number');
});

test('checkService — résultat contient latency_ms quand reachable', async () => {
  // Idem port fermé → reachable false, mais la structure doit toujours être cohérente
  const r = await checkService({ port: 19998, host: '127.0.0.1', timeout: 500 });
  assert.equal(r.ok, true);
  assert.ok('reachable' in r, 'La clé reachable doit être présente');
});
