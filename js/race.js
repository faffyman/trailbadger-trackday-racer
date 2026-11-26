// Track Day Racer: race simulation. Pure module, no DOM access.
// createRace(track) returns { state, step(dt, input), results() }.
// The state object and the racer objects are created once and then only mutated,
// so the renderer and the UI can keep references to them for the whole race.

import { CONFIG } from './config.js';

const TWO_PI = Math.PI * 2;

// Tuning that belongs to this module (everything physical comes from CONFIG).
const STEER_SMOOTH = 20;          // 1/s, how fast the steer value follows the input
const AIR_TURN_SCALE = 0.6;       // heading control while airborne
const OVER_MAX_DRAG = 180;        // deceleration above the max speed on the track (boost ending)
const PEDAL_PIVOT = 0.35;         // with the pedal held a rider can still pivot slowly at a standstill
const COLLIDE_SCRUB = 0.6;        // 1/s speed loss while two riders overlap
const HAZARD_TOUCH = 0.3;         // share of riderRadius added to a hazard radius for touching
const PEDAL_PHASE_RATE = 0.28;    // radians of leg animation per unit ridden
const WRONG_WAY_SPEED = 30;       // speed against the tangent that counts as going the wrong way
const WRONG_WAY_TIME = 1.0;       // seconds against the tangent before wrongWay is set
const RUBBER_MAX = 0.05;          // AI speed change when far ahead or far behind the player
const RUBBER_FAR = 0.12;          // laps of distance that count as far
const AI_TURN_USE = 0.85;        // share of the turn rate an AI plans to use in a corner
const AI_EASE = 0.88;             // overall AI pace factor, so a clean full speed player can just beat the field
const AI_MIN_LOOK = 48;           // shortest look ahead distance in units
const AI_STEER_GAIN = 2.4;
const AI_LANE_RATE = 0.9;         // lane change speed as a multiple of the track width per second
const AI_START_DELAY = 0.12;      // reaction time at the start, plus a little more per rider
const AI_FINISHED_PACE = 0.5;     // pace of an AI rider who has finished while the player still races

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function wrapAngle(a) {
    if (!Number.isFinite(a)) return 0;
    a %= TWO_PI;
    if (a > Math.PI) a -= TWO_PI;
    else if (a < -Math.PI) a += TWO_PI;
    return a;
}

export function createRace(track) {
    const phys = CONFIG.phys;
    const pk = CONFIG.pickups;
    const world = CONFIG.world;
    const px = track.px;
    const py = track.py;
    const tx = track.tx;
    const ty = track.ty;
    const nx = track.nx;
    const ny = track.ny;
    const curv = track.curv;
    const n = track.n || px.length;
    const step0 = track.step || (track.length / n) || 12;
    const width = track.width;
    const half = width / 2;
    // Local half width per sample. Older track data without hw uses the nominal width.
    const hwArr = track.hw || new Float32Array(n).fill(half);
    const laps = track.laps;
    const aiPace = track.aiPace || 1;
    const rr = phys.riderRadius;

    function wrapIdx(i) {
        const m = ((i % n) + n) % n;
        return m >= n ? 0 : m;
    }

    // Track lookup helpers ------------------------------------------------------------

    // Per sample berm side (0 = none). The AI version starts a little earlier so riders
    // move to the outer lane before the bend begins.
    const bermReal = new Int8Array(n);
    const bermAi = new Int8Array(n);
    for (const b of track.berms || []) {
        for (let i = Math.max(0, b.from - 4); i <= b.to && i < n; i++) {
            bermAi[i] = b.side;
            if (i >= b.from) bermReal[i] = b.side;
        }
    }

    // Absolute curvature smoothed over five samples.
    const curvAbs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) s += Math.abs(curv[wrapIdx(i + k)]) || 0;
        curvAbs[i] = s / 5;
    }

    const pt = { x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: 1 };

    // Interpolated centreline point at the float sample position sf, written into pt.
    function lookup(sf) {
        const s = wrapIdx(sf);
        const i0 = Math.min(n - 1, Math.floor(s));
        const i1 = (i0 + 1) % n;
        const f = s - i0;
        pt.x = px[i0] + (px[i1] - px[i0]) * f;
        pt.y = py[i0] + (py[i1] - py[i0]) * f;
        let ux = tx[i0] + (tx[i1] - tx[i0]) * f;
        let uy = ty[i0] + (ty[i1] - ty[i0]) * f;
        const len = Math.hypot(ux, uy);
        if (len > 1e-6) {
            ux /= len;
            uy /= len;
        } else {
            ux = tx[i0];
            uy = ty[i0];
        }
        pt.tx = ux;
        pt.ty = uy;
        pt.nx = -uy;
        pt.ny = ux;
        return pt;
    }

    // Largest smoothed curvature from sample sf over the next dist units.
    function maxCurvAhead(sf, dist) {
        const count = Math.min(Math.ceil(dist / step0) + 1, (n >> 1));
        const i0 = Math.floor(wrapIdx(sf));
        let m = 0;
        for (let k = 0; k <= count; k++) {
            const c = curvAbs[(i0 + k) % n];
            if (c > m) m = c;
        }
        return m;
    }

    // Lateral offset of a world point measured against the nearest of count samples from i0.
    function lateralAt(x, y, i0, count) {
        let best = Infinity;
        let off = 0;
        for (let k = 0; k <= count; k++) {
            const i = (i0 + k) % n;
            const dx = x - px[i];
            const dy = y - py[i];
            const d = dx * dx + dy * dy;
            if (d < best) {
                best = d;
                off = dx * nx[i] + dy * ny[i];
            }
        }
        return off;
    }

    // State ---------------------------------------------------------------------------

    const state = {
        phase: 'countdown',
        countdown: CONFIG.countdown,
        time: 0,
        racers: [],
        pickups: [],
        hazards: [],
        events: []
    };

    // Internal per rider data, kept apart from the public RacerState.
    const ext = [];
    const rankOrder = [];

    function emit(type, racer, x, y, value) {
        const ev = { type, racer };
        if (x !== undefined) ev.x = x;
        if (y !== undefined) ev.y = y;
        if (value !== undefined) ev.value = value;
        state.events.push(ev);
    }

    function nearestGlobal(x, y) {
        let best = Infinity;
        let bi = 0;
        for (let i = 0; i < n; i++) {
            const dx = x - px[i];
            const dy = y - py[i];
            const d = dx * dx + dy * dy;
            if (d < best) {
                best = d;
                bi = i;
            }
        }
        return bi;
    }

    const grid = track.grid && track.grid.length ? track.grid : [{ x: px[0], y: py[0], angle: Math.atan2(ty[0], tx[0]) }];
    const back = Math.max(2, Math.floor(0.05 * n));
    const fwd = Math.max(4, Math.ceil(0.15 * n));

    CONFIG.racers.forEach((cfg, idx) => {
        const slot = grid[(idx === 0 ? 3 : idx - 1) % grid.length];
        const bi = nearestGlobal(slot.x, slot.y);
        const along = (slot.x - px[bi]) * tx[bi] + (slot.y - py[bi]) * ty[bi];
        let sf = wrapIdx(bi + clamp(along / step0, -1, 1));
        // The grid sits behind the line, so a start position near the end of the sample
        // list counts as negative progress, not as a completed lap.
        const total = sf > n / 2 ? sf - n : sf;
        state.racers.push({
            id: cfg.id,
            isPlayer: idx === 0,
            x: slot.x,
            y: slot.y,
            angle: slot.angle,
            vx: 0,
            vy: 0,
            speed: 0,
            z: 0,
            air: false,
            steer: 0,
            pedalPhase: 0,
            boost: 0,
            mud: 0,
            bramble: 0,
            offroad: false,
            onBerm: false,
            lap: 0,
            progress: Math.max(0, total / n),
            place: idx + 1,
            wrongWay: false,
            finished: false,
            finishTime: null,
            bestLap: null,
            lastLap: null
        });
        ext.push({
            idx: bi,
            sf,
            total,
            best: total,
            lapStart: 0,
            vz: 0,
            off: 0,
            wrongT: 0,
            stuckT: 0,
            recover: 0,
            laneCur: cfg.ai ? cfg.ai.lane * width : 0,
            startDelay: AI_START_DELAY + 0.06 * idx,
            ctl: { steer: 0, pedal: false, brake: false }
        });
        rankOrder.push(idx);
    });

    const racers = state.racers;
    const spots = track.pickupSpots || [];
    const pickT = [];
    spots.forEach((s) => {
        lookup(s.i);
        state.pickups.push({
            x: pt.x + pt.nx * s.off,
            y: pt.y + pt.ny * s.off,
            type: s.type,
            active: true
        });
        pickT.push(0);
    });

    function cmpRank(a, b) {
        const ra = racers[a];
        const rb = racers[b];
        if (ra.finished !== rb.finished) return ra.finished ? -1 : 1;
        if (ra.finished) return (ra.finishTime - rb.finishTime) || (a - b);
        const d = ext[b].total - ext[a].total;
        return d || (a - b);
    }

    function rank() {
        rankOrder.sort(cmpRank);
        for (let p = 0; p < rankOrder.length; p++) racers[rankOrder[p]].place = p + 1;
    }
    rank();

    // Locating a rider on the track, laps and jump take off ---------------------------

    function locate(i, dt, racing) {
        const r = racers[i];
        const e = ext[i];
        const span = back + fwd + 1;
        let bestI = e.idx;
        let bestD = Infinity;
        if (span >= n) {
            for (let k = 0; k < n; k++) {
                const dx = r.x - px[k];
                const dy = r.y - py[k];
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                    bestD = d;
                    bestI = k;
                }
            }
        } else {
            for (let k = -back; k <= fwd; k++) {
                let idx = e.idx + k;
                if (idx < 0) idx += n;
                else if (idx >= n) idx -= n;
                const dx = r.x - px[idx];
                const dy = r.y - py[idx];
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                    bestD = d;
                    bestI = idx;
                }
            }
        }
        const dx = r.x - px[bestI];
        const dy = r.y - py[bestI];
        const along = dx * tx[bestI] + dy * ty[bestI];
        const off = dx * nx[bestI] + dy * ny[bestI];
        const dist = Math.sqrt(bestD);
        e.off = off;
        const near = dist <= width * 3;
        let jumpDelta = 0;
        const prevSf = e.sf;

        if (near) {
            e.idx = bestI;
            const newSf = wrapIdx(bestI + clamp(along / step0, -1, 1));
            let delta = newSf - prevSf;
            if (delta > n / 2) delta -= n;
            else if (delta < -n / 2) delta += n;
            e.sf = newSf;
            e.total += delta;
            jumpDelta = delta;
        }

        r.offroad = !r.air && Math.abs(off) > hwArr[bestI];
        const side = bermReal[bestI];
        r.onBerm = !r.air && !r.offroad && side !== 0 && off * side > 4;

        // Jump take off when the lip is crossed forwards on the track and on the ground.
        if (jumpDelta > 0 && !r.air && Math.abs(off) <= hwArr[bestI] && track.jumps) {
            for (let j = 0; j < track.jumps.length; j++) {
                const d = wrapIdx(track.jumps[j].i - prevSf);
                if (d > 0 && d <= jumpDelta) {
                    if (r.speed >= phys.jumpMinSpeed) {
                        r.air = true;
                        r.z = 0.01;
                        e.vz = r.speed * phys.jumpVz;
                        r.offroad = false;
                        r.onBerm = false;
                        emit('jump', i, r.x, r.y, r.speed);
                    } else {
                        r.vx *= phys.bumpFactor;
                        r.vy *= phys.bumpFactor;
                        r.speed *= phys.bumpFactor;
                        emit('bump', i, r.x, r.y, r.speed);
                    }
                    break;
                }
            }
        }

        // Direction of travel against the tangent.
        const vdot = r.vx * tx[bestI] + r.vy * ty[bestI];
        if (racing && vdot < -WRONG_WAY_SPEED) e.wrongT += dt;
        else e.wrongT = Math.max(0, e.wrongT - dt * 2);
        r.wrongWay = racing && e.wrongT > WRONG_WAY_TIME;

        if (racing && !r.finished) {
            if (e.total > e.best) e.best = e.total;
            // The best total only grows, so reversing over the line and crossing again
            // gives no extra lap.
            while (e.best >= (r.lap + 1) * n && !r.finished) {
                r.lap++;
                const over = e.best - r.lap * n;
                const tNow = Math.max(0, state.time - Math.min(dt, (over * step0) / Math.max(r.speed, 30)));
                const lapTime = tNow - e.lapStart;
                e.lapStart = tNow;
                r.lastLap = lapTime;
                if (r.bestLap === null || lapTime < r.bestLap) r.bestLap = lapTime;
                if (r.lap >= laps) {
                    r.finished = true;
                    r.finishTime = tNow;
                    emit('finish', i, r.x, r.y, tNow);
                } else {
                    emit('lap', i, r.x, r.y, lapTime);
                }
            }
        }
        if (r.finished) r.progress = laps;
        else r.progress = Math.max(r.lap, e.total / n);
        if (!Number.isFinite(r.progress)) r.progress = r.lap;
    }

    // AI controller -------------------------------------------------------------------

    function aiControl(i, dt, mode) {
        // mode: 'race', 'finished' (done, rider keeps circling slowly) or 'stop' (coast)
        const r = racers[i];
        const e = ext[i];
        const cfg = CONFIG.racers[i];
        const ai = cfg.ai || { skill: 0.9, lookahead: 0.35, lane: 0 };
        const stats = cfg.stats;
        const out = e.ctl;
        const speed = r.speed;

        if (e.recover > 0) e.recover -= dt;
        const recovering = e.recover > 0;
        const lost = r.offroad || recovering;

        let look = Math.max(AI_MIN_LOOK, ai.lookahead * speed);
        if (lost) look = Math.max(40, look * 0.6);

        // Wanted lane
        const ahead = Math.floor(wrapIdx(e.sf + (look * 0.8) / step0));
        // Lanes scale with the local width: the narrower of here and the aim point.
        const halfL = Math.min(hwArr[ahead], hwArr[e.idx]);
        const widthL = halfL * 2;
        let want = ai.lane * widthL;
        if (mode === 'finished') want = (ai.lane >= 0 ? 1 : -1) * widthL * 0.34;
        const bs = bermAi[ahead];
        if (bs !== 0 && mode !== 'finished') want = bs * widthL * 0.27;

        if (mode === 'race') {
            // Take a boost pickup that lies ahead and is not far from the wanted lane.
            const reach = (look * 2.4) / step0;
            let bestAhead = Infinity;
            for (let k = 0; k < spots.length; k++) {
                const p = state.pickups[k];
                if (!p.active || p.type !== 'boost') continue;
                const d = wrapIdx(spots[k].i - e.sf);
                if (d > 0 && d < reach && d < bestAhead) {
                    bestAhead = d;
                    want = spots[k].off;
                }
            }
        }

        // Keep clear of a hazard ahead that belongs to somebody else.
        const hz = state.hazards;
        for (let k = 0; k < hz.length; k++) {
            const h = hz[k];
            if (h.owner === i) continue;
            const hx = h.x - r.x;
            const hy = h.y - r.y;
            const fwdDot = hx * Math.cos(r.angle) + hy * Math.sin(r.angle);
            const dd = Math.hypot(hx, hy);
            if (fwdDot < -5 || dd > look * 1.8 + 70) continue;
            const ho = lateralAt(h.x, h.y, Math.floor(e.sf), Math.ceil((dd + 40) / step0));
            if (Math.abs(ho - want) < 52) {
                const lim = halfL - 20;
                const a = clamp(ho + 52, -lim, lim);
                const b = clamp(ho - 52, -lim, lim);
                want = Math.abs(a - ho) >= Math.abs(b - ho) ? a : b;
            }
        }

        const lim = halfL - 20;
        want = clamp(want, -lim, lim);
        if (lost) want = 0;
        const maxD = width * AI_LANE_RATE * dt;
        e.laneCur += clamp(want - e.laneCur, -maxD, maxD);

        // Aim point
        lookup(e.sf + look / step0);
        const ax = pt.x + pt.nx * e.laneCur;
        const ay = pt.y + pt.ny * e.laneCur;

        let err;
        if (r.air) {
            err = wrapAngle(Math.atan2(r.vy, r.vx) - r.angle) * 1.5;
        } else {
            const dir = Math.atan2(ay - r.y, ax - r.x);
            let ref = r.angle;
            if (speed > 80) {
                const velAng = Math.atan2(r.vy, r.vx);
                ref = wrapAngle(r.angle + 0.5 * wrapAngle(velAng - r.angle));
            }
            err = wrapAngle(dir - ref);
        }
        out.steer = clamp(err * (recovering ? AI_STEER_GAIN * 1.5 : AI_STEER_GAIN), -1, 1);

        if (mode === 'stop') {
            out.pedal = false;
            out.brake = false;
            return out;
        }

        // Target speed from the bends ahead
        const kmax = maxCurvAhead(e.sf, speed * 0.8 + 70);
        const vCap = (r.boost > 0 ? phys.boostSpeed : phys.maxSpeed) * stats.speed;
        const vCurve = kmax > 1e-5 ? (AI_TURN_USE * phys.turnRate) / kmax : Infinity;
        let rubber = 1;
        if (mode === 'race' && !racers[0].finished) {
            const diff = (e.total - ext[0].total) / n;
            rubber = 1 - RUBBER_MAX * clamp(diff / RUBBER_FAR, -1, 1);
        }
        let target = Math.min(vCap, vCurve) * ai.skill * aiPace * AI_EASE * rubber;
        if (mode === 'finished') target *= AI_FINISHED_PACE;
        if (recovering) target = Math.max(target, 90);

        // Stuck detection: slow for a long time while wanting to go.
        if (!r.air && speed < 22) e.stuckT += dt;
        else e.stuckT = Math.max(0, e.stuckT - dt * 2);
        if (e.stuckT > 1.0) {
            e.recover = 1.2;
            e.stuckT = 0;
        }

        out.pedal = speed < target || recovering;
        out.brake = !recovering && speed > target * 1.12 + 12;
        if (out.brake) out.pedal = false;
        return out;
    }

    // Rider physics -------------------------------------------------------------------

    // Soft barrier along both track edges: a rider may run wide by edgeAllow units past the
    // local edge, then is pushed back, bounces a little and loses some speed.
    function fence(i) {
        const r = racers[i];
        const i0 = ext[i].idx;
        let best = Infinity;
        let bi = i0;
        for (let k = -6; k <= 6; k++) {
            let idx = i0 + k;
            if (idx < 0) idx += n;
            else if (idx >= n) idx -= n;
            const ddx = r.x - px[idx];
            const ddy = r.y - py[idx];
            const d = ddx * ddx + ddy * ddy;
            if (d < best) {
                best = d;
                bi = idx;
            }
        }
        const off = (r.x - px[bi]) * nx[bi] + (r.y - py[bi]) * ny[bi];
        const limit = hwArr[bi] + phys.edgeAllow;
        if (Math.abs(off) > limit) {
            const sgn = off > 0 ? 1 : -1;
            const over = Math.abs(off) - limit;
            r.x -= nx[bi] * sgn * over;
            r.y -= ny[bi] * sgn * over;
            const vn = (r.vx * nx[bi] + r.vy * ny[bi]) * sgn;
            if (vn > 0) {
                const k = vn * (1 + phys.edgeBounce);
                r.vx -= nx[bi] * sgn * k;
                r.vy -= ny[bi] * sgn * k;
                if (vn > 25) {
                    r.vx *= phys.edgeSlow;
                    r.vy *= phys.edgeSlow;
                }
            }
        }
    }

    function moveRider(i, steerIn, pedal, brake, dt) {
        const r = racers[i];
        const e = ext[i];
        const stats = CONFIG.racers[i].stats;

        if (r.boost > 0) r.boost = Math.max(0, r.boost - dt);
        if (r.mud > 0) r.mud = Math.max(0, r.mud - dt);
        if (r.bramble > 0) r.bramble = Math.max(0, r.bramble - dt);

        if (r.bramble > 0) {
            r.steer = 0;
        } else {
            r.steer += (clamp(steerIn, -1, 1) - r.steer) * (1 - Math.exp(-STEER_SMOOTH * dt));
        }

        if (r.air) {
            r.angle = wrapAngle(r.angle + r.steer * phys.turnRate * AIR_TURN_SCALE * dt);
            r.x += r.vx * dt;
            r.y += r.vy * dt;
            r.z += e.vz * dt;
            e.vz -= phys.gravity * dt;
            if (r.z <= 0 && e.vz < 0) {
                r.z = 0;
                e.vz = 0;
                r.air = false;
                const velAng = Math.atan2(r.vy, r.vx);
                const diff = Math.abs(wrapAngle(r.angle - velAng));
                if (diff <= phys.cleanLandAngle) {
                    r.boost = Math.max(r.boost, phys.cleanLandBoost);
                    emit('land', i, r.x, r.y, 1);
                } else {
                    r.vx *= phys.bumpFactor;
                    r.vy *= phys.bumpFactor;
                    emit('land', i, r.x, r.y, 0);
                }
            }
        } else {
            let speed = Math.hypot(r.vx, r.vy);
            const turnSpeed = Math.max(speed, pedal ? phys.turnMinSpeed * PEDAL_PIVOT : 0);
            const turnScale = clamp(turnSpeed / Math.max(phys.turnMinSpeed, 1e-6), 0, 1);
            r.angle = wrapAngle(r.angle + r.steer * phys.turnRate * turnScale * dt);

            const fx = Math.cos(r.angle);
            const fy = Math.sin(r.angle);
            let vl = r.vx * fx + r.vy * fy;
            let vs = -r.vx * fy + r.vy * fx;

            let maxS = phys.maxSpeed * stats.speed;
            let accel = phys.accel * stats.accel;
            if (r.boost > 0) {
                maxS = phys.boostSpeed * stats.speed;
                accel = phys.boostAccel * stats.accel;
            }
            if (r.onBerm) maxS *= phys.bermSpeedBonus;
            let drag = OVER_MAX_DRAG;
            if (r.offroad) {
                maxS = Math.min(maxS, phys.offroadMax * (r.boost > 0 ? 1.3 : 1));
                drag = phys.offroadDrag;
            }
            if (r.mud > 0) {
                maxS = Math.min(maxS, phys.mudMax);
                drag = phys.offroadDrag;
            }

            if (brake) {
                vl -= phys.brake * dt;
            } else if (pedal || r.boost > 0) {
                const inc = Math.min(accel * dt, Math.max(0, maxS - speed));
                vl += inc;
            } else {
                vl -= phys.coast * dt;
            }
            if (vl < 0) vl = 0;

            const grip = (r.onBerm ? phys.gripBerm : phys.grip) * stats.grip;
            vs *= Math.exp(-grip * dt);

            speed = Math.hypot(vl, vs);
            if (speed > maxS) {
                const target = Math.max(maxS, speed - drag * dt);
                const k = target / speed;
                vl *= k;
                vs *= k;
            }

            r.vx = vl * fx - vs * fy;
            r.vy = vl * fy + vs * fx;
            r.x += r.vx * dt;
            r.y += r.vy * dt;
        }

        fence(i);

        // Keep the rider inside the world box.
        const maxX = world.w - rr;
        const maxY = world.h - rr;
        if (r.x < rr) {
            r.x = rr;
            if (r.vx < 0) r.vx = 0;
        } else if (r.x > maxX) {
            r.x = maxX;
            if (r.vx > 0) r.vx = 0;
        }
        if (r.y < rr) {
            r.y = rr;
            if (r.vy < 0) r.vy = 0;
        } else if (r.y > maxY) {
            r.y = maxY;
            if (r.vy > 0) r.vy = 0;
        }

        r.speed = Math.hypot(r.vx, r.vy);
        r.pedalPhase = (r.pedalPhase + r.speed * dt * PEDAL_PHASE_RATE) % TWO_PI;
    }

    function collide(dt) {
        const minD = rr * 2;
        for (let a = 0; a < racers.length; a++) {
            for (let b = a + 1; b < racers.length; b++) {
                const ra = racers[a];
                const rb = racers[b];
                if (ra.air !== rb.air) continue;
                let dx = ra.x - rb.x;
                let dy = ra.y - rb.y;
                let d = Math.hypot(dx, dy);
                if (d >= minD) continue;
                if (d < 1e-3) {
                    dx = a % 2 ? 1 : -1;
                    dy = 0.3;
                    d = Math.hypot(dx, dy);
                }
                const cx = dx / d;
                const cy = dy / d;
                const push = (minD - d) * 0.5;
                ra.x += cx * push;
                ra.y += cy * push;
                rb.x -= cx * push;
                rb.y -= cy * push;
                const rvn = (ra.vx - rb.vx) * cx + (ra.vy - rb.vy) * cy;
                if (rvn < 0) {
                    const imp = -rvn * 0.6;
                    ra.vx += cx * imp;
                    ra.vy += cy * imp;
                    rb.vx -= cx * imp;
                    rb.vy -= cy * imp;
                }
                const k = Math.max(0, 1 - COLLIDE_SCRUB * dt);
                ra.vx *= k;
                ra.vy *= k;
                rb.vx *= k;
                rb.vy *= k;
                ra.speed = Math.hypot(ra.vx, ra.vy);
                rb.speed = Math.hypot(rb.vx, rb.vy);
            }
        }
    }

    // Pickups and hazards -------------------------------------------------------------

    function pickupsAndHazards(i, dt) {
        const r = racers[i];
        if (r.air) return;
        const reach = pk.radius + rr;
        for (let k = 0; k < state.pickups.length; k++) {
            const p = state.pickups[k];
            if (!p.active) continue;
            const dx = r.x - p.x;
            const dy = r.y - p.y;
            if (dx * dx + dy * dy > reach * reach) continue;
            p.active = false;
            pickT[k] = pk.respawn;
            if (p.type === 'boost') {
                r.boost = Math.max(r.boost, phys.boostTime);
                emit('pickup', i, p.x, p.y, 0);
                emit('boost', i, r.x, r.y, phys.boostTime);
            } else {
                const hx = clamp(r.x - Math.cos(r.angle) * pk.hazardDropBack, 0, world.w);
                const hy = clamp(r.y - Math.sin(r.angle) * pk.hazardDropBack, 0, world.h);
                state.hazards.push({
                    x: hx,
                    y: hy,
                    type: p.type === 'mud' ? 'mud' : 'bramble',
                    r: pk.hazardRadius,
                    ttl: pk.hazardTtl,
                    owner: i
                });
                emit('pickup', i, p.x, p.y, 0);
                emit('drop', i, hx, hy, 0);
            }
        }
        const hz = state.hazards;
        for (let k = hz.length - 1; k >= 0; k--) {
            const h = hz[k];
            if (h.owner === i) continue;
            const dx = r.x - h.x;
            const dy = r.y - h.y;
            const reachH = h.r + rr * HAZARD_TOUCH;
            if (dx * dx + dy * dy > reachH * reachH) continue;
            if (h.type === 'mud') {
                if (r.mud <= 0) emit('mud', i, r.x, r.y, phys.mudTime);
                r.mud = phys.mudTime;
            } else if (r.bramble <= 0) {
                r.bramble = phys.brambleTime;
                r.vx *= phys.brambleFactor;
                r.vy *= phys.brambleFactor;
                r.speed *= phys.brambleFactor;
                emit('bramble', i, r.x, r.y, phys.brambleTime);
                hz.splice(k, 1);
            }
        }
    }

    function tickWorld(dt) {
        const hz = state.hazards;
        for (let k = hz.length - 1; k >= 0; k--) {
            hz[k].ttl -= dt;
            if (hz[k].ttl <= 0) hz.splice(k, 1);
        }
        for (let k = 0; k < pickT.length; k++) {
            if (!state.pickups[k].active) {
                pickT[k] -= dt;
                if (pickT[k] <= 0) state.pickups[k].active = true;
            }
        }
    }

    // Main step -----------------------------------------------------------------------

    let cdElapsed = 0;
    let cdShown = -1;

    function stepCountdown(dt) {
        const total = CONFIG.countdown;
        cdElapsed += dt;
        // One count event per whole second: 3, 2, 1, then go.
        const whole = Math.floor(cdElapsed + 1e-6);
        if (whole > cdShown && whole < total) {
            cdShown = whole;
            emit('count', -1, undefined, undefined, total - whole);
        }
        state.countdown = Math.max(0, total - cdElapsed);
        for (let i = 0; i < racers.length; i++) {
            racers[i].steer = 0;
            locate(i, dt, false);
        }
        if (cdElapsed >= total - 1e-6) {
            state.countdown = 0;
            state.phase = 'racing';
            state.time = 0;
            emit('go', -1);
        }
    }

    function stepRacing(dt, input) {
        const racing = state.phase === 'racing';
        if (racing) {
            state.time += dt;
            tickWorld(dt);
        }
        const inp = input || {};
        const pSteer = Number.isFinite(inp.steer) ? clamp(inp.steer, -1, 1) : 0;

        for (let i = 0; i < racers.length; i++) locate(i, dt, racing);

        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            const e = ext[i];
            let steer;
            let pedal;
            let brake;
            if (!racing) {
                const c = aiControl(i, dt, 'stop');
                steer = c.steer;
                pedal = false;
                brake = false;
            } else if (i === 0 && !r.finished) {
                steer = pSteer;
                pedal = !!inp.pedal;
                brake = !!inp.brake;
            } else if (i === 0) {
                const c = aiControl(i, dt, 'stop');
                steer = c.steer;
                pedal = false;
                brake = false;
            } else {
                const delayed = state.time < e.startDelay;
                const c = aiControl(i, dt, r.finished ? 'finished' : 'race');
                steer = c.steer;
                pedal = delayed ? false : c.pedal;
                brake = delayed ? false : c.brake;
            }
            moveRider(i, steer, pedal, brake, dt);
        }

        collide(dt);
        // Riders can shove each other wide, so apply the edge barrier once more.
        for (let i = 0; i < racers.length; i++) {
            fence(i);
            racers[i].speed = Math.hypot(racers[i].vx, racers[i].vy);
        }
        if (racing) {
            for (let i = 0; i < racers.length; i++) pickupsAndHazards(i, dt);
            rank();
            if (racers[0].finished) {
                state.phase = 'finished';
                rank();
            }
        }
    }

    function step(dt, input) {
        let d = Number(dt);
        if (!Number.isFinite(d) || d <= 0) return;
        if (d > 0.05) d = 0.05;
        if (state.events.length > 800) state.events.splice(0, state.events.length - 400);
        if (state.phase === 'countdown') stepCountdown(d);
        else stepRacing(d, input);
    }

    function results() {
        const player = racers[0];
        return {
            place: player.place,
            time: player.finishTime,
            bestLap: player.bestLap,
            order: rankOrder.map((idx) => ({
                id: racers[idx].id,
                name: CONFIG.racers[idx].name,
                time: racers[idx].finished ? racers[idx].finishTime : null
            }))
        };
    }

    return { state, step, results };
}
