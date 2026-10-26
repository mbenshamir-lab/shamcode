const { test } = require('node:test');
const assert = require('node:assert/strict');

const { readUrl } = require('../src/harness/tools/read-url');

// ── validation uniquement (pas de réseau) ─────────────────────────────────────

test('read_url — sans url → URL_MANQUANTE', async () => {
  const r = await readUrl({});
  assert.ok(!r.ok);
  assert.equal(r.error, 'URL_MANQUANTE');
});

test('read_url — url invalide → URL_INVALIDE', async () => {
  const r = await readUrl({ url: 'pas une url du tout %%' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'URL_INVALIDE');
});

test('read_url — protocole ftp → PROTOCOLE_NON_AUTORISÉ', async () => {
  const r = await readUrl({ url: 'ftp://example.com/file.txt' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'PROTOCOLE_NON_AUTORISÉ');
});

test('read_url — localhost bloqué → HÔTE_PRIVÉ_BLOQUÉ', async () => {
  const r = await readUrl({ url: 'http://localhost:3000/api' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'HÔTE_PRIVÉ_BLOQUÉ');
});

test('read_url — IP privée 127.0.0.1 bloquée → HÔTE_PRIVÉ_BLOQUÉ', async () => {
  const r = await readUrl({ url: 'http://127.0.0.1:8080/admin' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'HÔTE_PRIVÉ_BLOQUÉ');
});

test('read_url — IP privée 192.168.x.x bloquée → HÔTE_PRIVÉ_BLOQUÉ', async () => {
  const r = await readUrl({ url: 'http://192.168.1.1/' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'HÔTE_PRIVÉ_BLOQUÉ');
});

test('read_url — IP LAN 10.x.x.x bloquée → HÔTE_PRIVÉ_BLOQUÉ', async () => {
  const r = await readUrl({ url: 'http://10.0.0.1/dashboard' });
  assert.ok(!r.ok);
  assert.equal(r.error, 'HÔTE_PRIVÉ_BLOQUÉ');
});
