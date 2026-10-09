// PlayerController côté client : transforme clavier, souris, tactile et manette en
// intentions (direction, angle de visée, boutons). Aucun résultat n'est calculé ici.
import { settings } from './settings.js';

// Inclinaison de la vue (doit correspondre au rendu) : sert à convertir une direction écran en direction monde.
export const TILT = 0.78;

const MOVE = {
  up: ['KeyW', 'ArrowUp'], // KeyW = touche Z en AZERTY (code physique)
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], // KeyA = touche Q en AZERTY
  right: ['KeyD', 'ArrowRight'],
};

const KEY_ACTIONS = {
  KeyE: 'gadget', KeyR: 'c0', KeyF: 'c1',
  Digit1: 's0', Digit2: 's1', Digit3: 's2', Numpad1: 's0', Numpad2: 's1', Numpad3: 's2',
  Digit4: 'c0', Digit5: 'c1',
};

// Boutons de manette standard (disposition Xbox) -> actions.
const PAD_ACTIONS = { 1: 'gadget', 2: 'c0', 3: 'c1', 4: 'wp', 5: 'wn' };

// Direction d'un stick (repère écran) -> direction dans le monde, en gardant l'amplitude.
function screenToWorldDir(x, y) {
  const m = Math.hypot(x, y);
  if (m < 1e-6) return { x: 0, y: 0 };
  const wx = x;
  const wy = y / TILT;
  const l = Math.hypot(wx, wy);
  return { x: (wx / l) * m, y: (wy / l) * m };
}

// Zone morte radiale avec remise à l'échelle : pas de dérive, mais toute la course reste utile.
function deadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, (m - dz) / (1 - dz)) };
}

export class InputController {
  constructor(canvas, { aimFromMouse, onKey, onPadButton }) {
    this.canvas = canvas;
    this.aimFromMouse = aimFromMouse; // (x, y écran) => angle monde depuis le joueur
    this.onKey = onKey;
    this.onPadButton = onPadButton;
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2 + 100, y: innerHeight / 2 };
    this.mouseDown = false;
    this.actions = [];
    this.aim = 0;
    this.aimAssisted = false; // la visée vient d'un stick : l'aide peut s'appliquer
    this.touch = { move: null, aim: null, fireHeld: false };
    this.isTouch = false;
    this.device = 'mouse'; // 'mouse' | 'touch' | 'pad'
    this.padPrev = [];
    this.lastMoveAngle = null;
    this.padMoving = false;
    this.wheelAt = 0;
    this.charge = null; // pichenette en cours de chargement
    this.flick = null; // pichenette relâchée, envoyée avec la prochaine commande
    this.enabled = true;
    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.device = 'mouse';
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft') this.startCharge('key');
      if (KEY_ACTIONS[e.code]) { this.actions.push(KEY_ACTIONS[e.code]); e.preventDefault(); }
      this.onKey?.(e.code, true);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if ((e.code === 'Space' || e.code === 'ShiftLeft') && this.charge?.source === 'key') this.releaseCharge();
      this.onKey?.(e.code, false);
    });
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (!this.isTouch) this.device = 'mouse';
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.actions.push('gadget');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Molette : arme suivante / précédente (limitée pour éviter de sauter plusieurs armes).
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - this.wheelAt < 120 || Math.abs(e.deltaY) < 1) return;
      this.wheelAt = now;
      this.actions.push(e.deltaY > 0 ? 'wn' : 'wp');
    }, { passive: false });
    addEventListener('gamepadconnected', () => { this.device = 'pad'; });
  }

  // Joysticks virtuels : apparaissent là où le pouce se pose.
  bindTouch(root) {
    this.isTouch = true;
    this.device = 'touch';
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
        this.device = 'touch';
        e.preventDefault();
      });
      zone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        let dx = e.clientX - ox;
        let dy = e.clientY - oy;
        const d = Math.hypot(dx, dy);
        // Stick « qui suit le pouce » : si l'on dépasse le bord, la base se déplace.
        if (d > R) {
          const over = d - R;
          ox += (dx / d) * over;
          oy += (dy / d) * over;
          const r = zone.getBoundingClientRect();
          stick.style.left = `${ox - r.left}px`;
          stick.style.top = `${oy - r.top}px`;
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.touch[key] = { x: dx / R, y: dy / R };
        stick.classList.toggle('firing', key === 'aim' && settings.autoFire && Math.hypot(dx, dy) / R > 0.5);
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        stick.classList.remove('on', 'firing');
        knob.style.transform = 'translate(-50%, -50%)';
        this.touch[key] = null;
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    };
    setupStick(root.querySelector('#zoneL'), 'move');
    setupStick(root.querySelector('#zoneR'), 'aim');

    // Bouton pichenette : on le tire comme une fronde (direction opposée au glissé),
    // un simple appui donne une petite pichenette vers l'avant.
    const sling = root.querySelector('#tdash');
    let slingId = null;
    sling.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      slingId = e.pointerId;
      sling.setPointerCapture(slingId);
      this.startCharge('touch', e.clientX, e.clientY);
      sling.classList.add('on');
    });
    sling.addEventListener('pointermove', (e) => {
      if (e.pointerId !== slingId || !this.charge) return;
      this.charge.dx = e.clientX - this.charge.ox;
      this.charge.dy = e.clientY - this.charge.oy;
    });
    const slingEnd = (e) => {
      if (e.pointerId !== slingId) return;
      slingId = null;
      sling.classList.remove('on');
      this.releaseCharge(e.type === 'pointercancel');
    };
    sling.addEventListener('pointerup', slingEnd);
    sling.addEventListener('pointercancel', slingEnd);

    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.actions.push(b.dataset.act);
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 120);
      });
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

  startCharge(source, ox = 0, oy = 0) {
    if (this.charge) return;
    this.charge = { source, start: performance.now(), ox, oy, dx: 0, dy: 0 };
  }

  // Angle (monde) et puissance (0 à 1) de la pichenette en cours, pour l'aperçu et l'envoi.
  chargeState() {
    const c = this.charge;
    if (!c) return null;
    if (c.source === 'touch') {
      const d = Math.hypot(c.dx, c.dy);
      if (d < 14) return { a: this.lastMoveAngle ?? this.aim, p: 0.45, tap: true };
      return { a: Math.atan2(-c.dy / TILT, -c.dx), p: Math.min(1, d / 90) };
    }
    const p = Math.min(1, 0.25 + (performance.now() - c.start) / 650);
    const a = c.source === 'pad' && this.lastMoveAngle !== null && this.padMoving ? this.lastMoveAngle : this.aim;
    return { a, p };
  }

  releaseCharge(cancel = false) {
    const st = this.chargeState();
    this.charge = null;
    if (!cancel && st) this.flick = { a: Math.round(st.a * 1000) / 1000, p: Math.round(st.p * 100) / 100 };
  }

  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return null;
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const any = pressed.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.35);
    if (any) this.device = 'pad';
    if (pressed[0] && !this.padPrev[0]) this.startCharge('pad');
    if (!pressed[0] && this.padPrev[0] && this.charge?.source === 'pad') this.releaseCharge();
    pressed.forEach((on, i) => {
      if (!on || this.padPrev[i]) return;
      if (PAD_ACTIONS[i]) this.actions.push(PAD_ACTIONS[i]);
      else this.onPadButton?.(i);
    });
    this.padPrev = pressed;
    if (this.device !== 'pad') return null;
    const move = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.18);
    const aim = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.25);
    const trigger = Math.max(pad.buttons[7]?.value ?? 0, pad.buttons[6]?.value ?? 0);
    return { move, aim, trigger };
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
    this.aimAssisted = false;

    const pad = this.pollPad();
    if (pad) {
      if (pad.move.m > 0) ({ x: mx, y: my } = screenToWorldDir(pad.move.x, pad.move.y));
      this.padMoving = pad.move.m > 0.3;
      if (pad.aim.m > 0) {
        this.aim = Math.atan2(pad.aim.y / TILT, pad.aim.x);
        this.aimAssisted = true;
        if (settings.autoFire && pad.aim.m > 0.6) fire = true;
      } else if (pad.move.m > 0.3) {
        this.aim = Math.atan2(my, mx);
        this.aimAssisted = true;
      }
      if (pad.trigger > 0.3) fire = true;
    } else if (this.touch.move || this.touch.aim || this.device === 'touch') {
      if (this.touch.move) ({ x: mx, y: my } = screenToWorldDir(this.touch.move.x, this.touch.move.y));
      if (this.touch.aim) {
        const { x, y } = this.touch.aim;
        const m = Math.hypot(x, y);
        if (m > 0.2) { this.aim = Math.atan2(y / TILT, x); this.aimAssisted = true; }
        if (settings.autoFire && m > 0.5) fire = true;
      } else if (this.touch.move && Math.hypot(mx, my) > 0.3) {
        this.aim = Math.atan2(my, mx); // sans pouce droit : on vise là où l'on avance
        this.aimAssisted = true;
      }
      if (this.touch.fireHeld) fire = true;
    } else {
      this.aim = this.aimFromMouse(this.mouse.x, this.mouse.y) ?? this.aim;
    }
    if (Math.hypot(mx, my) > 0.3) this.lastMoveAngle = Math.atan2(my, mx);

    const act = this.actions.splice(0, 6);
    const fl = this.flick;
    this.flick = null;
    if (!this.enabled) return { t: 'in', mx: 0, my: 0, a: this.aim, f: false, act: [] };
    const cmd = { t: 'in', mx, my, a: Math.round(this.aim * 1000) / 1000, f: fire, act };
    if (fl) cmd.fl = fl;
    return cmd;
  }
}
