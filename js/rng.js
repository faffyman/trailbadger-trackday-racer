// Seeded random numbers. Pure module, no DOM access.

/**
 * Hash a string to an unsigned 32 bit integer (FNV-1a with a final avalanche step).
 * @param {string} str
 * @returns {number} uint32
 */
export function hashString(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    // Final mixing so that similar strings (for example consecutive dates) give distant seeds.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/**
 * Make a mulberry32 random stream.
 * @param {number} seed uint32
 * @returns {() => number} function returning a float in [0, 1)
 */
export function makeRng(seed) {
    let a = seed >>> 0;
    return function rnd() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
