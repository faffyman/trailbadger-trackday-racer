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

// Tilt steering: lean the phone left or right like a handlebar.
const TILT_DEAD = 4;   // degrees of lean that do nothing
const TILT_FULL = 24;  // degrees of lean for full steer

export function createInput(root) {
    const keysDown = new Set();
    const pointers = new Map(); // pointerId -> act or null
    const buttons = root ? Array.from(root.querySelectorAll('[data-act]')) : [];
    let active = false;
    let tiltOn = false;
    let tiltSteer = 0;
    let tiltSeen = false;

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
        const pressed = (set.has('right') ? 1 : 0) - (set.has('left') ? 1 : 0);
        return {
            // A steer button or key always wins over the lean of the phone.
            steer: pressed !== 0 || !tiltOn ? pressed : tiltSteer,
            pedal: set.has('pedal'),
            brake: set.has('brake')
        };
    }

    // Which way the phone leans, as seen by the player, whatever way up the screen is.
    function onTilt(e) {
        if (e.gamma === null || e.beta === null || e.gamma === undefined) {
            return;
        }
        let turn = 0;
        if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
            turn = window.screen.orientation.angle;
        } else if (typeof window.orientation === 'number') {
            turn = window.orientation;
        }
        turn = ((turn % 360) + 360) % 360;
        let lean = e.gamma;
        if (turn === 90) lean = e.beta;
        else if (turn === 270) lean = -e.beta;
        else if (turn === 180) lean = -e.gamma;
        const size = Math.abs(lean);
        const amount = size <= TILT_DEAD ? 0 : Math.min(1, (size - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
        tiltSteer = lean < 0 ? -amount : amount;
        tiltSeen = true;
    }

    // Turn tilt steering on or off. Call it from a tap: iPhones ask the player for
    // permission and only allow that question during a user gesture.
    // Resolves to true when tilt is on and the motion sensor may be read.
    function setTilt(on) {
        if (!on || typeof window.DeviceOrientationEvent === 'undefined') {
            tiltOn = false;
            tiltSteer = 0;
            window.removeEventListener('deviceorientation', onTilt);
            return Promise.resolve(false);
        }
        const listen = () => {
            tiltOn = true;
            window.removeEventListener('deviceorientation', onTilt);
            window.addEventListener('deviceorientation', onTilt);
            return true;
        };
        const ask = window.DeviceOrientationEvent.requestPermission;
        if (typeof ask === 'function') {
            return ask.call(window.DeviceOrientationEvent)
                .then((answer) => (answer === 'granted' ? listen() : false))
                .catch(() => false);
        }
        return Promise.resolve(listen());
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

    return { read, reset, setActive, setTilt, tiltSeen: () => tiltSeen };
}
