// Prédiction locale : le client applique tout de suite ses propres commandes avec la
// même physique que le serveur, puis se recale sur chaque état confirmé en rejouant
// les commandes pas encore traitées. Le serveur reste seul juge (tirs, dégâts, chutes).
import { DT } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { normalizeInput, inHazard, steerOnGround, collideWalls } from '../shared/game/movement.js';

const STEP_MS = DT * 1000;

export class Predictor {
  constructor() {
    this.seq = 0;
    this.pending = [];
    this.pos = null;
    this.prev = null;
    this.stepAt = 0;
    this.offset = { x: 0, y: 0 };
    this.maxSpeed = 0;
    this.map = null;
  }

  step(b, cmd) {
    const { mx, my } = normalizeInput(cmd.mx, cmd.my);
    steerOnGround(b, mx, my, this.maxSpeed, inHazard(this.map, b.x, b.y), DT);
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    collideWalls(b, this.map.walls);
  }

  // À chaque commande envoyée (30 par seconde) : numérotation et avance immédiate.
  record(input) {
    this.seq += 1;
    input.s = this.seq;
    this.pending.push({ s: this.seq, mx: input.mx, my: input.my });
    if (this.pending.length > 60) this.pending.shift();
    if (input.fl) {
      // Pichenette : trajectoire décidée par le serveur (chocs, recharge). On suit le serveur
      // jusqu'à ce qu'il ait traité cette commande et que le personnage soit de nouveau libre.
      this.pos = null;
      this.blockSeq = this.seq;
      return;
    }
    if (this.pos) {
      this.prev = { x: this.pos.x, y: this.pos.y };
      this.step(this.pos, input);
      this.stepAt = performance.now();
    }
  }

  // À chaque instantané : on repart de l'état confirmé et on rejoue le reste.
  reconcile(body, mapId) {
    this.map = MAPS[mapId] ?? MAPS.arena;
    this.pending = this.pending.filter((c) => c.s > body.seq);
    if (!body.free || body.seq < (this.blockSeq ?? 0)) {
      this.pos = null;
      this.offset = { x: 0, y: 0 };
      return;
    }
    this.maxSpeed = body.ms;
    const sim = { x: body.x, y: body.y, vx: body.vx, vy: body.vy };
    for (const c of this.pending) this.step(sim, c);
    if (this.pos) {
      const ex = this.pos.x - sim.x;
      const ey = this.pos.y - sim.y;
      if (Math.hypot(ex, ey) < 90) {
        // Petite erreur : correction lissée à l'affichage plutôt qu'un saut.
        this.offset.x += ex;
        this.offset.y += ey;
        this.prev = { x: this.prev.x - ex, y: this.prev.y - ey };
      } else {
        this.offset = { x: 0, y: 0 };
        this.prev = { x: sim.x, y: sim.y };
      }
    } else {
      this.prev = { x: sim.x, y: sim.y };
    }
    this.pos = sim;
  }

  // Position à afficher pour le joueur local, ou null si la prédiction est suspendue
  // (esquive, glissade, saut, chute, réapparition : on suit alors le serveur).
  display(frameDt) {
    if (!this.pos || !this.prev) return null;
    const k = Math.min(1, (performance.now() - this.stepAt) / STEP_MS);
    const decay = Math.exp(-frameDt * 12);
    this.offset.x *= decay;
    this.offset.y *= decay;
    return {
      x: this.prev.x + (this.pos.x - this.prev.x) * k + this.offset.x,
      y: this.prev.y + (this.pos.y - this.prev.y) * k + this.offset.y,
    };
  }
}
