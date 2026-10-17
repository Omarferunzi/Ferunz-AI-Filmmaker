/**
 * FERUNZI STUDIO — V70 renderer integration adapter
 *
 * Keeps the existing render contract:
 *   1) use a real generated asset when asset.uri exists;
 *   2) otherwise use the V70 procedural renderer;
 *   3) preserve ghost/inspection options.
 *
 * The adapter intentionally does not know how assets are stored or generated.
 * That remains the app's responsibility.
 */
(function (root) {
  'use strict';

  function escAttr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function validAsset(asset) {
    return !!(asset && typeof asset.uri === 'string' && asset.uri.trim());
  }

  function renderV70View(character, angle, asset, options) {
    var o = options || {};

    // Generated image remains authoritative when available.
    if (validAsset(asset) && !o.ghost) {
      var label = (character && character.name ? character.name : 'Character') +
        ' at ' + (Number.isFinite(Number(angle)) ? Number(angle) : 0) + ' degrees';
      return '<img class="render" src="' + escAttr(asset.uri.trim()) +
        '" alt="' + escAttr(label) + '" loading="lazy" decoding="async">';
    }

    // V70 renderer is expected to be provided by the page/app bundle.
    if (typeof root.figure !== 'function') {
      throw new Error('FERUNZ V70 renderer is not loaded: figure() is unavailable.');
    }

    var safeAngle = Number.isFinite(Number(angle)) ? Number(angle) : 0;
    return root.figure(character || {}, safeAngle, o);
  }

  root.renderV70View = renderV70View;
  root.renderViewV70 = renderV70View;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderV70View: renderV70View };
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
