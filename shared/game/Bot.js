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
    p.input = { mx: 0, my: 0, aim: p.aim, fire: false };
    if (p.state !== 'alive') return;
    const t = world.time;
    if (mode !== 'safe' && mode !== 'race' && mode !== 'coins') this.useItems(p, world);
    const speed = Math.hypot(p.vx, p.vy);
    if (t < this.nextAt || speed > 70 || (p.energy ?? 0) < PLAYER.flickCost) return;
    // Temps de réaction humain, plus long pour les bots moins doués.
    this.nextAt = t + this.rng.range(0.12, 0.5) / this.skill;

    let goal = null;
    if (mode === 'race') goal = this.raceGoal(p, world);
    else if (mode === 'coins') goal = this.coinGoal(p, world);
    else if (mode === 'micro') goal = this.microGoal(p, world, extra.micro);
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
    // Déjà à bonne distance de tir : on reste posé pour tirer.
    if (d > 260 && d < 520 && world.lineOfSight(p, target)) return null;
    const ang = Math.atan2(p.y - target.y, p.x - target.x) + this.side * this.rng.range(0.3, 0.9);
    return { x: target.x + Math.cos(ang) * 320, y: target.y + Math.sin(ang) * 320 };
  }

  useItems(p, world) {
    const r = this.rng.next();
    const incoming = world.projectiles.some((pr) => {
      if (pr.owner === p.id) return false;
      if (Math.hypot(pr.x - p.x, pr.y - p.y) > 160) return false;
      return (p.x - pr.x) * pr.vx + (p.y - pr.y) * pr.vy > 0;
    });
    const gadget = p.inv.slots.find((s) => s && ITEMS[s.id].category === 'gadget');
    if (incoming && gadget?.id === 'bubble_shield' && r < 0.3) p.actions.push('item');
    else if (gadget?.id === 'pocket_spring' && p.hp < 40 && r < 0.01) p.actions.push('item');
    else if (!gadget && p.inv.consumables.some(Boolean) && r < 0.006 * this.skill) p.actions.push('item');
  }

  // Achat pendant une phase sûre : un objet abordable au hasard, en privilégiant l'équipement permanent.
  shop(p, shop, rng) {
    const offers = shop.offers.filter((id) => shop.check(p, id).ok);
    if (!offers.length) return null;
    const permanent = offers.filter((id) => ITEMS[id].category !== 'consumable');
    const pool = permanent.length && rng.next() < 0.7 ? permanent : offers;
    return pool[Math.floor(rng.next() * pool.length)];
  }
}
