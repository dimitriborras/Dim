import { PALET_LANE } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { groupRanking } from './MinigameRegistry.js';

const MENES = 3;
const PLAY = 13; // secondes par mène au plus
const SCORE = 2.6; // pause : on compte les points
const SHOTS = 2; // pichenettes par mène
const RING_POINTS = [5, 3, 1];

// Le Palet : trois mènes, deux pichenettes chacune, tout le monde en même temps.
// À la fin de la mène, les palets restés sur la piste marquent selon l'anneau où ils
// s'arrêtent. Viser le cœur… ou dégommer ceux qui y sont déjà (crokinole, curling).
export class PaletMinigame {
  static id = 'palet';
  static name = 'Le Palet';
  static description = '3 mènes, 2 pichenettes chacune : finis au cœur de la cible (5, 3 ou 1 point), ou dégomme ceux qui y sont.';
  static durationSeconds = MENES * (PLAY + SCORE) + 2;

  initialize(ctx) {
    this.ctx = ctx;
    this.map = PALET_LANE;
    this.totals = new Map(ctx.players.map((p) => [p.id, 0]));
    this.last = {};
    this.mene = 0;
    this.phase = 'play';
    this.done = false;
    this.newMene();
  }

  newMene() {
    this.world = this.ctx.createWorld({
      map: this.map,
      rules: { items: false, respawn: false, regen: 0, knockbackScale: 1 },
      hooks: {},
    });
    // Deux pichenettes exactement : pas de recharge pendant la mène.
    for (const p of this.world.players) p.energy = SHOTS * PLAYER.flickCost;
    this.phase = 'play';
    this.phaseEnd = this.world.time + PLAY;
    this.calmSince = null;
  }

  start() {
    this.phaseEnd = this.world.time + PLAY;
  }

  ringOf(p) {
    if (p.state !== 'alive') return -1;
    const d = Math.hypot(p.x - this.map.target.x, p.y - this.map.target.y);
    return this.map.target.rings.findIndex((r) => d <= r);
  }

  scoreMene() {
    this.last = {};
    for (const p of this.ctx.players) {
      const ring = this.ringOf(p);
      const pts = ring >= 0 ? RING_POINTS[ring] : 0;
      this.last[p.id] = pts;
      this.totals.set(p.id, (this.totals.get(p.id) ?? 0) + pts);
    }
    this.world.emit('meneEnd', { scores: this.last });
  }

  update() {
    const w = this.world;
    const t = w.time;
    if (this.done) return;
    if (this.phase === 'play') {
      // Mène finie plus tôt si plus personne ne bouge ni ne peut tirer.
      const calm = w.players.every((p) => p.state !== 'alive' || (Math.hypot(p.vx, p.vy) < 5 && p.energy < PLAYER.flickCost))
        && w.players.every((p) => p.state !== 'falling');
      this.calmSince = calm ? this.calmSince ?? t : null;
      if (t >= this.phaseEnd || (this.calmSince !== null && t - this.calmSince > 0.8)) {
        this.scoreMene();
        w.rules.frozen = true;
        this.phase = 'score';
        this.phaseEnd = t + SCORE;
      }
    } else if (t >= this.phaseEnd) {
      this.mene += 1;
      if (this.mene >= MENES) { this.done = true; return; }
      this.newMene();
    }
  }

  isOver() {
    return this.done;
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : this.totals.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement aux points de cible sur les trois mènes.' };
  }

  hud() {
    return {
      kind: 'palet',
      mene: Math.min(this.mene, MENES - 1) + 1,
      menes: MENES,
      phase: this.phase,
      scores: Object.fromEntries(this.totals),
      last: this.phase === 'score' ? this.last : null,
    };
  }

  botMode() {
    return this.phase === 'play' ? 'palet' : 'safe';
  }

  botHint() {
    return { kind: 'palet', center: this.map.target, rings: this.map.target.rings };
  }

  dispose() {}
}
