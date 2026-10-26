'use strict';

/**
 * deploy : détecte la plateforme de déploiement du projet et lance le pipeline.
 *
 * Nécessite config.enableDeploy === true (à activer dans les paramètres).
 * Plateformes détectées : Vercel, Netlify, Fly.io, Railway, Docker, npm deploy,
 * GitHub Pages (gh-pages).
 */

const fs          = require('fs');
const path        = require('path');
const { exec }    = require('child_process');

const MAX_DEPLOY_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_OUTPUT_CHARS      = 5_000;

// ── Détection de plateforme ───────────────────────────────────────────────────

const PLATFORM_RULES = [
  {
    files:    ['vercel.json', '.vercel'],
    platform: 'vercel',
    build:    null,                              // Vercel CLI gère le build
    deploy:   'npx vercel deploy --yes --prod',
  },
  {
    files:    ['netlify.toml', '.netlify'],
    platform: 'netlify',
    build:    null,
    deploy:   'npx netlify-cli deploy --prod --yes',
  },
  {
    files:    ['fly.toml'],
    platform: 'fly',
    build:    null,
    deploy:   'flyctl deploy',
  },
  {
    files:    ['railway.json', 'railway.toml'],
    platform: 'railway',
    build:    null,
    deploy:   'railway up',
  },
  {
    files:    ['Dockerfile'],
    platform: 'docker',
    build:    'docker build -t app .',
    deploy:   'docker run -d -p 8080:8080 app',
  },
];

function _detectPlatform(projectRoot) {
  for (const rule of PLATFORM_RULES) {
    for (const file of rule.files) {
      if (fs.existsSync(path.join(projectRoot, file))) return rule;
    }
  }

  // Fallback : lire package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const scripts = pkg.scripts || {};

    if (scripts.deploy) {
      // gh-pages ?
      const hasDeps = (d) => Object.keys(d || {}).includes('gh-pages');
      if (hasDeps(pkg.dependencies) || hasDeps(pkg.devDependencies)) {
        return {
          platform: 'github-pages',
          build:    scripts.build ? 'npm run build' : null,
          deploy:   'npm run deploy',
        };
      }
      return {
        platform: 'npm-deploy',
        build:    scripts.build ? 'npm run build' : null,
        deploy:   'npm run deploy',
      };
    }
  } catch {
    // pas de package.json ou JSON invalide
  }

  return null;
}

// ── Extraction de l'URL dans la sortie ────────────────────────────────────────

const URL_PATTERNS = [
  /https?:\/\/[a-z0-9-]+\.vercel\.app[^\s]*/i,
  /https?:\/\/[a-z0-9-]+\.netlify\.app[^\s]*/i,
  /https?:\/\/[a-z0-9-]+\.fly\.dev[^\s]*/i,
  /https?:\/\/[a-z0-9-]+\.up\.railway\.app[^\s]*/i,
  /https?:\/\/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}\/[^\s]*/i,
  /https?:\/\/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}/i,
];

function _parseUrl(output) {
  for (const pattern of URL_PATTERNS) {
    const match = output.match(pattern);
    if (match) return match[0].replace(/[,;]+$/, '');
  }
  return null;
}

// ── Exécution d'une commande ──────────────────────────────────────────────────

function _runCmd(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(command, {
      cwd,
      timeout:   timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      shell:     true,
    }, (err, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim().slice(0, MAX_OUTPUT_CHARS * 2);
      resolve({
        exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        output,
      });
    });
  });
}

// ── Outil principal ───────────────────────────────────────────────────────────

/**
 * Déploie l'application du projet.
 * @param {{ platform?, command?, build_first?, timeout? }} args
 * @param {string} projectRoot
 * @param {object} config
 */
async function deployProject(args = {}, projectRoot = '', config = {}) {
  if (!config.enableDeploy) {
    return {
      ok:    false,
      error: 'DEPLOY_DÉSACTIVÉ — Activez "enableDeploy" dans les paramètres de l\'application',
    };
  }

  if (!projectRoot) return { ok: false, error: 'DEPLOY_SANS_PROJET' };

  const {
    platform:   platformOverride,
    command:    commandOverride,
    build_first: buildFirst = true,
    timeout     = 300,
  } = args;

  const timeoutMs = Math.min(Math.max(10, timeout), 600) * 1000;

  // Détection ou override de plateforme
  let detected = _detectPlatform(projectRoot);

  if (platformOverride && platformOverride !== 'auto') {
    detected = PLATFORM_RULES.find(r => r.platform === platformOverride) || detected;
  }

  const deployCmd = commandOverride || detected?.deploy;
  if (!deployCmd) {
    return {
      ok:    false,
      error: 'PLATEFORME_NON_DÉTECTÉE — Aucun fichier de configuration de déploiement trouvé (vercel.json, netlify.toml, fly.toml, railway.json, Dockerfile, package.json:scripts.deploy)',
    };
  }

  const buildCmd = buildFirst ? (detected?.build || null) : null;
  const parts    = [];

  // ── Étape 1 : Build ───────────────────────────────────────────────────────
  if (buildCmd) {
    const buildTime = Math.floor(timeoutMs * 0.4);
    const buildResult = await _runCmd(buildCmd, projectRoot, buildTime);
    parts.push(`[build] $ ${buildCmd}\n${buildResult.output}`);

    if (buildResult.exitCode !== 0) {
      return {
        ok:     false,
        error:  'BUILD_ÉCHOUÉ',
        output: parts.join('\n').slice(0, MAX_OUTPUT_CHARS),
      };
    }
  }

  // ── Étape 2 : Deploy ──────────────────────────────────────────────────────
  const deployTime  = buildCmd ? Math.floor(timeoutMs * 0.6) : timeoutMs;
  const deployResult = await _runCmd(deployCmd, projectRoot, deployTime);
  parts.push(`[deploy] $ ${deployCmd}\n${deployResult.output}`);

  const fullOutput = parts.join('\n').slice(0, MAX_OUTPUT_CHARS);
  const url        = _parseUrl(deployResult.output);

  if (deployResult.exitCode !== 0) {
    return { ok: false, error: 'DEPLOY_ÉCHOUÉ', output: fullOutput };
  }

  return {
    ok:       true,
    platform: detected?.platform || platformOverride || 'custom',
    url:      url || undefined,
    output:   fullOutput,
  };
}

module.exports = { deployProject };
