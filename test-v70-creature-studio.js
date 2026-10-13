const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/Ferunz-V70-creature-studio.js', 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const S = ctx.FerunzCreatureStudio;
if (!S) throw new Error('Creature studio API missing');
const creature = S.normalizeCreature({
  name: 'Crimson Wyrm',
  species: 'original serpentine flying creature',
  description: 'Very long thin body with an elongated neck and huge leathery wings.',
  anatomy: {
    bodyType: 'serpentine', bodyLength: 92, bodyThickness: 28, neckLength: 95,
    headScale: 35, limbCount: 4, legLength: 32, wingCount: 2, wingSpan: 96,
    wingShape: 'long narrow bat-like', tailLength: 100, tailShape: 'whip-like',
    horns: ['small backward horns'], spikes: ['neck ridge']
  },
  appearance: { material: 'dark scales', primaryColor: '#171313', secondaryColor: '#9E2020', eyeColor: '#FFB000', markings: ['crimson wing membranes'] },
  generation: { gen: 7, vr: 3 }
});
if (creature.anatomy.neckLength !== 95) throw new Error('Anatomy normalization failed');
const prompt = S.creaturePrompt(creature);
if (!prompt.includes('elongated') && !prompt.includes('serpentine')) throw new Error('Prompt missing creature concept');
for (const a of S.ANGLES) {
  const html = S.creatureTurntable(creature, a, { uri: 'https://example.test/' + a + '.png' }, {});
  if (!html.includes('data-angle="' + a + '"')) throw new Error('Angle failed: ' + a);
  if (html.includes('undefined') || html.includes('NaN')) throw new Error('Bad output at ' + a);
}
const ghost = S.creatureTurntable(creature, 91, { uri: 'https://example.test/x.png' }, { ghost: true });
if (!ghost.includes('pending') || ghost.includes('example.test')) throw new Error('Ghost override failed');
const state = S.createTurntableState(creature, { activeAngle: 91 });
if (state.activeAngle !== 90 || state.angles.length !== 8) throw new Error('Turntable state failed');
if (S.creatureZone(creature, 'wings').zone !== 'wings') throw new Error('Zone inspection failed');
console.log('PASS: V70 custom creature studio');
console.log('Custom anatomy normalization + prompt + 8-angle turntable + asset priority + ghost mode + zones');
