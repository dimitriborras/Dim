import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { Predictor } from '../client/predict.js';

// Simule un client à ~130 ms d'aller-retour et vérifie que la pichenette prédite
// localement (immédiate) suit la même trajectoire que celle calculée par le serveur.
test('prédiction de la pichenette : immédiate et identique au serveur malgré le ping', () => {
  const LAG_TICKS = 2;
  const room = new GameRoom({ code: 'LAG', seed: 4 });
  let tick = 0;
  const toClient = [];
  const me = room.join({ send: (m) => m.t === 'snap' && toClient.push({ at: tick + LAG_TICKS, m }) }, { name: 'A' }).player;
  Object.assign(me, { x: 300, y: 620, vx: 0, vy: 0 });
  const pred = new Predictor();
  const toServer = [];
  let launchedAt = null;
  let predictedMoveAt = null;
  for (; tick < 120; tick++) {
    const cmd = { t: 'in', mx: 0, my: 0, a: 0, f: false, act: [] };
    if (tick === 20) cmd.fl = { a: -0.3, p: 0.8 }; // vers un mur pour tester aussi le rebond
    if (tick === 70) cmd.fl = { a: Math.PI, p: 0, hop: true };
    pred.record(cmd);
    if (tick === 20) predictedMoveAt = pred.pos && Math.hypot(pred.pos.vx, pred.pos.vy) > 500 ? tick : null;
    toServer.push({ at: tick + LAG_TICKS, cmd });
    while (toServer.length && toServer[0].at <= tick) room.handle(me.id, toServer.shift().cmd);
    room.tick(DT);
    if (launchedAt === null && Math.hypot(me.vx, me.vy) > 500) launchedAt = tick;
    while (toClient.length && toClient[0].at <= tick) pred.reconcile(toClient.shift().m.you.body, 'arena');
  }
  for (let i = 0; i < 10; i++) {
    room.tick(DT);
    while (toClient.length) pred.reconcile(toClient.shift().m.you.body, 'arena');
  }
  assert.equal(predictedMoveAt, 20, 'la figurine part dès le relâchement sur l\'écran du joueur');
  assert.ok(launchedAt >= 22, 'le serveur ne la reçoit qu\'après le ping');
  assert.ok(pred.pos, 'prédiction active');
  const err = Math.hypot(pred.pos.x - me.x, pred.pos.y - me.y);
  assert.ok(err < 3, `écart final ${err.toFixed(2)}`);
  assert.ok(Math.hypot(me.x - 300, me.y - 620) > 150, 'la figurine a bien voyagé');
});
