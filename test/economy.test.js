import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { InventorySystem } from '../shared/game/InventorySystem.js';
import { ScoreSystem } from '../shared/game/ScoreSystem.js';
import { ShopSystem } from '../shared/game/ShopSystem.js';
import { World, resetBody } from '../shared/game/World.js';
import { ARENA } from '../shared/maps.js';
import { createRng } from '../shared/rng.js';
import { REWARDS } from '../shared/constants.js';

function player(id = 'p1') {
  const p = { id, actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), channel: null, aim: 0, joinOrder: 1 };
  ScoreSystem.initPlayer(p);
  resetBody(p, { x: 400, y: 400 });
  return p;
}

test('impossible d\'acheter sans crédits suffisants', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.credits = 20;
  const res = shop.request(p, 'glue_launcher', undefined, 'safe', 0);
  assert.equal(res.ok, false);
  assert.equal(p.credits, 20);
  assert.equal(p.inv.slots[1], null);
});

test('un achat débite les crédits et occupe un emplacement', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.credits = 100;
  assert.equal(shop.request(p, 'glue_launcher', undefined, 'safe', 0).ok, true);
  assert.equal(p.credits, 20);
  assert.equal(p.inv.slots[1].id, 'glue_launcher');
  assert.equal(shop.request(p, 'glue_launcher', undefined, 'safe', 0).ok, false, 'pas de doublon');
});

test('achat en combat : 1,5 s de transaction et crédits revérifiés à la fin', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.credits = 30;
  const res = shop.request(p, 'banana', undefined, 'combat', 10);
  assert.deepEqual(res, { ok: true, pending: true });
  assert.equal(shop.update([p], 11).length, 0);
  p.credits = 5; // dépensé ailleurs entre-temps
  const done = shop.update([p], 11.6);
  assert.equal(done[0].result.ok, false);
  assert.equal(p.credits, 5);
  assert.equal(p.inv.consumables[0], null);
});

test('amélioration limitée à un niveau', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.credits = 500;
  assert.equal(shop.request(p, 'pistol_mk2', undefined, 'safe', 0).ok, true);
  assert.equal(p.inv.slots[0].level, 2);
  assert.equal(shop.request(p, 'pistol_mk2', undefined, 'safe', 0).ok, false);
});

test('inventaire plein : il faut choisir l\'emplacement à remplacer', () => {
  const shop = new ShopSystem(createRng(1));
  const p = player();
  p.credits = 1000;
  shop.request(p, 'glue_launcher', undefined, 'safe', 0);
  shop.request(p, 'spring_glove', undefined, 'safe', 0);
  assert.equal(shop.request(p, 'bubble_shield', undefined, 'safe', 0).ok, false);
  assert.equal(shop.request(p, 'bubble_shield', 1, 'safe', 0).ok, true);
  assert.equal(p.inv.slots[1].id, 'bubble_shield');
  assert.equal(p.inv.slots[0].id, 'pistol', 'le pistolet n\'est jamais remplacé');
});

test('un consommable ne peut pas être utilisé deux fois', () => {
  const p = player();
  const world = new World({ map: ARENA, players: [p], rng: createRng(2) });
  InventorySystem.add(p.inv, 'banana');
  assert.equal(InventorySystem.useConsumable(p, world, 0), true);
  assert.equal(InventorySystem.useConsumable(p, world, 0), false);
  assert.equal(world.traps.length, 1);
});

test('téléporteur raté (mur collé) : objet conservé', () => {
  const p = player();
  const world = new World({ map: ARENA, players: [p], rng: createRng(2) });
  const wall = ARENA.walls[0];
  resetBody(p, { x: wall.x - 21, y: wall.y + wall.h / 2 });
  p.aim = 0; // droit dans le mur
  InventorySystem.add(p.inv, 'teleporter');
  assert.equal(InventorySystem.useConsumable(p, world, 0), false);
  assert.equal(p.inv.consumables[0].id, 'teleporter');
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
  for (const id of room.match.shop.offers) room.match.shop.request(p, id, 1, 'safe', 0);
  assert.equal(p.points, before);
});
