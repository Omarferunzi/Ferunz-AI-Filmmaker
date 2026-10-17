/**
 * FERUNZ STUDIO — V70 Custom Creature Studio layer
 *
 * Keeps the existing V70 human renderer intact. This layer describes and
 * manages custom creatures/monsters whose anatomy may not fit the human
 * procedural renderer (dragons, serpentine flyers, mutants, robots, etc.).
 *
 * Public API:
 *   normalizeCreature(input)
 *   creaturePrompt(creature)
 *   creatureTurntable(creature, angle, asset, options)
 *   creatureZone(creature, zone)
 */

(function (root) {
  'use strict';

  var ANGLES = [0,45,90,135,180,225,270,315];
  var ZONES = ['head','neck','torso','wings','arms','hands','legs_feet','tail','surface','details'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function num(v, fallback, min, max) {
    var n = Number(v);
    if (!isFinite(n)) n = fallback;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    return n;
  }

  function text(v, fallback) {
    var s = String(v == null ? '' : v).trim();
    return s || fallback;
  }

  function list(v, fallback) {
    if (!Array.isArray(v)) return fallback.slice();
    return v.map(function (x) { return text(x, ''); }).filter(Boolean);
  }

  function normalizeCreature(input) {
    input = input || {};
    var anatomy = input.anatomy || {};
    var appearance = input.appearance || {};
    var behavior = input.behavior || {};

    return {
      id: text(input.id, ''),
      name: text(input.name, 'Unnamed Creature'),
      category: text(input.category, 'custom'),
      species: text(input.species, 'original creature'),
      description: text(input.description, ''),
      anatomy: {
        bodyType: text(anatomy.bodyType, 'custom'),
        bodyLength: num(anatomy.bodyLength, 50, 0, 100),
        bodyThickness: num(anatomy.bodyThickness, 50, 0, 100),
        neckLength: num(anatomy.neckLength, 50, 0, 100),
        headScale: num(anatomy.headScale, 50, 0, 100),
        limbCount: num(anatomy.limbCount, 4, 0, 12),
        legLength: num(anatomy.legLength, 50, 0, 100),
        wingCount: num(anatomy.wingCount, 0, 0, 8),
        wingSpan: num(anatomy.wingSpan, 50, 0, 100),
        wingShape: text(anatomy.wingShape, 'custom'),
        tailLength: num(anatomy.tailLength, 50, 0, 100),
        tailShape: text(anatomy.tailShape, 'custom'),
        horns: list(anatomy.horns, []),
        spikes: list(anatomy.spikes, []),
        claws: text(anatomy.claws, 'custom'),
        extra: list(anatomy.extra, [])
      },
      appearance: {
        material: text(appearance.material, 'skin and scales'),
        primaryColor: text(appearance.primaryColor, '#202020'),
        secondaryColor: text(appearance.secondaryColor, '#7A2020'),
        eyeColor: text(appearance.eyeColor, '#E6E6E6'),
        markings: list(appearance.markings, []),
        surfaceDetails: list(appearance.surfaceDetails, []),
        glow: text(appearance.glow, 'none')
      },
      behavior: {
        posture: text(behavior.posture, 'natural'),
        temperament: text(behavior.temperament, 'unknown'),
        flight: text(behavior.flight, 'unknown'),
        movement: text(behavior.movement, 'natural')
      },
      customNotes: text(input.customNotes, ''),
      generation: {
        gen: num(input.generation && input.generation.gen, 0, 0, 2147483647),
        vr: num(input.generation && input.generation.vr, 0, 0, 2147483647)
      }
    };
  }

  function creaturePrompt(input) {
    var c = normalizeCreature(input);
    var a = c.anatomy;
    var p = c.appearance;
    var b = c.behavior;
    var parts = [
      'Original creature design for FERUNZ Studio.',
      'Name: ' + c.name + '.',
      'Type: ' + c.species + '.',
      'Body architecture: ' + a.bodyType + '.',
      'Body length ' + a.bodyLength + '/100, thickness ' + a.bodyThickness + '/100.',
      'Neck length ' + a.neckLength + '/100, head scale ' + a.headScale + '/100.',
      'Limb count ' + a.limbCount + ', leg length ' + a.legLength + '/100.',
      'Wing count ' + a.wingCount + ', wing span ' + a.wingSpan + '/100, wing shape ' + a.wingShape + '.',
      'Tail length ' + a.tailLength + '/100, tail shape ' + a.tailShape + '.',
      'Horns: ' + (a.horns.join(', ') || 'none') + '.',
      'Spikes: ' + (a.spikes.join(', ') || 'none') + '.',
      'Claws: ' + a.claws + '.',
      'Surface: ' + p.material + ', primary ' + p.primaryColor + ', secondary ' + p.secondaryColor + '.',
      'Eyes: ' + p.eyeColor + '; markings: ' + (p.markings.join(', ') || 'none') + '.',
      'Surface details: ' + (p.surfaceDetails.join(', ') || 'none') + '; glow: ' + p.glow + '.',
      'Posture: ' + b.posture + '; temperament: ' + b.temperament + '; movement: ' + b.movement + '.',
      'Additional anatomy: ' + (a.extra.join(', ') || 'none') + '.',
      'Custom notes: ' + (c.description || c.customNotes || 'none') + '.'
    ];
    return parts.join(' ');
  }

  function normalizeAngle(angle) {
    var n = Number(angle);
    if (!isFinite(n)) return 0;
    n = ((Math.round(n) % 360) + 360) % 360;
    var best = ANGLES[0];
    var distance = 360;
    ANGLES.forEach(function (a) {
      var d = Math.abs(a - n);
      d = Math.min(d, 360 - d);
      if (d < distance) { distance = d; best = a; }
    });
    return best;
  }

  function creatureTurntable(input, angle, asset, options) {
    var c = normalizeCreature(input);
    options = options || {};
    var a = normalizeAngle(angle);
    var ghost = !!options.ghost;

    if (asset && asset.uri && !ghost) {
      return '<img class="render creature-render" src="' + esc(asset.uri) + '" alt="' +
        esc(c.name + ' creature, ' + a + ' degree view') + '" data-angle="' + a + '">';
    }

    // Deliberately do not route arbitrary anatomy through the human V70 figure.
    // The host generation pipeline can replace this state with a generated image.
    return '<div class="creature-render-pending" role="img" aria-label="' +
      esc(c.name + ' custom creature, ' + a + ' degree view') +
      '" data-creature="' + esc(c.name) + '" data-angle="' + a + '">' +
      '<span>Custom creature render pending</span></div>';
  }

  function creatureZone(input, zone) {
    var c = normalizeCreature(input);
    zone = text(zone, 'head').toLowerCase();
    if (ZONES.indexOf(zone) < 0) zone = 'head';
    var map = {
      head: 'Head scale ' + c.anatomy.headScale + '/100; eyes ' + c.appearance.eyeColor + '.',
      neck: 'Neck length ' + c.anatomy.neckLength + '/100.',
      torso: 'Body length ' + c.anatomy.bodyLength + '/100; thickness ' + c.anatomy.bodyThickness + '/100.',
      wings: 'Wing count ' + c.anatomy.wingCount + '; span ' + c.anatomy.wingSpan + '/100; shape ' + c.anatomy.wingShape + '.',
      arms: 'Limb count ' + c.anatomy.limbCount + '; claws ' + c.anatomy.claws + '.',
      hands: 'Claws ' + c.anatomy.claws + '.',
      legs_feet: 'Leg length ' + c.anatomy.legLength + '/100.',
      tail: 'Tail length ' + c.anatomy.tailLength + '/100; shape ' + c.anatomy.tailShape + '.',
      surface: 'Material ' + c.appearance.material + '; colors ' + c.appearance.primaryColor + ' / ' + c.appearance.secondaryColor + '.',
      details: 'Horns ' + (c.anatomy.horns.join(', ') || 'none') + '; spikes ' + (c.anatomy.spikes.join(', ') || 'none') + '.'
    };
    return { zone: zone, summary: map[zone] };
  }

  function createTurntableState(input, options) {
    var c = normalizeCreature(input);
    options = options || {};
    return {
      creature: c,
      angles: ANGLES.slice(),
      activeAngle: normalizeAngle(options.activeAngle),
      ghost: !!options.ghost,
      generation: c.generation,
      zones: ZONES.slice()
    };
  }

  root.FerunzCreatureStudio = {
    ANGLES: ANGLES.slice(),
    ZONES: ZONES.slice(),
    normalizeCreature: normalizeCreature,
    creaturePrompt: creaturePrompt,
    creatureTurntable: creatureTurntable,
    creatureZone: creatureZone,
    createTurntableState: createTurntableState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzCreatureStudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
