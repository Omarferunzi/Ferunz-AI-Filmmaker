/* FERUNZ V71 Procedural Renderer Bridge
 * Requires creature-studio.js beside this file and a modern browser with ES modules.
 * This is an optional local-render path; it does not call /api/generate or any paid API.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let StudioModule = null;
  let studio = null;
  let renderCanvas = null;
  let outputPanel = null;

  function text(id, fallback = '') {
    const el = $(id);
    return el && String(el.value || '').trim() ? String(el.value).trim() : fallback;
  }
  function number(id, fallback) {
    const n = Number(text(id, String(fallback)));
    return Number.isFinite(n) ? n : fallback;
  }
  function setNotice(message, isError = false) {
    const el = $('previewNotice');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', !!isError);
  }
  function ensurePanel() {
    if (outputPanel) return;
    const anchor = $('turntable')?.closest('section') || $('turntable')?.parentElement;
    outputPanel = document.createElement('section');
    outputPanel.className = 'panel';
    outputPanel.id = 'proceduralOutput';
    outputPanel.innerHTML = `
      <div class="panel-head">
        <h2>LOCAL PROCEDURAL RENDER</h2>
        <span class="small" id="proceduralStatus">No render yet</span>
      </div>
      <div class="pad">
        <p class="note">Rendered in this browser. This mode does not use the paid image-generation API.</p>
        <div id="proceduralCanvasHost" style="display:grid;place-items:center;overflow:auto;background:#10140f;border:1px solid var(--line);border-radius:10px;padding:8px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="downloadProceduralPng" type="button">Export PNG</button>
          <button id="downloadProceduralJson" type="button">Export design JSON</button>
        </div>
      </div>`;
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(outputPanel, anchor);
    else document.body.appendChild(outputPanel);
    renderCanvas = document.createElement('canvas');
    renderCanvas.width = 960;
    renderCanvas.height = 720;
    renderCanvas.style.cssText = 'display:block;width:100%;max-width:720px;height:auto;border-radius:8px';
    $('proceduralCanvasHost').appendChild(renderCanvas);

    $('downloadProceduralPng').addEventListener('click', async () => {
      if (!studio) return setNotice('Generate a procedural render first.', true);
      const blob = await studio.toBlob();
      if (!blob) return setNotice('PNG export failed in this browser.', true);
      downloadBlob(blob, safeName(studio.spec.name || 'ferunz-creature') + '.png');
    });
    $('downloadProceduralJson').addEventListener('click', () => {
      if (!studio) return setNotice('Generate a procedural render first.', true);
      downloadBlob(new Blob([studio.toJSON()], { type: 'application/json' }),
        safeName(studio.spec.name || 'ferunz-creature') + '.json');
    });
  }
  function safeName(s) {
    return String(s || 'ferunz-creature').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'ferunz-creature';
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function makeSpec() {
    const name = text('entityName', 'FERUNZ Creature');
    const species = text('species', 'original creature');
    const description = text('description', '');
    const notes = text('customNotes', '');
    const bodyType = text('bodyType', 'quadruped').toLowerCase();
    const brief = [species, description, notes, bodyType].filter(Boolean).join(', ');
    const kind = /serpent|snake|worm|wyrm|snake-like|limbless/.test(bodyType + ' ' + brief.toLowerCase())
      ? 'serpent'
      : /humanoid|biped|upright|person|elf|orc|human/.test(bodyType + ' ' + brief.toLowerCase())
        ? 'biped' : 'quadruped';
    const primary = text('primaryColor', '#4f7a4a');
    const secondary = text('secondaryColor', '#c8b45a');
    const eye = text('eyeColor', '#e8b020');
    const limbs = Math.max(0, Math.min(12, number('limbCount', 4)));
    const wings = Math.max(0, Math.min(8, number('wingCount', 0)));
    const bodyLength = number('bodyLength', 50);
    const bodyThickness = number('bodyThickness', 50);
    const neckLength = number('neckLength', 50);
    const tailLength = number('tailLength', 50);
    return {
      name, kind, seed: Math.floor(Math.random() * 99999),
      frame: { width: 960, height: 720, fit: true },
      body: { length: 20 + bodyLength * 0.55, thickness: 4 + bodyThickness * 0.16, arch: 3, tilt: 0, sway: 0 },
      neck: { length: neckLength * 0.35, thickness: 5.2, angle: 55, curve: 18 },
      head: { size: 7, snout: /dragon|drake|lizard|reptile|wyrm/i.test(brief) ? 10 : 5, horns: /horn/i.test(brief) ? 2 : 0, hornLength: 10, eyes: 1, eyeSize: 1.5, pupil: 'slit' },
      limbs: { pairs: kind === 'serpent' ? 0 : Math.max(1, Math.round(limbs / 2)), arms: kind === 'biped' ? 1 : 0, length: 12 + number('legLength', 50) * 0.24, thickness: 4, foot: 6, claws: /claw|talon/i.test(brief) ? 3 : 1, digitigrade: 0.6, stride: 0.5 },
      tail: { length: tailLength * 0.7, curve: 8, tip: /spade|demon/i.test(brief) ? 'spade' : 'none' },
      wings: { span: wings ? Math.max(12, number('wingSpan', 50) * 0.7) : 0, angle: 100, fingers: 4, bone: 1.1, pair: true },
      crest: { count: /spike|spiny|crest|frill/i.test(brief) ? 8 : 2, size: 2.8 },
      skin: { type: /fur|furry|wolf|bear/i.test(brief) ? 'fur' : /feather|bird/i.test(brief) ? 'feather' : /insect|chitin|armou?r|carapace/i.test(brief) ? 'chitin' : text('material', 'scales'), base: primary, secondary, belly: secondary, horn: '#d8cfb8', membrane: secondary, pattern: /spot/i.test(brief) ? 'spots' : /stripe/i.test(brief) ? 'stripes' : 'mottle', patternScale: 1, patternStrength: 0.65, scale: 1, roughness: 0.45, bump: 1 },
      eye: { color: eye, sclera: false, glow: /glow|glowing|luminous/i.test(brief) ? 1.1 : 0 },
      rules: { enforce: true, symmetry: true, proportions: 'custom' }
    };
  }
  async function generate() {
    const button = $('generateProcedural');
    const original = button.textContent;
    button.disabled = true; button.textContent = 'Rendering locally…';
    try {
      if (!StudioModule) StudioModule = await import('./creature-studio.js');
      ensurePanel();
      const spec = makeSpec();
      if (!studio) studio = new StudioModule.CreatureStudio(renderCanvas, spec, { quality: 'high' });
      else studio.setSpec(spec);
      const brief = [text('species', 'original creature'), text('description'), text('customNotes')].filter(Boolean).join(', ');
      if (brief) await studio.imagine(brief);
      // Reapply the UI-driven name and key palette values after prompt interpretation.
      studio.setSpec({ name: text('entityName', 'FERUNZ Creature'), skin: {
        base: text('primaryColor', '#4f7a4a'),
        secondary: text('secondaryColor', '#c8b45a')
      }, eye: { color: text('eyeColor', '#e8b020') } });
      $('proceduralStatus').textContent = `Rendered locally · ${Math.round(studio.lastRenderMs || 0)} ms`;
      setNotice('Procedural render complete. It was created locally and did not use /api/generate.');
      outputPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('[FERUNZ procedural mode]', err);
      setNotice('Procedural render failed: ' + (err?.message || String(err)) +
        '. Check that creature-studio.js is in the same folder and is served by your site.', true);
    } finally {
      button.disabled = false; button.textContent = original;
    }
  }
  function install() {
    const target = $('generateImage');
    if (!target || $('generateProcedural')) return;
    const button = document.createElement('button');
    button.id = 'generateProcedural';
    button.type = 'button';
    button.textContent = 'Generate Procedural (Free)';
    button.title = 'Render a controllable creature locally without an image-generation API';
    button.addEventListener('click', generate);
    target.insertAdjacentElement('afterend', button);
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Procedural mode is local and free; it creates stylized geometry and materials, not diffusion-model photorealism.';
    button.insertAdjacentElement('afterend', note);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
