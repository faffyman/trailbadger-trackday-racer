// Track Day Racer: shared constants and data shapes.
// This file is the contract between modules. Tune numbers here, not in the modules.
//
// Coordinates: world units ("u"), x to the right, y down (canvas convention).
// Angles: radians, 0 points along +x, positive turns clockwise on screen.
// Track normal: (nx, ny) = (-ty, tx). It points to the RIGHT of the direction of travel.
// A lateral offset is positive to the right of travel and negative to the left.

export const CONFIG = {
    title: 'Track Day Racer',
    storageKey: 'trailbadger-racer',
    cacheName: 'trailbadger-racer-v13',

    world: { w: 1600, h: 900 },
    // Camera tilt: the world is squashed to this share of its height on screen and tall
    // things (trees, berms, riders in the air) are lifted. 1 = flat top-down view.
    view: { tilt: 0.74 },
    fixedDt: 1 / 60,

    // Race length. The player can change it on the home screen; it is saved with the settings.
    laps: { def: 4, min: 2, max: 8 },

    // Track list
    historyDays: 365,
    introTracks: ['intro-1', 'intro-2'],
    dailyPrefix: 'daily-', // followed by YYYY-MM-DD (local date)

    // Track generation
    track: {
        sampleStep: 12,       // target distance between centreline samples
        margin: 46,           // gap kept between the outer track edge and the world edge
        widthIntro: 116,
        widthMin: 104,
        widthMax: 120,
        lapsIntro: 4,
        lapsDaily: 4,
        minRadiusFactor: 0.75,  // min centreline radius of curvature = width * factor
        minGapFactor: 1.4,      // min distance between non-adjacent centreline parts = width * factor
        bermCurvature: 1 / 260, // |curvature| above this counts as a bend
        straightCurvature: 1 / 900
    },

    // Rider physics (units per second)
    phys: {
        maxSpeed: 285,
        accel: 260,
        brake: 520,
        coast: 90,            // deceleration with no pedal
        turnRate: 3.3,        // rad/s at full steer
        turnMinSpeed: 40,     // below this speed the turn rate scales down to zero
        grip: 10,             // 1/s, how fast sideways velocity is removed on dirt
        gripBerm: 13,         // on the outer half of a berm
        bermSpeedBonus: 1.08, // max speed multiplier on a berm
        offroadMax: 200,      // max speed off the track
        offroadDrag: 420,     // deceleration applied above offroadMax
        boostSpeed: 430,
        boostAccel: 900,
        boostTime: 1.6,
        edgeAllow: 14,        // how far past the track edge a rider may go before the barrier
        edgeBounce: 0.35,     // share of the outward speed returned by the barrier
        edgeSlow: 0.92,       // speed multiplier for a barrier hit
        riderRadius: 15,      // collision circle
        riderLength: 64,      // drawn length of bike and rider
        // Jumps
        jumpMinSpeed: 150,    // slower than this: a bump, no air
        jumpVz: 0.65,         // launch vertical speed = speed * jumpVz
        gravity: 520,
        bumpFactor: 0.6,      // speed multiplier for a slow ramp hit or a bad landing
        cleanLandAngle: 0.45, // rad between heading and velocity for a clean landing
        cleanLandBoost: 0.45, // seconds of boost for a clean landing
        // Hazards
        mudTime: 1.3,
        mudMax: 130,
        brambleTime: 0.7,     // no steering, speed cut
        brambleFactor: 0.5
    },

    pickups: {
        radius: 20,
        respawn: 7,           // seconds
        hazardRadius: 26,
        hazardTtl: 10,        // seconds a dropped hazard stays on the track
        hazardDropBack: 34    // dropped this far behind the collector
    },

    countdown: 3,             // seconds before the start

    // Racers. Index 0 is the player. stats multiply CONFIG.phys values.
    // "marker" is the bike and kit colour, also used in the HUD.
    racers: [
        { id: 'brock', name: 'Brock', species: 'badger', fur: '#6f757d', furDark: '#22252a', furLight: '#f4f1e8', marker: '#ffd23f',
          stats: { speed: 1.00, accel: 1.00, grip: 1.00 } },
        { id: 'tod', name: 'Tod', species: 'fox', fur: '#f07a1a', furDark: '#3a2418', furLight: '#fff4e6', marker: '#3fa7ff',
          stats: { speed: 1.00, accel: 1.06, grip: 0.94 }, ai: { skill: 0.97, lookahead: 0.34, lane: 0.10 } },
        { id: 'bruin', name: 'Bruin', species: 'bear', fur: '#7a4a2a', furDark: '#4a2c18', furLight: '#c99a6b', marker: '#ff5a4f',
          stats: { speed: 1.03, accel: 0.88, grip: 1.02 }, ai: { skill: 0.93, lookahead: 0.40, lane: -0.18 } },
        { id: 'clover', name: 'Clover', species: 'rabbit', fur: '#e9e2d6', furDark: '#8d8478', furLight: '#ffffff', marker: '#b57bff',
          stats: { speed: 0.96, accel: 1.18, grip: 1.05 }, ai: { skill: 0.90, lookahead: 0.30, lane: 0.22 } }
    ],

    // Backdrop themes. The generator picks one from the seed, so a track always looks the same.
    // pattern: extra ground detail ('grass', 'rows', 'snow', 'ash', 'hex', 'gravel', 'sand', 'bog').
    // tree: 'round', 'conifer', 'snowpine', 'palm', 'cactus' or 'rock'. bush: 'round' or 'bale'.
    // flowers: colours of the small dots scattered on the ground, with flowerCount of them.
    themes: [
        { key: 'forest', label: 'Forest', pattern: 'grass', tree: 'round', bush: 'round', berry: '#e8473f', flowers: ['#fff4c2', '#ffffff', '#ffd1e6', '#ffe38a'], flowerCount: 160,
          ground: '#3f7d3a', groundAlt: '#356e33', dirt: '#b98a55', dirtDark: '#9a6f41', edge: '#6e4f2c', berm: '#d2a56c', foliage: ['#2c6a2e', '#3c8a3a', '#57a54a'], rock: '#8b8f96' },
        { key: 'autumn', label: 'Autumn wood', pattern: 'grass', tree: 'round', bush: 'round', berry: '#ffd35a', flowers: ['#e08a1e', '#c2571f', '#ffd35a'], flowerCount: 260,
          ground: '#8a7a35', groundAlt: '#7b6c2e', dirt: '#b07a4c', dirtDark: '#8f5f38', edge: '#5e3d22', berm: '#cf9a66', foliage: ['#c2571f', '#e08a1e', '#a63d1c'], rock: '#8d8a84' },
        { key: 'pine', label: 'Pine forest', pattern: 'grass', tree: 'conifer', bush: 'round', berry: '#e8473f', flowers: ['#ffffff', '#d7f0e4'], flowerCount: 110,
          ground: '#2f6455', groundAlt: '#28574a', dirt: '#a58a6a', dirtDark: '#86704f', edge: '#5a4a33', berm: '#c4a882', foliage: ['#1f4a3c', '#2c6350', '#3f7d63'], rock: '#7f8a90' },
        { key: 'heath', label: 'Heather moor', pattern: 'grass', tree: 'round', bush: 'round', berry: '#ffd1e6', flowers: ['#d9a3dc', '#ffffff', '#ffe38a'], flowerCount: 320,
          ground: '#7c8f4a', groundAlt: '#6f8141', dirt: '#d0a468', dirtDark: '#b0854c', edge: '#7a5a30', berm: '#e3bd84', foliage: ['#8a4f8f', '#5f8a3d', '#a56aa8'], rock: '#9a9690' },
        { key: 'gravel', label: 'Gravel quarry', pattern: 'gravel', tree: 'conifer', bush: 'round', berry: '#e8c15a', flowers: [], flowerCount: 0,
          ground: '#8f8a80', groundAlt: '#7d786f', dirt: '#c9b48c', dirtDark: '#a8946e', edge: '#5f574a', berm: '#dcc9a2', foliage: ['#3d5a3a', '#4f6f45', '#6a8358'], rock: '#6f7378' },
        { key: 'farm', label: 'Cornfield farm', pattern: 'rows', tree: 'round', bush: 'bale', berry: '#e8473f', flowers: ['#e23b2e', '#ff5a4f', '#ffffff'], flowerCount: 140,
          ground: '#d2a93c', groundAlt: '#bd9530', dirt: '#a9774a', dirtDark: '#8a5d37', edge: '#5c3d22', berm: '#c9976a', foliage: ['#3f7d3a', '#5a9a44', '#2f6a35'], rock: '#9a958c' },
        { key: 'winter', label: 'Winter snow', pattern: 'snow', tree: 'snowpine', bush: 'round', berry: '#e8473f', flowers: ['#ffffff'], flowerCount: 420,
          ground: '#e6eef4', groundAlt: '#cfdde8', dirt: '#9c8a78', dirtDark: '#7d6d5e', edge: '#f7fbff', berm: '#b7a691', foliage: ['#2f5d50', '#3f7563', '#e9f2f6'], rock: '#8a97a3' },
        { key: 'blossom', label: 'Cherry blossom', pattern: 'grass', tree: 'round', bush: 'round', berry: '#ffffff', flowers: ['#ffc4dc', '#ffe1ee', '#ff9fc4', '#ffffff'], flowerCount: 1100,
          ground: '#6f9a55', groundAlt: '#628b4b', dirt: '#c8a47c', dirtDark: '#a9865f', edge: '#74563a', berm: '#dcbc96', foliage: ['#ff9fc4', '#ffc4dc', '#f77fae'], rock: '#9b9aa0' },
        { key: 'volcano', label: 'Volcano', pattern: 'ash', tree: 'rock', bush: 'round', berry: '#ff7a2a', flowers: ['#ff7a2a', '#ffb347'], flowerCount: 90,
          ground: '#3a3436', groundAlt: '#2c2729', dirt: '#8a6f62', dirtDark: '#6c554a', edge: '#1d191a', berm: '#a88a7a', foliage: ['#4a3a34', '#5c4034', '#7a4a30'], rock: '#55504f' },
        { key: 'causeway', label: 'Causeway coast', pattern: 'hex', tree: 'rock', bush: 'round', berry: '#ffe38a', flowers: ['#ffffff', '#ffe38a'], flowerCount: 120,
          ground: '#5d6468', groundAlt: '#4f8a5a', dirt: '#c7ad84', dirtDark: '#a58c66', edge: '#3b4043', berm: '#dcc49c', foliage: ['#4f8a5a', '#3f7548', '#6aa06a'], rock: '#4b5054' },
        { key: 'beach', label: 'Beach and dunes', pattern: 'sand', sea: true, tree: 'palm', bush: 'round', berry: '#ffffff', flowers: ['#ffffff', '#ffd9c7', '#f2b8a0'], flowerCount: 150,
          ground: '#ead7a0', groundAlt: '#dcc588', dirt: '#b3875c', dirtDark: '#916a43', edge: '#6b4c2e', berm: '#cfa87c', foliage: ['#3f8a4a', '#57a55a', '#7fbf6a'], rock: '#a39a8c' },
        { key: 'desert', label: 'Desert canyon', pattern: 'sand', tree: 'cactus', bush: 'round', berry: '#ff6fa8', flowers: ['#f6e0b0', '#c9703f'], flowerCount: 120,
          ground: '#d58a52', groundAlt: '#c27642', dirt: '#f0d19a', dirtDark: '#d3b077', edge: '#8a4a2a', berm: '#f7dfb2', foliage: ['#5f8a4a', '#7a9a52', '#4f7a44'], rock: '#a8553a' },
        { key: 'bog', label: 'Peat bog', pattern: 'bog', tree: 'rock', bush: 'round', berry: '#ffffff', flowers: ['#ffffff', '#f3f0dc'], flowerCount: 520,
          ground: '#566238', groundAlt: '#48522f', dirt: '#9a7650', dirtDark: '#7a5a3a', edge: '#33291c', berm: '#b8946a', foliage: ['#8a4f8f', '#6f7a3a', '#a56aa8'], rock: '#8f9296' },
        { key: 'night', label: 'Night ride', pattern: 'grass', tree: 'round', bush: 'round', berry: '#ffe98a', flowers: ['#fff3a0', '#ffe066', '#d8ffb0'], flowerCount: 240, glow: true,
          ground: '#1d3440', groundAlt: '#172a35', dirt: '#6d7488', dirtDark: '#555b6e', edge: '#ffe9a8', berm: '#8a90a4', foliage: ['#16303a', '#1f4450', '#2a5a66'], rock: '#4f5a66' },
        { key: 'bluebell', label: 'Bluebell wood', pattern: 'grass', tree: 'round', bush: 'round', berry: '#ffffff', flowers: ['#7d7dff', '#9a8cff', '#6a6af0', '#b9adff'], flowerCount: 3600, flowerSize: 2,
          ground: '#4f8a45', groundAlt: '#437a3c', dirt: '#b99062', dirtDark: '#98724a', edge: '#6b4d2e', berm: '#d2ab7c', foliage: ['#4a9a3f', '#66b24f', '#8aca63'], rock: '#8b8f96' },
        { key: 'slate', label: 'Slate mine', pattern: 'gravel', pebbles: ['#7f8b98', '#3f4852', '#9aa6b2', '#2f363e'], tree: 'conifer', bush: 'round', berry: '#e8c15a', flowers: [], flowerCount: 0,
          ground: '#5a6470', groundAlt: '#4a535e', dirt: '#b7a78c', dirtDark: '#96876e', edge: '#2f353c', berm: '#cdbd9f', foliage: ['#2f4f3f', '#3f6350', '#557a63'], rock: '#3f4750' }
    ]
};

/**
 * @typedef {Object} Track  Pure data, produced by generateTrack(id) in track.js. Never mutated.
 * @property {string} id            'intro-1', 'intro-2' or 'daily-YYYY-MM-DD'
 * @property {'intro'|'daily'} kind
 * @property {number} seed          uint32 derived from the id
 * @property {string} name          display name, for example "Bracken Hollow"
 * @property {number} laps
 * @property {number} aiPace        multiplier for AI max speed (intro-1 0.80, intro-2 0.90, daily 0.95 to 1.02)
 * @property {Object} theme         one entry of CONFIG.themes
 * @property {number} width         nominal full track width (the local width varies, see hw)
 * @property {Float32Array} hw    half of the local track width at each sample
 * @property {string} family       layout family, for example 'ring', 'comb', 'snake', 'side'
 * @property {number} n             number of centreline samples
 * @property {number} length        lap length in units
 * @property {number} step          length / n
 * @property {Float32Array} px      centreline x, evenly spaced by arc length, in the direction of travel
 * @property {Float32Array} py
 * @property {Float32Array} tx      unit tangent (direction of travel)
 * @property {Float32Array} ty
 * @property {Float32Array} nx      unit normal to the right of travel: (-ty, tx)
 * @property {Float32Array} ny
 * @property {Float32Array} curv    signed curvature in 1/u, positive = bend to the right (clockwise on screen)
 * @property {{from:number,to:number,side:number}[]} berms  sample range with from < to (never wraps index 0);
 *                                  side is the OUTER side of the bend: +1 right of travel, -1 left
 * @property {{a:number,b:number}|null} cross  the two samples where the lap crosses its own path, or null
 * @property {{i:number,over?:boolean}[]} jumps   ramp lip at sample i, across the full width; over = the ramp
 *                                  that carries riders across the crossing
 * @property {{i:number,off:number,type:'boost'|'mud'|'bramble'}[]} pickupSpots  off = lateral offset in units
 * @property {{x:number,y:number,r:number,type:'tree'|'bush'|'rock',v:number}[]} decor  v = 0..1 variant value
 * @property {{x:number,y:number,angle:number}[]} grid  4 start slots behind sample 0, slot 0 at the front
 */

/**
 * @typedef {Object} Input
 * @property {number} steer   -1 (left) to 1 (right), relative to the rider
 * @property {boolean} pedal
 * @property {boolean} brake
 */

/**
 * @typedef {Object} RacerState  One per racer in race.state.racers, same order as CONFIG.racers.
 * @property {string} id
 * @property {boolean} isPlayer
 * @property {number} x
 * @property {number} y
 * @property {number} angle       heading
 * @property {number} vx
 * @property {number} vy
 * @property {number} speed       length of (vx, vy)
 * @property {number} z           height above the ground, 0 on the ground
 * @property {boolean} air
 * @property {number} steer       current steer -1..1 (for the lean animation)
 * @property {number} pedalPhase  radians, advances with distance ridden (for the leg animation)
 * @property {number} boost       seconds of boost left
 * @property {number} mud         seconds of mud slow left
 * @property {number} bramble     seconds of bramble spin left
 * @property {boolean} offroad
 * @property {boolean} onBerm
 * @property {number} lap         laps completed, 0 at the start
 * @property {number} progress    laps completed + fraction of the current lap
 * @property {number} place       1..4
 * @property {boolean} wrongWay
 * @property {boolean} finished
 * @property {number|null} finishTime  seconds
 * @property {number|null} bestLap     seconds
 * @property {number|null} lastLap     seconds
 */

/**
 * @typedef {Object} RaceState
 * @property {'countdown'|'racing'|'finished'} phase   'finished' when the player crosses the line on the last lap
 * @property {number} countdown   seconds left before the start, 0 after it
 * @property {number} time        seconds since the start
 * @property {RacerState[]} racers
 * @property {{x:number,y:number,type:string,active:boolean}[]} pickups  same order as track.pickupSpots
 * @property {{x:number,y:number,type:'mud'|'bramble',r:number,ttl:number,owner:number}[]} hazards
 * @property {RaceEvent[]} events  appended by step(); the caller reads them and sets length = 0
 */

/**
 * @typedef {Object} RaceEvent
 * @property {'count'|'go'|'pickup'|'boost'|'drop'|'mud'|'bramble'|'jump'|'land'|'bump'|'lap'|'finish'} type
 * @property {number} racer   racer index, -1 for count and go
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [value] count: the number shown (3, 2, 1); land: 1 for clean, 0 for rough; lap: the lap time
 */
