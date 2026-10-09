// Outils géométriques simples : cercles, rectangles alignés et rayons.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const len = (x, y) => Math.hypot(x, y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function circleRectOverlap(cx, cy, radius, r) {
  const nx = clamp(cx, r.x, r.x + r.w);
  const ny = clamp(cy, r.y, r.y + r.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < radius * radius;
}

// Repousse un cercle hors d'un rectangle. Retourne la normale de contact ou null.
export function resolveCircleRect(body, radius, r) {
  const nx = clamp(body.x, r.x, r.x + r.w);
  const ny = clamp(body.y, r.y, r.y + r.h);
  let dx = body.x - nx;
  let dy = body.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    dx /= d;
    dy /= d;
    body.x = nx + dx * radius;
    body.y = ny + dy * radius;
    return { nx: dx, ny: dy };
  }
  // Centre à l'intérieur : sortie par le côté le plus proche.
  const left = body.x - r.x;
  const right = r.x + r.w - body.x;
  const top = body.y - r.y;
  const bottom = r.y + r.h - body.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) { body.x = r.x - radius; return { nx: -1, ny: 0 }; }
  if (m === right) { body.x = r.x + r.w + radius; return { nx: 1, ny: 0 }; }
  if (m === top) { body.y = r.y - radius; return { nx: 0, ny: -1 }; }
  body.y = r.y + r.h + radius;
  return { nx: 0, ny: 1 };
}

// Intersection segment / rectangle (méthode des slabs). Retourne t dans [0,1] ou null.
export function segmentRectT(x0, y0, x1, y1, r, pad = 0) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = 0;
  let tmax = 1;
  const minX = r.x - pad, maxX = r.x + r.w + pad;
  const minY = r.y - pad, maxY = r.y + r.h + pad;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    let t1 = (minX - x0) / dx;
    let t2 = (maxX - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    let t1 = (minY - y0) / dy;
    let t2 = (maxY - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Intersection segment / cercle. Retourne t dans [0,1] ou null.
export function segmentCircleT(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
