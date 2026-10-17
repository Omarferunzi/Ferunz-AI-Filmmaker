/**
 * FERUNZI STUDIO V70 — application integration patch
 *
 * Insert after the V70 renderer and replace the app's old renderView body
 * with the compatibility function below. This preserves generated-image
 * priority, ghost mode, and location-specific sceneArt() when available.
 *
 * Existing app contract:
 *   renderView(c, angle, asset, o)
 *   asset.uri -> generated image
 *   art(c, angle, o) -> sceneArt() for location characters, figure() otherwise
 */
(function (root) {
  'use strict';

  var V70 = root.figure;
  if (typeof V70 !== 'function') {
    throw new Error('FERUNZ V70 renderer must be loaded before this patch.');
  }

  // Keep the V70 renderer available under a stable name even if the host app
  // later defines another figure() helper.
  root.ferunzV70Figure = V70;

  var oldSceneArt = typeof root.sceneArt === 'function' ? root.sceneArt : null;
  var oldIsLoc = typeof root.isLoc === 'function' ? root.isLoc : null;

  root.ferunzV70Art = function (c, angle, o) {
    o = o || {};
    if (oldIsLoc && oldIsLoc(c) && oldSceneArt) {
      return oldSceneArt(c, angle, o);
    }
    return root.ferunzV70Figure(c, Number.isFinite(Number(angle)) ? Number(angle) : 0, o);
  };

  root.renderViewV70 = function (c, angle, asset, o) {
    o = o || {};
    if (asset && asset.uri && !o.ghost) {
      return '<img class="render" src="' + root.esc(asset.uri) +
        '" alt="' + root.esc((c && c.name) || 'Character') +
        ' at ' + root.esc(angle || 0) + ' degrees">';
    }
    return root.ferunzV70Art(c, angle, o);
  };

  // Exact replacement for the published app's renderView contract.
  root.renderView = root.renderViewV70;
})(typeof globalThis !== 'undefined' ? globalThis : window);
