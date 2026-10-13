/**
 * FERUNZ STUDIO — V70 creature generation controls
 * Keeps generation settings separate from scene placement while preserving entity identity.
 */
(function (root) {
  'use strict';
  var Studio = root.FerunzCreatureStudio;
  var Assets = root.FerunzCreatureAssets;
  if (!Studio) throw new Error('FerunzCreatureStudio must be loaded first');
  if (!Assets) throw new Error('FerunzCreatureAssets must be loaded first');

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function text(v) { return String(v == null ? '' : v); }

  function createState(creature, record) {
    var c = Studio.normalizeCreature(creature || record && record.creature || {});
    return {
      entityId: text(record && record.id),
      name: c.name,
      prompt: Studio.creaturePrompt(c),
      negativePrompt: 'duplicate heads, duplicate limbs, malformed anatomy, extra wings, extra tails, cropped creature, text, watermark',
      gen: Number(c.generation.gen || 1),
      vr: Number(c.generation.vr || 1),
      targetAngles: Studio.ANGLES.slice(),
      status: record && record.status || 'draft',
      missingAngles: record ? Assets.missingAngles(record) : Studio.ANGLES.slice()
    };
  }

  function update(state, patch) {
    var next = clone(state || {});
    patch = patch || {};
    if (patch.prompt != null) next.prompt = text(patch.prompt);
    if (patch.negativePrompt != null) next.negativePrompt = text(patch.negativePrompt);
    if (patch.gen != null && isFinite(Number(patch.gen))) next.gen = Math.max(1, Math.floor(Number(patch.gen)));
    if (patch.vr != null && isFinite(Number(patch.vr))) next.vr = Math.max(1, Math.floor(Number(patch.vr)));
    if (Array.isArray(patch.targetAngles)) next.targetAngles = patch.targetAngles.map(Number).filter(function(a){ return Studio.ANGLES.indexOf(a) >= 0; });
    return next;
  }

  function requestFor(creature, state, options) {
    options = options || {};
    var c = Studio.normalizeCreature(clone(creature || {}));
    c.generation.gen = state && state.gen || c.generation.gen;
    c.generation.vr = state && state.vr || c.generation.vr;
    var request = Assets.buildGenerationRequest(c, {
      id: state && state.entityId || options.id,
      source: options.source || 'ferunz-creature-generation-controls-v70',
      version: options.version || 'V70'
    });
    request.prompt = state && state.prompt || request.prompt;
    request.negativePrompt = state && state.negativePrompt || request.negativePrompt;
    request.angles = state && state.targetAngles && state.targetAngles.length ? state.targetAngles.slice() : Studio.ANGLES.slice();
    request.generation.gen = c.generation.gen;
    request.generation.vr = c.generation.vr;
    return request;
  }

  function missingRequest(record, state, options) {
    var next = clone(state || {});
    next.targetAngles = record ? Assets.missingAngles(record) : Studio.ANGLES.slice();
    return requestFor(record && record.creature, next, options);
  }

  function render(state) {
    state = state || {};
    var html = '<section class="ferunz-creature-generation-controls" aria-label="Creature generation">';
    html += '<label>Prompt<textarea data-generation="prompt">'+escapeHtml(state.prompt || '')+'</textarea></label>';
    html += '<label>Negative prompt<textarea data-generation="negativePrompt">'+escapeHtml(state.negativePrompt || '')+'</textarea></label>';
    html += '<label>Generation <input type="number" min="1" step="1" data-generation="gen" value="'+Number(state.gen || 1)+'"></label>';
    html += '<label>Variant <input type="number" min="1" step="1" data-generation="vr" value="'+Number(state.vr || 1)+'"></label>';
    html += '<div data-generation="angles" aria-label="Target angles">';
    (state.targetAngles || []).forEach(function(a){ html += '<button type="button" data-angle="'+a+'">'+a+'°</button>'; });
    html += '</div></section>';
    return html;
  }

  function escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  root.FerunzCreatureGenerationControls = { createState:createState, update:update, requestFor:requestFor, missingRequest:missingRequest, render:render };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzCreatureGenerationControls;
})(typeof globalThis !== 'undefined' ? globalThis : this);
