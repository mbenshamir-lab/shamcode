'use strict';

// La suite ne doit jamais écrire dans le vrai dossier de données : la rétention des
// sessions y effacerait l'historique de l'utilisateur.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const { getDataDir } = require('../src/shared/data-dir');

test('les données de la suite de tests restent dans le dossier temporaire', () => {
  const relative = path.relative(os.tmpdir(), getDataDir());
  assert.ok(
    !relative.startsWith('..') && !path.isAbsolute(relative),
    `données hors du dossier temporaire : ${getDataDir()} — lancer avec npm test, ou ajouter --require ./tests/lib/isolate-data.js`,
  );
});
