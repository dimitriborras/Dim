import { ITEMS, getItem, MAX_PERKS } from '../items.js';
import { PLAYER } from '../constants.js';

// Équipement d'une figurine : jusqu'à 3 atouts permanents et un gadget à charges.
export const InventorySystem = {
  create() {
    return { perks: [], gadget: null };
  },

  // Début de phase : charges du gadget et bouées rechargées.
  refresh(inv) {
    if (inv.gadget) {
      inv.gadget.charges = ITEMS[inv.gadget.id].charges;
      inv.gadget.cooldownUntil = 0;
    }
  },

  owns(inv, id) {
    return inv.perks.includes(id) || inv.gadget?.id === id;
  },

  canAdd(inv, itemId) {
    const def = getItem(itemId);
    if (!def) return { ok: false, reason: 'Objet inconnu' };
    if (this.owns(inv, itemId)) return { ok: false, reason: 'Déjà équipé' };
    if (def.category === 'perk' && inv.perks.length >= MAX_PERKS) return { ok: true, replaces: inv.perks[0] };
    if (def.category === 'gadget' && inv.gadget) return { ok: true, replaces: inv.gadget.id };
    return { ok: true };
  },

  add(inv, itemId) {
    const check = this.canAdd(inv, itemId);
    if (!check.ok) return check;
    const def = ITEMS[itemId];
    if (def.category === 'perk') {
      if (inv.perks.length >= MAX_PERKS) inv.perks.shift();
      inv.perks.push(itemId);
    } else {
      inv.gadget = { id: itemId, charges: def.charges, cooldownUntil: 0 };
    }
    return check;
  },

  // Caractéristiques de la figurine d'après ses atouts (appliquées à chaque phase).
  stats(inv) {
    const s = { mass: 1, energyMax: PLAYER.energyMax, regen: 1, power: 1, punch: 1, saves: 0 };
    for (const id of inv.perks) {
      const m = ITEMS[id].mods;
      if (m.mass) s.mass *= m.mass;
      if (m.energyMax) s.energyMax += m.energyMax;
      if (m.regen) s.regen *= m.regen;
      if (m.power) s.power *= m.power;
      if (m.punch) s.punch *= m.punch;
      if (m.saves) s.saves += m.saves;
    }
    return s;
  },

  applyStats(p) {
    const s = this.stats(p.inv);
    p.mass = s.mass;
    p.energyMax = s.energyMax;
    p.regenMul = s.regen;
    p.powerMul = s.power;
    p.punch = s.punch;
    p.saves = s.saves;
  },

  // Bouton rond : utilise une charge du gadget.
  useItem(player, world) {
    const g = player.inv.gadget;
    if (!g || !world.rules.items || g.charges <= 0 || world.time < g.cooldownUntil) return false;
    const def = ITEMS[g.id];
    if (!def.use({ world, player, state: g, def })) return false; // échec (ex. téléportation impossible) : charge conservée
    g.charges -= 1;
    g.cooldownUntil = world.time + def.cooldown;
    return true;
  },

  // Vue envoyée au propriétaire.
  view(inv, time) {
    const g = inv.gadget;
    return {
      perks: inv.perks.slice(),
      gadget: g ? { id: g.id, charges: g.charges, max: ITEMS[g.id].charges, cooldown: Math.max(0, g.cooldownUntil - time) } : null,
    };
  },
};
