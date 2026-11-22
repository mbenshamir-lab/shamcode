'use strict';

// Résolution des chemins de médias affichables dans le chat (renderer, sans FS).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('../src/renderer-visible/media.js');
const Media = globalThis.ShamMedia;

const ROOT = path.join(__dirname, '..');
const APP  = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/index.html'), 'utf8');
const CSS  = fs.readFileSync(path.join(ROOT, 'src/renderer-visible/styles.css'), 'utf8');

test('media — types reconnus', () => {
  assert.equal(Media.kindOf('a/b/photo.PNG'), 'image');
  assert.equal(Media.kindOf('logo.svg'), 'image');
  assert.equal(Media.kindOf('clip.mp4'), 'video');
  assert.equal(Media.kindOf('archive.zip'), '');
  assert.equal(Media.kindOf(''), '');
});

test('media — chemins relatifs sûrs', () => {
  assert.equal(Media.safeRel('docs/image.png'), 'docs/image.png');
  assert.equal(Media.safeRel('./docs\\image.png'), 'docs/image.png');
  assert.equal(Media.safeRel('a//b/c.png'), 'a/b/c.png');
});

test('media — refuses : absolu, lecteur, protocole, traversée', () => {
  assert.equal(Media.safeRel('/etc/passwd.png'), '');
  assert.equal(Media.safeRel('C:\\Windows\\secret.png'), '');
  assert.equal(Media.safeRel('https://example.com/x.png'), '');
  assert.equal(Media.safeRel('../../secret.png'), '');
  assert.equal(Media.safeRel('a/../b.png'), '');
  assert.equal(Media.safeRel('..\\x.png'), '');
});

test('media — URL file:// sous le projet, segments encodés', () => {
  const url = Media.fileUrl('docs/mon image.png', 'C:\\Users\\WORK\\mon projet');
  assert.equal(url, 'file:///C:/Users/WORK/mon%20projet/docs/mon%20image.png');
  assert.equal(Media.fileUrl('../x.png', 'C:/p'), '');
  assert.equal(Media.fileUrl('a.png', ''), '');
});

test('media — extraction depuis un texte de résultat', () => {
  assert.equal(Media.findMediaPath('Image générée → image_123.png (45 Ko)'), 'image_123.png');
  assert.equal(Media.findMediaPath('Vidéo générée → clip.mp4.'), 'clip.mp4');
  assert.equal(Media.findMediaPath('aucun média ici'), '');
  assert.equal(Media.findMediaPath('voir docs/chart.png:12'), 'docs/chart.png');
});

test('media — media.js chargé avant app.js, CSP compatible', () => {
  const mediaIdx = HTML.indexOf('src="media.js"');
  const appIdx   = HTML.indexOf('src="app.js"');
  assert.ok(mediaIdx !== -1, 'media.js doit être chargé');
  assert.ok(appIdx > mediaIdx, 'media.js doit précéder app.js');
  assert.ok(HTML.includes("img-src 'self' file:"), 'CSP img-src file: requis');
  assert.ok(HTML.includes("media-src 'self' file:"), 'CSP media-src file: requis');
});

test('media — rendu dans le chat et la visionneuse', () => {
  for (const marker of ['_mediaElement', '_appendMediaCard', '_maybeAppendToolMedia', 'md-media']) {
    assert.ok(APP.includes(marker), `${marker} absent de app.js`);
  }
  assert.ok(APP.includes("entry.mediaKind === 'image'"), 'la visionneuse doit gérer les médias');
  for (const sel of ['.md-media', '.media-open', '.fv-media']) {
    assert.ok(CSS.includes(sel), `${sel} absent du CSS`);
  }
});

test('media — aucun chemin arbitraire rendu par le chat', () => {
  assert.equal(Media.safeRel('file:///etc/passwd.png'), '');
  assert.equal(Media.safeRel('//serveur/partage/x.png'), '');
  assert.equal(Media.safeRel('a/b/../../../x.png'), '');
  assert.ok(APP.includes('_mediaApi()'), 'app.js doit passer par ShamMedia');
});
