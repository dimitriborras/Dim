import { IMPOSTOR_SHIP } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';

const TASK_TIME = 2.5; // secondes immobile sur un poste
const TASKS_EACH = 3;
const STATION_R = 55;
const KILL_RANGE = 75;
const REPORT_RANGE = 110;
const KILL_FIRST = 12; // premier coup possible après…
const KILL_EVERY = 18; // …puis toutes les…
const MEETING = 12; // durée de la réunion (vote)
const END_SHOW = 3.5; // révélation finale
const SEE = 300; // un témoin voit un meurtre à cette distance

// L'imposteur (inspiré d'Among Us) : un imposteur caché (deux à partir de 7 joueurs) parmi
// l'équipage. L'équipage fait ses tâches (rester immobile sur des postes) ; l'imposteur élimine
// discrètement au bouton rond. Un corps trouvé (bouton rond à côté) déclenche une réunion :
// on vote pour éjecter quelqu'un. La vue est limitée à une lampe : on ne voit pas tout.
// L'équipage gagne en finissant les tâches ou en éjectant l'imposteur ; l'imposteur gagne s'il
// est aussi nombreux que l'équipage, ou si le temps s'écoule avant la fin des tâches.
export class ImpostorMinigame {
  static id = 'impostor';
  static name = 'L\'imposteur';
  static description = 'Un imposteur se cache parmi vous. Équipage : fais tes tâches et démasque-le. Imposteur : élimine en douce (bouton rond) sans te faire voir.';
  static durationSeconds = 150;

  initialize(ctx) {
    this.ctx = ctx;
    this.world = ctx.createWorld({
      map: IMPOSTOR_SHIP,
      rules: { items: true, respawn: false, knockbackScale: 0.6 },
      hooks: { onItem: (p) => { this.action(p); return true; } },
    });
    const ids = ctx.rng.shuffle(this.world.players.map((p) => p.id));
    const nImp = ids.length >= 7 ? 2 : 1;
    this.impostors = new Set(ids.slice(0, nImp));
    const stations = IMPOSTOR_SHIP.stations.map((_, i) => i);
    this.tasks = new Map(this.world.players.map((p) => [p.id, ctx.rng.shuffle(stations).slice(0, TASKS_EACH).map((s) => ({ s, prog: 0, done: false }))]));
    this.killReadyAt = new Map();
    this.kills = new Map();
    this.bodies = [];
    this.revealed = new Set(); // morts connus de tous (corps signalé ou éjection)
    this.suspects = new Map(); // bot -> id suspect (témoin d'un meurtre)
    this.phase = 'play';
    this.votes = new Map();
    this.ejected = null;
    this.winner = null;
    this.endAt = Infinity;
  }

  start() {
    const t = this.world.time;
    for (const id of this.impostors) this.killReadyAt.set(id, t + KILL_FIRST);
  }

  role(id) {
    return this.impostors.has(id) ? 'impostor' : 'crew';
  }

  alive() {
    return this.world.players.filter((p) => p.state === 'alive');
  }

  near(p, list, range) {
    let best = null;
    let bd = range;
    for (const o of list) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // Bouton rond : éliminer (imposteur, à portée et prêt), sinon signaler un corps proche.
  action(p) {
    if (this.phase !== 'play' || p.state !== 'alive') return;
    const t = this.world.time;
    if (this.impostors.has(p.id) && t >= (this.killReadyAt.get(p.id) ?? Infinity)) {
      const victim = this.near(p, this.alive().filter((o) => !this.impostors.has(o.id)), KILL_RANGE);
      if (victim) { this.kill(p, victim); return; }
    }
    const body = this.near(p, this.bodies, REPORT_RANGE);
    if (body) this.meeting(p, body);
  }

  kill(killer, victim) {
    const w = this.world;
    victim.state = 'dead';
    victim.respawnAt = Infinity;
    victim.vx = victim.vy = 0;
    this.bodies.push({ id: victim.id, x: Math.round(victim.x), y: Math.round(victim.y) });
    this.killReadyAt.set(killer.id, w.time + KILL_EVERY);
    this.kills.set(killer.id, (this.kills.get(killer.id) ?? 0) + 1);
    // Les témoins (pour les bots) : ceux qui étaient assez près et voyaient la scène.
    for (const o of this.alive()) {
      if (o === killer || this.impostors.has(o.id)) continue;
      if (Math.hypot(o.x - killer.x, o.y - killer.y) < SEE && w.lineOfSight(o, killer)) this.suspects.set(o.id, killer.id);
    }
    // Rien n'est annoncé : le corps reste là, il faut le trouver.
    w.emit('killSound', { x: Math.round(victim.x), y: Math.round(victim.y) });
    this.checkWin();
  }

  meeting(reporter, body) {
    const w = this.world;
    this.phase = 'meeting';
    this.meetingEnd = w.time + MEETING;
    this.reporter = reporter.id;
    this.found = body.id;
    this.votes.clear();
    this.ejected = null;
    // En réunion, tous les morts sont connus (comme dans Among Us).
    for (const p of w.players) if (p.state === 'dead') this.revealed.add(p.id);
    w.rules.frozen = true;
    for (const p of w.players) { p.vx = p.vy = 0; }
    w.emit('meeting', { by: reporter.id, body: body.id });
  }

  closeMeeting() {
    const w = this.world;
    const tally = new Map();
    for (const v of this.votes.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
    const skip = tally.get('skip') ?? 0;
    let top = null;
    let topN = 0;
    let tie = false;
    for (const [id, n] of tally) {
      if (id === 'skip') continue;
      if (n > topN) { top = id; topN = n; tie = false; } else if (n === topN) tie = true;
    }
    const out = top && !tie && topN > skip ? w.players.find((p) => p.id === top) : null;
    if (out) {
      out.state = 'dead';
      out.respawnAt = Infinity;
      this.revealed.add(out.id);
    }
    this.ejected = out ? { id: out.id, impostor: this.impostors.has(out.id) } : { id: null };
    w.emit('ejected', this.ejected);
    this.bodies = [];
    // Retour en salle commune, comme après une réunion.
    const spawns = IMPOSTOR_SHIP.spawns;
    this.alive().forEach((p, i) => Object.assign(p, { ...spawns[i % spawns.length], vx: 0, vy: 0, safe: { ...spawns[i % spawns.length] } }));
    for (const id of this.impostors) this.killReadyAt.set(id, Math.max(this.killReadyAt.get(id) ?? 0, w.time + 8));
    this.phase = 'play';
    w.rules.frozen = false;
    this.checkWin();
  }

  taskProgress() {
    let done = 0;
    let total = 0;
    for (const [id, list] of this.tasks) {
      if (this.impostors.has(id)) continue;
      total += list.length;
      done += list.filter((x) => x.done).length;
    }
    return total ? done / total : 1;
  }

  checkWin() {
    if (this.winner) return;
    const alive = this.alive();
    const imps = alive.filter((p) => this.impostors.has(p.id)).length;
    const crew = alive.length - imps;
    if (imps === 0) this.end('crew');
    else if (imps >= crew) this.end('impostor');
    else if (this.taskProgress() >= 1) this.end('crew');
  }

  end(winner) {
    this.winner = winner;
    this.phase = 'end';
    this.endAt = this.world.time + END_SHOW;
    this.world.rules.frozen = true;
    this.world.emit('impostorEnd', { winner, impostors: [...this.impostors] });
  }

  // Votes : 'mg' choix v = index dans la liste des vivants (hud.alive), -1 = passer.
  input(p, msg) {
    if (this.phase !== 'meeting' || msg.k !== 'choice' || p.state !== 'alive' || this.votes.has(p.id)) return;
    const list = this.alive().map((o) => o.id);
    const v = Math.round(msg.v);
    if (v === -1) this.votes.set(p.id, 'skip');
    else if (list[v] && list[v] !== p.id) this.votes.set(p.id, list[v]);
    else return;
    this.world.emit('voted', { id: p.id });
  }

  botVote(p) {
    const others = this.alive().filter((o) => o !== p);
    let target = null;
    if (this.impostors.has(p.id)) {
      const crew = others.filter((o) => !this.impostors.has(o.id));
      target = this.ctx.rng.next() < 0.6 ? this.ctx.rng.pick(crew)?.id : null;
    } else {
      const sus = this.suspects.get(p.id);
      if (sus && others.some((o) => o.id === sus)) target = sus;
      else target = this.ctx.rng.next() < 0.35 ? this.ctx.rng.pick(others)?.id : null;
    }
    this.votes.set(p.id, target ?? 'skip');
    this.world.emit('voted', { id: p.id });
  }

  update(dt) {
    const w = this.world;
    const t = w.time;
    if (this.phase === 'end') return;
    if (this.phase === 'meeting') {
      w.rules.frozen = true;
      // Les bots votent au bout de quelques secondes.
      for (const p of this.alive()) {
        if (p.bot && !this.votes.has(p.id) && t > this.meetingEnd - MEETING + 3 + (p.joinOrder % 5)) this.botVote(p);
      }
      const everyone = this.alive().every((p) => this.votes.has(p.id));
      if (t >= this.meetingEnd || everyone) this.closeMeeting();
      return;
    }
    // Tâches : rester immobile sur un de ses postes.
    for (const p of this.alive()) {
      if (this.impostors.has(p.id)) continue;
      const list = this.tasks.get(p.id) ?? [];
      for (const task of list) {
        if (task.done) continue;
        const st = IMPOSTOR_SHIP.stations[task.s];
        const on = Math.hypot(p.x - st.x, p.y - st.y) < STATION_R && Math.hypot(p.vx, p.vy) < 60;
        if (!on) continue;
        task.prog += dt;
        if (task.prog >= TASK_TIME) {
          task.done = true;
          w.emit('taskDone', { id: p.id });
          this.checkWin();
        }
      }
    }
  }

  isOver() {
    return this.world.time >= this.endAt;
  }

  // Fin du chrono sans vainqueur : l'imposteur a tenu.
  timeLeftCap() {
    return null;
  }

  finish() {
    if (!this.winner) this.winner = this.taskProgress() >= 1 ? 'crew' : 'impostor';
    const sorted = this.ctx.players
      .map((p) => {
        const imp = this.impostors.has(p.id);
        const won = (this.winner === 'impostor') === imp;
        const tasks = (this.tasks.get(p.id) ?? []).filter((x) => x.done).length;
        const score = p.connected === false ? -1 : (won ? 100 : 0) + (imp ? (this.kills.get(p.id) ?? 0) * 3 : tasks);
        return { id: p.id, score };
      })
      .sort((a, b) => b.score - a.score);
    return {
      ranking: groupRanking(sorted),
      summary: this.winner === 'crew' ? 'L\'équipage l\'emporte !' : 'L\'imposteur l\'emporte !',
    };
  }

  hud() {
    const t = this.world.time;
    return {
      kind: 'impostor',
      phase: this.phase,
      meetingLeft: this.phase === 'meeting' ? Math.max(0, Math.round((this.meetingEnd - t) * 10) / 10) : null,
      reporter: this.phase === 'meeting' ? this.reporter : null,
      found: this.phase === 'meeting' ? this.found : null,
      // « Vivants » connus : un mort n'est révélé qu'en réunion (ou à la fin).
      alive: this.world.players.filter((p) => p.state === 'alive' || (!this.revealed.has(p.id) && !this.winner)).map((p) => p.id),
      voted: [...this.votes.keys()],
      bodies: this.bodies.map((b) => [b.x, b.y, b.id]),
      tasks: Math.round(this.taskProgress() * 100),
      ejected: this.ejected,
      winner: this.winner,
      impostors: this.winner ? [...this.impostors] : null,
      nImp: this.impostors.size,
    };
  }

  // Ce que seul ce joueur sait : son rôle, ses tâches, s'il peut agir.
  privateState(id) {
    const p = this.world.players.find((o) => o.id === id);
    if (!p) return null;
    const imp = this.impostors.has(id);
    const t = this.world.time;
    const canKill = imp && p.state === 'alive' && t >= (this.killReadyAt.get(id) ?? Infinity)
      && !!this.near(p, this.alive().filter((o) => !this.impostors.has(o.id)), KILL_RANGE);
    return {
      role: imp ? 'impostor' : 'crew',
      mates: imp ? [...this.impostors].filter((x) => x !== id) : [],
      tasks: (this.tasks.get(id) ?? []).map((x) => [x.s, Math.round(Math.min(1, x.prog / TASK_TIME) * 100) / 100, x.done]),
      killIn: imp ? Math.max(0, Math.round(((this.killReadyAt.get(id) ?? t) - t) * 10) / 10) : null,
      canKill,
      canReport: p.state === 'alive' && !!this.near(p, this.bodies, REPORT_RANGE),
      vote: this.votes.get(id) ?? null,
    };
  }

  botMode() {
    return this.phase === 'play' ? 'impostor' : 'none';
  }

  botHint() {
    return { kind: 'impostor', game: this };
  }

  dispose() {}
}

export const IMPOSTOR_RANGES = { KILL_RANGE, REPORT_RANGE, STATION_R };
