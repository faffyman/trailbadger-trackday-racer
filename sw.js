// Track Day Racer: offline cache.
//
// DEVELOPERS: bump CACHE_NAME (trailbadger-racer-v14, v3 ...) on every release so players get the
// new files, and add every new game file to FILES below. A file that is not listed is never
// cached and the game will not work offline. The tasks/ folder is not part of the game.
//
// Strategy: cache first with a background refresh. The game starts offline from the cache and
// quietly updates the cached copy whenever the network is there. Install is all or nothing: if
// any file fails to download, install fails, the old worker (if any) stays in charge, and the
// game keeps running from the network. The browser retries on a later visit.

const CACHE_NAME = 'trailbadger-racer-v14';
const CACHE_PREFIX = 'trailbadger-racer-';

const FILES = [
    './',
    'index.html',
    'css/game.css',
    'js/config.js',
    'js/rng.js',
    'js/track.js',
    'js/race.js',
    'js/render/sprites.js',
    'js/render/scene.js',
    'js/input.js',
    'js/storage.js',
    'js/main.js',
    'js/audio.js',
    'js/pwa.js',
    'manifest.webmanifest',
    'assets/img/brock.webp',
    'assets/img/icon-180.png',
    'assets/img/icon-192.png',
    'assets/img/icon-512.png'
];

const scopeUrl = new URL(self.registration.scope);
const urlOf = (path) => new URL(path, scopeUrl).href;
const KNOWN = new Set(FILES.map(urlOf));
const HOME = urlOf('./');
const INDEX = urlOf('index.html');

// Cache key for a request: the URL without its query string or hash.
function keyOf(url) {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        // Fetch everything first, store only when every file arrived.
        const responses = await Promise.all(FILES.map(async (path) => {
            const url = urlOf(path);
            const response = await fetch(new Request(url, { cache: 'reload' }));
            if (!response.ok) {
                throw new Error('Precache failed for ' + path + ' (' + response.status + ')');
            }
            return [url, response];
        }));
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    const key = keyOf(request.url);
    // Only the game files are handled. Everything else goes straight to the network.
    if (!KNOWN.has(key)) {
        return;
    }
    const lookup = key;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(lookup)) || (lookup === HOME ? await cache.match(INDEX) : undefined);
        const refresh = fetch(new Request(lookup, { cache: 'no-cache' })).then(async (response) => {
            if (response && response.status === 200 && KNOWN.has(lookup)) {
                await cache.put(lookup, response.clone());
            }
            return response;
        });
        if (cached) {
            event.waitUntil(refresh.catch(() => {}));
            return cached;
        }
        try {
            return await refresh;
        } catch (error) {
            return Response.error();
        }
    })());
});
