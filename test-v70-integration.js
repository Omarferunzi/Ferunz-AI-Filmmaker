const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const dir = '/mnt/data/ferunz-v70';
const renderer = fs.readFileSync(dir + '/Ferunz-character-figure-v2.V70-local.js', 'utf8');
const adapter = fs.readFileSync(dir + '/Ferunz-V70-render-adapter.js', 'utf8');
const ctx = { console, Number, String, Math };
vm.createContext(ctx);
vm.runInContext(renderer, ctx);
vm.runInContext(adapter, ctx);

const c = {name:'Captain Asha Njoroge', alias:'Huntswoman', gender:'female', build:'athletic', height:'tall', hairStyle:'ponytail', outfit:'tactical'};
const angles = [0,45,90,135,180,225,270,315];
for (const a of angles) {
  const out = ctx.renderV70View(c, a, null, {});
  assert.ok(out.startsWith('<svg '), 'fallback must return SVG');
  assert.ok(!/NaN|undefined/.test(out), 'fallback must not contain NaN/undefined');
}

const image = ctx.renderV70View(c, 45, {uri:'https://example.test/asha.webp'}, {});
assert.ok(image.startsWith('<img '), 'real asset must win over procedural fallback');
assert.ok(image.includes('asha.webp'));

const ghost = ctx.renderV70View(c, 45, {uri:'https://example.test/asha.webp'}, {ghost:true});
assert.ok(ghost.startsWith('<svg '), 'ghost mode must force procedural rendering');

const bad = ctx.renderV70View(c, 'not-a-number', null, {});
assert.ok(!/NaN/.test(bad), 'invalid angle must be normalized');

console.log('PASS: V70 integration adapter');
console.log('8 turntable angles + generated-image priority + ghost override + invalid angle');
