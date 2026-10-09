import { PLAYER, BALL } from '../constants.js';
import {
  pointInRect, resolveCircleRect, circleRectOverlap, segmentRectT, dist,
} from '../geometry.js';
import { movingPlatformRect, isGroundAt, pocketAt } from '../maps.js';
import { CombatSystem } from './CombatSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { inHazard, glide, collideWalls, collideBumpers, flickSpeed, flingDuration } from './movement.js';

const DEFAULT_RULES = {
  damage: true,
  knockbackScale: 1,
  items: true, // gadgets utilisables
  regen: 1, // multiplicateur de recharge des pichenettes (0 : coups comptés)
  respawn: true,
  respawnDelay: PLAYER.respawnDelay,
  respawnInvuln: PLAYER.spawnInvuln,
  frozen: false,
};

const MAX_TRAPS = 8;

// Simulation physique d'une phase : palets, boules, pièges et gadgets, éléments d'arène.
// Les règles de score sont injectées via `hooks`.
export class World {
  constructor({ map, players, rules = {}, rng, hooks = {}, time = 0 }) {
    this.map = map;
    this.players = players;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.hooks = hooks;
    this.time = time;
    this.nextId = 1;
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

  // Pétard : onde de choc autour du lanceur.
  shockwave(owner, R, power) {
    this.emit('boom', { x: owner.x, y: owner.y, r: R, small: true });
    for (const p of this.players) {
      if (p === owner || p.state !== 'alive' || this.time < p.airborneUntil) continue;
      const d = dist(owner, p);
      if (d > R + PLAYER.radius || !this.lineOfSight(owner, p)) continue;
      const f = 1 - Math.min(1, d / (R + PLAYER.radius)) * 0.55;
      const dx = d > 0.01 ? (p.x - owner.x) / d : 1;
      const dy = d > 0.01 ? (p.y - owner.y) / d : 0;
      CombatSystem.hit(this, owner, p, { knockback: (power * f) / (p.mass ?? 1), dirx: dx, diry: dy, cause: 'blast' });
    }
    for (const b of this.balls) {
      if (!b.active) continue;
      const d = dist(owner, b);
      if (d > R + b.r || d < 0.01) continue;
      const f = 1 - Math.min(1, d / (R + b.r)) * 0.55;
      b.vx += ((b.x - owner.x) / d) * power * f;
      b.vy += ((b.y - owner.y) / d) * power * f;
      b.lastHitBy = owner.id;
      b.lastHitAt = this.time;
    }
  }

  // Aimant : attire les figurines (et les boules) proches vers le lanceur.
  magnet(owner, R, speed) {
    this.emit('magnet', { id: owner.id, x: owner.x, y: owner.y, r: R });
    const pull = (o, m) => {
      const d = dist(owner, o);
      if (d > R || d < PLAYER.radius * 2.2) return false;
      const k = speed * (0.6 + 0.4 * (1 - d / R)) / m;
      o.vx = ((owner.x - o.x) / d) * k;
      o.vy = ((owner.y - o.y) / d) * k;
      return true;
    };
    for (const p of this.players) {
      if (p === owner || p.state !== 'alive' || this.time < p.bubbleUntil || this.time < p.airborneUntil) continue;
      if (pull(p, p.mass ?? 1)) { p.lastHitBy = owner.id; p.lastHitAt = this.time; this.emit('push', { id: p.id, by: owner.id, x: p.x, y: p.y }); }
    }
    for (const b of this.balls) if (b.active && pull(b, BALL.mass)) { b.lastHitBy = owner.id; b.lastHitAt = this.time; }
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
      CombatSystem.hit(this, owner, p, { knockback: (780 * f) / (p.mass ?? 1), dirx: dx, diry: dy, cause: 'bomb' });
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
    this.stepTraps();
    this.stepBombs(dt);
    this.stepDecoys(dt);
    CombatSystem.update(this);
    this.decoys = this.decoys.filter((d) => !d.dead);
  }

  stepPlayer(p, dt, prevMovers) {
    const t = this.time;
    if (p.state === 'dead') {
      p.actions.length = 0; // pas d'actions en attente qui partiraient à la réapparition
      p.pendingFlick = null;
      return;
    }
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
    const stunned = toppled || slipping;
    const emax = p.energyMax ?? PLAYER.energyMax;
    p.energy = Math.min(emax, (p.energy ?? emax) + PLAYER.energyRegen * (p.regenMul ?? 1) * this.rules.regen * dt);

    // Objet (bouton rond) puis pichenette.
    const actions = p.actions.splice(0);
    if (!frozen && !stunned) for (const a of actions) this.doAction(p, a);
    if (p.pendingFlick && !frozen && !stunned && !airborne) {
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

    p.settled = Math.hypot(p.vx, p.vy) < PLAYER.settledSpeed;
  }

  // Pichenette : se lancer comme une bille. Percuter quelqu'un lui transmet l'élan.
  flick(p, angle, power) {
    const t = this.time;
    if (this.rules.frozen || !Number.isFinite(angle)) return false;
    if ((p.energy ?? 0) < PLAYER.flickCost) return false;
    const pw = Math.max(0, Math.min(1, power));
    const factor = (p.speedFactor ?? 1) * (p.powerMul ?? 1) * (t < p.slowUntil && t >= p.bubbleUntil ? 0.6 : 1);
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
    const v = PLAYER.hopSpeed * (p.speedFactor ?? 1) * (p.powerMul ?? 1);
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
  }

  doAction(p, a) {
    if (a === 'item') InventorySystem.useItem(p, this);
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
        const by = t - b.lastHitAt < PLAYER.killCreditWindow ? b.lastHitBy : null;
        this.emit('ballPocket', { x: pk.x, y: pk.y, num: b.num, by });
        if (by) this.hooks.onBallPocket?.(by, b);
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
        const hit = this.bounce(p, b, PLAYER.radius + b.r, shield ? 1e6 : p.mass ?? 1, BALL.mass, BALL.playerRestitution);
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
  // Les masses (Lest de plomb) et la Coque à pointes modulent l'échange.
  collidePlayers() {
    const t = this.time;
    const ps = this.players.filter((p) => p.state === 'alive' && t >= p.airborneUntil);
    const minD = PLAYER.radius * 2;
    const massOf = (p) => (t < p.bubbleUntil ? 8 : p.mass ?? 1);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        let a = ps[i];
        let b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d < 0.001) continue;
        const nx = dx / d;
        const ny = dy / d;
        const ma = massOf(a);
        const mb = massOf(b);
        const inv = 1 / ma + 1 / mb;
        const push = minD - d;
        a.x -= nx * push * (1 / ma) / inv; a.y -= ny * push * (1 / ma) / inv;
        b.x += nx * push * (1 / mb) / inv; b.y += ny * push * (1 / mb) / inv;
        // Vitesse de rapprochement le long de la normale (positive = ils se rentrent dedans).
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn <= 0) continue;
        const aFling = t < a.flingUntil;
        const bFling = t < b.flingUntil;
        if (!aFling && !bFling) {
          // Deux palets qui glissent : rebond élastique.
          const jSoft = ((1 + PLAYER.restitution) * vn) / inv;
          a.vx -= nx * jSoft / ma; a.vy -= ny * jSoft / ma;
          b.vx += nx * jSoft / mb; b.vy += ny * jSoft / mb;
          if (vn > 200) this.emit('clack', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), power: Math.round(jSoft / 2) });
          if (Math.hypot(a.vx, a.vy) > 150 || Math.hypot(b.vx, b.vy) > 150) {
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
        let mA = ma;
        let mB = mb;
        if (!aFling || (bFling && Math.hypot(b.vx, b.vy) > Math.hypot(a.vx, a.vy))) {
          [a, b] = [b, a];
          [mA, mB] = [mB, mA];
          sx = -nx; sy = -ny;
        }
        // Impulsion ramenée à des masses unitaires (même échelle qu'avant les atouts).
        const impulse = ((1 + PLAYER.restitution) * vn) / inv / Math.sqrt(mA * mB);
        const J = ((1 + PLAYER.restitution) * vn) / inv;
        this.emit('clack', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), power: Math.round(impulse) });
        const absorbed = t < b.bubbleUntil || t < b.invulnUntil;
        if (absorbed) {
          // Rebond sur la bulle : le frappeur repart en arrière.
          a.vx -= sx * vn * (1 + PLAYER.restitution); a.vy -= sy * vn * (1 + PLAYER.restitution);
          CombatSystem.hit(this, a, b, { cause: 'flick' });
        } else {
          a.vx -= sx * J / mA; a.vy -= sy * J / mA;
          CombatSystem.hit(this, a, b, { knockback: (J / mB) * (a.punch ?? 1), dirx: sx, diry: sy, cause: 'flick' });
          if (impulse * (a.punch ?? 1) >= PLAYER.slamImpulse) {
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
    // Dernière position sûre (au moins un rayon à l'intérieur du sol) : point de retour de la bouée.
    const R = PLAYER.radius;
    if (this.isGround(p.x, p.y) && this.isGround(p.x + R, p.y) && this.isGround(p.x - R, p.y) && this.isGround(p.x, p.y + R) && this.isGround(p.x, p.y - R)) {
      p.safe = { x: p.x, y: p.y };
    }
    // Bornes de la carte (le vide s'étend au-delà).
    p.x = Math.max(-200, Math.min(this.map.width + 200, p.x));
    p.y = Math.max(-200, Math.min(this.map.height + 200, p.y));
    if (this.time >= p.airborneUntil && !this.isGround(p.x, p.y)) {
      if (this.rules.frozen) return;
      // Bouée (ou bouclier du champion) : rattrapé au bord, renvoyé vers le dernier sol sûr.
      if ((p.saves ?? 0) > 0 || p.championShield) {
        if (p.championShield) p.championShield = false;
        else p.saves -= 1;
        const back = p.safe ?? this.map.center;
        p.x = back.x;
        p.y = back.y;
        p.vx *= -0.35;
        p.vy *= -0.35;
        p.flingUntil = 0;
        this.emit('saved', { id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
        return;
      }
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

  stepTraps() {
    const t = this.time;
    for (const tr of this.traps) {
      if (tr.dead || t < tr.armAt) continue;
      for (const p of this.players) {
        if (p.state !== 'alive' || t < p.airborneUntil || t < p.slipUntil) continue;
        if (Math.hypot(p.x - tr.x, p.y - tr.y) > PLAYER.radius + tr.r) continue;
        tr.dead = true;
        p.slipUntil = t + 1.1;
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
        s: p.state,
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
          p.mass > 1.2 ? 'h' : '',
        ].join(''),
      })),
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
    state: 'alive', fallUntil: 0, respawnAt: 0,
    invulnUntil: 0, flingUntil: 0, toppleUntil: 0, pendingFlick: null, settled: true, slowUntil: 0, slipUntil: 0,
    airborneUntil: 0, bubbleUntil: 0, lastHitBy: null, lastHitAt: -99,
    moveAngle: null, speedFactor: 1, holed: false, safe: { x: pos.x, y: pos.y },
  });
  p.actions.length = 0;
  if (p.inv) InventorySystem.applyStats(p); // atouts : masse, charges, bouée…
  p.energy = p.energyMax ?? PLAYER.energyMax;
}
