// PlayerController côté client : transforme clavier, souris et tactile en
// intentions (direction, angle de visée, boutons). Aucun résultat n'est calculé ici.

const MOVE = {
  up: ['KeyW', 'ArrowUp'], // KeyW = touche Z en AZERTY (code physique)
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], // KeyA = touche Q en AZERTY
  right: ['KeyD', 'ArrowRight'],
};

export class InputController {
  constructor(canvas, { aimOrigin, onKey }) {
    this.canvas = canvas;
    this.aimOrigin = aimOrigin; // () => {x, y} en pixels écran
    this.onKey = onKey;
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2 + 100, y: innerHeight / 2 };
    this.mouseDown = false;
    this.actions = [];
    this.aim = 0;
    this.touch = { move: null, aim: null, fireHeld: false };
    this.isTouch = false;
    this.enabled = true;
    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { Space: 'dash', KeyE: 'gadget', KeyR: 'c0', KeyF: 'c1', Digit1: 's0', Digit2: 's1', Digit3: 's2', Numpad1: 's0', Numpad2: 's1', Numpad3: 's2', Digit4: 'c0', Digit5: 'c1' };
      if (map[e.code]) { this.actions.push(map[e.code]); e.preventDefault(); }
      this.onKey?.(e.code, true);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.onKey?.(e.code, false);
    });
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    this.canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.actions.push('gadget');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Joysticks virtuels : apparaissent là où le pouce se pose.
  bindTouch(root) {
    this.isTouch = true;
    const setupStick = (zone, key) => {
      const stick = zone.querySelector('.stick');
      const knob = zone.querySelector('.knob');
      let id = null;
      let ox = 0;
      let oy = 0;
      const R = 55;
      zone.addEventListener('pointerdown', (e) => {
        if (id !== null) return;
        id = e.pointerId;
        zone.setPointerCapture(id);
        const r = zone.getBoundingClientRect();
        ox = e.clientX;
        oy = e.clientY;
        stick.style.left = `${ox - r.left}px`;
        stick.style.top = `${oy - r.top}px`;
        stick.classList.add('on');
        this.touch[key] = { x: 0, y: 0 };
        e.preventDefault();
      });
      zone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        let dx = e.clientX - ox;
        let dy = e.clientY - oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.touch[key] = { x: dx / R, y: dy / R };
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        stick.classList.remove('on');
        knob.style.transform = 'translate(-50%, -50%)';
        this.touch[key] = null;
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    };
    setupStick(root.querySelector('#zoneL'), 'move');
    setupStick(root.querySelector('#zoneR'), 'aim');

    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions.push(b.dataset.act); });
    }
    const fire = root.querySelector('[data-hold="fire"]');
    fire.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch.fireHeld = true; fire.classList.add('on'); });
    const stop = () => { this.touch.fireHeld = false; fire.classList.remove('on'); };
    fire.addEventListener('pointerup', stop);
    fire.addEventListener('pointercancel', stop);
    fire.addEventListener('pointerleave', stop);
  }

  pressAction(a) {
    this.actions.push(a);
  }

  sample() {
    let mx = 0;
    let my = 0;
    const down = (list) => list.some((k) => this.keys.has(k));
    if (down(MOVE.up)) my -= 1;
    if (down(MOVE.down)) my += 1;
    if (down(MOVE.left)) mx -= 1;
    if (down(MOVE.right)) mx += 1;
    let fire = this.mouseDown;

    if (this.touch.move) { mx = this.touch.move.x; my = this.touch.move.y; }
    const o = this.aimOrigin();
    if (this.touch.aim) {
      const { x, y } = this.touch.aim;
      const m = Math.hypot(x, y);
      // Visée tolérante : petite zone morte, pas de cible minuscule à toucher.
      if (m > 0.2) this.aim = Math.atan2(y, x);
      if (m > 0.85) fire = true;
    } else if (!this.isTouch) {
      this.aim = Math.atan2(this.mouse.y - o.y, this.mouse.x - o.x);
    } else if (this.touch.move && Math.hypot(mx, my) > 0.3) {
      this.aim = Math.atan2(my, mx); // sans pouce droit : on vise là où l'on avance
    }
    if (this.touch.fireHeld) fire = true;

    const act = this.actions.splice(0, 6);
    if (!this.enabled) return { t: 'in', mx: 0, my: 0, a: this.aim, f: false, act: [] };
    return { t: 'in', mx, my, a: Math.round(this.aim * 1000) / 1000, f: fire, act };
  }
}
