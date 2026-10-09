import { PLAYER, HAZARD } from '../constants.js';
import { dist } from '../geometry.js';

// Santé, impacts, éliminations et réapparitions. Seule la simulation
// faisant autorité appelle ces fonctions : le client ne déclare jamais un impact.
export const CombatSystem = {
  isTargetable(p, time) {
    return p.state === 'alive' && time >= p.invulnUntil;
  },

  // Retourne true si l'impact a été absorbé par la cible (projectile consommé dans tous les cas).
  hit(world, attacker, victim, { damage = 0, knockback = 0, dirx = 0, diry = 0, slow = 0, cause = 'hit' }) {
    const t = world.time;
    if (victim.state !== 'alive') return false;
    if (t < victim.invulnUntil) return true;
    if (t < victim.bubbleUntil) {
      world.emit('blocked', { id: victim.id, x: victim.x, y: victim.y });
      return true;
    }
    const harmful = world.rules.damage && damage > 0;
    if (victim.championShield && harmful) {
      victim.championShield = false;
      world.emit('shieldBreak', { id: victim.id, x: victim.x, y: victim.y });
      return true;
    }

    const kb = knockback * world.rules.knockbackScale * (world.inHazard(victim.x, victim.y) ? HAZARD.knockbackFactor : 1);
    victim.vx += dirx * kb;
    victim.vy += diry * kb;
    // Figurine lestée : un coup assez fort la renverse.
    if (Math.hypot(victim.vx, victim.vy) > PLAYER.toppleSpeed) world.topple(victim);
    if (slow > 0) victim.slowUntil = Math.max(victim.slowUntil, t + slow);
    if (attacker && attacker.id !== victim.id) {
      victim.lastHitBy = attacker.id;
      victim.lastHitAt = t;
    }
    world.hooks.onHit?.(attacker, victim, cause);

    if (!harmful && attacker && attacker.id !== victim.id) world.emit('push', { id: victim.id, by: attacker.id, x: victim.x, y: victim.y });
    if (harmful) {
      victim.hp = Math.max(0, victim.hp - damage);
      // `by` et la position de l'attaquant servent au client : marqueur de touche et direction des dégâts.
      world.emit('dmg', { id: victim.id, amount: damage, x: victim.x, y: victim.y, by: attacker?.id ?? null, ax: attacker ? Math.round(attacker.x) : null, ay: attacker ? Math.round(attacker.y) : null });
      if (attacker && attacker.id !== victim.id) world.hooks.onDamage?.(attacker, victim, damage);
      if (victim.hp <= 0) this.eliminate(world, victim, attacker ? attacker.id : null, 'ko');
    }
    return true;
  },

  startFall(world, p) {
    if (p.state !== 'alive') return;
    p.state = 'falling';
    p.fallUntil = world.time + PLAYER.fallTime;
    p.channel = null;
    world.emit('fall', { id: p.id, x: p.x, y: p.y });
  },

  eliminate(world, victim, killerId, cause) {
    if (victim.state === 'dead') return;
    const t = world.time;
    if (killerId == null && victim.lastHitBy != null && t - victim.lastHitAt <= PLAYER.killCreditWindow) {
      killerId = victim.lastHitBy;
    }
    if (killerId === victim.id) killerId = null;
    victim.state = 'dead';
    victim.hp = 0;
    victim.channel = null;
    victim.respawnAt = t + world.rules.respawnDelay;
    victim.vx = victim.vy = 0;
    victim.lastHitBy = null;
    world.emit('elim', { victim: victim.id, killer: killerId, cause, x: victim.x, y: victim.y });
    world.hooks.onEliminated?.(victim, killerId, cause);
  },

  respawn(world, p) {
    const pos = world.hooks.spawnPoint?.(p) ?? this.safestSpawn(world, p);
    p.x = pos.x;
    p.y = pos.y;
    p.vx = p.vy = 0;
    p.hp = PLAYER.maxHp;
    p.state = 'alive';
    p.invulnUntil = world.time + world.rules.respawnInvuln;
    p.slowUntil = p.slipUntil = p.airborneUntil = p.bubbleUntil = p.flingUntil = p.toppleUntil = 0;
    world.emit('respawn', { id: p.id, x: p.x, y: p.y });
  },

  safestSpawn(world, p) {
    let best = null;
    let bestScore = -Infinity;
    for (const s of world.map.spawns) {
      let minD = 5000;
      for (const o of world.players) {
        if (o === p || o.state !== 'alive') continue;
        minD = Math.min(minD, dist(s, o));
      }
      const score = minD + world.rng.next() * 40;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  },

  update(world) {
    const t = world.time;
    for (const p of world.players) {
      if (p.state === 'falling' && t >= p.fallUntil) this.eliminate(world, p, null, 'fall');
      else if (p.state === 'dead' && world.rules.respawn && t >= p.respawnAt) this.respawn(world, p);
    }
  },
};
