// Track Day Racer: screens, game loop and glue between the modules.

import { CONFIG } from './config.js';
import { generateTrack, listTracks, dailyId } from './track.js';
import { createRace } from './race.js';
import { createRenderer, drawTrackThumb } from './render/scene.js';
import { drawPortrait } from './render/sprites.js';
import { audio } from './audio.js';
import { registerServiceWorker } from './pwa.js';
import { createInput } from './input.js';
import { loadSave, saveSettings, recordResult } from './storage.js';

const FINISH_DELAY = 2.2;     // seconds of free rolling after the player finishes
const MAX_STEPS_PER_FRAME = 8;

const $ = (id) => document.getElementById(id);
const body = document.body;
const app = $('app');
const canvas = $('game');
const homeEl = $('screen-home');

const renderer = createRenderer(canvas);
const input = createInput($('touch'));

// ---------- Small helpers ----------

function ordinal(n) {
    const names = { 1: '1st', 2: '2nd', 3: '3rd' };
    return names[n] || (n + 'th');
}

function formatTime(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return '-';
    }
    const cs = Math.floor(Math.max(0, seconds) * 100);
    const m = Math.floor(cs / 6000);
    const s = Math.floor(cs / 100) % 60;
    const c = cs % 100;
    return m + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

// ---------- Settings and sound ----------

const save = loadSave();
const settings = { music: save.settings.music, effects: save.settings.effects, laps: save.settings.laps, tilt: save.settings.tilt };
let wantedMusic = 'menu';

function applySettings() {
    audio.setMusic(settings.music);
    audio.setEffects(settings.effects);
    for (const [id, on] of [['btn-music', settings.music], ['btn-effects', settings.effects]]) {
        $(id).setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

function playMusic(name) {
    wantedMusic = name;
    audio.playMusic(name);
}

function toggleSetting(key) {
    settings[key] = !settings[key];
    saveSettings(settings);
    applySettings();
    if (key === 'music' && settings.music) {
        audio.playMusic(wantedMusic);
    }
}

// Browsers want the audio unlock inside a real gesture. Touch browsers count a finished
// tap, so the listeners stay until one of the "finished" gestures has run.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
function unlockAudio(e) {
    audio.unlock();
    audio.playMusic(wantedMusic);
    if (e && e.type !== 'pointerdown') {
        for (const type of UNLOCK_EVENTS) {
            window.removeEventListener(type, unlockAudio, true);
        }
    }
}
for (const type of UNLOCK_EVENTS) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
}

// ---------- Tracks ----------

const trackCache = new Map();
function getTrack(id) {
    if (!trackCache.has(id)) {
        trackCache.set(id, generateTrack(id));
    }
    return trackCache.get(id);
}

// ---------- Layout ----------

function cssPx(name) {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

let touchUi = false;
function setTouchUi(on) {
    touchUi = on;
    body.classList.toggle('touch-ui', on);
    layout();
}

function layout() {
    const w = Math.max(1, app.clientWidth);
    const h = Math.max(1, app.clientHeight);
    const portrait = h > w;
    body.classList.toggle('portrait', portrait);
    body.classList.toggle('landscape', !portrait);

    const safe = getComputedStyle($('safe'));
    const safeTop = parseFloat(safe.paddingTop) || 0;
    const safeRight = parseFloat(safe.paddingRight) || 0;
    const safeBottom = parseFloat(safe.paddingBottom) || 0;
    const safeLeft = parseFloat(safe.paddingLeft) || 0;

    const insets = { top: safeTop, right: safeRight, bottom: safeBottom, left: safeLeft };
    if (portrait) {
        insets.top += cssPx('--hud-h');
        if (touchUi) {
            insets.bottom += cssPx('--touch-h');
        }
    }
    renderer.resize(w, h, insets);
}

let layoutQueued = false;
function queueLayout() {
    if (layoutQueued) {
        return;
    }
    layoutQueued = true;
    requestAnimationFrame(() => {
        layoutQueued = false;
        layout();
    });
}

window.addEventListener('resize', queueLayout);
window.addEventListener('orientationchange', () => {
    queueLayout();
    setTimeout(queueLayout, 250);
});
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueLayout);
}

const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
if (coarse) {
    const onChange = () => setTouchUi(coarse.matches || touchUi);
    if (coarse.addEventListener) {
        coarse.addEventListener('change', onChange);
    }
}
// A real touch on a device that did not report a coarse pointer turns the controls on.
window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchUi) {
        setTouchUi(true);
    }
}, { passive: true });

// Stop pinch zoom gestures on iOS.
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- Screens ----------

let screen = 'home';          // home, race, pause, results
let mode = 'home';            // home, play, paused, finishing, results
let infoOpen = false;
let infoOpener = null;

const focusTargets = {
    home: () => document.querySelector('#home-hero .hero-play'),
    pause: () => $('btn-resume'),
    results: () => $('btn-again')
};

function setScreen(name) {
    screen = name;
    body.dataset.screen = name;
    input.setActive(name === 'race');
    const find = focusTargets[name];
    if (find) {
        const target = find();
        if (target) {
            target.focus({ preventScroll: true });
        }
    } else if (document.activeElement && document.activeElement !== body) {
        document.activeElement.blur();
    }
}

function openInfo() {
    const stats = loadSave().stats;
    $('stat-races').textContent = String(stats.races);
    $('stat-wins').textContent = String(stats.wins);
    $('stat-podiums').textContent = String(stats.podiums);
    infoOpener = document.activeElement;
    infoOpen = true;
    body.dataset.info = 'open';
    $('btn-info-close').focus({ preventScroll: true });
    $('info').querySelector('.modal-body').scrollTop = 0;
}

function closeInfo() {
    infoOpen = false;
    delete body.dataset.info;
    const back = infoOpener && document.contains(infoOpener) ? infoOpener : $('btn-info');
    back.focus({ preventScroll: true });
    infoOpener = null;
}

// ---------- Home ----------

const thumbs = new Map();     // key -> canvas, reused across home rebuilds
let thumbObserver = null;
const thumbQueue = [];
let thumbBusy = false;

const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 300 })
    : (fn) => setTimeout(fn, 24);

function bestText(record) {
    if (!record || record.bestTime === null) {
        return { text: 'Not raced yet', none: true };
    }
    const place = record.bestPlace ? ' | ' + ordinal(record.bestPlace) : '';
    return { text: 'Best ' + formatTime(record.bestTime) + place, none: false };
}

function paintThumb(canvasEl) {
    if (canvasEl.dataset.done) {
        return;
    }
    try {
        const track = getTrack(canvasEl.dataset.id);
        drawTrackThumb(canvasEl, track);
        canvasEl.dataset.done = '1';
        const card = canvasEl.closest('.card');
        const name = card && card.querySelector('.card-name');
        if (name) {
            name.textContent = track.name;
        }
    } catch (err) {
        console.error('Thumbnail failed', err);
    }
}

function drainThumbs() {
    if (thumbBusy) {
        return;
    }
    thumbBusy = true;
    const next = () => {
        const item = thumbQueue.shift();
        if (!item) {
            thumbBusy = false;
            return;
        }
        paintThumb(item);
        idle(next);
    };
    idle(next);
}

function wantThumb(canvasEl) {
    if (canvasEl.dataset.done) {
        return;
    }
    if (thumbObserver) {
        thumbObserver.observe(canvasEl);
    } else {
        thumbQueue.push(canvasEl);
        drainThumbs();
    }
}

function getThumb(id, hero) {
    const key = id + (hero ? ':hero' : '');
    let node = thumbs.get(key);
    if (!node) {
        node = el('canvas', 'thumb');
        node.width = hero ? 640 : 192;
        node.height = hero ? 360 : 108;
        node.dataset.id = id;
        node.setAttribute('aria-hidden', 'true');
        thumbs.set(key, node);
    }
    return node;
}

function buildCard(entry, record, options) {
    const hero = !!options.hero;
    const card = el(hero ? 'div' : 'button', 'card' + (hero ? ' card-hero' : ''));
    if (!hero) {
        card.type = 'button';
        card.dataset.track = entry.id;
    }
    card.appendChild(getThumb(entry.id, hero));

    const text = el('span', 'card-text');
    const known = trackCache.get(entry.id);
    text.appendChild(el('span', 'card-name', known ? known.name : ''));
    text.appendChild(el('span', 'card-sub', options.sub || entry.label));
    const best = bestText(record);
    text.appendChild(el('span', 'card-best' + (best.none ? ' none' : ''), best.text));

    if (hero) {
        const play = el('button', 'btn btn-primary btn-big hero-play', 'Play');
        play.type = 'button';
        play.dataset.track = entry.id;
        play.setAttribute('aria-label', 'Play ' + (known ? known.name : entry.label));
        text.appendChild(play);
    }
    card.appendChild(text);
    if (options.badge) {
        card.appendChild(el('span', 'badge', options.badge));
    }
    if (!hero) {
        card.setAttribute('aria-label', 'Race ' + entry.label + '. ' + best.text);
    }
    return card;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

// Show the track card for the day chosen in the date picker.
function showPicked(value, data) {
    const box = $('pick-result');
    box.replaceChildren();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!m) {
        return;
    }
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() || Number(m[1]) < 1990) {
        box.appendChild(el('p', 'pick-note', 'Pick a day up to today.'));
        return;
    }
    const id = dailyId(date);
    const label = date.getDate() + ' ' + MONTH_NAMES[date.getMonth()] + ' ' + date.getFullYear();
    const save = data || loadSave();
    box.appendChild(buildCard({ id, label }, save.tracks[id], { sub: label }));
    const canvasEl = box.querySelector('canvas.thumb');
    if (canvasEl) {
        paintThumb(canvasEl);
    }
}

let defaultTrackId = CONFIG.introTracks[0];

function buildHome() {
    const data = loadSave();
    const lists = listTracks();
    const newPlayer = data.stats.races === 0;
    const today = lists.daily[0];
    const intro1 = lists.intro[0];
    const intro2 = lists.intro[1];

    const heroEntry = newPlayer ? intro1 : today;
    defaultTrackId = heroEntry.id;
    // The hero track needs its name at once, so build it now.
    try {
        getTrack(heroEntry.id);
    } catch (err) {
        console.error('Track failed', err);
    }

    const hero = $('home-hero');
    const row = $('home-row');
    const past = $('home-past');
    hero.replaceChildren();
    row.replaceChildren();
    past.replaceChildren();

    hero.appendChild(buildCard(heroEntry, data.tracks[heroEntry.id], {
        hero: true,
        sub: newPlayer ? 'Intro 1' : "Today's track",
        badge: newPlayer ? 'Start here' : ''
    }));

    const rowEntries = newPlayer ? [today, intro2] : [intro1, intro2];
    rowEntries.forEach((entry) => {
        const isToday = entry === today;
        row.appendChild(buildCard(entry, data.tracks[entry.id], { sub: isToday ? "Today's track" : entry.label }));
    });
    row.previousElementSibling.textContent = newPlayer ? 'More tracks' : 'Learn the ropes';

    // Past days, one folding group per month. The cards of a month are built the first time
    // it is opened, so a year of history costs nothing until the player looks at it.
    const pastEntries = lists.daily.slice(1);
    const months = new Map();
    pastEntries.forEach((entry) => {
        const key = entry.date.slice(0, 7);
        if (!months.has(key)) {
            months.set(key, []);
        }
        months.get(key).push(entry);
    });
    let first = true;
    months.forEach((entries, key) => {
        const group = el('details', 'month');
        const raced = entries.filter((entry) => data.tracks[entry.id]).length;
        const summary = el('summary', 'month-head');
        summary.appendChild(el('span', 'month-name', MONTH_NAMES[Number(key.slice(5)) - 1] + ' ' + key.slice(0, 4)));
        summary.appendChild(el('span', 'month-count', raced ? raced + ' of ' + entries.length + ' raced' : entries.length + ' tracks'));
        group.appendChild(summary);
        const fill = () => {
            if (group.dataset.built) {
                return;
            }
            group.dataset.built = '1';
            const list = el('ul', 'card-list');
            entries.forEach((entry) => {
                const item = el('li');
                item.appendChild(buildCard(entry, data.tracks[entry.id], { sub: entry.label }));
                list.appendChild(item);
            });
            group.appendChild(list);
            for (const canvasEl of list.querySelectorAll('canvas.thumb')) {
                wantThumb(canvasEl);
            }
        };
        group.addEventListener('toggle', () => {
            if (group.open) {
                fill();
            }
        });
        if (first) {
            group.open = true;
            fill();
            first = false;
        }
        past.appendChild(group);
    });
    past.previousElementSibling.hidden = pastEntries.length === 0;

    // Date picker: any day up to today.
    const pick = $('pick-date');
    pick.max = today.date;
    showPicked(pick.value, data);

    for (const canvasEl of homeEl.querySelectorAll('canvas.thumb')) {
        wantThumb(canvasEl);
    }
    // Paint the hero straight away so the first screen looks finished.
    const heroCanvas = hero.querySelector('canvas.thumb');
    if (heroCanvas) {
        paintThumb(heroCanvas);
    }
    homeEl.scrollTop = 0;
}

if ('IntersectionObserver' in window) {
    thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                thumbObserver.unobserve(entry.target);
                thumbQueue.push(entry.target);
            }
        }
        drainThumbs();
    }, { root: homeEl, rootMargin: '240px 0px' });
}

function showHome() {
    mode = 'home';
    race = null;
    input.reset();
    hideBanner();
    $('wrongway').hidden = true;
    buildHome();
    setScreen('home');
    playMusic('menu');
}

// ---------- Race session ----------

let race = null;
let track = null;
let rendererTrack = null;
let acc = 0;
let finishTimer = 0;
let resultsData = null;
let clockReset = true;

const hudCache = { place: '', lap: '', time: '' };

function setText(id, key, value) {
    if (hudCache[key] !== value) {
        hudCache[key] = value;
        $(id).textContent = value;
    }
}

let bannerTimer = 0;
function showBanner(text, hideAfterMs, small) {
    const banner = $('banner');
    clearTimeout(bannerTimer);
    banner.textContent = text;
    banner.classList.toggle('small', !!small);
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    if (hideAfterMs) {
        bannerTimer = setTimeout(hideBanner, hideAfterMs);
    }
}

function hideBanner() {
    clearTimeout(bannerTimer);
    const banner = $('banner');
    banner.classList.remove('show');
    banner.textContent = '';
}

function startRace(trackId) {
    try {
        // The track data is shared and never changed, so the race gets a copy with the
        // number of laps the player chose.
        track = Object.assign({}, getTrack(trackId), { laps: settings.laps });
        race = createRace(track);
    } catch (err) {
        console.error('Could not start the race', err);
        showHome();
        return;
    }
    if (rendererTrack !== track) {
        renderer.setTrack(track);
        rendererTrack = track;
    }
    layout();
    acc = 0;
    finishTimer = 0;
    resultsData = null;
    clockReset = true;
    hudCache.place = hudCache.lap = hudCache.time = '';
    updateHud();
    $('wrongway').hidden = true;
    hideBanner();
    input.reset();
    mode = 'play';
    setScreen('race');
    playMusic('race');
}

function pauseRace() {
    if (mode !== 'play') {
        return;
    }
    mode = 'paused';
    input.reset();
    setScreen('pause');
}

function resumeRace() {
    if (mode !== 'paused') {
        return;
    }
    mode = 'play';
    clockReset = true;
    acc = 0;
    setScreen('race');
}

function restartRace() {
    if (track) {
        startRace(track.id);
    }
}

function updateHud() {
    if (!race) {
        return;
    }
    const state = race.state;
    const me = state.racers[0];
    setText('hud-place', 'place', ordinal(me.place || 1));
    setText('hud-lap', 'lap', 'Lap ' + Math.min(me.lap + 1, track.laps) + '/' + track.laps);
    const t = me.finished && typeof me.finishTime === 'number' ? me.finishTime : state.time;
    setText('hud-time', 'time', formatTime(t));
    $('wrongway').hidden = !(me.wrongWay && state.phase === 'racing' && !me.finished);
}

const OTHER_RIDER_SOUNDS = { pickup: 0.22, boost: 0.18, jump: 0.2, land: 0.18, bump: 0.18 };

function handleEvent(ev) {
    renderer.onEvent(ev);
    if (ev.type === 'count') {
        audio.sfx('count');
        showBanner(String(ev.value));
        return;
    }
    if (ev.type === 'go') {
        audio.sfx('go');
        showBanner('GO!', 800);
        return;
    }
    if (ev.racer === 0) {
        if (ev.type === 'finish') {
            audio.sfx('finish');
            if (race && race.state.racers[0].place === 1) {
                audio.sfx('win');
            }
        } else {
            audio.sfx(ev.type);
        }
        return;
    }
    const volume = OTHER_RIDER_SOUNDS[ev.type];
    if (volume) {
        audio.sfx(ev.type, volume);
    }
}

function beginFinish() {
    mode = 'finishing';
    input.reset();
    input.setActive(false);
    showBanner('Finish!', 0, true);
    const res = race.results();
    const outcome = recordResult(track.id, res, track.laps);
    resultsData = { res, outcome, trackId: track.id };
}

function showResults() {
    const { res, outcome } = resultsData;
    mode = 'results';
    hideBanner();
    $('wrongway').hidden = true;

    const place = res.place || 1;
    $('res-title').textContent = ordinal(place);
    $('res-track').textContent = track.name;
    const messages = {
        1: 'You win! Great riding, Brock.',
        2: 'So close! Second place.',
        3: 'On the podium. Nice ride.',
        4: 'Tough race. Try again.'
    };
    $('res-msg').textContent = messages[place] || messages[4];

    const badge = $('res-new');
    if (outcome.newBestTime) {
        badge.textContent = 'New best time!';
        badge.hidden = false;
    } else if (outcome.newBestPlace) {
        badge.textContent = 'New best place!';
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }

    const list = $('res-list');
    list.replaceChildren();
    const order = Array.isArray(res.order) ? res.order : [];
    order.forEach((entry, index) => {
        const li = el('li', 'res-row' + (entry.id === 'brock' ? ' me' : ''));
        li.appendChild(el('span', 'res-pos', ordinal(index + 1)));
        const portrait = el('canvas', 'portrait portrait-sm');
        portrait.width = 88;
        portrait.height = 88;
        portrait.setAttribute('aria-hidden', 'true');
        try {
            drawPortrait(portrait, entry.id);
        } catch (err) {
            console.error('Portrait failed', err);
        }
        li.appendChild(portrait);
        li.appendChild(el('span', 'res-name', entry.name));
        li.appendChild(el('span', 'res-row-time', entry.time === null || entry.time === undefined ? 'DNF' : formatTime(entry.time)));
        list.appendChild(li);
    });

    $('res-time').textContent = formatTime(res.time);
    $('res-lap').textContent = formatTime(res.bestLap);
    setScreen('results');
}

// ---------- Game loop ----------

let lastTs = 0;

function frame(now) {
    requestAnimationFrame(frame);
    if (clockReset || !lastTs) {
        lastTs = now;
        clockReset = false;
    }
    const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;

    if (mode === 'home') {
        return;
    }

    if ((mode === 'play' || mode === 'finishing') && race) {
        const state = race.state;
        const inp = mode === 'play' ? input.read() : { steer: 0, pedal: false, brake: false };
        acc += dt;
        let steps = 0;
        while (acc >= CONFIG.fixedDt && steps < MAX_STEPS_PER_FRAME) {
            race.step(CONFIG.fixedDt, inp);
            acc -= CONFIG.fixedDt;
            steps += 1;
        }
        if (steps === MAX_STEPS_PER_FRAME) {
            acc = 0;
        }
        const events = state.events;
        for (let i = 0; i < events.length; i += 1) {
            handleEvent(events[i]);
        }
        events.length = 0;
        updateHud();

        if (mode === 'play' && state.phase === 'finished') {
            beginFinish();
        } else if (mode === 'finishing') {
            finishTimer += dt;
            if (finishTimer >= FINISH_DELAY) {
                showResults();
            }
        }
    }

    if (race) {
        renderer.draw(race.state, mode === 'paused' ? 0 : dt);
    }
}

// ---------- Events and keyboard ----------

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        input.reset();
        if (mode === 'play') {
            pauseRace();
        }
    } else {
        clockReset = true;
    }
});

document.addEventListener('click', (e) => {
    const button = e.target.closest ? e.target.closest('button') : null;
    if (button && button.dataset.act === undefined) {
        audio.sfx('click');
    }
    const trackButton = button && button.dataset.track;
    if (trackButton && screen === 'home' && !infoOpen) {
        startRace(trackButton);
    }
});

$('btn-music').addEventListener('click', () => toggleSetting('music'));
$('btn-effects').addEventListener('click', () => toggleSetting('effects'));
$('btn-info').addEventListener('click', openInfo);
$('btn-info-close').addEventListener('click', closeInfo);
$('info').addEventListener('click', (e) => {
    if (e.target === $('info')) {
        closeInfo();
    }
});
$('btn-pause').addEventListener('click', pauseRace);
$('btn-resume').addEventListener('click', resumeRace);
$('btn-restart').addEventListener('click', restartRace);
$('btn-quit').addEventListener('click', showHome);
$('btn-again').addEventListener('click', restartRace);
$('btn-tracks').addEventListener('click', showHome);

function visibleButtons(container) {
    return Array.from(container.querySelectorAll('button')).filter((b) => b.offsetParent !== null);
}

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
    }
    const onButton = !!(e.target && e.target.closest && e.target.closest('button'));

    if (infoOpen) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeInfo();
        } else if (e.key === 'Tab') {
            const items = visibleButtons($('info'));
            if (items.length) {
                e.preventDefault();
                // The panel holds one button, so Tab keeps the focus on it.
                items[0].focus({ preventScroll: true });
            }
        }
        return;
    }

    const escape = e.key === 'Escape' || e.code === 'KeyP';
    switch (screen) {
        case 'race':
            if (escape && !e.repeat) {
                e.preventDefault();
                pauseRace();
            }
            break;
        case 'pause':
            if ((escape || (e.key === 'Enter' && !onButton)) && !e.repeat) {
                e.preventDefault();
                resumeRace();
            }
            break;
        case 'results':
            if (e.key === 'Enter' && !onButton && !e.repeat) {
                e.preventDefault();
                restartRace();
            } else if (e.key === 'Escape' && !e.repeat) {
                e.preventDefault();
                showHome();
            }
            break;
        case 'home':
            if (e.key === 'Enter' && !onButton && !e.repeat) {
                e.preventDefault();
                startRace(defaultTrackId);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const items = visibleButtons(homeEl);
                if (items.length) {
                    e.preventDefault();
                    const at = items.indexOf(document.activeElement);
                    const step = e.key === 'ArrowDown' ? 1 : -1;
                    const next = at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + step));
                    items[next].focus();
                }
            }
            break;
        default:
            break;
    }
});

// Race length stepper on the home screen.
function showLaps() {
    $('laps-value').textContent = String(settings.laps);
    $('btn-laps-less').disabled = settings.laps <= CONFIG.laps.min;
    $('btn-laps-more').disabled = settings.laps >= CONFIG.laps.max;
}

function changeLaps(step) {
    const next = Math.max(CONFIG.laps.min, Math.min(CONFIG.laps.max, settings.laps + step));
    if (next === settings.laps) {
        return;
    }
    settings.laps = next;
    saveSettings(settings);
    audio.sfx('click');
    showLaps();
    // Best times are kept per race length, so the cards need a refresh.
    const top = homeEl.scrollTop;
    buildHome();
    homeEl.scrollTop = top;
}

// Tilt steering switch. The sensor needs a tap before it may be read (iPhones ask the
// player), so a saved "on" is re-armed by the first tap after the page loads.
function showTilt(note) {
    const button = $('btn-tilt');
    button.setAttribute('aria-pressed', settings.tilt ? 'true' : 'false');
    button.textContent = settings.tilt ? 'On' : 'Off';
    $('tilt-note').textContent = note || (settings.tilt ? 'Lean the phone left and right to steer.' : 'Steer by leaning the phone.');
}

function setTiltSetting(on) {
    input.setTilt(on).then((ok) => {
        settings.tilt = on && ok;
        saveSettings(settings);
        showTilt(on && !ok ? 'This device did not allow the motion sensor.' : '');
    });
}

$('btn-tilt').addEventListener('click', () => {
    audio.sfx('click');
    setTiltSetting(!settings.tilt);
});
if (settings.tilt) {
    const arm = () => {
        window.removeEventListener('pointerdown', arm, true);
        if (settings.tilt) {
            setTiltSetting(true);
        }
    };
    window.addEventListener('pointerdown', arm, true);
}
showTilt();

$('btn-laps-less').addEventListener('click', () => changeLaps(-1));
$('btn-laps-more').addEventListener('click', () => changeLaps(1));
showLaps();

// ---------- Start up ----------

function start() {
    // Saved bests are kept for every track ever raced; a record is tiny.
    $('pick-date').addEventListener('change', (event) => showPicked(event.target.value));

    applySettings();
    try {
        drawPortrait($('title-portrait'), 'brock');
    } catch (err) {
        console.error('Portrait failed', err);
    }
    setTouchUi(!!(coarse && coarse.matches));
    layout();
    showHome();
    requestAnimationFrame(frame);
    try {
        registerServiceWorker();
    } catch (err) {
        console.error('Service worker failed', err);
    }
}

start();
