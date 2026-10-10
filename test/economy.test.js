import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { InventorySystem } from '../shared/game/InventorySystem.js';
import { ScoreSystem } from '../shared/game/ScoreSystem.js';
import { ShopSystem, REROLL_COST } from '../shared/game/ShopSystem.js';
import { ITEMS } from '../shared/items.js';
import { World, resetBody } from '../shared/game/World.js';
import { ARENA } from '../shared/maps.js';
import { createRng } from '../shared/rng.js';
import { REWARDS } from '../shared/constants.js';

function player(id = 'p1') {
  const p = { id, actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), aim: 0, joinOrder: 1 };
  ScoreSystem.initPlayer(p);
  resetBody(p, { x: 400, y: 400 });
  return p;
}

test('Distributeur : main de 3 capsules avec au moins un atout et un gadget', () => {
  const shop = new ShopSystem(createRng(1));
  for (let i = 0; i < 20; i++) {
    const hand = shop.draw(player());
    assert.equal(hand.length, 3);
    assert.equal(new Set(hand).size, 3);
    assert.ok(hand.some((id) => ITEMS[id].category === 'perk'));
    assert.ok(hand.some((id) => ITEMS[id].category === 'gadget'));
  }
});

test('impossible d\'acheter sans crédits, ni hors de sa main, ni distributeur fermé', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.offers = ['lead', 'firecracker', 'battery'];
  p.credits = 20;
  assert.equal(shop.buy(p, 'lead', true).ok, false);
  assert.equal(p.credits, 20);
  p.credits = 500;
  assert.equal(shop.buy(p, 'spikes', true).ok, false, 'pas dans la main');
  assert.equal(shop.buy(p, 'lead', false).ok, false, 'fermé');
  assert.equal(p.inv.perks.length, 0);
});

test('un achat débite, équipe, applique l\'atout et retire la capsule', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.offers = ['lead', 'firecracker', 'battery'];
  p.credits = 200;
  assert.equal(shop.buy(p, 'lead', true).ok, true);
  assert.equal(p.credits, 130);
  assert.deepEqual(p.inv.perks, ['lead']);
  assert.ok(p.mass > 1.3, 'figurine plus lourde');
  assert.ok(!p.offers.includes('lead'));
  assert.equal(shop.buy(p, 'battery', true).ok, true);
  assert.equal(p.energyMax, 4);
  assert.equal(shop.buy(p, 'firecracker', false).ok, false);
});

test('4e atout : remplace le plus ancien ; nouveau gadget : remplace l\'ancien', () => {
  const p = player();
  for (const id of ['lead', 'battery', 'turbo']) InventorySystem.add(p.inv, id);
  const res = InventorySystem.add(p.inv, 'spikes');
  assert.equal(res.replaces, 'lead');
  assert.deepEqual(p.inv.perks, ['battery', 'turbo', 'spikes']);
  InventorySystem.add(p.inv, 'banana');
  assert.equal(InventorySystem.add(p.inv, 'magnet').replaces, 'banana');
  assert.equal(p.inv.gadget.id, 'magnet');
});

test('relance : gratuite pour la moitié basse, payante sinon', () => {
  const shop = new ShopSystem(createRng(3));
  const ps = ['a', 'b', 'c', 'd'].map(player);
  ps.forEach((p, i) => { p.credits = 20; p.points = 40 - i * 10; });
  shop.open(ps);
  assert.deepEqual(ps.map((p) => p.freeRerolls), [0, 0, 1, 1]);
  assert.equal(shop.reroll(ps[3], true).ok, true);
  assert.equal(ps[3].credits, 20, 'relance gratuite');
  assert.equal(shop.reroll(ps[0], true).ok, true);
  assert.equal(ps[0].credits, 20 - REROLL_COST);
  assert.equal(shop.reroll(ps[0], true).ok, false, 'plus assez de crédits');
});

test('gadget : charges limitées, rechargées à la phase suivante ; échec = charge conservée', () => {
  const p = player();
  const world = new World({ map: ARENA, players: [p], rng: createRng(2) });
  InventorySystem.add(p.inv, 'banana');
  for (let i = 0; i < 5; i++) { InventorySystem.useItem(p, world); world.time += 1; }
  assert.equal(world.traps.length, 3, 'trois peaux de banane, pas plus');
  InventorySystem.refresh(p.inv);
  assert.equal(p.inv.gadget.charges, 3);

  const q = player('q');
  const w2 = new World({ map: ARENA, players: [q], rng: createRng(2) });
  const wall = ARENA.walls[0];
  resetBody(q, { x: wall.x - 21, y: wall.y + wall.h / 2 });
  q.aim = 0; // droit dans le mur
  InventorySystem.add(q.inv, 'teleporter');
  assert.equal(InventorySystem.useItem(q, w2), false);
  assert.equal(q.inv.gadget.charges, 1);
});

test('éliminations répétées de la même victime : points dégressifs', () => {
  const score = new ScoreSystem();
  const a = player('a');
  const b = player('b');
  score.beginCombat();
  const pts = [score.onKill(a, b), score.onKill(a, b), score.onKill(a, b), score.onKill(a, b)];
  assert.deepEqual(pts, [3, 1, 0, 0]);
  assert.equal(a.points, 4);
});

test('prime du champion et barème des mini-jeux', () => {
  const score = new ScoreSystem();
  const ps = ['a', 'b', 'c', 'd'].map(player);
  const byId = new Map(ps.map((p) => [p.id, p]));
  score.awardMinigame([['a'], ['b'], ['c'], ['d']], byId, []);
  assert.deepEqual(ps.map((p) => p.points), [10, 7, 5, 3]);
  assert.deepEqual(ps.map((p) => p.credits), [100, 75, 55, 35]);
  assert.equal(score.championId, 'a');
  score.beginCombat();
  score.onKill(ps[1], ps[0]);
  assert.equal(ps[1].points, 7 + REWARDS.killPoints[0] + REWARDS.championKillPoints);
  score.endCombat(ps, []);
  assert.equal(score.championId, null, 'le bonus du champion s\'arrête après le combat');
});

test('aucun objet ne rapporte de points de tournoi', async () => {
  const room = new GameRoom({ code: 'TEST', seed: 3 });
  room.join({ send() {} }, { name: 'A' });
  room.addBot();
  room.match.start(3);
  const p = [...room.players.values()][0];
  p.credits = 10_000;
  const before = p.points;
  room.match.enterRewards();
  for (let i = 0; i < 5; i++) {
    for (const id of p.offers.slice()) room.match.buy(p, id);
    room.match.reroll(p);
  }
  assert.ok(p.inv.perks.length > 0 && p.inv.gadget, 'achats effectués');
  assert.equal(p.points, before);
});
