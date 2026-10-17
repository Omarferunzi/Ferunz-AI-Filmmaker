const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/Ferunz-character-figure-v2.V70-local.js', 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.__figure = figure;', ctx);
const figure = ctx.__figure;
if (typeof figure !== 'function') throw new Error('figure() API missing');
const chars = [
  {name:'Captain Asha Njoroge', alias:'Huntswoman', gender:'female', build:'athletic', height:'tall', hairLength:'long', outfit:'tactical', accessory:'earpiece', scar:true},
  {name:'Rex <Test> & Co', alias:'"Quoted"', gender:'male', build:'muscular', height:'short', hairStyle:'mohawk', outfit:'hero'},
  {name:'Neutral', gender:'androgynous', build:'heavy', height:'average', hairStyle:'curly', outfit:'formal', tattoo:true}
];
const angles = [0,45,90,135,180,225,270,315];
let count=0;
for (const c of chars) for (const a of angles) {
  const svg = figure(c,a,{gen:2,vr:3});
  if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) throw new Error(`bad SVG envelope ${c.name} @${a}`);
  if (/NaN|undefined/.test(svg)) throw new Error(`bad numeric output ${c.name} @${a}`);
  if (!svg.includes('aria-label=')) throw new Error(`missing aria label ${c.name} @${a}`);
  count++;
}
const weird = figure({name:'A&B <C> "D" \'E\''}, 'not-a-number', {gen:'bad',vr:null});
if (/NaN|undefined/.test(weird)) throw new Error('invalid input leaked NaN/undefined');
if (!weird.includes('A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;')) throw new Error('escaping regression');
console.log(`V70 renderer regression PASS: ${count} angle renders + invalid-input case`);
