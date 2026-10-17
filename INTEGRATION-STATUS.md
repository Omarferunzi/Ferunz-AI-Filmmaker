# FERUNZ V70 Integration Status

## Verified source available in this workspace
- `Ferunz-character-figure-v2.V70-baseline.js` — preserved baseline renderer
- `Ferunz-character-figure-v2.V70-local.js` — hardened local renderer copy
- `Ferunz-V70-app-patch.js` — app-level renderer bridge
- `Ferunz-V70-render-adapter.js` and `Ferunz-V70-turntable-dropin.js`
- Creature Studio/UI, asset pipeline, generation controls, entity selector, scene binding and scene controls modules
- Regression tests in `test-v70-*.js`

## Module load order for a browser integration
1. `Ferunz-character-figure-v2.V70-local.js`
2. `Ferunz-V70-app-patch.js`
3. `Ferunz-V70-creature-studio.js`
4. `Ferunz-V70-creature-ui.js`
5. `Ferunz-V70-creature-assets.js`
6. `Ferunz-V70-creature-generation-controls.js`
7. `Ferunz-V70-entity-selector.js`
8. `Ferunz-V70-scene-entity-binding.js`
9. `Ferunz-V70-scene-creature-controls.js`

The modules intentionally do not contain an image-generation provider credential or a hard-coded provider endpoint. The app must supply a real provider adapter and persist generated asset URIs. A generation request/bridge is not itself proof that external image generation has run.

## Current verification
All 10 `test-v70-*.js` suites passed on 2026-10-09 in the local workspace. This verifies isolated module contracts, not full end-to-end behavior of the missing production page.

## Important integration limitation
The complete `ferunzi-characters.html` / production Studio source was not present in the available workspace or found by the current project file search. Therefore these modules have not been merged into the original production page, and no deployment is claimed. The available Vercel account query currently returns zero FERUNZ projects and zero deployments.
