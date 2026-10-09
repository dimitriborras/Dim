import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, resetBody } from '../shared/game/World.js';
import { InventorySystem } from '../shared/game/InventorySystem.js';
import { ScoreSystem } from '../shared/game/ScoreSystem.js';
import { GameRoom } from '../shared/game/GameRoom.js';
import { ARENA } from '../shared/maps.js';
import { createRng } from '../shared/rng.js';
import { DT } from '../shared/constants.js';

function fig(id, x, y) {
  const p = { id, actions: [], input: { mx: 0, my: 0, aim: 0, fire: false }, inv: InventorySystem.create(), aim: 0 };
  ScoreSystem.initPlayer(p);
  resetBody(p, { x, y });
  return p;
}

// Table sans boules de départ ni cubes : on place nous-mêmes la scène.
const TABLE = { ...ARENA, balls: [], walls: ARENA.walls.filter((w) => w.style === 'rail') };

test('carambolage : la boule pousse la cible dans la poche, le lanceur est crédité', () => {
  const a = fig('a', 300, 700);
  const b = fig('b', 600, 780); // près de la poche du milieu en bas (800, 900)
  const elims = [];
  const world = new World({
    map: { ...TABLE, balls: [{ x: 450, y: 740, num: 8 }] },
    players: [a, b],
    rng: createRng(1),
    rules: { respawn: false },
    hooks: { onEliminated: (victim, killerId) => elims.push({ victim: victim.id, killerId }) },
  });
  const ball = world.balls[0];
  // a tire la boule vers b ; b part ensuite vers la poche.
  const toBall = Math.atan2(ball.y - a.y, ball.x - a.x);
  a.pendingFlick = { a: toBall, p: 1 };
  let carom = false;
  for (let i = 0; i < 120 && !elims.length; i++) {
    world.step(DT);
    if (b.lastHitBy === 'a') carom = true;
    // Aide la mise en scène : une fois touchée par la boule, b est poussée vers la poche.
    if (carom && b.state === 'alive' && Math.hypot(b.vx, b.vy) < 50) { b.vx = (800 - b.x) * 4; b.vy = (900 - b.y) * 4; }
  }
  assert.ok(carom, 'la boule lancée par a a touché b : b est créditée à a');
  assert.deepEqual(elims[0], { victim: 'b', killerId: 'a' });
});

test('les boules se percutent, rebondissent et sont empochées puis reviennent', () => {
  const world = new World({ map: { ...TABLE, balls: [{ x: 300, y: 500, num: 1 }, { x: 400, y: 500, num: 2 }] }, players: [], rng: createRng(1) });
  const [b1, b2] = world.balls;
  b1.vx = 600;
  for (let i = 0; i < 10; i++) world.step(DT);
  assert.ok(b2.vx > 300 && Math.abs(b1.vx) < 100, 'élan transmis (berceau de Newton)');
  b1.x = 300; b1.vx = 0; // b1 s'écarte de la mouche de b2
  b2.x = 1440; b2.y = 150; b2.vx = 400; b2.vy = -400; // vers la poche du coin haut droit
  for (let i = 0; i < 20; i++) world.step(DT);
  assert.equal(b2.active, false, 'boule empochée');
  for (let i = 0; i < 150; i++) world.step(DT);
  assert.equal(b2.active, true, 'revenue sur sa mouche');
  assert.deepEqual({ x: b2.x, y: b2.y }, b2.home);
});

test('le Pétard pousse aussi les boules', () => {
  const a = fig('a', 300, 500);
  const world = new World({ map: { ...TABLE, balls: [{ x: 400, y: 500, num: 3 }] }, players: [a], rng: createRng(1) });
  world.shockwave(a, 175, 640);
  for (let i = 0; i < 10; i++) world.step(DT);
  assert.ok(world.balls[0].x > 420, 'la boule a bougé');
  assert.equal(world.balls[0].lastHitBy, 'a');
});

test('lobby : +3 par empoché, +1 par gros choc (limité dans le temps)', () => {
  const room = new GameRoom({ code: 'BIL', seed: 2 });
  const me = room.join({ send() {} }, { name: 'A' }).player;
  const other = room.join({ send() {} }, { name: 'B' }).player;
  const w = room.match.world;
  w.balls.length = 0;
  Object.assign(me, { x: 500, y: 500, vx: 0, vy: 0 });
  Object.assign(other, { x: 640, y: 500, vx: 0, vy: 0, invulnUntil: 0 });
  me.pendingFlick = { a: 0, p: 1 };
  for (let i = 0; i < 15; i++) room.tick(DT);
  assert.equal(me.lobbyScore, 1, 'gros choc : +1');
  // Empocher : l'autre file droit dans une poche après un coup de a.
  Object.assign(other, { x: 1420, y: 170, vx: 500, vy: -500, lastHitBy: me.id, lastHitAt: w.time });
  for (let i = 0; i < 40; i++) room.tick(DT);
  assert.equal(me.lobbyScore, 4, 'empoché : +3');
});
