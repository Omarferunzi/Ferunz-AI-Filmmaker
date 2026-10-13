/**
 * FERUNZI STUDIO — Advanced character appearance renderer
 *
 * Drop-in replacement for the previous procedural character renderer.
 *
 * Public API kept compatible:
 *   figure(character, angle, options)
 *
 * Character fields supported:
 *   name, alias
 *   gender: 'male' | 'female' | 'androgynous'
 *   build: 'slim' | 'athletic' | 'muscular' | 'heavy'
 *   height: 'short' | 'average' | 'tall'
 *   skinTone: 0..7
 *   hairColor: 0..7
 *   hairStyle: 'short' | 'fade' | 'long' | 'ponytail' | 'buzz' | 'curly' | 'mohawk'
 *   hairLength: 'short' | 'long'
 *   eyeColor: any CSS color
 *   outfitColor: any CSS color
 *   outfit: 'tactical' | 'military' | 'casual' | 'formal' | 'assassin' | 'hero'
 *   facialHair: 'none' | 'stubble' | 'beard' | 'goatee'
 *   accessory: 'none' | 'glasses' | 'visor' | 'mask' | 'earpiece' | 'scarf'
 *   scar: boolean
 *   tattoo: boolean
 *
 * If fields are missing, deterministic values are generated from name + alias.
 * This keeps existing characters stable while allowing richer character data.
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c];
  });
}

function hash(s) {
  var h = 2166136261;
  s = String(s || '');
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

var SKIN = [
  '#F6D2B8', '#E9B58F', '#D99A72', '#C47D57',
  '#A9603F', '#874A31', '#653722', '#432318'
];

var HAIR = [
  '#17120F', '#2B211B', '#4A3021', '#70472B',
  '#A16B32', '#C49A5A', '#D7D2C9', '#101010'
];

var EYES = [
  '#241812', '#3B2417', '#5B3B20', '#75613A',
  '#315A68', '#527C45', '#202020', '#8B6B35'
];

var OUTFITS = [
  '#263238', '#37474F', '#455A64', '#4E342E',
  '#263D2F', '#3B3A55', '#51413A', '#20252A'
];

function pickIndex(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function palette(c) {
  var h = hash((c.name || 'Character') + (c.alias || ''));

  var gender = c.gender || ['male', 'female', 'androgynous'][(h >>> 1) % 3];
  var build = c.build || ['slim', 'athletic', 'muscular', 'heavy'][(h >>> 4) % 4];
  var height = c.height || ['short', 'average', 'tall'][(h >>> 7) % 3];

  var hairStyles = ['short', 'fade', 'long', 'ponytail', 'buzz', 'curly', 'mohawk'];

  return {
    seed: h,
    gender: gender,
    build: build,
    height: height,
    skin: SKIN[pickIndex(c.skinTone, h % SKIN.length) % SKIN.length],
    hair: HAIR[pickIndex(c.hairColor, (h >>> 3) % HAIR.length) % HAIR.length],
    eyes: c.eyeColor || EYES[(h >>> 6) % EYES.length],
    outfit: c.outfitColor || OUTFITS[(h >>> 9) % OUTFITS.length],
    hairStyle: c.hairStyle || (c.hairLength === 'long' ? ['long', 'ponytail'][(h >>> 11) % 2] : hairStyles[(h >>> 11) % hairStyles.length]),
    facialHair: c.facialHair || ['none', 'stubble', 'beard', 'goatee'][(h >>> 14) % 4],
    accessory: c.accessory || ['none', 'glasses', 'visor', 'mask', 'earpiece', 'scarf'][(h >>> 16) % 6],
    scar: c.scar == null ? ((h >>> 18) & 1) === 1 : !!c.scar,
    tattoo: c.tattoo == null ? ((h >>> 19) & 1) === 1 : !!c.tattoo,
    hue: h % 360
  };
}

function f1(n) {
  return Number(n).toFixed(1);
}

function attr(fill, stroke, sw) {
  return 'fill="' + fill + '" stroke="' + (stroke || 'none') + '" stroke-width="' + (sw || 0) + '"';
}

function figure(c, angle, o) {
  c = c || {};
  o = o || {};

  var p = palette(c);
  var v = Number(o.gen);
  var vr = Number(o.vr);
  if (!Number.isFinite(v)) v = 0;
  if (!Number.isFinite(vr)) vr = 0;

  var safeAngle = Number(angle);
  if (!Number.isFinite(safeAngle)) safeAngle = 0;
  var rad = safeAngle * Math.PI / 180;
  var cs = Math.cos(rad);
  var sn = Math.sin(rad);
  var ac = Math.abs(cs);

  var front = cs > 0.25;
  var back = cs < -0.25;
  var side = !front && !back;
  var sideDir = sn >= 0 ? 1 : -1;

  /* ---------- body proportions ---------- */

  var buildScale = {
    slim:     { shoulder: 0.86, chest: 0.88, waist: 0.84, arm: 0.88, leg: 0.91 },
    athletic: { shoulder: 1.00, chest: 1.00, waist: 0.91, arm: 1.00, leg: 1.00 },
    muscular: { shoulder: 1.13, chest: 1.13, waist: 0.98, arm: 1.15, leg: 1.08 },
    heavy:    { shoulder: 1.07, chest: 1.16, waist: 1.15, arm: 1.08, leg: 1.02 }
  }[p.build] || { shoulder: 1, chest: 1, waist: 1, arm: 1, leg: 1 };

  var genderScale =
    p.gender === 'female'
      ? { shoulder: 0.91, waist: 0.82, hip: 1.12, arm: 0.92 }
      : p.gender === 'male'
        ? { shoulder: 1.04, waist: 1.00, hip: 0.96, arm: 1.03 }
        : { shoulder: 0.98, waist: 0.93, hip: 1.00, arm: 0.98 };

  var heightScale =
    p.height === 'short' ? 0.93 :
    p.height === 'tall' ? 1.07 : 1.0;

  var shoulder = 42 * buildScale.shoulder * genderScale.shoulder;
  var chest = 38 * buildScale.chest;
  var waist = 29 * buildScale.waist * genderScale.waist;
  var hip = 34 * buildScale.waist * genderScale.hip;
  var armW = 11.5 * buildScale.arm * genderScale.arm;

  var top = 76;
  var headCy = 58;
  var neckY = 79;
  var shoulderY = 91;
  var waistY = 182;
  var hipY = 205;
  var kneeY = 292;
  var ankleY = 351;
  var footY = 362;

  /* Height affects vertical spacing, but keeps the same 200x400 viewBox. */
  var torsoH = (hipY - shoulderY) * heightScale;
  var legStart = hipY - 4;
  var legEnd = Math.min(352, legStart + 150 * heightScale);

  /* ---------- colors ---------- */

  var outfit = p.outfit;
  var outfitDark = 'hsl(' + ((p.hue + v * 7) % 360) + ' 22% ' + (20 + (v % 3) * 3) + '%)';
  var outfitLight = 'hsl(' + ((p.hue + v * 7) % 360) + ' 25% ' + (38 + (v % 3) * 3) + '%)';
  var metal = 'hsl(' + ((p.hue + 28 + vr * 12) % 360) + ' 38% 58%)';
  var boot = '#17191C';
  var line = '#111418';

  if (o.ghost) {
    p.skin = 'var(--line)';
    p.hair = 'var(--line)';
    p.eyes = 'var(--line)';
    outfit = 'var(--line)';
    outfitDark = 'var(--line)';
    outfitLight = 'var(--line)';
    metal = 'var(--line)';
    boot = 'var(--line)';
    line = 'var(--line)';
  }

  function dim(zone) {
    return o.zone && o.zone !== zone ? ' opacity=".18"' : '';
  }

  function path(d, fill, stroke, sw) {
    return '<path d="' + d + '" ' + attr(fill, stroke, sw) + '/>';
  }

  function ellipse(cx, cy, rx, ry, fill, stroke, sw, extra) {
    return '<ellipse cx="' + f1(cx) + '" cy="' + f1(cy) +
      '" rx="' + f1(rx) + '" ry="' + f1(ry) + '" ' +
      attr(fill, stroke, sw) + (extra || '') + '/>';
  }

  function circle(cx, cy, r, fill, stroke, sw, extra) {
    return '<circle cx="' + f1(cx) + '" cy="' + f1(cy) +
      '" r="' + f1(r) + '" ' + attr(fill, stroke, sw) +
      (extra || '') + '/>';
  }

  function rect(x, y, w, h, r, fill, stroke, sw, extra) {
    return '<rect x="' + f1(x) + '" y="' + f1(y) +
      '" width="' + f1(w) + '" height="' + f1(h) +
      '" rx="' + f1(r || 0) + '" ' + attr(fill, stroke, sw) +
      (extra || '') + '/>';
  }

  /* ---------- legs ---------- */

  var legHalf = 15 * buildScale.leg;
  var hipGap = 5;
  var legX1 = 100 - hipGap - legHalf;
  var legX2 = 100 + hipGap;

  var legs =
    '<g' + dim('legs_feet') + '>' +
      path(
        'M ' + f1(100 - hip * .65) + ' ' + f1(hipY) +
        ' Q ' + f1(100 - legHalf - 4) + ' ' + f1(235) +
        ' ' + f1(legX1) + ' ' + f1(kneeY) +
        ' L ' + f1(legX1 - 1) + ' ' + f1(legEnd) +
        ' Q ' + f1(legX1) + ' ' + f1(356) +
        ' ' + f1(100 - 4) + ' ' + f1(footY) +
        ' L ' + f1(100 - 4) + ' ' + f1(legEnd) +
        ' L ' + f1(100 - 5) + ' ' + f1(kneeY) +
        ' Q ' + f1(100 - 8) + ' ' + f1(232) +
        ' ' + f1(100 - hip * .65) + ' ' + f1(hipY) + 'Z',
        outfitDark, line, 1.1
      ) +
      path(
        'M ' + f1(100 + hip * .65) + ' ' + f1(hipY) +
        ' Q ' + f1(100 + legHalf + 4) + ' ' + f1(235) +
        ' ' + f1(legX2 + legHalf) + ' ' + f1(kneeY) +
        ' L ' + f1(legX2 + legHalf + 1) + ' ' + f1(legEnd) +
        ' Q ' + f1(legX2 + legHalf) + ' ' + f1(356) +
        ' ' + f1(104) + ' ' + f1(footY) +
        ' L ' + f1(104) + ' ' + f1(legEnd) +
        ' L ' + f1(105) + ' ' + f1(kneeY) +
        ' Q ' + f1(108) + ' ' + f1(232) +
        ' ' + f1(100 + hip * .65) + ' ' + f1(hipY) + 'Z',
        outfitDark, line, 1.1
      ) +
      /* knees */
      ellipse(100 - legHalf * .15, kneeY, legHalf * .72, 8, outfitLight, line, .7) +
      ellipse(100 + legHalf * .75, kneeY, legHalf * .72, 8, outfitLight, line, .7) +
      /* boots */
      path(
        'M ' + f1(88) + ' ' + f1(legEnd - 1) +
        ' Q 86 354 80 357 L 74 363 Q 72 367 78 369 L 103 369' +
        ' Q 107 368 105 363 L 102 357 L 102 ' + f1(legEnd - 1) + 'Z',
        boot, line, 1
      ) +
      path(
        'M ' + f1(102) + ' ' + f1(legEnd - 1) +
        ' Q 114 354 120 357 L 126 363 Q 128 367 122 369 L 97 369' +
        ' Q 93 368 95 363 L 98 357 L 98 ' + f1(legEnd - 1) + 'Z',
        boot, line, 1
      ) +
      /* boot details */
      rect(78, 360, 24, 3, 1, metal) +
      rect(98, 360, 24, 3, 1, metal) +
    '</g>';

  /* ---------- torso ---------- */

  var torso =
    '<g' + dim('torso') + '>' +
      path(
        'M ' + f1(100 - shoulder) + ' ' + shoulderY +
        ' Q ' + f1(100 - shoulder * .93) + ' 86 ' +
        f1(100 - chest) + ' 101' +
        ' L ' + f1(100 - waist) + ' ' + waistY +
        ' Q 100 ' + f1(waistY + 7) + ' ' +
        f1(100 + waist) + ' ' + waistY +
        ' L ' + f1(100 + chest) + ' 101' +
        ' Q ' + f1(100 + shoulder * .93) + ' 86 ' +
        f1(100 + shoulder) + ' ' + shoulderY +
        ' Q 100 83 ' + f1(100 - shoulder) + ' ' + shoulderY + 'Z',
        outfit, line, 1.2
      ) +
      /* chest panels */
      path(
        'M 100 101 L 100 ' + f1(waistY - 7),
        'none', outfitLight, 1
      ) +
      path(
        'M ' + f1(100 - chest * .72) + ' 108 Q 100 100 ' +
        f1(100 - 3) + ' 108 L ' + f1(100 - 3) + ' 139 Q ' +
        f1(100 - chest * .5) + ' 145 ' + f1(100 - chest * .72) + ' 139Z',
        outfitLight, line, .7
      ) +
      path(
        'M ' + f1(100 + chest * .72) + ' 108 Q 100 100 ' +
        f1(100 + 3) + ' 108 L ' + f1(100 + 3) + ' 139 Q ' +
        f1(100 + chest * .5) + ' 145 ' + f1(100 + chest * .72) + ' 139Z',
        outfitLight, line, .7
      ) +
      /* waist and belt */
      rect(100 - waist - 3, 177, waist * 2 + 6, 9, 2, boot, line, .7) +
      rect(95, 176, 10, 11, 2, metal, line, .7) +
      /* center seam */
      path('M 100 105 L 100 175', 'none', line, .8) +
    '</g>';

  /* ---------- arms ---------- */

  var armReach = 117 + 10 * ac;
  var shoulderOut = shoulder * .93;

  var arms =
    '<g' + dim('torso') + '>' +
      /* left arm */
      path(
        'M ' + f1(100 - shoulderOut) + ' 94' +
        ' Q ' + f1(100 - shoulderOut - 14) + ' 106 ' +
        f1(100 - armReach) + ' 143' +
        ' L ' + f1(100 - armReach + 5) + ' 194' +
        ' Q ' + f1(100 - armReach + 6) + ' 205 ' +
        f1(100 - armReach + 12) + ' 204' +
        ' Q ' + f1(100 - armReach + 17) + ' 202 ' +
        f1(100 - armReach + 16) + ' 193' +
        ' L ' + f1(100 - shoulderOut + 13) + ' 111Z',
        outfitDark, line, 1
      ) +
      /* right arm */
      path(
        'M ' + f1(100 + shoulderOut) + ' 94' +
        ' Q ' + f1(100 + shoulderOut + 14) + ' 106 ' +
        f1(100 + armReach) + ' 143' +
        ' L ' + f1(100 + armReach - 5) + ' 194' +
        ' Q ' + f1(100 + armReach - 6) + ' 205 ' +
        f1(100 + armReach - 12) + ' 204' +
        ' Q ' + f1(100 + armReach - 17) + ' 202 ' +
        f1(100 + armReach - 16) + ' 193' +
        ' L ' + f1(100 + shoulderOut - 13) + ' 111Z',
        outfitDark, line, 1
      ) +
      /* shoulder armor / seams */
      ellipse(100 - shoulderOut, 99, 10, 8, outfitLight, line, .8) +
      ellipse(100 + shoulderOut, 99, 10, 8, outfitLight, line, .8) +
    '</g>';

  /* ---------- hands ---------- */

  var handY = 205;

  var hands =
    '<g' + dim('hands') + '>' +
      ellipse(100 - armReach + 9, handY, 7, 9, p.skin, line, .8) +
      ellipse(100 + armReach - 9, handY, 7, 9, p.skin, line, .8) +
      /* fingers */
      path('M 100 0', 'none') +
      rect(100 - armReach + 4, handY + 5, 3, 7, 1, p.skin) +
      rect(100 - armReach + 8, handY + 5, 3, 8, 1, p.skin) +
      rect(100 + armReach - 11, handY + 5, 3, 8, 1, p.skin) +
      rect(100 + armReach - 7, handY + 5, 3, 7, 1, p.skin) +
    '</g>';

  /* ---------- neck ---------- */

  var neck =
    '<g' + dim('head') + '>' +
      rect(92, 75, 16, 20, 5, p.skin, line, .7) +
      path('M 91 87 Q 100 98 109 87', 'none', line, 1) +
    '</g>';

  /* ---------- head / face ---------- */

  var headRx = p.gender === 'female' ? 19 : 20;
  var headRy = p.gender === 'female' ? 23 : 24;
  var hx = 100 + (side ? sideDir * 2 : 0);
  var hy = 57;

  var head =
    '<g' + dim('head') + '>' +
      ellipse(hx, hy, headRx, headRy, p.skin, line, 1) +
      /* ears */
      ellipse(hx - headRx + 1, hy + 3, 4, 7, p.skin, line, .7) +
      ellipse(hx + headRx - 1, hy + 3, 4, 7, p.skin, line, .7);

  /* hair styles */
  if (p.hairStyle === 'buzz') {
    head += ellipse(hx, 45, headRx + 1, 12, p.hair, line, .7);
  } else if (p.hairStyle === 'fade') {
    head += path(
      'M ' + f1(hx - headRx) + ' 51 Q ' + f1(hx - 14) + ' 36 ' +
      f1(hx) + ' 38 Q ' + f1(hx + 14) + ' 36 ' +
      f1(hx + headRx) + ' 51 L ' + f1(hx + headRx - 3) + ' 56 Q ' +
      f1(hx) + ' 46 ' + f1(hx - headRx + 3) + ' 56Z',
      p.hair, line, .8
    );
  } else if (p.hairStyle === 'long' || p.hairStyle === 'ponytail') {
    head += ellipse(hx, 45, headRx + 2, 13, p.hair, line, .8);
    head += path(
      'M ' + f1(hx - headRx + 2) + ' 48 Q ' + f1(hx - headRx - 4) + ' 78 ' +
      f1(hx - 12) + ' 84 L ' + f1(hx - 7) + ' 72 L ' +
      f1(hx - 3) + ' 53Z',
      p.hair, line, .7
    );
    head += path(
      'M ' + f1(hx + headRx - 2) + ' 48 Q ' + f1(hx + headRx + 5) + ' 77 ' +
      f1(hx + 12) + ' 84 L ' + f1(hx + 7) + ' 72 L ' +
      f1(hx + 3) + ' 53Z',
      p.hair, line, .7
    );
    if (p.hairStyle === 'ponytail') {
      head += ellipse(hx + sideDir * 18, 57, 7, 14, p.hair, line, .8);
      head += circle(hx + sideDir * 15, 47, 3, metal, line, .6);
    }
  } else if (p.hairStyle === 'curly') {
    head += ellipse(hx, 45, headRx + 3, 14, p.hair, line, .8);
    for (var ci = -2; ci <= 2; ci++) {
      head += circle(hx + ci * 7, 38 + Math.abs(ci) * 2, 6, p.hair, line, .5);
    }
  } else if (p.hairStyle === 'mohawk') {
    head += path(
      'M ' + f1(hx - 5) + ' 48 L ' + f1(hx - 4) + ' 31 Q ' +
      f1(hx) + ' 25 ' + f1(hx + 4) + ' 31 L ' + f1(hx + 5) +
      ' 48Z', p.hair, line, .8
    );
  } else {
    /* short */
    head += path(
      'M ' + f1(hx - headRx) + ' 51 Q ' + f1(hx - 13) + ' 34 ' +
      f1(hx) + ' 36 Q ' + f1(hx + 14) + ' 34 ' +
      f1(hx + headRx) + ' 51 Q ' + f1(hx + 11) + ' 45 ' +
      f1(hx) + ' 47 Q ' + f1(hx - 12) + ' 44 ' +
      f1(hx - headRx) + ' 51Z',
      p.hair, line, .8
    );
  }

  /* face only on front / partial profile */
  if (!back) {
    if (front) {
      /* eyebrows */
      path('M 88 54 Q 93 51 97 54', 'none', line, 1.7);
      path('M 103 54 Q 107 51 112 54', 'none', line, 1.7);

      /* eyes */
      ellipse(93, 62, 4.2, 2.6, '#F7F3EA', line, .5);
      ellipse(107, 62, 4.2, 2.6, '#F7F3EA', line, .5);
      circle(93, 62, 1.7, p.eyes);
      circle(107, 62, 1.7, p.eyes);

      /* nose */
      path('M 100 62 L 97.5 70 L 102 70', 'none', line, .8);

      /* mouth */
      path(
        p.gender === 'female'
          ? 'M 95 76 Q 100 79 105 76'
          : 'M 95 76 Q 100 78 105 76',
        'none', '#7C3F3F', 1.1
      );

      /* facial hair */
      if (p.facialHair === 'stubble') {
        ellipse(100, 73, 10, 7, 'none', line, .7, ' opacity=".28"');
      } else if (p.facialHair === 'beard') {
        path('M 91 68 Q 100 82 109 68 L 106 82 Q 100 88 94 82Z', p.hair, line, .6);
      } else if (p.facialHair === 'goatee') {
        path('M 96 74 Q 100 79 104 74 L 103 84 Q 100 87 97 84Z', p.hair, line, .6);
      }

      /* scar */
      if (p.scar) {
        path('M 111 57 L 106 70', 'none', '#9B4E48', 1.5);
      }

      /* tattoo */
      if (p.tattoo) {
        path('M 84 76 Q 88 71 91 76', 'none', line, 1);
        circle(87.5, 75, 1.2, line);
      }
    } else if (side) {
      var sx = hx + sideDir * headRx;
      head += path(
        'M ' + f1(sx - sideDir * 2) + ' 60 L ' +
        f1(sx + sideDir * 8) + ' 65 L ' +
        f1(sx - sideDir * 2) + ' 70Z',
        p.skin, line, .7
      );
      head += circle(hx + sideDir * 7, 61, 1.8, p.eyes);
      head += path('M ' + f1(hx + sideDir * 7) + ' 73 Q ' +
        f1(hx + sideDir * 11) + ' 75 ' + f1(hx + sideDir * 7) + ' 76',
        'none', '#7C3F3F', 1);
    }
  }

  if (back) {
    /* Back-of-head detail */
    head += ellipse(hx, 57, headRx + 1, headRy + 1, p.hair, line, .8);
    if (p.hairStyle === 'long' || p.hairStyle === 'ponytail') {
      head += path(
        'M ' + f1(hx - headRx) + ' 55 Q ' + f1(hx - 15) + ' 82 ' +
        f1(hx) + ' 88 Q ' + f1(hx + 15) + ' 82 ' +
        f1(hx + headRx) + ' 55',
        p.hair, line, .8
      );
    }
  }

  /* accessories */
  if (p.accessory === 'glasses' && !back) {
    if (front) {
      head += rect(86, 57, 13, 9, 3, 'none', line, 1.2);
      head += rect(101, 57, 13, 9, 3, 'none', line, 1.2);
      head += path('M 99 60 L 101 60', 'none', line, 1);
    } else {
      head += rect(hx + sideDir * 4 - 6, 57, 12, 8, 2, 'none', line, 1.2);
    }
  } else if (p.accessory === 'visor') {
    head += path(
      'M ' + f1(hx - headRx - 1) + ' 55 Q ' + f1(hx) + ' 45 ' +
      f1(hx + headRx + 1) + ' 55 L ' + f1(hx + headRx) + ' 61 Q ' +
      f1(hx) + ' 53 ' + f1(hx - headRx) + ' 61Z',
      metal, line, .8
    );
  } else if (p.accessory === 'mask' && !back) {
    head += path(
      'M ' + f1(hx - 11) + ' 68 Q ' + f1(hx) + ' 64 ' +
      f1(hx + 11) + ' 68 L ' + f1(hx + 9) + ' 80 Q ' +
      f1(hx) + ' 84 ' + f1(hx - 9) + ' 80Z',
      boot, line, .8
    );
  } else if (p.accessory === 'earpiece') {
    head += circle(hx + sideDir * headRx, 64, 3, boot, line, .7);
    head += path(
      'M ' + f1(hx + sideDir * headRx) + ' 66 Q ' +
      f1(hx + sideDir * (headRx + 7)) + ' 70 ' +
      f1(hx + sideDir * (headRx + 7)) + ' 75',
      'none', metal, 1
    );
  } else if (p.accessory === 'scarf') {
    head += path(
      'M 88 78 Q 100 84 112 78 L 109 94 Q 100 89 91 94Z',
      outfitDark, line, .8
    );
  }

  head += '</g>';

  /* ---------- outfit-specific gear ---------- */

  var gear = '<g' + dim('torso') + '>';

  var outfitType = c.outfit || ['tactical', 'military', 'casual', 'formal', 'assassin', 'hero'][
    (p.seed >>> 20) % 6
  ];

  if (outfitType === 'tactical' || outfitType === 'military' || outfitType === 'assassin') {
    gear += rect(82, 116, 12, 19, 2, outfitDark, line, .7);
    gear += rect(106, 116, 12, 19, 2, outfitDark, line, .7);
    gear += rect(82, 141, 12, 18, 2, outfitDark, line, .7);
    gear += rect(106, 141, 12, 18, 2, outfitDark, line, .7);
    gear += circle(100, 126, 4, metal, line, .6);
    gear += path('M 83 109 L 117 109', 'none', metal, 1.2);
  }

  if (outfitType === 'formal') {
    gear += path('M 100 104 L 91 126 L 100 170 L 109 126Z', '#14171B', line, .7);
    gear += path('M 100 104 L 96 116 L 100 125 L 104 116Z', '#E8E8E4', line, .5);
    gear += circle(100, 140, 1.5, metal);
    gear += circle(100, 151, 1.5, metal);
  }

  if (outfitType === 'hero') {
    gear += path('M 100 102 L 92 119 L 100 137 L 108 119Z', metal, line, .8);
    gear += path('M 79 106 Q 100 94 121 106', 'none', metal, 2);
    gear += circle(100, 139, 6, metal, line, .8);
  }

  /* front strap and back equipment */
  if (front) {
    gear += path(
      'M ' + f1(82) + ' 98 L ' + f1(115) + ' 178',
      'none', metal, 4
    );
    gear += rect(94, 163, 12, 17, 2, outfitDark, line, .7);
  }

  if (back) {
    gear += rect(83, 108, 34, 63, 6, outfitDark, line, 1);
    gear += rect(89, 117, 22, 8, 2, metal, line, .6);
    gear += rect(89, 135, 22, 8, 2, metal, line, .6);
  }

  if (side) {
    gear += rect(
      100 + sideDir * 28 - 7, 154, 14, 31, 3, boot, line, .7
    );
    gear += circle(100 + sideDir * 28, 159, 2, metal);
  }

  gear += '</g>';

  /* ---------- highlight / inspection zone ---------- */

  var zr = {
    head: [58, 30, 84, 63],
    torso: [39, 86, 122, 128],
    hands: [34, 194, 132, 32],
    legs_feet: [55, 198, 90, 174]
  };

  var hl = '';
  if (o.zone && zr[o.zone]) {
    var z = zr[o.zone];
    hl =
      '<rect x="' + z[0] + '" y="' + z[1] +
      '" width="' + z[2] + '" height="' + z[3] +
      '" rx="9" fill="none" stroke="var(--brass)" stroke-width="2"' +
      ' stroke-dasharray="6 4"/>';
  }

  /* ---------- ground shadow ---------- */

  var shadow =
    '<ellipse cx="100" cy="379" rx="' +
    f1(38 + 14 * ac) +
    '" ry="6" fill="#000" opacity=".17"/>';

  var body =
    '<g>' +
      legs +
      torso +
      arms +
      hands +
      neck +
      head +
      gear +
    '</g>';

  if (o.ghost) {
    body = '<g opacity=".72">' + body + '</g>';
  }

  return (
    '<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg"' +
    ' role="img" aria-label="' + esc(c.name || 'Character') +
    ' at ' + esc(safeAngle) + ' degrees">' +
      '<defs>' +
        '<linearGradient id="ferunzSkin" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + esc(p.skin) + '"/>' +
          '<stop offset="100%" stop-color="' + esc(p.skin) + '" stop-opacity=".78"/>' +
        '</linearGradient>' +
      '</defs>' +
      shadow +
      body +
      hl +
    '</svg>'
  );
}

/* Compatibility helpers used by the existing app. */
function art(c, a, o) {
  return figure(c, a, o);
}

/* Example:
 * document.body.innerHTML =
 *   figure({
 *     name: 'Captain Asha Njoroge',
 *     alias: 'Huntswoman',
 *     gender: 'female',
 *     build: 'athletic',
 *     height: 'tall',
 *     hairStyle: 'ponytail',
 *     outfit: 'tactical',
 *     accessory: 'earpiece',
 *     scar: true
 *   }, 0);
 */
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
