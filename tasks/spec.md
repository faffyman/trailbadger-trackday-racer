# Trailbadger Racer: build spec

Single-screen, top-down mountain bike racing game. The player is Brock the Badger. He races
Tod the fox, Bruin the bear and Clover the rabbit. Phone browser first, desktop second.
Fully offline, installable (PWA). No build step, no dependencies, no network calls.

Read `js/config.js` first. It holds every constant and the data shapes (Track, Input,
RacerState, RaceState, RaceEvent). Those shapes are the contract. Do not change them. If a
shape blocks you, say so in your final report and do not edit config.js.

## Rules for every module

- Plain ES modules, raw JS, no jQuery, no libraries, no CDN, no web fonts (system fonts only).
- 4-space indent, single quotes, semicolons. Comments in plain prose. No em dashes anywhere.
- Only create or edit the files assigned to you.
- Test scripts, screenshots and scratch files go in the scratchpad directory given in your
  prompt, never in the project folder.
- Node 24 is available and imports these `.js` ES modules directly from a `.mjs` test script.
- Modules marked "pure" must not touch `window`, `document` or any DOM API at import time or
  in their logic, so that Node can import them.

## Files

```
index.html                 shell: canvas, HUD, screens, touch controls      (agent UI)
css/game.css               all styling                                      (agent UI)
js/config.js               constants and shapes                             (done, read only)
js/rng.js                  seeded random numbers, pure                      (agent TRACK)
js/track.js                track generator and track list, pure             (agent TRACK)
js/race.js                 simulation: physics, AI, pickups, laps, pure     (agent RACE)
js/render/sprites.js       racer sprites and portraits                      (agent RENDER)
js/render/scene.js         canvas renderer and track thumbnails             (agent RENDER)
js/input.js                keyboard and touch                               (agent UI)
js/storage.js              localStorage                                     (agent UI)
js/main.js                 screens, game loop, glue                         (agent UI)
js/audio.js                Web Audio music and effects                      (agent AUDIO)
js/pwa.js                  service worker registration                      (agent AUDIO)
sw.js                      offline cache                                    (agent AUDIO)
manifest.webmanifest                                                        (agent AUDIO)
assets/img/icon.svg, icon-180.png, icon-192.png, icon-512.png               (agent AUDIO)
```

## View

The whole track is visible at all times (no scrolling camera). The world is 1600 x 900 units.
The renderer fits the world into the available screen area. When the area is taller than it is
wide (phone held upright) the renderer draws the world rotated by 90 degrees so the long side
of the world follows the long side of the screen. Steering is relative to the rider, so the
rotation does not change the controls.

The look is modern and soft, not 8-bit: smooth shapes, gradients, soft drop shadows, dust
particles, device-pixel-ratio aware. Height is suggested by shadows: a rider in the air is
drawn larger and its shadow moves away from the body.

## js/rng.js (pure)

```js
export function hashString(str)   // -> uint32 (xmur3 or FNV-1a style)
export function makeRng(seed)     // -> function rnd() returning a float in [0, 1) (mulberry32)
```

## js/track.js (pure)

```js
export function generateTrack(id)          // -> Track. Same id always gives the same track.
export function dailyId(date = new Date()) // -> 'daily-YYYY-MM-DD' from the LOCAL date
export function listTracks(today = new Date())
// -> { intro: [{id, label}], daily: [{id, label, date}] }
//    intro: the two ids of CONFIG.introTracks, labels 'Intro 1' and 'Intro 2'
//    daily: CONFIG.historyDays entries, today first; label 'Today', 'Yesterday', then '24 Nov'
```

The generator works like the galaxy generator in Elite: nothing is stored, the id is hashed to
a seed, and every property comes from the seeded random stream in a fixed order.

Method as built (2026-11-26):

1. `seed = hashString(id)`. A base stream sets direction, theme, name, nominal width, pace,
   feature counts and the layout family.
2. Layout family, from the seed. `ring` is a rounded rectangle with dents. The others start
   from a folded outline of corner points in the unit square: `comb` (one tongue of infield),
   `comb2` (two tongues), `snake` (one tongue from the top, one from the bottom), `side`
   (three long parallel straights), `cross` (plus shape), `tee`, `step`. The outline is
   mirrored and nudged from the seed, some long edges get a kink, and the corners are rounded
   by repeated neighbour averaging. Each try has its own sub-seed and smaller folds.
3. Resample evenly, compute tangents, right-hand normals and curvature. Validate minimum
   radius, self distance, a start straight and (dailies) enough bends. After 40 failed tries
   fall back to a plain ellipse.
4. Local width: `track.hw` holds half of the track width at every sample. Dailies get a wide
   start straight, one to three narrow pinch points on straights and one or two wide zones.
   The width is capped so the track stays in the world, never folds inside a bend and keeps
   at least 50 units of grass to any other part of the lap. Width is constant along a berm.
   `track.width` is the nominal width. Race and renderer use `hw` everywhere.
5. Features (berms, jumps, pickups, decor, grid) come from their own stream, as before. Jumps
   avoid pinch points.
8. Intro tracks use the same generator with gentle settings:
   - `intro-1`: "First Ride" style: near oval (K = 2, low amplitude), width widthIntro,
     1 jump, 5 pickups, all boost, 1 or 2 berms, aiPace 0.80, lapsIntro laps.
   - `intro-2`: a little more shape (K = 3), 2 jumps, 6 pickups with one mud and one bramble,
     aiPace 0.90, lapsIntro laps.
   - daily: K = 4 to 6, width between widthMin and widthMax, aiPace 0.95 to 1.02, lapsDaily.

Checks to run in Node for the two intro ids and 120 daily ids: determinism (two calls give
deeply equal data), the validation rules of step 4, every feature rule of step 7, lap length
between 2800 and 6500 units, all centreline points inside the world. Also render 12 tracks to
one PNG contact sheet in the scratchpad (PIL is installed for python3) and look at it: tracks
must look varied and fun, not 12 ovals.

## js/race.js (pure)

```js
export function createRace(track) // -> { state, step(dt, input), results() }
```

- `state` is a RaceState. `step(dt, input)` advances by `dt` seconds (the caller always passes
  CONFIG.fixedDt). `input` drives racer 0 only. The player starts in grid slot 3 (the back).
- Phases: `countdown` (riders held, events `count` with value 3, 2, 1 then `go`), `racing`,
  `finished` (set when the player completes the last lap; AI riders keep rolling to a stop;
  further steps stay safe).
- `results()` -> `{ place, time, bestLap, order: [{ id, name, time }] }` where `time` is null
  for riders who did not finish; they are ordered by progress. Valid once phase is `finished`.

Physics (all numbers from CONFIG.phys, multiplied by the racer stats):
- State is position, heading, velocity vector. Steering turns the heading (scaled down below
  turnMinSpeed). Pedal accelerates along the heading up to the current max speed. Sideways
  velocity (relative to the heading) is removed at the grip rate, so fast tight corners drift.
- Surface: on track when |lateral offset| <= width / 2. Off the track the max speed is
  offroadMax. No walls. Clamp riders inside the world box.
- Berm: inside a berm sample range and on the outer half (offset sign equals berm side): grip
  is gripBerm and max speed gets bermSpeedBonus.
- Jump: crossing a jump sample forwards while on the track and on the ground. At or above
  jumpMinSpeed the rider takes off (event `jump`), z follows gravity, no grip, no steering
  effect on velocity, no pickups or hazards, no offroad slow. On landing: heading within
  cleanLandAngle of the velocity direction gives cleanLandBoost seconds of boost (event `land`
  value 1), otherwise speed * bumpFactor (event `land` value 0). Below jumpMinSpeed: speed *
  bumpFactor and event `bump`.
- Pickups: one per track.pickupSpots entry, taken by touch (pickups.radius + riderRadius),
  respawn after pickups.respawn seconds. `boost`: boostTime seconds of boost (events `pickup`
  and `boost`). `mud` or `bramble`: a hazard of that type is dropped hazardDropBack units
  behind the collector (events `pickup` and `drop`) and stays hazardTtl seconds. The owner is
  immune to it. Another rider on the ground who touches it: mud = mudTime seconds with max
  speed mudMax (event `mud`, hazard stays); bramble = brambleTime seconds without steering and
  speed * brambleFactor (event `bramble`, hazard is removed).
- Riders push each other apart (circle collision, riderRadius), with a little speed loss.
- Laps and progress: track the nearest centreline sample per rider. Accept a new sample only
  when it is within a window of the old one (back 5 percent, forward 15 percent of n) so a
  short cut across the infield does not count. A lap counts when the rider passes sample 0
  forwards. Guard against a rider who reverses over the line and crosses again.
  `wrongWay` when the rider moves against the tangent for more than about 1 second.
  `place` is the rank by progress, finished riders first by finish time.
- AI (racers 1 to 3): aim at a centreline point ahead (lookahead seconds * speed) plus a lane
  offset (ai.lane * width, moved to the outer side in berms, nudged away from a hazard ahead
  that is not its own). Target speed from the curvature ahead, scaled by ai.skill and
  track.aiPace. Brake when well above target. Small rubber band: up to 5 percent faster when
  far behind the player and 5 percent slower when far ahead. If off the track or stuck, steer
  back to the centreline. AI riders must use the same physics as the player.

Checks to run in Node (build a small oval Track by hand that fits the typedef, with one berm,
one jump and three pickup spots; `js/track.js` may not exist yet): an AI-only run finishes all
laps for all three AI riders without leaving the track for long; a scripted player who only
holds pedal on a circle-following steer finishes; lap count cannot be gained by reversing over
the line; events fire; no NaN in any state after 5 simulated minutes.

## js/render/sprites.js and js/render/scene.js

```js
// scene.js
export function createRenderer(canvas)
// -> {
//   setTrack(track),             // builds the static layers
//   resize(cssW, cssH, insets),  // insets {top, right, bottom, left} in CSS px kept clear for HUD and controls
//   draw(state, dt),             // state: RaceState, dt: seconds since the last draw (for particles)
//   onEvent(ev),                 // RaceEvent, for particle bursts and flashes
// }
export function drawTrackThumb(canvas, track) // small outline preview for the track list
// sprites.js
export function drawPortrait(canvas, racerId) // head-and-shoulders face icon for menus and results
```

- Static layers are drawn once per setTrack or resize into offscreen canvases: ground with
  soft texture, track surface with darker edges and tyre lines, berms (raised banked outer
  edge with a highlight), jump ramps (with a shadow and chevrons), start and finish line
  (chequered), rocks and bushes. Tree canopies are a second layer drawn above the riders.
- Dynamic per frame: pickups (bobbing, distinct icon per type: boost = lightning bolt,
  mud = brown splat, bramble = thorny green ball), dropped hazards, rider shadows, riders
  sorted by z, dust and mud particles, boost trail, a marker ring or arrow above the player
  so Brock is easy to find, countdown numbers are NOT drawn here (the HUD does that).
- Racer sprite: seen from above, bike (two wheels, frame in the marker colour, handlebar)
  and rider (body, head with species features, tail). Badger: grey body, white head with two
  black stripes, small ears. Fox: orange, white muzzle, pointed ears, bushy tail with white
  tip. Bear: big, brown, round ears. Rabbit: cream, long ears laid back. Length on the
  ground is CONFIG.phys.riderLength. Lean with `steer`, legs move with `pedalPhase`.
  Pre-render where it helps. Must hold 60 fps on a mid-range phone.
- The renderer owns the world-to-screen transform (scale, 90 degree rotation, centring).

Checks: a throwaway HTML page in the scratchpad that imports scene.js, builds a hand-made
oval Track and a fake RaceState, and draws it. Screenshot it at 390 x 844 and 844 x 390 and
1280 x 800 and look at the result.

## js/input.js, js/storage.js, js/main.js, index.html, css/game.css

```js
// input.js
export function createInput(root) // -> { read() -> Input, reset() }
// storage.js  (never throws; the game works when storage is unavailable)
export function loadSave()        // -> { settings: {music, effects}, tracks: {[id]: {bestTime, bestLap, bestPlace, plays}}, stats: {races, wins, podiums} }
export function saveSettings(settings)
export function recordResult(trackId, result) // result from race.results(); -> { newBestTime, newBestPlace }
export function pruneTracks(validIds)         // drop records of daily tracks that left the history window
```

- Keyboard: Left and Right arrows (also A and D) steer, Up (W) pedals, Down (S) brakes,
  Escape or P pauses, Enter starts or confirms.
- Touch: two steer buttons bottom left, one large pedal button bottom right, one small brake
  button above it. Pointer events, multi-touch, `touch-action: none`, no text selection, no
  long-press menu. Touch controls show only on touch devices (`pointer: coarse`).
- Screens (DOM overlays above the canvas):
  - Home: title, today's track card (name, thumbnail, best time and best place), a large Play
    button, the two intro tracks, and a scrolling list of past daily tracks (30 days) with
    thumbnail, name, date label and best result. A new player (no saved races) sees
    "Start here" on Intro 1 and that card is first. No track is locked.
    Build thumbnails lazily (IntersectionObserver or on idle) so the list opens fast.
  - Top bar on every screen: music toggle, effects toggle, an (i) info button.
  - Info panel: how to play, the controls for touch and keyboard, what the pickups do
    (boost, mud, bramble), jumps and berms, how daily tracks work, a short stats block
    (races, wins, podiums) and how to install to the home screen.
  - Race HUD: place (1st to 4th), lap x / n, race time, pause button, countdown 3 2 1 GO,
    "Wrong way" notice. Compact, must not cover the track on a phone.
  - Pause: resume, restart, quit to tracks. Pause automatically when the page is hidden.
  - Results: place with the racer portraits in finishing order, race time, best lap,
    "New best" flag, buttons Race again and Tracks.
- Game loop: fixed step CONFIG.fixedDt with an accumulator (cap the frame delta at 0.1 s),
  one renderer.draw per animation frame. Drain `race.state.events` every frame: pass each to
  `renderer.onEvent` and map it to a sound (player events at full volume, others quieter or
  skipped).
- Layout: `100dvh`, safe-area insets, no page scroll or zoom during a race. Portrait phone:
  HUD strip at the top, touch controls in a strip at the bottom, the canvas between them
  (pass those as insets). Landscape: HUD and controls float over the corners.
- Style: modern, rounded, friendly, good contrast, large touch targets (48 px minimum).
  Accessible: real buttons, aria-labels, aria-pressed on toggles, focus styles.
- `index.html` links `manifest.webmanifest`, the icons in `assets/img/`, theme colour
  `#1d2b1f`, and loads `js/main.js` as a module. main.js imports `./pwa.js` for registration.

Module APIs that main.js uses and other agents write: track.js, race.js, scene.js,
sprites.js (all above) and audio.js (below). Code against these signatures exactly.

## js/audio.js, js/pwa.js, sw.js, manifest, icons

```js
// audio.js
export const audio = {
    unlock(),            // call from the first user gesture; creates or resumes the AudioContext
    setMusic(on), setEffects(on),
    playMusic(name),     // 'menu' or 'race'; no-op when it is already playing; honours setMusic
    stopMusic(),
    sfx(name, volume = 1) // 'click','count','go','pickup','boost','drop','mud','bramble','jump','land','bump','lap','finish','win'
};
// pwa.js
export function registerServiceWorker() // quiet no-op when unsupported or on file://
```

- All sound is synthesised with Web Audio. No audio files. Music: two short upbeat loops
  (menu: relaxed, race: driving), scheduled ahead with the audio clock, soft modern synth
  sound with a little filter and a gentle master compressor, not harsh chip bleeps. Every
  method is safe before `unlock()` and when Web Audio is missing. Suspend when the page is
  hidden.
- `sw.js`: cache name CONFIG.cacheName value `trailbadger-racer-v1` (a sibling game on the
  same origin uses the cache `trailbadger`; never delete caches that do not start with
  `trailbadger-racer-`). Precache every file in the list above. Cache first with a
  background refresh, so the game starts offline. Paths relative to the scope.
- `manifest.webmanifest`: name "Trailbadger Racer", short_name "TB Racer", start_url "./",
  scope "./", display "fullscreen" with display_override ["fullscreen", "standalone"],
  orientation "any", background and theme colour `#1d2b1f`, the 192 and 512 icons.
- Icons: a badger head (white face, two black stripes) with a bike helmet on a forest green
  rounded square. Draw `icon.svg` and matching PNGs with python3 PIL (work in the scratchpad,
  copy only the final files). Look at the PNG before you finish.
