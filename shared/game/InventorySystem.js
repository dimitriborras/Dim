import { ITEMS, getItem, evalStat } from '../items.js';

// Trois emplacements permanents (le n°1 contient toujours le pistolet)
// et deux emplacements de consommables qui disparaissent à l'utilisation.
export const PERMANENT_SLOTS = 3;
export const CONSUMABLE_SLOTS = 2;

function makeState(id) {
  const state = { id, level: 1, ammo: 0, cooldownUntil: 0, reloadUntil: 0 };
  const def = ITEMS[id];
  if (def.ammo) state.ammo = evalStat(def.ammo.max, state);
  return state;
}

export const InventorySystem = {
  create() {
    return {
      slots: [makeState('pistol'), null, null],
      active: 0,
      consumables: [null, null],
    };
  },

  // Remise à zéro des munitions et recharges au début d'une phase.
  refresh(inv) {
    for (const s of inv.slots) {
      if (!s) continue;
      const def = ITEMS[s.id];
      s.cooldownUntil = 0;
      s.reloadUntil = 0;
      if (def.ammo) s.ammo = evalStat(def.ammo.max, s);
    }
  },

  owns(inv, id) {
    return inv.slots.some((s) => s && s.id === id);
  },

  // Vérifie qu'un objet peut être ajouté. `slot` (1 ou 2) choisit l'emplacement
  // permanent à remplacer quand l'inventaire est plein.
  canAdd(inv, itemId, slot) {
    const def = getItem(itemId);
    if (!def || def.starter) return { ok: false, reason: 'Objet inconnu' };
    if (def.category === 'upgrade') {
      const target = inv.slots.find((s) => s && s.id === def.upgrades);
      if (!target) return { ok: false, reason: 'Arme requise absente' };
      if (target.level >= 2) return { ok: false, reason: 'Déjà amélioré (niveau max)' };
      return { ok: true };
    }
    if (def.category === 'consumable') {
      const free = inv.consumables.findIndex((c) => c === null);
      if (free < 0) return { ok: false, reason: 'Emplacements de consommables pleins' };
      return { ok: true, slot: free };
    }
    if (this.owns(inv, itemId)) return { ok: false, reason: 'Déjà équipé' };
    const free = inv.slots.findIndex((s, i) => i > 0 && s === null);
    if (free > 0) return { ok: true, slot: free };
    if (slot === 1 || slot === 2) return { ok: true, slot, replaces: inv.slots[slot].id };
    return { ok: false, reason: 'Emplacements pleins : choisissez celui à remplacer' };
  },

  add(inv, itemId, slot) {
    const check = this.canAdd(inv, itemId, slot);
    if (!check.ok) return check;
    const def = ITEMS[itemId];
    if (def.category === 'upgrade') {
      const target = inv.slots.find((s) => s && s.id === def.upgrades);
      target.level = 2;
      target.ammo = evalStat(ITEMS[target.id].ammo.max, target);
      target.reloadUntil = 0;
    } else if (def.category === 'consumable') {
      inv.consumables[check.slot] = { id: itemId };
    } else {
      if (inv.active === check.slot) inv.active = 0;
      inv.slots[check.slot] = makeState(itemId);
    }
    return check;
  },

  update(player, time) {
    for (const s of player.inv.slots) {
      if (s && s.reloadUntil && time >= s.reloadUntil) {
        s.reloadUntil = 0;
        s.ammo = evalStat(ITEMS[s.id].ammo.max, s);
      }
    }
  },

  // Appui sur 1/2/3 : sélectionne une arme, ou déclenche directement un gadget.
  pressSlot(player, world, index) {
    const s = player.inv.slots[index];
    if (!s) return false;
    const def = ITEMS[s.id];
    if (def.category === 'weapon') {
      if (world.rules.weapons === 'pistol' && s.id !== 'pistol') return false;
      player.inv.active = index;
      return true;
    }
    return this.useState(player, world, s);
  },

  isWeaponSlot(inv, index) {
    const s = inv.slots[index];
    return !!s && ITEMS[s.id].category === 'weapon';
  },

  // Molette, gâchettes de manette : arme suivante ou précédente parmi celles autorisées.
  cycleWeapon(player, world, dir) {
    const slots = player.inv.slots;
    for (let k = 1; k <= slots.length; k++) {
      const i = (player.inv.active + dir * k + slots.length * 3) % slots.length;
      const s = slots[i];
      if (!s || ITEMS[s.id].category !== 'weapon') continue;
      if (world.rules.weapons === 'pistol' && s.id !== 'pistol') continue;
      player.inv.active = i;
      return true;
    }
    return false;
  },

  fire(player, world) {
    const s = player.inv.slots[player.inv.active] ?? player.inv.slots[0];
    return this.useState(player, world, s);
  },

  // Clic droit / E : premier gadget équipé.
  useGadget(player, world) {
    const s = player.inv.slots.find((x) => x && ITEMS[x.id].category === 'gadget');
    return s ? this.useState(player, world, s) : false;
  },

  useState(player, world, s) {
    const def = ITEMS[s.id];
    if (def.category === 'gadget' && !world.rules.items) return false;
    if (def.category === 'weapon' && world.rules.weapons === 'pistol' && s.id !== 'pistol') return false;
    if (world.rules.weapons === 'none') return false;
    const t = world.time;
    if (t < s.cooldownUntil || s.reloadUntil) return false;
    if (def.ammo && s.ammo <= 0) return false;
    const used = def.use({ world, player, state: s, def });
    if (!used) return false;
    s.cooldownUntil = t + evalStat(def.cooldown ?? 0.2, s);
    if (def.ammo) {
      s.ammo -= 1;
      if (s.ammo <= 0) s.reloadUntil = t + def.ammo.reload;
    }
    return true;
  },

  // Un consommable n'est retiré qu'après un usage effectif : impossible de l'utiliser deux fois.
  useConsumable(player, world, index) {
    if (!world.rules.items) return false;
    const c = player.inv.consumables[index];
    if (!c) return false;
    const def = ITEMS[c.id];
    player.inv.consumables[index] = null;
    const used = def.use({ world, player, state: c, def });
    if (!used) player.inv.consumables[index] = c; // échec (ex. téléportation impossible) : objet conservé
    return used;
  },

  // Vue envoyée au propriétaire.
  view(inv, time) {
    return {
      active: inv.active,
      slots: inv.slots.map((s) => {
        if (!s) return null;
        const def = ITEMS[s.id];
        const cd = evalStat(def.cooldown ?? 0, s);
        return {
          id: s.id,
          level: s.level,
          ammo: def.ammo ? s.ammo : null,
          maxAmmo: def.ammo ? evalStat(def.ammo.max, s) : null,
          reloading: s.reloadUntil ? Math.max(0, s.reloadUntil - time) : 0,
          cooldown: Math.max(0, s.cooldownUntil - time),
          cooldownTotal: cd,
        };
      }),
      consumables: inv.consumables.map((c) => (c ? c.id : null)),
    };
  },
};
