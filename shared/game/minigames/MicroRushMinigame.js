import { MICRO_TABLE, MICRO_GOLF } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';
import { MICROS, MICRO_BY_ID } from './micros.js';

const COUNT = 10;
// Gabarit de la rafale : niveaux autorisés par manche, pauses physiques et boss final.
const SLOTS = [
  { lo: 1, hi: 1 }, { lo: 1, hi: 1 }, { lo: 1, hi: 2 }, { physics: true },
  { lo: 2, hi: 2 }, { lo: 2, hi: 2 }, { physics: true },
  { lo: 2, hi: 3 }, { lo: 3, hi: 3 }, { physics: true, boss: true },
];
const ANNOUNCE = 1.1; // le mot d'ordre s'affiche seul
const RESULT = 1.0; // verdict « Réussi / Raté »

// La Rafale : une suite de micro-jeux à la WarioWare joués par tous en même temps.
// Chaque micro-jeu réussi rapporte un point ; le rythme accélère tous les trois.
export class MicroRushMinigame {
  static id = 'micro';
  static name = 'La Rafale';
  static description = '10 micro-jeux de quelques secondes : un ordre, un geste. Ça accélère, et le dernier est un boss !';
  static durationSeconds = 120; // plafond de sécurité : la rafale se termine d'elle-même

  initialize(ctx) {
    this.ctx = ctx;
    this.wins = new Map(ctx.players.map((p) => [p.id, 0]));
    this.sequence = this.plan(ctx.rng, ctx.memory);
    this.index = -1;
    this.phase = 'wait';
    this.phaseEnd = 0;
    this.inst = null;
    this.results = null;
    this.done = false;
    this.world = this.makeWorld();
  }

  // Séquence cohérente de 10 micro-jeux :
  //  - échauffement en niveau 1, puis niveau 2, puis les plus durs (niveau 3) en fin de rafale ;
  //  - jamais deux fois de suite la même capacité (réflexe, calcul, mémoire…) ;
  //  - deux pauses « physique de palet » aux manches 4 et 7, et un boss physique en dernier
  //    (plus long, il vaut 2 points) ;
  //  - on évite les micro-jeux déjà joués dans une rafale précédente du même match.
  plan(rng, memory = new Set()) {
    const simple = MICROS.filter((m) => !m.physics);
    const physics = MICROS.filter((m) => m.physics);
    const used = new Set();
    const seq = [];
    const pick = (pool, filters) => {
      for (let relax = 0; relax <= filters.length; relax++) {
        const ok = pool.filter((m) => !used.has(m.id) && filters.slice(0, filters.length - relax).every((f) => f(m)));
        if (ok.length) return rng.pick(ok);
      }
      return rng.pick(pool);
    };
    for (let i = 0; i < COUNT; i++) {
      const slot = SLOTS[i];
      const prev = MICRO_BY_ID.get(seq[seq.length - 1]);
      let m;
      if (slot.physics) {
        m = pick(physics, [(x) => (slot.boss ? x.level >= 3 : x.level < 3), (x) => !memory.has(x.id)]);
      } else {
        // Par ordre d'importance : on renonce d'abord à la nouveauté, puis à l'alternance, puis au niveau.
        m = pick(simple, [
          (x) => x.level >= slot.lo && x.level <= slot.hi,
          (x) => !prev || x.skill !== prev.skill,
          (x) => !memory.has(x.id),
        ]);
      }
      used.add(m.id);
      seq.push(m.id);
    }
    for (const id of seq) memory.add(id);
    return seq;
  }

  makeWorld(map = MICRO_TABLE) {
    const w = this.ctx.createWorld({
      map,
      rules: { damage: false, weapons: 'none', items: false, respawn: false, knockbackScale: 1 },
      hooks: {},
    });
    w.rules.frozen = true;
    return w;
  }

  isBoss() {
    return !!SLOTS[this.index]?.boss;
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
    if (this.def.physics) this.world = this.makeWorld(this.def.physics === 'golf' ? MICRO_GOLF : MICRO_TABLE);
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
      if (this.isBoss()) this.inst.duration *= 1.4; // le boss laisse le temps de s'y reprendre
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
          if (won) this.wins.set(p.id, (this.wins.get(p.id) ?? 0) + (this.isBoss() ? 2 : 1));
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
      skill: d?.skill ?? null,
      level: d?.level ?? 1,
      boss: this.isBoss(),
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
    return this.def?.physics ? { kind: this.def.physics, center: this.world.map.center } : null;
  }

  dispose() {}
}
