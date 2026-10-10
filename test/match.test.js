import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { parseClientMessage } from '../shared/protocol.js';

function runUntil(room, pred, maxSeconds = 1200) {
  for (let i = 0; i < maxSeconds / DT; i++) {
    room.tick(DT);
    if (pred()) return true;
  }
  return false;
}

test('une partie complète de 4 joueurs se termine seule et revient au lobby', () => {
  const snaps = [];
  const room = new GameRoom({ code: 'TEST', seed: 11 });
  const me = room.join({ send: (m) => m.t === 'snap' && m.m.phase === 'final' && snaps.push(m) }, { name: 'Humain' }).player;
  for (let i = 0; i < 3; i++) room.addBot();
  room.settings.rounds = 3;
  room.handle(me.id, { t: 'start' });
  assert.equal(room.match.phase, 'pick');

  const seen = new Set();
  const ok = runUntil(room, () => { seen.add(room.match.phase); return seen.has('final') && room.match.phase === 'lobby'; });
  assert.ok(ok, 'la partie doit revenir au lobby');
  for (const ph of ['pick', 'intro', 'minigame', 'rewards', 'combat', 'lastShop', 'finaleIntro', 'finale', 'final', 'lobby']) {
    assert.ok(seen.has(ph), `phase ${ph} jouée`);
  }
  const standings = snaps.at(-1).m.standings;
  assert.equal(standings.length, 4);
  const pts = standings.map((s) => s.points);
  assert.deepEqual(pts, [...pts].sort((a, b) => b - a), 'classement trié');
  assert.ok(pts.every((p) => p >= 3 * 3), 'chacun a au moins les points de participation');
});

test('plusieurs parties à 8 joueurs sans blocage (graines différentes)', () => {
  for (const seed of [1, 2, 3]) {
    const room = new GameRoom({ code: 'TEST', seed });
    const me = room.join({ send() {} }, { name: 'H' }).player;
    for (let i = 0; i < 7; i++) room.addBot();
    room.handle(me.id, { t: 'settings', rounds: 3 });
    room.handle(me.id, { t: 'start' });
    let sawFinal = false;
    assert.ok(runUntil(room, () => { if (room.match.phase === 'final') sawFinal = true; return sawFinal && room.match.phase === 'lobby'; }));
    for (const p of room.players.values()) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'positions valides');
    }
  }
});

test('le client ne peut pas tricher via des messages invalides', () => {
  const room = new GameRoom({ code: 'TEST', seed: 5 });
  const me = room.join({ send() {} }, { name: 'H' }).player;
  room.addBot();
  const junk = [
    '{', 'null', '{"t":"in","mx":1e9,"my":"x","a":"NaN","act":["kill","dash","dash"]}',
    { t: 'buy', item: '__proto__' }, { t: 'buy', item: 'banana', slot: 99 },
    { t: 'points', amount: 999 }, { t: 'credits', amount: 999 }, { t: 'settings', rounds: 1000 },
    'x'.repeat(5000),
  ];
  for (const j of junk) room.handle(me.id, j);
  for (let i = 0; i < 30; i++) room.tick(DT);
  assert.equal(me.points, 0);
  assert.equal(me.credits, 0);
  assert.ok(Math.abs(me.input.mx) <= 1);
  assert.equal(room.settings.rounds, 8);
  assert.equal(parseClientMessage({ t: 'in', act: ['kill'] }).act.length, 0);
});

test('seul l\'hôte lance la partie ; départ de l\'hôte = migration', () => {
  const room = new GameRoom({ code: 'TEST', seed: 5 });
  const a = room.join({ send() {} }, { name: 'A' }).player;
  const b = room.join({ send() {} }, { name: 'B' }).player;
  room.handle(b.id, { t: 'start' });
  assert.equal(room.match.phase, 'lobby');
  room.handle(a.id, { t: 'start' });
  assert.equal(room.match.phase, 'pick');
  room.leave(a.id);
  assert.equal(room.hostId, b.id);
  assert.ok(room.players.has(a.id), 'conservé au classement pendant la partie');
  for (let i = 0; i < 300; i++) room.tick(DT);
});

test('reconnexion avec jeton pendant la partie', () => {
  const room = new GameRoom({ code: 'TEST', seed: 9 });
  let welcome;
  const a = room.join({ send: (m) => { if (m.t === 'welcome') welcome = m; } }, { name: 'A' }).player;
  room.addBot();
  room.handle(a.id, { t: 'start' });
  for (let i = 0; i < 200; i++) room.tick(DT);
  room.join({ send() {} }, { name: 'B' }); // refusé : partie en cours, mais la salle reste ouverte
  room.leave(a.id); // seul humain -> la salle se ferme
  assert.equal(room.closed, true);

  const room2 = new GameRoom({ code: 'T2', seed: 9 });
  let tk;
  const x = room2.join({ send: (m) => { if (m.t === 'welcome') tk = m.token; } }, { name: 'X' }).player;
  const y = room2.join({ send() {} }, { name: 'Y' }).player;
  room2.handle(x.id, { t: 'start' });
  for (let i = 0; i < 200; i++) room2.tick(DT);
  room2.leave(x.id);
  assert.equal(x.connected, false);
  const back = room2.join({ send() {} }, { name: 'X', token: tk });
  assert.equal(back.ok, true);
  assert.equal(back.player, x);
  assert.equal(x.connected, true);
  assert.ok(room2.match.world.players.includes(x));
  for (let i = 0; i < 200; i++) room2.tick(DT);
  assert.ok(welcome && y);
});

test('vote : deux gros mini-jeux et La Rafale, la majorité choisit ; Mêlée seulement au début et à la fin', () => {
  const room = new GameRoom({ code: 'VO', seed: 4 });
  const me = room.join({ send() {} }, { name: 'H' }).player;
  for (let i = 0; i < 3; i++) room.addBot();
  room.settings.rounds = 5;
  room.handle(me.id, { t: 'start' });
  const m = room.match;
  assert.equal(m.phase, 'pick');
  assert.equal(m.pick.options.length, 3);
  assert.equal(m.pick.options[2], 'micro', 'La Rafale toujours proposée');
  assert.ok(m.pick.options.slice(0, 2).every((id) => id !== 'micro'), 'deux gros mini-jeux');
  // Les bots votent comme moi : le choix passe.
  for (const p of m.participants()) room.handle(p.id, { t: 'pick', i: 0 });
  for (const p of m.participants()) if (p.bot) m.votePick(p, 0);
  const wanted = m.pick.options[0];
  runUntil(room, () => m.phase === 'intro');
  assert.equal(m.plan[0], wanted, 'le mini-jeu voté est joué');
  assert.equal(m.minigame.constructor.id, wanted);
  assert.equal(parseClientMessage({ t: 'pick', i: 7 }), null);
  // Suivre la partie : la Mêlée n'a lieu qu'après la 1re et la 5e manche.
  const melees = [];
  let last = m.phase;
  runUntil(room, () => {
    if (m.phase !== last) { if (m.phase === 'combat') melees.push(m.round); last = m.phase; }
    return m.phase === 'finaleIntro';
  });
  assert.deepEqual(melees, [1, 5]);
});
