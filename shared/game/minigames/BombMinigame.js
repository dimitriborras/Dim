import { BOMB_BOX } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { CombatSystem } from '../CombatSystem.js';
import { groupRanking } from './MinigameRegistry.js';

const PASS_LOCK = 0.6; // on ne peut pas renvoyer la bombe aussitôt
const RELOAD = 1.6; // pause entre deux explosions

// La patate chaude (Mario Party, « Hot Bob-omb ») : une bombe passe de figurine en figurine au
// moindre contact. Quand la mèche arrive au bout, celui qui la tient saute. Le dernier gagne.
// La mèche n'est pas affichée en secondes : on l'entend seulement accélérer.
export class BombMinigame {
  static id = 'bomb';
  static name = 'La patate chaude';
  static description = 'Une bombe passe au moindre contact. Quand elle explose, celui qui la tient est éliminé. Refile-la !';
  static durationSeconds = 90;

  initialize(ctx) {
    this.ctx = ctx;
    this.out = [];
    this.holder = null;
    this.fuseEnd = 0;
    this.fuseTotal = 1;
    this.passLock = 0;
    this.nextAt = 0;
    this.world = ctx.createWorld({
      map: BOMB_BOX,
      rules: { items: true, respawn: false, knockbackScale: 1 },
      hooks: {},
    });
  }

  start() {
    this.nextAt = this.world.time + 1;
  }

  alive() {
    return this.world.players.filter((p) => p.state === 'alive' && !this.out.includes(p.id));
  }

  give(p) {
    if (this.holder) this.holder.speedFactor = 1;
    this.holder = p;
    p.speedFactor = 1.12; // le porteur file un peu plus vite pour pouvoir refiler la bombe
  }

  arm() {
    const alive = this.alive();
    if (alive.length < 2) return;
    this.give(this.ctx.rng.pick(alive));
    this.fuseTotal = this.ctx.rng.range(7, 12);
    this.fuseEnd = this.world.time + this.fuseTotal;
    this.passLock = this.world.time + PASS_LOCK;
    this.world.emit('bombArm', { id: this.holder.id });
  }

  update() {
    const w = this.world;
    const t = w.time;
    if (!this.holder) {
      if (this.nextAt && t >= this.nextAt) { this.nextAt = 0; this.arm(); }
      return;
    }
    const h = this.holder;
    // Contact : la bombe change de main.
    if (t >= this.passLock && h.state === 'alive') {
      for (const o of this.alive()) {
        if (o === h || t < o.airborneUntil) continue;
        if (Math.hypot(o.x - h.x, o.y - h.y) <= PLAYER.radius * 2 + 6) {
          this.give(o);
          this.passLock = t + PASS_LOCK;
          w.emit('bombPass', { id: o.id, from: h.id, x: Math.round(o.x), y: Math.round(o.y) });
          break;
        }
      }
    }
    if (t >= this.fuseEnd) {
      const victim = this.holder;
      victim.speedFactor = 1;
      this.holder = null;
      w.shockwave(victim, 160, 520);
      w.emit('boom', { x: victim.x, y: victim.y, r: 160 });
      CombatSystem.eliminate(w, victim, null, 'bomb');
      this.out.push(victim.id);
      this.nextAt = t + RELOAD;
    }
  }

  isOver() {
    return this.world.players.length > 1 && this.alive().length <= 1 && !this.holder;
  }

  finish() {
    const n = this.out.length;
    const sorted = this.ctx.players
      .map((p) => {
        const i = this.out.indexOf(p.id);
        return { id: p.id, score: p.connected === false ? -1 : i < 0 ? n + 1 : i };
      })
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement à l\'ordre des explosions : le dernier debout gagne.' };
  }

  hud() {
    const t = this.world.time;
    return {
      kind: 'bomb',
      holder: this.holder?.id ?? null,
      // Chaleur de la mèche (0 → 1), sans dévoiler le temps exact.
      heat: this.holder ? Math.round(Math.min(1, 1 - (this.fuseEnd - t) / this.fuseTotal) * 10) / 10 : 0,
      alive: this.alive().map((p) => p.id),
      out: this.out.slice(),
    };
  }

  botMode() {
    return 'bomb';
  }

  botHint() {
    return { kind: 'bomb', holder: this.holder?.id ?? null };
  }

  dispose() {
    for (const p of this.ctx.players) p.speedFactor = 1;
  }
}
