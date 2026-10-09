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
  const p = { id: 'p1', actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), channel: null, aim: 0 };
  ScoreSystem.initPlayer(p);
  resetBody(p, { x: 400, y: 400 });
  InventorySystem.add(p.inv, 'spring_glove');
  const world = new World({ map: ARENA, players: [p], rng: createRng(1), rules: { respawnDelay: 1 } });
  return { p, world };
}

test('molette / gâchettes : arme suivante et précédente', () => {
  const { p, world } = setup();
  p.actions.push('wn');
  world.step(DT);
  assert.equal(p.inv.active, 1);
  p.actions.push('wp');
  world.step(DT);
  assert.equal(p.inv.active, 0);
  assert.deepEqual(parseClientMessage({ t: 'in', act: ['wn', 'wp', 'x'] }).act, ['wn', 'wp']);
});

test('changer d\'arme reste possible pendant une glissade, pas la pichenette', () => {
  const { p, world } = setup();
  p.slipUntil = world.time + 1;
  p.actions.push('wn');
  p.pendingFlick = { a: 0, p: 1 };
  world.step(DT);
  assert.equal(p.inv.active, 1);
  assert.ok(Math.abs(p.vx) < 1, 'pichenette refusée pendant la glissade');
});

test('les actions pressées pendant la mort ne partent pas à la réapparition', () => {
  const { p, world } = setup();
  InventorySystem.add(p.inv, 'banana');
  p.state = 'dead';
  p.respawnAt = world.time + 0.5;
  p.actions.push('c0', 'item');
  for (let i = 0; i < 30; i++) world.step(DT);
  assert.equal(p.state, 'alive');
  assert.equal(p.inv.consumables[0]?.id, 'banana', 'banane conservée');
  assert.equal(world.traps.length, 0);
});

function duel() {
  const mk = (id, x) => {
    const p = { id, actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), channel: null, aim: 0 };
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

test('posée, la figurine tire seule sur l\'adversaire le plus proche', () => {
  const { a, b, world } = duel();
  world.step(DT);
  assert.ok(world.projectiles.some((pr) => pr.owner === 'a'), 'tir automatique');
  assert.ok(Math.abs(a.aim) < 0.2, 'visée vers la cible');
  void b;
});
