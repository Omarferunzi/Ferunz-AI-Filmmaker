/**
 * FERUNZ STUDIO — V70 scene creature controls
 * Framework-free scene-editor integration for reusable creature actors.
 */
(function (root) {
  'use strict';
  var Binding = root.FerunzSceneEntityBinding;
  var Assets = root.FerunzCreatureAssets;
  if (!Binding) throw new Error('FerunzSceneEntityBinding must be loaded first');
  if (!Assets) throw new Error('FerunzCreatureAssets must be loaded first');

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function text(v) { return String(v == null ? '' : v); }

  function createState(binding, library) {
    var entity = Binding.resolve(binding, library || []);
    return {
      actorId: text(binding && binding.actorId),
      entityId: text(binding && binding.entityId),
      entityType: text(binding && binding.entityType || 'character'),
      name: text(binding && binding.name || entity && entity.name || 'Unnamed'),
      angle: Binding.normalizeAngle(binding && binding.angle),
      ghost: !!(binding && binding.ghost),
      transform: clone(binding && binding.transform || {x:0,y:0,z:0,scale:1}),
      assetStatus: entity && entity.status || 'unknown',
      missingAngles: [],
      selected: false
    };
  }

  function update(state, patch) {
    var next = clone(state || {});
    patch = patch || {};
    if (patch.angle != null) next.angle = Binding.normalizeAngle(patch.angle);
    if (patch.ghost != null) next.ghost = !!patch.ghost;
    if (patch.transform) next.transform = clone(patch.transform);
    if (patch.selected != null) next.selected = !!patch.selected;
    if (patch.name != null) next.name = text(patch.name);
    if (patch.assetStatus != null) next.assetStatus = text(patch.assetStatus);
    if (Array.isArray(patch.missingAngles)) next.missingAngles = patch.missingAngles.slice();
    return next;
  }

  function applyToBinding(binding, state) {
    return Binding.update(binding, {
      angle: state && state.angle,
      ghost: state && state.ghost,
      transform: state && state.transform,
      name: state && state.name
    });
  }

  function refreshAssetState(state, record) {
    var next = clone(state || {});
    if (record) {
      next.assetStatus = record.status || 'unknown';
      next.missingAngles = Assets.missingAngles(record);
    }
    return next;
  }

  function renderTurntable(record, state, options) {
    options = options || {};
    if (!record) return '<div class="ferunz-creature-turntable empty">No creature asset</div>';
    var selected = Binding.normalizeAngle(state && state.angle);
    var html = '<div class="ferunz-creature-turntable" role="group" aria-label="Creature turntable">';
    Assets.getAngleAsset(record, selected);
    Assets.ANGLES = Assets.ANGLES || [0,45,90,135,180,225,270,315];
    var angles = [0,45,90,135,180,225,270,315];
    angles.forEach(function (a) {
      var asset = Assets.getAngleAsset(record, a);
      var active = a === selected ? ' active' : '';
      var label = a + ' degrees';
      if (asset && asset.uri) {
        html += '<button type="button" class="ferunz-angle' + active + '" data-angle="' + a + '" aria-label="' + label + '" aria-pressed="' + (a === selected ? 'true':'false') + '"><img src="' + escapeHtml(asset.uri) + '" alt=""></button>';
      } else {
        html += '<button type="button" class="ferunz-angle missing' + active + '" data-angle="' + a + '" aria-label="' + label + ' — missing asset" aria-pressed="' + (a === selected ? 'true':'false') + '"><span>' + a + '°</span></button>';
      }
    });
    html += '</div>';
    return html;
  }

  function renderControls(state, options) {
    state = state || {};
    options = options || {};
    var title = escapeHtml(state.name || 'Creature');
    var html = '<section class="ferunz-scene-creature-controls" aria-label="Creature controls">';
    html += '<header><strong>' + title + '</strong><span class="asset-status">' + escapeHtml(state.assetStatus || 'unknown') + '</span></header>';
    html += '<label>Turntable angle<select data-creature-control="angle">';
    [0,45,90,135,180,225,270,315].forEach(function(a){ html += '<option value="'+a+'"'+(a===state.angle?' selected':'')+'>'+a+'°</option>'; });
    html += '</select></label>';
    html += '<label><input type="checkbox" data-creature-control="ghost"'+(state.ghost?' checked':'')+'> Ghost / procedural preview</label>';
    html += '<div class="creature-transform" data-creature-control="transform">';
    html += '<label>Scale <input type="number" min="0.01" step="0.01" value="'+Number(state.transform && state.transform.scale || 1)+'" data-transform="scale"></label>';
    html += '</div>';
    if (state.missingAngles && state.missingAngles.length) {
      html += '<p class="asset-warning">Missing angles: '+escapeHtml(state.missingAngles.join(', '))+'°</p>';
    }
    html += '</section>';
    return html;
  }

  function escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  root.FerunzSceneCreatureControls = {
    createState: createState,
    update: update,
    applyToBinding: applyToBinding,
    refreshAssetState: refreshAssetState,
    renderTurntable: renderTurntable,
    renderControls: renderControls
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzSceneCreatureControls;
})(typeof globalThis !== 'undefined' ? globalThis : this);
