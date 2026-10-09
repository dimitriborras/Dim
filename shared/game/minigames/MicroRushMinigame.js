import { MICRO_TABLE } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';
import { MICROS, MICRO_BY_ID } from './micros.js';

const COUNT = 10;
const ANNOUNCE = 1.1; // le mot d'ordre s'affiche seul
const RESULT = 1.0; // verdict « Réussi / Raté »

// La Rafale : une suite de micro-jeux à la WarioWare joués par tous en même temps.
// Chaque micro-jeu réussi rapporte un point ; le rythme accélère tous les trois.
export class MicroRushMinigame {
  static id = 'micro';
  static name = 'La Rafale';
  static description = '10 micro-jeux de quelques secondes : un ordre, un geste. Ça accélère !';
  static durationSeconds = 120; // plafond de sécurité : la rafale se termine d'elle-même

  initialize(ctx) {
    this.ctx = ctx;
    this.wins = new Map(ctx.players.map((p) => [p.id, 0]));
    this.sequence = this.plan(ctx.rng);
    this.index = -1;
    this.phase = 'wait';
    this.phaseEnd = 0;
    this.inst = null;
    this.results = null;
    this.done = false;
    this.world = this.makeWorld();
  }

  // 10 micro-jeux, sans répétition immédiate, dont 2 ou 3 avec la physique de palet.
  plan(rng) {
    const simple = MICROS.filter((m) => !m.physics).map((m) => m.id);
    const physics = MICROS.filter((m) => m.physics).map((m) => m.id);
    const seq = [];
    let bag = [];
    const physicsSlots = new Set([2, 5, 8].slice(0, rng.next() < 0.5 ? 2 : 3).map((i) => i + rng.int(0, 1)));
    for (let i = 0; i < COUNT; i++) {
      if (physicsSlots.has(i)) { seq.push(rng.pick(physics)); continue; }
      if (!bag.length) bag = rng.shuffle(simple);
      let next = bag.shift();
      if (seq[seq.length - 1] === next && bag.length) { bag.push(next); next = bag.shift(); }
      seq.push(next);
    }
    return seq;
  }

  makeWorld() {
    const w = this.ctx.createWorld({
      map: MICRO_TABLE,
      rules: { damage: false, weapons: 'none', items: false, respawn: false, knockbackScale: 1 },
      hooks: {},
    });
    w.rules.frozen = true;
    return w;
  }

  get def() {
    return MICRO_BY_ID.get(this.sequence[this.index]) ?? null;
  }

  speed() {
    return 1 + 0.22 * Math.floor(Math.max(0, this.index) / 3);
  }

  start() {
    this.next();
  }

  next() {
    this.index += 1;
    this.inst = null;
    this.results = null;
    if (this.index >= this.sequence.length) {
      this.done = true;
      return;
    }
    // Micro-jeu physique : nouvelle petite table, tout le monde debout et prêt.
    if (this.def.physics) this.world = this.makeWorld();
    this.world.rules.frozen = true;
    this.phase = 'announce';
    this.phaseEnd = this.world.time + ANNOUNCE;
  }

  update() {
    const w = this.world;
    const t = w.time;
    if (this.done) return;
    if (this.phase === 'announce' && t >= this.phaseEnd) {
      this.inst = this.def.create({ rng: this.ctx.rng, speed: this.speed(), start: t });
      this.phase = 'play';
      this.phaseEnd = t + this.inst.duration;
      if (this.def.physics) w.rules.frozen = false;
      w.emit('microStart', { id: this.def.id });
    } else if (this.phase === 'play') {
      for (const p of this.ctx.players) {
        if (!p.bot || p.connected === false) continue;
        const msg = this.inst.bot(p, t, this.ctx.rng, p.bot.skill ?? 0.7);
        if (msg) this.inst.input(p, msg, t);
      }
      if (t >= this.phaseEnd) {
        this.results = {};
        for (const p of this.ctx.players) {
          if (p.connected === false) continue;
          const won = !!this.inst.won(p, w);
          this.results[p.id] = won;
          if (won) this.wins.set(p.id, (this.wins.get(p.id) ?? 0) + 1);
        }
        w.rules.frozen = true;
        this.phase = 'result';
        this.phaseEnd = t + RESULT;
        w.emit('microEnd', { id: this.def.id });
      }
    } else if (this.phase === 'result' && t >= this.phaseEnd) {
      this.next();
    }
  }

  input(p, msg) {
    if (this.phase === 'play' && this.inst) this.inst.input(p, msg, this.world.time);
  }

  isOver() {
    return this.done;
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => ({ id: p.id, score: p.connected === false ? -1 : this.wins.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au nombre de micro-jeux réussis.' };
  }

  hud() {
    const d = this.def;
    return {
      kind: 'micro',
      index: this.index,
      total: this.sequence.length,
      speed: Math.round(this.speed() * 100) / 100,
      phase: this.phase,
      phaseEnd: this.phaseEnd,
      id: d?.id ?? null,
      verb: d?.verb ?? '',
      hint: d?.hint ?? '',
      physics: d?.physics ?? null,
      data: this.inst ? this.inst.data : null,
      results: this.results,
      scores: Object.fromEntries(this.wins),
    };
  }

  privateState(playerId) {
    const p = this.ctx.players.find((x) => x.id === playerId);
    if (!p || !this.inst) return null;
    return { ...this.inst.progress(p), won: this.results ? this.results[playerId] ?? null : null };
  }

  botMode() {
    return this.phase === 'play' && this.def?.physics ? 'micro' : 'safe';
  }

  botHint() {
    return this.def?.physics ? { kind: this.def.physics, center: MICRO_TABLE.center } : null;
  }

  dispose() {}
}
