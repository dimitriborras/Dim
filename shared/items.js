// Pièces détachées vendues par le Distributeur. Plus d'armes : tout passe par la pichenette.
//
//   - Atouts (`perk`) : modifient la figurine-palet (masse, charges, élan…). 3 au plus,
//     le 4e remplace le plus ancien. Effet permanent pour le reste de la partie.
//   - Gadgets (`gadget`) : un seul à la fois, sur le bouton rond. Quelques charges,
//     rechargées au début de chaque phase.
//
// Champs : id, name, icon, category, price, description, tip,
//   perk : mods { mass, energyMax, regen, power, punch, saves }
//   gadget : charges, cooldown, use({ world, player }) -> boolean
// Le comportement s'exécute uniquement dans la simulation faisant autorité.

export const MAX_PERKS = 3;

export const ITEMS = {
  // ------------------------------------------------------------ atouts
  lead: {
    id: 'lead',
    name: 'Lest de plomb',
    icon: '⚓',
    category: 'perk',
    price: 70,
    description: 'Figurine 60 % plus lourde : dure à déplacer, et ses chocs envoient plus loin.',
    tip: 'Idéal pour tenir le centre.',
    mods: { mass: 1.6 },
  },
  battery: {
    id: 'battery',
    name: 'Pile de rechange',
    icon: '🔋',
    category: 'perk',
    price: 60,
    description: '+1 charge de pichenette (4 au lieu de 3).',
    tip: 'Enchaîner quatre coups de suite.',
    mods: { energyMax: 1 },
  },
  turbo: {
    id: 'turbo',
    name: 'Recharge turbo',
    icon: '⚡',
    category: 'perk',
    price: 60,
    description: 'Les charges reviennent 40 % plus vite.',
    tip: 'Moins d\'attente entre deux coups.',
    mods: { regen: 1.4 },
  },
  elastic: {
    id: 'elastic',
    name: 'Élastique renforcé',
    icon: '🏹',
    category: 'perk',
    price: 70,
    description: 'Pichenettes 12 % plus rapides : plus de portée, plus d\'impact.',
    tip: 'Attention aux poches : ça glisse loin.',
    mods: { power: 1.12 },
  },
  spikes: {
    id: 'spikes',
    name: 'Coque à pointes',
    icon: '💢',
    category: 'perk',
    price: 80,
    description: 'Tes chocs projettent 30 % plus fort (sans te rendre plus lourd).',
    tip: 'Le roi des « Carton ! ».',
    mods: { punch: 1.3 },
  },
  buoy: {
    id: 'buoy',
    name: 'Bouée',
    icon: '🛟',
    category: 'perk',
    price: 70,
    description: 'Une fois par phase, la bouée te rattrape au bord d\'une poche ou du vide.',
    tip: 'Une seconde chance, une seule.',
    mods: { saves: 1 },
  },

  // ------------------------------------------------------------ gadgets
  firecracker: {
    id: 'firecracker',
    name: 'Pétard',
    icon: '💥',
    category: 'gadget',
    price: 60,
    charges: 2,
    cooldown: 1,
    description: 'Onde de choc : repousse violemment tout le monde autour de toi.',
    tip: 'Entouré près d\'une poche ? Boum.',
    use({ world, player }) {
      world.shockwave(player, 175, 640);
      return true;
    },
  },
  anchor: {
    id: 'anchor',
    name: 'Bulle d\'ancrage',
    icon: '🫧',
    category: 'gadget',
    price: 50,
    charges: 2,
    cooldown: 1,
    description: '1,4 s inébranlable : les chocs rebondissent sur toi.',
    tip: 'À déclencher quand on te fonce dessus.',
    use({ world, player }) {
      player.bubbleUntil = world.time + 1.4;
      world.emit('bubble', { id: player.id });
      return true;
    },
  },
  magnet: {
    id: 'magnet',
    name: 'Aimant',
    icon: '🧲',
    category: 'gadget',
    price: 60,
    charges: 2,
    cooldown: 1,
    description: 'Attire vers toi les figurines proches… et les boules.',
    tip: 'Ramène-les à portée de pichenette.',
    use({ world, player }) {
      world.magnet(player, 300, 420);
      return true;
    },
  },
  spring: {
    id: 'spring',
    name: 'Ressort de poche',
    icon: '🌀',
    category: 'gadget',
    price: 50,
    charges: 2,
    cooldown: 1,
    description: 'Bond de 0,7 s dans ta direction : passe au-dessus des poches et des trous.',
    tip: 'La sortie de secours.',
    use({ world, player }) {
      const a = player.moveAngle ?? player.aim;
      const sp = Math.max(Math.hypot(player.vx, player.vy), 420);
      player.vx = Math.cos(a) * sp;
      player.vy = Math.sin(a) * sp;
      player.airborneUntil = world.time + 0.7;
      world.emit('jump', { id: player.id });
      return true;
    },
  },
  banana: {
    id: 'banana',
    name: 'Peaux de banane',
    icon: '🍌',
    category: 'gadget',
    price: 40,
    charges: 3,
    cooldown: 0.6,
    description: 'Pose une peau de banane : qui marche dessus part en glissade.',
    tip: 'Devant une poche, c\'est cruel.',
    use({ world, player }) {
      return world.placeTrap(player, 'banana');
    },
  },
  confetti: {
    id: 'confetti',
    name: 'Bombe à confettis',
    icon: '🎉',
    category: 'gadget',
    price: 55,
    charges: 2,
    cooldown: 1.2,
    description: 'Lancée devant toi, elle explose après 1,2 s et souffle tout autour (toi compris).',
    tip: 'Lance-la dans un groupe.',
    use({ world, player }) {
      world.throwBomb(player);
      return true;
    },
  },
  teleporter: {
    id: 'teleporter',
    name: 'Téléporteur',
    icon: '🌟',
    category: 'gadget',
    price: 50,
    charges: 1,
    cooldown: 1,
    description: 'Saut instantané jusqu\'à 260 plus loin, sur un sol sûr.',
    tip: 'Ne traverse pas les murs.',
    use({ world, player }) {
      return world.teleport(player, 260);
    },
  },
};

export const getItem = (id) => ITEMS[id] ?? null;
export const PERKS = Object.values(ITEMS).filter((d) => d.category === 'perk').map((d) => d.id);
export const GADGETS = Object.values(ITEMS).filter((d) => d.category === 'gadget').map((d) => d.id);

// Vue sérialisable du catalogue, envoyée aux clients.
export function publicItem(def) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    category: def.category,
    price: def.price,
    charges: def.charges ?? null,
    description: def.description,
    tip: def.tip,
  };
}
