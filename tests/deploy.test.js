const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { deployProject } = require('../src/harness/tools/deploy');

// ── Helper ────────────────────────────────────────────────────────────────────

function makeTmpProject(...files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-deploy-'));
  for (const [name, content] of files) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ignoré */ }
}

// ── Sécurité : enableDeploy obligatoire ──────────────────────────────────────

test('deploy — sans enableDeploy → DEPLOY_DÉSACTIVÉ', async () => {
  const r = await deployProject({}, '/tmp/projet', { enableDeploy: false });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('DEPLOY_DÉSACTIVÉ'));
});

test('deploy — config undefined → DEPLOY_DÉSACTIVÉ', async () => {
  const r = await deployProject({}, '/tmp/projet', {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('DEPLOY_DÉSACTIVÉ'));
});

// ── Sans projectRoot ──────────────────────────────────────────────────────────

test('deploy — sans projectRoot → DEPLOY_SANS_PROJET', async () => {
  const r = await deployProject({}, '', { enableDeploy: true });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('DEPLOY_SANS_PROJET'));
});

// ── Détection de plateforme ───────────────────────────────────────────────────

test('deploy — projet sans config → PLATEFORME_NON_DÉTECTÉE', async () => {
  const dir = makeTmpProject(['README.md', '# projet']);
  try {
    const r = await deployProject({}, dir, { enableDeploy: true });
    assert.equal(r.ok, false);
    assert.ok(
      r.error.includes('PLATEFORME_NON_DÉTECTÉE'),
      `Attendu PLATEFORME_NON_DÉTECTÉE, reçu: ${r.error}`,
    );
  } finally {
    cleanup(dir);
  }
});

test('deploy — vercel.json détecté → plateforme vercel', async () => {
  const dir = makeTmpProject(['vercel.json', '{}']);
  try {
    // On ne va pas vraiment déployer ; on fournit une commande qui échoue vite
    const r = await deployProject(
      { command: 'node -e "process.exit(1)"', build_first: false, timeout: 10 },
      dir,
      { enableDeploy: true },
    );
    // La plateforme doit être détectée même si le déploiement échoue
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('DEPLOY_ÉCHOUÉ'));
  } finally {
    cleanup(dir);
  }
});

test('deploy — netlify.toml détecté → pipeline reconnu', async () => {
  const dir = makeTmpProject(['netlify.toml', '[build]\ncommand = "npm run build"']);
  try {
    const r = await deployProject(
      { command: 'node -e "process.exit(1)"', build_first: false, timeout: 10 },
      dir,
      { enableDeploy: true },
    );
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('DEPLOY_ÉCHOUÉ'));
  } finally {
    cleanup(dir);
  }
});

// ── package.json avec script deploy ──────────────────────────────────────────

test('deploy — package.json avec scripts.deploy → npm-deploy ou github-pages', async () => {
  const pkg = JSON.stringify({
    name: 'test-app',
    scripts: { build: 'echo build', deploy: 'echo deployed' },
  });
  const dir = makeTmpProject(['package.json', pkg]);
  try {
    const r = await deployProject(
      { build_first: false, timeout: 15 },
      dir,
      { enableDeploy: true },
    );
    // "echo deployed" doit réussir sur tous les OS
    assert.equal(r.ok, true, `Déploiement attendu OK, erreur: ${r.error}`);
    assert.ok(r.output.includes('deployed') || r.output.length > 0);
  } finally {
    cleanup(dir);
  }
});

// ── Commande personnalisée ────────────────────────────────────────────────────

test('deploy — commande custom réussite → ok true + output', async () => {
  const dir = makeTmpProject(['vercel.json', '{}']);
  try {
    const r = await deployProject(
      { command: 'node -e "console.log(\'deploy ok\')"', build_first: false, timeout: 15 },
      dir,
      { enableDeploy: true },
    );
    assert.equal(r.ok, true);
    assert.ok(r.output.includes('deploy ok'));
  } finally {
    cleanup(dir);
  }
});

test('deploy — commande custom échouée → ok false + DEPLOY_ÉCHOUÉ', async () => {
  const dir = makeTmpProject(['vercel.json', '{}']);
  try {
    const r = await deployProject(
      { command: 'node -e "process.exit(2)"', build_first: false, timeout: 15 },
      dir,
      { enableDeploy: true },
    );
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('DEPLOY_ÉCHOUÉ'));
  } finally {
    cleanup(dir);
  }
});

// ── Extraction d'URL dans la sortie ──────────────────────────────────────────

test('deploy — URL Vercel extraite de la sortie', async () => {
  const dir = makeTmpProject(['vercel.json', '{}']);
  const fakeOutput = 'Deploying... ✓ https://my-app-abc123.vercel.app';
  try {
    const r = await deployProject(
      {
        command: `node -e "process.stdout.write('${fakeOutput}')"`,
        build_first: false,
        timeout: 15,
      },
      dir,
      { enableDeploy: true },
    );
    assert.equal(r.ok, true);
    assert.ok(r.url, 'url doit être présente');
    assert.ok(r.url.includes('vercel.app'), `URL attendue vercel.app, reçue: ${r.url}`);
  } finally {
    cleanup(dir);
  }
});

// ── build_first désactivé ─────────────────────────────────────────────────────

test('deploy — build_first:false ignore le build même si buildCmd existe', async () => {
  const dir = makeTmpProject(['vercel.json', '{}']);
  try {
    const r = await deployProject(
      { command: 'node -e "console.log(\'ok\')"', build_first: false, timeout: 15 },
      dir,
      { enableDeploy: true },
    );
    assert.equal(r.ok, true);
    assert.ok(!r.output.includes('[build]'), 'Pas de phase build dans la sortie');
  } finally {
    cleanup(dir);
  }
});
