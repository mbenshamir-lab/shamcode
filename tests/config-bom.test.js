'use strict';

// Un config.json réenregistré par un éditeur Windows ou PowerShell 5.1 commence par un BOM.
// Il doit rester lu : sinon l'app repart sur les défauts et la sauvegarde suivante l'écrase.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'config-bom-'));
process.env.HARNESS_DATA_DIR = SANDBOX;
after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const { loadConfig } = require('../src/main/config');

describe('loadConfig — BOM UTF-8', () => {
  it('lit les réglages d\'un config.json qui commence par un BOM', async () => {
    const saved = { model: { primary: 'webllm', engines: {} }, enableShell: true };
    fs.writeFileSync(path.join(SANDBOX, 'config.json'), `\uFEFF${JSON.stringify(saved)}`, 'utf8');

    const config = await loadConfig();

    assert.equal(config.model.primary, 'webllm');
    assert.equal(config.enableShell, true);
  });
});
