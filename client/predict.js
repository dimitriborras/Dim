// Prédiction locale : le client applique tout de suite ses propres gestes (pichenette,
// petite tape) avec la même physique de palet que le serveur, puis se recale sur chaque
// état confirmé en rejouant les commandes pas encore traitées. Le serveur reste seul juge
// des chocs entre figurines, des tirs et des chutes.
import { DT, PLAYER } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { glide, collideWalls, collideBumpers, flickSpeed, flingDuration } from '../shared/game/movement.js';

const STEP_MS = DT * 1000;

export class Predictor {
  constructor() {
    this.seq = 0;
    this.pending = [];
    this.pos = null;
    this.prev = null;
    this.stepAt = 0;
    this.offset = { x: 0, y: 0 };
    this.sf = 1;
    this.slowed = false;
    this.map = null;
    this.energy = PLAYER.energyMax;
  }

  // Même ordre que World.stepPlayer : recharge, geste, glissade, rebonds.
  step(b, cmd) {
    b.energy = Math.min(this.em ?? PLAYER.energyMax, b.energy + (this.er ?? PLAYER.energyRegen) * DT);
    const f = cmd.fl;
    if (f) {
      if (f.hop && b.energy >= PLAYER.hopCost) {
        const v = PLAYER.hopSpeed * this.sf;
        b.vx = Math.cos(f.a) * v; b.vy = Math.sin(f.a) * v;
        b.energy -= PLAYER.hopCost;
      } else if (!f.hop && b.energy >= PLAYER.flickCost) {
        const v = flickSpeed(f.p, this.sf);
        b.vx = Math.cos(f.a) * v; b.vy = Math.sin(f.a) * v;
        b.fling = flingDuration(f.p);
        b.energy -= PLAYER.flickCost;
      }
    }
    glide(b, DT, this.map, { fling: b.fling > 0, slowed: this.slowed });
    b.fling = Math.max(0, b.fling - DT);
    collideWalls(b, this.map.walls);
    collideBumpers(b, this.map.bumpers);
  }

  // À chaque commande envoyée (30 par seconde) : numérotation et avance immédiate.
  record(input) {
    this.seq += 1;
    input.s = this.seq;
    this.pending.push({ s: this.seq, fl: input.fl ?? null });
    if (this.pending.length > 60) this.pending.shift();
    if (this.pos) {
      this.prev = { x: this.pos.x, y: this.pos.y };
      this.step(this.pos, { fl: input.fl });
      this.stepAt = performance.now();
      this.energy = this.pos.energy;
    }
  }

  // À chaque instantané : on repart de l'état confirmé et on rejoue le reste.
  reconcile(body, mapId) {
    this.map = MAPS[mapId] ?? MAPS.arena;
    this.pending = this.pending.filter((c) => c.s > body.seq);
    this.energy = body.energy;
    if (!body.free) {
      this.pos = null;
      this.offset = { x: 0, y: 0 };
      return;
    }
    this.sf = body.sf;
    this.em = body.em;
    this.er = body.er;
    this.slowed = body.slowed;
    const sim = { x: body.x, y: body.y, vx: body.vx, vy: body.vy, energy: body.energy, fling: body.fling };
    for (const c of this.pending) this.step(sim, c);
    if (this.pos) {
      const ex = this.pos.x - sim.x;
      const ey = this.pos.y - sim.y;
      if (Math.hypot(ex, ey) < 90) {
        // Petite erreur (choc avec une autre figurine…) : correction lissée plutôt qu'un saut.
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
    this.energy = sim.energy;
  }

  // Position à afficher pour le joueur local, ou null si la prédiction est suspendue
  // (renversé, en l'air, sur une banane, en chute : on suit alors le serveur).
  display(frameDt) {
    if (!this.pos || !this.prev) return null;
    const k = Math.min(1, (performance.now() - this.stepAt) / STEP_MS);
    const decay = Math.exp(-frameDt * 12);
    this.offset.x *= decay;
    this.offset.y *= decay;
    return {
      x: this.prev.x + (this.pos.x - this.prev.x) * k + this.offset.x,
      y: this.prev.y + (this.pos.y - this.prev.y) * k + this.offset.y,
      vx: this.pos.vx,
      vy: this.pos.vy,
    };
  }
}
