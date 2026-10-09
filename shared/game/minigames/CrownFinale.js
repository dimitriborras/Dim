import { ARENA } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { groupRanking } from './MinigameRegistry.js';

// Finale : la couronne. Tout l'arsenal acheté est utilisable. Garder la couronne
// rapporte du temps de possession ; être éliminé la fait tomber.
export class CrownFinale {
  static id = 'crown';
  static name = 'FINALE — La couronne';
  static description = 'Gardez la couronne le plus longtemps possible. Tout votre équipement est utilisable. Le porteur est un peu plus lent.';
  static durationSeconds = 75;
  static finale = true;

  initialize(ctx) {
    this.ctx = ctx;
    this.held = new Map();
    this.holder = null;
    this.lockUntil = 0;
    this.world = ctx.createWorld({
      map: ARENA,
      rules: { damage: true, weapons: 'all', items: true, respawnDelay: 2.5 },
      hooks: { onEliminated: (victim) => this.onEliminated(victim) },
    });
    for (const p of ctx.players) this.held.set(p.id, 0);
    this.crown = { id: this.world.nextId++, kind: 'crown', x: ARENA.center.x, y: ARENA.center.y };
    this.world.pickups.push(this.crown);
  }

  start() {}

  onEliminated(victim) {
    if (this.holder !== victim.id) return;
    this.drop(victim);
  }

  drop(p) {
    this.holder = null;
    p.speedFactor = 1;
    const onGround = this.world.isGround(p.x, p.y) && !this.world.movers.some((m) => p.x > m.x && p.x < m.x + m.w && p.y > m.y && p.y < m.y + m.h);
    this.crown.x = onGround ? p.x : ARENA.center.x;
    this.crown.y = onGround ? p.y : ARENA.center.y;
    this.lockUntil = this.world.time + 0.8;
    this.world.pickups = [this.crown];
    this.world.emit('crownDrop', { id: p.id });
  }

  update(dt) {
    const w = this.world;
    if (this.holder) {
      const h = w.players.find((p) => p.id === this.holder);
      if (!h || h.state === 'dead') {
        if (h) this.drop(h);
        else { this.holder = null; this.crown.x = ARENA.center.x; this.crown.y = ARENA.center.y; w.pickups = [this.crown]; }
      } else if (h.state === 'alive') {
        this.held.set(h.id, this.held.get(h.id) + dt);
        this.crown.x = h.x;
        this.crown.y = h.y;
      }
      return;
    }
    if (w.time < this.lockUntil) return;
    for (const p of w.players) {
      if (p.state !== 'alive' || w.time < p.airborneUntil) continue;
      if (Math.hypot(p.x - this.crown.x, p.y - this.crown.y) < PLAYER.radius + 18) {
        this.holder = p.id;
        p.speedFactor = 0.9;
        w.pickups = [];
        w.emit('crownTake', { id: p.id });
        break;
      }
    }
  }

  isOver() {
    return false;
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : Math.round((this.held.get(p.id) ?? 0) * 10) }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au temps de possession de la couronne.' };
  }

  hud() {
    return {
      kind: 'crown',
      holder: this.holder,
      held: Object.fromEntries([...this.held].map(([k, v]) => [k, Math.round(v * 10) / 10])),
    };
  }

  dispose() {
    for (const p of this.ctx.players) p.speedFactor = 1;
  }
}
