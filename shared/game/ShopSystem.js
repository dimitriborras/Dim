import { ITEMS, PERKS, GADGETS } from '../items.js';
import { InventorySystem } from './InventorySystem.js';

export const REROLL_COST = 15;
const HAND = 3;

// Le Distributeur : chaque joueur tire sa propre main de 3 capsules (au moins un atout et un
// gadget qu'il n'a pas), achète ce qu'il peut payer, ou relance la main. Les joueurs de la
// moitié basse du classement ont une relance gratuite : un coup de pouce discret, pas un cadeau.
// Les crédits sont revérifiés à chaque achat : le solde ne peut jamais devenir négatif.
export class ShopSystem {
  constructor(rng) {
    this.rng = rng;
  }

  draw(player) {
    const inv = player.inv;
    const freshPerks = this.rng.shuffle(PERKS.filter((id) => !inv.perks.includes(id)));
    const freshGadgets = this.rng.shuffle(GADGETS.filter((id) => inv.gadget?.id !== id));
    const hand = [freshPerks.shift(), freshGadgets.shift()].filter(Boolean);
    const rest = this.rng.shuffle([...freshPerks, ...freshGadgets]);
    while (hand.length < HAND && rest.length) hand.push(rest.shift());
    return this.rng.shuffle(hand);
  }

  // Ouverture du distributeur pour toute la table. `ranked` : joueurs du premier au dernier.
  open(ranked) {
    const half = Math.floor(ranked.length / 2);
    ranked.forEach((p, i) => {
      p.offers = this.draw(p);
      p.freeRerolls = i >= ranked.length - half && half > 0 ? 1 : 0;
    });
  }

  close(players) {
    for (const p of players) p.offers = [];
  }

  buy(player, itemId, open) {
    if (!open) return { ok: false, reason: 'Distributeur fermé' };
    if (!player.offers?.includes(itemId)) return { ok: false, reason: 'Capsule indisponible' };
    const def = ITEMS[itemId];
    if (player.credits < def.price) return { ok: false, reason: 'Crédits insuffisants' };
    const res = InventorySystem.add(player.inv, itemId);
    if (!res.ok) return res;
    player.credits -= def.price;
    player.offers = player.offers.filter((id) => id !== itemId);
    InventorySystem.applyStats(player);
    return { ok: true, itemId, replaces: res.replaces ?? null };
  }

  reroll(player, open) {
    if (!open) return { ok: false, reason: 'Distributeur fermé' };
    const free = (player.freeRerolls ?? 0) > 0;
    if (!free && player.credits < REROLL_COST) return { ok: false, reason: 'Crédits insuffisants' };
    if (free) player.freeRerolls -= 1;
    else player.credits -= REROLL_COST;
    player.offers = this.draw(player);
    return { ok: true, reroll: true };
  }
}
