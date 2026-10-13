/**
 * FERUNZ STUDIO — Character / Creature selector integration
 * Preserves existing character entities while adding reusable creatures.
 */
(function (root) {
  'use strict';
  var CreatureAssets = root.FerunzCreatureAssets;
  if (!CreatureAssets) throw new Error('FerunzCreatureAssets must be loaded first');

  function text(v) { return String(v == null ? '' : v); }
  function normalize(entity) {
    entity = entity || {};
    var type = entity.type === 'creature' ? 'creature' : 'character';
    return {
      id: text(entity.id),
      type: type,
      name: text(entity.name || entity.label || 'Unnamed ' + type),
      label: text(entity.label || entity.name || 'Unnamed ' + type),
      thumbnail: entity.thumbnail || null,
      status: entity.status || 'ready',
      source: entity.source || 'project'
    };
  }

  function merge(characters, creatures) {
    var out = [];
    (Array.isArray(characters) ? characters : []).forEach(function (x) { out.push(normalize(x)); });
    (Array.isArray(creatures) ? creatures : []).forEach(function (x) { out.push(normalize(x)); });
    return out;
  }

  function filter(entities, query, type) {
    var q = text(query).trim().toLowerCase();
    return (entities || []).filter(function (e) {
      var okType = !type || type === 'all' || e.type === type;
      var okText = !q || e.name.toLowerCase().indexOf(q) >= 0 || e.label.toLowerCase().indexOf(q) >= 0;
      return okType && okText;
    });
  }

  function render(items, options) {
    options = options || {};
    var activeId = text(options.activeId);
    var html = '<div class="ferunz-entity-selector" role="listbox" aria-label="Characters and creatures">';
    html += '<div class="entity-filters" role="group" aria-label="Entity type">';
    ['all','character','creature'].forEach(function (type) {
      html += '<button type="button" data-entity-type="' + type + '">' + type + '</button>';
    });
    html += '</div><div class="entity-options">';
    (items || []).forEach(function (e) {
      var active = e.id && e.id === activeId ? ' active' : '';
      var thumb = e.thumbnail ? '<img src="' + escapeHtml(e.thumbnail) + '" alt="">' : '<span class="entity-placeholder">' + escapeHtml(e.type) + '</span>';
      html += '<button type="button" class="entity-option' + active + '" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-entity-id="' + escapeHtml(e.id) + '" data-entity-kind="' + e.type + '">';
      html += thumb + '<span>' + escapeHtml(e.label) + '</span></button>';
    });
    html += '</div></div>';
    return html;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function creatureToEntity(record) { return CreatureAssets.toLibraryEntity(record); }

  root.FerunzEntitySelector = {
    normalize: normalize,
    merge: merge,
    filter: filter,
    render: render,
    creatureToEntity: creatureToEntity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzEntitySelector;
})(typeof globalThis !== 'undefined' ? globalThis : this);
