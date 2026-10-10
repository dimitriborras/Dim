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

// Piste du Palet (inspirée du crokinole et du curling) : on lance depuis la gauche,
// la cible est à droite, quatre plots protègent le cœur. Les bords donnent sur le vide.
const LANE = { x: 100, y: 160, w: 1240, h: 380 };
const TARGET = { x: 1080, y: 350, rings: [45, 95, 150] };
export const PALET_LANE = {
  id: 'palet',
  name: 'La piste du Palet',
  width: 1440,
  height: 700,
  follow: false,
  platforms: [LANE],
  holes: [],
  movingPlatforms: [],
  walls: [
    { x: TARGET.x - 132, y: TARGET.y - 12, w: 24, h: 24, style: 'chalk' },
    { x: TARGET.x + 108, y: TARGET.y - 12, w: 24, h: 24, style: 'chalk' },
    { x: TARGET.x - 12, y: TARGET.y - 132, w: 24, h: 24, style: 'chalk' },
    { x: TARGET.x - 12, y: TARGET.y + 108, w: 24, h: 24, style: 'chalk' },
  ],
  bumpers: [],
  springs: [],
  hazardEdges: true,
  target: TARGET,
  spawns: [
    { x: 190, y: 230 }, { x: 190, y: 290 }, { x: 190, y: 350 }, { x: 190, y: 410 },
    { x: 190, y: 470 }, { x: 250, y: 260 }, { x: 250, y: 350 }, { x: 250, y: 440 },
  ],
  center: { x: TARGET.x, y: TARGET.y },
};

// Les îlots des duels physiques : quatre petits plateaux séparés par le vide, un par duel.
const ISLE = 280;
const ISLES = [[100, 100], [480, 100], [100, 480], [480, 480]].map(([x, y]) => ({ x, y, w: ISLE, h: ISLE }));
export const DUEL_ISLANDS = {
  id: 'duel',
  name: 'Les îlots',
  width: 860,
  height: 860,
  follow: false,
  platforms: ISLES,
  holes: [],
  movingPlatforms: [],
  walls: [],
  bumpers: [],
  springs: [],
  hazardEdges: true,
  targets: ISLES.map((r) => ({ x: r.x + ISLE / 2, y: r.y + ISLE / 2, rings: [35, 80] })),
  // Trois places par îlot : face à face, et une troisième pour le trio éventuel.
  islandSpawns: ISLES.map((r) => [
    { x: r.x + 50, y: r.y + ISLE / 2 }, { x: r.x + ISLE - 50, y: r.y + ISLE / 2 }, { x: r.x + ISLE / 2, y: r.y + ISLE - 50 },
  ]),
  spawns: ISLES.flatMap((r) => [{ x: r.x + 50, y: r.y + ISLE / 2 }, { x: r.x + ISLE - 50, y: r.y + ISLE / 2 }]),
  center: { x: 430, y: 430 },
};

// Table fermée par des bandes (aucun vide) : utilisée par la patate chaude et le vingt-et-un.
function closedTable({ id, name, felt, obstacles = [], ...extra }) {
  const R = 40;
  return {
    id,
    name,
    theme: 'pool',
    width: felt.x * 2 + felt.w,
    height: felt.y * 2 + felt.h,
    follow: false,
    felt,
    platforms: [felt],
    holes: [],
    pockets: [],
    movingPlatforms: [],
    walls: [
      { x: felt.x - R, y: felt.y - R, w: felt.w + 2 * R, h: R, style: 'rail' },
      { x: felt.x - R, y: felt.y + felt.h, w: felt.w + 2 * R, h: R, style: 'rail' },
      { x: felt.x - R, y: felt.y, w: R, h: felt.h, style: 'rail' },
      { x: felt.x + felt.w, y: felt.y, w: R, h: felt.h, style: 'rail' },
      ...obstacles,
    ],
    bumpers: [],
    springs: [],
    hazardEdges: false,
    center: { x: felt.x + felt.w / 2, y: felt.y + felt.h / 2 },
    ...extra,
  };
}

// La patate chaude : une caisse fermée, deux cubes de craie pour tourner autour.
export const BOMB_BOX = closedTable({
  id: 'bomb',
  name: 'La caisse',
  felt: { x: 120, y: 120, w: 900, h: 560 },
  obstacles: [{ x: 380, y: 375, w: 50, h: 50, style: 'chalk' }, { x: 710, y: 375, w: 50, h: 50, style: 'chalk' }],
  spawns: [
    { x: 250, y: 250 }, { x: 890, y: 550 }, { x: 890, y: 250 }, { x: 250, y: 550 },
    { x: 570, y: 220 }, { x: 570, y: 580 }, { x: 300, y: 400 }, { x: 840, y: 400 },
  ],
});

// Le carrelage : 11 × 7 dalles qui tombent après qu'une figurine s'y est posée (Hex-A-Gone).
const TILE = 100;
const COLS = 11;
const ROWS = 7;
export const TILE_FLOOR = {
  id: 'tiles',
  name: 'Le carrelage',
  width: COLS * TILE + 200,
  height: ROWS * TILE + 240,
  follow: false,
  tiles: true,
  platforms: Array.from({ length: COLS * ROWS }, (_, i) => ({ x: 100 + (i % COLS) * TILE, y: 120 + Math.floor(i / COLS) * TILE, w: TILE, h: TILE })),
  holes: [],
  movingPlatforms: [],
  walls: [],
  bumpers: [],
  springs: [],
  hazardEdges: false,
  spawns: [
    { x: 250, y: 270 }, { x: 1050, y: 670 }, { x: 1050, y: 270 }, { x: 250, y: 670 },
    { x: 650, y: 270 }, { x: 650, y: 670 }, { x: 450, y: 470 }, { x: 850, y: 470 },
  ],
  center: { x: 650, y: 470 },
};

// Le vingt-et-un : 15 cartes posées sur le tapis ; la zone de départ est à gauche.
export const CARD_TABLE = closedTable({
  id: 'cards',
  name: 'La table de jeu',
  felt: { x: 100, y: 100, w: 1020, h: 600 },
  cards: Array.from({ length: 15 }, (_, i) => ({ x: 320 + (i % 5) * 158, y: 125 + Math.floor(i / 5) * 190, w: 128, h: 170 })),
  spawns: [
    { x: 170, y: 160 }, { x: 170, y: 250 }, { x: 170, y: 340 }, { x: 170, y: 430 },
    { x: 170, y: 520 }, { x: 170, y: 610 }, { x: 240, y: 300 }, { x: 240, y: 500 },
  ],
});

// Le mémory géant : 16 cartes (8 paires) en 4 × 4 sur le tapis, départ à gauche.
export const MEMORY_TABLE = closedTable({
  id: 'memory',
  name: 'Le mémory géant',
  felt: { x: 100, y: 100, w: 1000, h: 660 },
  cards: Array.from({ length: 16 }, (_, i) => ({ x: 360 + (i % 4) * 180, y: 125 + Math.floor(i / 4) * 160, w: 140, h: 135 })),
  spawns: [
    { x: 170, y: 180 }, { x: 170, y: 280 }, { x: 170, y: 380 }, { x: 170, y: 480 },
    { x: 170, y: 580 }, { x: 170, y: 680 }, { x: 250, y: 330 }, { x: 250, y: 530 },
  ],
});

// Le roi de la colline : le billard, avec une zone qui se déplace (voir KingMinigame).
export const KING_SPOTS = [
  { x: 800, y: 500 }, { x: 420, y: 330 }, { x: 1180, y: 670 }, { x: 1180, y: 330 }, { x: 420, y: 670 }, { x: 800, y: 270 }, { x: 800, y: 730 },
];

// La maison du déménagement (R.E.P.O.) : trois pièces reliées par des portes, le camion à droite.
const HOUSE = { x: 100, y: 100, w: 1500, h: 860 };
const DOOR = 170;
export const MOVERS_HOUSE = closedTable({
  id: 'house',
  name: 'La maison',
  felt: HOUSE,
  theme: 'house',
  obstacles: [
    // Cloisons avec une porte au milieu.
    { x: 600, y: HOUSE.y, w: 30, h: (HOUSE.h - DOOR) / 2 },
    { x: 600, y: HOUSE.y + (HOUSE.h + DOOR) / 2, w: 30, h: (HOUSE.h - DOOR) / 2 },
    { x: 1100, y: HOUSE.y, w: 30, h: 220 },
    { x: 1100, y: HOUSE.y + 220 + DOOR + 60, w: 30, h: HOUSE.h - 220 - DOOR - 60 },
    // Quelques meubles fixes.
    { x: 250, y: 300, w: 140, h: 60, style: 'chalk' },
    { x: 820, y: 640, w: 120, h: 60, style: 'chalk' },
  ],
  truck: { x: 1380, y: 380, w: 200, h: 300 },
  waypoints: [{ x: 615, y: 530 }, { x: 1115, y: 435 }],
  balls: [
    { x: 200, y: 180, kind: '🏺', value: 120, r: 20, mass: 0.7 },
    { x: 470, y: 820, kind: '📺', value: 200, r: 26, mass: 1.4 },
    { x: 330, y: 560, kind: '🎻', value: 150, r: 22, mass: 0.8 },
    { x: 170, y: 870, kind: '🪴', value: 60, r: 22, mass: 0.9 },
    { x: 480, y: 200, kind: '🧸', value: 40, r: 20, mass: 0.5 },
    { x: 760, y: 200, kind: '⏰', value: 70, r: 18, mass: 0.6 },
    { x: 960, y: 300, kind: '🖼️', value: 90, r: 22, mass: 0.7 },
    { x: 720, y: 860, kind: '🎹', value: 320, r: 36, mass: 3.2 },
    { x: 980, y: 820, kind: '💎', value: 250, r: 16, mass: 0.4 },
    { x: 860, y: 460, kind: '🐈‍⬛', value: 0, r: 26, mass: 2.4, cat: true },
  ],
  spawns: [
    { x: 1250, y: 200 }, { x: 1250, y: 300 }, { x: 1250, y: 760 }, { x: 1250, y: 860 },
    { x: 1450, y: 200 }, { x: 1450, y: 860 }, { x: 1200, y: 500 }, { x: 1200, y: 620 },
  ],
});

// Le vaisseau de l'imposteur (Among Us) : quatre salles autour d'un couloir, six postes de tâches.
const SHIP = { x: 100, y: 100, w: 1400, h: 900 };
export const IMPOSTOR_SHIP = closedTable({
  id: 'ship',
  name: 'Le vaisseau',
  felt: SHIP,
  theme: 'ship',
  obstacles: [
    // Cloisons horizontale et verticale, percées de portes.
    { x: 100, y: 520, w: 260, h: 30 }, { x: 520, y: 520, w: 380, h: 30 }, { x: 1060, y: 520, w: 440, h: 30 },
    { x: 780, y: 100, w: 30, h: 250 }, { x: 780, y: 690, w: 30, h: 310 },
    { x: 380, y: 250, w: 60, h: 60, style: 'chalk' }, { x: 1150, y: 780, w: 60, h: 60, style: 'chalk' },
  ],
  // Portes, pour que les bots passent d'une salle à l'autre.
  waypoints: [{ x: 440, y: 535 }, { x: 980, y: 535 }, { x: 795, y: 440 }, { x: 795, y: 600 }],
  stations: [
    { x: 220, y: 200, icon: '🔧', name: 'Réparer les fils' },
    { x: 640, y: 420, icon: '⛽', name: 'Remplir le réservoir' },
    { x: 1350, y: 220, icon: '📡', name: 'Aligner l\'antenne' },
    { x: 260, y: 880, icon: '🧪', name: 'Analyser l\'échantillon' },
    { x: 960, y: 880, icon: '🗑️', name: 'Vider les déchets' },
    { x: 1380, y: 660, icon: '🛰️', name: 'Lancer le diagnostic' },
  ],
  spawns: [
    { x: 760, y: 590 }, { x: 840, y: 590 }, { x: 700, y: 450 }, { x: 900, y: 450 },
    { x: 700, y: 640 }, { x: 900, y: 640 }, { x: 800, y: 420 }, { x: 800, y: 660 },
  ],
});

// Support technique de la Mine : la vraie carte est la grille de shared/game/mine.js.
// Ce plateau fixe sert seulement à porter les figurines dans la simulation commune.
export const MINE_STAGE = {
  id: 'mine',
  name: 'La Mine',
  width: 800,
  height: 600,
  follow: false,
  platforms: [{ x: 0, y: 0, w: 800, h: 600 }],
  holes: [],
  movingPlatforms: [],
  walls: [],
  bumpers: [],
  springs: [],
  hazardEdges: false,
  spawns: Array.from({ length: 8 }, (_, i) => ({ x: 100 + (i % 4) * 150, y: 200 + Math.floor(i / 4) * 200 })),
  center: { x: 400, y: 300 },
};

export const MAPS = {
  arena: ARENA, race: RACE_TRACK, micro: MICRO_TABLE, golf: MICRO_GOLF, palet: PALET_LANE, duel: DUEL_ISLANDS,
  bomb: BOMB_BOX, tiles: TILE_FLOOR, cards: CARD_TABLE, memory: MEMORY_TABLE, mine: MINE_STAGE, house: MOVERS_HOUSE, ship: IMPOSTOR_SHIP,
};

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
