// Déplacement au sol, partagé entre la simulation faisant autorité (World) et la
// prédiction locale du client : les deux calculent exactement la même chose.
import { PLAYER, HAZARD } from '../constants.js';
import { pointInRect, resolveCircleRect } from '../geometry.js';

export function normalizeInput(mx, my) {
  const l = Math.hypot(mx, my);
  return l > 1 ? { mx: mx / l, my: my / l } : { mx, my };
}

export function inHazard(map, x, y) {
  if (!map.hazardEdges) return false;
  for (const r of map.platforms) {
    if (!pointInRect(x, y, r)) continue;
    return Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y) < HAZARD.band;
  }
  return false;
}

// Accélération vers la direction voulue, ou freinage progressif après un recul.
export function steerOnGround(p, mx, my, maxSp, hazard, dt) {
  const dx = mx * maxSp;
  const dy = my * maxSp;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > maxSp + 1) {
    const k = Math.exp(-PLAYER.knockbackFriction * (hazard ? HAZARD.frictionFactor : 1) * dt);
    p.vx = p.vx * k + dx * 2.5 * dt;
    p.vy = p.vy * k + dy * 2.5 * dt;
    return;
  }
  const moving = Math.abs(mx) > 0.05 || Math.abs(my) > 0.05;
  let ax = dx - p.vx;
  let ay = dy - p.vy;
  const al = Math.hypot(ax, ay);
  const maxStep = PLAYER.accel * dt * (hazard && !moving ? 0.4 : 1);
  if (al > maxStep) { ax *= maxStep / al; ay *= maxStep / al; }
  p.vx += ax;
  p.vy += ay;
}

export function collideWalls(p, walls) {
  for (const w of walls) {
    const n = resolveCircleRect(p, PLAYER.radius, w);
    if (!n) continue;
    const vn = p.vx * n.nx + p.vy * n.ny;
    if (vn < 0) {
      const bounce = Math.hypot(p.vx, p.vy) > PLAYER.speed * 1.5 ? 1.35 : 1;
      p.vx -= vn * n.nx * bounce;
      p.vy -= vn * n.ny * bounce;
    }
  }
}
