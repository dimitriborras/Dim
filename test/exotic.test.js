import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { CARD_TABLE } from '../shared/maps.js';

function roomWith(id, bots = 4, seed = 3) {
  const room = new GameRoom({ code: 'EX', seed });
  room.join({ send() {} }, { name: 'H' });
  for (let i = 0; i < bots; i++) room.addBot();
  room.match.start(1);
  room.match.plan = [id];
  room.match.enterIntro();
  while (room.match.phase === 'intro') room.tick(DT);
  return room;
}

test('Patate chaude : la bombe passe au contact, explose, le dernier debout gagne', () => {
  const room = roomWith('bomb', 4);
  const mg = room.match.minigame;
  while (!mg.holder) room.tick(DT);
  const h = mg.holder;
  const other = room.match.participants().find((p) => p !== h);
  other.bot && (other.bot.nextAt = 1e9);
  h.bot && (h.bot.nextAt = 1e9);
  mg.passLock = 0;
  Object.assign(other, { x: h.x + 30, y: h.y, vx: 0, vy: 0 });
  room.tick(DT);
  assert.equal(mg.holder, other, 'la bombe a changé de main');
  if (other.bot) other.bot.nextAt = 0;
  if (h.bot) h.bot.nextAt = 0;
  let passes = 0;
  room.match.world.events.length = 0;
  while (room.match.phase === 'minigame') {
    room.tick(DT);
  }
  assert.ok(mg.out.length >= 3, `explosions (${mg.out.length})`);
  const res = room.match.lastResults.awards;
  const winner = res.find((a) => a.rank === 1).id;
  assert.ok(!mg.out.includes(winner), 'le gagnant n\'a pas sauté');
  void passes;
});

test('Carrelage : une dalle touchée tombe, on tombe avec', () => {
  const room = roomWith('tiles', 3, 5);
  const mg = room.match.minigame;
  const human = room.match.participants().find((p) => !p.bot);
  const tile = mg.tileAt(human.x, human.y);
  assert.ok(tile, 'debout sur une dalle');
  if (human.bot) human.bot.nextAt = 1e9;
  for (let i = 0; i < 5 / DT; i++) room.tick(DT); // 2 s de grâce + 2 s avant la chute
  assert.ok(tile.gone, 'la dalle est tombée');
  assert.ok(human.state !== 'alive' || mg.tileAt(human.x, human.y) !== tile, 'le joueur immobile est tombé');
  while (room.match.phase === 'minigame') room.tick(DT);
  assert.ok(mg.out.length >= 2, 'des chutes');
  assert.ok(room.match.lastResults.awards.some((a) => a.rank === 1));
});

test('Vingt-et-un : la carte d\'arrivée s\'ajoute, au-delà de 21 c\'est perdu, bouton = je reste', () => {
  const room = roomWith('blackjack', 2, 7);
  const mg = room.match.minigame;
  const human = room.match.participants().find((p) => !p.bot);
  const st = mg.state.get(human.id);
  // Pichenette minuscule depuis le centre d'une carte connue : on s'y arrête.
  const pick = (target) => {
    const i = mg.values.findIndex((v) => v === target);
    const c = CARD_TABLE.cards[i];
    Object.assign(human, { x: c.x + c.w / 2, y: c.y + c.h / 2, vx: 0, vy: 0, energy: 4 });
    human.pendingFlick = { a: 0, p: 0, hop: true };
    for (let k = 0; k < 40 && (k < 3 || st.counting); k++) { room.tick(DT); human.x = c.x + c.w / 2; human.y = c.y + c.h / 2; human.vx = human.vy = 0; }
  };
  pick(10);
  assert.equal(st.total, 10);
  pick(9);
  assert.equal(st.total, 19);
  human.actions.push('item');
  room.tick(DT);
  assert.ok(st.stood, 'je reste');
  assert.equal(st.total, 19);
  while (room.match.phase === 'minigame') room.tick(DT);
  const me = room.match.lastResults.awards.find((a) => a.id === human.id);
  assert.ok(me.rank <= 3);
  for (const [, s] of mg.state) assert.ok(s.busted || s.total <= 21);
});

test('Le match pioche dans tous les mini-jeux de palet', () => {
  const room = new GameRoom({ code: 'PL', seed: 2 });
  room.join({ send() {} }, { name: 'H' });
  room.addBot();
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    room.match.start(8);
    for (const id of room.match.plan) seen.add(id);
    room.match.enterLobby();
  }
  for (const id of ['bomb', 'tiles', 'blackjack', 'palet', 'glutton', 'memory', 'king', 'mine', 'movers', 'impostor']) assert.ok(seen.has(id), `${id} au programme`);
});
