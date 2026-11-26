// Racer sprites (seen from above) and face portraits (seen from the front).
// Everything is plain vector drawing with flat fills, so a sprite costs a few dozen path
// operations and allocates nothing per call.
import { CONFIG } from '../config.js';

const TAU = Math.PI * 2;

// Size a canvas for its CSS box times the device pixel ratio and return a 2D context whose
// units are CSS pixels. Falls back to the width and height attributes when the canvas has no
// layout yet. Returns { ctx, w, h } with w and h in CSS pixels.
export function prepareCanvas(canvas, maxDpr = 3) {
    const dpr = Math.max(1, Math.min(maxDpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    let w;
    let h;
    if (cw > 0 && ch > 0) {
        w = cw;
        h = ch;
        // A canvas shown at its intrinsic size keeps that displayed size through an inline style.
        if (canvas.width === Math.round(cw) && canvas.height === Math.round(ch) && !canvas.style.width) {
            canvas.style.width = cw + 'px';
            canvas.style.height = ch + 'px';
        }
        const pw = Math.max(1, Math.round(w * dpr));
        const ph = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
    } else {
        w = canvas.width || 64;
        h = canvas.height || 64;
    }
    const ctx = canvas.getContext('2d');
    const sx = canvas.width / w;
    const sy = canvas.height / h;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
}

export function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mix two hex colours, t = 0 gives a and t = 1 gives b. Returns an rgb() string.
export function mixHex(a, b, t) {
    const ca = hexRgb(a);
    const cb = hexRgb(b);
    return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' + Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' + Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
}

// Lighten (f > 0) or darken (f < 0) a hex colour.
export function shadeHex(hex, f) {
    return f >= 0 ? mixHex(hex, '#ffffff', f) : mixHex(hex, '#000000', -f);
}

function ellipse(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function fillEllipse(ctx, x, y, rx, ry, color, rot = 0) {
    ellipse(ctx, x, y, rx, ry, rot);
    ctx.fillStyle = color;
    ctx.fill();
}

const OUTLINE = 'rgba(20,14,10,0.45)';

function strokeEllipse(ctx, x, y, rx, ry, rot = 0, lw = 0.9) {
    ellipse(ctx, x, y, rx, ry, rot);
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
}

function line(ctx, x1, y1, x2, y2, w, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function tri(ctx, x1, y1, x2, y2, x3, y3, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
}

// Species size multiplier for the top-down sprite.
const BODY_SCALE = { badger: 1, fox: 0.97, bear: 1.14, rabbit: 0.94 };

/**
 * Draw a racer seen from above. Origin is the centre of the bike, the bike points along +x.
 * Units are world units; the caller applies position, heading and any scale.
 * cfg is one entry of CONFIG.racers, steer is -1..1, phase is the pedal phase in radians.
 */
export function drawRacerSprite(ctx, cfg, steer, phase) {
    const sp = cfg.species;
    const k = (CONFIG.phys.riderLength / 46) * (BODY_SCALE[sp] || 1);
    const fur = cfg.fur;
    const dark = cfg.furDark;
    const light = cfg.furLight;
    const marker = cfg.marker;
    const markerDark = shadeHex(marker, -0.35);
    const lean = steer * 2.4;
    const bar = steer * 0.42;
    const sb = Math.sin(bar);
    const cb = Math.cos(bar);
    const legColor = sp === 'rabbit' ? shadeHex(fur, -0.12) : dark;

    ctx.save();
    ctx.scale(k, k);
    ctx.lineJoin = 'round';

    // Rear wheel
    fillEllipse(ctx, -14, 0, 8.6, 3.5, '#1c1e21');
    fillEllipse(ctx, -14, 0, 6.6, 1.5, '#5b6168');
    // Frame
    line(ctx, -14, 0, 10, 0, 5, markerDark);
    line(ctx, -14, 0, 10, 0, 3.3, marker);
    line(ctx, -5, 0, 4, 0, 1.1, shadeHex(marker, 0.45));

    // Tail goes behind the body
    if (sp === 'fox') {
        ctx.save();
        ctx.translate(-10, 1.5 - lean * 0.2);
        ctx.rotate(-0.1 - steer * 0.25);
        fillEllipse(ctx, -9.5, 0, 11, 5.4, fur);
        strokeEllipse(ctx, -9.5, 0, 11, 5.4);
        fillEllipse(ctx, -17.5, 0, 4.4, 4.1, light);
        fillEllipse(ctx, -5.5, -1.4, 5.5, 2, shadeHex(fur, 0.25));
        ctx.restore();
    } else if (sp === 'badger') {
        fillEllipse(ctx, -12.5, 0, 6, 3.4, shadeHex(fur, -0.1));
        strokeEllipse(ctx, -12.5, 0, 6, 3.4);
        fillEllipse(ctx, -16, 0, 2.4, 2, light);
    } else if (sp === 'bear') {
        fillEllipse(ctx, -13, 0, 4.6, 4, shadeHex(fur, -0.1));
        strokeEllipse(ctx, -13, 0, 4.6, 4);
    }

    // Legs, driven by the pedal phase. Hips sit behind the shoulders.
    for (let s = -1; s <= 1; s += 2) {
        const ph = phase + (s > 0 ? 0 : Math.PI);
        const fx = -1 + Math.cos(ph) * 5.2;
        const fy = s * 4.4;
        line(ctx, -5 + lean * 0.2, s * 3.4 + lean * 0.5, fx, fy, 4.6, 'rgba(20,14,10,0.4)');
        line(ctx, -5 + lean * 0.2, s * 3.4 + lean * 0.5, fx, fy, 3.5, legColor);
        fillEllipse(ctx, fx + 1, fy, 2.7, 1.8, '#f2f2f2');
    }

    // Front wheel and fork turn with the steer
    ctx.save();
    ctx.translate(10, 0);
    ctx.rotate(bar);
    fillEllipse(ctx, 4, 0, 8.6, 3.5, '#1c1e21');
    fillEllipse(ctx, 4, 0, 6.6, 1.5, '#5b6168');
    line(ctx, 0, 0, 4, 0, 2.2, '#2b2e33');
    ctx.restore();

    // Torso in fur, with the jersey in the marker colour over the shoulders
    const tx = -3;
    const ty = lean;
    const trx = sp === 'bear' ? 11.5 : 10;
    const try_ = sp === 'bear' ? 9.4 : 7.8;
    fillEllipse(ctx, tx - 1.5, ty, trx, try_, fur);
    strokeEllipse(ctx, tx - 1.5, ty, trx, try_);
    fillEllipse(ctx, tx - 6, ty - try_ * 0.25, trx * 0.5, try_ * 0.4, shadeHex(fur, 0.18));
    fillEllipse(ctx, tx + 1.5, ty, trx * 0.62, try_ * 0.9, marker);
    strokeEllipse(ctx, tx + 1.5, ty, trx * 0.62, try_ * 0.9, 0, 0.7);
    fillEllipse(ctx, tx + 0.5, ty, trx * 0.4, try_ * 0.3, shadeHex(marker, 0.45));

    // Handlebar and arms
    const bx1 = 10 - sb * 11;
    const by1 = -cb * 11;
    const bx2 = 10 + sb * 11;
    const by2 = cb * 11;
    line(ctx, bx1, by1, bx2, by2, 2.6, '#25282c');
    line(ctx, 0.5, ty - 5.4, bx1, by1, 4.2, 'rgba(20,14,10,0.35)');
    line(ctx, 0.5, ty + 5.4, bx2, by2, 4.2, 'rgba(20,14,10,0.35)');
    line(ctx, 0.5, ty - 5.4, bx1, by1, 3.2, fur);
    line(ctx, 0.5, ty + 5.4, bx2, by2, 3.2, fur);
    fillEllipse(ctx, bx1, by1, 2.1, 2, dark);
    fillEllipse(ctx, bx2, by2, 2.1, 2, dark);

    // Head, shifted a little with the lean
    const hx = 8.4;
    const hy = lean * 1.1;
    drawHeadTop(ctx, cfg, hx, hy);

    ctx.restore();
}

function drawHeadTop(ctx, cfg, hx, hy) {
    const sp = cfg.species;
    const fur = cfg.fur;
    const dark = cfg.furDark;
    const light = cfg.furLight;
    const marker = cfg.marker;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(1.1, 1.1);
    if (sp === 'badger') {
        // Small dark ears with pale rims
        fillEllipse(ctx, -1.5, -5.6, 2.5, 2.3, dark);
        fillEllipse(ctx, -1.5, 5.6, 2.5, 2.3, dark);
        fillEllipse(ctx, -0.8, -5.6, 1.1, 1.0, light);
        fillEllipse(ctx, -0.8, 5.6, 1.1, 1.0, light);
        // White head and snout
        fillEllipse(ctx, 0, 0, 6.6, 6.2, light);
        strokeEllipse(ctx, 0, 0, 6.6, 6.2);
        fillEllipse(ctx, 6.5, 0, 5.2, 3.3, light);
        // Two black stripes run from the nose over the crown
        line(ctx, 11, -2.1, -4, -2.9, 2.2, dark);
        line(ctx, 11, 2.1, -4, 2.9, 2.2, dark);
        fillEllipse(ctx, 11.6, 0, 1.5, 1.3, '#15171a');
        // Helmet cap in the marker colour sits over the crown
        fillEllipse(ctx, -1.8, 0, 4.9, 4.6, marker);
        strokeEllipse(ctx, -1.8, 0, 4.9, 4.6);
        fillEllipse(ctx, -2.2, 0, 3.2, 0.9, shadeHex(marker, 0.5));
        line(ctx, 2.2, -3.8, 3.2, -5.5, 0.9, shadeHex(marker, -0.4));
        line(ctx, 2.2, 3.8, 3.2, 5.5, 0.9, shadeHex(marker, -0.4));
    } else if (sp === 'fox') {
        // Big pointed ears laid out to the sides
        tri(ctx, 1.5, -3, -5, -9.6, -3.4, -2.6, fur);
        tri(ctx, 1.5, 3, -5, 9.6, -3.4, 2.6, fur);
        tri(ctx, -0.6, -4.2, -4.4, -8.6, -3.2, -3.6, dark);
        tri(ctx, -0.6, 4.2, -4.4, 8.6, -3.2, 3.6, dark);
        // Round head and long pointed muzzle with a white tip
        fillEllipse(ctx, 0, 0, 6.1, 5.9, fur);
        strokeEllipse(ctx, 0, 0, 6.1, 5.9);
        tri(ctx, 3, -4.6, 3, 4.6, 12.8, 0, fur);
        tri(ctx, 7, -2.8, 7, 2.8, 12.8, 0, light);
        fillEllipse(ctx, 12.4, 0, 1.3, 1.2, '#15171a');
        fillEllipse(ctx, 1.5, -4.2, 2.4, 1.6, light, 0.4);
        fillEllipse(ctx, 1.5, 4.2, 2.4, 1.6, light, -0.4);
        // Helmet
        fillEllipse(ctx, -1.8, 0, 4.7, 4.6, marker);
        strokeEllipse(ctx, -1.8, 0, 4.7, 4.6);
        fillEllipse(ctx, -2.2, 0, 3.1, 0.9, shadeHex(marker, 0.5));
    } else if (sp === 'bear') {
        fillEllipse(ctx, -1.8, -6.6, 3, 2.9, dark);
        fillEllipse(ctx, -1.8, 6.6, 3, 2.9, dark);
        fillEllipse(ctx, -1.6, -6.4, 1.4, 1.3, cfg.furLight);
        fillEllipse(ctx, -1.6, 6.4, 1.4, 1.3, cfg.furLight);
        fillEllipse(ctx, 0, 0, 7.6, 7.3, fur);
        strokeEllipse(ctx, 0, 0, 7.6, 7.3);
        fillEllipse(ctx, 6.2, 0, 4.4, 3.7, light);
        strokeEllipse(ctx, 6.2, 0, 4.4, 3.7, 0, 0.6);
        fillEllipse(ctx, 9.9, 0, 1.9, 1.6, '#15171a');
        fillEllipse(ctx, -2, 0, 5.7, 5.3, marker);
        strokeEllipse(ctx, -2, 0, 5.7, 5.3);
        fillEllipse(ctx, -2.4, 0, 3.6, 1, shadeHex(marker, 0.5));
    } else {
        // Rabbit: long ears laid back along the shoulders
        for (let s = -1; s <= 1; s += 2) {
            ctx.save();
            ctx.translate(-1, s * 3.2);
            ctx.rotate(s * 0.2 + Math.PI);
            fillEllipse(ctx, 6.6, 0, 8.2, 2.5, fur);
            strokeEllipse(ctx, 6.6, 0, 8.2, 2.5);
            fillEllipse(ctx, 6.6, 0, 6, 1.1, '#f0a8b4');
            ctx.restore();
        }
        fillEllipse(ctx, 0, 0, 5.7, 5.4, fur);
        strokeEllipse(ctx, 0, 0, 5.7, 5.4);
        fillEllipse(ctx, 5.4, 0, 3.4, 2.7, light);
        fillEllipse(ctx, 8.4, 0, 1.2, 1.1, '#e58aa0');
        fillEllipse(ctx, -1.8, 0, 4.4, 4.3, marker);
        strokeEllipse(ctx, -1.8, 0, 4.4, 4.3);
        fillEllipse(ctx, -2.2, 0, 2.9, 0.9, shadeHex(marker, 0.5));
        // White pom pom tail peeks out behind
    }
    ctx.restore();
    if (sp === 'rabbit') {
        fillEllipse(ctx, -12.5, 0, 3.6, 3.4, '#ffffff');
        strokeEllipse(ctx, -12.5, 0, 3.6, 3.4);
    }
}

// ---------------------------------------------------------------------------------------------
// Portraits

function findRacer(id) {
    for (let i = 0; i < CONFIG.racers.length; i++) {
        if (CONFIG.racers[i].id === id) return CONFIG.racers[i];
    }
    return CONFIG.racers[0];
}

function pathBlob(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
}

function eye(ctx, x, y, r) {
    fillEllipse(ctx, x, y, r, r * 1.15, '#15171a');
    fillEllipse(ctx, x + r * 0.3, y - r * 0.4, r * 0.38, r * 0.38, '#ffffff');
}

function helmet(ctx, marker, cy, rx, ry) {
    // Dome with a rim, vents and a chin strap seen from the front
    ctx.beginPath();
    ctx.ellipse(50, cy, rx, ry, 0, Math.PI, TAU);
    ctx.lineTo(50 + rx, cy + 2);
    ctx.quadraticCurveTo(50, cy + 6, 50 - rx, cy + 2);
    ctx.closePath();
    ctx.fillStyle = marker;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20,14,10,0.5)';
    ctx.stroke();
    // Highlight
    ctx.beginPath();
    ctx.ellipse(44, cy - ry * 0.55, rx * 0.5, ry * 0.18, -0.35, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    // Vents
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(50 + i * 9, cy - ry * 0.62, 2.2, 5, i * 0.25, 0, TAU);
        ctx.fillStyle = shadeHex(marker, -0.4);
        ctx.fill();
    }
    // Brow band
    ctx.beginPath();
    ctx.moveTo(50 - rx, cy + 1);
    ctx.quadraticCurveTo(50, cy + 7, 50 + rx, cy + 1);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = shadeHex(marker, -0.35);
    ctx.stroke();
}

/**
 * Draw a friendly face of the racer with a helmet in the marker colour. The canvas is sized
 * from its CSS box (or its attributes) and the artwork is scaled into the shortest side.
 */
// Brock uses the official Trailbadger head artwork. The drawn face below is the fallback
// while the image loads or when it is unavailable.
let brockImg = null;

function brockArt() {
    if (!brockImg && typeof Image !== 'undefined') {
        brockImg = new Image();
        brockImg.src = new URL('../../assets/img/brock.webp', import.meta.url).href;
    }
    return brockImg;
}

export function drawPortrait(canvas, racerId) {
    const { ctx, w, h } = prepareCanvas(canvas);
    const cfg = findRacer(racerId);
    const size = Math.min(w, h);
    if (racerId === 'brock') {
        const img = brockArt();
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.translate((w - size) / 2, (h - size) / 2);
            ctx.scale(size / 100, size / 100);
            ctx.beginPath();
            ctx.arc(50, 50, 49, 0, TAU);
            ctx.fillStyle = mixHex(cfg.marker, '#1d2b1f', 0.62);
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = cfg.marker;
            ctx.stroke();
            const iw = 88;
            const ih = iw * img.naturalHeight / img.naturalWidth;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 50 - iw / 2, 51 - ih / 2, iw, ih);
            ctx.restore();
            return;
        }
        if (img && !img.complete) {
            img.addEventListener('load', () => drawPortrait(canvas, racerId), { once: true });
        }
    }
    ctx.save();
    ctx.translate((w - size) / 2, (h - size) / 2);
    ctx.scale(size / 100, size / 100);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Round badge in a soft tint of the marker colour
    ctx.save();
    ctx.beginPath();
    ctx.arc(50, 50, 49, 0, TAU);
    ctx.clip();
    ctx.fillStyle = mixHex(cfg.marker, '#1d2b1f', 0.62);
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(34, 28, 40, 0, TAU);
    ctx.fill();

    // Shoulders in the jersey colour
    ctx.beginPath();
    ctx.moveTo(6, 104);
    ctx.quadraticCurveTo(10, 78, 36, 76);
    ctx.lineTo(64, 76);
    ctx.quadraticCurveTo(90, 78, 94, 104);
    ctx.closePath();
    ctx.fillStyle = cfg.marker;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20,14,10,0.45)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(40, 76);
    ctx.quadraticCurveTo(50, 90, 60, 76);
    ctx.fillStyle = shadeHex(cfg.marker, -0.3);
    ctx.fill();

    const sp = cfg.species;
    if (sp === 'badger') drawBadgerFace(ctx, cfg);
    else if (sp === 'fox') drawFoxFace(ctx, cfg);
    else if (sp === 'bear') drawBearFace(ctx, cfg);
    else drawRabbitFace(ctx, cfg);
    ctx.restore();

    // Rim
    ctx.beginPath();
    ctx.arc(50, 50, 48.2, 0, TAU);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = cfg.marker;
    ctx.stroke();
    ctx.restore();
}

function drawBadgerFace(ctx, cfg) {
    // Ears
    fillEllipse(ctx, 26, 30, 8, 8, cfg.furDark);
    fillEllipse(ctx, 74, 30, 8, 8, cfg.furDark);
    fillEllipse(ctx, 26, 31, 4, 4, cfg.furLight);
    fillEllipse(ctx, 74, 31, 4, 4, cfg.furLight);
    // Neck fur
    fillEllipse(ctx, 50, 76, 24, 9, cfg.fur);
    // Head
    ctx.beginPath();
    ctx.moveTo(50, 22);
    ctx.bezierCurveTo(78, 22, 82, 52, 70, 68);
    ctx.quadraticCurveTo(50, 84, 30, 68);
    ctx.bezierCurveTo(18, 52, 22, 22, 50, 22);
    ctx.fillStyle = cfg.furLight;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20,14,10,0.45)';
    ctx.stroke();
    // Two black stripes over each eye
    ctx.save();
    ctx.clip();
    ctx.fillStyle = cfg.furDark;
    ctx.beginPath();
    ctx.moveTo(34, 20);
    ctx.lineTo(44, 20);
    ctx.lineTo(48, 76);
    ctx.lineTo(41, 76);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(66, 20);
    ctx.lineTo(56, 20);
    ctx.lineTo(52, 76);
    ctx.lineTo(59, 76);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Face features
    eye(ctx, 39, 54, 3.3);
    eye(ctx, 61, 54, 3.3);
    fillEllipse(ctx, 50, 66, 5, 3.6, '#15171a');
    ctx.beginPath();
    ctx.moveTo(43, 72);
    ctx.quadraticCurveTo(50, 78, 57, 72);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#15171a';
    ctx.stroke();
    helmet(ctx, cfg.marker, 40, 26, 21);
}

function drawFoxFace(ctx, cfg) {
    // Tall pointed ears
    tri(ctx, 22, 44, 20, 6, 44, 30, cfg.fur);
    tri(ctx, 78, 44, 80, 6, 56, 30, cfg.fur);
    tri(ctx, 26, 36, 25, 15, 38, 30, cfg.furDark);
    tri(ctx, 74, 36, 75, 15, 62, 30, cfg.furDark);
    fillEllipse(ctx, 50, 78, 22, 8, cfg.furLight);
    // Face: wide cheeks narrowing to the chin
    ctx.beginPath();
    ctx.moveTo(50, 24);
    ctx.bezierCurveTo(80, 24, 90, 52, 78, 58);
    ctx.quadraticCurveTo(64, 70, 50, 84);
    ctx.quadraticCurveTo(36, 70, 22, 58);
    ctx.bezierCurveTo(10, 52, 20, 24, 50, 24);
    ctx.fillStyle = cfg.fur;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20,14,10,0.45)';
    ctx.stroke();
    // White cheeks and muzzle
    ctx.beginPath();
    ctx.moveTo(21, 58);
    ctx.quadraticCurveTo(34, 56, 50, 66);
    ctx.quadraticCurveTo(66, 56, 79, 58);
    ctx.quadraticCurveTo(66, 70, 50, 84);
    ctx.quadraticCurveTo(34, 70, 21, 58);
    ctx.fillStyle = cfg.furLight;
    ctx.fill();
    eye(ctx, 38, 52, 3.3);
    eye(ctx, 62, 52, 3.3);
    fillEllipse(ctx, 50, 69, 4.6, 3.4, '#15171a');
    ctx.beginPath();
    ctx.moveTo(44, 75);
    ctx.quadraticCurveTo(50, 79, 56, 75);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#15171a';
    ctx.stroke();
    helmet(ctx, cfg.marker, 40, 24, 19);
}

function drawBearFace(ctx, cfg) {
    fillEllipse(ctx, 25, 30, 10, 10, cfg.furDark);
    fillEllipse(ctx, 75, 30, 10, 10, cfg.furDark);
    fillEllipse(ctx, 25, 31, 5, 5, cfg.furLight);
    fillEllipse(ctx, 75, 31, 5, 5, cfg.furLight);
    fillEllipse(ctx, 50, 76, 27, 10, cfg.fur);
    fillEllipse(ctx, 50, 52, 31, 29, cfg.fur);
    strokeEllipse(ctx, 50, 52, 31, 29, 0, 1.6);
    fillEllipse(ctx, 50, 65, 15, 12, cfg.furLight);
    strokeEllipse(ctx, 50, 65, 15, 12, 0, 1);
    eye(ctx, 36, 52, 3.4);
    eye(ctx, 64, 52, 3.4);
    fillEllipse(ctx, 50, 60, 6, 4.4, '#15171a');
    ctx.beginPath();
    ctx.moveTo(50, 64);
    ctx.lineTo(50, 69);
    ctx.moveTo(43, 72);
    ctx.quadraticCurveTo(50, 77, 57, 72);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#15171a';
    ctx.stroke();
    helmet(ctx, cfg.marker, 40, 28, 20);
}

function drawRabbitFace(ctx, cfg) {
    // Long ears stand tall and the helmet sits between them
    for (let s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(50 + s * 15, 28);
        ctx.rotate(s * 0.14);
        fillEllipse(ctx, 0, -14, 7, 22, cfg.fur);
        strokeEllipse(ctx, 0, -14, 7, 22, 0, 1.6);
        fillEllipse(ctx, 0, -12, 3.6, 16, '#f0a8b4');
        ctx.restore();
    }
    fillEllipse(ctx, 50, 77, 22, 8, cfg.fur);
    ctx.beginPath();
    ctx.moveTo(50, 24);
    ctx.bezierCurveTo(78, 24, 82, 52, 72, 66);
    ctx.quadraticCurveTo(50, 84, 28, 66);
    ctx.bezierCurveTo(18, 52, 22, 24, 50, 24);
    ctx.fillStyle = cfg.fur;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20,14,10,0.4)';
    ctx.stroke();
    fillEllipse(ctx, 50, 66, 13, 10, cfg.furLight);
    eye(ctx, 37, 54, 3.4);
    eye(ctx, 63, 54, 3.4);
    fillEllipse(ctx, 50, 62, 3.8, 2.8, '#e58aa0');
    ctx.beginPath();
    ctx.moveTo(50, 65);
    ctx.lineTo(50, 69);
    ctx.moveTo(44, 71);
    ctx.quadraticCurveTo(50, 76, 56, 71);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#8d5a68';
    ctx.stroke();
    // Teeth
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(47.5, 71.6, 2.4, 3.4);
    ctx.fillRect(50.2, 71.6, 2.4, 3.4);
    helmet(ctx, cfg.marker, 41, 24, 17);
}
