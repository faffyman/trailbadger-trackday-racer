# Trailbadger Racer: todo

Spec: `tasks/spec.md`. Contract: `js/config.js`.

## Phase 1: basic gameplay

- [x] Design: module split, data shapes, constants
- [x] TRACK: `js/rng.js`, `js/track.js` (seeded generator, track list)
- [x] RACE: `js/race.js` (physics, AI, pickups, hazards, laps)
- [x] RENDER: `js/render/scene.js`, `js/render/sprites.js`
- [x] UI: `index.html`, `css/game.css`, `js/main.js`, `js/input.js`, `js/storage.js`
- [x] AUDIO and PWA: `js/audio.js`, `js/pwa.js`, `sw.js`, manifest, icons
- [x] Integration: run in a browser, portrait phone, desktop
- [x] Review section below

## Review (2026-11-26)

Verified with the real modules together:
- Loads with no console errors or warnings at 1280 x 800 and 390 x 844.
- Service worker installs and caches all 19 files.
- A scripted rider (pure pursuit of the centreline) finishes `intro-1` (31.7 s) and today's
  daily (48.8 s); `results()` feeds `recordResult()` and the save reads back correctly.
- Track generator: 122 of 122 ids pass every rule, no ellipse fallbacks, 2 to 3 ms each.

Not verified:
- No human has played it. Feel, difficulty and audio quality are unjudged.
- No real phone test (touch feel, iOS audio unlock, install to home screen).
- The results screen was only exercised against stub modules, not at the end of a real race.

Changed after agent reports: `jumpVz` 0.5 to 0.65 (longer air time).

## Phase 2 candidates

- Riders are about 19 px long on an upright phone. Options: larger sprites, or a follow camera.
- Races are short (32 s intro, 49 s daily for a clean run). Consider more laps.
- Track shapes are all in the rounded-rectangle family. Add more archetypes, maybe crossovers.
- Mud hazard reads like a rock at phone size. Add a wet sheen.
- AI pace: `AI_EASE` in `js/race.js` is 0.94; tune after real play.
- Bear and rabbit names (Bruin, Clover) and the game title are placeholders.

## Tuning after first play (2026-11-26)

Tim played it and said the handling is much better.
- All races 6 laps.
- Portrait control strip 180 px to 120 px; rider sprites 1.4x (`riderLength` 64).
- Brock portrait and app icons use the official head artwork (`assets/img/brock.webp`).
- Track edge barrier: at most `edgeAllow` (14) units past the edge, small bounce, 8 percent speed loss.
- `grip` 6.5 to 10, `maxSpeed` 300 to 285, `offroadMax` 140 to 200, `AI_EASE` 0.94 to 0.88.
