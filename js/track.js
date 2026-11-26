// Track generator and track list. Pure module, no DOM access.
//
// Nothing is stored. The id is hashed to a seed and every property of the track comes from
// seeded random streams drawn in a fixed order, so the same id gives the same track on any
// device. generateTrack never calls Math.random and never reads the clock.

import { CONFIG } from './config.js';
import { hashString, makeRng } from './rng.js';

const TAU = Math.PI * 2;
const MAX_TRIES = 40;
const DENSE = 360;          // points on the raw closed curve before resampling
const RELAX_LIMIT = 0.8;    // corners are rounded off beyond this fraction of the tightest allowed curvature
const MIN_START_RUN = 22;
const FAMILIES = ['ring', 'comb', 'comb2', 'snake', 'side', 'cross', 'tee', 'step', 'curl'];
const CROSS_ZONE = 15;       // samples each side of a crossing where the two branches share ground   // samples of near-straight track needed around the start line

const NAME_A = ['Bracken', 'Conker', 'Hazel', 'Fernwood', 'Acorn', 'Thistle', 'Mossy', 'Bramble',
    'Willow', 'Ember', 'Foxglove', 'Dappled', 'Hawthorn', 'Sorrel', 'Mistle', 'Birch'];
const NAME_B = ['Hollow', 'Switchback', 'Loop', 'Ridge', 'Run', 'Descent', 'Gully', 'Twister',
    'Trail', 'Scramble', 'Dingle', 'Rollers', 'Clearing', 'Burn', 'Heath', 'Crossing'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------------------
// Track list helpers

function pad2(v) {
    return v < 10 ? '0' + v : String(v);
}

function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/** Id of the daily track for the LOCAL calendar date. */
export function dailyId(date = new Date()) {
    return CONFIG.dailyPrefix + dateKey(date);
}

/** The intro tracks and the daily history, today first. */
export function listTracks(today = new Date()) {
    const intro = CONFIG.introTracks.map((id, i) => ({ id, label: 'Intro ' + (i + 1) }));
    const daily = [];
    for (let k = 0; k < CONFIG.historyDays; k++) {
        // Build from the calendar parts so a daylight saving change cannot skip or repeat a day.
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k);
        let label;
        if (k === 0) {
            label = 'Today';
        } else if (k === 1) {
            label = 'Yesterday';
        } else {
            label = d.getDate() + ' ' + MONTHS[d.getMonth()];
        }
        daily.push({ id: dailyId(d), label, date: dateKey(d) });
    }
    return { intro, daily };
}

// ---------------------------------------------------------------------------------------
// Profiles

// Settings that differ between intro-1, intro-2 and the daily tracks.
function makeProfile(id, base) {
    const t = CONFIG.track;
    // Fixed draw order from the base stream, whatever the kind.
    const dirRoll = base();
    const themeRoll = base();
    const nameA = base();
    const nameB = base();
    const widthRoll = base();
    const paceRoll = base();
    const kRoll = base();
    const countRoll = base();

    const profile = {
        id,
        kind: 'daily',
        reverse: dirRoll < 0.5,
        theme: CONFIG.themes[Math.floor(themeRoll * CONFIG.themes.length)],
        name: NAME_A[Math.floor(nameA * NAME_A.length)] + ' ' + NAME_B[Math.floor(nameB * NAME_B.length)],
        width: Math.round(t.widthMin + widthRoll * (t.widthMax - t.widthMin)),
        aiPace: 0.95 + paceRoll * 0.07,
        laps: t.lapsDaily,
        kMax: 4 + Math.floor(kRoll * 3),
        amp: 0.4,
        falloff: 1.5,
        warp: 0.3,
        jumps: 1 + Math.floor(countRoll * 3),
        berms: 2 + Math.floor(base() * 3),
        pickups: 5 + Math.floor(base() * 3),
        pickupKinds: null,
        features: 3 + Math.floor(kRoll * 3),
        method: 'features',
        lively: true,
        varyWidth: true,
        family: 'ring'
    };
    // Layout family. The ring is the original rounded rectangle with dents; the others are
    // folded outlines that reach into the middle of the screen.
    profile.family = FAMILIES[Math.floor(base() * FAMILIES.length)];
    if (profile.family !== 'ring') profile.method = 'outline';
    // Three hairpins share the screen height in the side layout, so it cannot be very wide.
    if (profile.family === 'side') profile.width = Math.min(profile.width, 110);

    if (id === 'intro-1') {
        profile.kind = 'intro';
        profile.name = 'First Ride';
        profile.theme = CONFIG.themes.find((th) => th.key === 'forest');
        profile.width = t.widthIntro;
        profile.aiPace = 0.80;
        profile.laps = t.lapsIntro;
        profile.kMax = 2;
        profile.amp = 0.1;
        profile.falloff = 0;
        profile.warp = 0.08;
        profile.jumps = 1;
        profile.berms = 1 + Math.floor(countRoll * 2);
        profile.pickups = 5;
        profile.pickupKinds = ['boost', 'boost', 'boost', 'boost', 'boost'];
        profile.method = 'polar';
        profile.lively = false;
        profile.varyWidth = false;
        profile.family = 'oval';
    } else if (id === 'intro-2') {
        profile.kind = 'intro';
        profile.name = 'Acorn Twister';
        profile.theme = CONFIG.themes.find((th) => th.key === 'autumn');
        profile.width = t.widthIntro;
        profile.aiPace = 0.90;
        profile.laps = t.lapsIntro;
        profile.kMax = 3;
        profile.amp = 0.13;
        profile.falloff = 0.3;
        profile.warp = 0.14;
        profile.jumps = 2;
        profile.berms = 2;
        profile.pickups = 6;
        profile.pickupKinds = ['boost', 'boost', 'boost', 'boost', 'mud', 'bramble'];
        profile.method = 'polar';
        profile.lively = false;
        profile.varyWidth = false;
        profile.family = 'oval';
    }
    return profile;
}

// ---------------------------------------------------------------------------------------
// Geometry

function wrapPi(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
}

/** Raw closed curve, scaled so the centreline fills the world box minus margin and half width. */
function fitToWorld(xs, ys, width) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < xs.length; i++) {
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
    }
    const inset = CONFIG.track.margin + width / 2;
    const bx0 = inset;
    const bx1 = CONFIG.world.w - inset;
    const by0 = inset;
    const by1 = CONFIG.world.h - inset;
    const sx = (bx1 - bx0) / (maxX - minX);
    const sy = (by1 - by0) / (maxY - minY);
    for (let i = 0; i < xs.length; i++) {
        xs[i] = bx0 + (xs[i] - minX) * sx;
        ys[i] = by0 + (ys[i] - minY) * sy;
    }
}

/**
 * Round off corners that are tighter than the limit. Points on a too-sharp bend (and their
 * neighbours) move to the middle of their neighbours until the bend is wide enough.
 */
function relaxCorners(xs, ys, limit) {
    const m = xs.length;
    const limit2 = limit * limit;
    for (let pass = 0; pass < 200; pass++) {
        let any = false;
        for (let i = 0; i < m; i++) {
            const a = i === 0 ? m - 1 : i - 1;
            const b = i === m - 1 ? 0 : i + 1;
            const ux = xs[i] - xs[a];
            const uy = ys[i] - ys[a];
            const vx = xs[b] - xs[i];
            const vy = ys[b] - ys[i];
            const wx = xs[b] - xs[a];
            const wy = ys[b] - ys[a];
            const cross = ux * vy - uy * vx;
            const den = (ux * ux + uy * uy) * (vx * vx + vy * vy) * (wx * wx + wy * wy);
            if (den > 0 && (4 * cross * cross) / den > limit2) {
                xs[i] = (xs[a] + xs[b]) * 0.5;
                ys[i] = (ys[a] + ys[b]) * 0.5;
                any = true;
            }
        }
        if (!any) break;
    }
}

function polarCurve(rng, profile, ampScale) {
    const xs = new Float64Array(DENSE);
    const ys = new Float64Array(DENSE);
    const amps = [];
    const phases = [];
    for (let k = 2; k <= profile.kMax; k++) {
        amps[k] = profile.amp * ampScale * (0.45 + 0.55 * rng()) / Math.pow(k / 2, profile.falloff);
        phases[k] = rng() * TAU;
    }
    const warpAmp = profile.warp * ampScale * (0.4 + 0.6 * rng());
    const warpPhase = rng() * TAU;
    for (let i = 0; i < DENSE; i++) {
        const a = (i / DENSE) * TAU;
        let r = 1;
        for (let k = 2; k <= profile.kMax; k++) {
            r += amps[k] * Math.sin(k * a + phases[k]);
        }
        if (r < 0.2) r = 0.2;
        const ap = a + warpAmp * Math.sin(a + warpPhase);
        xs[i] = r * Math.cos(ap);
        ys[i] = r * Math.sin(ap);
    }
    fitToWorld(xs, ys, profile.width);
    relaxCorners(xs, ys, RELAX_LIMIT / (profile.width * CONFIG.track.minRadiusFactor));
    fitToWorld(xs, ys, profile.width);
    return { xs, ys };
}

/**
 * Daily shape: a rounded rectangle with a few seeded features bent into it. A dent pushes
 * part of the lap far into the infield (hairpins and tongues), a chicane swings the line left
 * and right, and a sweeper leans it in gently. Polar harmonics alone only give lumpy ovals.
 */
function featureCurve(rng, profile, ampScale) {
    const inset = CONFIG.track.margin + profile.width / 2;
    const a = (CONFIG.world.w - 2 * inset) / 2;
    const b = (CONFIG.world.h - 2 * inset) / 2;
    const power = 2.4 + rng() * 1.2;
    const bx = new Float64Array(DENSE);
    const by = new Float64Array(DENSE);
    const e = 2 / power;
    for (let i = 0; i < DENSE; i++) {
        const t = (i / DENSE) * TAU;
        const c = Math.cos(t);
        const s = Math.sin(t);
        bx[i] = a * Math.sign(c) * Math.pow(Math.abs(c), e);
        by[i] = b * Math.sign(s) * Math.pow(Math.abs(s), e);
    }
    // Arc position of each base point.
    const arc = new Float64Array(DENSE + 1);
    for (let i = 0; i < DENSE; i++) {
        const j = (i + 1) % DENSE;
        arc[i + 1] = arc[i] + Math.hypot(bx[j] - bx[i], by[j] - by[i]);
    }
    const lap = arc[DENSE];

    const count = profile.features;
    const feats = [];
    for (let k = 0; k < count; k++) {
        const roll = rng();
        feats.push({
            at: ((k + 0.15 + 0.7 * rng()) / count) * lap,
            kind: roll < 0.5 ? 'dent' : (roll < 0.8 ? 'chicane' : 'sweep'),
            size: rng(),
            sign: rng() < 0.5 ? 1 : -1
        });
    }

    const xs = new Float64Array(DENSE);
    const ys = new Float64Array(DENSE);
    for (let i = 0; i < DENSE; i++) {
        const p = (i + DENSE - 1) % DENSE;
        const q = (i + 1) % DENSE;
        let tx = bx[q] - bx[p];
        let ty = by[q] - by[p];
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        let nx = -ty;
        let ny = tx;
        if (nx * -bx[i] + ny * -by[i] < 0) {
            nx = -nx;
            ny = -ny;
        }
        let shift = 0; // positive moves toward the infield
        for (const f of feats) {
            let dd = arc[i] - f.at;
            if (dd > lap / 2) dd -= lap;
            if (dd < -lap / 2) dd += lap;
            if (f.kind === 'dent') {
                const depth = (170 + 250 * f.size) * ampScale;
                const half = 80 + 90 * (1 - f.size) + 40 * f.size;
                shift += depth * Math.exp(-Math.pow(Math.abs(dd) / half, 3));
            } else if (f.kind === 'chicane') {
                const period = 340 + 140 * f.size;
                const reach = period * 0.75;
                if (Math.abs(dd) < reach) {
                    const w = Math.cos((Math.PI * dd) / (2 * reach));
                    shift += f.sign * (70 + 50 * f.size) * ampScale * Math.sin((TAU * dd) / period) * w * w;
                }
            } else {
                shift += (60 + 70 * f.size) * ampScale * Math.exp(-Math.pow(Math.abs(dd) / 260, 2));
            }
        }
        xs[i] = bx[i] + nx * shift;
        ys[i] = by[i] + ny * shift;
    }
    fitToWorld(xs, ys, profile.width);
    relaxCorners(xs, ys, RELAX_LIMIT / (profile.width * CONFIG.track.minRadiusFactor));
    fitToWorld(xs, ys, profile.width);
    return { xs, ys };
}

/**
 * Corner points of a folded outline in unit square coordinates (clockwise on screen).
 * `s` shrinks the folds on later tries so that a valid shape is always found.
 */
function familyOutline(family, rng, s) {
    const j = (v, a) => v + (rng() * 2 - 1) * a;
    const deep = (lo, hi) => (lo + (hi - lo) * rng()) * (0.6 + 0.4 * s);
    if (family === 'comb') {
        // One tongue of infield pushed up from the bottom edge.
        const a = j(0.39, 0.04);
        const b = j(0.61, 0.04);
        const d = deep(0.5, 0.7);
        return [[0, 0], [1, 0], [1, 1], [b, 1], [b, 1 - d], [a, 1 - d], [a, 1], [0, 1]];
    }
    if (family === 'comb2') {
        // Two tongues from the bottom: five parallel legs.
        const a1 = j(0.2, 0.025);
        const b1 = j(0.4, 0.025);
        const a2 = j(0.6, 0.025);
        const b2 = j(0.8, 0.025);
        const d1 = deep(0.45, 0.7);
        const d2 = deep(0.45, 0.7);
        return [[0, 0], [1, 0], [1, 1], [b2, 1], [b2, 1 - d2], [a2, 1 - d2], [a2, 1],
            [b1, 1], [b1, 1 - d1], [a1, 1 - d1], [a1, 1], [0, 1]];
    }
    if (family === 'snake') {
        // One tongue from the top and one from the bottom: a serpentine.
        const a1 = j(0.2, 0.025);
        const b1 = j(0.4, 0.025);
        const a2 = j(0.6, 0.025);
        const b2 = j(0.8, 0.025);
        const d1 = deep(0.48, 0.7);
        const d2 = deep(0.48, 0.7);
        return [[0, 0], [a1, 0], [a1, d1], [b1, d1], [b1, 0], [1, 0], [1, 1],
            [b2, 1], [b2, 1 - d2], [a2, 1 - d2], [a2, 1], [0, 1]];
    }
    if (family === 'side') {
        // A long tongue from the right edge: three long parallel straights.
        const a = j(0.333, 0.008);
        const b = j(0.667, 0.008);
        const d = deep(0.55, 0.8);
        return [[0, 0], [1, 0], [1, a], [1 - d, a], [1 - d, b], [1, b], [1, 1], [0, 1]];
    }
    if (family === 'cross') {
        // A plus shape: four arms, each one a hairpin.
        const a = j(0.3, 0.02);
        const b = j(0.7, 0.02);
        const c = j(0.3, 0.02);
        const d = j(0.7, 0.02);
        return [[a, 0], [b, 0], [b, c], [1, c], [1, d], [b, d], [b, 1], [a, 1], [a, d], [0, d], [0, c], [a, c]];
    }
    if (family === 'tee') {
        const a = j(0.33, 0.03);
        const b = j(0.67, 0.03);
        const c = j(0.5, 0.05);
        return [[0, 0], [1, 0], [1, c], [b, c], [b, 1], [a, 1], [a, c], [0, c]];
    }
    if (family === 'curl') {
        // The lap curls into an inner loop and crosses its own path once, at a right angle.
        const x1 = j(0.3, 0.02);
        const x2 = j(0.66, 0.02);
        const y1 = j(0.335, 0.008);
        const y2 = j(0.665, 0.008);
        return [[0, 0], [1, 0], [1, 1], [x1, 1], [x1, y1], [x2, y1], [x2, y2], [0, y2]];
    }
    // step: two offset blocks joined in the middle
    const u1 = j(0.6, 0.03);
    const u2 = j(0.4, 0.03);
    const v1 = j(0.44, 0.02);
    const v2 = j(0.56, 0.02);
    return [[0, 0], [u1, 0], [u1, v1], [1, v1], [1, 1], [u2, 1], [u2, v2], [0, v2]];
}

/**
 * Daily shape from a folded outline: take the corner points of the family, mirror and nudge
 * them from the seed, add a kink to some long edges, then round everything off by repeated
 * neighbour averaging. The result reaches into the middle of the screen with hairpins and
 * long parallel straights.
 */
function outlineCurve(rng, profile, ampScale) {
    const inset = CONFIG.track.margin + profile.width / 2;
    const bw = CONFIG.world.w - 2 * inset;
    const bh = CONFIG.world.h - 2 * inset;
    const pts = familyOutline(profile.family, rng, ampScale);
    const flipX = rng() < 0.5;
    const flipY = rng() < 0.5;
    const sigma = profile.family === 'curl' ? 60 + 8 * rng() : 62 + 24 * rng();
    const corners = [];
    for (const p of pts) {
        const u = (flipX ? 1 - p[0] : p[0]) + (rng() * 2 - 1) * 0.012 * ampScale;
        const v = (flipY ? 1 - p[1] : p[1]) + (rng() * 2 - 1) * 0.016 * ampScale;
        corners.push([inset + u * bw, inset + v * bh]);
    }
    // Kinks on long edges.
    const poly = [];
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        poly.push(a);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const roll = rng();
        const at = 0.35 + 0.3 * rng();
        const push = (35 + 45 * rng()) * ampScale * (rng() < 0.5 ? -1 : 1);
        if (len > 520 && roll < 0.45 && profile.family !== 'curl') {
            const ex = (b[0] - a[0]) / len;
            const ey = (b[1] - a[1]) / len;
            poly.push([a[0] + (b[0] - a[0]) * at - ey * push, a[1] + (b[1] - a[1]) * at + ex * push]);
        }
    }
    // Dense polyline, about 8 units between points.
    const dx = [];
    const dy = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const parts = Math.max(1, Math.round(len / 8));
        for (let k = 0; k < parts; k++) {
            dx.push(a[0] + ((b[0] - a[0]) * k) / parts);
            dy.push(a[1] + ((b[1] - a[1]) * k) / parts);
        }
    }
    let xs = Float64Array.from(dx);
    let ys = Float64Array.from(dy);
    const m = xs.length;
    // Each pass of the (1/4, 1/2, 1/4) average adds 32 square units of blur at this spacing.
    const passes = Math.round((sigma * sigma) / 32);
    let nx2 = new Float64Array(m);
    let ny2 = new Float64Array(m);
    for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < m; i++) {
            const a = i === 0 ? m - 1 : i - 1;
            const b = i === m - 1 ? 0 : i + 1;
            nx2[i] = 0.25 * xs[a] + 0.5 * xs[i] + 0.25 * xs[b];
            ny2[i] = 0.25 * ys[a] + 0.5 * ys[i] + 0.25 * ys[b];
        }
        let t = xs; xs = nx2; nx2 = t;
        t = ys; ys = ny2; ny2 = t;
    }
    fitToWorld(xs, ys, profile.width);
    relaxCorners(xs, ys, RELAX_LIMIT / (profile.width * CONFIG.track.minRadiusFactor));
    fitToWorld(xs, ys, profile.width);
    return { xs, ys };
}

function ellipseCurve(profile) {
    const xs = new Float64Array(DENSE);
    const ys = new Float64Array(DENSE);
    for (let i = 0; i < DENSE; i++) {
        const a = (i / DENSE) * TAU;
        xs[i] = Math.cos(a);
        ys[i] = Math.sin(a);
    }
    fitToWorld(xs, ys, profile.width);
    return { xs, ys };
}

/** Resample a closed polyline to n points evenly spaced by arc length. */
function resample(xs, ys) {
    const m = xs.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        cum[i + 1] = cum[i] + Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
    }
    const length = cum[m];
    const n = Math.max(16, Math.round(length / CONFIG.track.sampleStep));
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    let seg = 0;
    for (let j = 0; j < n; j++) {
        const s = (j * length) / n;
        while (seg < m - 1 && cum[seg + 1] < s) seg++;
        const k = (seg + 1) % m;
        const span = cum[seg + 1] - cum[seg];
        const f = span > 0 ? (s - cum[seg]) / span : 0;
        px[j] = xs[seg] + (xs[k] - xs[seg]) * f;
        py[j] = ys[seg] + (ys[k] - ys[seg]) * f;
    }
    return { px, py, n, length };
}

function reverseInPlace(arr) {
    arr.reverse();
}

/** Tangents, right-hand normals and smoothed signed curvature of a closed, evenly spaced loop. */
function differentiate(px, py, n, step) {
    const tx = new Float64Array(n);
    const ty = new Float64Array(n);
    const theta = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n;
        const b = (i + 1) % n;
        const dx = px[b] - px[a];
        const dy = py[b] - py[a];
        const len = Math.hypot(dx, dy) || 1;
        tx[i] = dx / len;
        ty[i] = dy / len;
        theta[i] = Math.atan2(ty[i], tx[i]);
    }
    let curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n;
        const b = (i + 1) % n;
        curv[i] = wrapPi(theta[b] - theta[a]) / (2 * step);
    }
    for (let pass = 0; pass < 3; pass++) {
        const next = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            next[i] = 0.25 * curv[(i + n - 1) % n] + 0.5 * curv[i] + 0.25 * curv[(i + 1) % n];
        }
        curv = next;
    }
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        nx[i] = -ty[i];
        ny[i] = tx[i];
    }
    return { tx, ty, nx, ny, curv };
}

function circDist(a, b, n) {
    const d = Math.abs(a - b) % n;
    return Math.min(d, n - d);
}

/**
 * Places where the closed centreline crosses itself. Each entry has the two sample indices
 * (a < b) and the cosine of the angle between the branches.
 */
function findCrossings(px, py, tx, ty, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        const ax = px[i];
        const ay = py[i];
        const bx = px[i2] - ax;
        const by = py[i2] - ay;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const j2 = (j + 1) % n;
            const cx = px[j];
            const cy = py[j];
            const dx = px[j2] - cx;
            const dy = py[j2] - cy;
            const den = bx * dy - by * dx;
            if (den === 0) continue;
            const s = ((cx - ax) * dy - (cy - ay) * dx) / den;
            const u = ((cx - ax) * by - (cy - ay) * bx) / den;
            if (s >= 0 && s < 1 && u >= 0 && u < 1) {
                out.push({ a: i, b: j, cos: Math.abs(tx[i] * tx[j] + ty[i] * ty[j]) });
            }
        }
    }
    return out;
}

function inCrossZone(cross, i, j, n, zone) {
    if (!cross) return false;
    return (circDist(i, cross.a, n) <= zone && circDist(j, cross.b, n) <= zone) ||
        (circDist(i, cross.b, n) <= zone && circDist(j, cross.a, n) <= zone);
}

/** True when no two far-apart parts of the lap come closer than the gap limit. */
function gapsOk(px, py, n, step, width, cross) {
    const minGap = width * CONFIG.track.minGapFactor * 1.005;
    const minGap2 = minGap * minGap;
    const skip = Math.ceil((3 * width) / step);
    for (let i = 0; i < n; i++) {
        const xi = px[i];
        const yi = py[i];
        for (let j = i + skip + 1; j < n; j++) {
            if (circDist(i, j, n) <= skip) continue;
            if (inCrossZone(cross, i, j, n, CROSS_ZONE)) continue;
            const dx = px[j] - xi;
            const dy = py[j] - yi;
            if (dx * dx + dy * dy < minGap2) return false;
        }
    }
    return true;
}

/** Runs (circular) of samples whose |curvature| is below a limit. Returns per-sample run info. */
function straightRuns(curv, n, limit) {
    const ok = new Uint8Array(n);
    let anyBend = false;
    for (let i = 0; i < n; i++) {
        ok[i] = Math.abs(curv[i]) < limit ? 1 : 0;
        if (!ok[i]) anyBend = true;
    }
    const runLen = new Int32Array(n);
    const before = new Int32Array(n); // straight samples at and before i within the run
    const after = new Int32Array(n);  // straight samples at and after i within the run
    if (!anyBend) {
        runLen.fill(n);
        before.fill(n);
        after.fill(n);
        return { ok, runLen, before, after, longest: n, centre: 0 };
    }
    // Start the scan just after a bend so no run is split by the array end.
    let first = 0;
    while (ok[first]) first++;
    let longest = 0;
    let centre = 0;
    let i = 0;
    while (i < n) {
        const idx = (first + i) % n;
        if (!ok[idx]) {
            i++;
            continue;
        }
        let len = 0;
        while (i + len < n && ok[(first + i + len) % n]) len++;
        for (let k = 0; k < len; k++) {
            const q = (first + i + k) % n;
            runLen[q] = len;
            before[q] = k + 1;
            after[q] = len - k;
        }
        if (len > longest) {
            longest = len;
            centre = (first + i + Math.floor(len / 2)) % n;
        }
        i += len;
    }
    return { ok, runLen, before, after, longest, centre };
}

/** Rotate the sample order so that index `shift` becomes index 0. */
function rotate(arr, shift) {
    const n = arr.length;
    const out = new arr.constructor(n);
    for (let i = 0; i < n; i++) out[i] = arr[(i + shift) % n];
    return out;
}

/**
 * Build and validate the centreline for one try. Returns null when a rule fails.
 * `lively` profiles (dailies) must also have enough bends of both hands to be fun.
 */
function buildCentreline(curve, profile) {
    const { px: rx, py: ry, n, length } = resample(curve.xs, curve.ys);
    const step = length / n;
    if (length < 2800 || length > 6500) return null;
    if (profile.reverse) {
        reverseInPlace(rx);
        reverseInPlace(ry);
    }
    const d = differentiate(rx, ry, n, step);

    // Minimum radius of curvature.
    const maxCurv = 1 / (profile.width * CONFIG.track.minRadiusFactor * 1.005);
    for (let i = 0; i < n; i++) {
        if (Math.abs(d.curv[i]) > maxCurv) return null;
    }
    // A crossing layout must cross itself exactly once, squarely, with the two visits far
    // apart along the lap. Every other layout must not cross itself at all.
    const crossings = findCrossings(rx, ry, d.tx, d.ty, n);
    let cross = null;
    if (profile.family === 'curl') {
        if (crossings.length !== 1) return null;
        cross = crossings[0];
        if (cross.cos > 0.3 || circDist(cross.a, cross.b, n) < n * 0.2) return null;
    } else if (crossings.length) {
        return null;
    }
    if (!gapsOk(rx, ry, n, step, profile.width, cross)) return null;

    // A clear straight for the start, then rotate so it is centred on sample 0.
    // The start line stays well away from a crossing.
    let startCurv = d.curv;
    if (cross) {
        startCurv = Float64Array.from(d.curv);
        for (let i = 0; i < n; i++) {
            if (circDist(i, cross.a, n) < 34 || circDist(i, cross.b, n) < 34) startCurv[i] = 1;
        }
    }
    const startRuns = straightRuns(startCurv, n, CONFIG.track.straightCurvature * 1.5);
    if (startRuns.longest < MIN_START_RUN) return null;
    const shift = startRuns.centre;

    const out = {
        n,
        length,
        step,
        px: rotate(rx, shift),
        py: rotate(ry, shift),
        tx: rotate(d.tx, shift),
        ty: rotate(d.ty, shift),
        nx: rotate(d.nx, shift),
        ny: rotate(d.ny, shift),
        curv: rotate(d.curv, shift),
        cross: null
    };
    if (cross) {
        const a = (cross.a - shift + n) % n;
        const b = (cross.b - shift + n) % n;
        out.cross = { a: Math.min(a, b), b: Math.max(a, b) };
    }

    if (profile.lively) {
        // Dull tracks (a smooth oval, or bends all one way) are rejected.
        let left = 0;
        let right = 0;
        let bends = 0;
        let tight = 0;
        let i = 0;
        const limit = CONFIG.track.bermCurvature;
        while (i < n) {
            if (Math.abs(out.curv[i]) > limit) {
                const sign = out.curv[i] > 0 ? 1 : -1;
                let len = 0;
                let peak = 0;
                while (i + len < n && Math.abs(out.curv[i + len]) > limit && (out.curv[i + len] > 0 ? 1 : -1) === sign) {
                    peak = Math.max(peak, Math.abs(out.curv[i + len]));
                    len++;
                }
                if (len >= 6) {
                    bends++;
                    if (sign > 0) right++; else left++;
                    if (peak > 1 / (profile.width * 1.3)) tight++;
                }
                i += len;
            } else {
                i++;
            }
        }
        let turning = 0;
        for (let k = 0; k < n; k++) turning += Math.abs(out.curv[k]) * step;
        // A crossing layout winds twice the same way, so it has bends of one hand only.
        const oneHand = left < 1 || right < 1;
        if (bends < 4 || (oneHand && !out.cross) || tight < 1 || turning < TAU * 1.8) return null;
    }
    return out;
}

// ---------------------------------------------------------------------------------------
// Features

function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
}

function shuffle(rng, list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
    }
    return list;
}

/** Berms on the strongest bends. Never wraps index 0 because sample 0 sits on a straight. */
function findBerms(line, wanted) {
    const { n, curv } = line;
    const runs = [];
    const limit = CONFIG.track.bermCurvature;
    let i = 0;
    while (i < n) {
        if (Math.abs(curv[i]) > limit) {
            const sign = curv[i] > 0 ? 1 : -1;
            let len = 0;
            let score = 0;
            while (i + len < n && Math.abs(curv[i + len]) > limit && (curv[i + len] > 0 ? 1 : -1) === sign) {
                score += Math.abs(curv[i + len]);
                len++;
            }
            if (len >= 8 && !nearCross(line, i, CROSS_ZONE + 2) && !nearCross(line, i + len - 1, CROSS_ZONE + 2)) {
                runs.push({ from: i, to: i + len - 1, side: sign > 0 ? -1 : 1, score });
            }
            i += len;
        } else {
            i++;
        }
    }
    runs.sort((a, b) => b.score - a.score);
    return runs.slice(0, Math.min(4, wanted)).sort((a, b) => a.from - b.from)
        .map((r) => ({ from: r.from, to: r.to, side: r.side }));
}

/**
 * Half width of the track at every sample. Dailies get a wide start straight, one to three
 * narrow pinch points on straights and one or two wide zones. The result is then capped so
 * the track stays inside the world, never folds on the inside of a bend and never comes too
 * close to another part of the lap. Width is constant along a berm. Returns null when a part
 * of the lap has no room for a usable width.
 */
function nearCross(line, i, pad) {
    const c = line.cross;
    return !!c && (circDist(i, c.a, line.n) <= pad || circDist(i, c.b, line.n) <= pad);
}

function makeWidths(line, profile, berms, rng) {
    const { n, px, py, curv, step } = line;
    const base = profile.width / 2;
    const f = new Float64Array(n).fill(1);
    const zones = [];
    if (profile.varyWidth) {
        zones.push({ c: 0, len: 16, k: 0.16 });
        const pinches = 1 + Math.floor(rng() * 3);
        const wides = 1 + Math.floor(rng() * 2);
        const far = (i, gap) => zones.every((z) => circDist(z.c, i, n) > z.len + gap);
        for (let q = 0; q < pinches; q++) {
            const k = -(0.2 + 0.08 * rng());
            const len = 9 + Math.floor(rng() * 5);
            for (let tries = 0; tries < 30; tries++) {
                const i = Math.floor(rng() * n);
                if (Math.abs(curv[i]) > 1 / 600 || inBerm(berms, i, 6) || !far(i, len + 8)) continue;
                if (nearCross(line, i, len + CROSS_ZONE + 6)) continue;
                zones.push({ c: i, len, k });
                break;
            }
        }
        for (let q = 0; q < wides; q++) {
            const k = 0.22 + 0.13 * rng();
            const len = 14 + Math.floor(rng() * 9);
            for (let tries = 0; tries < 30; tries++) {
                const i = Math.floor(rng() * n);
                if (!far(i, len + 8) || nearCross(line, i, len + CROSS_ZONE + 6)) continue;
                zones.push({ c: i, len, k });
                break;
            }
        }
    }
    for (const z of zones) {
        for (let d = -z.len; d <= z.len; d++) {
            const i = (((z.c + d) % n) + n) % n;
            f[i] += z.k * (0.5 + 0.5 * Math.cos((Math.PI * d) / z.len));
        }
    }
    const hw = new Float64Array(n);
    const skip = Math.ceil((3 * profile.width) / step);
    const W = CONFIG.world.w;
    const H = CONFIG.world.h;
    for (let i = 0; i < n; i++) {
        let v = base * f[i];
        v = Math.min(v, Math.min(px[i], W - px[i], py[i], H - py[i]) - 20);
        const c = Math.abs(curv[i]);
        if (c > 0) v = Math.min(v, 0.72 / c);
        let dmin2 = Infinity;
        for (let jj = 0; jj < n; jj++) {
            if (circDist(i, jj, n) <= skip) continue;
            if (inCrossZone(line.cross, i, jj, n, CROSS_ZONE)) continue;
            const ddx = px[jj] - px[i];
            const ddy = py[jj] - py[i];
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < dmin2) dmin2 = d2;
        }
        v = Math.min(v, (Math.sqrt(dmin2) - 50) / 2);
        if (v < base * 0.7) return null;
        hw[i] = v;
    }
    for (const b of berms) {
        let m = Infinity;
        for (let i = b.from - 2; i <= b.to + 2; i++) m = Math.min(m, hw[((i % n) + n) % n]);
        for (let i = b.from - 2; i <= b.to + 2; i++) hw[((i % n) + n) % n] = m;
    }
    // Smooth without ever going above a cap: keep the lower of the value and its average.
    for (let pass = 0; pass < 8; pass++) {
        const prev = Float64Array.from(hw);
        for (let i = 0; i < n; i++) {
            const avg = 0.25 * prev[(i + n - 1) % n] + 0.5 * prev[i] + 0.25 * prev[(i + 1) % n];
            if (avg < hw[i]) hw[i] = avg;
        }
    }
    for (let i = 0; i < n; i++) hw[i] = Math.round(hw[i] * 10) / 10;
    return hw;
}

function inBerm(berms, i, pad) {
    for (const b of berms) {
        if (i >= b.from - pad && i <= b.to + pad) return true;
    }
    return false;
}

function findJumps(line, rng, berms, wanted, hw, base) {
    const { n, curv } = line;
    const runs = straightRuns(curv, n, CONFIG.track.straightCurvature);
    const cand = [];
    for (let i = 0; i < n; i++) {
        if (runs.runLen[i] < 14) continue;
        if (circDist(i, 0, n) < 14) continue;
        if (inBerm(berms, i, 4)) continue;
        if (hw[i] < base * 0.97) continue;
        if (nearCross(line, i, 26)) continue;
        // Keep the lip away from the ends of the straight so the landing is straight too.
        if (runs.before[i] < 4 || runs.after[i] < 4) continue;
        cand.push(i);
    }
    const jumps = [];
    if (line.cross) {
        // A ramp just before the crossing on the straighter branch: fast riders fly over the
        // other path, slow riders roll across it.
        const bend = (c) => {
            let m = 0;
            for (let k = -16; k <= 14; k++) m = Math.max(m, Math.abs(curv[(c + k + n) % n]));
            return m;
        };
        const c = bend(line.cross.a) <= bend(line.cross.b) ? line.cross.a : line.cross.b;
        if (bend(c) > CONFIG.track.straightCurvature * 1.6) return [];
        const other = c === line.cross.a ? line.cross.b : line.cross.a;
        const lip = (c - Math.round((hw[other] + 34) / line.step) + n) % n;
        jumps.push({ i: lip, over: true });
        for (let k = cand.length - 1; k >= 0; k--) {
            if (circDist(cand[k], lip, n) < 30) cand.splice(k, 1);
        }
    }
    while (jumps.length < wanted && cand.length) {
        const idx = Math.floor(rng() * cand.length);
        const i = cand[idx];
        jumps.push({ i });
        for (let k = cand.length - 1; k >= 0; k--) {
            if (circDist(cand[k], i, n) < 30) cand.splice(k, 1);
        }
    }
    jumps.sort((a, b) => a.i - b.i);
    return jumps;
}

function findPickups(line, rng, profile, jumps, hw) {
    const { n } = line;
    const count = profile.pickups;
    const seg = n / count;
    const kinds = profile.pickupKinds
        ? shuffle(rng, profile.pickupKinds.slice())
        : makeKinds(rng, count);
    const spots = [];
    const reach = Math.floor(seg / 2) - 1;
    for (let k = 0; k < count; k++) {
        const target = Math.floor((k + 0.25 + 0.5 * rng()) * seg);
        const offRoll = rng();
        let chosen = -1;
        for (let d = 0; d <= reach && chosen < 0; d++) {
            for (const dir of [1, -1]) {
                const i = (((target + dir * d) % n) + n) % n;
                if (circDist(i, 0, n) < 16) continue;
                if (jumps.some((j) => circDist(j.i, i, n) < 8)) continue;
                if (spots.some((s) => circDist(s.i, i, n) < 10)) continue;
                if (nearCross(line, i, CROSS_ZONE + 3)) continue;
                chosen = i;
                break;
            }
        }
        if (chosen < 0) continue;
        const off = (offRoll * 2 - 1) * 0.6 * hw[chosen];
        spots.push({ i: chosen, off: Math.round(off * 10) / 10, type: kinds[k] });
    }
    spots.sort((a, b) => a.i - b.i);
    return spots;
}

// Pickup types for dailies: at least 2 boost and 1 hazard, the rest by chance.
function makeKinds(rng, count) {
    const kinds = ['boost', 'boost', rng() < 0.5 ? 'mud' : 'bramble'];
    while (kinds.length < count) {
        const r = rng();
        kinds.push(r < 0.5 ? 'boost' : (r < 0.75 ? 'mud' : 'bramble'));
    }
    return shuffle(rng, kinds);
}

function placeDecor(line, rng, profile, hw) {
    const { n, px, py } = line;
    const target = 70 + Math.floor(rng() * 41);
    const W = CONFIG.world.w;
    const H = CONFIG.world.h;
    const decor = [];
    let tries = 0;
    while (decor.length < target && tries < 3000) {
        tries++;
        const roll = rng();
        const type = roll < 0.55 ? 'tree' : (roll < 0.8 ? 'bush' : 'rock');
        const r = type === 'tree' ? 14 + rng() * 10 : (type === 'bush' ? 9 + rng() * 7 : 8 + rng() * 7);
        const x = r + rng() * (W - 2 * r);
        const y = r + rng() * (H - 2 * r);
        const v = rng();
        let clear = true;
        for (let i = 0; i < n; i++) {
            const dx = px[i] - x;
            const dy = py[i] - y;
            const limit = hw[i] + r + 14 + 1;
            if (dx * dx + dy * dy < limit * limit) {
                clear = false;
                break;
            }
        }
        if (!clear) continue;
        // Avoid heaps: neighbours may touch a little but not sit on top of each other.
        let crowded = false;
        for (const o of decor) {
            const dx = o.x - x;
            const dy = o.y - y;
            const min = (o.r + r) * 0.7;
            if (dx * dx + dy * dy < min * min) {
                crowded = true;
                break;
            }
        }
        if (crowded) continue;
        decor.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 10) / 10, type, v: Math.round(v * 1000) / 1000 });
    }
    return decor;
}

function makeGrid(line, profile, hw) {
    const { n, px, py, tx, ty, nx, ny, step } = line;
    // Staggered 2 x 2: slot 0 front left, 1 behind right, 2 behind left, 3 at the back right.
    const backs = [26, 48, 70, 92];
    const grid = [];
    for (let k = 0; k < 4; k++) {
        const i = (n - Math.round(backs[k] / step) + n) % n;
        const side = k % 2 === 0 ? -1 : 1;
        const lat = hw[i] * 0.4;
        const x = px[i] + nx[i] * lat * side;
        const y = py[i] + ny[i] * lat * side;
        grid.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, angle: Math.atan2(ty[i], tx[i]) });
    }
    return grid;
}

/**
 * Features from their own stream, so they do not depend on how many shape tries were needed.
 * Returns null when a strict profile cannot be satisfied.
 */
function buildFeatures(id, line, profile, strict) {
    const rng = makeRng(hashString(id + '|features'));
    const berms = findBerms(line, profile.berms);
    // The widths use their own stream so that adding width zones never moves other features.
    const hw = makeWidths(line, profile, berms, makeRng(hashString(id + '|width')));
    if (!hw) return null;
    const jumps = findJumps(line, rng, berms, profile.jumps, hw, profile.width / 2);
    if (strict) {
        // The cross has short straights, so one jump is enough there.
        if (jumps.length < (profile.family === 'cross' || line.cross ? 1 : profile.jumps)) return null;
        if (berms.length < (profile.kind === 'intro' ? 1 : 2)) return null;
    } else if (jumps.length < 1) {
        return null;
    }
    const pickupSpots = findPickups(line, rng, profile, jumps, hw);
    if (pickupSpots.length < Math.min(5, profile.pickups)) return null;
    const decor = placeDecor(line, rng, profile, hw);
    const grid = makeGrid(line, profile, hw);
    return { berms, jumps, pickupSpots, decor, grid, hw };
}

// ---------------------------------------------------------------------------------------
// Public generator

function toF32(arr) {
    return Float32Array.from(arr);
}

function assemble(id, seed, profile, line, features) {
    return {
        id,
        kind: profile.kind,
        seed,
        name: profile.name,
        laps: profile.laps,
        aiPace: Math.round(profile.aiPace * 1000) / 1000,
        theme: profile.theme,
        width: profile.width,
        n: line.n,
        length: line.length,
        step: line.step,
        px: toF32(line.px),
        py: toF32(line.py),
        tx: toF32(line.tx),
        ty: toF32(line.ty),
        nx: toF32(line.nx),
        ny: toF32(line.ny),
        curv: toF32(line.curv),
        hw: toF32(features.hw),
        family: profile.family,
        cross: line.cross,
        berms: features.berms,
        jumps: features.jumps,
        pickupSpots: features.pickupSpots,
        decor: features.decor,
        grid: features.grid
    };
}

/** Generate the track for an id. The same id always gives the same track. */
export function generateTrack(id) {
    return generateTrackInfo(id).track;
}

/** Same as generateTrack, plus how many tries were used (MAX_TRIES means the ellipse fallback). */
export function generateTrackInfo(id) {
    const seed = hashString(id);
    const base = makeRng(seed);
    const profile = makeProfile(id, base);

    // The seeded family first. If it finds no valid shape, the other daily families get a
    // turn (in list order from the seeded one) before the plain ellipse is used.
    const turns = profile.kind === 'daily' ? FAMILIES.length : 1;
    const firstFamily = FAMILIES.indexOf(profile.family);
    for (let attempt = 0; attempt < MAX_TRIES * turns; attempt++) {
        const turn = Math.floor(attempt / MAX_TRIES);
        if (turn > 0 && attempt % MAX_TRIES === 0) {
            profile.family = FAMILIES[(firstFamily + turn) % FAMILIES.length];
            profile.method = profile.family === 'ring' ? 'features' : 'outline';
        }
        const rng = makeRng((seed + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
        const ampScale = Math.pow(0.94, attempt % MAX_TRIES);
        const curve = profile.method === 'outline'
            ? outlineCurve(rng, profile, ampScale)
            : (profile.method === 'features'
                ? featureCurve(rng, profile, ampScale)
                : polarCurve(rng, profile, ampScale));
        const line = buildCentreline(curve, profile);
        if (!line) continue;
        const features = buildFeatures(id, line, profile, true);
        if (!features) continue;
        return { track: assemble(id, seed, profile, line, features), tries: attempt + 1, fallback: false };
    }

    // Fallback: a plain ellipse always passes the geometry rules.
    const plain = Object.assign({}, profile, { lively: false });
    const line = buildCentreline(ellipseCurve(plain), plain);
    const features = buildFeatures(id, line, plain, false);
    return { track: assemble(id, seed, plain, line, features), tries: MAX_TRIES * turns, fallback: true };
}
