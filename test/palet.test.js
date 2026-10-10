import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { PALET_LANE } from '../shared/maps.js';

function roomWith(id, bots = 3, seed = 4) {
  const room = new GameRoom({ code: 'PG', seed });
  room.join({ send() {} }, { name: 'H' });
  for (let i = 0; i < bots; i++) room.addBot();
  room.match.start(1);
  room.match.plan = [id];
  room.match.enterIntro();
  return room;
}

const play = (room) => {
  while (room.match.phase === 'intro' || room.match.phase === 'finaleIntro') room.tick(DT);
};

test('Le Palet : deux pichenettes par mène, points selon l\'anneau, trois mènes', () => {
  const room = roomWith('palet');
  play(room);
  const mg = room.match.minigame;
  const human = room.match.participants().find((p) => !p.bot);
  // Le joueur humain se place pile au centre : 5 points à la fin de la mène.
  Object.assign(human, { x: PALET_LANE.target.x, y: PALET_LANE.target.y, vx: 0, vy: 0 });
  human.pendingFlick = { a: 0, p: 0.1 };
  for (let i = 0; i < 3; i++) { room.tick(DT); human.pendingFlick = { a: Math.PI, p: 0.01 }; }
  assert.ok(human.energy < 1, 'plus de charge après deux coups : pas de recharge pendant la mène');
  // On le maintient au centre (les bots le dégommeraient sinon) jusqu'au décompte.
  while (mg.phase === 'play') {
    Object.assign(human, { x: PALET_LANE.target.x, y: PALET_LANE.target.y, vx: 0, vy: 0, state: 'alive' });
    room.tick(DT);
  }
  assert.equal(mg.last[human.id], 5, `points de cible (${mg.last[human.id]})`);
  while (room.match.phase === 'minigame') room.tick(DT);
  assert.equal(mg.mene, 3);
  const total = [...mg.totals.values()].reduce((a, b) => a + b, 0);
  assert.ok(total > mg.totals.get(human.id), 'les bots marquent aussi');
});

test('Les poches gloutonnes : les poches grossissent, le dernier debout gagne', () => {
  const room = roomWith('glutton', 4, 6);
  play(room);
  const mg = room.match.minigame;
  const r0 = mg.map.pockets[0].r;
  for (let i = 0; i < 20 / DT && room.match.phase === 'minigame'; i++) room.tick(DT);
  if (room.match.phase === 'minigame') assert.ok(mg.map.pockets[0].r > r0 * 1.4, 'poches agrandies');
  while (room.match.phase === 'minigame') room.tick(DT);
  const res = room.match.lastResults;
  assert.ok(res.awards.length === 5);
  assert.ok(mg.out.length >= 3, `des chutes (${mg.out.length})`);
  const winner = res.awards.find((a) => a.rank === 1).id;
  assert.ok(!mg.out.includes(winner) || mg.out.at(-1) === winner, 'le gagnant est le dernier debout');
});

test('Couronne : un carton sur le porteur la vole', () => {
  const room = new GameRoom({ code: 'CR', seed: 3 });
  room.join({ send() {} }, { name: 'H' });
  room.addBot();
  room.match.start(1);
  room.match.round = 2; // finale
  room.match.enterIntro();
  play(room);
  const mg = room.match.minigame;
  const [a, b] = room.match.participants();
  mg.holder = b.id;
  mg.world.pickups = [];
  Object.assign(a, { x: 500, y: 500, vx: 0, vy: 0, invulnUntil: 0 });
  Object.assign(b, { x: 620, y: 500, vx: 0, vy: 0, invulnUntil: 0, bubbleUntil: 0 });
  b.bot.nextAt = 1e9; // le bot ne bouge pas pendant le test
  a.pendingFlick = { a: 0, p: 1 };
  for (let i = 0; i < 10; i++) room.tick(DT);
  assert.equal(mg.holder, a.id);
});

test('Mêlée : +1 par boule empochée (3 au plus), contrat « empocher une boule »', () => {
  const room = new GameRoom({ code: 'ML', seed: 3 });
  const me = room.join({ send() {} }, { name: 'H' }).player;
  room.addBot();
  room.match.start(3);
  room.match.enterRewards();
  room.match.enterCombat();
  const w = room.match.world;
  me.contract = { kind: 'ball', label: '', goal: 1, progress: 0, reward: 40, done: false };
  const before = me.points;
  const credits = me.credits;
  for (let i = 0; i < 5; i++) w.hooks.onBallPocket(me.id);
  assert.equal(me.points - before, 3);
  assert.equal(me.credits - credits, 40, 'contrat rempli');
});

test('Ruée sur les jetons : percuter quelqu\'un lui fait lâcher un jeton', () => {
  const room = roomWith('coins', 1, 8);
  play(room);
  const mg = room.match.minigame;
  const [a, b] = room.match.participants();
  mg.coins.set(b.id, 4);
  mg.world.pickups = [];
  Object.assign(a, { x: 500, y: 500, vx: 0, vy: 0, invulnUntil: 0 });
  Object.assign(b, { x: 620, y: 500, vx: 0, vy: 0, invulnUntil: 0 });
  b.bot.nextAt = 1e9;
  a.pendingFlick = { a: 0, p: 1 };
  for (let i = 0; i < 6; i++) room.tick(DT);
  assert.equal(mg.coins.get(b.id), 3);
});
