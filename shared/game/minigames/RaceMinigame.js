import { RACE_TRACK } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';

// Course : traverser le circuit avant les autres, à coups de pichenettes. On peut bousculer
// les autres dans les trous. Une chute renvoie au dernier point de contrôle.
export class RaceMinigame {
  static id = 'race';
  static name = 'Course sur le tapis';
  static description = 'Atteignez l\'arrivée à coups de pichenettes ! Bousculez les autres dans les trous, les ressorts font sauter par-dessus.';
  static durationSeconds = 75;

  initialize(ctx) {
    this.ctx = ctx;
    this.map = RACE_TRACK;
    this.state = new Map();
    this.finishOrder = [];
    this.firstFinishAt = null;
    this.world = ctx.createWorld({
      map: this.map,
      rules: { items: false, respawnDelay: 1, respawnInvuln: 0.6, knockbackScale: 1.3 },
      hooks: { spawnPoint: (p) => this.spawnPoint(p) },
    });
    for (const p of ctx.players) this.state.set(p.id, { cp: 0, finishedAt: null });
  }

  start() {
    this.startTime = this.world.time;
  }

  spawnPoint(p) {
    const st = this.state.get(p.id) ?? { cp: 0 };
    const x = this.map.checkpoints[st.cp] + 60;
    const ys = [200, 300, 400, 500, 250, 450];
    for (const y of this.ctx.rng.shuffle(ys)) {
      if (this.world.isGround(x, y) && !this.world.overlapsWall(x, y, 22)) return { x, y };
    }
    return { x, y: 350 };
  }

  update() {
    const t = this.world.time;
    for (const p of this.world.players) {
      const st = this.state.get(p.id);
      if (!st || st.finishedAt !== null || p.state !== 'alive') continue;
      while (st.cp + 1 < this.map.checkpoints.length && p.x >= this.map.checkpoints[st.cp + 1]) {
        st.cp += 1;
        this.world.emit('checkpoint', { id: p.id });
      }
      if (p.x >= this.map.finishX) {
        st.finishedAt = t - this.startTime;
        this.finishOrder.push(p.id);
        p.invulnUntil = Infinity;
        if (this.firstFinishAt === null) this.firstFinishAt = t;
        this.world.emit('finish', { id: p.id, place: this.finishOrder.length });
      }
    }
  }

  isOver() {
    const active = this.world.players;
    if (active.length && active.every((p) => this.state.get(p.id)?.finishedAt !== null)) return true;
    return this.firstFinishAt !== null && this.world.time - this.firstFinishAt > 15;
  }

  timeLeftCap() {
    return this.firstFinishAt !== null ? this.firstFinishAt + 15 : null;
  }

  finish() {
    const finished = this.finishOrder.map((id) => [id]);
    const rest = this.ctx.players
      .filter((p) => !this.finishOrder.includes(p.id))
      .map((p) => ({ id: p.id, score: p.connected === false ? -1e9 : Math.round(p.x / 10) }))
      .sort((a, b) => b.score - a.score);
    return { ranking: [...finished, ...groupRanking(rest)], summary: 'Classement à l\'arrivée puis à la distance parcourue.' };
  }

  hud() {
    const len = this.map.finishX;
    return {
      kind: 'race',
      finishX: len,
      players: this.ctx.players.map((p) => {
        const st = this.state.get(p.id);
        return {
          id: p.id,
          progress: Math.max(0, Math.min(1, (p.x ?? 0) / len)),
          place: st?.finishedAt !== null ? this.finishOrder.indexOf(p.id) + 1 : null,
        };
      }),
    };
  }

  dispose() {
    for (const p of this.ctx.players) if (p.invulnUntil === Infinity) p.invulnUntil = 0;
  }
}
