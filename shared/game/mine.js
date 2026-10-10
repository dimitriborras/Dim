// La Mine : un monde en 2D vu de côté, façon Terraria / Minecraft. Gravité, marche, saut,
// et surtout la pioche : on avance en creusant. Ce module est partagé : le serveur fait
// autorité, et le téléphone rejoue exactement la même physique pour sa propre figurine.
//
// La carte est générée à partir d'une graine : seuls la graine et la liste des cases creusées
// circulent sur le réseau.

import { createRng } from '../rng.js';

export const MINE = {
  cols: 84,
  rows: 34,
  cell: 32,
  gravity: 1900,
  maxFall: 900,
  walk: 175,
  jump: 480,
  w: 22, // boîte de la figurine
  h: 28,
};

export const TILE = { AIR: 0, DIRT: 1, STONE: 2, ROCK: 3, GOLD: 4 };
// Temps de creusage (s) ; la roche mère ne se creuse pas.
export const DIG_TIME = [0, 0.2, 0.45, Infinity, 0.45];

export function generateMine(seed) {
  const rng = createRng(seed);
  const { cols, rows } = MINE;
  const cells = new Uint8Array(cols * rows);
  const idx = (x, y) => y * cols + x;
  // Terre en haut, pierre en profondeur, avec des poches de l'une dans l'autre.
  const blobs = Array.from({ length: 40 }, () => ({ x: rng.range(0, cols), y: rng.range(0, rows), r: rng.range(2, 5), t: rng.next() < 0.5 ? TILE.DIRT : TILE.STONE }));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let t = y < rows * 0.35 + Math.sin(x * 0.3) * 2 ? TILE.DIRT : TILE.STONE;
      for (const b of blobs) if (Math.hypot(x - b.x, y - b.y) < b.r) t = b.t;
      if (t === TILE.STONE && rng.next() < 0.05) t = TILE.GOLD;
      cells[idx(x, y)] = t;
    }
  }
  // Roche mère : bords du monde et blocs à contourner.
  for (let i = 0; i < 26; i++) {
    const bx = rng.int(14, cols - 12);
    const by = rng.int(2, rows - 3);
    const w = rng.int(2, 6);
    const h = rng.int(1, 3);
    for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) if (x < cols && y < rows) cells[idx(x, y)] = TILE.ROCK;
  }
  for (let x = 0; x < cols; x++) { cells[idx(x, 0)] = TILE.ROCK; cells[idx(x, rows - 1)] = TILE.ROCK; }
  for (let y = 0; y < rows; y++) { cells[idx(0, y)] = TILE.ROCK; cells[idx(cols - 1, y)] = TILE.ROCK; }
  // Galeries naturelles (marches aléatoires) : des raccourcis à trouver dans le noir.
  for (let i = 0; i < 9; i++) {
    let x = rng.int(10, cols - 10);
    let y = rng.int(4, rows - 5);
    for (let k = 0; k < 45; k++) {
      if (x > 1 && x < cols - 2 && y > 1 && y < rows - 2) { cells[idx(x, y)] = TILE.AIR; cells[idx(x, y + 1)] = TILE.AIR; }
      if (rng.next() < 0.6) x += rng.next() < 0.5 ? 1 : -1;
      else y += rng.next() < 0.5 ? 1 : -1;
    }
  }
  // Salle de départ en haut à gauche, sortie au fond à droite.
  const start = { x: 4, y: 4 };
  const exit = { x: cols - 5, y: rng.int(Math.floor(rows * 0.5), rows - 5) };
  const room = (c, w, h) => {
    for (let y = c.y - h; y <= c.y + 1; y++) for (let x = c.x - w; x <= c.x + w; x++) cells[idx(x, y)] = TILE.AIR;
    for (let x = c.x - w - 1; x <= c.x + w + 1; x++) if (cells[idx(x, c.y + 2)] === TILE.AIR) cells[idx(x, c.y + 2)] = TILE.DIRT; // un sol
  };
  room(start, 3, 2);
  room(exit, 1, 1);
  return { seed, cols, rows, cells, start, exit };
}

export const cellIndex = (x, y) => y * MINE.cols + x;

export function tileAt(grid, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return TILE.ROCK;
  return grid.cells[cellIndex(cx, cy)];
}

const solid = (grid, cx, cy) => tileAt(grid, cx, cy) !== TILE.AIR;

// La boîte (centre x, y) touche-t-elle une case pleine ?
function boxHits(grid, x, y) {
  const C = MINE.cell;
  const x0 = Math.floor((x - MINE.w / 2) / C);
  const x1 = Math.floor((x + MINE.w / 2 - 0.01) / C);
  const y0 = Math.floor((y - MINE.h / 2) / C);
  const y1 = Math.floor((y + MINE.h / 2 - 0.01) / C);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (solid(grid, cx, cy)) return true;
  return false;
}

export function newMiner(grid) {
  const C = MINE.cell;
  return { x: (grid.start.x + 0.5) * C, y: (grid.start.y + 0.5) * C, vx: 0, vy: 0, ground: false, facing: 1, dig: null };
}

// Case à creuser selon la direction demandée (ou null).
function digTarget(grid, b, mx, my) {
  const C = MINE.cell;
  const cx = Math.floor(b.x / C);
  const footY = Math.floor((b.y + MINE.h / 2 - 1) / C);
  const headY = Math.floor((b.y - MINE.h / 2) / C);
  if (my > 0.55 && b.ground) {
    const below = Math.floor((b.y + MINE.h / 2 + 2) / C);
    return solid(grid, cx, below) ? { x: cx, y: below } : null;
  }
  if (my < -0.55) {
    // La pioche atteint jusqu'à deux cases au-dessus de la tête (on creuse en sautant).
    for (let k = 1; k <= 2; k++) {
      const above = Math.floor((b.y - MINE.h / 2 - 2) / C) - (k - 1);
      if (solid(grid, cx, above)) return { x: cx, y: above };
    }
  }
  if (Math.abs(mx) > 0.35) {
    const side = Math.floor((b.x + Math.sign(mx) * (MINE.w / 2 + 2)) / C);
    // D'abord la case à hauteur des pieds, puis celle de la tête ; la roche mère est ignorée
    // (creuser au-dessus d'elle permet d'y monter grâce au pas automatique).
    const diggable = (y) => solid(grid, side, y) && tileAt(grid, side, y) !== TILE.ROCK;
    if (diggable(footY)) return { x: side, y: footY };
    if (diggable(headY)) return { x: side, y: headY };
    // Marche de roche mère devant soi : on dégage la case au-dessus d'elle pour l'escalader.
    if (solid(grid, side, footY) && diggable(footY - 1) && b.ground) return { x: side, y: footY - 1 };
    if (solid(grid, side, footY)) return { x: side, y: footY };
  }
  return null;
}

// Un pas de simulation. `onDig(cx, cy)` est appelé quand une case est creusée.
export function stepMiner(grid, b, input, dt, onDig) {
  const C = MINE.cell;
  const mx = Math.abs(input.mx) > 0.3 ? Math.max(-1, Math.min(1, input.mx)) : 0;
  const my = input.my ?? 0;
  if (mx) b.facing = Math.sign(mx);
  b.vx = mx * MINE.walk;
  // Vers le haut ou le bas sans direction horizontale : on se recentre sur sa colonne, pour
  // tomber dans un puits d'une case ou creuser droit (sinon la boîte reste à cheval).
  if (!mx && Math.abs(my) > 0.55) {
    const center = (Math.floor(b.x / C) + 0.5) * C;
    b.vx = Math.max(-MINE.walk, Math.min(MINE.walk, (center - b.x) * 12));
  }
  if (my < -0.55 && b.ground) { b.vy = -MINE.jump; b.ground = false; }
  b.vy = Math.min(MINE.maxFall, b.vy + MINE.gravity * dt);

  // Horizontal, avec montée automatique d'une marche (pas besoin de sauter sur une case).
  const nx = b.x + b.vx * dt;
  if (!boxHits(grid, nx, b.y)) b.x = nx;
  else if (b.ground && !boxHits(grid, nx, b.y - C) && !boxHits(grid, b.x, b.y - C)) { b.x = nx; b.y -= C; }
  else {
    // Collé contre la paroi : la pioche sait ainsi quelle case est juste devant.
    b.x = b.vx > 0 ? Math.floor((nx + MINE.w / 2) / C) * C - MINE.w / 2 - 0.001 : Math.ceil((nx - MINE.w / 2) / C) * C + MINE.w / 2 + 0.001;
    if (boxHits(grid, b.x, b.y)) b.x = nx - b.vx * dt; // sécurité : on ne s'enfonce jamais
    b.vx = 0;
  }

  // Vertical.
  const ny = b.y + b.vy * dt;
  if (!boxHits(grid, b.x, ny)) {
    b.y = ny;
    b.ground = false;
  } else {
    if (b.vy > 0) {
      b.ground = true;
      b.y = Math.floor((ny + MINE.h / 2) / C) * C - MINE.h / 2;
    } else {
      b.y = Math.ceil((ny - MINE.h / 2) / C) * C + MINE.h / 2;
    }
    b.vy = 0;
  }
  if (!b.ground && boxHits(grid, b.x, b.y + 1)) b.ground = true;

  // Pioche : on creuse la case visée tant qu'on pousse dans sa direction.
  const t = digTarget(grid, b, mx, my);
  if (!t) { b.dig = null; return; }
  if (!b.dig || b.dig.x !== t.x || b.dig.y !== t.y) b.dig = { x: t.x, y: t.y, prog: 0 };
  const need = DIG_TIME[tileAt(grid, t.x, t.y)];
  b.dig.prog += dt;
  if (b.dig.prog >= need) {
    grid.cells[cellIndex(t.x, t.y)] = TILE.AIR;
    b.dig = null;
    onDig?.(t.x, t.y);
  }
}

// Distance (en cases) jusqu'à la sortie : sert au classement et à la flèche.
export function exitDistance(grid, b) {
  const C = MINE.cell;
  return Math.hypot(b.x / C - (grid.exit.x + 0.5), b.y / C - (grid.exit.y + 0.5));
}
