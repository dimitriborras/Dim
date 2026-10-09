import { ITEMS, publicItem } from '../items.js';
import { SHOP } from '../constants.js';
import { InventorySystem } from './InventorySystem.js';

const FIXED_OFFERS = ['pistol_mk2', 'glue_launcher', 'spring_glove', 'pocket_spring', 'bubble_shield', 'banana', 'teleporter'];

// Catalogue, prix, achats et rotation. Les crédits sont vérifiés à la demande ET à la
// validation : un achat ne peut jamais rendre le solde négatif.
export class ShopSystem {
  constructor(rng) {
    this.rng = rng;
    this.offers = [];
    this.rotate(0);
  }

  rotate(round) {
    const rotating = Object.values(ITEMS).filter((d) => d.rotating).map((d) => d.id);
    const pick = rotating[(round + Math.floor(this.rng.next() * rotating.length)) % rotating.length];
    this.offers = [...FIXED_OFFERS, pick];
  }

  catalog() {
    return this.offers.map((id) => publicItem(ITEMS[id]));
  }

  check(player, itemId, slot) {
    if (!this.offers.includes(itemId)) return { ok: false, reason: 'Objet non proposé' };
    const def = ITEMS[itemId];
    if (player.credits < def.price) return { ok: false, reason: 'Crédits insuffisants' };
    return InventorySystem.canAdd(player.inv, itemId, slot);
  }

  // mode : 'safe' (achat immédiat) ou 'combat' (transaction de 1,5 s, ralenti et sans tir).
  request(player, itemId, slot, mode, time) {
    if (player.channel) return { ok: false, reason: 'Achat déjà en cours' };
    if (mode === 'closed') return { ok: false, reason: 'Boutique fermée' };
    if (mode === 'combat' && player.state !== 'alive') return { ok: false, reason: 'Indisponible pendant la réapparition' };
    const check = this.check(player, itemId, slot);
    if (!check.ok) return check;
    if (mode === 'combat') {
      player.channel = { itemId, slot, until: time + SHOP.combatTransactionTime, start: time };
      return { ok: true, pending: true };
    }
    return this.complete(player, itemId, slot);
  }

  complete(player, itemId, slot) {
    const check = this.check(player, itemId, slot);
    if (!check.ok) return check;
    player.credits -= ITEMS[itemId].price;
    InventorySystem.add(player.inv, itemId, slot);
    return { ok: true, itemId, replaces: check.replaces };
  }

  // Termine les transactions arrivées à échéance. `force` : fin de phase pendant un achat.
  update(players, time, force = false) {
    const done = [];
    for (const p of players) {
      if (!p.channel) continue;
      if (!force && time < p.channel.until) continue;
      const { itemId, slot } = p.channel;
      p.channel = null;
      done.push({ player: p, result: this.complete(p, itemId, slot) });
    }
    return done;
  }

  cancel(player) {
    player.channel = null;
  }
}
