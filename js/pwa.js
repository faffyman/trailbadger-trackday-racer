// Track Day Racer: registers the offline service worker.
// A quiet no-op when service workers are unsupported or the page is opened from file://.

export function registerServiceWorker() {
    try {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }
        if (location.protocol !== 'https:' && location.protocol !== 'http:') {
            return;
        }
        const register = () => {
            // Relative to the page, so the game works from any folder.
            navigator.serviceWorker.register('sw.js').catch(() => {});
        };
        if (document.readyState === 'complete') {
            register();
        } else {
            window.addEventListener('load', register, { once: true });
        }
    } catch (e) {
        // Offline support is optional. Never break the game.
    }
}
