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
  // Physique de palet : on ne marche pas, on se lance (pichenette) puis on glisse.
  glideFriction: 1.9, // freinage en glissade (par seconde)
  flingFriction: 0.6, // freinage juste après la pichenette : on file
  stopSpeed: 12, // sous cette vitesse, la figurine s'immobilise
  settledSpeed: 45, // sous cette vitesse, elle est « posée » et tire automatiquement
  flickMinSpeed: 300,
  flickMaxSpeed: 900,
  flingTime: 0.15, // + 0,15 s à pleine puissance
  hopSpeed: 230, // petite tape : petit bond pour se placer
  energyMax: 3, // charges de pichenette
  energyRegen: 1.25, // charges regagnées par seconde
  flickCost: 1,
  hopCost: 0.35,
  wallRestitution: 0.75, // rebond sur les briques, comme au billard
  restitution: 0.88, // chocs entre figurines : plastique dur
  bumperSpeed: 650,
  // Figurine lestée : seul un très gros choc la renverse.
  toppleSpeed: 720,
  toppleTime: 0.6,
  autoFireRange: 620,
  slamImpulse: 450, // choc assez violent pour rapporter un « Carton ! »
  respawnDelay: 3,
  spawnInvuln: 1,
  fallTime: 0.45,
  killCreditWindow: 4, // secondes : une chute après un coup crédite l'attaquant
};

export const HAZARD = {
  band: 56, // largeur de la bande glissante près des bords
  frictionFactor: 0.7, // on glisse un peu plus loin près des bords
  knockbackFactor: 1.35,
};

export const PHASES = {
  intro: 4,
  rewards: 8, // résultats + boutique sûre
  combat: 35,
  lastShop: 7,
  finalResults: 15,
};

// Boules de billard mobiles.
export const BALL = {
  friction: 1.25, // elles roulent plus loin que les figurines
  restitution: 0.94, // boule contre boule : presque parfaitement élastique
  playerRestitution: 0.85,
  mass: 0.8, // un peu plus légères qu'une figurine
  respawn: 4, // secondes avant qu'une boule empochée revienne sur sa mouche
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
