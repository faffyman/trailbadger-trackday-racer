# Track Day Racer

A small top-down mountain bike racing game for phone browsers, made for fun for
[Trailbadger](https://trailbadger.com). You are Brock the badger. Race Tod the
fox, Bruin the bear and Clover the rabbit around a new track every day.

- Plays in any modern mobile or desktop browser.
- Installs to the home screen and then works fully offline.
- Under 500 KB in total. No accounts, no tracking, no network calls.

## Features

**The game**

- A single-screen racer: the whole track is always in view, seen from above
  with a slight tilt.
- Four riders, a set number of laps, first across the line wins.
- Steer left and right and pedal. On a phone, optional tilt steering lets you
  lean the phone like a handlebar.
- Stay on the dirt. A soft barrier at the track edge bounces riders back and
  costs a little speed.
- Race length is the player's choice, from 2 to 8 laps. The default is 4.

**Tracks**

- A new track every day, built from the date. Nothing is downloaded and
  nothing is stored: the date is turned into a number, and that number decides
  the shape, the width, the scenery and the name.
- The same date gives the same track on every device, so everyone rides the
  same daily track.
- A year of past days to browse by month, plus a date picker for any day up to
  today.
- Two fixed intro tracks for new players.
- Nine layout families, from simple rings to folded serpentines, hairpin
  combs, and a crossover where the track crosses its own path.
- Track width changes along the lap: a wide start, pinch points and wide
  passing zones.

**Jumps, berms and pickups**

- Ramps: hit one fast and Brock flies. Land straight for a short boost.
- On a crossover track a ramp carries fast riders over the crossing.
- Berms: banked bends that give more grip and speed on the outside line.
- Lightning bolt: a short burst of speed.
- Mud splat: drops mud behind the rider. Anyone following slows down.
- Thorny ball: drops brambles behind the rider. Anyone following loses
  steering for a moment.

**Look and sound**

- Sixteen backdrops, fixed per track: forest, autumn wood, pine forest,
  heather moor, gravel quarry, cornfield farm, winter snow, cherry blossom,
  volcano, causeway coast, beach and dunes, desert canyon, peat bog, night
  ride, bluebell wood and slate mine.
- Everything on screen is drawn in code. The only image files are the app
  icons and Brock's portrait.
- Music and every sound effect are generated in code, with separate on/off
  buttons.

**For the player**

- Best time, best lap and best place for every track raced, saved on the
  device. Best times are kept separately for each race length.
- Lifetime stats: races, wins, podiums and riders lapped.
- A Lapper badge for getting a whole lap ahead of another rider.
- Riders still on the track when Brock finishes are placed by their gap, not
  marked as non-finishers.
- Pause, with automatic pause when the app loses focus.
- A how-to-play panel.

**Technical**

- Installs to the home screen and plays fully offline.
- Under 500 KB. No accounts, no tracking, no network calls.
- Plain HTML, CSS and JavaScript. No build step and no dependencies.

## Play it locally

The game is plain files, but browsers only load JavaScript modules over HTTP,
so opening `index.html` directly does not work. Serve the folder instead:

```bash
git clone git@github.com:faffyman/trailbadger-trackday-racer.git
cd trailbadger-trackday-racer
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server works just as well
(`npx serve`, `php -S localhost:8000`, and so on).

To play on a phone on the same Wi-Fi, start the server with
`python3 -m http.server 8000 --bind 0.0.0.0` and open
`http://<your computer's IP>:8000` on the phone. Installing to the home screen,
offline play and tilt steering need HTTPS (or `localhost`), so for those use a
tunnel or a static host.

### Controls

| Action | Touch | Keyboard |
|--------|-------|----------|
| Steer | Arrow buttons on the left, or lean the phone with Tilt steering on | Left and Right arrows, or A and D |
| Pedal | Hold the big button on the right | Up arrow or W |
| Brake | Small button next to the pedal | Down arrow or S |
| Start or confirm | Tap | Enter |
| Pause | Pause button | P or Escape |

Steering is relative to the rider: left always turns Brock to his own left,
whichever way he faces on screen.

The buttons in the top right corner switch music and sound effects on and off
and open How to play. Race length and Tilt steering are on the home screen.

## For developers

There is no build step, no framework and no dependencies. Edit a file, reload
the page.

### Layout

```
index.html              Page shell: canvas, HUD, screens, touch buttons
manifest.webmanifest    Install metadata
sw.js                   Service worker: offline cache, cache first
css/game.css            All styling for the HTML overlay
assets/img/             App icons and Brock's portrait
js/config.js            Every tuning value, the themes, and the shared typedefs
js/rng.js               Seeded random numbers. No DOM access, runs in Node
js/track.js             Track generator and track list. No DOM access, runs in Node
js/race.js              All race rules: physics, AI, pickups, laps. Runs in Node
js/main.js              Game loop, HUD, home screen, results, settings
js/input.js             Touch, keyboard and tilt input
js/audio.js             All sound, synthesised with Web Audio (no audio files)
js/storage.js           Best results, stats and settings in localStorage
js/pwa.js               Service worker registration
js/render/scene.js      Ground, track, berms, ramps, scenery, riders, effects, thumbnails
js/render/sprites.js    Rider sprites and portraits
tasks/spec.md           The original build spec
tasks/todo.md           Design notes and a review of each build pass
```

### How it fits together

- `js/config.js` is the contract. Tuning lives in `CONFIG`, and the typedefs
  (`Track`, `Input`, `RacerState`, `RaceState`, `RaceEvent`) document every
  field the modules share. To change how the game feels, start there.
- `js/track.js` turns an id into a track: `generateTrack('daily-2026-11-27')`.
  The id is hashed to a seed and every choice comes from that seeded stream in
  a fixed order. A track is pure data and is never changed after it is built.
- `js/race.js` owns the rules: `createRace(track)` returns
  `{ state, step(dt, input), results() }`. `step` always runs at a fixed
  1/60 s. It never touches the DOM, so it can be imported and simulated in
  Node.
- The renderer and the audio module only read that state. `step` adds
  `RaceEvent` items to `state.events`; the game loop passes each one to the
  renderer (particles) and maps it to a sound, then clears the list.
- The renderer draws the static world once into two offscreen canvases (ground
  and tree canopies). Each frame draws those two images plus pickups, riders
  and particles.

### Things to know before changing it

- **A change to the generator changes every track, past and future.** The
  track for a date is only stable while `js/track.js`, `js/rng.js`, the theme
  list and the generation settings in `CONFIG.track` stay the same. Adding a
  theme or a layout family re-deals every day. After a public release, either
  freeze the generator or add a version number to the seed so old days keep
  their old tracks.
- **New files must be added to `PRECACHE` in `sw.js`**, or installed copies
  will not have them offline.
- **Bump the cache name on every release.** The service worker is cache first
  with a background refresh, so players get new files on the launch after the
  one that fetched them. The name is in `sw.js` and in `CONFIG.cacheName`.
  While developing, a hard reload or a private window avoids stale copies.
- Width is local. `track.hw` holds half of the track width at every sample;
  `track.width` is only the nominal value. Race rules and drawing must both
  use `hw`, or what is drawn will not match where the barrier is.
- On a crossover track each rider is tied to their own stretch of the lap by a
  search around their current sample. Do not replace that with a search over
  the whole lap, or riders will jump to the other branch at the crossing.
- The camera tilt is one value, `CONFIG.view.tilt`. Set it to 1 for a flat
  top-down view.
- The characters are Brock the badger, Tod the fox, Bruin the bear and Clover
  the rabbit, in every Trailbadger game.
- The storage key and cache name start with `trailbadger-racer`, the working
  title. Renaming the storage key would wipe players' saved results.

### Checking changes

There is no test suite. Useful quick checks:

```bash
# Syntax check every module
for f in js/*.js js/render/*.js sw.js; do node --check "$f"; done
```

`js/track.js` and `js/race.js` can be driven from a Node script to check the
generator or the balance, for example:

```js
import { generateTrack } from './js/track.js';
import { createRace } from './js/race.js';

const track = generateTrack('daily-2026-11-27');
const race = createRace(track);
const me = race.state.racers[0];
let at = 0;
// A simple test rider: aim at a point a little way ahead on the centreline.
while (race.state.phase !== 'finished' && race.state.time < 600) {
    let best = Infinity;
    for (let k = -8; k <= 30; k++) {
        const i = (at + k + track.n) % track.n;
        const d = (track.px[i] - me.x) ** 2 + (track.py[i] - me.y) ** 2;
        if (d < best) { best = d; at = i; }
    }
    const aim = (at + 7) % track.n;
    let turn = Math.atan2(track.py[aim] - me.y, track.px[aim] - me.x) - me.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    race.step(1 / 60, { steer: Math.max(-1, Math.min(1, turn * 3)), pedal: true, brake: false });
    race.state.events.length = 0;
}
console.log(track.name, track.family, race.results());
```

## Licence

Copyright 2026 Trailbadger.

The code is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md). You are welcome to
download it, play it, fork it and change it for any non-commercial purpose.
Commercial use is not permitted.

Not covered by that licence, and not to be reused in a fork: the Trailbadger
name and logo, the "Track Day Racer" title, and the Brock, Tod, Bruin and
Clover characters. All rights in those are reserved by Trailbadger. See
[NOTICE.md](NOTICE.md) for the details. If you fork the project, give it your
own name, characters and icons.
