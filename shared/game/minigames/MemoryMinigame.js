import { MEMORY_TABLE } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';
import { LandingTracker, rectAt } from './landing.js';

const FACES = ['🐙', '🦄', '🍩', '🚀', '🐸', '🎸', '🌵', '👽', '🍉', '🦖', '🎩', '🐝'];
const SHOW = 1.6; // une carte retournée reste visible ce temps-là pour tout le monde

// Le mémory géant (le jeu de société, en grand) : on retourne une carte en s'arrêtant dessus.
// Deuxième carte identique à sa première : la paire est à soi. Sinon les deux se retournent.
// Les cartes retournées par les autres sont visibles aussi : regarder et se souvenir paie.
export class MemoryMinigame {
  static id = 'memory';
  static name = 'Le mémory géant';
  static description = 'Arrête-toi sur une carte pour la retourner, puis trouve sa jumelle. Les cartes des autres sont visibles : retiens-les !';
  static durationSeconds = 90;

  initialize(ctx) {
    this.ctx = ctx;
    const faces = ctx.rng.shuffle(FACES).slice(0, MEMORY_TABLE.cards.length / 2);
    this.faces = ctx.rng.shuffle([...faces, ...faces]);
    this.owner = this.faces.map(() => null); // id du joueur qui a pris la paire
    this.shownUntil = this.faces.map(() => -1);
    this.first = new Map(); // joueur -> index de sa première carte retournée
    this.pairs = new Map(ctx.players.map((p) => [p.id, 0]));
    this.land = new LandingTracker();
    this.world = ctx.createWorld({
      map: MEMORY_TABLE,
      rules: { items: true, respawn: true, respawnDelay: 1, knockbackScale: 1 },
      hooks: {},
    });
  }

  start() {}

  flip(p, i) {
    const w = this.world;
    const t = w.time;
    if (i < 0 || this.owner[i] !== null) return;
    this.shownUntil[i] = t + SHOW;
    w.emit('memFlip', { id: p.id, card: i, face: this.faces[i] });
    const first = this.first.get(p.id);
    if (first === undefined || first === i || this.owner[first] !== null) {
      this.first.set(p.id, i);
      return;
    }
    this.first.delete(p.id);
    if (this.faces[first] === this.faces[i]) {
      this.owner[first] = p.id;
      this.owner[i] = p.id;
      this.pairs.set(p.id, (this.pairs.get(p.id) ?? 0) + 1);
      w.emit('memPair', { id: p.id, face: this.faces[i] });
    } else {
      this.shownUntil[first] = t + SHOW;
      w.emit('memMiss', { id: p.id });
    }
  }

  update() {
    this.land.update(this.world, (p) => this.flip(p, rectAt(MEMORY_TABLE.cards, p.x, p.y)));
  }

  isOver() {
    return this.owner.every((o) => o !== null);
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : this.pairs.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au nombre de paires trouvées.' };
  }

  // Visible pour tous : cartes prises (avec leur propriétaire) et cartes retournées en ce moment.
  visible() {
    const t = this.world.time;
    const firsts = new Set(this.first.values());
    return this.faces.map((f, i) => (this.owner[i] !== null || t < this.shownUntil[i] || firsts.has(i) ? f : null));
  }

  hud() {
    return {
      kind: 'memory',
      faces: this.visible(),
      owner: this.owner,
      pairs: Object.fromEntries(this.pairs),
      first: Object.fromEntries(this.first),
    };
  }

  botMode() {
    return 'memory';
  }

  botHint() {
    return { kind: 'memory', game: this };
  }

  dispose() {}
}
