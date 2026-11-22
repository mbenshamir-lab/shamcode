/**
 * Media — résolution des chemins d'images/vidéos affichables dans le chat.
 *
 * Aucun accès disque : on ne fait que construire une URL `file://` à partir du
 * projectRoot. Le navigateur charge ensuite le média. Les chemins absolus, les
 * traversées `..` et les protocoles distants sont refusés : un média affichable
 * reste toujours sous le projet.
 *
 * Exposé en `window.ShamMedia` (script classique, chargé avant app.js).
 */
(function (global) {
  'use strict';

  const EXT = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
    avif: 'image', bmp: 'image', svg: 'image', ico: 'image',
    mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  };

  // Un chemin de média cité dans du texte : « Image générée → sortie.png (12 Ko) ».
  const PATH_RE = /[^\s"'<>|]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|mp4|webm|mov|m4v|ogv)(?![a-z0-9])/i;

  /** @param {string} p @returns {'image'|'video'|''} */
  function kindOf(p) {
    const ext = String(p || '').split('.').pop().toLowerCase();
    return EXT[ext] || '';
  }

  /**
   * Normalise un chemin relatif sûr, ou retourne ''.
   * Refuse : absolu, lecteur Windows, protocole, `..`, segment vide.
   * @param {string} p
   * @returns {string}
   */
  function safeRel(p) {
    let s = String(p || '').trim()
      .replace(/^[("'[\s]+|[)"'\]]+$/g, '')
      .replace(/\\/g, '/');
    if (!s || s.includes('\0') || s.includes('://')) return '';
    if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
    s = s.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
    const parts = s.split('/');
    if (parts.some(seg => !seg || seg === '.' || seg === '..')) return '';
    return parts.join('/');
  }

  /**
   * URL `file://` d'un média du projet, ou ''.
   * @param {string} rel chemin relatif (déjà normalisé ou non)
   * @param {string} projectRoot racine absolue du projet
   * @returns {string}
   */
  function fileUrl(rel, projectRoot) {
    const safe = safeRel(rel);
    const root = String(projectRoot || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!safe || !root) return '';

    const full = `${root}/${safe}`.replace(/\/{2,}/g, '/');
    const parts = full.split('/');
    const encoded = parts.map((seg, i) => {
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg; // lecteur Windows
      return encodeURIComponent(seg);
    }).join('/');
    return full.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
  }

  /** Extrait le premier chemin de média d'un texte, ou ''. */
  function findMediaPath(text) {
    const m = String(text || '').match(PATH_RE);
    if (!m) return '';
    return m[0].replace(/[.,;:!?)]+$/, '');
  }

  global.ShamMedia = { EXT, kindOf, safeRel, fileUrl, findMediaPath };
})(typeof window !== 'undefined' ? window : globalThis);
