// Registre des objets. Chaque objet remplit UNE fonction identifiable
// (dégâts, déplacement, ralentir, protéger, tromper, contrôler une zone).
// Ajouter un objet = ajouter une définition ici avec son `use`, sans toucher à la boutique.
//
// Champs communs :
//   id, name, icon, category ('weapon' | 'gadget' | 'consumable' | 'upgrade'),
//   role, price, description, counters, cooldown, ammo {max, reload}, rotating,
//   use(ctx) -> boolean   ctx = { world, player, state, def }
//
// Le comportement s'exécute uniquement dans la simulation faisant autorité.

const pistolStats = (level) =>
  level >= 2
    ? { damage: 25, cooldown: 0.33, ammo: 10 }
    : { damage: 20, cooldown: 0.4, ammo: 8 };

export const ITEMS = {
  pistol: {
    id: 'pistol',
    name: 'Pistolet à impulsion',
    icon: '🔫',
    category: 'weapon',
    role: 'dégâts',
    price: 0,
    starter: true,
    description: 'Projectiles visibles, 20 dégâts, léger recul. Fiable mais jamais mortel en un tir.',
    counters: 'Esquive, couvert, bouclier.',
    cooldown: (state) => pistolStats(state.level).cooldown,
    ammo: { max: (state) => pistolStats(state.level).ammo, reload: 1.3 },
    use({ world, player, state }) {
      world.spawnProjectile(player, {
        kind: 'pulse',
        speed: 950,
        radius: 6,
        damage: pistolStats(state.level).damage,
        knockback: 170,
        life: 0.9,
      });
      return true;
    },
  },

  pistol_mk2: {
    id: 'pistol_mk2',
    name: 'Pistolet Mk II',
    icon: '⚡',
    category: 'upgrade',
    upgrades: 'pistol',
    role: 'dégâts',
    price: 90,
    description: 'Amélioration (1 niveau max) : 25 dégâts, cadence 0,33 s, chargeur de 10.',
    counters: 'Les mêmes que le pistolet : il reste esquivable.',
  },

  glue_launcher: {
    id: 'glue_launcher',
    name: 'Lance-colle',
    icon: '🧴',
    category: 'weapon',
    role: 'ralentir',
    price: 80,
    description: 'Ralentit de moitié pendant 1,6 s. Dégâts faibles : sert à préparer une attaque.',
    counters: 'Esquive, bouclier, distance.',
    cooldown: 0.7,
    ammo: { max: 5, reload: 2 },
    use({ world, player }) {
      world.spawnProjectile(player, {
        kind: 'glue',
        speed: 680,
        radius: 9,
        damage: 6,
        knockback: 40,
        slow: 1.6,
        life: 1.0,
      });
      return true;
    },
  },

  spring_glove: {
    id: 'spring_glove',
    name: 'Gant à ressort',
    icon: '🥊',
    category: 'weapon',
    role: 'déplacer',
    price: 70,
    description: 'Projette violemment une cible proche. Redoutable près d\'un bord.',
    counters: 'Distance, esquive, placement.',
    cooldown: 1.1,
    use({ world, player }) {
      world.meleeCone(player, { range: 78, arc: 1.25, damage: 10, knockback: 980 });
      return true;
    },
  },

  bubble_shield: {
    id: 'bubble_shield',
    name: 'Bulle-bouclier',
    icon: '🫧',
    category: 'gadget',
    role: 'protéger',
    price: 85,
    description: 'Bloque dégâts, recul et ralentissements pendant 1,2 s. Recharge 9 s.',
    counters: 'Attendre la fin de la bulle, la contourner.',
    cooldown: 9,
    use({ world, player }) {
      player.bubbleUntil = world.time + 1.2;
      world.emit('bubble', { id: player.id });
      return true;
    },
  },

  pocket_spring: {
    id: 'pocket_spring',
    name: 'Ressort de poche',
    icon: '🌀',
    category: 'gadget',
    role: 'déplacement',
    price: 75,
    description: 'Bond de 0,7 s : passe au-dessus du vide et des pièges. Recharge 7 s.',
    counters: 'Viser le point d\'atterrissage.',
    cooldown: 7,
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
    name: 'Peau de banane',
    icon: '🍌',
    category: 'consumable',
    role: 'contrôler une zone',
    price: 30,
    description: 'Piège au sol qui fait glisser. Attention : il peut piéger son propriétaire.',
    counters: 'Regarder le sol, faire un détour.',
    use({ world, player }) {
      return world.placeTrap(player, 'banana');
    },
  },

  teleporter: {
    id: 'teleporter',
    name: 'Téléporteur jetable',
    icon: '🌟',
    category: 'consumable',
    role: 'déplacement',
    price: 40,
    description: 'Repositionnement jusqu\'à 260 unités dans la direction visée, sur une zone sûre. Ne traverse pas les murs.',
    counters: 'Anticipation, contrôle de zone.',
    use({ world, player }) {
      return world.teleport(player, 260);
    },
  },

  confetti_bomb: {
    id: 'confetti_bomb',
    name: 'Bombe à confettis',
    icon: '🎉',
    category: 'consumable',
    role: 'contrôler une zone',
    price: 45,
    rotating: true,
    description: 'Lancée devant soi, explose après un court délai : souffle puissant, 25 dégâts. Touche aussi son lanceur.',
    counters: 'Le délai d\'explosion : s\'éloigner.',
    use({ world, player }) {
      world.throwBomb(player);
      return true;
    },
  },

  decoy: {
    id: 'decoy',
    name: 'Leurre figurine',
    icon: '🪆',
    category: 'consumable',
    role: 'tromper',
    price: 35,
    rotating: true,
    description: 'Une copie de votre figurine part dans votre direction pendant 3,5 s et encaisse les tirs.',
    counters: 'Observer qui tire vraiment.',
    use({ world, player }) {
      world.spawnDecoy(player);
      return true;
    },
  },
};

export const getItem = (id) => ITEMS[id] ?? null;

export const evalStat = (stat, state) => (typeof stat === 'function' ? stat(state) : stat);

// Vue sérialisable du catalogue, envoyée aux clients.
export function publicItem(def) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    category: def.category,
    role: def.role,
    price: def.price,
    description: def.description,
    counters: def.counters,
  };
}
