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

test('changer d\'arme reste possible pendant une glissade, pas l\'esquive', () => {
  const { p, world } = setup();
  p.slipUntil = world.time + 1;
  p.actions.push('wn', 'dash');
  world.step(DT);
  assert.equal(p.inv.active, 1);
  assert.equal(p.flickReadyAt, 0, 'pichenette ignorée pendant la glissade');
});

test('les actions pressées pendant la mort ne partent pas à la réapparition', () => {
  const { p, world } = setup();
  InventorySystem.add(p.inv, 'banana');
  p.state = 'dead';
  p.respawnAt = world.time + 0.5;
  p.actions.push('c0', 'dash');
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

test('pichenette : on se lance, puis recharge', () => {
  const { a, world } = duel();
  a.pendingFlick = { a: Math.PI, p: 1 };
  world.step(DT);
  assert.ok(Math.hypot(a.vx, a.vy) > 900, 'lancé à pleine puissance');
  a.pendingFlick = { a: 0, p: 1 };
  world.step(DT);
  assert.ok(a.vx < 0, 'deuxième pichenette refusée pendant la recharge');
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
  assert.ok(b.toppleUntil > world.time, 'la cible est renversée');
  assert.equal(b.lastHitBy, 'a', 'une chute serait créditée au lanceur');
});

test('figurine renversée : pas de contrôle, puis elle se relève', () => {
  const { a, world } = duel();
  world.topple(a);
  a.input = { mx: 1, my: 0, aim: 0, fire: false };
  world.step(DT);
  assert.ok(Math.abs(a.vx) < 5, 'aucune accélération pendant le renversement');
  for (let i = 0; i < 30; i++) world.step(DT);
  assert.ok(a.vx > 100, 'contrôle retrouvé');
});
