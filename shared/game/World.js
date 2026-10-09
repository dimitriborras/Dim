import { PLAYER, SHOP } from '../constants.js';
import {
  pointInRect, resolveCircleRect, circleRectOverlap, segmentRectT, segmentCircleT, angleDiff, dist,
} from '../geometry.js';
import { movingPlatformRect } from '../maps.js';
import { CombatSystem } from './CombatSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { normalizeInput, inHazard, steerOnGround, collideWalls } from './movement.js';

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
    this.effects = [];
    this.events = [];
    this.movers = map.movingPlatforms.map((mp) => movingPlatformRect(mp, time));
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  // ---------------------------------------------------------------- terrain
  isGround(x, y) {
    for (const r of this.movers) if (pointInRect(x, y, r)) return true;
    let on = false;
    for (const r of this.map.platforms) if (pointInRect(x, y, r)) { on = true; break; }
    if (!on) return false;
    for (const h of this.map.holes) if (pointInRect(x, y, h)) return false;
    return true;
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
    this.separatePlayers();
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
    if (p.state === 'dead') return;
    InventorySystem.update(p, t);

    if (p.state === 'falling') {
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.actions.length = 0;
      return;
    }

    const input = p.input;
    if (Number.isFinite(input.aim)) p.aim = input.aim;
    const moving = Math.abs(input.mx) > 0.05 || Math.abs(input.my) > 0.05;
    const { mx, my } = normalizeInput(input.mx, input.my);
    if (moving) p.moveAngle = Math.atan2(my, mx);

    const frozen = this.rules.frozen;
    const slipping = t < p.slipUntil;
    const airborne = t < p.airborneUntil;
    const busy = !!p.channel;

    // Actions ponctuelles (esquive, gadgets, consommables, sélection d'emplacement).
    const actions = p.actions.splice(0);
    if (!frozen && !slipping && !busy) {
      for (const a of actions) this.doAction(p, a, moving);
      if (input.fire) InventorySystem.fire(p, this);
    }

    // Déplacement.
    let maxSp = PLAYER.speed;
    if (t < p.slowUntil && t >= p.bubbleUntil) maxSp *= 0.5;
    if (busy) maxSp *= SHOP.combatMoveFactor;
    if (p.speedFactor) maxSp *= p.speedFactor;
    p.maxSpeed = maxSp;
    const dx = frozen ? 0 : mx * maxSp;
    const dy = frozen ? 0 : my * maxSp;
    const sp = Math.hypot(p.vx, p.vy);

    if (p.dashUntil && t >= p.dashUntil) {
      p.dashUntil = 0;
      if (sp > maxSp) { p.vx *= maxSp / sp; p.vy *= maxSp / sp; }
    } else if (p.dashUntil) {
      // pendant l'esquive : vitesse conservée
    } else if (slipping) {
      const k = Math.exp(-0.5 * dt);
      p.vx *= k; p.vy *= k;
    } else if (airborne) {
      p.vx += dx * 0.6 * dt;
      p.vy += dy * 0.6 * dt;
    } else {
      steerOnGround(p, frozen ? 0 : mx, frozen ? 0 : my, maxSp, this.inHazard(p.x, p.y), dt);
    }

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

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collideStatic(p);
  }

  doAction(p, a, moving) {
    const t = this.time;
    if (a === 'dash') {
      if (t < p.dashReadyAt || this.rules.frozen) return;
      const ang = moving ? p.moveAngle : p.aim;
      p.vx = Math.cos(ang) * PLAYER.dashSpeed;
      p.vy = Math.sin(ang) * PLAYER.dashSpeed;
      p.dashUntil = t + PLAYER.dashTime;
      p.dashReadyAt = t + PLAYER.dashCooldown;
      this.emit('dash', { id: p.id });
    } else if (a === 'gadget') {
      InventorySystem.useGadget(p, this);
    } else if (a === 'c0' || a === 'c1') {
      InventorySystem.useConsumable(p, this, a === 'c0' ? 0 : 1);
    } else if (a === 's0' || a === 's1' || a === 's2') {
      InventorySystem.pressSlot(p, this, Number(a[1]));
    }
  }

  collideStatic(p) {
    const r = PLAYER.radius;
    collideWalls(p, this.map.walls);
    if (this.time < p.airborneUntil) return;
    for (const b of this.map.bumpers) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < b.r + r && d > 0.01) {
        const nx = (p.x - b.x) / d;
        const ny = (p.y - b.y) / d;
        p.x = b.x + nx * (b.r + r);
        p.y = b.y + ny * (b.r + r);
        p.vx = nx * 720;
        p.vy = ny * 720;
        p.dashUntil = 0;
        this.emit('bump', { x: b.x, y: b.y });
      }
    }
    for (const s of this.map.springs) {
      if (pointInRect(p.x, p.y, s)) {
        p.vx = Math.cos(s.dir) * s.power;
        p.vy = Math.sin(s.dir) * s.power;
        p.airborneUntil = this.time + s.air;
        p.dashUntil = 0;
        this.emit('spring', { x: s.x + s.w / 2, y: s.y + s.h / 2, id: p.id });
      }
    }
  }

  separatePlayers() {
    const ps = this.players.filter((p) => p.state === 'alive' && this.time >= p.airborneUntil);
    const minD = PLAYER.radius * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d < 0.001) continue;
        const push = (minD - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  postPlayer(p) {
    if (p.state !== 'alive') return;
    // Bornes de la carte (le vide s'étend au-delà).
    p.x = Math.max(-200, Math.min(this.map.width + 200, p.x));
    p.y = Math.max(-200, Math.min(this.map.height + 200, p.y));
    if (this.time >= p.airborneUntil && !this.isGround(p.x, p.y)) {
      if (this.rules.frozen) return;
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
          p.dashUntil ? 'd' : '',
          p.championShield ? 'c' : '',
          p.channel ? 'p' : '',
        ].join(''),
      })),
      proj: this.projectiles.map((p) => [p.id, r(p.x), r(p.y), p.kind, p.radius]),
      traps: this.traps.map((tr) => [tr.id, r(tr.x), r(tr.y), t >= tr.armAt ? 1 : 0]),
      bombs: this.bombs.map((b) => [b.id, r(b.x), r(b.y), Math.max(0, Math.round((b.explodeAt - t) * 10) / 10)]),
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
    invulnUntil: 0, dashUntil: 0, dashReadyAt: 0, slowUntil: 0, slipUntil: 0,
    airborneUntil: 0, bubbleUntil: 0, lastHitBy: null, lastHitAt: -99,
    moveAngle: null, speedFactor: 1,
  });
  p.actions.length = 0;
}
