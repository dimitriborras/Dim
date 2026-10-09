import { ARENA } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { groupRanking } from './MinigameRegistry.js';

// Ruée sur les jetons : ramasser un maximum de jetons. Un tir fait lâcher un jeton,
// une chute en fait perdre la moitié.
export class CoinRushMinigame {
  static id = 'coins';
  static name = 'Ruée sur les jetons';
  static description = 'Ramassez les jetons (dorés = 3). Un tir fait lâcher un jeton à la cible, tomber en fait perdre la moitié.';
  static durationSeconds = 60;

  initialize(ctx) {
    this.ctx = ctx;
    this.coins = new Map();
    this.lastDrop = new Map();
    this.spawnTimer = 0;
    this.world = ctx.createWorld({
      map: ARENA,
      rules: { damage: false, weapons: 'pistol', items: false, respawnDelay: 1.5, respawnInvuln: 0.8, knockbackScale: 1.3 },
      hooks: {
        onHit: (attacker, victim) => this.onHit(attacker, victim),
        onEliminated: (victim) => this.onFall(victim),
      },
    });
    for (const p of ctx.players) this.coins.set(p.id, 0);
    for (let i = 0; i < 8; i++) this.spawnCoin();
  }

  start() {}

  randomGround(cx, cy, spread) {
    const w = this.world;
    for (let i = 0; i < 30; i++) {
      const x = cx === undefined ? this.ctx.rng.range(150, 1450) : cx + this.ctx.rng.range(-spread, spread);
      const y = cy === undefined ? this.ctx.rng.range(130, 870) : cy + this.ctx.rng.range(-spread, spread);
      const ok = [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dy]) => w.isGround(x + dx, y + dy));
      if (ok && !w.overlapsWall(x, y, 16) && w.movers.every((m) => !(x > m.x - 30 && x < m.x + m.w + 30 && y > m.y - 30 && y < m.y + m.h + 30))) return { x, y };
    }
    return null;
  }

  spawnCoin(at, kind) {
    const pos = at ? this.randomGround(at.x, at.y, 70) : this.randomGround();
    if (!pos) return;
    const k = kind ?? (this.ctx.rng.next() < 0.12 ? 'gold' : 'coin');
    this.world.pickups.push({ id: this.world.nextId++, kind: k, x: pos.x, y: pos.y, value: k === 'gold' ? 3 : 1 });
  }

  onHit(attacker, victim) {
    const n = this.coins.get(victim.id) ?? 0;
    const t = this.world.time;
    if (n <= 0 || t - (this.lastDrop.get(victim.id) ?? -9) < 0.3) return;
    this.lastDrop.set(victim.id, t);
    this.coins.set(victim.id, n - 1);
    this.spawnCoin(victim, 'coin');
  }

  onFall(victim) {
    const n = this.coins.get(victim.id) ?? 0;
    const lost = Math.ceil(n / 2);
    if (lost > 0) {
      this.coins.set(victim.id, n - lost);
      this.world.emit('coinLoss', { id: victim.id, amount: lost });
    }
  }

  update(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.world.pickups.length < 14) {
      this.spawnCoin();
      this.spawnTimer = 0.45;
    }
    for (const pk of this.world.pickups) {
      if (pk.dead) continue;
      for (const p of this.world.players) {
        if (p.state !== 'alive' || this.world.time < p.airborneUntil) continue;
        if (Math.hypot(p.x - pk.x, p.y - pk.y) < PLAYER.radius + 14) {
          pk.dead = true;
          this.coins.set(p.id, (this.coins.get(p.id) ?? 0) + pk.value);
          this.world.emit('coin', { id: p.id, value: pk.value, x: pk.x, y: pk.y });
          break;
        }
      }
    }
    this.world.pickups = this.world.pickups.filter((pk) => !pk.dead);
  }

  isOver() {
    return false;
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : this.coins.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au nombre de jetons.' };
  }

  hud() {
    return { kind: 'coins', scores: Object.fromEntries(this.coins) };
  }

  dispose() {}
}
