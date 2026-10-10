import { MOVERS_HOUSE } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { groupRanking } from './MinigameRegistry.js';

const BREAK_SPEED = 340; // en dessous, un choc n'abîme rien
const CAT_EVERY = 2.6; // le chat bondit régulièrement

// Le déménagement (inspiré de R.E.P.O.) : la maison est plongée dans le noir, chacun a sa lampe.
// Il faut pousser des objets fragiles jusqu'au camion. Chaque choc violent leur fait perdre de la
// valeur, jusqu'à les casser. Le piano est lourd : à plusieurs, ça va mieux. Le chat de la maison
// bondit sur tout ce qui bouge. Chacun marque la valeur qu'il livre ; l'équipe a un objectif commun.
export class MoversMinigame {
  static id = 'movers';
  static name = 'Le déménagement';
  static description = 'Dans le noir, pousse les objets fragiles jusqu\'au camion 🚚. Chaque choc leur fait perdre de la valeur. Attention au chat !';
  static durationSeconds = 120;

  initialize(ctx) {
    this.ctx = ctx;
    this.delivered = new Map(ctx.players.map((p) => [p.id, 0]));
    this.team = 0;
    this.broken = 0;
    this.world = ctx.createWorld({
      map: MOVERS_HOUSE,
      rules: { items: true, respawn: true, respawnDelay: 1, knockbackScale: 1 },
      hooks: { onBallImpact: (b, speed) => this.impact(b, speed) },
    });
    this.cat = this.world.balls.find((b) => b.kind === '🐈‍⬛');
    this.totalValue = this.world.balls.reduce((s, b) => s + b.value, 0);
    this.quota = Math.round((this.totalValue * 0.55) / 10) * 10;
  }

  start() {
    this.catAt = this.world.time + 3;
  }

  impact(b, speed) {
    if (!b.active || b === this.cat || !b.maxValue || speed < BREAK_SPEED) return;
    const loss = Math.round((speed - BREAK_SPEED) * 0.18);
    if (loss <= 0) return;
    b.value = Math.max(0, b.value - loss);
    this.world.emit('damage', { x: Math.round(b.x), y: Math.round(b.y), loss, kind: b.kind });
    if (b.value === 0) {
      b.active = false;
      b.backAt = Infinity;
      this.broken += 1;
      this.world.emit('broken', { x: Math.round(b.x), y: Math.round(b.y), kind: b.kind });
    }
  }

  update() {
    const w = this.world;
    const t = w.time;
    const T = MOVERS_HOUSE.truck;
    for (const b of w.balls) {
      if (!b.active || b === this.cat) continue;
      if (b.x > T.x && b.x < T.x + T.w && b.y > T.y && b.y < T.y + T.h) {
        b.active = false;
        b.backAt = Infinity;
        const who = t - b.lastHitAt < 6 ? b.lastHitBy : null;
        if (who) this.delivered.set(who, (this.delivered.get(who) ?? 0) + b.value);
        this.team += b.value;
        w.emit('delivered', { id: who, kind: b.kind, value: b.value });
      }
    }
    // Le chat : il fonce sur la figurine (ou l'objet) la plus proche.
    if (this.cat && this.catAt && t >= this.catAt) {
      this.catAt = t + CAT_EVERY + this.ctx.rng.range(-0.6, 0.6);
      const targets = [...w.players.filter((p) => p.state === 'alive'), ...w.balls.filter((b) => b.active && b !== this.cat)];
      let best = null;
      let bd = 520;
      for (const o of targets) {
        const d = Math.hypot(o.x - this.cat.x, o.y - this.cat.y);
        if (d < bd && d > 30) { bd = d; best = o; }
      }
      if (best) {
        const d = bd || 1;
        this.cat.vx = ((best.x - this.cat.x) / d) * 560;
        this.cat.vy = ((best.y - this.cat.y) / d) * 560;
        this.cat.lastHitBy = null;
        w.emit('meow', { x: Math.round(this.cat.x), y: Math.round(this.cat.y) });
      }
    }
  }

  isOver() {
    return this.world.balls.every((b) => b === this.cat || !b.active);
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : this.delivered.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const ok = this.team >= this.quota;
    return {
      ranking: groupRanking(sorted),
      summary: `Livré : ${this.team} € sur un objectif de ${this.quota} € ${ok ? '— objectif atteint !' : '— raté…'} Classement à la valeur livrée par chacun.`,
    };
  }

  hud() {
    return {
      kind: 'movers',
      team: this.team,
      quota: this.quota,
      broken: this.broken,
      delivered: Object.fromEntries(this.delivered),
      values: this.world.balls.filter((b) => b.active && b !== this.cat).map((b) => [b.id, b.value, b.maxValue]),
    };
  }

  botMode() {
    return 'movers';
  }

  botHint() {
    return { kind: 'movers', truck: MOVERS_HOUSE.truck, cat: this.cat };
  }

  dispose() {}
}

export const MOVERS_LIGHT = PLAYER.radius * 16; // rayon de la lampe de chacun (affichage)
