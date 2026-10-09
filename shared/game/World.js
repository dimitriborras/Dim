import { PLAYER, SHOP, BALL } from '../constants.js';
import {
  pointInRect, resolveCircleRect, circleRectOverlap, segmentRectT, segmentCircleT, angleDiff, dist,
} from '../geometry.js';
import { movingPlatformRect, isGroundAt, pocketAt } from '../maps.js';
import { CombatSystem } from './CombatSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { inHazard, glide, collideWalls, collideBumpers, flickSpeed, flingDuration } from './movement.js';

const DEFAULT_RULES = {
  damage: true,
  knockbackScale: 1,
  items: true,
  weapons: 'all', // 'all' | 'pistol' | 'none'
  respawn: true,
  respawnDelay: PLAYER.respawnDelay,
  respawnInvuln: PLAYER.spawnInvuln,
  frozen: false,
};

const MAX_TRAPS = 8;

// Vrai si l'action « sN » vise une arme (un gadget dans cet emplacement serait déclenché, pas sélectionné).
const ITEMS_WEAPON_SWITCH = (p, a) => p.inv.slots[Number(a[1])]?.id && InventorySystem.isWeaponSlot(p.inv, Number(a[1]));

// Simulation physique d'une phase : déplacement (PlayerController côté serveur),
// projectiles, pièges, éléments d'arène. Les règles de score sont injectées via `hooks`.
export class World {
  constructor({ map, players, rules = {}, rng, hooks = {}, time = 0 }) {
    this.map = map;
    this.players = players;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.hooks = hooks;
    this.time = time;
    this.nextId = 1;
    this.projectiles = [];
    this.traps = [];
    this.bombs = [];
    this.decoys = [];
    this.pickups = []; // gérés par les mini-jeux (pièces, couronne...)
    this.balls = (map.balls ?? []).map((b) => ({
      id: this.nextId++, num: b.num, r: b.r ?? 19, x: b.x, y: b.y, home: { x: b.x, y: b.y },
      vx: 0, vy: 0, lastHitBy: null, lastHitAt: -99, active: true, backAt: 0,
    }));
    this.effects = [];
    this.events = [];
    this.movers = map.movingPlatforms.map((mp) => movingPlatformRect(mp, time));
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  // ---------------------------------------------------------------- terrain
  isGround(x, y) {
    return isGroundAt(this.map, this.movers, x, y);
  }

  inHazard(x, y) {
    return inHazard(this.map, x, y);
  }

  overlapsWall(x, y, radius) {
    return this.map.walls.some((w) => circleRectOverlap(x, y, radius, w));
  }

  // Fraction [0,1] du segment parcourue avant le premier mur.
  rayWalls(x0, y0, x1, y1, pad = 0) {
    let best = 1;
    for (const w of this.map.walls) {
      const t = segmentRectT(x0, y0, x1, y1, w, pad);
      if (t !== null && t < best) best = t;
    }
    return best;
  }

  lineOfSight(a, b) {
    return this.rayWalls(a.x, a.y, b.x, b.y) >= 1;
  }

  // ---------------------------------------------------------------- actions des objets
  muzzle(player, extra = 8) {
    const dx = Math.cos(player.aim);
    const dy = Math.sin(player.aim);
    return { dx, dy, x: player.x + dx * (PLAYER.radius + extra), y: player.y + dy * (PLAYER.radius + extra) };
  }

  spawnProjectile(owner, spec) {
    const m = this.muzzle(owner);
    if (this.rayWalls(owner.x, owner.y, m.x, m.y) < 1) {
      this.emit('fizzle', { x: m.x, y: m.y });
      return;
    }
    // Assistance tactile légère : projectile un peu plus large, jamais de visée automatique.
    const radius = spec.radius + (owner.touch ? 4 : 0);
    this.projectiles.push({
      id: this.nextId++,
      owner: owner.id,
      kind: spec.kind,
      x: m.x,
      y: m.y,
      vx: m.dx * spec.speed,
      vy: m.dy * spec.speed,
      radius,
      damage: spec.damage,
      knockback: spec.knockback,
      slow: spec.slow ?? 0,
      dieAt: this.time + spec.life,
    });
    this.emit('shot', { id: owner.id, kind: spec.kind });
  }

  meleeCone(owner, { range, arc, damage, knockback }) {
    this.emit('punch', { id: owner.id, aim: owner.aim });
    const reach = range + PLAYER.radius;
    for (const target of [...this.players, ...this.decoys]) {
      if (target === owner || target.owner === owner.id) continue;
      if (target.state && target.state !== 'alive') continue;
      const d = dist(owner, target);
      if (d > reach + PLAYER.radius) continue;
      const ang = Math.atan2(target.y - owner.y, target.x - owner.x);
      if (d > PLAYER.radius && Math.abs(angleDiff(ang, owner.aim)) > arc / 2) continue;
      if (!this.lineOfSight(owner, target)) continue;
      const dx = d > 0.01 ? (target.x - owner.x) / d : Math.cos(owner.aim);
      const dy = d > 0.01 ? (target.y - owner.y) / d : Math.sin(owner.aim);
      if (target.state) {
        CombatSystem.hit(this, owner, target, { damage, knockback, dirx: dx, diry: dy, cause: 'glove' });
      } else {
        this.popDecoy(target);
      }
    }
  }

  placeTrap(owner, kind) {
    if (!this.isGround(owner.x, owner.y)) return false;
    if (this.traps.length >= MAX_TRAPS) this.traps.shift();
    this.traps.push({ id: this.nextId++, kind, owner: owner.id, x: owner.x, y: owner.y, r: 16, armAt: this.time + 0.7 });
    this.emit('trap', { id: owner.id });
    return true;
  }

  // Ne traverse jamais un mur et n'atterrit que sur un sol sûr ; sinon l'objet est conservé.
  teleport(player, maxDist) {
    const dx = Math.cos(player.aim);
    const dy = Math.sin(player.aim);
    const tWall = this.rayWalls(player.x, player.y, player.x + dx * maxDist, player.y + dy * maxDist, PLAYER.radius);
    const reach = maxDist * tWall - 4;
    for (let d = reach; d >= 40; d -= 10) {
      const x = player.x + dx * d;
      const y = player.y + dy * d;
      if (!this.isGround(x, y) || this.overlapsWall(x, y, PLAYER.radius)) continue;
      if (this.inHazard(x, y) && d > 60) continue;
      this.emit('teleport', { id: player.id, fx: player.x, fy: player.y, tx: x, ty: y });
      player.x = x;
      player.y = y;
      player.vx *= 0.3;
      player.vy *= 0.3;
      return true;
    }
    return false;
  }

  throwBomb(owner) {
    const m = this.muzzle(owner, 4);
    this.bombs.push({
      id: this.nextId++, owner: owner.id, x: m.x, y: m.y,
      vx: m.dx * 600 + owner.vx * 0.3, vy: m.dy * 600 + owner.vy * 0.3,
      explodeAt: this.time + 1.25,
    });
    this.emit('throw', { id: owner.id });
  }

  explode(b) {
    const R = 125;
    this.emit('boom', { x: b.x, y: b.y, r: R });
    const owner = this.players.find((p) => p.id === b.owner) ?? null;
    for (const p of this.players) {
      if (p.state !== 'alive') continue;
      const d = dist(b, p);
      if (d > R + PLAYER.radius) continue;
      if (!this.lineOfSight(b, p)) continue;
      const f = 1 - Math.min(1, d / (R + PLAYER.radius)) * 0.5;
      const dx = d > 0.01 ? (p.x - b.x) / d : 1;
      const dy = d > 0.01 ? (p.y - b.y) / d : 0;
      CombatSystem.hit(this, owner, p, { damage: Math.round(25 * f), knockback: 780 * f, dirx: dx, diry: dy, cause: 'bomb' });
    }
    for (const dcy of this.decoys) if (dist(b, dcy) < R) this.popDecoy(dcy);
  }

  spawnDecoy(owner) {
    const a = owner.moveAngle ?? owner.aim;
    this.decoys.push({
      id: this.nextId++, owner: owner.id, x: owner.x, y: owner.y,
      vx: Math.cos(a) * 215, vy: Math.sin(a) * 215, aim: owner.aim,
      hp: 2, dieAt: this.time + 3.5,
    });
    this.emit('decoy', { id: owner.id });
  }

  popDecoy(d) {
    if (d.dead) return;
    d.dead = true;
    this.emit('pop', { x: d.x, y: d.y });
  }

  // ---------------------------------------------------------------- simulation
  step(dt) {
    const prevMovers = this.movers;
    this.time += dt;
    this.movers = this.map.movingPlatforms.map((mp) => movingPlatformRect(mp, this.time));
    const t = this.time;

    for (const p of this.players) this.stepPlayer(p, dt, prevMovers);
    this.collidePlayers();
    this.stepBalls(dt);
    for (const p of this.players) this.postPlayer(p);
    this.stepProjectiles(dt);
    this.stepTraps();
    this.stepBombs(dt);
    this.stepDecoys(dt);
    CombatSystem.update(this);
    this.projectiles = this.projectiles.filter((pr) => !pr.dead && t < pr.dieAt);
    this.decoys = this.decoys.filter((d) => !d.dead);
  }

  stepPlayer(p, dt, prevMovers) {
    const t = this.time;
    if (p.state === 'dead') {
      p.actions.length = 0; // pas d'actions en attente qui partiraient à la réapparition
      p.pendingFlick = null;
      return;
    }
    InventorySystem.update(p, t);

    if (p.state === 'falling') {
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.actions.length = 0;
      p.pendingFlick = null;
      return;
    }

    const frozen = this.rules.frozen;
    const toppled = t < p.toppleUntil;
    const slipping = t < p.slipUntil;
    const airborne = t < p.airborneUntil;
    const busy = !!p.channel;
    const stunned = toppled || slipping;
    p.energy = Math.min(PLAYER.energyMax, (p.energy ?? PLAYER.energyMax) + PLAYER.energyRegen * dt);

    // Actions ponctuelles (objet, sélection d'emplacement) puis pichenette.
    const actions = p.actions.splice(0);
    const isSwitch = (a) => a === 'wn' || a === 'wp' || (a[0] === 's' && a.length === 2 && ITEMS_WEAPON_SWITCH(p, a));
    for (const a of actions) {
      if (frozen || stunned || busy) { if (isSwitch(a)) this.doAction(p, a); } else this.doAction(p, a);
    }
    if (p.pendingFlick && !frozen && !stunned && !busy && !airborne) {
      const f = p.pendingFlick;
      if (f.hop) this.hop(p, f.a);
      else this.flick(p, f.a, f.p);
    }
    p.pendingFlick = null;

    // Glissade de palet.
    const speedBefore = Math.hypot(p.vx, p.vy);
    glide(p, dt, this.map, { fling: t < p.flingUntil, toppled, airborne, slowed: t < p.slowUntil && t >= p.bubbleUntil });

    // Les plateformes mobiles transportent ceux qui sont dessus.
    if (!airborne) {
      for (let i = 0; i < prevMovers.length; i++) {
        if (pointInRect(p.x, p.y, prevMovers[i])) {
          p.x += this.movers[i].x - prevMovers[i].x;
          p.y += this.movers[i].y - prevMovers[i].y;
          break;
        }
      }
    }
    this.collideStatic(p, speedBefore);

    // Posée : la figurine vise et tire seule sur l'adversaire visible le plus proche.
    p.settled = Math.hypot(p.vx, p.vy) < PLAYER.settledSpeed;
    if (!frozen && !stunned && !busy && !airborne && p.settled) this.autoFire(p);
  }

  autoFire(p) {
    let best = null;
    let bestD = PLAYER.autoFireRange;
    const t = this.time;
    for (const o of this.players) {
      if (o === p || o.state !== 'alive' || t < o.invulnUntil) continue;
      const d = dist(p, o);
      if (d < bestD && this.lineOfSight(p, o)) { bestD = d; best = o; }
    }
    for (const o of this.decoys) {
      if (o.owner === p.id || o.dead) continue;
      const d = dist(p, o);
      if (d < bestD && this.lineOfSight(p, o)) { bestD = d; best = o; }
    }
    if (!best) return;
    // Visée légèrement anticipée sur la cible en mouvement.
    const lead = (bestD / 950) * 0.5;
    p.aim = Math.atan2(best.y + (best.vy ?? 0) * lead - p.y, best.x + (best.vx ?? 0) * lead - p.x);
    InventorySystem.autoFire(p, this, best, bestD);
  }

  // Pichenette : se lancer comme une bille. Percuter quelqu'un lui transmet l'élan.
  flick(p, angle, power) {
    const t = this.time;
    if (this.rules.frozen || !Number.isFinite(angle)) return false;
    if ((p.energy ?? 0) < PLAYER.flickCost) return false;
    const pw = Math.max(0, Math.min(1, power));
    const factor = (p.speedFactor ?? 1) * (t < p.slowUntil && t >= p.bubbleUntil ? 0.6 : 1);
    const v = flickSpeed(pw, factor);
    p.vx = Math.cos(angle) * v;
    p.vy = Math.sin(angle) * v;
    p.flingUntil = t + flingDuration(pw);
    p.energy -= PLAYER.flickCost;
    p.lastFlickAt = t;
    p.aim = angle;
    this.emit('flick', { id: p.id, power: Math.round(pw * 100) / 100 });
    return true;
  }

  // Petite tape : petit bond pour se placer finement.
  hop(p, angle) {
    if (this.rules.frozen || !Number.isFinite(angle) || (p.energy ?? 0) < PLAYER.hopCost) return false;
    const v = PLAYER.hopSpeed * (p.speedFactor ?? 1);
    p.vx = Math.cos(angle) * v;
    p.vy = Math.sin(angle) * v;
    p.energy -= PLAYER.hopCost;
    p.lastFlickAt = this.time;
    this.emit('hop', { id: p.id });
    return true;
  }

  topple(p) {
    if (this.time < p.airborneUntil || this.time < p.bubbleUntil) return;
    if (this.time >= p.toppleUntil) this.emit('topple', { id: p.id, x: p.x, y: p.y });
    p.toppleUntil = this.time + PLAYER.toppleTime;
    p.flingUntil = 0;
    p.channel = null;
  }

  doAction(p, a) {
    if (a === 'item') {
      InventorySystem.useItem(p, this);
    } else if (a === 'gadget') {
      InventorySystem.useGadget(p, this);
    } else if (a === 'c0' || a === 'c1') {
      InventorySystem.useConsumable(p, this, a === 'c0' ? 0 : 1);
    } else if (a === 's0' || a === 's1' || a === 's2') {
      InventorySystem.pressSlot(p, this, Number(a[1]));
    } else if (a === 'wn' || a === 'wp') {
      InventorySystem.cycleWeapon(p, this, a === 'wn' ? 1 : -1);
    }
  }

  collideStatic(p, speedBefore = 0) {
    if (collideWalls(p, this.map.walls) && speedBefore > 300) this.emit('thud', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
    if (this.time < p.airborneUntil) return;
    const b = collideBumpers(p, this.map.bumpers);
    if (b) {
      p.flingUntil = 0;
      this.emit('bump', { x: b.x, y: b.y });
    }
    for (const s of this.map.springs) {
      if (pointInRect(p.x, p.y, s)) {
        p.vx = Math.cos(s.dir) * s.power;
        p.vy = Math.sin(s.dir) * s.power;
        p.airborneUntil = this.time + s.air;
        p.flingUntil = 0;
        this.emit('spring', { x: s.x + s.w / 2, y: s.y + s.h / 2, id: p.id });
      }
    }
  }

  // Boules de billard : elles roulent, rebondissent sur les bandes, se percutent entre elles
  // et percutent les figurines. Une boule garde en mémoire qui l'a lancée : si elle envoie
  // quelqu'un dans une poche, l'élimination revient à ce joueur (carambolage).
  stepBalls(dt) {
    const t = this.time;
    for (const b of this.balls) {
      if (!b.active) {
        const free = this.players.every((p) => p.state !== 'alive' || Math.hypot(p.x - b.home.x, p.y - b.home.y) > 50)
          && this.balls.every((o) => o === b || !o.active || Math.hypot(o.x - b.home.x, o.y - b.home.y) > o.r + b.r + 2);
        if (t >= b.backAt && free) {
          Object.assign(b, { active: true, x: b.home.x, y: b.home.y, vx: 0, vy: 0, lastHitBy: null });
          this.emit('ballBack', { num: b.num });
        }
        continue;
      }
      const k = Math.exp(-BALL.friction * dt);
      b.vx *= k;
      b.vy *= k;
      if (Math.hypot(b.vx, b.vy) < PLAYER.stopSpeed) { b.vx = 0; b.vy = 0; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const fast = Math.hypot(b.vx, b.vy);
      if (collideWalls(b, this.map.walls, b.r, 0.8) && fast > 250) this.emit('thud', { x: Math.round(b.x), y: Math.round(b.y) });
      const pk = pocketAt(this.map, b.x, b.y);
      if (pk) {
        b.active = false;
        b.backAt = t + BALL.respawn;
        this.emit('ballPocket', { x: pk.x, y: pk.y, num: b.num, by: t - b.lastHitAt < PLAYER.killCreditWindow ? b.lastHitBy : null });
      }
    }
    const balls = this.balls.filter((b) => b.active);
    // Boule contre boule.
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        const hit = this.bounce(a, b, a.r + b.r, 1, 1, BALL.restitution);
        if (hit > 0) {
          // La boule percutée hérite de l'auteur du coup.
          const [src, dst] = Math.hypot(a.vx, a.vy) < Math.hypot(b.vx, b.vy) ? [a, b] : [b, a];
          if (src.lastHitBy && t - src.lastHitAt < PLAYER.killCreditWindow) { dst.lastHitBy = src.lastHitBy; dst.lastHitAt = t; }
          if (hit > 120) this.emit('clack', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), power: Math.round(hit) });
        }
      }
    }
    // Boule contre figurine.
    for (const p of this.players) {
      if (p.state !== 'alive' || t < p.airborneUntil) continue;
      for (const b of balls) {
        const vp = Math.hypot(p.vx, p.vy);
        const vb = Math.hypot(b.vx, b.vy);
        const shield = t < p.bubbleUntil;
        const hit = this.bounce(p, b, PLAYER.radius + b.r, shield ? 1e6 : 1, BALL.mass, BALL.playerRestitution);
        if (hit <= 0) continue;
        if (vp >= vb) {
          const who = this.creditOf(p); // la figurine (ou celui qui l'a lancée) a tapé la boule
          if (who) { b.lastHitBy = who; b.lastHitAt = t; }
        } else if (b.lastHitBy && b.lastHitBy !== p.id && t - b.lastHitAt < PLAYER.killCreditWindow) {
          p.lastHitBy = b.lastHitBy; // carambolage : la boule pousse pour son lanceur
          p.lastHitAt = t;
        }
        if (hit > 120) this.emit('clack', { x: Math.round((p.x + b.x) / 2), y: Math.round((p.y + b.y) / 2), power: Math.round(hit) });
        if (Math.hypot(p.vx, p.vy) > PLAYER.toppleSpeed) this.topple(p);
      }
    }
  }

  // Qui est responsable du mouvement de cette figurine ? Elle-même si elle vient de se lancer,
  // sinon celui qui l'a frappée récemment (les carambolages remontent ainsi jusqu'à l'auteur).
  creditOf(p) {
    const t = this.time;
    if (t - (p.lastFlickAt ?? -99) < 1.5) return p.id;
    if (p.lastHitBy && t - p.lastHitAt < PLAYER.killCreditWindow) return p.lastHitBy;
    return null;
  }

  // Choc élastique entre deux disques de masses ma et mb. Retourne l'impulsion (0 si pas de choc).
  bounce(a, b, minD, ma, mb, e) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= minD || d < 0.001) return 0;
    const nx = dx / d;
    const ny = dy / d;
    const inv = 1 / ma + 1 / mb;
    const push = minD - d;
    a.x -= nx * push * (1 / ma) / inv; a.y -= ny * push * (1 / ma) / inv;
    b.x += nx * push * (1 / mb) / inv; b.y += ny * push * (1 / mb) / inv;
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (vn <= 0) return 0;
    const j = ((1 + e) * vn) / inv;
    a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
    b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
    return j;
  }

  // Chocs entre figurines : séparation, puis échange d'élan comme deux billes de plastique.
  // Une figurine lancée par pichenette transmet presque toute sa vitesse (effet berceau de Newton).
  collidePlayers() {
    const t = this.time;
    const ps = this.players.filter((p) => p.state === 'alive' && t >= p.airborneUntil);
    const minD = PLAYER.radius * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        let a = ps[i];
        let b = ps[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d < 0.001) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (minD - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        // Vitesse de rapprochement le long de la normale (positive = ils se rentrent dedans).
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn <= 0) continue;
        const aFling = t < a.flingUntil;
        const bFling = t < b.flingUntil;
        if (!aFling && !bFling) {
          // Deux palets qui glissent : rebond élastique, sans dégâts.
          const jSoft = ((1 + PLAYER.restitution) * vn) / 2;
          a.vx -= nx * jSoft; a.vy -= ny * jSoft;
          b.vx += nx * jSoft; b.vy += ny * jSoft;
          if (vn > 200) this.emit('clack', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), power: Math.round(jSoft) });
          if (Math.hypot(a.vx, a.vy) > 150 || Math.hypot(b.vx, b.vy) > 150) {
            // L'attaquant est le plus rapide avant le choc : il est crédité d'une éventuelle chute.
            // Après l'échange d'élan, c'est la victime qui file : l'autre était l'attaquant.
            const victim = Math.hypot(a.vx, a.vy) > Math.hypot(b.vx, b.vy) ? a : b;
            const attacker = victim === a ? b : a;
            const who = this.creditOf(attacker);
            if (who && who !== victim.id) { victim.lastHitBy = who; victim.lastHitAt = t; }
          }
          continue;
        }
        // Le « frappeur » est celui qui est lancé (le plus rapide si les deux le sont).
        let sx = nx;
        let sy = ny;
        if (!aFling || (bFling && Math.hypot(b.vx, b.vy) > Math.hypot(a.vx, a.vy))) {
          [a, b] = [b, a];
          sx = -nx; sy = -ny;
        }
        const impulse = ((1 + PLAYER.restitution) * vn) / 2;
        this.emit('clack', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), power: Math.round(impulse) });
        const damage = Math.round(Math.max(0, Math.min(15, (impulse - 220) / 35)));
        const absorbed = t < b.bubbleUntil || t < b.invulnUntil;
        if (absorbed) {
          // Rebond sur la bulle : le frappeur repart en arrière.
          a.vx -= sx * vn * (1 + PLAYER.restitution); a.vy -= sy * vn * (1 + PLAYER.restitution);
          CombatSystem.hit(this, a, b, { cause: 'flick' });
        } else {
          a.vx -= sx * impulse; a.vy -= sy * impulse;
          CombatSystem.hit(this, a, b, { damage, knockback: impulse, dirx: sx, diry: sy, cause: 'flick' });
          if (impulse >= PLAYER.slamImpulse && !absorbed) {
            this.emit('slam', { id: a.id, victim: b.id, x: Math.round(b.x), y: Math.round(b.y) });
            this.hooks.onSlam?.(a, b, impulse);
          }
        }
        a.flingUntil = Math.min(a.flingUntil, t + 0.05);
      }
    }
    for (const p of ps) {
      if (t >= p.flingUntil) continue;
      for (const dcy of this.decoys) if (dcy.owner !== p.id && Math.hypot(dcy.x - p.x, dcy.y - p.y) < minD) this.popDecoy(dcy);
    }
  }

  postPlayer(p) {
    if (p.state !== 'alive') return;
    // Bornes de la carte (le vide s'étend au-delà).
    p.x = Math.max(-200, Math.min(this.map.width + 200, p.x));
    p.y = Math.max(-200, Math.min(this.map.height + 200, p.y));
    if (this.time >= p.airborneUntil && !this.isGround(p.x, p.y)) {
      if (this.rules.frozen) return;
      const pk = pocketAt(this.map, p.x, p.y);
      if (pk) {
        // Empochée : la figurine file au fond de la poche.
        p.vx = (pk.x - p.x) * 6;
        p.vy = (pk.y - p.y) * 6;
        p.holed = true;
        this.emit('pocket', { id: p.id, x: pk.x, y: pk.y, by: this.time - p.lastHitAt <= PLAYER.killCreditWindow ? p.lastHitBy : null });
      }
      CombatSystem.startFall(this, p);
    }
  }

  stepProjectiles(dt) {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const x1 = pr.x + pr.vx * dt;
      const y1 = pr.y + pr.vy * dt;
      let bestT = this.rayWalls(pr.x, pr.y, x1, y1, pr.radius * 0.5);
      let target = null;
      for (const p of this.players) {
        if (p.id === pr.owner || p.state !== 'alive') continue;
        const tt = segmentCircleT(pr.x, pr.y, x1, y1, p.x, p.y, PLAYER.radius + pr.radius);
        if (tt !== null && tt < bestT) { bestT = tt; target = p; }
      }
      for (const d of this.decoys) {
        if (d.owner === pr.owner || d.dead) continue;
        const tt = segmentCircleT(pr.x, pr.y, x1, y1, d.x, d.y, PLAYER.radius + pr.radius);
        if (tt !== null && tt < bestT) { bestT = tt; target = d; }
      }
      let ballHit = null;
      for (const b of this.balls) {
        if (!b.active) continue;
        const tt = segmentCircleT(pr.x, pr.y, x1, y1, b.x, b.y, b.r + pr.radius);
        if (tt !== null && tt < bestT) { bestT = tt; target = null; ballHit = b; }
      }
      if (ballHit) {
        // Tirer dans une boule la pousse : de quoi faire des carambolages à distance.
        pr.x += (x1 - pr.x) * bestT;
        pr.y += (y1 - pr.y) * bestT;
        pr.dead = true;
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        ballHit.vx += (pr.vx / sp) * pr.knockback * 2.2;
        ballHit.vy += (pr.vy / sp) * pr.knockback * 2.2;
        ballHit.lastHitBy = pr.owner;
        ballHit.lastHitAt = this.time;
        this.emit('impact', { x: pr.x, y: pr.y, kind: pr.kind });
        continue;
      }
      pr.x += (x1 - pr.x) * bestT;
      pr.y += (y1 - pr.y) * bestT;
      if (bestT >= 1) continue;
      pr.dead = true;
      if (!target) {
        this.emit('impact', { x: pr.x, y: pr.y, kind: pr.kind });
        continue;
      }
      if (!target.state) {
        target.hp -= 1;
        this.emit('impact', { x: pr.x, y: pr.y, kind: pr.kind });
        if (target.hp <= 0) this.popDecoy(target);
        continue;
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      const owner = this.players.find((p) => p.id === pr.owner) ?? null;
      this.emit('impact', { x: pr.x, y: pr.y, kind: pr.kind, hit: target.id });
      CombatSystem.hit(this, owner, target, {
        damage: pr.damage, knockback: pr.knockback, dirx: pr.vx / sp, diry: pr.vy / sp, slow: pr.slow, cause: pr.kind,
      });
    }
  }

  stepTraps() {
    const t = this.time;
    for (const tr of this.traps) {
      if (tr.dead || t < tr.armAt) continue;
      for (const p of this.players) {
        if (p.state !== 'alive' || t < p.airborneUntil || t < p.slipUntil) continue;
        if (Math.hypot(p.x - tr.x, p.y - tr.y) > PLAYER.radius + tr.r) continue;
        tr.dead = true;
        p.slipUntil = t + 1.1;
        p.channel = null;
        const sp = Math.hypot(p.vx, p.vy);
        const a = sp > 20 ? Math.atan2(p.vy, p.vx) : this.rng.range(0, Math.PI * 2);
        const s = Math.max(sp, 400);
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        if (tr.owner !== p.id) { p.lastHitBy = tr.owner; p.lastHitAt = t; }
        this.emit('slip', { id: p.id, x: tr.x, y: tr.y, owner: tr.owner });
        break;
      }
    }
    this.traps = this.traps.filter((tr) => !tr.dead);
  }

  stepBombs(dt) {
    for (const b of this.bombs) {
      const k = Math.exp(-3.5 * dt);
      b.vx *= k;
      b.vy *= k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const w of this.map.walls) {
        const n = resolveCircleRect(b, 8, w);
        if (n) {
          const vn = b.vx * n.nx + b.vy * n.ny;
          if (vn < 0) { b.vx -= 1.6 * vn * n.nx; b.vy -= 1.6 * vn * n.ny; }
        }
      }
      if (this.time >= b.explodeAt) { b.dead = true; this.explode(b); }
    }
    this.bombs = this.bombs.filter((b) => !b.dead);
  }

  stepDecoys(dt) {
    for (const d of this.decoys) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      for (const w of this.map.walls) {
        const n = resolveCircleRect(d, PLAYER.radius, w);
        if (n) {
          // glisse le long du mur
          const vn = d.vx * n.nx + d.vy * n.ny;
          if (vn < 0) { d.vx -= vn * n.nx; d.vy -= vn * n.ny; }
        }
      }
      if (this.time >= d.dieAt || !this.isGround(d.x, d.y)) this.popDecoy(d);
    }
  }

  // ---------------------------------------------------------------- réseau
  snapshot() {
    const t = this.time;
    const r = (v) => Math.round(v);
    return {
      t: Math.round(t * 1000) / 1000,
      e: this.epoch ?? 0,
      map: this.map.id,
      movers: this.movers.map((m) => [r(m.x), r(m.y)]),
      players: this.players.map((p) => ({
        id: p.id,
        x: r(p.x),
        y: r(p.y),
        a: Math.round(p.aim * 100) / 100,
        hp: p.hp,
        s: p.state,
        w: p.inv.slots[p.inv.active]?.id ?? 'pistol',
        f: [
          t < p.invulnUntil ? 'i' : '',
          t < p.bubbleUntil ? 'b' : '',
          t < p.slowUntil ? 'g' : '',
          t < p.slipUntil ? 'l' : '',
          t < p.airborneUntil ? 'j' : '',
          t < p.flingUntil ? 'f' : '',
          p.settled ? '' : 'm',
          t < p.toppleUntil ? 'k' : '',
          p.championShield ? 'c' : '',
          p.channel ? 'p' : '',
        ].join(''),
      })),
      proj: this.projectiles.map((p) => [p.id, r(p.x), r(p.y), p.kind, p.radius]),
      traps: this.traps.map((tr) => [tr.id, r(tr.x), r(tr.y), t >= tr.armAt ? 1 : 0]),
      bombs: this.bombs.map((b) => [b.id, r(b.x), r(b.y), Math.max(0, Math.round((b.explodeAt - t) * 10) / 10)]),
      balls: this.balls.filter((b) => b.active).map((b) => [b.id, r(b.x), r(b.y), b.num]),
      decoys: this.decoys.map((d) => [d.id, d.owner, r(d.x), r(d.y), Math.round(Math.atan2(d.vy, d.vx) * 100) / 100]),
      pickups: this.pickups.map((pk) => [pk.id, pk.kind, r(pk.x), r(pk.y)]),
    };
  }
}

// Remise à zéro de l'état physique d'un joueur au début d'une phase.
export function resetBody(p, pos) {
  Object.assign(p, {
    x: pos.x, y: pos.y, vx: 0, vy: 0,
    hp: PLAYER.maxHp, state: 'alive', fallUntil: 0, respawnAt: 0,
    invulnUntil: 0, flingUntil: 0, toppleUntil: 0, pendingFlick: null, energy: PLAYER.energyMax, settled: true, slowUntil: 0, slipUntil: 0,
    airborneUntil: 0, bubbleUntil: 0, lastHitBy: null, lastHitAt: -99,
    moveAngle: null, speedFactor: 1, holed: false,
  });
  p.actions.length = 0;
}
