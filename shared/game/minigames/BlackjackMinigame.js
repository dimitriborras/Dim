import { CARD_TABLE } from '../../maps.js';
import { PLAYER } from '../../constants.js';
import { groupRanking } from './MinigameRegistry.js';

const SHOTS = 4;
const DECK = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11, 11, 5, 6, 7, 8, 9, 3, 4];

// Vingt-et-un à pichenettes (le blackjack sur un tapis) : les cartes sont posées face cachée.
// Chaque pichenette qui s'arrête sur une carte la retourne (pour tout le monde) et ajoute sa
// valeur. Le plus proche de 21 sans le dépasser gagne ; au-delà, c'est perdu.
// Bouton rond : « Je reste ». Percuter un adversaire en pleine glissade change sa carte…
export class BlackjackMinigame {
  static id = 'blackjack';
  static name = 'Vingt-et-un';
  static description = 'Cartes face cachée : chaque pichenette retourne la carte où elle s\'arrête et ajoute sa valeur. Approche 21 sans le dépasser ! Bouton rond : « Je reste ».';
  static durationSeconds = 50;

  initialize(ctx) {
    this.ctx = ctx;
    this.values = ctx.rng.shuffle(DECK).slice(0, CARD_TABLE.cards.length);
    this.shown = this.values.map(() => false);
    this.state = new Map(ctx.players.map((p) => [p.id, { total: 0, cards: [], counting: false, busted: false, stood: false, lastFlick: -1 }]));
    this.world = ctx.createWorld({
      map: CARD_TABLE,
      rules: { items: false, respawn: true, respawnDelay: 1, regen: 0, knockbackScale: 1 },
      hooks: { onItem: (p) => this.stand(p) },
    });
    for (const p of this.world.players) p.energy = SHOTS * PLAYER.flickCost;
  }

  start() {}

  cardAt(x, y) {
    return CARD_TABLE.cards.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  }

  done(st) {
    return st.busted || st.stood;
  }

  stand(p) {
    const st = this.state.get(p.id);
    if (!st || this.done(st) || st.counting) return true;
    st.stood = true;
    p.energy = 0;
    this.world.emit('stand', { id: p.id, total: st.total });
    return true;
  }

  update() {
    const w = this.world;
    for (const p of w.players) {
      const st = this.state.get(p.id);
      if (!st || p.state !== 'alive') continue;
      // Nouvelle pichenette : on comptera la carte où elle s'arrête.
      if ((p.lastFlickAt ?? -1) > st.lastFlick) {
        st.lastFlick = p.lastFlickAt;
        if (!this.done(st)) st.counting = true;
      }
      if (st.counting && Math.hypot(p.vx, p.vy) < 15 && w.time - st.lastFlick > 0.2) {
        st.counting = false;
        const i = this.cardAt(p.x, p.y);
        const v = i >= 0 ? this.values[i] : 0;
        if (i >= 0) this.shown[i] = true; // la carte reste retournée pour tout le monde
        st.total += v;
        if (v) st.cards.push(v);
        w.emit('card', { id: p.id, value: v, total: st.total, x: Math.round(p.x), y: Math.round(p.y) });
        if (st.total > 21) { st.busted = true; p.energy = 0; w.emit('bust', { id: p.id, total: st.total }); }
        else if (st.total === 21) { st.stood = true; p.energy = 0; w.emit('blackjack', { id: p.id }); }
        else if (p.energy < PLAYER.flickCost) st.stood = true; // plus de pichenettes : on reste
      }
    }
  }

  isOver() {
    const active = this.world.players.filter((p) => p.connected !== false);
    return active.length > 0 && active.every((p) => this.done(this.state.get(p.id)));
  }

  finish() {
    const sorted = this.ctx.players
      .map((p) => {
        const st = this.state.get(p.id);
        return { id: p.id, score: p.connected === false || !st || st.busted ? -1 : st.total };
      })
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement au total le plus proche de 21 sans le dépasser.' };
  }

  hud() {
    const view = {};
    for (const [id, st] of this.state) view[id] = { t: st.total, b: st.busted, s: st.stood };
    return { kind: 'blackjack', cards: this.values.map((v, i) => (this.shown[i] ? v : null)), players: view };
  }

  botMode() {
    return 'blackjack';
  }

  botHint() {
    // Les bots ne voient que les cartes retournées, comme tout le monde.
    return { kind: 'blackjack', values: this.values.map((v, i) => (this.shown[i] ? v : null)), cards: CARD_TABLE.cards, state: this.state };
  }

  dispose() {}
}
