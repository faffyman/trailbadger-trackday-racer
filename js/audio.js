// Track Day Racer: music and sound effects, all synthesised with Web Audio.
//
// There are no audio files. Two short music loops (menu and race) are scheduled ahead on the
// audio clock by a lookahead timer. Effects are one-shot synth voices.
//
// The synthesis code takes a context argument, so it also runs on an OfflineAudioContext. That
// is how the loops and effects are rendered and measured in tests (see `synth` at the bottom).
//
// Every public method is safe to call before unlock(), when Web Audio is missing, and many
// times in a row. Nothing sounds before unlock(), which must be called inside a user gesture.

const LOOKAHEAD = 0.25;   // seconds of music scheduled ahead of the audio clock
const TICK_MS = 60;       // how often the scheduler wakes up
const MUSIC_LEVEL = 0.35; // music bus gain, effects sit at 1 so they stay clearly audible
const MASTER_LEVEL = 0.9;
const MIN_REPEAT = 0.035; // seconds, the same effect cannot retrigger faster than this
const STEPS = 16;         // sixteenth notes per bar

const SFX_NAMES = ['click', 'count', 'go', 'pickup', 'boost', 'drop', 'mud', 'bramble', 'jump',
    'land', 'bump', 'lap', 'finish', 'win'];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------------------------------------
// Synthesis helpers. `env` is { ctx, out, send, noise }: the context, the node a voice connects
// to, an optional delay send for the music voices, and a shared white noise buffer.
// ---------------------------------------------------------------------------------------------

const noiseCache = new WeakMap();

function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
        const length = Math.floor(ctx.sampleRate * 2);
        buf = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let seed = 22222;
        for (let i = 0; i < length; i++) {
            // Small deterministic generator so a render is repeatable.
            seed = (seed * 1664525 + 1013904223) >>> 0;
            data[i] = (seed / 4294967296) * 2 - 1;
        }
        noiseCache.set(ctx, buf);
    }
    return buf;
}

// Amplitude envelope: linear attack, exponential decay to a sustain level, hold, exponential
// release. Returns the gain node. `dur` is the held length, `rel` the release time after it.
function envelope(ctx, t, o) {
    const node = ctx.createGain();
    const vol = o.vol;
    const a = Math.min(o.a === undefined ? 0.005 : o.a, o.dur * 0.5);
    const d = Math.max(Math.min(o.d === undefined ? o.dur : o.d, o.dur - a), 0.001);
    const level = Math.max(vol * (o.sus === undefined ? 1 : o.sus), 0.0001);
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(vol, t + a);
    g.exponentialRampToValueAtTime(level, t + a + d);
    g.setValueAtTime(level, t + o.dur);
    g.exponentialRampToValueAtTime(0.0001, t + o.dur + o.rel);
    return node;
}

function connectOut(env, node, send) {
    node.connect(env.out);
    if (send && env.send) {
        node.connect(env.send);
    }
}

// Pitched voice: one or more detuned oscillators through an optional lowpass.
function tone(env, t, o) {
    const ctx = env.ctx;
    const o2 = Object.assign({ rel: 0.08, a: 0.005 }, o);
    const gain = envelope(ctx, t, o2);
    let head = gain;
    if (o2.lp) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = o2.q || 0.7;
        filter.frequency.setValueAtTime(o2.lp, t);
        if (o2.lp2) {
            filter.frequency.exponentialRampToValueAtTime(o2.lp2, t + o2.dur);
        }
        filter.connect(gain);
        head = filter;
    }
    const detunes = o2.det || [0];
    const end = t + o2.dur + o2.rel + 0.03;
    for (const cents of detunes) {
        const osc = ctx.createOscillator();
        osc.type = o2.type || 'sine';
        osc.detune.value = cents;
        osc.frequency.setValueAtTime(o2.f, t);
        if (o2.f2) {
            osc.frequency.exponentialRampToValueAtTime(o2.f2, t + (o2.fdur || o2.dur));
        }
        osc.connect(head);
        osc.start(t);
        osc.stop(end);
    }
    connectOut(env, gain, o2.send);
}

// Filtered noise voice. Optional `lfo` { rate, depth } wobbles the filter frequency.
function noise(env, t, o) {
    const ctx = env.ctx;
    const o2 = Object.assign({ rel: 0.03, a: 0.003 }, o);
    const gain = envelope(ctx, t, o2);
    const filter = ctx.createBiquadFilter();
    filter.type = o2.ft || 'bandpass';
    filter.Q.value = o2.q || 0.8;
    filter.frequency.setValueAtTime(o2.f, t);
    if (o2.f2) {
        filter.frequency.exponentialRampToValueAtTime(o2.f2, t + o2.dur);
    }
    const end = t + o2.dur + o2.rel + 0.03;
    if (o2.lfo) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = o2.lfo.rate;
        depth.gain.value = o2.lfo.depth;
        lfo.connect(depth);
        depth.connect(filter.frequency);
        lfo.start(t);
        lfo.stop(end);
    }
    const src = ctx.createBufferSource();
    src.buffer = env.noise;
    src.loop = true;
    src.connect(filter);
    filter.connect(gain);
    src.start(t, (o2.offset || 0) % 1.5);
    src.stop(end);
    connectOut(env, gain, false);
}

// ---------------------------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------------------------

const VOICE = {
    bass(env, t, m, dur, vol) {
        tone(env, t, { type: 'sawtooth', f: mtof(m), dur, vol: vol * 0.7, a: 0.01, d: 0.18, sus: 0.55,
            rel: 0.07, lp: 1000, lp2: 380, q: 1.2 });
        tone(env, t, { type: 'sine', f: mtof(m), dur, vol: vol * 0.8, a: 0.01, d: 0.3, sus: 0.7, rel: 0.07 });
    },
    arp(env, t, m, dur, vol) {
        tone(env, t, { type: 'triangle', f: mtof(m), dur, vol, a: 0.004, d: dur * 0.9, sus: 0.08,
            rel: 0.05, det: [-4, 4], lp: 3600, lp2: 1100, send: true });
    },
    lead(env, t, m, dur, vol) {
        tone(env, t, { type: 'triangle', f: mtof(m), dur, vol, a: 0.014, d: 0.25, sus: 0.7, rel: 0.14,
            det: [-5, 5], lp: 3800, lp2: 2400, send: true });
        tone(env, t, { type: 'sine', f: mtof(m), dur, vol: vol * 0.5, a: 0.014, d: 0.25, sus: 0.7,
            rel: 0.14, send: true });
    },
    kick(env, t, vol) {
        tone(env, t, { type: 'sine', f: 165, f2: 48, fdur: 0.13, dur: 0.16, vol, a: 0.002, d: 0.16, sus: 0.05, rel: 0.04 });
        noise(env, t, { ft: 'lowpass', f: 2200, dur: 0.012, vol: vol * 0.25, a: 0.001, rel: 0.01 });
    },
    clap(env, t, vol) {
        noise(env, t, { f: 1700, q: 0.7, dur: 0.11, vol, a: 0.002, d: 0.11, sus: 0.02, rel: 0.04 });
        noise(env, t + 0.011, { f: 2300, q: 0.7, dur: 0.07, vol: vol * 0.6, a: 0.002, d: 0.07, sus: 0.02, rel: 0.03, offset: 0.4 });
    },
    hat(env, t, vol, open) {
        noise(env, t, { ft: 'highpass', f: 7500, q: 0.5, dur: open ? 0.09 : 0.03, vol, a: 0.001,
            d: open ? 0.09 : 0.03, sus: 0.02, rel: 0.02, offset: 0.7 });
    },
    shaker(env, t, vol) {
        noise(env, t, { f: 5600, q: 0.9, dur: 0.07, vol, a: 0.012, d: 0.06, sus: 0.05, rel: 0.03, offset: 1.1 });
    },
    rim(env, t, vol) {
        tone(env, t, { type: 'triangle', f: 1750, f2: 1500, dur: 0.03, vol, a: 0.001, d: 0.03, sus: 0.05, rel: 0.02 });
        noise(env, t, { f: 3000, q: 1.5, dur: 0.02, vol: vol * 0.5, a: 0.001, rel: 0.01 });
    }
};

// Both loops are eight bars of sixteen steps. `chords` has four entries and repeats. Note
// lists are [step, midi, length in steps]. Melodies are original.
const MUSIC = {
    // Relaxed and woodland-playful. C major, 92 bpm.
    menu: {
        bpm: 92,
        bars: 8,
        vol: { bass: 0.2, arp: 0.075, lead: 0.15, kick: 0.3, shaker: 0.07, rim: 0.12, hat: 0.04, clap: 0.1 },
        chords: [
            { bass: 48, tones: [60, 64, 67, 72] },
            { bass: 45, tones: [60, 64, 69, 72] },
            { bass: 41, tones: [60, 65, 69, 72] },
            { bass: 43, tones: [62, 67, 71, 74] }
        ],
        bassPattern: [[0, 0, 3], [6, 7, 2], [8, 0, 3], [12, 7, 2]],
        arp: { every: 2, len: 2.4, idx: [0, 1, 2, 3, 2, 1, 2, 1] },
        lead: [
            [[0, 76, 3], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 72, 3]],
            [[0, 72, 2], [2, 76, 2], [4, 81, 4], [8, 79, 2], [10, 76, 2], [12, 74, 4]],
            [[0, 77, 4], [4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 72, 4]],
            [[0, 74, 4], [4, 79, 3], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
            [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 84, 6], [14, 79, 2]],
            [[0, 81, 3], [4, 79, 2], [6, 76, 2], [8, 79, 4], [12, 76, 4]],
            [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 81, 2], [10, 77, 2], [12, 72, 4]],
            [[0, 74, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 71, 4], [12, 79, 2], [14, 74, 2]]
        ],
        drums(step) {
            const hits = [];
            if (step === 0 || step === 8) {
                hits.push(['kick', 1]);
            }
            if (step % 2 === 0) {
                hits.push(['shaker', step % 4 === 0 ? 0.8 : 1]);
            }
            if (step === 12) {
                hits.push(['rim', 1]);
            }
            return hits;
        }
    },
    // Upbeat and driving. E minor, 128 bpm.
    race: {
        bpm: 128,
        bars: 8,
        vol: { bass: 0.2, arp: 0.065, lead: 0.13, kick: 0.42, shaker: 0.05, rim: 0.1, hat: 0.055, clap: 0.16 },
        chords: [
            { bass: 52, tones: [64, 67, 71, 76] },
            { bass: 48, tones: [60, 64, 67, 72] },
            { bass: 55, tones: [62, 67, 71, 74] },
            { bass: 50, tones: [62, 66, 69, 74] }
        ],
        bassPattern: [[0, 0, 2], [2, 0, 2], [4, 12, 1], [6, 0, 2], [8, 0, 2], [10, 0, 2], [12, 12, 1], [14, 7, 2]],
        arp: { every: 1, len: 1.4, idx: [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 2] },
        lead: [
            [[0, 83, 2], [3, 83, 1], [4, 79, 2], [6, 76, 2], [8, 79, 3], [12, 81, 2], [14, 79, 2]],
            [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 83, 2], [10, 79, 2], [12, 76, 4]],
            [[0, 74, 2], [2, 79, 2], [4, 83, 3], [8, 81, 2], [10, 79, 2], [12, 74, 4]],
            [[0, 78, 3], [4, 81, 2], [6, 78, 2], [8, 74, 4], [12, 76, 2], [14, 78, 2]],
            [[0, 83, 2], [2, 86, 2], [4, 83, 2], [6, 79, 2], [8, 83, 4], [12, 79, 4]],
            [[0, 84, 3], [4, 83, 1], [5, 79, 1], [6, 76, 2], [8, 79, 2], [10, 84, 2], [12, 83, 4]],
            [[0, 86, 2], [2, 83, 2], [4, 79, 2], [6, 83, 2], [8, 81, 4], [12, 79, 2], [14, 74, 2]],
            [[0, 78, 2], [2, 81, 2], [4, 78, 2], [6, 74, 2], [8, 78, 4], [12, 81, 2], [14, 83, 2]]
        ],
        drums(step) {
            const hits = [];
            if (step % 4 === 0) {
                hits.push(['kick', 1]);
            }
            if (step === 4 || step === 12) {
                hits.push(['clap', 1]);
            }
            if (step % 4 === 2) {
                hits.push(['hat', 1, true]);
            } else if (step % 2 === 1) {
                hits.push(['hat', 0.4, false]);
            }
            return hits;
        }
    }
};

// Turn the note lists into a [bar][step] table of events, once per loop.
function buildIndex(m) {
    if (m.index) {
        return;
    }
    m.index = [];
    for (let bar = 0; bar < m.bars; bar++) {
        const steps = [];
        for (let s = 0; s < STEPS; s++) {
            steps.push([]);
        }
        const chord = m.chords[bar % m.chords.length];
        for (const [step, semi, len] of m.bassPattern) {
            steps[step].push({ k: 'bass', midi: chord.bass + semi, len });
        }
        m.arp.idx.forEach((tone, i) => {
            steps[i * m.arp.every].push({ k: 'arp', midi: chord.tones[tone], len: m.arp.len });
        });
        for (const [step, midi, len] of m.lead[bar]) {
            steps[step].push({ k: 'lead', midi, len });
        }
        for (let s = 0; s < STEPS; s++) {
            for (const [name, level, flag] of m.drums(s)) {
                steps[s].push({ k: name, level, flag });
            }
        }
        m.index.push(steps);
    }
}

function scheduleStep(env, m, bar, step, t, stepDur) {
    buildIndex(m);
    for (const ev of m.index[bar][step]) {
        const vol = m.vol[ev.k] || 0.1;
        switch (ev.k) {
            case 'bass':
            case 'arp':
            case 'lead':
                VOICE[ev.k](env, t, ev.midi, Math.max(ev.len * stepDur * 0.92, 0.05), vol);
                break;
            case 'hat':
                VOICE.hat(env, t, vol * ev.level, ev.flag);
                break;
            default:
                VOICE[ev.k](env, t, vol * ev.level);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

function bell(env, t, f, vol, dur) {
    tone(env, t, { type: 'sine', f, dur, vol, a: 0.003, d: dur, sus: 0.0001, rel: 0.05 });
    tone(env, t, { type: 'sine', f: f * 2.76, dur: dur * 0.5, vol: vol * 0.25, a: 0.002, d: dur * 0.5, sus: 0.0001, rel: 0.03 });
    tone(env, t, { type: 'triangle', f: f * 2, dur: dur * 0.7, vol: vol * 0.2, a: 0.002, d: dur * 0.7, sus: 0.0001, rel: 0.03 });
}

function brass(env, t, midi, dur, vol) {
    const f = mtof(midi);
    tone(env, t, { type: 'sawtooth', f, dur, vol: vol * 0.55, a: 0.02, d: 0.12, sus: 0.7, rel: 0.1,
        det: [-6, 6], lp: 1500, lp2: 2400, q: 0.8 });
    tone(env, t, { type: 'triangle', f, dur, vol: vol * 0.5, a: 0.02, d: 0.12, sus: 0.8, rel: 0.1 });
}

const SFX = {
    click(env, t, v) {
        tone(env, t, { type: 'sine', f: 1500, f2: 950, dur: 0.035, vol: 0.4 * v, a: 0.002, d: 0.035, sus: 0.05, rel: 0.03 });
        tone(env, t, { type: 'triangle', f: 2600, dur: 0.012, vol: 0.12 * v, a: 0.001, rel: 0.01 });
    },
    count(env, t, v) {
        tone(env, t, { type: 'sine', f: 660, dur: 0.15, vol: 0.42 * v, a: 0.01, d: 0.1, sus: 0.8, rel: 0.09 });
        tone(env, t, { type: 'sine', f: 1320, dur: 0.1, vol: 0.1 * v, a: 0.01, d: 0.1, sus: 0.5, rel: 0.06 });
    },
    go(env, t, v) {
        tone(env, t, { type: 'sine', f: 1047, dur: 0.5, vol: 0.4 * v, a: 0.012, d: 0.3, sus: 0.55, rel: 0.2 });
        tone(env, t, { type: 'triangle', f: 1568, dur: 0.5, vol: 0.2 * v, a: 0.012, d: 0.3, sus: 0.55, rel: 0.2 });
        tone(env, t, { type: 'sine', f: 2093, dur: 0.4, vol: 0.08 * v, a: 0.012, d: 0.3, sus: 0.4, rel: 0.15 });
    },
    pickup(env, t, v) {
        [1047, 1319, 1760].forEach((f, i) => {
            const at = t + i * 0.055;
            tone(env, at, { type: 'triangle', f, dur: 0.09, vol: 0.3 * v, a: 0.004, d: 0.09, sus: 0.3, rel: 0.12 });
            tone(env, at, { type: 'sine', f: f * 2, dur: 0.06, vol: 0.08 * v, a: 0.004, d: 0.06, sus: 0.1, rel: 0.08 });
        });
    },
    boost(env, t, v) {
        noise(env, t, { f: 300, f2: 3600, q: 2.2, dur: 0.55, vol: 0.55 * v, a: 0.3, d: 0.25, sus: 0.3, rel: 0.08 });
        tone(env, t, { type: 'sawtooth', f: 170, f2: 720, dur: 0.5, vol: 0.18 * v, a: 0.25, d: 0.25, sus: 0.4,
            rel: 0.08, lp: 1100, lp2: 2600 });
    },
    drop(env, t, v) {
        tone(env, t, { type: 'sine', f: 540, f2: 170, fdur: 0.13, dur: 0.15, vol: 0.5 * v, a: 0.003, d: 0.15, sus: 0.05, rel: 0.05 });
        noise(env, t, { ft: 'lowpass', f: 900, dur: 0.03, vol: 0.12 * v, a: 0.001, rel: 0.02 });
    },
    mud(env, t, v) {
        noise(env, t, { f: 260, f2: 800, q: 6, dur: 0.36, vol: 0.9 * v, a: 0.03, d: 0.3, sus: 0.3, rel: 0.06,
            lfo: { rate: 17, depth: 180 } });
        tone(env, t, { type: 'sine', f: 130, f2: 62, dur: 0.32, vol: 0.32 * v, a: 0.02, d: 0.3, sus: 0.3, rel: 0.05 });
    },
    bramble(env, t, v) {
        noise(env, t, { ft: 'highpass', f: 5200, q: 0.5, dur: 0.38, vol: 0.2 * v, a: 0.01, d: 0.38, sus: 0.05, rel: 0.05 });
        const times = [0, 0.03, 0.06, 0.1, 0.13, 0.19, 0.24, 0.3];
        times.forEach((dt, i) => {
            noise(env, t + dt, { ft: 'highpass', f: 2600, q: 0.7, dur: 0.014, vol: (0.28 + 0.1 * (i % 3)) * v,
                a: 0.001, rel: 0.01, offset: 0.2 + i * 0.173 });
        });
    },
    jump(env, t, v) {
        tone(env, t, { type: 'sine', f: 280, f2: 1000, dur: 0.3, vol: 0.34 * v, a: 0.02, d: 0.3, sus: 0.3, rel: 0.1 });
        tone(env, t, { type: 'triangle', f: 140, f2: 500, dur: 0.28, vol: 0.14 * v, a: 0.02, d: 0.28, sus: 0.3, rel: 0.08 });
        noise(env, t, { f: 600, f2: 2600, q: 1.2, dur: 0.25, vol: 0.14 * v, a: 0.08, d: 0.17, sus: 0.2, rel: 0.05 });
    },
    land(env, t, v) {
        tone(env, t, { type: 'sine', f: 135, f2: 42, fdur: 0.2, dur: 0.24, vol: 0.7 * v, a: 0.003, d: 0.24, sus: 0.05, rel: 0.06 });
        noise(env, t, { ft: 'lowpass', f: 520, q: 0.7, dur: 0.1, vol: 0.35 * v, a: 0.002, d: 0.1, sus: 0.05, rel: 0.03 });
    },
    bump(env, t, v) {
        tone(env, t, { type: 'triangle', f: 175, f2: 95, dur: 0.09, vol: 0.5 * v, a: 0.002, d: 0.09, sus: 0.1, rel: 0.04 });
        noise(env, t, { ft: 'lowpass', f: 760, q: 0.7, dur: 0.05, vol: 0.25 * v, a: 0.001, d: 0.05, sus: 0.1, rel: 0.02 });
    },
    lap(env, t, v) {
        bell(env, t, 784, 0.3 * v, 0.4);
        bell(env, t + 0.17, 1047, 0.3 * v, 0.55);
    },
    finish(env, t, v) {
        [523, 659, 784, 1047].forEach((f, i) => {
            const at = t + i * 0.085;
            tone(env, at, { type: 'triangle', f, dur: 0.1, vol: 0.3 * v, a: 0.006, d: 0.1, sus: 0.5, rel: 0.1 });
            tone(env, at, { type: 'sine', f: f * 2, dur: 0.08, vol: 0.07 * v, a: 0.006, rel: 0.06 });
        });
        [1047, 1319, 1568].forEach((f) => {
            tone(env, t + 0.34, { type: 'triangle', f, dur: 0.35, vol: 0.2 * v, a: 0.01, d: 0.3, sus: 0.4, rel: 0.25 });
        });
    },
    win(env, t, v) {
        // Rising call, a held note, a small answer, then a full chord.
        brass(env, t, 72, 0.14, 0.34 * v);
        brass(env, t + 0.17, 76, 0.14, 0.34 * v);
        brass(env, t + 0.34, 79, 0.14, 0.34 * v);
        brass(env, t + 0.52, 84, 0.5, 0.36 * v);
        brass(env, t + 1.1, 81, 0.14, 0.32 * v);
        brass(env, t + 1.28, 79, 0.14, 0.32 * v);
        [72, 76, 79, 84].forEach((m) => brass(env, t + 1.5, m, 0.9, 0.2 * v));
        bell(env, t + 1.5, 2093, 0.12 * v, 1.0);
    }
};

function playSfx(env, name, t, volume) {
    const fn = SFX[name];
    if (!fn) {
        return false;
    }
    fn(env, t, volume);
    return true;
}

// ---------------------------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------------------------

// Soft ceiling: tanh keeps the final level below 0.77 whatever the mix does.
function softClipCurve() {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        curve[i] = Math.tanh((i / (n - 1)) * 2 - 1);
    }
    return curve;
}

function createGraph(ctx) {
    const master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.2;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    const musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    const sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(comp);
    comp.connect(clip);
    clip.connect(ctx.destination);
    return { master, musicBus, sfxBus, noise: noiseBuffer(ctx) };
}

// One music "rig" per loop that plays: an output gain (used to fade or cut it) and a tempo
// synced echo that the arp and lead voices send into.
function createRig(ctx, graph, bpm) {
    const out = ctx.createGain();
    out.connect(graph.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.28;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = (60 / bpm / 4) * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    send.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(out);
    return { out, send, nodes: [out, send, delay, feedback, tone] };
}

// ---------------------------------------------------------------------------------------------
// Engine state and public API
// ---------------------------------------------------------------------------------------------

let ctx = null;
let graph = null;
let unlocked = false;
let musicOn = true;
let effectsOn = true;
let requested = null; // the music name the game last asked for
let session = null;   // the loop that is playing
let timer = null;
const lastPlayed = {};

function isHidden() {
    return typeof document !== 'undefined' && document.hidden === true;
}

function resumeContext() {
    if (!ctx || isHidden() || ctx.state === 'running' || ctx.state === 'closed') {
        return;
    }
    try {
        const p = ctx.resume();
        if (p && p.catch) {
            p.catch(() => {});
        }
    } catch (e) {
        // Nothing to do, the next gesture tries again.
    }
}

function tick() {
    if (!session || !ctx) {
        return;
    }
    const s = session;
    if (s.nextTime < ctx.currentTime) {
        s.nextTime = ctx.currentTime + 0.05;
    }
    while (s.nextTime < ctx.currentTime + LOOKAHEAD) {
        try {
            scheduleStep(s.env, s.music, s.bar, s.step, s.nextTime, s.stepDur);
        } catch (e) {
            // A failed note must never stop the loop.
        }
        s.nextTime += s.stepDur;
        s.step += 1;
        if (s.step >= STEPS) {
            s.step = 0;
            s.bar = (s.bar + 1) % s.music.bars;
        }
    }
}

function stopSession() {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
    if (!session) {
        return;
    }
    const old = session;
    session = null;
    try {
        const now = ctx.currentTime;
        old.rig.out.gain.cancelScheduledValues(now);
        old.rig.out.gain.setValueAtTime(old.rig.out.gain.value, now);
        old.rig.out.gain.linearRampToValueAtTime(0, now + 0.04);
    } catch (e) {
        // Ignore, the nodes are dropped below anyway.
    }
    setTimeout(() => {
        for (const node of old.rig.nodes) {
            try {
                node.disconnect();
            } catch (e) {
                // Already disconnected.
            }
        }
    }, 120);
}

function startMusic(name) {
    const music = MUSIC[name];
    if (!ctx || !graph || !music) {
        return;
    }
    stopSession();
    const rig = createRig(ctx, graph, music.bpm);
    const now = ctx.currentTime;
    rig.out.gain.setValueAtTime(0.0001, now);
    rig.out.gain.linearRampToValueAtTime(1, now + 0.06);
    session = {
        name,
        music,
        rig,
        env: { ctx, out: rig.out, send: rig.send, noise: graph.noise },
        stepDur: 60 / music.bpm / 4,
        bar: 0,
        step: 0,
        nextTime: now + 0.08
    };
    timer = setInterval(tick, TICK_MS);
    tick();
}

function onVisibility() {
    if (!ctx) {
        return;
    }
    try {
        if (isHidden()) {
            if (ctx.state === 'running') {
                const p = ctx.suspend();
                if (p && p.catch) {
                    p.catch(() => {});
                }
            }
        } else {
            resumeContext();
        }
    } catch (e) {
        // Ignore.
    }
}

if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', onVisibility);
}

export const audio = {
    // Call from a user gesture. Creates the context on the first call, resumes it on later ones.
    unlock() {
        try {
            if (!ctx) {
                const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
                if (!Ctor) {
                    return;
                }
                try {
                    ctx = new Ctor({ latencyHint: 'interactive' });
                } catch (e) {
                    ctx = new Ctor();
                }
                graph = createGraph(ctx);
                // A silent buffer started inside the gesture fully unlocks iOS.
                const src = ctx.createBufferSource();
                src.buffer = ctx.createBuffer(1, 1, 22050);
                src.connect(ctx.destination);
                src.start(0);
            }
            unlocked = true;
            resumeContext();
            if (musicOn && requested && !session) {
                startMusic(requested);
            }
        } catch (e) {
            ctx = null;
            graph = null;
            unlocked = false;
        }
    },

    setMusic(on) {
        musicOn = !!on;
        if (!musicOn) {
            stopSession();
        } else if (unlocked && requested && !session) {
            startMusic(requested);
        }
    },

    setEffects(on) {
        effectsOn = !!on;
    },

    // 'menu' or 'race'. The request is remembered so it starts after unlock or after the music
    // switch goes back on. Asking for the loop that already plays does nothing.
    playMusic(name) {
        if (!MUSIC[name]) {
            return;
        }
        requested = name;
        if (!musicOn || !unlocked || !ctx) {
            return;
        }
        if (session && session.name === name) {
            return;
        }
        try {
            startMusic(name);
        } catch (e) {
            // Audio is optional, never break the game.
        }
    },

    stopMusic() {
        requested = null;
        stopSession();
    },

    sfx(name, volume = 1) {
        if (!effectsOn || !unlocked || !ctx || !graph || !SFX[name] || isHidden()) {
            return;
        }
        if (ctx.state !== 'running' && ctx.state !== 'suspended') {
            resumeContext();
            return;
        }
        const now = ctx.currentTime;
        if (lastPlayed[name] !== undefined && now - lastPlayed[name] < MIN_REPEAT && now >= lastPlayed[name]) {
            return;
        }
        lastPlayed[name] = now;
        const v = Math.min(Math.max(Number(volume) || 0, 0), 1.5);
        if (v === 0) {
            return;
        }
        try {
            playSfx({ ctx, out: graph.sfxBus, send: null, noise: graph.noise }, name, now + 0.005, v);
        } catch (e) {
            // Ignore.
        }
    }
};

// Used by the offline render test. Not part of the game API.
export const synth = { MUSIC, SFX_NAMES, STEPS, createGraph, createRig, scheduleStep, playSfx, noiseBuffer };
