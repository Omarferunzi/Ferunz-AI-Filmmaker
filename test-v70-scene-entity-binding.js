const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, setTimeout, clearTimeout };
vm.createContext(ctx);
for (const f of ['Ferunz-V70-creature-studio.js','Ferunz-V70-creature-assets.js','Ferunz-V70-scene-entity-binding.js']) {
  vm.runInContext(fs.readFileSync('/mnt/data/ferunz-v70/' + f, 'utf8'), ctx, {filename:f});
}
const Studio = ctx.FerunzCreatureStudio;
const Assets = ctx.FerunzCreatureAssets;
const Bind = ctx.FerunzSceneEntityBinding;
const c = Studio.normalizeCreature({name:'Verdant Serpent', body:{type:'serpentine', length:9, thickness:0.55}, neck:{length:3.8}, wings:{count:2, span:14}, tail:{length:8}, colors:{primary:'#4f6f36'}, generation:{gen:2,vr:3}});
let rec = Assets.createAssetRecord(c, {id:'creature-verdant-serpent-2-3'});
Studio.ANGLES.forEach(a => Assets.attachAngleAsset(rec,a,{uri:'https://assets.test/verdant-'+a+'.png',provider:'test'}));
const entity = Assets.toLibraryEntity(rec); entity.assetRecord = rec;
let b = Bind.bind(entity,{actorId:'actor-7',angle:92,ghost:true});
assert.equal(b.angle,90); assert.equal(b.ghost,true); assert.equal(Bind.resolve(b,[entity]).id,entity.id);
let b2 = Bind.update(b,{angle:271,ghost:false}); assert.equal(b2.angle,270); assert.equal(b2.ghost,false);
const out = Bind.render(b2,[entity],{assetRecord:rec});
assert.equal(out.ok,true); assert.equal(out.type,'creature'); assert.equal(out.angle,270); assert(out.asset && out.asset.uri);
assert(Bind.render({entityId:'missing'},[entity],{}).ok === false);
console.log('PASS: V70 scene entity binding');
console.log('Stable actor binding + 8-angle resolution + creature asset rendering + missing-entity handling');
