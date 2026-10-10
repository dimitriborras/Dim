import { ARENA, KING_SPOTS } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';

const R = 95; // rayon de la colline
const MOVE_EVERY = 12; // la colline change de place

// Le roi de la colline : une zone lumineuse sur le billard. On marque tant qu'on y est SEUL ;
// à deux ou plus, personne ne marque : il faut pousser les autres dehors (ou dans une poche).
// La zone change de place régulièrement : la course recommence.
export class KingMinigame {
  static id = 'king';
  static name = 'Le roi de la colline';
  static description = 'Reste SEUL dans la zone pour marquer. À plusieurs, personne ne marque : pousse les autres dehors ! La zone se déplace.';
  static durationSeconds = 60;

  initialize(ctx) {
    this.ctx = ctx;
    this.held = new Map(ctx.players.map((p) => [p.id, 0]));
    this.spot = 0;
    this.king = null;
    this.contested = false;
    this.world = ctx.createWorld({
      map: ARENA,
      rules: { items: true, respawn: true, respawnDelay: 2, knockbackScale: 1 },
      hooks: {},
    });
    this.world.balls = []; // pas de boules : la colline se dispute entre figurines
  }

  start() {
    this.moveAt = this.world.time + MOVE_EVERY;
  }

  get zone() {
    return { ...KING_SPOTS[this.spot], r: R };
  }

  update(dt) {
    const w = this.world;
    if (this.moveAt && w.time >= this.moveAt) {
      let next = this.spot;
      while (next === this.spot) next = this.ctx.rng.int(0, KING_SPOTS.length - 1);
      this.spot = next;
      this.moveAt = w.time + MOVE_EVERY;
      w.emit('hillMove', { x: this.zone.x, y: this.zone.y });
    }
    const z = this.zone;
    const inside = w.players.filter((p) => p.state === 'alive' && Math.hypot(p.x - z.x, p.y - z.y) <= z.r);
    const king = inside.length === 1 ? inside[0] : null;
    this.contested = inside.length > 1;
    if (king && king.id !== this.king) w.emit('hillKing', { id: king.id });
    this.king = king?.id ?? null;
    if (king) this.held.set(king.id, (this.held.get(king.id) ?? 0) + dt);
  }

  isOver() {
    return false;
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : Math.round((this.held.get(p.id) ?? 0) * 10) }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au temps passé seul sur la colline.' };
  }

  hud() {
    return {
      kind: 'king',
      zone: this.zone,
      king: this.king,
      contested: this.contested,
      moveIn: this.moveAt ? Math.max(0, Math.round((this.moveAt - this.world.time) * 10) / 10) : null,
      held: Object.fromEntries([...this.held].map(([k, v]) => [k, Math.round(v * 10) / 10])),
    };
  }

  botMode() {
    return 'king';
  }

  botHint() {
    return { kind: 'king', zone: this.zone, king: this.king };
  }

  dispose() {}
}
