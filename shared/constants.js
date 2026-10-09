// Valeurs de départ du prototype. Ce sont des points de départ à tester,
// pas un équilibrage définitif : tout le réglage est centralisé ici.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 2; // 15 instantanés par seconde
export const INTERP_DELAY_MS = 110;

export const MIN_PLAYERS = 2; // 4 à 8 recommandés, 2 suffisent pour tester
export const MAX_PLAYERS = 8;

export const PLAYER = {
  radius: 20,
  maxHp: 100,
  speed: 250,
  accel: 2400,
  friction: 10,
  knockbackFriction: 3.2,
  // Pichenette : on tire l'élastique puis on relâche. `power` va de 0 à 1.
  flickMinSpeed: 380,
  flickMaxSpeed: 1020,
  flickTime: 0.2, // + 0,3 s à pleine puissance : durée pendant laquelle on file sans contrôle
  flickCooldown: 2.4,
  // Figurine lestée : au-delà de cette vitesse subie, elle se renverse puis se redresse.
  toppleSpeed: 560,
  toppleTime: 0.75,
  restitution: 0.88, // plastique dur : les chocs entre figurines rebondissent
  respawnDelay: 3,
  spawnInvuln: 1,
  fallTime: 0.45,
  killCreditWindow: 4, // secondes : une chute après un coup crédite l'attaquant
};

export const HAZARD = {
  band: 56, // largeur de la bande glissante près des bords
  frictionFactor: 0.35,
  knockbackFactor: 1.35,
};

export const PHASES = {
  intro: 4,
  rewards: 8, // résultats + boutique sûre
  combat: 35,
  lastShop: 7,
  finalResults: 15,
};

export const SHOP = {
  combatTransactionTime: 1.5,
  combatMoveFactor: 0.45,
};

export const REWARDS = {
  minigame: [
    { credits: 100, points: 10 },
    { credits: 75, points: 7 },
    { credits: 55, points: 5 },
  ],
  participation: { credits: 35, points: 3 },
  finale: [
    { credits: 0, points: 20 },
    { credits: 0, points: 14 },
    { credits: 0, points: 10 },
  ],
  finaleParticipation: { credits: 0, points: 5 },
  // Points pour la 1re, 2e, 3e... élimination de la même victime pendant un combat.
  killPoints: [3, 1, 0],
  killCredits: 10,
  championKillPoints: 2,
  championKillCredits: 30,
  survivePoints: 1,
};

export const CONTRACT = {
  rewardCredits: 40,
  surviveRewardCredits: 30,
  damageTarget: 60,
  bountyHits: 2,
};

export const ROUND_OPTIONS = [3, 5, 8];
export const DEFAULT_ROUNDS = 8;

export const PLAYER_COLORS = [
  '#ff4d4d', '#3d8bff', '#ffd23d', '#3ddc84',
  '#c45cff', '#ff8f3d', '#3de0e0', '#ff6fb5',
];
