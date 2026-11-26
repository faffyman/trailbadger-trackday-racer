// Track Day Racer: saved settings, best results and stats.
// Every function is safe to call when localStorage is blocked, full or corrupted.
// Times are stored in seconds as plain numbers.

import { CONFIG } from './config.js';

const VERSION = 1;
const MAX_TRACKS = 5000;
const MAX_TIME = 3600;
const ID_PATTERN = /^(intro-\d{1,2}|daily-\d{4}-\d{2}-\d{2})$/;

let cache = null;

function defaults() {
    return {
        v: VERSION,
        settings: { music: true, effects: true, laps: CONFIG.laps.def, tilt: false },
        tracks: {},
        stats: { races: 0, wins: 0, podiums: 0 }
    };
}

function seconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TIME ? value : null;
}

function count(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1e9) : 0;
}

function placeNumber(value) {
    return Number.isInteger(value) && value >= 1 && value <= CONFIG.racers.length ? value : null;
}

function lapCount(value, fallback) {
    return Number.isInteger(value) && value >= CONFIG.laps.min && value <= CONFIG.laps.max ? value : fallback;
}

// Best race time for each race length, keyed by the number of laps.
function lapTimes(raw, oldBest) {
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (let n = CONFIG.laps.min; n <= CONFIG.laps.max; n++) {
            const t = seconds(raw[n]);
            if (t !== null) {
                out[n] = t;
            }
        }
    } else if (seconds(oldBest) !== null) {
        // Saves from before the lap setting: every race had 6 laps.
        out[6] = oldBest;
    }
    return out;
}

function flag(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

// Turns anything that was read from storage into a valid save object.
function sanitize(raw) {
    const save = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return save;
    }
    if (raw.settings && typeof raw.settings === 'object') {
        save.settings.music = flag(raw.settings.music, true);
        save.settings.effects = flag(raw.settings.effects, true);
        save.settings.laps = lapCount(raw.settings.laps, CONFIG.laps.def);
        save.settings.tilt = flag(raw.settings.tilt, false);
    }
    if (raw.stats && typeof raw.stats === 'object') {
        save.stats.races = count(raw.stats.races);
        save.stats.wins = count(raw.stats.wins);
        save.stats.podiums = count(raw.stats.podiums);
    }
    if (raw.tracks && typeof raw.tracks === 'object' && !Array.isArray(raw.tracks)) {
        let kept = 0;
        for (const id of Object.keys(raw.tracks)) {
            if (kept >= MAX_TRACKS) {
                break;
            }
            const rec = raw.tracks[id];
            if (!ID_PATTERN.test(id) || !rec || typeof rec !== 'object') {
                continue;
            }
            save.tracks[id] = {
                times: lapTimes(rec.times, rec.bestTime),
                bestLap: seconds(rec.bestLap),
                bestPlace: placeNumber(rec.bestPlace),
                plays: count(rec.plays)
            };
            kept += 1;
        }
    }
    return save;
}

function readStored() {
    try {
        const text = window.localStorage.getItem(CONFIG.storageKey);
        return text ? JSON.parse(text) : null;
    } catch (err) {
        return null;
    }
}

function writeStored() {
    try {
        window.localStorage.setItem(CONFIG.storageKey, JSON.stringify(cache));
    } catch (err) {
        // Storage is blocked or full. The game keeps working from memory.
    }
}

function current() {
    if (!cache) {
        cache = sanitize(readStored());
    }
    return cache;
}

// The copy handed out has bestTime filled in for the current lap setting.
export function loadSave() {
    const copy = JSON.parse(JSON.stringify(current()));
    const laps = copy.settings.laps;
    for (const id of Object.keys(copy.tracks)) {
        const t = copy.tracks[id].times[laps];
        copy.tracks[id].bestTime = typeof t === 'number' ? t : null;
    }
    return copy;
}

export function saveSettings(settings) {
    const save = current();
    if (settings && typeof settings === 'object') {
        save.settings.music = flag(settings.music, save.settings.music);
        save.settings.effects = flag(settings.effects, save.settings.effects);
        save.settings.laps = lapCount(settings.laps, save.settings.laps);
        save.settings.tilt = flag(settings.tilt, save.settings.tilt);
    }
    writeStored();
}

// `laps` is the length of the race that was run. Best times are kept per race length.
export function recordResult(trackId, result, laps) {
    const outcome = { newBestTime: false, newBestPlace: false };
    if (typeof trackId !== 'string' || !ID_PATTERN.test(trackId) || !result || typeof result !== 'object') {
        return outcome;
    }
    const save = current();
    const time = seconds(result.time);
    const lap = seconds(result.bestLap);
    const place = placeNumber(result.place);
    const len = lapCount(laps, save.settings.laps);

    let rec = save.tracks[trackId];
    if (!rec) {
        rec = { times: {}, bestLap: null, bestPlace: null, plays: 0 };
        save.tracks[trackId] = rec;
    }
    rec.plays += 1;
    if (time !== null && (typeof rec.times[len] !== 'number' || time < rec.times[len])) {
        rec.times[len] = time;
        outcome.newBestTime = true;
    }
    if (lap !== null && (rec.bestLap === null || lap < rec.bestLap)) {
        rec.bestLap = lap;
    }
    if (place !== null && (rec.bestPlace === null || place < rec.bestPlace)) {
        rec.bestPlace = place;
        outcome.newBestPlace = true;
    }

    save.stats.races += 1;
    if (place === 1) {
        save.stats.wins += 1;
    }
    if (place !== null && place <= 3) {
        save.stats.podiums += 1;
    }
    writeStored();
    return outcome;
}

export function pruneTracks(validIds) {
    if (!Array.isArray(validIds) || validIds.length === 0) {
        return;
    }
    const keep = new Set(validIds);
    const save = current();
    let changed = false;
    for (const id of Object.keys(save.tracks)) {
        if (!keep.has(id)) {
            delete save.tracks[id];
            changed = true;
        }
    }
    if (changed) {
        writeStored();
    }
}
