const fs = require('fs');
const vm = require('vm');
const renderer = fs.readFileSync(__dirname + '/Ferunz-character-figure-v2.V70-local.js','utf8');
const patch = fs.readFileSync(__dirname + '/Ferunz-V70-app-patch.js','utf8');

function load(scene) {
  const ctx = { console, module:{exports:{}}, globalThis:null };
  ctx.globalThis = ctx;
  ctx.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  ctx.isLoc = () => !!scene;
  ctx.sceneArt = () => '<svg data-scene="1"></svg>';
  vm.runInNewContext(renderer + '\n' + patch, ctx);
  return ctx;
}

const c = {name:'Captain Asha Njoroge', alias:'Huntswoman', gender:'female', build:'athletic', height:'tall', hairStyle:'ponytail'};
const normal = load(false);
for (const angle of [0,45,90,135,180,225,270,315]) {
  const s = normal.renderView(c, angle, null, {});
  if (!s.startsWith('<svg') || s.includes('NaN') || s.includes('undefined')) throw new Error('bad V70 render '+angle);
}
const img = normal.renderView(c, 90, {uri:'https://example.test/a.png'}, {});
if (!img.includes('class="render"') || !img.includes('a.png')) throw new Error('generated image priority failed');
const ghost = normal.renderView(c, 90, {uri:'https://example.test/a.png'}, {ghost:true});
if (ghost.includes('<img') || !ghost.startsWith('<svg')) throw new Error('ghost override failed');

const location = load(true);
const scene = location.renderView(c, 0, null, {});
if (scene !== '<svg data-scene="1"></svg>') throw new Error('sceneArt compatibility failed');

console.log('PASS: V70 application patch');
console.log('8 turntable angles + asset priority + ghost override + sceneArt compatibility');
