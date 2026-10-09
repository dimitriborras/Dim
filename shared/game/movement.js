// Physique de palet, partagée entre la simulation faisant autorité (World) et la
// prédiction locale du client : les deux calculent exactement la même chose.
// On ne marche pas : on se lance (pichenette), on glisse, on rebondit, on s'arrête.
import { PLAYER, HAZARD } from '../constants.js';
import { pointInRect, resolveCircleRect } from '../geometry.js';

export function inHazard(map, x, y) {
  if (!map.hazardEdges) return false;
  for (const r of map.platforms) {
    if (!pointInRect(x, y, r)) continue;
    return Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y) < HAZARD.band;
  }
  return false;
}

// Vitesse de départ d'une pichenette selon sa puissance (0 à 1).
export function flickSpeed(power, factor = 1) {
  const p = Math.max(0, Math.min(1, power));
  return (PLAYER.flickMinSpeed + (PLAYER.flickMaxSpeed - PLAYER.flickMinSpeed) * p) * factor;
}

export const flingDuration = (power) => PLAYER.flingTime * (1 + Math.max(0, Math.min(1, power)));

// Un pas de glissade. `st` : { fling, toppled, airborne, slowed } (booléens).
export function glide(p, dt, map, st = {}) {
  let k;
  if (st.airborne) k = 0.3;
  else if (st.fling) k = PLAYER.flingFriction;
  else {
    k = PLAYER.glideFriction * (st.toppled ? 1.4 : 1) * (st.slowed ? 1.8 : 1);
    if (inHazard(map, p.x, p.y)) k *= HAZARD.frictionFactor;
  }
  const decay = Math.exp(-k * dt);
  p.vx *= decay;
  p.vy *= decay;
  if (!st.fling && !st.airborne && Math.hypot(p.vx, p.vy) < PLAYER.stopSpeed) {
    p.vx = 0;
    p.vy = 0;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

// Rebond sur les briques (comme une bande de billard). Retourne true en cas de choc.
export function collideWalls(p, walls) {
  let hit = false;
  for (const w of walls) {
    const n = resolveCircleRect(p, PLAYER.radius, w);
    if (!n) continue;
    const vn = p.vx * n.nx + p.vy * n.ny;
    if (vn < 0) {
      p.vx -= (1 + PLAYER.wallRestitution) * vn * n.nx;
      p.vy -= (1 + PLAYER.wallRestitution) * vn * n.ny;
      hit = true;
    }
  }
  return hit;
}

// Rebond sur les balles en caoutchouc. Retourne la balle touchée ou null.
export function collideBumpers(p, bumpers) {
  for (const b of bumpers) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    const R = b.r + PLAYER.radius;
    if (d >= R || d < 0.01) continue;
    const nx = dx / d;
    const ny = dy / d;
    p.x = b.x + nx * R;
    p.y = b.y + ny * R;
    const vn = p.vx * nx + p.vy * ny;
    // Renvoi au moins à la vitesse du bumper, dans la direction réfléchie.
    p.vx -= 2 * Math.min(0, vn) * nx;
    p.vy -= 2 * Math.min(0, vn) * ny;
    const out = p.vx * nx + p.vy * ny;
    if (out < PLAYER.bumperSpeed) {
      p.vx += (PLAYER.bumperSpeed - out) * nx;
      p.vy += (PLAYER.bumperSpeed - out) * ny;
    }
    return b;
  }
  return null;
}

// Distance parcourue en ligne droite (sans obstacle) selon la puissance, pour les bots
// et l'aperçu de trajectoire. Table calculée une fois avec la vraie physique.
const REACH = (() => {
  const table = [];
  const map = { hazardEdges: false, platforms: [] };
  for (let i = 0; i <= 20; i++) {
    const power = i / 20;
    const b = { x: 0, y: 0, vx: flickSpeed(power), vy: 0 };
    let t = 0;
    const fl = flingDuration(power);
    while ((b.vx > 0 || t < fl) && t < 6) {
      glide(b, 1 / 30, map, { fling: t < fl });
      t += 1 / 30;
    }
    table.push(b.x);
  }
  return table;
})();

export function flickReach(power) {
  const f = Math.max(0, Math.min(1, power)) * 20;
  const i = Math.floor(f);
  if (i >= 20) return REACH[20];
  return REACH[i] + (REACH[i + 1] - REACH[i]) * (f - i);
}

export function powerForDistance(d) {
  if (d <= REACH[0]) return 0;
  for (let i = 1; i <= 20; i++) {
    if (REACH[i] >= d) return (i - 1 + (d - REACH[i - 1]) / (REACH[i] - REACH[i - 1])) / 20;
  }
  return 1;
}

// Simule une pichenette complète (glissade, rebonds sur briques et balles) jusqu'à l'arrêt.
// Sert à l'aperçu de trajectoire côté client et à la décision des bots.
// `isGround(x, y)` décide si l'on est encore sur la table ; `stopAt(x, y)` peut interrompre
// la simulation (ex. ressort qui fait sauter un trou). Retourne les points et l'issue.
export function simulateFlick(start, angle, power, map, { isGround, stopAt, factor = 1, hop = false, maxTime = 3, every = 2 } = {}) {
  const v = hop ? PLAYER.hopSpeed * factor : flickSpeed(power, factor);
  const b = { x: start.x, y: start.y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v };
  const fl = hop ? 0 : flingDuration(power);
  const dt = 1 / 30;
  const points = [{ x: b.x, y: b.y }];
  const bounces = [];
  let outcome = 'stop';
  for (let i = 0, t = 0; t < maxTime; i++, t += dt) {
    glide(b, dt, map, { fling: t < fl });
    if (collideWalls(b, map.walls) || collideBumpers(b, map.bumpers)) bounces.push({ x: b.x, y: b.y, i: points.length });
    if (i % every === 0) points.push({ x: b.x, y: b.y });
    if (stopAt?.(b.x, b.y)) { outcome = 'special'; break; }
    if (isGround && !isGround(b.x, b.y)) { outcome = 'fall'; break; }
    if (b.vx === 0 && b.vy === 0 && t >= fl) break;
  }
  points.push({ x: b.x, y: b.y });
  return { points, bounces, end: { x: b.x, y: b.y }, outcome };
}
