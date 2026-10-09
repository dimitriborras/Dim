import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { Predictor } from '../client/predict.js';

// Simule un client à ~150 ms d'aller-retour (75 ms dans chaque sens) et vérifie que
// la position prédite correspond à celle que le serveur calcule ensuite.
test('prédiction locale : même trajectoire que le serveur malgré 150 ms de ping', () => {
  const LAG_TICKS = 2; // ~67 ms par trajet
  const room = new GameRoom({ code: 'LAG', seed: 4 });
  const toClient = [];
  const me = room.join({ send: (m) => m.t === 'snap' && toClient.push({ at: tick + LAG_TICKS, m }) }, { name: 'A' }).player;
  Object.assign(me, { x: 250, y: 620, vx: 0, vy: 0 });
  const pred = new Predictor();
  const toServer = [];
  let tick = 0;
  let lastBody = null;
  let mid = null;
  for (; tick < 120; tick++) {
    const moving = tick < 40;
    const cmd = { t: 'in', mx: moving ? 1 : 0, my: moving && tick > 25 ? -0.5 : 0, a: 0, f: false, act: [] };
    pred.record(cmd);
    toServer.push({ at: tick + LAG_TICKS, cmd });
    while (toServer.length && toServer[0].at <= tick) room.handle(me.id, toServer.shift().cmd);
    room.tick(DT);
    while (toClient.length && toClient[0].at <= tick) {
      const { m } = toClient.shift();
      pred.reconcile(m.you.body, m.w.map);
      lastBody = m.you.body;
    }
    if (tick === 20) mid = { predicted: pred.pos.x, confirmed: lastBody.x };
  }
  // Une fois toutes les commandes traitées, prédiction et serveur doivent coïncider.
  for (let i = 0; i < 10; i++) {
    room.tick(DT);
    while (toClient.length) pred.reconcile(toClient.shift().m.you.body, 'arena');
  }
  assert.ok(pred.pos, 'prédiction active');
  const err = Math.hypot(pred.pos.x - me.x, pred.pos.y - me.y);
  assert.ok(err < 3, `écart final ${err.toFixed(2)}`);
  // Pendant le déplacement, l'affichage local devance l'état confirmé (pas d'attente du ping).
  assert.ok(mid.predicted > mid.confirmed + 20, `avance ${(mid.predicted - mid.confirmed).toFixed(1)}`);
  assert.ok(me.x > 400, 'le joueur a bien avancé');
});
