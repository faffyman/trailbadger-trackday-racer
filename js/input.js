// Track Day Racer: keyboard and multi-touch input.
// createInput(root) returns { read(), reset(), setActive(on) }.
// root holds the touch buttons. Each button has a data-act of left, right, pedal or brake.
// setActive is an extra: key presses only block the browser default while it is on.

const KEY_ACTS = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'pedal',
    KeyW: 'pedal',
    ArrowDown: 'brake',
    KeyS: 'brake'
};

// A finger this close to a button (in CSS px) still counts for it. This bridges the gap
// between the two steer buttons when a thumb slides from one to the other.
const REACH = 26;

export function createInput(root) {
    const keysDown = new Set();
    const pointers = new Map(); // pointerId -> act or null
    const buttons = root ? Array.from(root.querySelectorAll('[data-act]')) : [];
    let active = false;

    function actAt(x, y) {
        let best = null;
        let bestDist = REACH;
        for (const button of buttons) {
            const r = button.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) {
                continue;
            }
            const dx = Math.max(r.left - x, 0, x - r.right);
            const dy = Math.max(r.top - y, 0, y - r.bottom);
            const dist = Math.hypot(dx, dy);
            if (dist <= bestDist) {
                bestDist = dist;
                best = button.dataset.act;
            }
        }
        return best;
    }

    function acts() {
        const set = new Set(pointers.values());
        for (const code of keysDown) {
            set.add(KEY_ACTS[code]);
        }
        return set;
    }

    function paint() {
        const set = acts();
        for (const button of buttons) {
            button.classList.toggle('is-down', set.has(button.dataset.act));
        }
    }

    function reset() {
        keysDown.clear();
        pointers.clear();
        paint();
    }

    function read() {
        const set = acts();
        return {
            steer: (set.has('right') ? 1 : 0) - (set.has('left') ? 1 : 0),
            pedal: set.has('pedal'),
            brake: set.has('brake')
        };
    }

    function setActive(on) {
        active = !!on;
        if (!active) {
            reset();
        }
    }

    function onKeyDown(e) {
        if (!(e.code in KEY_ACTS) || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (!active) {
            return;
        }
        e.preventDefault();
        keysDown.add(e.code);
        paint();
    }

    function onKeyUp(e) {
        if (keysDown.delete(e.code)) {
            paint();
        }
    }

    function onPointerDown(e) {
        if (!root) {
            return;
        }
        const act = actAt(e.clientX, e.clientY);
        if (!act) {
            return;
        }
        e.preventDefault();
        try {
            root.setPointerCapture(e.pointerId);
        } catch (err) {
            // Capture can fail for synthetic pointers. The listeners below still work.
        }
        pointers.set(e.pointerId, act);
        paint();
    }

    function onPointerMove(e) {
        if (!pointers.has(e.pointerId)) {
            return;
        }
        const act = actAt(e.clientX, e.clientY);
        if (pointers.get(e.pointerId) !== act) {
            pointers.set(e.pointerId, act);
            paint();
        }
    }

    function onPointerEnd(e) {
        if (pointers.delete(e.pointerId)) {
            paint();
        }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    if (root) {
        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerup', onPointerEnd);
        root.addEventListener('pointercancel', onPointerEnd);
        root.addEventListener('lostpointercapture', onPointerEnd);
        root.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    return { read, reset, setActive };
}
