/**
 * FERUNZ STUDIO — V70 scene entity binding
 * Binds reusable characters/creatures to scene actors without owning scene storage.
 */
(function (root) {
  'use strict';
  var CreatureAssets = root.FerunzCreatureAssets;
  if (!CreatureAssets) throw new Error('FerunzCreatureAssets must be loaded first');

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function text(v) { return String(v == null ? '' : v); }
  function angle(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    n = ((n % 360) + 360) % 360;
    var angles = [0,45,90,135,180,225,270,315];
    var best = angles[0], dist = Infinity;
    angles.forEach(function (a) { var d = Math.abs(a - n); if (d < dist) { dist = d; best = a; } });
    return best;
  }

  function bind(entity, options) {
    options = options || {};
    entity = entity || {};
    var type = entity.type === 'creature' ? 'creature' : 'character';
    return {
      actorId: text(options.actorId || ('actor-' + Date.now())),
      entityId: text(entity.id),
      entityType: type,
      name: text(entity.name || entity.label || 'Unnamed ' + type),
      assetId: text(entity.assetId || entity.id),
      angle: angle(options.angle),
      ghost: !!options.ghost,
      transform: clone(options.transform || { x: 0, y: 0, z: 0, scale: 1 }),
      metadata: clone(options.metadata || {})
    };
  }

  function update(binding, patch) {
    var next = clone(binding || {});
    patch = patch || {};
    if (patch.angle != null) next.angle = angle(patch.angle);
    if (patch.ghost != null) next.ghost = !!patch.ghost;
    if (patch.transform) next.transform = clone(patch.transform);
    if (patch.name != null) next.name = text(patch.name);
    if (patch.assetId != null) next.assetId = text(patch.assetId);
    return next;
  }

  function resolve(binding, library) {
    binding = binding || {};
    library = Array.isArray(library) ? library : [];
    return library.find(function (e) { return text(e.id) === text(binding.entityId) || text(e.assetId) === text(binding.assetId); }) || null;
  }

  function render(binding, library, options) {
    var entity = resolve(binding, library);
    if (!entity) return { ok: false, error: 'Scene entity is not available in the current library' };
    options = options || {};
    var a = angle(binding.angle);
    if (entity.type === 'creature') {
      var record = options.assetRecord || entity.assetRecord || null;
      if (!record) return { ok: false, error: 'Creature asset record is required for scene rendering' };
      var asset = CreatureAssets.getAngleAsset(record, a);
      return { ok: true, type: 'creature', actorId: binding.actorId, angle: a, html: CreatureAssets.renderAsset(record, a, { ghost: !!binding.ghost }), asset: asset };
    }
    return { ok: true, type: 'character', actorId: binding.actorId, angle: a, entity: entity };
  }

  root.FerunzSceneEntityBinding = { bind: bind, update: update, resolve: resolve, render: render, normalizeAngle: angle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzSceneEntityBinding;
})(typeof globalThis !== 'undefined' ? globalThis : this);
