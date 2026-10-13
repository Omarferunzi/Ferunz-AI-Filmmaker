# FERUNZ AI FILMMAKER — V70 local studio preview

This is a **local integration shell** built around the available V70 modules. It is not claimed to be the missing original production Studio page, and it is not deployed.

## Run

From this directory, run:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a browser. A static server is recommended because browsers can restrict local-file script behavior.

## Included

- Character / creature mode switch.
- Eight-angle turntable; characters use the procedural V70 figure renderer. Creature tiles deliberately show pending-asset placeholders until a real creature render exists.
- Creature anatomy and appearance controls, prompt generation, local entity library, JSON import/export, and scene draft persistence.
- Browser-local storage only; records do not sync to a server.

## Not yet connected / verified

- No real image-generation provider is configured. Do not treat a prepared prompt or provider request as proof an image was generated.
- No production backend, account system, remote persistence, or external asset storage.
- No complete original production Studio HTML was found in the inspected source; this shell is an integration preview, not proof the original app is fully integrated.
- Vercel authorization/deployment remains a separate step and has not been confirmed.

## Regression checks

Run `./run-regression-tests.sh` for the existing V70 module test suite. `node test-local-studio.js` checks shell structure and the browser script load order.

## Validation notes

The local checks validate required markup, DOM references, JavaScript syntax, asset/module presence, and module order. The ten Node regression suites exercise the V70 module contracts. A headless Chromium attempt in this environment did not complete, so a real-browser interaction pass remains unverified; do not interpret static checks as browser QA.
