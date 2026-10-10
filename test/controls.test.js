import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, resetBody } from '../shared/game/World.js';
import { InventorySystem } from '../shared/game/InventorySystem.js';
import { ScoreSystem } from '../shared/game/ScoreSystem.js';
import { ARENA } from '../shared/maps.js';
import { createRng } from '../shared/rng.js';
import { DT } from '../shared/constants.js';
import { parseClientMessage } from '../shared/protocol.js';

function setup() {
  const p = { id: 'p1', actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), aim: 0 };
  ScoreSystem.initPlayer(p);
  resetBody(p, { x: 400, y: 400 });
  const world = new World({ map: ARENA, players: [p], rng: createRng(1), rules: { respawnDelay: 1 } });
  return { p, world };
}

test('seule l\'action « objet » existe ; pressée pendant la mort, elle ne part pas à la réapparition', () => {
  const { p, world } = setup();
  assert.deepEqual(parseClientMessage({ t: 'in', act: ['wn', 'item', 'x'] }).act, ['item']);
  InventorySystem.add(p.inv, 'banana');
  p.state = 'dead';
  p.respawnAt = world.time + 0.5;
  p.actions.push('item');
  for (let i = 0; i < 30; i++) world.step(DT);
  assert.equal(p.state, 'alive');
  assert.equal(p.inv.gadget.charges, 3, 'banane conservée');
  assert.equal(world.traps.length, 0);
});

test('pichenette refusée pendant une glissade de banane', () => {
  const { p, world } = setup();
  p.slipUntil = world.time + 1;
  p.pendingFlick = { a: 0, p: 1 };
  world.step(DT);
  assert.ok(Math.abs(p.vx) < 1);
});

function duel() {
  const mk = (id, x) => {
    const p = { id, actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), aim: 0 };
    ScoreSystem.initPlayer(p);
    resetBody(p, { x, y: 640 });
    return p;
  };
  const a = mk('a', 400);
  const b = mk('b', 520);
  const world = new World({ map: ARENA, players: [a, b], rng: createRng(2) });
  return { a, b, world };
}

test('pichenette : trois charges, puis il faut attendre', () => {
  const { a, world } = duel();
  const speeds = [];
  for (let i = 0; i < 4; i++) {
    a.vx = a.vy = 0;
    a.pendingFlick = { a: Math.PI, p: 1 };
    world.step(DT);
    speeds.push(Math.hypot(a.vx, a.vy));
  }
  assert.ok(speeds.slice(0, 3).every((v) => v > 800), 'trois pichenettes à pleine puissance');
  assert.ok(speeds[3] < 100, 'la quatrième est refusée faute de charge');
  for (let i = 0; i < 30; i++) world.step(DT);
  assert.ok(a.energy >= 1, 'une charge revient en moins d\'une seconde');
});

test('petite tape : petit bond qui coûte peu', () => {
  const { a, world } = duel();
  a.pendingFlick = { a: 0, p: 0, hop: true };
  world.step(DT);
  assert.ok(a.vx > 150 && a.vx < 260);
  assert.ok(a.energy > 2.5);
});

test('pichenette sur un joueur : l\'élan passe à la cible (berceau de Newton)', () => {
  const { a, b, world } = duel();
  a.pendingFlick = { a: 0, p: 1 };
  let hit = false;
  for (let i = 0; i < 20 && !hit; i++) {
    world.step(DT);
    hit = world.events.some((e) => e.type === 'clack');
  }
  assert.ok(hit, 'collision détectée');
  assert.ok(b.vx > 600, `la cible est projetée (vx=${b.vx.toFixed(0)})`);
  assert.ok(Math.abs(a.vx) < b.vx / 3, 'le lanceur s\'arrête presque');
  assert.equal(b.lastHitBy, 'a', 'une chute serait créditée au lanceur');
});

test('figurine renversée : pichenette impossible, puis elle se relève', () => {
  const { a, world } = duel();
  world.topple(a);
  a.pendingFlick = { a: 0, p: 1 };
  world.step(DT);
  assert.ok(Math.abs(a.vx) < 5, 'pas de pichenette pendant le renversement');
  for (let i = 0; i < 30; i++) world.step(DT);
  a.pendingFlick = { a: Math.PI, p: 1 };
  world.step(DT);
  assert.ok(a.vx < -800, 'pichenette possible une fois relevée');
});

test('Lest de plomb : plus dur à pousser, et pousse plus loin', () => {
  const push = (heavyA, heavyB) => {
    const { a, b, world } = duel();
    if (heavyA) { InventorySystem.add(a.inv, 'lead'); InventorySystem.applyStats(a); }
    if (heavyB) { InventorySystem.add(b.inv, 'lead'); InventorySystem.applyStats(b); }
    a.pendingFlick = { a: 0, p: 1 };
    for (let i = 0; i < 6; i++) world.step(DT);
    return b.vx;
  };
  const base = push(false, false);
  assert.ok(push(false, true) < base * 0.85, 'cible lestée : moins projetée');
  assert.ok(push(true, false) > base * 1.05, 'lanceur lesté : projette plus');
});

test('Pétard : repousse les voisins et crédite le lanceur', () => {
  const { a, b, world } = duel();
  InventorySystem.add(a.inv, 'firecracker');
  a.actions.push('item');
  world.step(DT);
  assert.ok(b.vx > 300, `voisin repoussé (vx=${b.vx.toFixed(0)})`);
  assert.equal(b.lastHitBy, 'a');
  assert.equal(a.inv.gadget.charges, 1);
});

test('Bouée : rattrapé une fois au bord d\'une poche', () => {
  const { a, world } = duel();
  InventorySystem.add(a.inv, 'buoy');
  resetBody(a, { x: 300, y: 300 });
  const pk = ARENA.pockets[0];
  Object.assign(a, { x: pk.x + 5, y: pk.y + 5, vx: -100, vy: -100 });
  world.step(DT);
  assert.equal(a.state, 'alive', 'sauvé');
  assert.equal(a.saves, 0);
  assert.ok(world.isGround(a.x, a.y));
  Object.assign(a, { x: pk.x + 5, y: pk.y + 5 });
  world.step(DT);
  assert.notEqual(a.state, 'alive', 'une seule fois');
});
