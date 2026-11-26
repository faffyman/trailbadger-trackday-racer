// Canvas 2D renderer. The static world (ground, track, berms, ramps, rocks, bushes) and the tree
// canopies are drawn once into offscreen canvases. Each frame draws two images, the pickups,
// riders and a capped pool of particles.
import { CONFIG } from '../config.js';
import { drawRacerSprite, prepareCanvas, mixHex, shadeHex } from './sprites.js';

const TAU = Math.PI * 2;
const WORLD_W = CONFIG.world.w;
const WORLD_H = CONFIG.world.h;
const MAX_DPR = 2;
const MAX_PARTICLES = 260;
const MAX_FLASHES = 16;
const LIGHT_X = -0.6; // light comes from the top left
const LIGHT_Y = -0.8;

function makeRand(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
}

function smooth(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Static layers

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Trace the closed centreline offset sideways by off units.
function offsetLoop(ctx, t, off) {
    const n = t.n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = t.px[i] + t.nx[i] * off;
        const y = t.py[i] + t.ny[i] * off;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

// Half of the local track width at sample i.
function hwAt(t, i) {
    return t.hw ? t.hw[i] : t.width / 2;
}

// Fill a band that follows the local track width: half extent = local half width * scale + extra / 2.
// One path of quads, so the band has even alpha and no seams.
function ribbon(ctx, t, scale, extra, color, alpha) {
    const n = t.n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const a = hwAt(t, i) * scale + extra / 2;
        const b = hwAt(t, j) * scale + extra / 2;
        ctx.moveTo(t.px[i] - t.nx[i] * a, t.py[i] - t.ny[i] * a);
        ctx.lineTo(t.px[j] - t.nx[j] * b, t.py[j] - t.ny[j] * b);
        ctx.lineTo(t.px[j] + t.nx[j] * b, t.py[j] + t.ny[j] * b);
        ctx.lineTo(t.px[i] + t.nx[i] * a, t.py[i] + t.ny[i] * a);
        ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
}

// Stroke a line that runs `inset` units inside one edge of the track (side is 1 or -1).
function edgeLine(ctx, t, side, inset, width, color, alpha) {
    const n = t.n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const off = side * (hwAt(t, i) - inset);
        const x = t.px[i] + t.nx[i] * off;
        const y = t.py[i] + t.ny[i] * off;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function paintGround(ctx, t, rnd) {
    const th = t.theme;
    ctx.fillStyle = th.ground;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Large soft blotches of lighter and darker ground
    for (let i = 0; i < 46; i++) {
        const x = rnd() * WORLD_W;
        const y = rnd() * WORLD_H;
        const r = 90 + rnd() * 170;
        const light = rnd() > 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const c = light ? shadeHex(th.ground, 0.22) : th.groundAlt;
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = light ? 0.22 : 0.5;
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    paintPattern(ctx, th, rnd);
    const grassy = th.pattern === 'grass' || th.pattern === undefined;

    // Faint mown stripes
    ctx.globalAlpha = grassy ? 0.045 : 0;
    ctx.fillStyle = '#ffffff';
    for (let x = -200; x < WORLD_W + 200; x += 120) {
        ctx.save();
        ctx.translate(x, 0);
        ctx.transform(1, 0, -0.35, 1, 0, 0);
        ctx.fillRect(0, 0, 60, WORLD_H);
        ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Grass blades in three tones, batched into one path each
    const tones = [shadeHex(th.ground, -0.22), shadeHex(th.ground, 0.2), shadeHex(th.groundAlt, -0.1)];
    for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let i = 0; i < (grassy ? 2400 : th.pattern === 'hex' || th.pattern === 'rows' ? 500 : 0); i++) {
            const x = rnd() * WORLD_W;
            const y = rnd() * WORLD_H;
            const a = -1.2 - rnd() * 0.5 + (rnd() - 0.5) * 0.8;
            const l = 3 + rnd() * 5;
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        }
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.strokeStyle = tones[k];
        ctx.globalAlpha = k === 1 ? 0.5 : 0.4;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Tiny flowers
    const flowers = th.flowers || ['#fff4c2', '#ffffff', '#ffd1e6', '#ffe38a'];
    const flowerCount = flowers.length ? (th.flowerCount === undefined ? 160 : th.flowerCount) : 0;
    for (let i = 0; i < flowerCount; i++) {
        ctx.fillStyle = flowers[(rnd() * flowers.length) | 0];
        ctx.globalAlpha = 0.55 + rnd() * 0.3;
        ctx.beginPath();
        ctx.arc(rnd() * WORLD_W, rnd() * WORLD_H, (1 + rnd() * 1.2) * (th.flowerSize || 1), 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// Extra ground detail that gives each backdrop theme its own feel.
function paintPattern(ctx, th, rnd) {
    const p = th.pattern;
    if (p === 'rows') {
        // Crop rows across the whole field, with a few darker tractor lines.
        ctx.save();
        ctx.translate(WORLD_W / 2, WORLD_H / 2);
        ctx.rotate(-0.32 + rnd() * 0.64);
        for (let y = -1100; y < 1100; y += 13) {
            ctx.fillStyle = shadeHex(th.ground, (rnd() - 0.5) * 0.16 - 0.1);
            ctx.globalAlpha = 0.55;
            ctx.fillRect(-1100, y, 2200, 5);
            ctx.fillStyle = shadeHex(th.ground, 0.22);
            ctx.globalAlpha = 0.35;
            ctx.fillRect(-1100, y + 6, 2200, 3);
        }
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#5c3d22';
        for (let y = -1000; y < 1100; y += 234) {
            ctx.fillRect(-1100, y, 2200, 6);
            ctx.fillRect(-1100, y + 26, 2200, 6);
        }
        ctx.restore();
    } else if (p === 'snow') {
        // Drifts with a blue shadow side, and sparkles.
        for (let i = 0; i < 70; i++) {
            const x = rnd() * WORLD_W;
            const y = rnd() * WORLD_H;
            const rx = 40 + rnd() * 90;
            const ry = rx * (0.3 + rnd() * 0.25);
            const rot = -0.5 + rnd();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#b9cee0';
            ctx.beginPath();
            ctx.ellipse(x + 5, y + 7, rx, ry, rot, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
            ctx.fill();
        }
    } else if (p === 'gravel') {
        const tones = th.pebbles || [shadeHex(th.ground, 0.28), shadeHex(th.ground, -0.28), '#b9a98a', '#6a665f'];
        for (let i = 0; i < 9000; i++) {
            ctx.fillStyle = tones[(rnd() * tones.length) | 0];
            ctx.globalAlpha = 0.35 + rnd() * 0.4;
            ctx.beginPath();
            ctx.ellipse(rnd() * WORLD_W, rnd() * WORLD_H, 1 + rnd() * 2.6, 0.8 + rnd() * 1.8, rnd() * TAU, 0, TAU);
            ctx.fill();
        }
        // Puddles
        for (let i = 0; i < 9; i++) {
            const x = rnd() * WORLD_W;
            const y = rnd() * WORLD_H;
            const r = 16 + rnd() * 26;
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#5f7f93';
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * 0.6, rnd() * TAU, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#cfe3ee';
            ctx.beginPath();
            ctx.ellipse(x - r * 0.2, y - r * 0.15, r * 0.4, r * 0.16, 0, 0, TAU);
            ctx.fill();
        }
    } else if (p === 'ash') {
        // Glowing lava cracks and pools on dark rock.
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 0; i < 34; i++) {
            let x = rnd() * WORLD_W;
            let y = rnd() * WORLD_H;
            let a = rnd() * TAU;
            ctx.beginPath();
            ctx.moveTo(x, y);
            const parts = 4 + ((rnd() * 6) | 0);
            for (let k = 0; k < parts; k++) {
                a += (rnd() - 0.5) * 1.5;
                const l = 18 + rnd() * 34;
                x += Math.cos(a) * l;
                y += Math.sin(a) * l;
                ctx.lineTo(x, y);
            }
            ctx.shadowColor = '#ff5a1f';
            ctx.shadowBlur = 16;
            ctx.strokeStyle = '#ff7a2a';
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = 2.2 + rnd() * 2.4;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffd98a';
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = 0.9;
            ctx.stroke();
        }
        ctx.restore();
        for (let i = 0; i < 12; i++) {
            const x = rnd() * WORLD_W;
            const y = rnd() * WORLD_H;
            const r = 22 + rnd() * 34;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
            g.addColorStop(0, '#ffd27a');
            g.addColorStop(0.3, '#ff7a2a');
            g.addColorStop(0.55, 'rgba(190,40,20,0.75)');
            g.addColorStop(1, 'rgba(120,20,10,0)');
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(x, y, r * 1.8, r * 1.2, rnd() * TAU, 0, TAU);
            ctx.fill();
        }
    } else if (p === 'sand') {
        // Wind ripples in the sand.
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        for (let y = 6; y < WORLD_H; y += 15) {
            const ph = rnd() * TAU;
            const amp = 2 + rnd() * 3;
            ctx.beginPath();
            let pen = false;
            for (let x = 0; x <= WORLD_W; x += 16) {
                const yy = y + Math.sin(x * 0.021 + ph) * amp + Math.sin(x * 0.007 + ph * 2) * amp * 1.6;
                // Broken lines look more natural than full stripes
                if (Math.sin(x * 0.013 + ph * 3) > -0.35) {
                    if (pen) ctx.lineTo(x, yy);
                    else ctx.moveTo(x, yy);
                    pen = true;
                } else {
                    pen = false;
                }
            }
            ctx.strokeStyle = shadeHex(th.ground, -0.22);
            ctx.globalAlpha = 0.3;
            ctx.stroke();
        }
        if (th.sea) {
            // The sea along the bottom of the world, with a line of foam.
            const top = WORLD_H - 30;
            const edge = (x, k) => top + Math.sin(x * 0.018 + k) * 5 + Math.sin(x * 0.05 + k * 2) * 2;
            ctx.beginPath();
            ctx.moveTo(0, WORLD_H);
            for (let x = 0; x <= WORLD_W; x += 12) ctx.lineTo(x, edge(x, 0) - 9);
            ctx.lineTo(WORLD_W, WORLD_H);
            ctx.closePath();
            ctx.fillStyle = shadeHex(th.ground, -0.2);
            ctx.globalAlpha = 0.6;
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, WORLD_H);
            for (let x = 0; x <= WORLD_W; x += 12) ctx.lineTo(x, edge(x, 0));
            ctx.lineTo(WORLD_W, WORLD_H);
            ctx.closePath();
            ctx.fillStyle = '#3fa7c4';
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.beginPath();
            for (let x = 0; x <= WORLD_W; x += 12) {
                if (x === 0) ctx.moveTo(x, edge(x, 0));
                else ctx.lineTo(x, edge(x, 0));
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3.5;
            ctx.globalAlpha = 0.9;
            ctx.stroke();
            ctx.beginPath();
            for (let x = 0; x <= WORLD_W; x += 12) {
                if (x === 0) ctx.moveTo(x, edge(x, 1.7) + 12);
                else ctx.lineTo(x, edge(x, 1.7) + 12);
            }
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.45;
            ctx.stroke();
        }
    } else if (p === 'bog') {
        // Dark peat pools with a pale sheen and a rim of reeds.
        for (let i = 0; i < 30; i++) {
            const x = rnd() * WORLD_W;
            const y = rnd() * WORLD_H;
            const rx = 22 + rnd() * 48;
            const ry = rx * (0.45 + rnd() * 0.3);
            const rot = rnd() * TAU;
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = shadeHex(th.ground, -0.4);
            ctx.beginPath();
            ctx.ellipse(x, y, rx + 5, ry + 5, rot, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 0.92;
            ctx.fillStyle = '#23282f';
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = '#b9cbd8';
            ctx.beginPath();
            ctx.ellipse(x - rx * 0.2, y - ry * 0.25, rx * 0.45, ry * 0.2, rot, 0, TAU);
            ctx.fill();
        }
    } else if (p === 'hex') {
        // Basalt columns: a honeycomb of stone tops in mixed greys, mossy in places.
        const R = 21;
        const dx = R * Math.sqrt(3);
        const dy = R * 1.5;
        let row = 0;
        for (let y = -R; y < WORLD_H + R; y += dy, row++) {
            for (let x = (row % 2) * dx * 0.5 - dx; x < WORLD_W + dx; x += dx) {
                const v = rnd();
                const mossy = Math.sin(x * 0.006 + 1.3) + Math.cos(y * 0.008 - 0.4) + (v - 0.5) * 1.2 > 1.05;
                ctx.fillStyle = mossy ? shadeHex(th.groundAlt, (v - 0.5) * 0.3) : shadeHex(th.ground, (v - 0.5) * 0.55);
                ctx.globalAlpha = 1;
                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const a = (k / 6) * TAU + TAU / 12;
                    const hx = x + Math.cos(a) * (R - 1.2);
                    const hy = y + Math.sin(a) * (R - 1.2);
                    if (k === 0) ctx.moveTo(hx, hy);
                    else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 0.16;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x - 4, y - 5, R * 0.42, 0, TAU);
                ctx.fill();
            }
        }
    }
    ctx.globalAlpha = 1;
}

function paintHayBale(ctx, d, rnd) {
    const r = d.r * 0.95;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(r * 0.35, r * 0.45, r * 1.05, r * 0.85, 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#b98a2e';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e6c25a';
    ctx.beginPath();
    ctx.arc(-r * 0.08, -r * 0.08, r * 0.88, 0, TAU);
    ctx.fill();
    // Spiral of rolled straw
    ctx.strokeStyle = '#a87a26';
    ctx.lineWidth = 1.1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    const rot = rnd() * TAU;
    for (let a = 0; a < TAU * 2.6; a += 0.3) {
        const rr = (a / (TAU * 2.6)) * r * 0.82;
        const x = -r * 0.08 + Math.cos(a + rot) * rr;
        const y = -r * 0.08 + Math.sin(a + rot) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
}

function paintTrack(ctx, t, rnd) {
    const th = t.theme;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Worn grass fringe fades into the dirt
    const fringe = [[62, 0.05], [46, 0.07], [32, 0.1], [20, 0.16]];
    for (let i = 0; i < fringe.length; i++) ribbon(ctx, t, 1, fringe[i][0], th.dirt, fringe[i][1]);

    // Soft shadow of the cut, then the dark edge, then the dirt
    ribbon(ctx, t, 1, 14, '#000000', 0.18);
    ribbon(ctx, t, 1, 9, th.edge, 1);
    ribbon(ctx, t, 1, 3, shadeHex(th.dirtDark, -0.05), 1);
    ribbon(ctx, t, 1, 0, th.dirt, 1);
    ribbon(ctx, t, 0.74, 0, shadeHex(th.dirt, 0.1), 0.55);
    ribbon(ctx, t, 0.4, 0, shadeHex(th.dirt, 0.14), 0.35);

    // Mottled patches and pebbles
    const n = t.n;
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) {
            const off = (rnd() - 0.5) * 2 * hwAt(t, i) * 0.94;
            const x = t.px[i] + t.nx[i] * off + (rnd() - 0.5) * 8;
            const y = t.py[i] + t.ny[i] * off + (rnd() - 0.5) * 8;
            const dark = rnd() > 0.45;
            ctx.fillStyle = dark ? th.dirtDark : shadeHex(th.dirt, 0.22);
            ctx.globalAlpha = dark ? 0.16 : 0.2;
            ctx.beginPath();
            ctx.ellipse(x, y, 3 + rnd() * 9, 2 + rnd() * 5, rnd() * TAU, 0, TAU);
            ctx.fill();
        }
        if (i % 2 === 0) {
            const off = (rnd() - 0.5) * 2 * hwAt(t, i) * 0.96;
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = rnd() > 0.5 ? shadeHex(th.dirt, 0.3) : shadeHex(th.dirtDark, -0.2);
            ctx.beginPath();
            ctx.arc(t.px[i] + t.nx[i] * off, t.py[i] + t.ny[i] * off, 0.9 + rnd() * 1.1, 0, TAU);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;

    // Tyre lines: a few wandering pairs of faint ruts
    const bases = [-0.27, -0.09, 0.1, 0.28];
    for (let b = 0; b < bases.length; b++) {
        const ph = rnd() * TAU;
        const base = bases[b] * 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const off = base * hwAt(t, i) + Math.sin(i * 0.05 + ph) * 5 + Math.sin(i * 0.13 + ph * 2) * 2;
            const x = t.px[i] + t.nx[i] * off;
            const y = t.py[i] + t.ny[i] * off;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = th.dirtDark;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = shadeHex(th.dirt, 0.35);
        ctx.globalAlpha = 0.28;
        ctx.translate(1.4, 1.4);
        ctx.stroke();
        ctx.translate(-1.4, -1.4);
    }
    ctx.globalAlpha = 1;

    // Crisp inner edge lines
    edgeLine(ctx, t, 1, 1, 2.6, th.edge, 0.5);
    edgeLine(ctx, t, -1, 1, 2.6, th.edge, 0.5);
    edgeLine(ctx, t, 1, 4, 1.6, shadeHex(th.dirt, 0.3), 0.3);
    edgeLine(ctx, t, -1, 4, 1.6, shadeHex(th.dirt, 0.3), 0.3);

    // Painted direction chevrons, very faint
    const every = Math.max(8, Math.round(300 / t.step));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 0.11;
    for (let i = every >> 1; i < n; i += every) {
        const x = t.px[i];
        const y = t.py[i];
        const a = Math.atan2(t.ty[i], t.tx[i]);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-6, -9);
        ctx.lineTo(4, 0);
        ctx.lineTo(-6, 9);
        ctx.stroke();
        ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
}

// Banked berms: lit and shaded per sample so the bank reads as raised from the light direction.
function paintBerms(ctx, t) {
    const th = t.theme;
    const base = th.berm;
    const rise = 6;
    for (let b = 0; b < t.berms.length; b++) {
        const br = t.berms[b];
        // Width is constant along a berm, so the middle sample gives it.
        const hw = hwAt(t, (br.from + br.to) >> 1);
        // Offsets (distance from the centreline towards the outer side) and tone of each strip.
        // Rising slope, crest, then the outer drop.
        const toe = hw * 0.1;
        const prof = [];
        for (let q = 0; q <= rise; q++) {
            const p = q / rise;
            prof.push({ m: toe + (hw * 0.86 - toe) * p, tone: -0.3 + 0.5 * p, slope: 1 });
        }
        prof.push({ m: hw - 5, tone: 0.3, slope: 0 });
        prof.push({ m: hw + 3, tone: -0.1, slope: -1 });
        prof.push({ m: hw + 13, tone: -0.4, slope: -1 });
        const outerM = prof[prof.length - 1].m;
        const side = br.side;
        const from = br.from;
        const to = br.to;
        const len = to - from;
        // Cast shadow on the ground beside the bank
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
            const k = smooth((i - from) / 3) * smooth((to - i) / 3);
            const o = side * (outerM + 1);
            const x = t.px[i] + t.nx[i] * o + 5 * k;
            const y = t.py[i] + t.ny[i] * o + 7 * k;
            if (i === from) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        for (let i = to; i >= from; i--) {
            const k = smooth((i - from) / 3) * smooth((to - i) / 3);
            const o = side * (outerM + 1 + 12 * k);
            ctx.lineTo(t.px[i] + t.nx[i] * o + 8 * k, t.py[i] + t.ny[i] * o + 10 * k);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fill();

        for (let i = from; i < to; i++) {
            const k0 = smooth((i - from) / 3) * smooth((to - i) / 3);
            const k1 = smooth((i + 1 - from) / 3) * smooth((to - i - 1) / 3);
            // Outward unit vector for lighting
            const ox = t.nx[i] * side;
            const oy = t.ny[i] * side;
            const facing = ox * LIGHT_X + oy * LIGHT_Y;
            for (let p = 0; p < prof.length - 1; p++) {
                const a = prof[p];
                const c = prof[p + 1];
                const ma0 = outerM - (outerM - a.m) * k0;
                const mc0 = outerM - (outerM - c.m) * k0;
                const ma1 = outerM - (outerM - a.m) * k1;
                const mc1 = outerM - (outerM - c.m) * k1;
                // Slope of the strip decides how the light hits it
                const slope = p < rise ? 1 : c.slope;
                const lit = slope === 0 ? 0.3 : slope > 0 ? -facing : facing;
                const tone = (a.tone + c.tone) / 2 + lit * 0.34;
                const col = shadeHex(base, tone);
                ctx.beginPath();
                ctx.moveTo(t.px[i] + t.nx[i] * side * ma0, t.py[i] + t.ny[i] * side * ma0);
                ctx.lineTo(t.px[i + 1] + t.nx[i + 1] * side * ma1, t.py[i + 1] + t.ny[i + 1] * side * ma1);
                ctx.lineTo(t.px[i + 1] + t.nx[i + 1] * side * mc1, t.py[i + 1] + t.ny[i + 1] * side * mc1);
                ctx.lineTo(t.px[i] + t.nx[i] * side * mc0, t.py[i] + t.ny[i] * side * mc0);
                ctx.closePath();
                ctx.fillStyle = col;
                ctx.fill();
                ctx.lineWidth = 0.8;
                ctx.strokeStyle = col;
                ctx.stroke();
            }
        }
        // Crest highlight and carved line
        for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            for (let i = from; i <= to; i++) {
                const k = smooth((i - from) / 3) * smooth((to - i) / 3);
                const m0 = pass === 0 ? hw - 5 : hw * 0.42;
                const m = outerM - (outerM - m0) * k;
                const x = t.px[i] + t.nx[i] * side * m;
                const y = t.py[i] + t.ny[i] * side * m;
                if (i === from) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.lineWidth = pass === 0 ? 1.8 : 2.2;
            ctx.strokeStyle = pass === 0 ? shadeHex(base, 0.6) : th.dirtDark;
            ctx.globalAlpha = pass === 0 ? 0.55 : 0.28;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (len < 1) continue;
    }
}

function paintJumps(ctx, t) {
    const th = t.theme;
    const len = 44;
    for (let j = 0; j < t.jumps.length; j++) {
        const i = t.jumps[j].i;
        const hw = hwAt(t, i) - 3;
        const a = Math.atan2(t.ty[i], t.tx[i]);
        ctx.save();
        ctx.translate(t.px[i], t.py[i]);
        ctx.rotate(a);
        // Cast shadow (world light direction, so counter-rotate the offset)
        ctx.save();
        ctx.rotate(-a);
        ctx.translate(6, 9);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(-len, -hw);
        ctx.lineTo(0, -hw - 3);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, hw + 3);
        ctx.lineTo(-len, hw);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Ramp body, getting lighter and higher towards the lip
        const g = ctx.createLinearGradient(-len, 0, 0, 0);
        g.addColorStop(0, shadeHex(th.dirt, -0.1));
        g.addColorStop(0.55, shadeHex(th.dirt, 0.12));
        g.addColorStop(1, shadeHex(th.dirt, 0.32));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-len, -hw);
        ctx.lineTo(0, -hw);
        ctx.lineTo(0, hw);
        ctx.lineTo(-len, hw);
        ctx.closePath();
        ctx.fill();
        // Banked side walls
        for (let s = -1; s <= 1; s += 2) {
            ctx.fillStyle = s < 0 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.moveTo(-len, s * hw);
            ctx.lineTo(0, s * hw);
            ctx.lineTo(0, s * (hw - 7));
            ctx.lineTo(-len, s * (hw - 2));
            ctx.closePath();
            ctx.fill();
        }
        // Painted chevrons point along the direction of travel
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 3.4;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        for (let c = 0; c < 3; c++) {
            const x = -34 + c * 11;
            ctx.beginPath();
            ctx.moveTo(x - 5, -hw * 0.5);
            ctx.lineTo(x + 3, 0);
            ctx.lineTo(x - 5, hw * 0.5);
            ctx.stroke();
        }
        // Lip: bright edge, then the dark drop beyond it
        const gd = ctx.createLinearGradient(0, 0, 18, 0);
        gd.addColorStop(0, 'rgba(0,0,0,0.5)');
        gd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gd;
        ctx.fillRect(0, -hw, 18, hw * 2);
        ctx.fillStyle = shadeHex(th.dirt, 0.6);
        ctx.fillRect(-2.5, -hw, 2.5, hw * 2);
        ctx.strokeStyle = 'rgba(20,10,0,0.45)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-len, -hw, len, hw * 2);
        ctx.restore();
    }
}

function paintStart(ctx, t) {
    const w = 2 * hwAt(t, 0);
    const a = Math.atan2(t.ty[0], t.tx[0]);
    ctx.save();
    ctx.translate(t.px[0], t.py[0]);
    ctx.rotate(a);
    const cols = Math.round(w / 8);
    const sq = w / cols;
    for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#f6f6f2' : '#202428';
            ctx.fillRect(-8 + r * 8, -w / 2 + c * sq, 8, sq + 0.4);
        }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-8, -w / 2, 16, w);
    ctx.restore();

    // Grid slots
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    for (let i = 0; i < t.grid.length; i++) {
        const g = t.grid[i];
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.angle);
        ctx.beginPath();
        ctx.moveTo(-26, -13);
        ctx.lineTo(-26, 13);
        ctx.moveTo(-26, -13);
        ctx.lineTo(-18, -13);
        ctx.moveTo(-26, 13);
        ctx.lineTo(-18, 13);
        ctx.stroke();
        ctx.restore();
    }
}

function paintStartPosts(ctx, t, shadowOnly) {
    const w = 2 * hwAt(t, 0);
    const a = Math.atan2(t.ty[0], t.tx[0]);
    ctx.save();
    ctx.translate(t.px[0], t.py[0]);
    ctx.rotate(a);
    if (shadowOnly) {
        // Banner shadow falls away from the light, offset by its height
        ctx.save();
        ctx.rotate(-a);
        ctx.translate(14, 18);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(-3.5, -w / 2 - 10, 7, w + 20);
        ctx.restore();
    } else {
        const cols = Math.round(w / 6);
        const sq = w / cols;
        for (let c = 0; c < cols; c++) {
            ctx.fillStyle = c % 2 === 0 ? '#f6f6f2' : '#202428';
            ctx.fillRect(-3, -w / 2 + c * sq, 6, sq + 0.3);
        }
        ctx.fillStyle = '#2b3036';
        ctx.fillRect(-3.4, -w / 2 - 10, 6.8, 10);
        ctx.fillRect(-3.4, w / 2, 6.8, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-3, -w / 2, 6, w);
    }
    ctx.restore();
}

function paintRock(ctx, d, th, rnd) {
    const n = 8;
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd() * 0.3;
        const r = d.r * (0.8 + rnd() * 0.35);
        pts.push(Math.cos(a) * r, Math.sin(a) * r * 0.86);
    }
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.v * TAU);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(d.r * 0.3, d.r * 0.45, d.r * 1.05, d.r * 0.75, 0.3, 0, TAU);
    ctx.fill();
    const body = (scale, col) => {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = pts[i * 2] * scale;
            const y = pts[i * 2 + 1] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
    };
    body(1, shadeHex(th.rock, -0.25));
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
    ctx.translate(-d.r * 0.12, -d.r * 0.14);
    body(0.78, th.rock);
    ctx.translate(-d.r * 0.1, -d.r * 0.1);
    body(0.42, shadeHex(th.rock, 0.25));
    ctx.restore();
}

function paintBush(ctx, d, th, rnd) {
    if (th.bush === 'bale') {
        paintHayBale(ctx, d, rnd);
        return;
    }
    const cols = th.foliage;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(d.r * 0.35, d.r * 0.5, d.r * 1.1, d.r * 0.8, 0.3, 0, TAU);
    ctx.fill();
    const lobes = 6;
    const offs = [];
    for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * TAU + rnd();
        offs.push(Math.cos(a) * d.r * 0.5, Math.sin(a) * d.r * 0.5, d.r * (0.5 + rnd() * 0.2));
    }
    for (let pass = 0; pass < 3; pass++) {
        const col = shadeHex(cols[pass % cols.length], pass === 0 ? -0.35 : pass === 1 ? -0.1 : 0.1);
        const sc = pass === 0 ? 1 : pass === 1 ? 0.8 : 0.5;
        const sh = pass * 0.12 * d.r;
        ctx.fillStyle = col;
        for (let i = 0; i < lobes; i++) {
            ctx.beginPath();
            ctx.arc(offs[i * 3] * sc - sh, offs[i * 3 + 1] * sc - sh, offs[i * 3 + 2] * sc, 0, TAU);
            ctx.fill();
        }
    }
    if (d.v > 0.55) {
        const berry = th.berry || '#e8473f';
        ctx.fillStyle = berry;
        for (let i = 0; i < 7; i++) {
            ctx.beginPath();
            ctx.arc((rnd() - 0.5) * d.r * 1.3, (rnd() - 0.5) * d.r * 1.3, 1.3, 0, TAU);
            ctx.fill();
        }
    }
    ctx.restore();
}

// A palm seen from above: long fronds around a small crown.
function paintPalm(ctx, d, th, rnd, scale) {
    const R = d.r * 1.35;
    const fronds = 8;
    const rot = rnd() * TAU;
    ctx.save();
    ctx.translate(d.x, d.y);
    for (let pass = 0; pass < 2; pass++) {
        ctx.save();
        if (pass === 0) {
            ctx.translate(9 * scale, 12 * scale);
            ctx.globalAlpha = 0.3;
        }
        for (let i = 0; i < fronds; i++) {
            const a = rot + (i / fronds) * TAU + (rnd() - 0.5) * 0.25;
            const len = R * (0.85 + rnd() * 0.3);
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(len * 0.5, -R * 0.26, len, 0);
            ctx.quadraticCurveTo(len * 0.5, R * 0.26, 0, 0);
            ctx.fillStyle = pass === 0 ? '#000000' : th.foliage[i % th.foliage.length];
            ctx.fill();
            if (pass === 1) {
                ctx.strokeStyle = shadeHex(th.foliage[0], -0.3);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(len * 0.92, 0);
                ctx.stroke();
            }
            ctx.restore();
        }
        ctx.restore();
    }
    ctx.fillStyle = '#7a5a34';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.16, 0, TAU);
    ctx.fill();
    ctx.restore();
}

// A cactus seen from above: a ribbed round body with one or two arms and a flower.
function paintCactus(ctx, d, th, rnd, scale) {
    const R = d.r * 0.8;
    const base = th.foliage[Math.min(th.foliage.length - 1, Math.floor(d.v * th.foliage.length))];
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(8 * scale + R * 0.3, 10 * scale + R * 0.3, R * 1.2, R * 0.9, 0.5, 0, TAU);
    ctx.fill();
    const blobs = [[0, 0, R]];
    const arms = 1 + ((rnd() * 2) | 0);
    for (let i = 0; i < arms; i++) {
        const a = rnd() * TAU;
        blobs.push([Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05, R * 0.55]);
    }
    for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        ctx.fillStyle = shadeHex(base, -0.25);
        ctx.beginPath();
        ctx.arc(b[0], b[1], b[2], 0, TAU);
        ctx.fill();
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.arc(b[0] - b[2] * 0.12, b[1] - b[2] * 0.12, b[2] * 0.8, 0, TAU);
        ctx.fill();
        // Ribs
        ctx.strokeStyle = shadeHex(base, 0.3);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI;
            ctx.beginPath();
            ctx.moveTo(b[0] + Math.cos(a) * b[2] * 0.8, b[1] + Math.sin(a) * b[2] * 0.8);
            ctx.lineTo(b[0] - Math.cos(a) * b[2] * 0.8, b[1] - Math.sin(a) * b[2] * 0.8);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    if (d.v > 0.4) {
        ctx.fillStyle = th.berry || '#ff6fa8';
        ctx.beginPath();
        ctx.arc(-R * 0.1, -R * 0.1, R * 0.2, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

// Canopies go into their own layer so they draw above the riders.
function paintTree(ctx, d, th, rnd, scale) {
    if (th.tree === 'rock') {
        // No trees in this theme: a tall boulder or stone column stands in.
        paintRock(ctx, { x: d.x, y: d.y, r: d.r * 1.15, v: d.v, type: 'rock' }, th, rnd);
        return;
    }
    if (th.tree === 'palm') {
        paintPalm(ctx, d, th, rnd, scale);
        return;
    }
    if (th.tree === 'cactus') {
        paintCactus(ctx, d, th, rnd, scale);
        return;
    }
    const snowy = th.tree === 'snowpine';
    const R = d.r * 1.12;
    const cols = th.foliage;
    const idx = Math.min(cols.length - 1, Math.floor(d.v * cols.length));
    const base = cols[idx];
    ctx.save();
    ctx.translate(d.x, d.y);
    const conifer = snowy || (th.tree === 'conifer' && d.v < 0.8);
    // Soft shadow cast on the ground and on anything under the tree
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = 14 * scale;
    ctx.shadowOffsetX = 9 * scale;
    ctx.shadowOffsetY = 12 * scale;
    ctx.fillStyle = shadeHex(base, -0.42);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.96, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (conifer) {
        const spikes = 12;
        for (let layer = 0; layer < 4; layer++) {
            const rr = R * (1 - layer * 0.2);
            const tone = -0.32 + layer * 0.13;
            ctx.beginPath();
            const rot = layer * 0.26 + d.v * 3;
            for (let i = 0; i < spikes * 2; i++) {
                const a = (i / (spikes * 2)) * TAU + rot;
                const r = i % 2 === 0 ? rr : rr * 0.7;
                const x = Math.cos(a) * r - layer * 0.8;
                const y = Math.sin(a) * r - layer * 0.8;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = snowy && layer >= 2 ? (layer === 2 ? '#dfe9f0' : '#ffffff') : shadeHex(snowy ? cols[0] : base, tone);
            ctx.fill();
        }
        ctx.fillStyle = snowy ? '#ffffff' : shadeHex(base, 0.35);
        ctx.beginPath();
        ctx.arc(-R * 0.1, -R * 0.12, R * 0.12, 0, TAU);
        ctx.fill();
    } else {
        ctx.fillStyle = shadeHex(base, -0.3);
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.fill();
        const lobes = 7;
        const off = [];
        for (let i = 0; i < lobes; i++) {
            const a = (i / lobes) * TAU + rnd() * 0.6;
            off.push(Math.cos(a), Math.sin(a), 0.5 + rnd() * 0.12);
        }
        for (let pass = 0; pass < 3; pass++) {
            const sc = pass === 0 ? 0.52 : pass === 1 ? 0.4 : 0.26;
            const tone = pass === 0 ? -0.14 : pass === 1 ? 0.05 : 0.22;
            const sh = pass * 0.09 * R;
            ctx.fillStyle = shadeHex(base, tone);
            for (let i = 0; i < lobes; i++) {
                ctx.beginPath();
                ctx.arc(off[i * 3] * R * sc - sh, off[i * 3 + 1] * R * sc - sh, R * off[i * 3 + 2] * (pass === 0 ? 1 : 0.8 - pass * 0.12), 0, TAU);
                ctx.fill();
            }
        }
        ctx.fillStyle = shadeHex(base, 0.4);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(-R * 0.3, -R * 0.36, R * 0.2, R * 0.12, -0.7, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

function buildLayers(r) {
    const t = r.track;
    const s = r.layerScale;
    const lw = Math.round(WORLD_W * s);
    const lh = Math.round(WORLD_H * s);
    const sx = lw / WORLD_W;
    const sy = lh / WORLD_H;
    const ground = makeCanvas(lw, lh);
    const canopy = makeCanvas(lw, lh);
    const g = ground.getContext('2d');
    const c = canopy.getContext('2d');
    g.setTransform(sx, 0, 0, sy, 0, 0);
    c.setTransform(sx, 0, 0, sy, 0, 0);
    const rnd = makeRand(t.seed ^ 0x9e3779b9);

    // Rounded world edge; everything below stays inside it
    g.save();
    roundRectPath(g, 0, 0, WORLD_W, WORLD_H, 22);
    g.clip();
    paintGround(g, t, rnd);
    paintTrack(g, t, rnd);
    paintBerms(g, t);
    paintJumps(g, t);
    paintStart(g, t);
    paintStartPosts(g, t, true);
    paintStartPosts(g, t, false);

    // Rocks and bushes, sorted by y so overlaps look right
    const decor = t.decor.slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < decor.length; i++) {
        const d = decor[i];
        if (d.type === 'rock') paintRock(g, d, t.theme, rnd);
        else if (d.type === 'bush') paintBush(g, d, t.theme, rnd);
    }

    // Edge vignette
    const vg = g.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.45, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,10,0,0.3)');
    g.fillStyle = vg;
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.restore();

    // Canopies
    c.save();
    roundRectPath(c, 0, 0, WORLD_W, WORLD_H, 22);
    c.clip();
    for (let i = 0; i < decor.length; i++) {
        if (decor[i].type === 'tree') paintTree(c, decor[i], t.theme, rnd, s);
    }
    paintStartPosts(c, t, true);
    paintStartPosts(c, t, false);
    c.restore();

    r.groundLayer = ground;
    r.canopyLayer = canopy;
}

// ---------------------------------------------------------------------------------------------
// Dynamic art

// Pre-rendered soft sprites for particles
function makeGlow(color, size) {
    const c = makeCanvas(size, size);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalAlpha = 1;
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
}

function makeStreak() {
    const c = makeCanvas(128, 32);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(128, 0, 0, 0);
    g.addColorStop(0, 'rgba(255,250,220,0.95)');
    g.addColorStop(0.25, 'rgba(255,200,80,0.7)');
    g.addColorStop(0.65, 'rgba(255,110,30,0.28)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(128, 16);
    x.quadraticCurveTo(70, 0, 0, 12);
    x.lineTo(0, 20);
    x.quadraticCurveTo(70, 32, 128, 16);
    x.fill();
    return c;
}

const SPIKE_BALL = (function () {
    const pts = new Float32Array(32);
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const r = i % 2 === 0 ? 1 : 0.55;
        pts[i * 2] = Math.cos(a) * r;
        pts[i * 2 + 1] = Math.sin(a) * r;
    }
    return pts;
})();

function spikePath(ctx, x, y, r, rot) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
        const px = SPIKE_BALL[i * 2] * r;
        const py = SPIKE_BALL[i * 2 + 1] * r;
        const X = x + px * c - py * s;
        const Y = y + px * s + py * c;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
    }
    ctx.closePath();
}

function drawBolt(ctx, x, y, sc) {
    ctx.beginPath();
    ctx.moveTo(x + 3 * sc, y - 12 * sc);
    ctx.lineTo(x - 7 * sc, y + 1.5 * sc);
    ctx.lineTo(x - 0.5 * sc, y + 1.5 * sc);
    ctx.lineTo(x - 3 * sc, y + 12 * sc);
    ctx.lineTo(x + 7.5 * sc, y - 2.5 * sc);
    ctx.lineTo(x + 0.8 * sc, y - 2.5 * sc);
    ctx.closePath();
}

// Smooth wobbly blob through midpoints of a ring of jittered points
function drawSplat(ctx, x, y, r, rot, color) {
    ctx.fillStyle = color;
    const n = 9;
    const px = BLOB_X;
    const py = BLOB_Y;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rot;
        const rr = r * (1 + 0.2 * Math.sin(i * 2.3 + 1) + (i % 3 === 0 ? 0.12 : -0.05));
        px[i] = x + Math.cos(a) * rr;
        py[i] = y + Math.sin(a) * rr * 0.9;
    }
    ctx.beginPath();
    ctx.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
    }
    ctx.closePath();
    ctx.fill();
}
const BLOB_X = new Float32Array(9);
const BLOB_Y = new Float32Array(9);

function drawPickup(ctx, p, i, clock) {
    const bob = Math.sin(clock * 3.2 + i * 1.7);
    const R = CONFIG.pickups.radius;
    const x = p.x;
    const y = p.y;
    // Ground shadow stays put while the token floats
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 6, R * 0.8 - bob * 0.8, R * 0.52 - bob * 0.5, 0, 0, TAU);
    ctx.fill();
    const fy = y - 4 - bob * 2.4;
    const pulse = 1 + 0.05 * Math.sin(clock * 5 + i);
    let col;
    let rim;
    if (p.type === 'boost') {
        col = '#1f63e0';
        rim = '#8fd0ff';
    } else if (p.type === 'mud') {
        col = '#6b4223';
        rim = '#d9b27a';
    } else {
        col = '#1f6a2c';
        rim = '#9be08a';
    }
    ctx.save();
    ctx.translate(x, fy);
    ctx.scale(pulse, pulse);
    // Glow, plate, rim
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, R + 5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, R - 1, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(-4, -7, 9, 5, -0.5, 0, TAU);
    ctx.fill();
    if (p.type === 'boost') {
        drawBolt(ctx, 0, 0, 0.95);
        ctx.fillStyle = '#ffe14d';
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = '#7a4a00';
        ctx.lineJoin = 'round';
        ctx.stroke();
    } else if (p.type === 'mud') {
        drawSplat(ctx, 0, 1, 10.5, 0.4, '#3d2412');
        drawSplat(ctx, -1, 0, 9, 0.4, '#a2703c');
        ctx.fillStyle = '#c99660';
        ctx.beginPath();
        ctx.arc(-3, -3, 2.2, 0, TAU);
        ctx.fill();
    } else {
        spikePath(ctx, 0, 0, 12, clock * 0.5);
        ctx.fillStyle = '#58b04a';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#1c4a1c';
        ctx.stroke();
        ctx.fillStyle = '#2f7a34';
        ctx.beginPath();
        ctx.arc(0, 0, 5.6, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

function drawHazard(ctx, h, clock) {
    const ttl = h.ttl;
    const fadeIn = smooth((CONFIG.pickups.hazardTtl - ttl) * 5);
    if (fadeIn <= 0) return;
    // Blink when about to disappear
    if (ttl < 2 && Math.sin(ttl * 18) < -0.2) ctx.globalAlpha = 0.45;
    const r = (h.r || CONFIG.pickups.hazardRadius) * (0.6 + 0.4 * fadeIn);
    const rot = (h.x * 0.13 + h.y * 0.07) % TAU;
    if (h.type === 'mud') {
        drawSplat(ctx, h.x + 1.5, h.y + 2.5, r * 1.04, rot, 'rgba(0,0,0,0.22)');
        drawSplat(ctx, h.x, h.y, r, rot, '#3b2412');
        drawSplat(ctx, h.x - 1, h.y - 1, r * 0.82, rot + 0.2, '#6a4527');
        drawSplat(ctx, h.x - 2, h.y - 2, r * 0.5, rot + 0.5, '#7d5732');
        ctx.fillStyle = 'rgba(255,230,190,0.35)';
        ctx.beginPath();
        ctx.ellipse(h.x - r * 0.3, h.y - r * 0.35, r * 0.22, r * 0.1, -0.6, 0, TAU);
        ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(h.x + 4, h.y + 7, r * 0.9, r * 0.55, 0, 0, TAU);
        ctx.fill();
        spikePath(ctx, h.x, h.y - 3, r * 0.95, rot);
        ctx.fillStyle = '#4ea03e';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#173f19';
        ctx.lineJoin = 'round';
        ctx.stroke();
        spikePath(ctx, h.x - 1, h.y - 4, r * 0.62, rot + 0.4);
        ctx.fillStyle = '#2e7a33';
        ctx.fill();
        ctx.fillStyle = '#7fd36a';
        ctx.beginPath();
        ctx.arc(h.x - r * 0.25, h.y - r * 0.35, r * 0.14, 0, TAU);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Renderer

const K_DUST = 0;
const K_SPARK = 1;
const K_CHUNK = 2;
const K_CONFETTI = 3;
const K_LEAF = 4;

// Colour slots for particles
const C_DIRT = 0;
const C_GRASS = 1;
const C_MUD = 2;
const C_GOLD = 3;
const C_BLUE = 4;
const C_LEAF = 5;
const C_WHITE = 6;
const C_CONF = 7; // 7..10 racer markers, 11 gold

export function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const r = {
        track: null,
        cssW: 0,
        cssH: 0,
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        dpr: 1,
        fit: 1,
        layerScale: 1,
        rotated: false,
        ox: 0,
        oy: 0,
        upX: 0,
        upY: -1,
        groundLayer: null,
        canopyLayer: null,
        builtScale: 0,
        dirty: false,
        clock: 0,
        lastState: null,
        bg: '#16241a'
    };

    // Particle pool: structure of arrays, nothing allocated while playing
    const P = {
        x: new Float32Array(MAX_PARTICLES),
        y: new Float32Array(MAX_PARTICLES),
        vx: new Float32Array(MAX_PARTICLES),
        vy: new Float32Array(MAX_PARTICLES),
        life: new Float32Array(MAX_PARTICLES),
        max: new Float32Array(MAX_PARTICLES),
        size: new Float32Array(MAX_PARTICLES),
        rot: new Float32Array(MAX_PARTICLES),
        vr: new Float32Array(MAX_PARTICLES),
        kind: new Uint8Array(MAX_PARTICLES),
        col: new Uint8Array(MAX_PARTICLES),
        head: 0
    };
    const F = {
        x: new Float32Array(MAX_FLASHES),
        y: new Float32Array(MAX_FLASHES),
        life: new Float32Array(MAX_FLASHES),
        max: new Float32Array(MAX_FLASHES),
        size: new Float32Array(MAX_FLASHES),
        col: new Uint8Array(MAX_FLASHES),
        head: 0
    };
    const emitAcc = new Float32Array(8);
    const order = [0, 1, 2, 3];
    let colors = [];
    let glows = [];
    let streak = null;

    function buildPalette() {
        const th = r.track.theme;
        const marks = CONFIG.racers.map((c) => c.marker);
        colors = [
            shadeHex(th.dirt, 0.28),
            shadeHex(th.ground, 0.28),
            '#5a3a1e',
            '#ffd96b',
            '#8fd6ff',
            '#6fcb55',
            '#ffffff',
            marks[0] || '#ffd23f',
            marks[1] || '#3fa7ff',
            marks[2] || '#ff5a4f',
            marks[3] || '#b57bff',
            '#ffd23f'
        ];
        glows = [];
        for (let i = 0; i < 7; i++) glows.push(makeGlow(colors[i], 48));
        streak = makeStreak();
        r.bg = mixHex(th.ground, '#000000', 0.6);
    }

    function emit(kind, x, y, vx, vy, life, size, col, vr) {
        const i = P.head;
        P.head = (P.head + 1) % MAX_PARTICLES;
        P.x[i] = x;
        P.y[i] = y;
        P.vx[i] = vx;
        P.vy[i] = vy;
        P.life[i] = life;
        P.max[i] = life;
        P.size[i] = size;
        P.rot[i] = Math.random() * TAU;
        P.vr[i] = vr || 0;
        P.kind[i] = kind;
        P.col[i] = col;
    }

    function flash(x, y, size, life, col) {
        const i = F.head;
        F.head = (F.head + 1) % MAX_FLASHES;
        F.x[i] = x;
        F.y[i] = y;
        F.size[i] = size;
        F.life[i] = life;
        F.max[i] = life;
        F.col[i] = col;
    }

    function burst(kind, x, y, count, speed, life, size, col, spread) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU;
            const sp = speed * (0.35 + Math.random() * 0.65);
            emit(kind, x + Math.cos(a) * (spread || 0), y + Math.sin(a) * (spread || 0), Math.cos(a) * sp, Math.sin(a) * sp, life * (0.6 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), col, (Math.random() - 0.5) * 8);
        }
    }

    function updateLayout() {
        const ins = r.insets;
        const availW = Math.max(1, r.cssW - ins.left - ins.right);
        const availH = Math.max(1, r.cssH - ins.top - ins.bottom);
        r.rotated = availH > availW;
        const ww = r.rotated ? WORLD_H : WORLD_W;
        const wh = r.rotated ? WORLD_W : WORLD_H;
        const pad = 4;
        r.fit = Math.max(0.05, Math.min((availW - pad * 2) / ww, (availH - pad * 2) / wh));
        const S = r.fit * r.dpr;
        const cx = (ins.left + availW / 2) * r.dpr;
        const cy = (ins.top + availH / 2) * r.dpr;
        // Device position of world (0, 0), snapped so the layers stay pixel aligned
        if (r.rotated) {
            r.ox = Math.round(cx + S * (WORLD_H / 2));
            r.oy = Math.round(cy - S * (WORLD_W / 2));
            r.upX = -1;
            r.upY = 0;
        } else {
            r.ox = Math.round(cx - S * (WORLD_W / 2));
            r.oy = Math.round(cy - S * (WORLD_H / 2));
            r.upX = 0;
            r.upY = -1;
        }
        r.layerScale = S;
    }

    function rebuild() {
        r.dirty = false;
        if (!r.track || !r.cssW) return;
        if (!r.groundLayer || Math.abs(r.builtScale - r.layerScale) > 0.001 || r.builtTrack !== r.track) {
            buildLayers(r);
            r.builtScale = r.layerScale;
            r.builtTrack = r.track;
        }
    }

    function setCanvasSize() {
        const pw = Math.max(1, Math.round(r.cssW * r.dpr));
        const ph = Math.max(1, Math.round(r.cssH * r.dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
    }

    const api = {
        setTrack(track) {
            r.track = track || null;
            r.groundLayer = null;
            r.canopyLayer = null;
            r.builtTrack = null;
            P.life.fill(0);
            F.life.fill(0);
            emitAcc.fill(0);
            if (!r.track) return;
            buildPalette();
            if (r.cssW) {
                updateLayout();
                rebuild();
            }
        },

        resize(cssW, cssH, insets) {
            r.cssW = Math.max(1, cssW || 1);
            r.cssH = Math.max(1, cssH || 1);
            const i = insets || {};
            r.insets.top = i.top || 0;
            r.insets.right = i.right || 0;
            r.insets.bottom = i.bottom || 0;
            r.insets.left = i.left || 0;
            r.dpr = Math.max(1, Math.min(MAX_DPR, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
            setCanvasSize();
            updateLayout();
            r.dirty = true;
        },

        draw(state, dt) {
            if (!r.cssW) {
                // The host never called resize: fall back to the canvas size
                const d = Math.max(1, Math.min(MAX_DPR, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
                api.resize(canvas.clientWidth || canvas.width / d, canvas.clientHeight || canvas.height / d, null);
            }
            dt = dt > 0 ? Math.min(dt, 0.1) : 0;
            if (r.dirty) rebuild();
            const S = r.layerScale;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.fillStyle = r.bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (!r.track || !r.groundLayer) return;
            r.clock += dt;
            const clock = r.clock;
            if (r.rotated) ctx.setTransform(0, S, -S, 0, r.ox, r.oy);
            else ctx.setTransform(S, 0, 0, S, r.ox, r.oy);

            // Soft shadow of the whole board against the page background
            ctx.drawImage(r.groundLayer, 0, 0, r.groundLayer.width / S, r.groundLayer.height / S);
            if (!state) {
                ctx.drawImage(r.canopyLayer, 0, 0, r.canopyLayer.width / S, r.canopyLayer.height / S);
                return;
            }
            r.lastState = state;
            const racers = state.racers || [];

            // Hazards then pickups
            const hz = state.hazards;
            if (hz) for (let i = 0; i < hz.length; i++) drawHazard(ctx, hz[i], clock);
            const pk = state.pickups;
            if (pk) {
                for (let i = 0; i < pk.length; i++) {
                    const p = pk[i];
                    if (p.active) drawPickup(ctx, p, i, clock);
                    else {
                        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                        ctx.lineWidth = 2;
                        ctx.setLineDash([4, 6]);
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, CONFIG.pickups.radius * 0.8, 0, TAU);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
            }

            // Emit particles from riders
            for (let i = 0; i < racers.length; i++) {
                const c = racers[i];
                const cos = Math.cos(c.angle);
                const sin = Math.sin(c.angle);
                const rx = c.x - cos * 20;
                const ry = c.y - sin * 20;
                if (!c.air && c.speed > 45 && dt > 0) {
                    emitAcc[i] += dt * (10 + c.speed * 0.1) * (c.boost > 0 ? 1.3 : 1);
                    while (emitAcc[i] >= 1) {
                        emitAcc[i] -= 1;
                        const col = c.offroad ? C_GRASS : C_DIRT;
                        emit(K_DUST, rx + (Math.random() - 0.5) * 8, ry + (Math.random() - 0.5) * 8, -cos * 14 + (Math.random() - 0.5) * 26, -sin * 14 + (Math.random() - 0.5) * 26, 0.45 + Math.random() * 0.4, 6 + Math.random() * 6, col, 0);
                        if (c.offroad && Math.random() < 0.5) emit(K_CHUNK, rx, ry, (Math.random() - 0.5) * 70 - cos * 30, (Math.random() - 0.5) * 70 - sin * 30, 0.35, 1.8, C_LEAF, 0);
                    }
                }
                if (c.mud > 0 && !c.air && dt > 0 && Math.random() < dt * 22) {
                    emit(K_CHUNK, rx, ry, (Math.random() - 0.5) * 90 - cos * 40, (Math.random() - 0.5) * 90 - sin * 40, 0.5, 2.6, C_MUD, 0);
                }
                if (c.boost > 0 && dt > 0 && Math.random() < dt * 55) {
                    const a = c.angle + Math.PI + (Math.random() - 0.5) * 0.9;
                    const sp = 70 + Math.random() * 90;
                    emit(K_SPARK, rx, ry, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.2, 2.6, Math.random() < 0.5 ? C_GOLD : C_BLUE, 0);
                }
                if (c.bramble > 0 && dt > 0 && Math.random() < dt * 24) {
                    emit(K_LEAF, c.x, c.y, (Math.random() - 0.5) * 110, (Math.random() - 0.5) * 110, 0.6, 2.8, C_LEAF, (Math.random() - 0.5) * 14);
                }
                if (c.onBerm && !c.air && c.speed > 120 && dt > 0 && Math.random() < dt * 20) {
                    emit(K_CHUNK, rx, ry, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 0.4, 1.8, C_DIRT, 0);
                }
            }

            // Update particles and flashes
            for (let i = 0; i < MAX_PARTICLES; i++) {
                if (P.life[i] <= 0) continue;
                P.life[i] -= dt;
                const drag = 1 - Math.min(1, dt * 3);
                P.vx[i] *= drag;
                P.vy[i] *= drag;
                P.x[i] += P.vx[i] * dt;
                P.y[i] += P.vy[i] * dt;
                P.rot[i] += P.vr[i] * dt;
            }
            for (let i = 0; i < MAX_FLASHES; i++) if (F.life[i] > 0) F.life[i] -= dt;

            // Dust under the riders
            for (let i = 0; i < MAX_PARTICLES; i++) {
                if (P.life[i] <= 0 || P.kind[i] !== K_DUST) continue;
                const t = 1 - P.life[i] / P.max[i];
                const sz = P.size[i] * (1 + t * 1.6);
                ctx.globalAlpha = 0.5 * (1 - t) * (1 - t);
                ctx.drawImage(glows[P.col[i]], P.x[i] - sz, P.y[i] - sz, sz * 2, sz * 2);
            }
            ctx.globalAlpha = 1;

            // Boost streaks
            for (let i = 0; i < racers.length; i++) {
                const c = racers[i];
                if (c.boost > 0 && !c.air) {
                    const len = 46 + Math.min(1, c.speed / 430) * 40;
                    const a = Math.min(1, c.boost / 0.35);
                    ctx.save();
                    ctx.translate(c.x, c.y);
                    ctx.rotate(c.angle);
                    ctx.globalAlpha = a * 0.7 * (0.8 + 0.2 * Math.sin(clock * 50 + i));
                    ctx.drawImage(streak, -22 - len, -7, len, 14);
                    ctx.restore();
                }
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;

            // Shadows
            for (let i = 0; i < racers.length; i++) {
                const c = racers[i];
                const z = c.z > 0 ? c.z : 0;
                const sc = z > 0 ? 1 - Math.min(0.35, z * 0.012) : 1;
                ctx.save();
                ctx.translate(c.x + 2.5 + z * 0.5, c.y + 4 + z * 0.8);
                ctx.rotate(c.angle);
                ctx.fillStyle = 'rgba(0,0,0,' + (0.2 * sc).toFixed(3) + ')';
                ctx.beginPath();
                ctx.ellipse(0, 0, 27 * sc, 12.5 * sc, 0, 0, TAU);
                ctx.fill();
                ctx.fillStyle = 'rgba(0,0,0,' + (0.2 * sc).toFixed(3) + ')';
                ctx.beginPath();
                ctx.ellipse(0, 0, 21 * sc, 8.5 * sc, 0, 0, TAU);
                ctx.fill();
                ctx.restore();
            }

            // Riders sorted by height, the player last on ties so it is never hidden
            order[0] = 0;
            order[1] = 1;
            order[2] = 2;
            order[3] = 3;
            const cnt = Math.min(4, racers.length);
            for (let a = 1; a < cnt; a++) {
                const v = order[a];
                const zv = racers[v].z || 0;
                let b = a - 1;
                while (b >= 0 && ((racers[order[b]].z || 0) > zv || ((racers[order[b]].z || 0) === zv && order[b] === 0 && v !== 0))) {
                    order[b + 1] = order[b];
                    b--;
                }
                order[b + 1] = v;
            }
            for (let k = 0; k < cnt; k++) {
                const idx = order[k];
                const c = racers[idx];
                const cfg = CONFIG.racers[idx];
                const z = c.z > 0 ? c.z : 0;
                const sc = 1 + z * 0.012;
                ctx.save();
                ctx.translate(c.x - z * 0.35, c.y - z * 0.8);
                let ang = c.angle;
                if (c.bramble > 0) ang += Math.sin(clock * 26) * 0.3 + Math.sin(clock * 9) * 0.25;
                else if (c.mud > 0) ang += Math.sin(clock * 14 + idx) * 0.05;
                ctx.rotate(ang);
                if (sc !== 1) ctx.scale(sc, sc);
                drawRacerSprite(ctx, cfg, c.steer || 0, c.pedalPhase || 0);
                if (c.mud > 0) {
                    ctx.fillStyle = 'rgba(74,46,22,0.85)';
                    ctx.beginPath();
                    ctx.arc(-12, -5, 3.2, 0, TAU);
                    ctx.arc(-16, 3, 2.6, 0, TAU);
                    ctx.arc(-4, 8, 2.2, 0, TAU);
                    ctx.arc(2, -8, 1.9, 0, TAU);
                    ctx.arc(14, 3, 1.8, 0, TAU);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Sparks, chunks, confetti and leaves
            for (let i = 0; i < MAX_PARTICLES; i++) {
                if (P.life[i] <= 0 || P.kind[i] === K_DUST) continue;
                const t = P.life[i] / P.max[i];
                const kd = P.kind[i];
                if (kd === K_SPARK) {
                    const sz = P.size[i] * (0.5 + t) * 2.6;
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.globalAlpha = Math.min(1, t * 1.5);
                    ctx.drawImage(glows[P.col[i]], P.x[i] - sz, P.y[i] - sz, sz * 2, sz * 2);
                    ctx.globalCompositeOperation = 'source-over';
                } else if (kd === K_CHUNK) {
                    ctx.globalAlpha = Math.min(1, t * 2);
                    ctx.fillStyle = colors[P.col[i]];
                    ctx.beginPath();
                    ctx.arc(P.x[i], P.y[i], P.size[i], 0, TAU);
                    ctx.fill();
                } else if (kd === K_CONFETTI) {
                    ctx.globalAlpha = Math.min(1, t * 2);
                    ctx.fillStyle = colors[P.col[i]];
                    ctx.save();
                    ctx.translate(P.x[i], P.y[i]);
                    ctx.rotate(P.rot[i]);
                    ctx.fillRect(-P.size[i], -P.size[i] * 0.45 * Math.abs(Math.cos(P.rot[i] * 2)) - 0.4, P.size[i] * 2, P.size[i] * 0.9 + 0.8);
                    ctx.restore();
                } else {
                    ctx.globalAlpha = Math.min(1, t * 2);
                    ctx.fillStyle = colors[P.col[i]];
                    ctx.save();
                    ctx.translate(P.x[i], P.y[i]);
                    ctx.rotate(P.rot[i]);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, P.size[i] * 1.5, P.size[i] * 0.8, 0, 0, TAU);
                    ctx.fill();
                    ctx.restore();
                }
            }
            ctx.globalAlpha = 1;

            // Expanding rings
            for (let i = 0; i < MAX_FLASHES; i++) {
                if (F.life[i] <= 0) continue;
                const t = 1 - F.life[i] / F.max[i];
                ctx.globalAlpha = (1 - t) * 0.9;
                ctx.strokeStyle = colors[F.col[i]];
                ctx.lineWidth = 4 * (1 - t) + 1;
                ctx.beginPath();
                ctx.arc(F.x[i], F.y[i], F.size[i] * (0.3 + t * 0.9), 0, TAU);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // Canopies sit above everything on the ground
            ctx.drawImage(r.canopyLayer, 0, 0, r.canopyLayer.width / S, r.canopyLayer.height / S);

            // Marker for the player: pulsing ring plus an arrow above, drawn last so trees never hide it
            const me = racers[0];
            if (me) {
                const z = me.z > 0 ? me.z : 0;
                const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
                const mc = CONFIG.racers[0].marker;
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(20,20,20,0.35)';
                ctx.beginPath();
                ctx.arc(me.x, me.y, 29 + pulse * 2.5, 0, TAU);
                ctx.stroke();
                ctx.lineWidth = 2;
                ctx.strokeStyle = mc;
                ctx.globalAlpha = 0.65 + pulse * 0.35;
                ctx.beginPath();
                ctx.arc(me.x, me.y, 29 + pulse * 2.5, 0, TAU);
                ctx.stroke();
                ctx.globalAlpha = 1;
                // Arrow points down towards the rider as the screen sees it
                const dist = 46 + z * 0.9 + pulse * 4;
                const ax = me.x + r.upX * dist;
                const ay = me.y + r.upY * dist;
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(Math.atan2(-r.upY, -r.upX));
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-7, -9);
                ctx.lineTo(-3, 0);
                ctx.lineTo(-7, 9);
                ctx.closePath();
                ctx.fillStyle = mc;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.lineJoin = 'round';
                ctx.strokeStyle = '#1d1d1d';
                ctx.stroke();
                ctx.restore();
            }
        },

        onEvent(ev) {
            if (!ev || !r.track || !colors.length) return;
            const st = r.lastState;
            let x = ev.x;
            let y = ev.y;
            if ((x === undefined || y === undefined) && st && st.racers && st.racers[ev.racer]) {
                x = st.racers[ev.racer].x;
                y = st.racers[ev.racer].y;
            }
            if (x === undefined || y === undefined) return;
            switch (ev.type) {
                case 'jump':
                    burst(K_DUST, x, y, 7, 60, 0.6, 8, C_DIRT, 6);
                    break;
                case 'land':
                    if (ev.value === 1) {
                        burst(K_DUST, x, y, 8, 80, 0.6, 9, C_DIRT, 8);
                        flash(x, y, 34, 0.35, C_WHITE);
                    } else {
                        burst(K_DUST, x, y, 12, 110, 0.8, 11, C_DIRT, 8);
                        burst(K_CHUNK, x, y, 8, 130, 0.5, 2.4, C_DIRT, 4);
                    }
                    break;
                case 'bump':
                    burst(K_DUST, x, y, 6, 70, 0.5, 8, C_DIRT, 6);
                    burst(K_CHUNK, x, y, 5, 100, 0.4, 2, C_DIRT, 4);
                    break;
                case 'pickup':
                    burst(K_SPARK, x, y, 12, 130, 0.5, 3, C_GOLD, 6);
                    flash(x, y, 36, 0.4, C_GOLD);
                    break;
                case 'boost':
                    burst(K_SPARK, x, y, 14, 170, 0.45, 3, C_BLUE, 8);
                    flash(x, y, 44, 0.35, C_BLUE);
                    break;
                case 'drop': {
                    let col = C_MUD;
                    if (st && st.hazards) {
                        for (let i = 0; i < st.hazards.length; i++) {
                            const h = st.hazards[i];
                            if (Math.abs(h.x - x) < 40 && Math.abs(h.y - y) < 40 && h.type === 'bramble') col = C_LEAF;
                        }
                    }
                    burst(col === C_LEAF ? K_LEAF : K_CHUNK, x, y, 9, 90, 0.5, col === C_LEAF ? 2.8 : 2.6, col, 8);
                    break;
                }
                case 'mud':
                    burst(K_CHUNK, x, y, 14, 150, 0.6, 3, C_MUD, 6);
                    burst(K_DUST, x, y, 4, 40, 0.6, 9, C_MUD, 4);
                    break;
                case 'bramble':
                    burst(K_LEAF, x, y, 12, 150, 0.7, 3, C_LEAF, 6);
                    flash(x, y, 34, 0.4, C_LEAF);
                    break;
                case 'lap':
                    burst(K_SPARK, x, y, 8, 120, 0.5, 2.6, C_GOLD, 4);
                    break;
                case 'finish': {
                    const n = ev.racer === 0 ? 44 : 14;
                    for (let i = 0; i < n; i++) {
                        const a = Math.random() * TAU;
                        const sp = 60 + Math.random() * 190;
                        emit(K_CONFETTI, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1 + Math.random() * 0.9, 2.4 + Math.random() * 1.4, C_CONF + ((Math.random() * 5) | 0), (Math.random() - 0.5) * 18);
                    }
                    flash(x, y, 60, 0.6, C_GOLD);
                    break;
                }
                default:
                    break;
            }
        }
    };
    return api;
}

// ---------------------------------------------------------------------------------------------
// Track thumbnails

/**
 * Draw a small outline preview of the track into the canvas. Cheap: one polyline stroked
 * three times, a start line and a dot.
 */
export function drawTrackThumb(canvas, track) {
    const { ctx, w, h } = prepareCanvas(canvas);
    if (!track) return;
    const th = track.theme;
    const pad = Math.min(w, h) * 0.1;
    // Fit the track bounds (not the whole world) into the canvas
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const n = track.n;
    for (let i = 0; i < n; i++) {
        const x = track.px[i];
        const y = track.py[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const tw = track.width;
    minX -= tw / 2;
    minY -= tw / 2;
    maxX += tw / 2;
    maxY += tw / 2;
    const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const offX = (w - (maxX - minX) * sc) / 2 - minX * sc;
    const offY = (h - (maxY - minY) * sc) / 2 - minY * sc;

    // Background tile
    roundRectPath(ctx, 0, 0, w, h, Math.min(w, h) * 0.14);
    ctx.fillStyle = th.ground;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(w * 0.35, h * 0.3, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Subsample so 30 thumbnails stay cheap
    const stride = Math.max(1, Math.floor(n / 90));
    const path = () => {
        ctx.beginPath();
        for (let i = 0; i < n; i += stride) {
            const x = track.px[i] * sc + offX;
            const y = track.py[i] * sc + offY;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const lw = Math.max(2.5, 2 * hwAt(track, 0) * sc);
    // The track as a band of quads, so wide and narrow parts show in the preview.
    const band = (extra, color) => {
        ctx.beginPath();
        for (let i = 0; i < n; i += stride) {
            const j = i + stride >= n ? 0 : i + stride;
            const a = Math.max(1.25, hwAt(track, i) * sc) + extra;
            const b = Math.max(1.25, hwAt(track, j) * sc) + extra;
            const xi = track.px[i] * sc + offX;
            const yi = track.py[i] * sc + offY;
            const xj = track.px[j] * sc + offX;
            const yj = track.py[j] * sc + offY;
            ctx.moveTo(xi - track.nx[i] * a, yi - track.ny[i] * a);
            ctx.lineTo(xj - track.nx[j] * b, yj - track.ny[j] * b);
            ctx.lineTo(xj + track.nx[j] * b, yj + track.ny[j] * b);
            ctx.lineTo(xi + track.nx[i] * a, yi + track.ny[i] * a);
            ctx.closePath();
        }
        ctx.fillStyle = color;
        ctx.fill();
    };
    band(1.5, th.edge);
    band(0, th.dirt);
    path();
    ctx.lineWidth = Math.max(1, lw * 0.28);
    ctx.strokeStyle = shadeHex(th.dirt, 0.3);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Start line and dot
    const sx = track.px[0] * sc + offX;
    const sy = track.py[0] * sc + offY;
    const a = Math.atan2(track.ty[0], track.tx[0]);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1.2, -lw / 2, 2.4, lw);
    ctx.restore();
    const dr = Math.max(3, Math.min(w, h) * 0.055);
    ctx.beginPath();
    ctx.arc(sx, sy, dr, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#202428';
    ctx.stroke();
}
