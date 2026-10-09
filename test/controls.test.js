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
  assert.equal(p.dashReadyAt, 0, 'esquive ignorée pendant la glissade');
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
