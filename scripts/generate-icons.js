#!/usr/bin/env node
/**
 * Génère app.ico (Windows) depuis icon.svg.
 * Usage : node scripts/generate-icons.js
 */

const { Resvg }   = require('@resvg/resvg-js');
const png2icons   = require('png2icons');
const fs          = require('fs');
const path        = require('path');

const ASSETS = path.join(__dirname, '..', 'assets', 'icons');
const svgBuf = fs.readFileSync(path.join(ASSETS, 'icon.svg'));

// Rendu SVG → PNG 512×512
const resvg  = new Resvg(svgBuf, { fitTo: { mode: 'width', value: 512 } });
const png512 = resvg.render().asPng();
fs.writeFileSync(path.join(ASSETS, 'icon-512.png'), png512);
console.log('✓ icon-512.png');

// PNG 256 (pour ICO haute résolution)
const resvg256 = new Resvg(svgBuf, { fitTo: { mode: 'width', value: 256 } });
const png256   = resvg256.render().asPng();
fs.writeFileSync(path.join(ASSETS, 'icon-256.png'), png256);
console.log('✓ icon-256.png');

// ICO Windows (16, 24, 32, 48, 64, 128, 256)
const icoData = png2icons.createICO(png512, png2icons.BILINEAR, 0, true, true);
if (!icoData) throw new Error('Échec génération ICO');
fs.writeFileSync(path.join(ASSETS, 'app.ico'), icoData);
console.log('✓ app.ico');

console.log('\nIcônes générées dans assets/icons/');
