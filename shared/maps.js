// Définition des cartes. Le sol est l'union des `platforms`, moins les `holes`,
// plus les plateformes mobiles. Tout le reste est du vide : y tomber élimine.

export const ARENA = {
  id: 'arena',
  name: 'Table de la chambre',
  width: 1600,
  height: 1000,
  follow: false,
  platforms: [{ x: 120, y: 100, w: 1360, h: 800 }],
  holes: [{ x: 660, y: 430, w: 280, h: 140 }],
  movingPlatforms: [
    { x: 660, y: 440, w: 100, h: 120, axis: 'x', range: 180, period: 5, phase: 0 },
  ],
  walls: [
    { x: 300, y: 230, w: 140, h: 36 },
    { x: 1160, y: 230, w: 140, h: 36 },
    { x: 300, y: 734, w: 140, h: 36 },
    { x: 1160, y: 734, w: 140, h: 36 },
    { x: 782, y: 196, w: 36, h: 124 },
    { x: 782, y: 680, w: 36, h: 124 },
    { x: 520, y: 470, w: 36, h: 60 },
    { x: 1044, y: 470, w: 36, h: 60 },
  ],
  bumpers: [
    { x: 560, y: 320, r: 26 },
    { x: 1040, y: 320, r: 26 },
    { x: 560, y: 680, r: 26 },
    { x: 1040, y: 680, r: 26 },
  ],
  springs: [
    { x: 196, y: 470, w: 56, h: 60, dir: 0, power: 820, air: 0.9 },
    { x: 1348, y: 470, w: 56, h: 60, dir: Math.PI, power: 820, air: 0.9 },
  ],
  hazardEdges: true,
  spawns: [
    { x: 230, y: 190 }, { x: 1370, y: 810 }, { x: 1370, y: 190 }, { x: 230, y: 810 },
    { x: 640, y: 170 }, { x: 960, y: 830 }, { x: 960, y: 170 }, { x: 640, y: 830 },
  ],
  center: { x: 800, y: 380 },
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

export const MAPS = { arena: ARENA, race: RACE_TRACK };

export function movingPlatformRect(mp, time) {
  const t = (Math.sin((time / mp.period) * Math.PI * 2 + mp.phase) + 1) / 2;
  const off = t * mp.range;
  return mp.axis === 'x'
    ? { x: mp.x + off, y: mp.y, w: mp.w, h: mp.h }
    : { x: mp.x, y: mp.y + off, w: mp.w, h: mp.h };
}
