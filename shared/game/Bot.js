import { ITEMS } from '../items.js';
import { PLAYER } from '../constants.js';
import { dist } from '../geometry.js';
import { powerForDistance, simulateFlick } from './movement.js';

const BOT_NAMES = ['Robo-Rex', 'Capitaine Clic', 'Mlle Vis', 'Bidule', 'Pastille', 'Gros Boulon', 'Zigzag', 'Tuba'];
export const botName = (i) => BOT_NAMES[i % BOT_NAMES.length];

// IA qui joue avec les mêmes gestes qu'un humain : une pichenette (angle + puissance)
// ou une petite tape quand sa figurine est posée. Le tir est automatique pour tout le monde.
export class BotBrain {
  constructor(rng) {
    this.rng = rng;
    this.wp = 0;
    this.nextAt = 0;
    this.skill = rng.range(0.55, 0.9);
    this.side = rng.next() < 0.5 ? 1 : -1;
  }

  think(p, world, mode, extra = {}) {
    if (mode === 'none') return; // le mini-jeu pilote lui-même ses bots (ex. la Mine)
    p.input = { mx: 0, my: 0, aim: p.aim, fire: false };
    if (p.state !== 'alive') return;
    const t = world.time;
    if (!['safe', 'race', 'coins', 'blackjack', 'impostor'].includes(mode)) this.useItems(p, world);
    const speed = Math.hypot(p.vx, p.vy);
    if (t < this.nextAt || speed > 70 || (p.energy ?? 0) < PLAYER.flickCost) return;
    // Temps de réaction humain, plus long pour les bots moins doués.
    this.nextAt = t + this.rng.range(0.12, 0.5) / this.skill;

    let goal = null;
    if (mode === 'race') goal = this.raceGoal(p, world);
    else if (mode === 'coins') goal = this.coinGoal(p, world);
    else if (mode === 'micro') goal = this.microGoal(p, world, extra.micro);
    else if (mode === 'palet') goal = this.paletGoal(p, world, extra.micro);
    else if (mode === 'bomb') goal = this.bombGoal(p, world, extra.micro);
    else if (mode === 'tiles') goal = this.tilesGoal(p, world, extra.micro);
    else if (mode === 'blackjack') goal = this.blackjackGoal(p, world, extra.micro);
    else if (mode === 'memory') goal = this.memoryGoal(p, world, extra.micro);
    else if (mode === 'king') goal = this.kingGoal(p, world, extra.micro);
    else if (mode === 'movers') goal = this.moversGoal(p, world, extra.micro);
    else if (mode === 'impostor') goal = this.impostorGoal(p, world, extra.micro);
    else if (mode === 'safe') goal = this.rng.next() < 0.12 ? this.wanderGoal(p, world) : null;
    else if (mode === 'lobby') goal = this.rng.next() < 0.5 ? this.poolShot(p, world) ?? this.wanderGoal(p, world) : null;
    else goal = this.fightGoal(p, world, extra);
    if (!goal) return;
    this.launch(p, world, goal);
  }

  // Lance la figurine vers `goal` en vérifiant que la trajectoire ne finit pas dans le vide.
  launch(p, world, goal) {
    const d = dist(p, goal);
    const base = Math.atan2(goal.y - p.y, goal.x - p.x);
    // Coup déjà calculé (Le Palet) : on le joue tel quel.
    if (goal.flick) { p.pendingFlick = goal.flick; return; }
    // Tomber est le but (le trou du mini-golf) : pas de vérification de sécurité.
    if (goal.free) {
      p.pendingFlick = { a: base, p: Math.max(0.05, goal.power ?? Math.min(1, powerForDistance(d))) };
      return;
    }
    if (d < 110 && !goal.push) {
      if (this.safe(p, world, base, 0, { hop: true })) p.pendingFlick = { a: base, p: 0, hop: true };
      return;
    }
    const want = goal.power ?? Math.min(1, powerForDistance(goal.push ? d + 160 : d) + this.rng.range(-0.06, 0.06));
    // Un coup de billard ne se dévie pas : on le joue tel quel ou pas du tout.
    const tries = goal.exact ? [0] : [0, 0.18, -0.18, 0.4, -0.4, 0.75, -0.75];
    for (const scale of goal.exact ? [1] : [1, 0.75, 0.5]) {
      const power = Math.max(0, want * scale);
      for (const off of tries) {
        const a = base + off * this.side;
        // Une poussée s'arrête sur la cible : on ne vérifie le chemin que jusqu'à elle.
        const until = goal.push && off === 0 ? goal : null;
        if (this.safe(p, world, a, 0, { power, until })) {
          p.pendingFlick = { a, p: power };
          return;
        }
      }
    }
  }

  // Simule la pichenette avec la vraie physique (rebonds compris) : finit-elle sur la table ?
  safe(p, world, a, reachOrPower, opts = {}) {
    const springAt = (x, y) => world.map.springs.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    const sim = simulateFlick(p, a, opts.power ?? 0, world.map, {
      hop: opts.hop,
      factor: p.speedFactor ?? 1,
      isGround: (x, y) => world.isGround(x, y),
      stopAt: (x, y) => springAt(x, y) || (opts.until && Math.hypot(x - opts.until.x, y - opts.until.y) < PLAYER.radius * 2),
    });
    if (sim.outcome === 'fall') return false;
    if (sim.outcome === 'stop' && world.map.hazardEdges && world.inHazard(sim.end.x, sim.end.y)) return false;
    void reachOrPower;
    return true;
  }

  // Micro-jeux physiques : viser le centre de la cible, ou pousser le plus proche.
  microGoal(p, world, hint) {
    if (!hint) return null;
    // Duels physiques : chacun son îlot (le centre le plus proche).
    if (hint.kind === 'sumo' || hint.kind === 'curl') {
      const c = hint.centers.reduce((a, b) => (dist(p, a) < dist(p, b) ? a : b));
      if (hint.kind === 'curl') return this.paletGoal(p, world, { center: c, rings: hint.rings });
      const rival = world.players.find((o) => o !== p && o.state === 'alive' && dist(o, c) < 200);
      if (rival && this.rng.next() < 0.7) return { x: rival.x, y: rival.y, push: true };
      return dist(p, c) > 50 ? { x: c.x, y: c.y } : null;
    }
    const c = hint.center;
    const dc = dist(p, c);
    if (hint.kind === 'circle') return dc > 45 ? { x: c.x, y: c.y } : null;
    // Mini-golf : droit sur le trou (s'il est visible), avec un dosage un peu généreux.
    if (hint.kind === 'golf') {
      if (!world.lineOfSight(p, c)) return this.rng.next() < 0.5 ? { x: c.x, y: p.y < c.y ? 190 : 510, free: true } : null;
      return { x: c.x, y: c.y, exact: true, free: true, power: Math.min(1, powerForDistance(dc + 30) + this.rng.range(-0.05, 0.08) * (1.4 - this.skill)) };
    }
    const target = this.nearestEnemy(p, world, 300);
    if (target && this.rng.next() < 0.6) return { x: target.x, y: target.y, push: true };
    return dc > 120 ? { x: c.x, y: c.y } : null;
  }

  // Le Palet : simule plusieurs dosages et garde celui qui finit le plus près du cœur.
  // Si un adversaire occupe déjà le cœur, on tente parfois de le dégommer.
  paletGoal(p, world, hint) {
    if (!hint) return null;
    const c = hint.center;
    const rival = world.players.find((o) => o !== p && o.state === 'alive' && Math.hypot(o.x - c.x, o.y - c.y) < hint.rings[1]);
    const aim = rival && this.rng.next() < 0.5 ? rival : c;
    const base = Math.atan2(aim.y - p.y, aim.x - p.x);
    let best = null;
    for (let pw = 0.25; pw <= 1.001; pw += 0.05) {
      const sim = simulateFlick(p, base, pw, world.map, { factor: (p.speedFactor ?? 1) * (p.powerMul ?? 1), isGround: (x, y) => world.isGround(x, y) });
      if (sim.outcome === 'fall') continue;
      const d = Math.hypot(sim.end.x - c.x, sim.end.y - c.y);
      if (!best || d < best.d) best = { d, pw };
    }
    if (!best) return null;
    const err = (1 - this.skill) * 0.1;
    return { x: aim.x, y: aim.y, flick: { a: base + this.rng.range(-err, err) * 0.4, p: Math.max(0.05, Math.min(1, best.pw + this.rng.range(-err, err))) } };
  }

  // Patate chaude : le porteur fonce sur le plus proche, les autres fuient le porteur.
  bombGoal(p, world, hint) {
    const holder = hint?.holder ? world.players.find((o) => o.id === hint.holder && o.state === 'alive') : null;
    if (!holder) return this.rng.next() < 0.1 ? this.wanderGoal(p, world) : null;
    if (holder === p) {
      const t = this.nearestEnemy(p, world, 900);
      return t ? { x: t.x + t.vx * 0.2, y: t.y + t.vy * 0.2, push: true } : null;
    }
    const d = dist(p, holder);
    if (d > 380 && this.rng.next() < 0.7) return null;
    // Fuite : à l'opposé du porteur, un peu de côté, en restant sur la table.
    const f = world.map.felt;
    const a = Math.atan2(p.y - holder.y, p.x - holder.x) + this.side * this.rng.range(0.2, 0.8);
    return {
      x: Math.max(f.x + 40, Math.min(f.x + f.w - 40, p.x + Math.cos(a) * 260)),
      y: Math.max(f.y + 40, Math.min(f.y + f.h - 40, p.y + Math.sin(a) * 260)),
    };
  }

  // Carrelage : rejoindre une dalle intacte proche par petits bonds (glisser loin casse tout).
  tilesGoal(p, world, hint) {
    if (!hint) return null;
    const here = hint.tiles.find((r) => !r.gone && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (here && here.crackAt === null) return null; // dalle saine : on attend
    let best = null;
    for (const r of hint.tiles) {
      if (r.gone || r.crackAt !== null) continue;
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const d = dist(p, c);
      const crowd = world.players.filter((o) => o !== p && o.state === 'alive' && dist(o, c) < 90).length;
      const score = d + crowd * 200;
      if (d > 40 && (!best || score < best.score)) best = { ...c, score };
    }
    if (!best) return null;
    // Petit bond si c'est à côté, sinon la pichenette la plus douce qui y arrive.
    return dist(p, best) < 120 ? best : { x: best.x, y: best.y, power: Math.min(1, powerForDistance(dist(p, best)) * 0.95) };
  }

  // Vingt-et-un : une carte connue qui rapproche de 21 sans dépasser, sinon une carte cachée
  // si le risque est raisonnable (moyenne d'une carte ≈ 7), sinon « je reste ».
  blackjackGoal(p, world, hint) {
    const st = hint?.state.get(p.id);
    if (!st || st.busted || st.stood || st.counting) return null;
    const stopAt = 14 + Math.round(this.skill * 3);
    const room = 21 - st.total;
    if (st.total >= stopAt) { p.actions.push('item'); return null; }
    const known = hint.cards.map((c, i) => ({ c, v: hint.values[i] }));
    let pool = known.filter((x) => x.v !== null && x.v <= room).sort((a, b) => b.v - a.v);
    const hidden = known.filter((x) => x.v === null);
    if (!pool.length || (pool[0].v < Math.min(room, 7) && hidden.length && room >= 9)) pool = hidden.sort((a, b) => dist(p, a.c) - dist(p, b.c));
    if (!pool.length) { p.actions.push('item'); return null; }
    for (const { c } of pool.slice(0, 4)) {
      const shot = this.aimAtRect(p, world, c);
      if (shot) return shot;
    }
    p.actions.push('item');
    return null;
  }

  // Roi de la colline : y aller, et en déloger les autres (de préférence vers une poche).
  kingGoal(p, world, hint) {
    const z = hint?.zone;
    if (!z) return null;
    const inZone = (o) => Math.hypot(o.x - z.x, o.y - z.y) <= z.r;
    const rivals = world.players.filter((o) => o !== p && o.state === 'alive' && inZone(o));
    if (rivals.length && this.rng.next() < 0.75) {
      const t = rivals.reduce((a, b) => (dist(p, a) < dist(p, b) ? a : b));
      return { x: t.x, y: t.y, push: true };
    }
    if (inZone(p) && Math.hypot(p.x - z.x, p.y - z.y) < z.r * 0.6) return null; // bien placé : on tient
    return { x: z.x + this.rng.range(-25, 25), y: z.y + this.rng.range(-25, 25) };
  }

  // Déménagement : se placer derrière un objet et le pousser vers la porte suivante, puis le camion.
  moversGoal(p, world, hint) {
    if (!hint) return null;
    const T = hint.truck;
    const room = (x) => (x < 615 ? 0 : x < 1115 ? 1 : 2);
    const doors = [{ x: 615, y: 530 }, { x: 1115, y: 435 }];
    const goalFor = (o) => (room(o.x) < 2 ? doors[room(o.x)] : { x: T.x + T.w / 2, y: T.y + T.h / 2 });
    let best = null;
    for (const b of world.balls) {
      if (!b.active || b === hint.cat || !b.value) continue;
      const score = b.value / (200 + dist(p, b)) / (b.mass > 2 ? 1.6 : 1);
      if (!best || score > best.score) best = { b, score };
    }
    if (!best) return this.wanderGoal(p, world);
    const o = best.b;
    // Mauvaise pièce : rejoindre d'abord l'objet en passant par la porte.
    if (room(p.x) !== room(o.x) && !world.lineOfSight(p, o)) return this.route(p, world, o);
    const g = goalFor(o);
    const tx = g.x - o.x;
    const ty = g.y - o.y;
    const tl = Math.hypot(tx, ty) || 1;
    const ghost = { x: o.x - (tx / tl) * (PLAYER.radius + o.r), y: o.y - (ty / tl) * (PLAYER.radius + o.r) };
    const behind = { x: o.x - (tx / tl) * (PLAYER.radius + o.r + 60), y: o.y - (ty / tl) * (PLAYER.radius + o.r + 60) };
    // Pas encore derrière l'objet : on s'y place d'abord (sans le toucher).
    const lined = ((p.x - o.x) * tx + (p.y - o.y) * ty) / tl < -(o.r + 10);
    if (!lined) return { x: behind.x, y: behind.y };
    // Dosage : assez pour l'emmener vers son but, sans le fracasser contre un mur.
    const power = Math.min(o.mass > 2 ? 0.9 : 0.5, powerForDistance(dist(p, ghost) + Math.min(tl, 320) * 0.6 * (o.mass > 2 ? 1.8 : 1)));
    return { x: ghost.x, y: ghost.y, push: true, exact: true, power };
  }

  // L'imposteur. Équipage : tâches, et signaler les corps vus. Imposteur : faire semblant,
  // puis frapper quand une victime est isolée (personne d'autre à proximité).
  impostorGoal(p, world, hint) {
    const g = hint?.game;
    if (!g) return null;
    const me = g.privateState(p.id);
    const stations = world.map.stations;
    const sees = (o) => Math.hypot(o.x - p.x, o.y - p.y) < 300 && world.lineOfSight(p, o);
    if (me.canReport && g.bodies.some(sees)) { p.actions.push('item'); return null; }
    if (me.role === 'impostor') {
      if (me.canKill) {
        const v = g.alive().filter((o) => !g.impostors.has(o.id)).find((o) => Math.hypot(o.x - p.x, o.y - p.y) < 75);
        const others = g.alive().filter((o) => o !== p && o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 380);
        if (others.length === 0 || this.rng.next() < 0.05) { p.actions.push('item'); return null; }
      }
      if (me.killIn <= 0) {
        // Prêt : suivre la victime la plus isolée.
        const prey = g.alive().filter((o) => !g.impostors.has(o.id))
          .map((o) => ({ o, crowd: g.alive().filter((q) => q !== o && q !== p && Math.hypot(q.x - o.x, q.y - o.y) < 380).length }))
          .sort((a, b) => a.crowd - b.crowd || dist(p, a.o) - dist(p, b.o))[0];
        if (prey && prey.crowd === 0) {
          const d = dist(p, prey.o);
          if (d < 60) return null;
          if (!world.lineOfSight(p, prey.o)) return this.route(p, world, prey.o);
          const a = Math.atan2(prey.o.y - p.y, prey.o.x - p.x);
          return { x: prey.o.x - Math.cos(a) * 45, y: prey.o.y - Math.sin(a) * 45 };
        }
      }
    }
    // Tâche suivante : y aller, puis rester immobile. L'imposteur fait semblant, poste après poste.
    let s;
    if (me.role === 'impostor') {
      if (!this.fake || world.time > this.fake.until) this.fake = { s: Math.floor(this.rng.next() * stations.length), until: world.time + this.rng.range(6, 12) };
      s = this.fake.s;
    } else {
      const next = me.tasks.find(([, , done]) => !done);
      if (!next) return this.rng.next() < 0.05 ? this.wanderGoal(p, world) : null;
      s = next[0];
    }
    const st = stations[s];
    if (Math.hypot(p.x - st.x, p.y - st.y) < 40) return null;
    const step = this.route(p, world, st);
    return { x: step.x + this.rng.range(-10, 10), y: step.y + this.rng.range(-10, 10) };
  }

  // Cible derrière une cloison : passer par la porte (point de passage) la plus utile.
  route(p, world, target) {
    const wps = world.map.waypoints;
    if (!wps?.length || world.lineOfSight(p, target)) return target;
    let best = null;
    let bs = Infinity;
    for (const w of wps) {
      if (dist(p, w) < 30 || !world.lineOfSight(p, w)) continue;
      const s = dist(p, w) + dist(w, target) + (world.lineOfSight(w, target) ? 0 : 400);
      if (s < bs) { bs = s; best = w; }
    }
    return best ?? target;
  }

  // Pichenette qui s'arrête dans ce rectangle (carte, case…), avec une imprécision humaine.
  aimAtRect(p, world, c) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const a = Math.atan2(cy - p.y, cx - p.x);
    for (let pw = 0.1; pw <= 1.001; pw += 0.05) {
      const sim = simulateFlick(p, a, pw, world.map, { factor: (p.speedFactor ?? 1) * (p.powerMul ?? 1), isGround: (x, y) => world.isGround(x, y) });
      const e = sim.end;
      if (e.x > c.x + 12 && e.x < c.x + c.w - 12 && e.y > c.y + 12 && e.y < c.y + c.h - 12) {
        const ea = (1.2 - this.skill) * 0.12;
        const ep = (1.2 - this.skill) * 0.12;
        return { x: cx, y: cy, flick: { a: a + this.rng.range(-ea, ea), p: Math.max(0.05, Math.min(1, pw + this.rng.range(-ep, ep))) } };
      }
    }
    return null;
  }

  // Mémory : retenir (plus ou moins bien) les cartes vues, finir sa paire, sinon explorer.
  memoryGoal(p, world, hint) {
    const g = hint?.game;
    if (!g) return null;
    this.memo ??= new Map();
    g.visible().forEach((f, i) => { if (f && g.owner[i] === null && this.rng.next() < 0.25 + this.skill * 0.5) this.memo.set(i, f); });
    for (const [i] of this.memo) if (g.owner[i] !== null) this.memo.delete(i);
    const cards = world.map.cards;
    const free = cards.map((c, i) => i).filter((i) => g.owner[i] === null);
    if (!free.length) return null;
    const first = g.first.get(p.id);
    let target = null;
    if (first !== undefined) {
      const face = g.faces[first];
      target = free.find((i) => i !== first && this.memo.get(i) === face) ?? null;
    } else {
      // Une paire connue ? On commence par l'une des deux.
      const seen = new Map();
      for (const [i, f] of this.memo) {
        if (seen.has(f)) { target = seen.get(f); break; }
        seen.set(f, i);
      }
    }
    if (target === null) {
      const unknown = free.filter((i) => i !== first && !this.memo.has(i));
      const pool = unknown.length ? unknown : free.filter((i) => i !== first);
      pool.sort((a, b) => dist(p, cards[a]) - dist(p, cards[b]));
      target = pool[Math.floor(this.rng.next() * Math.min(3, pool.length))];
    }
    return target === undefined ? null : this.aimAtRect(p, world, cards[target]);
  }

  raceGoal(p, world) {
    const wps = world.map.waypoints;
    if (!wps) return null;
    if (this.wp > 0 && p.x < wps[this.wp - 1].x - 80) this.wp = Math.max(0, wps.findIndex((w) => w.x > p.x - 20));
    while (this.wp < wps.length - 1 && (dist(p, wps[this.wp]) < 70 || p.x > wps[this.wp].x + 40)) this.wp += 1;
    return wps[this.wp];
  }

  coinGoal(p, world) {
    let best = null;
    let bestScore = Infinity;
    for (const pk of world.pickups) {
      const s = dist(p, pk) / (pk.value ?? 1);
      if (s < bestScore) { bestScore = s; best = pk; }
    }
    return best ? { x: best.x, y: best.y } : this.wanderGoal(p, world);
  }

  wanderGoal(p, world) {
    const sp = world.map.spawns[Math.floor(this.rng.next() * world.map.spawns.length)];
    return { x: sp.x + this.rng.range(-60, 60), y: sp.y + this.rng.range(-60, 60) };
  }

  // Visée de billard : viser la « bille fantôme » derrière la cible pour l'envoyer dans une poche.
  poolShot(p, world) {
    const pockets = world.map.pockets;
    if (!pockets?.length) return null;
    const R2 = 2 * PLAYER.radius;
    let best = null;
    for (const o of world.players) {
      if (o === p || o.state !== 'alive' || world.time < o.invulnUntil) continue;
      for (const pk of pockets) {
        const tx = pk.x - o.x;
        const ty = pk.y - o.y;
        const tl = Math.hypot(tx, ty);
        if (tl > 520) continue;
        const ghost = { x: o.x - (tx / tl) * R2, y: o.y - (ty / tl) * R2 };
        // Angle de coupe : au-delà de ~60°, la cible part trop de travers.
        const sx = ghost.x - p.x;
        const sy = ghost.y - p.y;
        const sl = Math.hypot(sx, sy);
        const cut = Math.acos(Math.max(-1, Math.min(1, (sx * tx + sy * ty) / (sl * tl))));
        if (sl < 30 || cut > 1.05 || !world.lineOfSight(p, ghost)) continue;
        const score = tl + sl * 0.5 + cut * 300;
        // Puissance : assez pour couvrir la distance jusqu'à la bille fantôme puis envoyer la cible jusqu'à la poche.
        const power = Math.min(1, powerForDistance(sl + tl * 1.4 / Math.max(0.5, Math.cos(cut)) + 60));
        if (!best || score < best.score) best = { x: ghost.x, y: ghost.y, push: true, exact: true, power, score, dist: tl };
      }
    }
    return best;
  }

  nearestEnemy(p, world, range = Infinity) {
    let best = null;
    let bestD = range;
    for (const o of world.players) {
      if (o === p || o.state !== 'alive') continue;
      const d = dist(p, o);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  fightGoal(p, world, extra) {
    const crown = extra.crown;
    if (crown) {
      if (crown.holder === p.id) {
        const threat = this.nearestEnemy(p, world, 420);
        if (!threat) return null;
        const c = world.map.center;
        const ax = p.x - threat.x + (c.x - p.x) * 0.4;
        const ay = p.y - threat.y + (c.y - p.y) * 0.4;
        const l = Math.hypot(ax, ay) || 1;
        return { x: p.x + (ax / l) * 260, y: p.y + (ay / l) * 260 };
      }
      if (crown.holder) {
        const h = world.players.find((o) => o.id === crown.holder);
        if (h) return { x: h.x, y: h.y, push: true };
      } else if (crown.pos) {
        return { x: crown.pos.x, y: crown.pos.y };
      }
    }
    let target = this.nearestEnemy(p, world, 700);
    if (extra.championId && extra.championId !== p.id && this.skill > 0.7) {
      target = world.players.find((o) => o.id === extra.championId && o.state === 'alive') ?? target;
    }
    if (!target) return this.wanderGoal(p, world);
    // Sur le billard, une belle occasion d'empocher passe avant tout.
    if (world.map.pockets?.length && this.rng.next() < 0.5 * this.skill) {
      const shot = this.poolShot(p, world);
      if (shot && shot.dist < 380) return shot;
    }
    const d = dist(p, target) || 1;
    // Cible près du bord ou du trou : on fonce dessus pour la pousser dans le vide.
    const beyond = { x: target.x + ((target.x - p.x) / d) * 120, y: target.y + ((target.y - p.y) / d) * 120 };
    const pushable = world.inHazard(target.x, target.y) || !world.isGround(beyond.x, beyond.y);
    if (d < 420 && (pushable || this.rng.next() < 0.25 * this.skill)) return { x: target.x, y: target.y, push: true };
    const ang = Math.atan2(p.y - target.y, p.x - target.x) + this.side * this.rng.range(0.3, 0.9);
    return { x: target.x + Math.cos(ang) * 320, y: target.y + Math.sin(ang) * 320 };
  }

  // Gadget du bouton rond, utilisé quand la situation s'y prête.
  useItems(p, world) {
    const g = p.inv.gadget;
    if (!g || g.charges <= 0 || world.time < g.cooldownUntil || !world.rules.items) return;
    const r = this.rng.next();
    const near = (R) => world.players.filter((o) => o !== p && o.state === 'alive' && dist(p, o) < R);
    const nearPocket = (o) => (world.map.pockets ?? []).some((pk) => Math.hypot(o.x - pk.x, o.y - pk.y) < pk.r + 110);
    const charging = world.players.some((o) => o !== p && world.time < o.flingUntil && dist(p, o) < 170
      && (p.x - o.x) * o.vx + (p.y - o.y) * o.vy > 0);
    let use = false;
    switch (g.id) {
      case 'firecracker': use = near(170).some(nearPocket) || (near(170).length >= 2 && r < 0.3); break;
      case 'anchor': use = charging && r < 0.6; break;
      case 'magnet': use = !nearPocket(p) && near(300).length > 0 && near(90).length === 0 && r < 0.02; break;
      case 'spring': use = nearPocket(p) && Math.hypot(p.vx, p.vy) > 250 && r < 0.3; break;
      case 'banana': use = r < 0.004 * this.skill; break;
      case 'confetti': use = near(320).length >= 1 && r < 0.015; break;
      case 'teleporter': use = nearPocket(p) && Math.hypot(p.vx, p.vy) > 300 && r < 0.3; break;
      default: break;
    }
    if (use) p.actions.push('item');
  }

  // Distributeur : la capsule la plus intéressante qu'il peut payer, parfois une relance.
  shop(p, rng) {
    const offers = (p.offers ?? []).filter((id) => ITEMS[id].price <= p.credits);
    if (!offers.length) {
      if (p.freeRerolls > 0 || (p.credits >= 75 && rng.next() < 0.3)) return 'reroll';
      return null;
    }
    // Un gadget d'abord s'il n'en a pas, sinon des atouts.
    const wanted = offers.filter((id) => (p.inv.gadget ? ITEMS[id].category === 'perk' : ITEMS[id].category === 'gadget'));
    const pool = wanted.length ? wanted : offers;
    return pool[Math.floor(rng.next() * pool.length)];
  }
}
