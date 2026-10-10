// Commandes à un doigt, identiques sur téléphone, souris et manette :
//   - poser le doigt n'importe où, tirer en arrière, relâcher : pichenette (fronde) ;
//   - petite tape : petit bond vers l'endroit touché ;
//   - bouton d'objet (ou E, Espace, clic droit) : gadget ou consommable.
// Mode « stick » (jeux à une autre physique, ex. la Mine) : on pose le doigt et on glisse
// dans une direction, comme un joystick qui apparaît sous le pouce ; flèches/ZQSD au clavier.
// Aucun résultat n'est calculé ici : on n'envoie que des gestes.
import { vibrate } from './settings.js';

// Inclinaison de la vue (doit correspondre au rendu) : convertit une direction écran en direction monde.
export const TILT = 0.78;

const TAP_PX = 14; // en dessous : c'est une tape
const DEAD_PX = 22; // zone morte de la fronde : relâcher ici annule

export class InputController {
  constructor(canvas, { screenToWorld, screenDir, playerWorld, onKey, onPadButton }) {
    this.canvas = canvas;
    this.screenToWorld = screenToWorld; // (sx, sy) -> point du sol
    // (dx, dy) écran -> angle monde (la vue peut être inclinée et tournée en vertical)
    this.screenDir = screenDir ?? ((dx, dy) => Math.atan2(dy / TILT, dx));
    this.playerWorld = playerWorld; // () -> position monde du joueur local ou null
    this.onKey = onKey;
    this.onPadButton = onPadButton;
    this.actions = [];
    this.drag = null; // geste en cours
    this.flick = null; // geste relâché, envoyé avec la prochaine commande
    this.lastAngle = 0;
    this.padPrev = [];
    this.padHold = null;
    this.mouse = { x: 0, y: 0 };
    this.enabled = true;
    this.mode = 'flick'; // 'flick' | 'stick'
    this.stick = { x: 0, y: 0 };
    this.keys = new Set();
    this.bind();
  }

  // Longueur de tirage pour la pleine puissance : proportionnelle à l'écran, confortable au pouce.
  pullRange() {
    return Math.max(90, Math.min(220, Math.min(innerWidth, innerHeight) * 0.3));
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this.actions.push('item'); return; }
      if (this.drag || e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0, start: performance.now(), step: 0 };
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      d.dx = e.clientX - d.ox;
      d.dy = e.clientY - d.oy;
      if (this.mode === 'stick') {
        // Joystick virtuel : 50 px de course pour la pleine vitesse, ancre qui suit si on dépasse.
        const len = Math.hypot(d.dx, d.dy);
        const R = 50;
        if (len > R * 1.6) { d.ox = e.clientX - (d.dx / len) * R * 1.6; d.oy = e.clientY - (d.dy / len) * R * 1.6; }
        this.stick = len < 10 ? { x: 0, y: 0 } : { x: Math.max(-1, Math.min(1, d.dx / R)), y: Math.max(-1, Math.min(1, d.dy / R)) };
        return;
      }
      // Petit « tic » tactile à chaque quart de puissance : on sent l'élastique se tendre.
      const st = this.chargeState();
      const step = st && st.p !== undefined ? Math.floor(st.p * 4) : 0;
      if (step > d.step) vibrate(6);
      d.step = step;
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (this.mode === 'stick') { this.drag = null; this.stick = { x: 0, y: 0 }; return; }
      const st = this.chargeState();
      this.drag = null;
      if (e.type === 'pointercancel' || !st) return;
      if (st.tap) {
        // Tape : petit bond vers le point touché.
        const me = this.playerWorld();
        if (!me) return;
        const w = this.screenToWorld(d.ox, d.oy);
        const a = Math.atan2(w.y - me.y, w.x - me.x);
        this.flick = { a: Math.round(a * 1000) / 1000, p: 0, hop: true };
        this.lastAngle = a;
        return;
      }
      if (st.cancel) return;
      this.flick = { a: Math.round(st.a * 1000) / 1000, p: Math.round(st.p * 100) / 100 };
      this.lastAngle = st.a;
      vibrate(14);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space') this.actions.push('item');
      this.onKey?.(e.code, true);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.onKey?.(e.code, false); });
    addEventListener('blur', () => this.keys.clear());
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.drag = null;
    this.stick = { x: 0, y: 0 };
  }

  // Direction du mode stick : doigt, puis clavier (flèches, ZQSD/WASD), puis manette.
  stickVector() {
    let { x, y } = this.stick;
    const k = this.keys;
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') || k.has('KeyQ') ? 1 : 0);
    const ky = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') || k.has('KeyZ') ? 1 : 0);
    if (kx || ky) { x = kx; y = ky; }
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (pad && Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > 0.3) { x = pad.axes[0]; y = pad.axes[1]; }
    return { x, y };
  }

  pressAction(a) {
    this.actions.push(a);
  }

  // Geste en cours : { a, p } (fronde), { tap } ou { cancel }. Sert à l'aperçu de trajectoire.
  chargeState() {
    if (this.padHold) {
      const p = Math.min(1, (performance.now() - this.padHold.start) / 700);
      return { a: this.padHold.a, p };
    }
    const d = this.drag;
    if (!d) return null;
    const dist = Math.hypot(d.dx, d.dy);
    if (dist < TAP_PX && performance.now() - d.start < 350) return { tap: true };
    if (dist < DEAD_PX) return { cancel: true };
    // On tire en arrière : la figurine part à l'opposé du glissé.
    return { a: this.screenDir(-d.dx, -d.dy), p: Math.min(1, (dist - DEAD_PX) / this.pullRange()) };
  }

  // Manette : stick gauche pour la direction, A maintenu pour la puissance, A bref = petit bond.
  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (Math.hypot(x, y) > 0.3) this.lastAngle = this.screenDir(x, y);
    if (pressed[0] && !this.padPrev[0]) this.padHold = { start: performance.now(), a: this.lastAngle };
    if (this.padHold) this.padHold.a = this.lastAngle;
    if (!pressed[0] && this.padPrev[0] && this.padHold) {
      const held = performance.now() - this.padHold.start;
      const a = this.padHold.a;
      this.flick = held < 180 ? { a, p: 0, hop: true } : { a, p: Math.min(1, held / 700) };
      this.padHold = null;
    }
    pressed.forEach((on, i) => {
      if (!on || this.padPrev[i]) return;
      if (i === 1 || i === 2) this.actions.push('item');
      else if (i !== 0) this.onPadButton?.(i);
    });
    this.padPrev = pressed;
  }

  sample() {
    this.pollPad();
    const act = this.actions.splice(0, 6);
    const fl = this.flick;
    this.flick = null;
    if (!this.enabled) return { t: 'in', mx: 0, my: 0, a: this.lastAngle, f: false, act: [] };
    const cmd = { t: 'in', mx: 0, my: 0, a: Math.round(this.lastAngle * 1000) / 1000, f: false, act };
    if (this.mode === 'stick') {
      const v = this.stickVector();
      cmd.mx = Math.round(v.x * 100) / 100;
      cmd.my = Math.round(v.y * 100) / 100;
      return cmd;
    }
    if (fl) cmd.fl = fl;
    return cmd;
  }
}
