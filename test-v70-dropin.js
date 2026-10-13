const fs = require('fs');
const vm = require('vm');
const renderer = fs.readFileSync(__dirname + '/Ferunz-character-figure-v2.V70-local.js','utf8');
const adapter = fs.readFileSync(__dirname + '/Ferunz-V70-render-adapter.js','utf8');
const dropin = fs.readFileSync(__dirname + '/Ferunz-V70-turntable-dropin.js','utf8');
function load(src){ const ctx={console,module:{exports:{}},globalThis:null}; ctx.globalThis=ctx; vm.runInNewContext(src,ctx); return ctx; }
const a=load(renderer+'\n'+adapter);
const b=load(dropin);
const c={name:'Captain Asha Njoroge',alias:'Huntswoman',gender:'female',build:'athletic',height:'tall',hairStyle:'ponytail',outfit:'tactical',accessory:'earpiece',scar:true};
for(const ctx of [a,b]){
  for(const angle of [0,45,90,135,180,225,270,315]){
    const s=ctx.renderV70View(c,angle,null,{});
    if(!s.startsWith('<svg') || s.includes('NaN') || s.includes('undefined')) throw new Error('bad render '+angle);
  }
  const img=ctx.renderV70View(c,90,{uri:'https://example.test/a.png'},{});
  if(!img.includes('class="render"') || !img.includes('a.png')) throw new Error('asset priority failed');
  const ghost=ctx.renderV70View(c,90,{uri:'https://example.test/a.png'},{ghost:true});
  if(ghost.includes('<img') || !ghost.startsWith('<svg')) throw new Error('ghost override failed');
}
console.log('PASS: V70 turntable drop-in');
console.log('Renderer + adapter bundle; 8 angles; asset priority; ghost override; no NaN/undefined');
