/**
 * Tests Phase 66 — Fichiers cliquables dans le chat + visionneuse flottante
 *
 * 1. IPC — lecture d'un fichier du projet confinée au projectRoot
 * 2. app.js — détection des chemins (liens colorés) hors balises et blocs de code
 * 3. Visionneuse — ouverture, onglets, contenu, fermeture
 * 4. HTML / CSS — fenêtre flottante et style des liens
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src      = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css      = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const html     = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');
const ipcJs    = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
const preload  = fs.readFileSync(path.join(__dirname, '../src/main/preload.js'), 'utf8');
const { IPC }  = require('../src/shared/constants');

// ── Extraction du détecteur de fichiers (fonctions pures) ────────────────────
const start = src.indexOf('const _FILE_EXT');
const end   = src.indexOf('// Rendu Markdown léger');
assert.ok(start !== -1 && end > start, 'bloc de détection des fichiers introuvable');

const code = `
  function _escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  ${src.slice(start, end)}
  module.exports = { _linkifyText, _linkifyFiles };
`;
const mod = new module.constructor();
mod._compile(code, 'linkify-extract.js');
const { _linkifyText, _linkifyFiles } = mod.exports;

describe('IPC — lecture de fichier du projet', () => {
  it('le canal existe', () => {
    assert.equal(IPC.FILE_READ, 'file:read');
  });

  it('preload expose readProjectFile', () => {
    const idx = preload.indexOf('readProjectFile');
    assert.ok(idx !== -1, 'readProjectFile requis');
    assert.ok(preload.slice(idx, idx + 120).includes('IPC.FILE_READ'), 'canal dédié');
  });

  it('le handler main confine la lecture au projectRoot', () => {
    const idx = ipcJs.indexOf('IPC.FILE_READ');
    assert.ok(idx !== -1, 'handler FILE_READ requis');
    const block = ipcJs.slice(idx, idx + 900);
    assert.ok(block.includes('makeGuard(root)'), 'garde de chemin');
    assert.ok(block.includes('config.projectRoot'), 'racine du projet');
    assert.ok(block.includes('PROJET_NON_DÉFINI'), 'refus sans projet');
    assert.ok(block.includes('CHEMIN_MANQUANT'), 'refus sans chemin');
  });
});

describe('détection des fichiers — liens cliquables', () => {
  it('transforme un chemin simple en bouton', () => {
    const out = _linkifyText('Voir snake.py pour comprendre');
    assert.ok(out.includes('class="file-link"'), 'classe file-link');
    assert.ok(out.includes('data-path="snake.py"'), 'chemin en data-path');
    assert.ok(out.includes('snake.py</button>'), 'libellé conservé');
  });

  it('gère les chemins relatifs et la ligne', () => {
    const out = _linkifyText('cf. src/utils.js:42');
    assert.ok(out.includes('data-path="src/utils.js"'), 'chemin complet');
    assert.ok(out.includes('data-line="42"'), 'ligne ciblée');
    assert.ok(out.includes('src/utils.js:42</button>'), 'libellé avec ligne');
  });

  it('ignore le texte sans fichier', () => {
    assert.equal(_linkifyText('Aucun fichier ici'), 'Aucun fichier ici');
  });

  it('ne casse pas les balises HTML ni les blocs de code', () => {
    const out = _linkifyFiles('<p>Voir <strong>snake.py</strong></p><pre>snake.py</pre>');
    assert.ok(out.indexOf('<pre>snake.py</pre>') !== -1, 'bloc de code intact');
    assert.ok(out.includes('<strong><button class="file-link"'), 'lien dans le texte');
  });

  it('n\'altère pas un attribut existant', () => {
    const out = _linkifyFiles('<span title="snake.py">x</span>');
    assert.ok(out.includes('title="snake.py"'), 'attribut conservé');
    assert.ok(!out.includes('title="<button'), 'aucun lien dans un attribut');
  });
});

describe('app.js — visionneuse et câblage des clics', () => {
  it('les chemins rendus dans les réponses sont liés', () => {
    const idx = src.indexOf('function inline(s)');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('_linkifyFiles(out)'), 'linkification inline');
  });

  it('clic sur un lien → ouverture du fichier', () => {
    const idx = src.indexOf('body.addEventListener(\'click\'');
    assert.ok(idx !== -1, 'délégation de clic requise');
    const block = src.slice(idx, idx + 260);
    assert.ok(block.includes("closest('.file-link')"), 'cible file-link');
    assert.ok(block.includes('_openFile('), 'ouverture');
  });

  it('les pastilles de fichiers sont cliquables', () => {
    assert.ok(src.includes('data-path="${_escAttr(f.path)}"'), 'chemin sur la pastille');
    const idx = src.indexOf("bar.addEventListener('click'");
    assert.ok(idx !== -1, 'clic sur les pastilles');
    assert.ok(src.slice(idx, idx + 200).includes("closest('.tf-chip')"), 'cible tf-chip');
  });

  it('_openFile lit le fichier via l\'API et gère les onglets', () => {
    const idx = src.indexOf('async function _openFile');
    assert.ok(idx !== -1, '_openFile requise');
    const block = src.slice(idx, idx + 2000);
    assert.ok(block.includes('window.harness.readProjectFile(key)'), 'lecture IPC');
    assert.ok(block.includes("className = 'fv-tab'"), 'onglet créé');
    assert.ok(block.includes('_fvActivate(key, line)'), 'activation de l\'onglet');
    assert.ok(block.includes('_fvCloseTab(key)'), 'fermeture d\'onglet');
  });

  it('un onglet fermé pendant la lecture n\'est pas réinjecté', () => {
    const idx = src.indexOf('async function _openFile');
    const block = src.slice(idx, idx + 2000);
    assert.ok(block.includes('if (!current) return'), 'garde après await');
  });
});

describe('HTML / CSS — fenêtre volante', () => {
  it('la fenêtre et ses zones existent', () => {
    for (const id of ['file-viewer', 'fv-tabs', 'fv-content', 'fv-close', 'fv-empty']) {
      assert.ok(html.includes(`id="${id}"`), `#${id} manquant`);
    }
  });

  it('la fenêtre est flottante et masquable', () => {
    const idx = css.indexOf('.file-viewer {');
    assert.ok(idx !== -1, '.file-viewer requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('position: fixed'), 'flottante');
    assert.ok(block.includes('z-index'), 'au-dessus du chat');
  });

  it('les onglets et les numéros de ligne sont stylés', () => {
    for (const sel of ['.fv-tab', '.fv-tab.active', '.fv-line::before', '.fv-line-active']) {
      assert.ok(css.includes(sel), `${sel} manquant`);
    }
  });

  it('les liens de fichiers sont colorés', () => {
    const idx = css.indexOf('#chat-area .file-link {');
    assert.ok(idx !== -1, 'style du lien requis');
    const block = css.slice(idx, css.indexOf('}', idx));
    assert.ok(block.includes('color: var(--accent-hover)'), 'couleur identifiable');
    assert.ok(block.includes('cursor: pointer'), 'cliquable');
  });
});
