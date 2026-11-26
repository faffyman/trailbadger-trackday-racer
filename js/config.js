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
    cacheName: 'trailbadger-racer-v5',

    world: { w: 1600, h: 900 },
    fixedDt: 1 / 60,

    // Track list
    historyDays: 30,
    introTracks: ['intro-1', 'intro-2'],
    dailyPrefix: 'daily-', // followed by YYYY-MM-DD (local date)

    // Track generation
    track: {
        sampleStep: 12,       // target distance between centreline samples
        margin: 46,           // gap kept between the outer track edge and the world edge
        widthIntro: 116,
        widthMin: 96,
        widthMax: 110,
        lapsIntro: 6,
        lapsDaily: 6,
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

    // Colour themes. The generator picks one from the seed.
    themes: [
        { key: 'forest', ground: '#3f7d3a', groundAlt: '#356e33', dirt: '#b98a55', dirtDark: '#9a6f41', edge: '#6e4f2c', berm: '#d2a56c', foliage: ['#2c6a2e', '#3c8a3a', '#57a54a'], rock: '#8b8f96' },
        { key: 'autumn', ground: '#8a7a35', groundAlt: '#7b6c2e', dirt: '#b07a4c', dirtDark: '#8f5f38', edge: '#5e3d22', berm: '#cf9a66', foliage: ['#c2571f', '#e08a1e', '#a63d1c'], rock: '#8d8a84' },
        { key: 'pine', ground: '#2f6455', groundAlt: '#28574a', dirt: '#a58a6a', dirtDark: '#86704f', edge: '#5a4a33', berm: '#c4a882', foliage: ['#1f4a3c', '#2c6350', '#3f7d63'], rock: '#7f8a90' },
        { key: 'heath', ground: '#7c8f4a', groundAlt: '#6f8141', dirt: '#d0a468', dirtDark: '#b0854c', edge: '#7a5a30', berm: '#e3bd84', foliage: ['#8a4f8f', '#5f8a3d', '#a56aa8'], rock: '#9a9690' }
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
 * @property {number} width         full track width
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
 * @property {{i:number}[]} jumps   ramp lip at sample i, across the full width
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
