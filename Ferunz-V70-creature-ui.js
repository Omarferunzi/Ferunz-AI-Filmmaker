/** FERUNZ STUDIO — Custom Creature Creator UI integration (drop-in, framework-free) */
(function (root) {
  'use strict';
  var Studio = root.FerunzCreatureStudio;
  if (!Studio) throw new Error('FerunzCreatureStudio must be loaded before Ferunz-V70-creature-ui.js');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function renderCreator(input, options) {
    var c = Studio.normalizeCreature(input);
    options = options || {};
    var state = Studio.createTurntableState(c, options);
    var html = '<section class="ferunz-creature-studio" data-creature="' + esc(c.name) + '">';
    html += '<header><h2>Creature Creator</h2><p>Create an original creature with custom anatomy.</p></header>';
    html += '<div class="creature-summary"><strong>' + esc(c.name) + '</strong><span>' + esc(c.species) + '</span></div>';
    html += '<div class="creature-controls" role="group" aria-label="Creature controls">';
    html += '<label>Body type <input name="bodyType" value="' + esc(c.anatomy.bodyType) + '"></label>';
    html += '<label>Body length <input type="range" min="0" max="100" value="' + c.anatomy.bodyLength + '" name="bodyLength"></label>';
    html += '<label>Body thickness <input type="range" min="0" max="100" value="' + c.anatomy.bodyThickness + '" name="bodyThickness"></label>';
    html += '<label>Neck length <input type="range" min="0" max="100" value="' + c.anatomy.neckLength + '" name="neckLength"></label>';
    html += '<label>Wing count <input type="number" min="0" max="8" value="' + c.anatomy.wingCount + '" name="wingCount"></label>';
    html += '<label>Wing span <input type="range" min="0" max="100" value="' + c.anatomy.wingSpan + '" name="wingSpan"></label>';
    html += '<label>Tail length <input type="range" min="0" max="100" value="' + c.anatomy.tailLength + '" name="tailLength"></label>';
    html += '<label>Primary color <input type="text" value="' + esc(c.appearance.primaryColor) + '" name="primaryColor"></label>';
    html += '<label>Secondary color <input type="text" value="' + esc(c.appearance.secondaryColor) + '" name="secondaryColor"></label>';
    html += '<label class="wide">Your imagination <textarea name="description" rows="3">' + esc(c.description) + '</textarea></label>';
    html += '</div>';
    html += '<div class="creature-turntable" role="group" aria-label="Creature turntable">';
    state.angles.forEach(function (angle) {
      var active = angle === state.activeAngle ? ' active' : '';
      html += '<button type="button" class="creature-angle' + active + '" data-angle="' + angle + '" aria-label="View ' + angle + ' degree angle">' + angle + '°</button>';
    });
    html += '</div>';
    html += '<div class="creature-zones" role="group" aria-label="Creature inspection zones">';
    state.zones.forEach(function (zone) {
      html += '<button type="button" data-zone="' + zone + '">' + zone.replace('_', ' / ') + '</button>';
    });
    html += '</div>';
    html += '<output class="creature-prompt" aria-label="Generation description">' + esc(Studio.creaturePrompt(c)) + '</output>';
    html += '</section>';
    return html;
  }

  root.FerunzCreatureUI = {
    renderCreator: renderCreator
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzCreatureUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
