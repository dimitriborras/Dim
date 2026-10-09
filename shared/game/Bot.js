import { ITEMS } from '../items.js';
import { PLAYER } from '../constants.js';
import { angleDiff, dist } from '../geometry.js';

const BOT_NAMES = ['Robo-Rex', 'Capitaine Clic', 'Mlle Vis', 'Bidule', 'Pastille', 'Gros Boulon', 'Zigzag', 'Tuba'];
export const botName = (i) => BOT_NAMES[i % BOT_NAMES.length];

// IA simple qui produit les mêmes entrées qu'un joueur humain (aucun accès privilégié
// à la simulation) : sert à tester seul et à simuler des parties complètes.
export class BotBrain {
  constructor(rng) {
    this.rng = rng;
    this.wp = 0;
    this.strafe = rng.next() < 0.5 ? 1 : -1;
    this.strafeSwitch = 0;
    this.aimErr = 0;
    this.wander = null;
    this.skill = rng.range(0.55, 0.9);
  }

  think(p, world, mode, extra = {}) {
    const input = { mx: 0, my: 0, aim: p.aim, fire: false };
    p.input = input;
    if (p.state !== 'alive') return;
    const t = world.time;
    this.aimErr = Math.max(-0.25, Math.min(0.25, this.aimErr + this.rng.range(-0.05, 0.05)));
    if (t > this.strafeSwitch) {
      this.strafe *= -1;
      this.strafeSwitch = t + this.rng.range(0.6, 1.8);
    }

    if (mode === 'race') return this.race(p, world, input);
    if (mode === 'coins') return this.coins(p, world, input);
    if (mode === 'safe') return this.idle(p, world, input);
    return this.fight(p, world, input, mode, extra);
  }

  // Choisit, parmi 16 directions, la plus proche de la direction voulue qui ne mène pas au vide.
  steer(p, world, angle, strength = 1) {
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      let safe = true;
      for (const d of [30, 60, 95]) {
        if (!world.isGround(p.x + cx * d, p.y + cy * d)) { safe = false; break; }
      }
      if (!safe) continue;
      const blocked = world.overlapsWall(p.x + cx * 30, p.y + cy * 30, PLAYER.radius);
      const score = Math.cos(angleDiff(a, angle)) - (blocked ? 0.8 : 0);
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (best === null) {
      const c = world.map.center ?? { x: world.map.width / 2, y: world.map.height / 2 };
      best = Math.atan2(c.y - p.y, c.x - p.x);
    }
    return { mx: Math.cos(best) * strength, my: Math.sin(best) * strength };
  }

  race(p, world, input) {
    const wps = world.map.waypoints;
    if (!wps) return;
    // Après une réapparition, reprendre au premier point devant soi.
    if (this.wp > 0 && p.x < wps[this.wp - 1].x - 60) {
      this.wp = Math.max(0, wps.findIndex((w) => w.x > p.x - 20));
    }
    let w = wps[Math.min(this.wp, wps.length - 1)];
    if (dist(p, w) < 45 && this.wp < wps.length - 1) {
      this.wp += 1;
      w = wps[this.wp];
    }
    const a = Math.atan2(w.y - p.y, w.x - p.x);
    const airborne = world.time < p.airborneUntil;
    const onSpring = world.map.springs.some((s) => Math.abs(s.x + s.w / 2 - w.x) < 40 && Math.abs(s.y + s.h / 2 - w.y) < 40);
    const m = airborne || onSpring ? { mx: Math.cos(a), my: Math.sin(a) } : this.steer(p, world, a);
    input.mx = m.mx;
    input.my = m.my;
    this.harass(p, world, input, 260, 0.25);
  }

  coins(p, world, input) {
    let best = null;
    let bestScore = Infinity;
    for (const pk of world.pickups) {
      const s = dist(p, pk) / (pk.value ?? 1);
      if (s < bestScore) { bestScore = s; best = pk; }
    }
    if (best) {
      const m = this.steer(p, world, Math.atan2(best.y - p.y, best.x - p.x));
      input.mx = m.mx;
      input.my = m.my;
    } else {
      this.idle(p, world, input);
    }
    this.harass(p, world, input, 320, 0.45);
  }

  idle(p, world, input) {
    const t = world.time;
    if (!this.wander || t > this.wander.until || dist(p, this.wander) < 30) {
      const sp = world.map.spawns[Math.floor(this.rng.next() * world.map.spawns.length)];
      this.wander = { x: sp.x + this.rng.range(-80, 80), y: sp.y + this.rng.range(-80, 80), until: t + this.rng.range(2, 4) };
    }
    const m = this.steer(p, world, Math.atan2(this.wander.y - p.y, this.wander.x - p.x), 0.6);
    input.mx = m.mx;
    input.my = m.my;
  }

  // Tir opportuniste sur le joueur visible le plus proche.
  harass(p, world, input, range, rate) {
    const target = this.nearestEnemy(p, world, range);
    if (!target) return;
    input.aim = Math.atan2(target.y - p.y, target.x - p.x) + this.aimErr;
    input.fire = this.rng.next() < rate;
  }

  nearestEnemy(p, world, range = Infinity, includeDecoys = false) {
    let best = null;
    let bestD = range;
    const pool = includeDecoys ? [...world.players, ...world.decoys] : world.players;
    for (const o of pool) {
      if (o === p || o.owner === p.id || (o.state && o.state !== 'alive') || o.dead) continue;
      const d = dist(p, o);
      if (d < bestD && world.lineOfSight(p, o)) { bestD = d; best = o; }
    }
    return best;
  }

  fight(p, world, input, mode, extra) {
    const t = world.time;
    const practice = mode === 'lobby';
    const crown = extra.crown;
    let goal = null;
    let target = this.nearestEnemy(p, world, 700, true);

    if (crown) {
      if (crown.holder === p.id) {
        const threat = this.nearestEnemy(p, world, 500);
        if (threat) {
          const away = Math.atan2(p.y - threat.y, p.x - threat.x);
          const c = world.map.center;
          const home = Math.atan2(c.y - p.y, c.x - p.x);
          goal = { angle: away + angleDiff(home, away) * 0.3 };
        }
      } else if (crown.holder) {
        const h = world.players.find((o) => o.id === crown.holder);
        if (h) { goal = { x: h.x, y: h.y, keep: 140 }; if (world.lineOfSight(p, h)) target = h; }
      } else if (crown.pos) {
        goal = { x: crown.pos.x, y: crown.pos.y, keep: 0 };
      }
    }
    if (!goal && extra.championId && extra.championId !== p.id && this.skill > 0.7) {
      const champ = world.players.find((o) => o.id === extra.championId && o.state === 'alive');
      if (champ) goal = { x: champ.x, y: champ.y, keep: 260 };
    }

    const inv = p.inv;
    const gloveIdx = inv.slots.findIndex((s) => s?.id === 'spring_glove');
    const glueIdx = inv.slots.findIndex((s) => s?.id === 'glue_launcher');
    let keep = 260;
    if (target) {
      const d = dist(p, target);
      if (gloveIdx > 0 && d < 300) keep = 50;
      if (!goal) goal = { x: target.x, y: target.y, keep };
    }

    let angle;
    if (goal?.angle !== undefined) angle = goal.angle;
    else if (goal) {
      const toward = Math.atan2(goal.y - p.y, goal.x - p.x);
      const d = dist(p, goal);
      const k = goal.keep ?? keep;
      if (d > k + 40) angle = toward + this.strafe * 0.35;
      else if (d < k - 40) angle = toward + Math.PI + this.strafe * 0.4;
      else angle = toward + (Math.PI / 2) * this.strafe;
    } else {
      return this.idle(p, world, input);
    }
    const m = this.steer(p, world, angle);
    input.mx = m.mx;
    input.my = m.my;

    if (!target) return;
    const d = dist(p, target);
    const lead = (d / 950) * 0.6;
    const tx = target.x + (target.vx ?? 0) * lead;
    const ty = target.y + (target.vy ?? 0) * lead;
    input.aim = Math.atan2(ty - p.y, tx - p.x) + this.aimErr * (1.2 - this.skill);

    // Choix d'arme.
    if (gloveIdx > 0 && d < 95) this.select(p, gloveIdx);
    else if (glueIdx > 0 && d > 180 && !(t < target.slowUntil) && this.rng.next() < 0.05) this.select(p, glueIdx);
    else if (inv.active !== 0 && (inv.active !== gloveIdx || d > 140) && this.rng.next() < 0.1) this.select(p, 0);
    input.fire = d < 650 && this.rng.next() < (practice ? 0.25 : 0.55 + this.skill * 0.3);

    if (practice) return;
    this.useItems(p, world, d, target);
  }

  select(p, idx) {
    if (p.inv.active !== idx) p.actions.push(`s${idx}`);
  }

  useItems(p, world, d, target) {
    const r = this.rng.next();
    const incoming = world.projectiles.find((pr) => {
      if (pr.owner === p.id) return false;
      const dd = Math.hypot(pr.x - p.x, pr.y - p.y);
      if (dd > 160) return false;
      return (p.x - pr.x) * pr.vx + (p.y - pr.y) * pr.vy > 0;
    });
    const gadget = p.inv.slots.find((s) => s && ITEMS[s.id].category === 'gadget');
    if (incoming) {
      if (gadget?.id === 'bubble_shield' && r < 0.3) p.actions.push('gadget');
      else if (r < 0.06 * this.skill) p.actions.push('dash');
    }
    if (gadget?.id === 'pocket_spring' && p.hp < 40 && r < 0.01) p.actions.push('gadget');
    p.inv.consumables.forEach((c, i) => {
      if (!c) return;
      const k = this.rng.next();
      if (c === null) return;
      if (c.id === 'banana' && d < 220 && k < 0.01) p.actions.push(`c${i}`);
      if (c.id === 'teleporter' && p.hp < 40 && k < 0.02) p.actions.push(`c${i}`);
      if (c.id === 'confetti_bomb' && d < 260 && d > 90 && k < 0.02) p.actions.push(`c${i}`);
      if (c.id === 'decoy' && p.hp < 60 && k < 0.01) p.actions.push(`c${i}`);
    });
    if (target && p.hp < 30 && d < 150 && r < 0.03) p.actions.push('dash');
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
