// ESLint — Code Harness
// Couvre src/main/ et src/harness/ (CommonJS, Node.js 20)
// Les tests (tests/) utilisent le même config.
// src/renderer-hidden/ (ESM) : ignoré ici (modules CDN, env navigateur).

'use strict';

module.exports = {
  root: true,
  env: {
    node:  true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType:  'commonjs',
  },
  rules: {
    // ── Erreurs potentielles ────────────────────────────────────────────────
    'no-unused-vars':      ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef':             'error',
    'no-unreachable':       'warn',
    'no-constant-condition':'warn',
    'eqeqeq':              ['error', 'always', { null: 'ignore' }],

    // ── Style ───────────────────────────────────────────────────────────────
    'no-var':               'error',
    'prefer-const':        ['warn', { destructuring: 'all' }],
    'no-console':           'warn',                    // zéro console.log en prod
    'semi':                ['error', 'always'],
    'quotes':              ['error', 'single', { avoidEscape: true }],
    'comma-dangle':        ['error', 'always-multiline'],
    'no-trailing-spaces':   'error',
    'eol-last':             'error',

    // ── Sécurité ────────────────────────────────────────────────────────────
    'no-eval':              'error',
    'no-implied-eval':      'error',
    'no-new-func':          'error',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'src/renderer-hidden/',   // ESM + CDN — style différent
    'src/renderer-visible/',  // UI vanilla — Prettier seul suffit
  ],
};
