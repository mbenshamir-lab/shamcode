/**
 * Tests Phase 68 — Task Panel : cadres 1/4, un seul déplié, cadre Plan enrichi
 *
 * 1. CSS — chaque cadre = 1/4 de hauteur ; déplié = hauteur restante ; les
 *    autres sont réduits à leur en-tête.
 * 2. app.js — un seul cadre déplié à la fois, choisi par l'utilisateur.
 * 3. Cadre Plan — objectif général, tâches stratégiques, tendance (barre + %).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

const src  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/app.js'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer-visible/index.html'), 'utf8');

function rule(selector) {
  const idx = css.indexOf(`${selector} {`);
  if (idx === -1) return null;
  return css.slice(idx, css.indexOf('}', idx));
}

describe('CSS — hauteurs du Task Panel', () => {
  it('chaque cadre fait 1/4 de la hauteur', () => {
    const r = rule('.tp-panel');
    assert.ok(r, '.tp-panel requis');
    assert.ok(r.includes('flex: 0 0 calc(25% - 4.5px)'), '1/4 fixe');
  });

  it('le cadre ouvert reste plafonné à 1/4 (pas plus)', () => {
    const r = rule('.tp-panel.tp-panel-expanded');
    assert.ok(r, 'règle .tp-panel-expanded requise');
    assert.ok(r.includes('flex: 0 0 calc(25% - 4.5px)'), 'hauteur plafonnée à 1/4');
    assert.ok(!r.includes('flex: 1 1 auto'), 'aucune prise de la hauteur restante');
  });

  it('les autres cadres sont réduits à leur en-tête', () => {
    const r = rule('.tp-panel.tp-panel-collapsed');
    assert.ok(r, 'règle .tp-panel-collapsed requise');
    assert.ok(r.includes('flex: 0 0 30px'), 'hauteur d\'en-tête');
  });

  it('le corps est masqué sur un cadre replié', () => {
    assert.ok(css.includes('.tp-panel.tp-panel-collapsed .tp-panel-body'), 'corps masqué');
  });

  it('le panneau est plus large', () => {
    const r = rule('#task-panel');
    assert.ok(r.includes('width: 320px'), 'largeur augmentée');
  });

  it('le remplissage est identique au fond de l\'application', () => {
    const r = rule('.tp-panel');
    assert.ok(r.includes('background: transparent'), 'fond transparent');
    assert.ok(r.includes('box-shadow: none'), 'aucune ombre de carte');
  });
});

describe('app.js — un seul cadre déplié', () => {
  it('_tpToggleExpanded existe et gère l\'état unique', () => {
    const idx = src.indexOf('function _tpToggleExpanded');
    assert.ok(idx !== -1, 'fonction requise');
    const block = src.slice(idx, idx + 1000);
    assert.ok(block.includes('wasExpanded'), 'bascule');
    assert.ok(block.includes('const open = k === key'), 'cadre choisi ouvert');
    assert.ok(block.includes("classList.toggle('tp-panel-collapsed', !open)"), 'les autres repliés');
  });

  it('le clic sur un en-tête choisit le cadre', () => {
    // Cherche le handler du Task Panel (Object.entries(_tpPanels)…) — il peut y avoir
    // d'autres addEventListener('click') dans app.js (ex: sidebar sessions), d'où lastIndexOf.
    const anchor = "Object.entries(_tpPanels).forEach";
    // Deux occurrences : la première dans _tpToggleExpanded, la seconde câble les click handlers.
    const anchorIdx = src.lastIndexOf(anchor);
    assert.ok(anchorIdx !== -1, 'boucle _tpPanels requise');
    const block = src.slice(anchorIdx, anchorIdx + 400);
    assert.ok(block.includes("header.addEventListener('click'"), 'handler requis');
    assert.ok(block.includes('_tpToggleExpanded(key)'), 'bascule au clic');
    assert.ok(!block.includes("classList.toggle('tp-panel-collapsed')"), 'plus de bascule indépendante');
  });

  it('les cadres sont repliés au démarrage (en-têtes seuls)', () => {
    const count = (html.match(/class="tp-panel tp-panel-collapsed"/g) || []).length;
    assert.equal(count, 4, 'les 4 cadres doivent être repliés dans le HTML initial');
    const loopIdx = src.indexOf('Object.entries(_tpPanels).forEach');
    const loop = src.slice(loopIdx, loopIdx + 500);
    assert.ok(!loop.includes("classList.remove('tp-panel-collapsed')"), 'aucun dépliage dans la boucle de démarrage');
  });

  it('un second clic sur le cadre ouvert replie tout', () => {
    const idx = src.indexOf('function _tpToggleExpanded');
    const block = src.slice(idx, idx + 900);
    assert.ok(block.includes('if (wasExpanded)'), 'fermeture');
    assert.ok(block.includes("classList.remove('tp-panel-expanded')"), 'état retiré');
    assert.ok(block.includes("classList.add('tp-panel-collapsed')"), 'retour aux en-têtes');
  });

  it('l\'ouverture automatique ne vole pas le choix de l\'utilisateur', () => {
    const idx = src.indexOf('function _tpExpand(key)');
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('_tpAnyExpanded()'), 'garde de choix');
  });
});

describe('cadre Plan — objectif, tâches stratégiques, tendance', () => {
  it('la section progression existe dans le HTML', () => {
    for (const id of ['tp-progress', 'tp-progress-pct', 'tp-progress-fill', 'tp-progress-counts']) {
      assert.ok(html.includes(`id="${id}"`), `#${id} manquant`);
    }
  });

  it('les libellés parlent d\'objectif général et de tâches stratégiques', () => {
    assert.ok(html.includes('Objectif général'), 'objectif général');
    assert.ok(html.includes('Tâches stratégiques'), 'tâches stratégiques');
  });

  it('_tpRenderProgress calcule le pourcentage et la répartition', () => {
    const idx = src.indexOf('function _tpRenderProgress');
    assert.ok(idx !== -1, 'fonction requise');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('Math.round((done / total) * 100)'), 'pourcentage');
    assert.ok(block.includes('style.width'), 'barre remplie');
    assert.ok(block.includes('faite'), 'tâches faites');
    assert.ok(block.includes('en cours'), 'tâche en cours');
    assert.ok(block.includes('restante'), 'tâches restantes');
  });

  it('la progression suit l\'avancement réel du plan', () => {
    const idx = src.indexOf('function _tpSyncPlanProgress');
    assert.ok(idx !== -1, 'synchronisation requise');
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes('_chatTodoStepIdx'), 'étapes exécutées');
    assert.ok(block.includes('tp-todo-item '), 'états des tâches');
  });

  it('_advanceChatTodo met à jour la tendance', () => {
    const idx = src.indexOf('function _advanceChatTodo');
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes('_tpSyncPlanProgress()'), 'appel à la synchronisation');
  });

  it('un nouveau plan remet la tendance à zéro', () => {
    const idx = src.indexOf('function _tpSetPlan');
    const block = src.slice(idx, idx + 1200);
    assert.ok(block.includes('_tpRenderProgress(0'), 'remise à zéro');
  });

  it('le style de la barre et de l\'étape active est défini', () => {
    for (const sel of ['.tp-progress-bar', '.tp-progress-fill', '.tp-todo-item.active']) {
      assert.ok(css.includes(sel), `${sel} manquant`);
    }
  });
});
