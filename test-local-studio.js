'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const required = [
  'FERUNZ AI FILMMAKER', 'id="turntable"', 'id="saveEntity"', 'id="copyPrompt"',
  'id="exportLibrary"', 'id="importButton"', 'id="saveScene"', 'id="exportScene"',
  'localStorage', 'provider not configured', 'Ferunz-character-figure-v2.V70-local.js',
  'Ferunz-V70-creature-studio.js', 'Ferunz-V70-creature-assets.js', 'Ferunz-V70-entity-selector.js',
  'Image asset pending', 'ferunz-v70-scene', 'ferunz-v70-library'
];
const expected = [
  'Ferunz-character-figure-v2.V70-local.js', 'Ferunz-V70-app-patch.js',
  'Ferunz-V70-creature-studio.js', 'Ferunz-V70-creature-ui.js',
  'Ferunz-V70-creature-assets.js', 'Ferunz-V70-creature-generation-controls.js',
  'Ferunz-V70-entity-selector.js', 'Ferunz-V70-scene-entity-binding.js',
  'Ferunz-V70-scene-creature-controls.js'
];
const missingText = required.filter(s => !html.includes(s));
const scriptNames = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const missingFiles = scriptNames.filter(s => !fs.existsSync(path.join(root, s)));
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const literalRefs = [...html.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const missingIds = [...new Set(literalRefs.filter(id => !ids.has(id)))];
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
const syntaxErrors = [];
inlineScripts.forEach((script, i) => { try { new vm.Script(script, { filename: `index.html:inline-${i + 1}` }); } catch (e) { syntaxErrors.push(e.message); } });
const jsFiles = fs.readdirSync(root).filter(f => f.endsWith('.js'));
jsFiles.forEach(file => { try { new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }); } catch (e) { syntaxErrors.push(`${file}: ${e.message}`); } });
const errors = [];
if (missingText.length) errors.push(`missing required shell features: ${missingText.join(', ')}`);
if (JSON.stringify(scriptNames) !== JSON.stringify(expected)) errors.push(`module load order differs: ${scriptNames.join(', ')}`);
if (missingFiles.length) errors.push(`missing local scripts: ${missingFiles.join(', ')}`);
if (missingIds.length) errors.push(`literal DOM IDs not found: ${missingIds.join(', ')}`);
if (syntaxErrors.length) errors.push(`JavaScript syntax errors: ${syntaxErrors.join(' | ')}`);
if (errors.length) { console.error('FAIL local studio checks\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`PASS local studio checks: ${required.length} required features; ${scriptNames.length} ordered local modules; ${ids.size} DOM IDs; ${jsFiles.length} JavaScript files parsed; ${inlineScripts.length} inline script parsed.`);
console.log('NOTE: this is static/runtime-syntax validation, not a real-browser interaction test.');
