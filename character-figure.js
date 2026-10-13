/**
 * FERUNZI STUDIO — character appearance code
 * Extracted verbatim from ferunzi-characters.html (the published app).
 *
 * This is the ONLY thing drawing "Captain Asha Njoroge" etc. today. It is a
 * procedural SVG generator, not AI art: a handful of rectangles, ellipses and
 * paths whose color and proportions are derived from a hash of the
 * character's name. Same name -> same figure, every time. No model, no
 * photo, no prompt is involved.
 *
 * Where it's called from: renderView(c, angle, asset, o) checks whether a
 * real generated image exists for this character/angle (asset.uri, coming
 * from a connected Nano Banana Pro / FLUX.2 server) and returns an <img> for
 * that. Only when there is NO real image yet does it fall through to
 * art(c, angle, o) -> figure(c, angle, o), the code below.
 *
 *   function renderView(c,angle,asset,o){
 *     o=o||{};
 *     if(asset&&asset.uri&&!o.ghost)return '<img class="render" src="'+esc(asset.uri)+'" ...>';
 *     return art(c,angle,o);   // <- lands here when offline / no server
 *   }
 *   function art(c,a,o){ return isLoc(c) ? sceneArt(c,a,o) : figure(c,a,o); }
 *
 * Dependencies (also copied below, verbatim): esc(), hash(). Two CSS custom
 * properties are referenced with var(...) for the "ghost"/not-yet-generated
 * state: --line and --brass. Outside the app's own stylesheet these will
 * resolve to nothing in particular, which is fine for inspection but worth
 * knowing if you drop this into another page.
 *
 * Try it: figure({name:'Captain Asha Njoroge', alias:'Huntswoman'}, 0)
 * returns a full <svg>...</svg> string you can drop into innerHTML.
 */

// ---- escaping (used for the accessible label on the <svg>) ----
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---- tiny string hash (FNV-1a), used to turn a name into deterministic numbers ----
function hash(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- appearance palettes ----
var SKIN = ['#F1C7A0', '#E0AC80', '#C68A5E', '#A86C45', '#8A5233', '#6B3E26', '#4A2A1A', '#3A2015'];
var HAIR = ['#1B1512', '#2E2018', '#5A3A22', '#8C6A3A', '#B08A3E', '#7A2E22', '#D8D4CC', '#12100E'];

/** Picks a skin tone, hair color, clothing hue, and hair length from a hash of the name+alias. */
function palette(c) {
  var h = hash(c.name + (c.alias || ''));
  return { skin: SKIN[h % 8], hair: HAIR[(h >> 3) % 8], hue: h % 360, long: ((h >> 7) & 1) === 1 };
}

// ---- number formatting used throughout the SVG path/coordinate strings ----
function f1(n) { return n.toFixed(1); }

/**
 * Builds one <svg> figure of character c, viewed from `angle` degrees
 * (0 = front, 90/270 = profile, 180 = back — matches the 8-point turntable).
 *
 * o (all optional):
 *   gen      number   "generation" seed — bumped on redo, shifts clothing color/shade
 *   vr       number   "variant" seed — shifts the accent/accessory color
 *   zone     string   'head' | 'torso' | 'hands' | 'legs_feet' — dims everything
 *                      else to .2 opacity and draws a dashed highlight box
 *   ghost    boolean  true = "not generated yet" placeholder (monochrome, faint)
 */
function figure(c, angle, o) {
  o = o || {};
  var p = palette(c), v = o.gen || 0, vr = o.vr || 0;
  if (o.ghost) { p = { skin: 'var(--line)', hair: 'var(--line)', hue: 0, long: p.long }; }

  var rad = angle * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad), ac = Math.abs(cs);
  var cx = 100, k = .5 + .5 * ac, hw = 38 * k, front = cs > .25, back = cs < -.25, side = !front && !back;

  var outfit = o.ghost ? 'var(--line)' : 'hsl(' + ((p.hue + v * 9) % 360) + ' 26% ' + (44 + (v % 4) * 3) + '%)';
  var sleeve = o.ghost ? 'var(--line)' : 'hsl(' + ((p.hue + v * 9) % 360) + ' 26% ' + (37 + (v % 4) * 3) + '%)';
  var pants  = o.ghost ? 'var(--line)' : 'hsl(' + ((p.hue + 40 + v * 5) % 360) + ' 18% ' + (31 + (v % 3) * 2) + '%)';
  var boots  = o.ghost ? 'var(--line)' : 'hsl(' + p.hue + ' 14% 20%)';
  var acc    = o.ghost ? 'var(--line)' : 'hsl(' + ((p.hue + 25 + v * 9 + vr * 22) % 360) + ' 52% ' + (52 + (vr % 3) * 4) + '%)';

  function dim(zone) { return o.zone && o.zone !== zone ? ' opacity=".2"' : ''; }

  // legs + boots
  var lw = 24 * (.55 + .45 * ac), lx = hw * .42;
  var bx = cx - lx - lw / 2 - 2 + (sn < 0 ? -10 * (1 - ac) : 0), bw = lw + 4 + 10 * (1 - ac);
  var legs = '<g' + dim('legs_feet') + '>' +
    '<rect x="' + f1(cx - lx - lw / 2) + '" y="212" width="' + f1(lw) + '" height="140" rx="8" fill="' + pants + '"/>' +
    '<rect x="' + f1(cx + lx - lw / 2) + '" y="212" width="' + f1(lw) + '" height="140" rx="8" fill="' + pants + '"/>' +
    '<rect x="' + f1(bx) + '" y="344" width="' + f1(bw) + '" height="32" rx="6" fill="' + boots + '"/>' +
    '<rect x="' + f1(bx + 2 * lx) + '" y="344" width="' + f1(bw) + '" height="32" rx="6" fill="' + boots + '"/></g>';

  // torso + arms + belt + carried gear (a strap up front, a slung item on the back, a holster in profile)
  var aw = 15 * (.6 + .4 * ac), ao = (hw + aw / 2 - 3) * ac;
  var torso = '<path d="M' + f1(cx - hw) + ' 98 Q' + f1(cx - hw) + ' 92 ' + f1(cx - hw + 9) + ' 92 L' + f1(cx + hw - 9) + ' 92 Q' + f1(cx + hw) + ' 92 ' + f1(cx + hw) + ' 98 L' + f1(cx + hw * .8) + ' 214 L' + f1(cx - hw * .8) + ' 214Z" fill="' + outfit + '"/>';
  var arms = '<rect x="' + f1(cx - ao - aw / 2) + '" y="98" width="' + f1(aw) + '" height="110" rx="7" fill="' + sleeve + '"/><rect x="' + f1(cx + ao - aw / 2) + '" y="98" width="' + f1(aw) + '" height="110" rx="7" fill="' + sleeve + '"/>';
  var belt = '<rect x="' + f1(cx - hw * .8) + '" y="205" width="' + f1(hw * 1.6) + '" height="9" fill="' + boots + '"/>';
  var gear = '';
  if (front) { gear += '<path d="M' + f1(cx - hw * .7) + ' 96L' + f1(cx + hw * .55) + ' 210" stroke="' + acc + '" stroke-width="6" fill="none"/><rect x="' + f1(cx - 4) + '" y="204" width="8" height="12" rx="2" fill="' + acc + '"/>'; }
  if (back) { gear += '<rect x="' + f1(cx + hw * .2) + '" y="78" width="15" height="90" rx="5" fill="' + boots + '" transform="rotate(12 ' + f1(cx + hw * .3) + ' 124)"/><circle cx="' + f1(cx + hw * .2 + 3) + '" cy="76" r="3" fill="' + acc + '"/><circle cx="' + f1(cx + hw * .2 + 11) + '" cy="77" r="3" fill="' + acc + '"/>'; }
  if (side) { var dir = sn > 0 ? -1 : 1; gear += '<rect x="' + f1(cx + dir * (hw + 2) - 7) + '" y="176" width="14" height="24" rx="3" fill="' + boots + '"/>'; }
  var torsoG = '<g' + dim('torso') + '>' + torso + arms + belt + gear + '</g>';

  // hands
  var hands = '<g' + dim('hands') + '><circle cx="' + f1(cx - ao) + '" cy="216" r="' + f1(8 * (.7 + .3 * ac)) + '" fill="' + p.skin + '"/><circle cx="' + f1(cx + ao) + '" cy="216" r="' + f1(8 * (.7 + .3 * ac)) + '" fill="' + p.skin + '"/></g>';

  // head: hair-from-behind on the back view; face, hair, eyes, ear (in profile) otherwise
  var hr = 17 + 3 * ac, hx = cx + sn * 4, head = '<rect x="' + (cx - 7) + '" y="80" width="14" height="14" fill="' + p.skin + '"/>';
  if (back) {
    head += '<ellipse cx="' + f1(hx) + '" cy="' + (p.long ? 70 : 62) + '" rx="' + f1(hr + 1) + '" ry="' + (p.long ? 34 : 23) + '" fill="' + p.hair + '"/>';
  } else {
    if (p.long) head += '<rect x="' + f1(hx - hr - 3) + '" y="50" width="' + f1(2 * hr + 6) + '" height="44" rx="10" fill="' + p.hair + '"/>';
    head += '<ellipse cx="' + f1(hx) + '" cy="62" rx="' + f1(hr) + '" ry="21" fill="' + p.skin + '"/>';
    head += '<ellipse cx="' + f1(hx - (side ? sn * 4 : 0)) + '" cy="52" rx="' + f1(hr + 1) + '" ry="14" fill="' + p.hair + '"/>';
    var ex = hx + sn * 7;
    if (ac > .3) { head += '<circle cx="' + f1(ex - 6 * ac) + '" cy="63" r="1.9" fill="#1a1512"/><circle cx="' + f1(ex + 6 * ac) + '" cy="63" r="1.9" fill="#1a1512"/>'; }
    else { head += '<circle cx="' + f1(hx + sn * 11) + '" cy="63" r="1.9" fill="#1a1512"/>'; }
    if (Math.abs(sn) > .5) { var s = sn > 0 ? 1 : -1; head += '<path d="M' + f1(hx + s * hr) + ' 62l' + (s * 5) + ' 6l' + (-s * 5) + ' 2z" fill="' + p.skin + '"/>'; }
  }
  var head_g = '<g' + dim('head') + '>' + head + '</g>';

  // dashed highlight box when a body-checkup zone is selected
  var zr = { head: [56, 28, 88, 72], torso: [40, 90, 120, 128], hands: [30, 200, 140, 30], legs_feet: [50, 210, 100, 172] };
  var hl = '';
  if (o.zone && zr[o.zone]) { var z = zr[o.zone]; hl = '<rect x="' + z[0] + '" y="' + z[1] + '" width="' + z[2] + '" height="' + z[3] + '" rx="8" fill="none" stroke="var(--brass)" stroke-width="2" stroke-dasharray="5 4"/>'; }

  var body = legs + torsoG + hands + head_g;
  return '<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(c.name) + ' at ' + angle + ' degrees"><ellipse cx="100" cy="382" rx="' + f1(34 + 18 * ac) + '" ry="6" fill="#000" opacity=".16"/>' + (o.ghost ? '<g opacity=".7">' + body + '</g>' : body) + hl + '</svg>';
}

// ---- example ----
// document.body.innerHTML = figure({ name: 'Captain Asha Njoroge', alias: 'Huntswoman' }, 0);
