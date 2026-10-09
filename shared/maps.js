// Définition des cartes. Le sol est l'union des `platforms`, moins les `holes`,
// plus les plateformes mobiles. Tout le reste est du vide : y tomber élimine.

// Table de billard : tapis entouré de bandes en bois (qui renvoient), six poches.
// Plus de vide sur les bords : on ne tombe que dans les poches.
const FELT = { x: 120, y: 110, w: 1360, h: 780 };
const CORNER_R = 56;
const SIDE_R = 46;
const RAIL = 40;
const midX = FELT.x + FELT.w / 2;

export const ARENA = {
  id: 'arena',
  name: 'Le billard',
  theme: 'pool',
  width: 1600,
  height: 1000,
  follow: false,
  felt: FELT,
  platforms: [FELT],
  holes: [],
  pockets: [
    { x: FELT.x, y: FELT.y, r: CORNER_R },
    { x: midX, y: FELT.y - 10, r: SIDE_R },
    { x: FELT.x + FELT.w, y: FELT.y, r: CORNER_R },
    { x: FELT.x, y: FELT.y + FELT.h, r: CORNER_R },
    { x: midX, y: FELT.y + FELT.h + 10, r: SIDE_R },
    { x: FELT.x + FELT.w, y: FELT.y + FELT.h, r: CORNER_R },
  ],
  movingPlatforms: [],
  // Bandes (style « rail ») ouvertes devant chaque poche, puis deux cubes de craie pour se couvrir.
  walls: [
    { x: FELT.x + CORNER_R, y: FELT.y - RAIL, w: midX - SIDE_R - FELT.x - CORNER_R, h: RAIL, style: 'rail' },
    { x: midX + SIDE_R, y: FELT.y - RAIL, w: FELT.x + FELT.w - CORNER_R - midX - SIDE_R, h: RAIL, style: 'rail' },
    { x: FELT.x + CORNER_R, y: FELT.y + FELT.h, w: midX - SIDE_R - FELT.x - CORNER_R, h: RAIL, style: 'rail' },
    { x: midX + SIDE_R, y: FELT.y + FELT.h, w: FELT.x + FELT.w - CORNER_R - midX - SIDE_R, h: RAIL, style: 'rail' },
    { x: FELT.x - RAIL, y: FELT.y + CORNER_R, w: RAIL, h: FELT.h - 2 * CORNER_R, style: 'rail' },
    { x: FELT.x + FELT.w, y: FELT.y + CORNER_R, w: RAIL, h: FELT.h - 2 * CORNER_R, style: 'rail' },
    { x: 400, y: 477, w: 46, h: 46, style: 'chalk' },
    { x: 1154, y: 477, w: 46, h: 46, style: 'chalk' },
  ],
  bumpers: [],
  // Boules de billard mobiles, rangées en triangle au fond de la table (carambolages !).
  balls: [
    { x: 1040, y: 500, num: 1 },
    { x: 1076, y: 479, num: 2 }, { x: 1076, y: 521, num: 3 },
    { x: 1112, y: 458, num: 4 }, { x: 1112, y: 500, num: 8 }, { x: 1112, y: 542, num: 5 },
  ],
  springs: [],
  hazardEdges: false,
  spawns: [
    { x: 300, y: 300 }, { x: 1300, y: 700 }, { x: 1300, y: 300 }, { x: 300, y: 700 },
    { x: 620, y: 200 }, { x: 980, y: 800 }, { x: 980, y: 200 }, { x: 620, y: 800 },
  ],
  center: { x: 800, y: 500 },
};

export const RACE_TRACK = {
  id: 'race',
  name: 'Circuit du tapis',
  width: 3300,
  height: 700,
  follow: true,
  platforms: [
    { x: 0, y: 100, w: 900, h: 500 },
    { x: 900, y: 310, w: 120, h: 80 },
    { x: 1020, y: 100, w: 700, h: 500 },
    { x: 1880, y: 100, w: 720, h: 500 },
    { x: 2600, y: 160, w: 110, h: 60 },
    { x: 2600, y: 480, w: 110, h: 60 },
    { x: 2710, y: 100, w: 590, h: 500 },
  ],
  holes: [{ x: 2160, y: 270, w: 110, h: 160 }],
  movingPlatforms: [
    { x: 1720, y: 110, w: 160, h: 110, axis: 'y', range: 370, period: 4.5, phase: 0 },
  ],
  walls: [
    { x: 340, y: 100, w: 40, h: 300 },
    { x: 600, y: 300, w: 40, h: 300 },
    { x: 1200, y: 260, w: 60, h: 180 },
    { x: 2000, y: 100, w: 40, h: 170 },
    { x: 2000, y: 430, w: 40, h: 170 },
    { x: 2900, y: 250, w: 40, h: 200 },
  ],
  bumpers: [
    { x: 1420, y: 220, r: 30 },
    { x: 1420, y: 480, r: 30 },
    { x: 1560, y: 350, r: 30 },
    { x: 2420, y: 200, r: 28 },
    { x: 2420, y: 500, r: 28 },
    { x: 2520, y: 350, r: 28 },
  ],
  springs: [
    { x: 1640, y: 130, w: 56, h: 60, dir: 0, power: 820, air: 0.6 },
    { x: 1640, y: 510, w: 56, h: 60, dir: 0, power: 820, air: 0.6 },
  ],
  hazardEdges: false,
  checkpoints: [0, 1040, 1900, 2730],
  // Itinéraire indicatif utilisé par les bots.
  waypoints: [
    { x: 200, y: 480 }, { x: 390, y: 480 }, { x: 620, y: 210 }, { x: 860, y: 350 },
    { x: 1070, y: 350 }, { x: 1240, y: 180 }, { x: 1420, y: 130 }, { x: 1668, y: 160 },
    { x: 1975, y: 350 }, { x: 2090, y: 350 }, { x: 2215, y: 215 }, { x: 2420, y: 350 },
    { x: 2570, y: 190 }, { x: 2660, y: 190 }, { x: 2800, y: 190 }, { x: 3250, y: 190 },
  ],
  finishX: 3150,
  spawns: [
    { x: 70, y: 160 }, { x: 70, y: 230 }, { x: 70, y: 300 }, { x: 70, y: 370 },
    { x: 70, y: 440 }, { x: 70, y: 510 }, { x: 140, y: 200 }, { x: 140, y: 470 },
  ],
};

// Petite table des micro-jeux physiques : tout le monde est proche, ça pousse vite.
export const MICRO_TABLE = {
  id: 'micro',
  name: 'Coin du bureau',
  width: 900,
  height: 700,
  follow: false,
  compact: true, // petite table : toujours cadrée en entier, la caméra ne suit pas
  platforms: [{ x: 150, y: 130, w: 600, h: 440 }],
  holes: [],
  movingPlatforms: [],
  walls: [],
  bumpers: [],
  springs: [],
  hazardEdges: true,
  spawns: [
    { x: 250, y: 220 }, { x: 650, y: 480 }, { x: 650, y: 220 }, { x: 250, y: 480 },
    { x: 450, y: 200 }, { x: 450, y: 500 }, { x: 230, y: 350 }, { x: 670, y: 350 },
  ],
  center: { x: 450, y: 350 },
};

// Green de mini-golf (micro-jeu « MINI-GOLF ! ») : petit billard fermé, un seul trou,
// un cube de craie au milieu pour obliger à jouer la bande.
const GREEN = { x: 150, y: 150, w: 600, h: 400 };
export const MICRO_GOLF = {
  id: 'golf',
  name: 'Le green',
  theme: 'pool',
  width: 900,
  height: 700,
  follow: false,
  compact: true,
  felt: GREEN,
  platforms: [GREEN],
  holes: [],
  pockets: [{ x: 655, y: 350, r: 36 }],
  movingPlatforms: [],
  walls: [
    { x: GREEN.x - 40, y: GREEN.y - 40, w: GREEN.w + 80, h: 40, style: 'rail' },
    { x: GREEN.x - 40, y: GREEN.y + GREEN.h, w: GREEN.w + 80, h: 40, style: 'rail' },
    { x: GREEN.x - 40, y: GREEN.y, w: 40, h: GREEN.h, style: 'rail' },
    { x: GREEN.x + GREEN.w, y: GREEN.y, w: 40, h: GREEN.h, style: 'rail' },
    { x: 452, y: 318, w: 46, h: 64, style: 'chalk' },
  ],
  bumpers: [],
  springs: [],
  hazardEdges: false,
  spawns: [
    { x: 215, y: 350 }, { x: 215, y: 270 }, { x: 215, y: 430 }, { x: 275, y: 310 },
    { x: 275, y: 390 }, { x: 215, y: 195 }, { x: 215, y: 505 }, { x: 275, y: 230 },
  ],
  center: { x: 655, y: 350 },
};

export const MAPS = { arena: ARENA, race: RACE_TRACK, micro: MICRO_TABLE, golf: MICRO_GOLF };

// La poche dans laquelle se trouve ce point, ou null.
export function pocketAt(map, x, y) {
  for (const pk of map.pockets ?? []) if (Math.hypot(x - pk.x, y - pk.y) < pk.r) return pk;
  return null;
}

// Sol sous ce point ? Plateformes mobiles, puis plateformes moins trous et poches.
export function isGroundAt(map, movers, x, y) {
  const inR = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  for (const r of movers) if (inR(r)) return true;
  if (!map.platforms.some(inR)) return false;
  if (map.holes.some(inR)) return false;
  return !pocketAt(map, x, y);
}

export function movingPlatformRect(mp, time) {
  const t = (Math.sin((time / mp.period) * Math.PI * 2 + mp.phase) + 1) / 2;
  const off = t * mp.range;
  return mp.axis === 'x'
    ? { x: mp.x + off, y: mp.y, w: mp.w, h: mp.h }
    : { x: mp.x, y: mp.y + off, w: mp.w, h: mp.h };
}
