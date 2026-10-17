const fs = require('fs');
const vm = require('vm');
const files = [
  'Ferunz-V70-creature-studio.js',
  'Ferunz-V70-creature-assets.js',
  'Ferunz-V70-scene-entity-binding.js',
  'Ferunz-V70-scene-creature-controls.js'
];
const ctx = { console, Date, JSON, Promise, isFinite, Number, String, Object, Array };
vm.createContext(ctx);
for (const f of files) vm.runInContext(fs.readFileSync('/mnt/data/ferunz-v70/' + f, 'utf8'), ctx, {filename:f});
const Studio = ctx.FerunzCreatureStudio;
const Assets = ctx.FerunzCreatureAssets;
const Binding = ctx.FerunzSceneEntityBinding;
const Controls = ctx.FerunzSceneCreatureControls;
const creature = Studio.normalizeCreature({name:'Emerald Serpent', bodyType:'serpentine', color:'green'});
const rec = Assets.createAssetRecord(creature);
for (const a of Studio.ANGLES) Assets.attachAngleAsset(rec, a, {uri:'https://example.test/dragon-'+a+'.png', provider:'test'});
if (rec.status !== 'ready') throw new Error('record should be ready');
const entity = Assets.toLibraryEntity(rec);
const binding = Binding.bind(entity, {actorId:'actor-1', angle:92, ghost:false, transform:{x:1,y:2,z:3,scale:2}});
const state = Controls.createState(binding, [entity]);
if (state.angle !== 90) throw new Error('angle normalization failed');
const changed = Controls.update(state, {angle:271, ghost:true, transform:{x:0,y:0,z:0,scale:3}});
if (changed.angle !== 270 || !changed.ghost || changed.transform.scale !== 3) throw new Error('control update failed');
const refreshed = Controls.refreshAssetState(changed, rec);
if (refreshed.assetStatus !== 'ready' || refreshed.missingAngles.length) throw new Error('asset refresh failed');
const html = Controls.renderTurntable(rec, changed);
if ((html.match(/data-angle=/g)||[]).length !== 8) throw new Error('turntable should contain 8 angles');
if (!html.includes('aria-pressed="true"')) throw new Error('active angle missing');
const controlsHtml = Controls.renderControls(refreshed);
if (!controlsHtml.includes('data-creature-control="ghost"')) throw new Error('ghost control missing');
const applied = Controls.applyToBinding(binding, changed);
if (applied.angle !== 270 || !applied.ghost) throw new Error('binding application failed');
console.log('PASS: V70 scene creature controls');
console.log('Scene controls + 8-angle turntable + asset status + ghost/transform + binding sync');
