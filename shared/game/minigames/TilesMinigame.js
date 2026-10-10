import { TILE_FLOOR } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';

const CRACK = 2; // secondes entre l'arrêt sur une dalle et sa chute
const GRACE = 2; // au départ, on a le temps de viser
const LAND_SPEED = 40; // figurine arrêtée (ou presque) : elle est « posée » sur la dalle

// Le carrelage (Fall Guys, « Hex-A-Gone ») : une dalle se fissure dès qu'une figurine s'y arrête,
// puis tombe. Glisser vite par-dessus ne l'abîme pas : il faut viser où atterrir,
// et repartir avant la chute. Le dernier debout gagne.
// Pour éviter les attentes, des dalles se fissurent aussi toutes seules, de plus en plus vite.
export class TilesMinigame {
  static id = 'tiles';
  static name = 'Le carrelage';
  static description = 'La dalle où tu t\'arrêtes tombe 2 s après (glisser par-dessus ne l\'abîme pas). Pas de deuxième chance : le dernier debout gagne.';
  static durationSeconds = 75;

  initialize(ctx) {
    this.ctx = ctx;
    this.tiles = TILE_FLOOR.platforms.map((r, i) => ({ ...r, i, crackAt: null, gone: false }));
    // Copie de la carte : seules les dalles encore là font partie du sol.
    this.map = { ...TILE_FLOOR, platforms: this.tiles.slice() };
    this.out = [];
    this.world = ctx.createWorld({
      map: this.map,
      rules: { items: true, respawn: false, knockbackScale: 1 },
      hooks: { onEliminated: (victim) => { if (!this.out.includes(victim.id)) this.out.push(victim.id); } },
    });
  }

  start() {
    this.startTime = this.world.time;
    this.nextCrumble = this.startTime + 10;
  }

  tileAt(x, y) {
    return this.tiles.find((r) => !r.gone && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
  }

  update() {
    const w = this.world;
    const t = w.time;
    if (this.startTime === undefined) return;
    for (const p of w.players) {
      if (p.state !== 'alive' || t < p.airborneUntil || t < this.startTime + GRACE) continue;
      if (Math.hypot(p.vx, p.vy) > LAND_SPEED) continue;
      const tile = this.tileAt(p.x, p.y);
      if (tile && tile.crackAt === null) tile.crackAt = t;
    }
    // Effondrement spontané : de plus en plus fréquent.
    if (t >= this.nextCrumble) {
      const intact = this.tiles.filter((r) => !r.gone && r.crackAt === null);
      if (intact.length) this.ctx.rng.pick(intact).crackAt = t;
      this.nextCrumble = t + Math.max(0.6, 2.4 - (t - this.startTime) / 25);
    }
    let changed = false;
    for (const r of this.tiles) {
      if (!r.gone && r.crackAt !== null && t >= r.crackAt + CRACK) { r.gone = true; changed = true; }
    }
    if (changed) {
      this.map.platforms = this.tiles.filter((r) => !r.gone);
      w.emit('tileFall', {});
    }
  }

  alive() {
    return this.world.players.filter((p) => p.state !== 'dead' && !this.out.includes(p.id));
  }

  isOver() {
    return this.world.players.length > 1 && this.alive().length <= 1;
  }

  finish() {
    const n = this.out.length;
    const sorted = this.ctx.players
      .map((p) => {
        const i = this.out.indexOf(p.id);
        return { id: p.id, score: p.connected === false ? -1 : i < 0 ? n + 1 : i };
      })
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement à l\'ordre des chutes : le dernier debout gagne.' };
  }

  hud() {
    const t = this.world.time;
    return {
      kind: 'tiles',
      gone: this.tiles.filter((r) => r.gone).map((r) => r.i),
      // Dalles fissurées, avec leur avancement (0 → 1) pour l'animation.
      warn: this.tiles.filter((r) => !r.gone && r.crackAt !== null).map((r) => [r.i, Math.round(Math.min(1, (t - r.crackAt) / CRACK) * 10) / 10]),
      alive: this.alive().map((p) => p.id),
      out: this.out.slice(),
    };
  }

  botMode() {
    return 'tiles';
  }

  botHint() {
    return { kind: 'tiles', tiles: this.tiles };
  }

  dispose() {}
}
