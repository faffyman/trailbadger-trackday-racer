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

## Track variety and names (2026-11-26)

- Game renamed "Track Day Racer", tagged "A Trailbadger Game". Bruin and Clover approved.
- Eight layout families (ring, comb, comb2, snake, side, cross, tee, step) in place of one.
- Local track width (`track.hw`): wide start, pinch points, wide zones. Nominal width 104 to 120.
- Edge barrier applied again after rider collisions.
- Checks: 300 daily ids, no fallbacks, 2.4 ms average, lap length 3437 to 5867 units,
  screen coverage (share of 100 unit cells with track) 0.64 average. 84 simulated races
  across all families finish, furthest distance past the edge 14.0 units.
- Not done: self-crossing (figure of eight) layouts. Pinch points are mild.

## Backdrop themes (2026-11-26)

- Ten seed-fixed themes in `CONFIG.themes`: forest, autumn, pine, heath, gravel, farm,
  winter, blossom, volcano, causeway. Each has a palette plus a ground pattern, tree style,
  bush style and flower colours. Intro 1 is pinned to forest, Intro 2 to autumn.
- Checked by screenshot: gravel, causeway, farm, volcano, winter, blossom.
- Weak spots: snow-covered pines read as white rings; pickups and hazards keep the same
  colours on every theme (mud is hard to see on the volcano track).
- Six more themes added the same day: beach (palms, sea edge), desert (cacti), bog (peat
  pools, standing stones), night, bluebell, slate. Sixteen in total. All drawn in code, no
  image files. Installed size 443 KB (245 KB transfer), target is under 1 MB.

## History, date picker, crossover (2026-11-26)

- `historyDays` 365. Past days fold by month; a month builds its cards when first opened.
- Date picker on the home screen: any day from 1990 up to today.
- Saved bests are no longer pruned. One small record per track raced.
- New layout family `curl`: the lap crosses its own path once at a right angle, with a ramp
  just before the crossing (`jump.over`). `track.cross` holds the two sample indices.
- If the seeded family finds no valid shape in 40 tries, the other families are tried
  before the plain ellipse. 4050 days checked: no ellipse fallbacks.
- Checks: 40 simulated races on curl tracks finish, furthest past the edge 14.0 units.
- Not checked: whether riders visibly clear the crossing in the air on every curl track;
  the picker on a real phone.

## Tilted view, lap setting, tilt steering (2026-11-26)

- `view.tilt` 0.74: three-quarter camera. Berms are raised banks, trees stand on trunks,
  riders and pickups keep their shape. Set 1 for the flat view. Leaves empty bands above
  and below the world.
- Race length: default 4 laps, player setting 2 to 8 on the home screen. Best race time is
  kept per race length (`times`), best lap and best place are shared.
- Tilt steering option (phone motion sensor), off by default. Tested with a simulated
  sensor only; needs a real phone.
- Saved track records cap raised from 200 to 5000.
