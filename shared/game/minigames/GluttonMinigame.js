import { ARENA } from '../../maps.js';
import { groupRanking } from './MinigameRegistry.js';

const GROW_FROM = 1;
const GROW_TO = 2.3;
const GROW_TIME = 50;

// Les poches gloutonnes : le billard, sans réapparition, et les six poches qui grossissent.
// Le dernier sur le tapis gagne ; les autres sont classés dans l'ordre inverse des chutes.
export class GluttonMinigame {
  static id = 'glutton';
  static name = 'Les poches gloutonnes';
  static description = 'Les poches grossissent ! Pas de deuxième chance : le dernier sur le tapis gagne. Pousse les autres dedans.';
  static durationSeconds = 60;

  initialize(ctx) {
    this.ctx = ctx;
    // Copie de la table : ses poches vont grandir sans toucher à la carte partagée.
    this.map = { ...ARENA, pockets: ARENA.pockets.map((pk) => ({ ...pk, base: pk.r })) };
    this.out = []; // ordre des chutes
    this.scale = GROW_FROM;
    this.world = ctx.createWorld({
      map: this.map,
      rules: { items: true, respawn: false, knockbackScale: 1 },
      hooks: { onEliminated: (victim) => { if (!this.out.includes(victim.id)) this.out.push(victim.id); } },
    });
  }

  start() {
    this.startTime = this.world.time;
  }

  update() {
    const t = this.world.time - (this.startTime ?? this.world.time);
    this.scale = GROW_FROM + (GROW_TO - GROW_FROM) * Math.min(1, t / GROW_TIME);
    for (const pk of this.map.pockets) pk.r = pk.base * this.scale;
  }

  alive() {
    return this.world.players.filter((p) => p.state !== 'dead' && !this.out.includes(p.id));
  }

  isOver() {
    return this.world.players.length > 1 && this.alive().length <= 1;
  }

  finish() {
    const n = this.out.length;
    const sorted = this.ctx.players
      .map((p) => {
        const i = this.out.indexOf(p.id);
        return { id: p.id, score: p.connected === false ? -1 : i < 0 ? n + 1 : i };
      })
      .sort((a, b) => b.score - a.score);
    return { ranking: groupRanking(sorted), summary: 'Classement à l\'ordre des chutes : le dernier debout gagne.' };
  }

  hud() {
    return {
      kind: 'glutton',
      scale: Math.round(this.scale * 100) / 100,
      alive: this.alive().map((p) => p.id),
      out: this.out.slice(),
    };
  }

  botMode() {
    return 'combat';
  }

  dispose() {}
}
