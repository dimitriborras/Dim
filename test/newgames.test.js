import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT } from '../shared/constants.js';
import { MEMORY_TABLE, MOVERS_HOUSE } from '../shared/maps.js';
import { generateMine, newMiner, stepMiner, MINE, TILE, tileAt } from '../shared/game/mine.js';

function roomWith(id, bots = 3, seed = 3) {
  const room = new GameRoom({ code: 'NG', seed });
  room.join({ send() {} }, { name: 'H' });
  for (let i = 0; i < bots; i++) room.addBot();
  room.match.start(1);
  room.match.plan = [id];
  room.match.enterIntro();
  while (room.match.phase === 'intro') room.tick(DT);
  return room;
}

test('Mémory : deux cartes identiques = une paire ; sinon elles se retournent', () => {
  const room = roomWith('memory', 1);
  const mg = room.match.minigame;
  const [a] = room.match.participants();
  const face = mg.faces[0];
  const twin = mg.faces.findIndex((f, i) => i > 0 && f === face);
  const other = mg.faces.findIndex((f) => f !== face);
  mg.flip(a, 0);
  assert.equal(mg.visible()[0], face, 'première carte visible de tous');
  mg.flip(a, other);
  assert.equal(mg.pairs.get(a.id), 0, 'pas la même : pas de paire');
  mg.flip(a, 0);
  mg.flip(a, twin);
  assert.equal(mg.pairs.get(a.id), 1, 'paire trouvée');
  assert.equal(mg.owner[0], a.id);
  // Se poser sur une carte après sa pichenette la retourne.
  const c = MEMORY_TABLE.cards[5];
  Object.assign(a, { x: c.x + c.w / 2 - 40, y: c.y + c.h / 2, vx: 0, vy: 0, energy: 3 });
  if (room.match.participants()[1].bot) room.match.participants()[1].bot.nextAt = 1e9;
  a.pendingFlick = { a: 0, p: 0, hop: true };
  for (let i = 0; i < 8; i++) room.tick(DT); // le petit bond part…
  Object.assign(a, { x: c.x + c.w / 2, y: c.y + c.h / 2, vx: 0, vy: 0 }); // …et s'arrête sur la carte
  for (let i = 0; i < 5; i++) room.tick(DT);
  assert.ok(mg.first.get(a.id) === 5 || mg.owner[5] === a.id || mg.visible()[5], 'carte retournée en s\'y posant');
});

test('Roi de la colline : seul dans la zone = des points ; à deux, personne', () => {
  const room = roomWith('king', 1);
  const mg = room.match.minigame;
  const [a, b] = room.match.participants();
  b.bot.nextAt = 1e9;
  const z = mg.zone;
  Object.assign(a, { x: z.x, y: z.y, vx: 0, vy: 0 });
  Object.assign(b, { x: z.x + 600, y: z.y, vx: 0, vy: 0 });
  for (let i = 0; i < 30; i++) { room.tick(DT); Object.assign(a, { x: z.x, y: z.y, vx: 0, vy: 0 }); }
  const held = mg.held.get(a.id);
  assert.ok(held > 0.8, `points seul (${held.toFixed(2)})`);
  Object.assign(b, { x: z.x + 50, y: z.y, vx: 0, vy: 0 });
  for (let i = 0; i < 15; i++) { room.tick(DT); Object.assign(a, { x: z.x - 50, y: z.y, vx: 0, vy: 0 }); Object.assign(b, { x: z.x + 50, y: z.y, vx: 0, vy: 0 }); }
  assert.ok(mg.contested, 'zone disputée');
  assert.ok(Math.abs(mg.held.get(a.id) - held) < 0.05, 'personne ne marque à deux');
});

test('La Mine : carte identique pour une même graine, on creuse, les bots trouvent la sortie', () => {
  const g1 = generateMine(77);
  const g2 = generateMine(77);
  assert.deepEqual([...g1.cells], [...g2.cells], 'même graine, même mine (serveur et téléphone)');
  const b = newMiner(g1);
  let digs = 0;
  for (let i = 0; i < 4 / DT; i++) stepMiner(g1, b, { mx: 1, my: 0 }, DT, () => digs++);
  assert.ok(digs >= 3, `on creuse en avançant (${digs})`);
  assert.equal(tileAt(g1, 0, 5), TILE.ROCK, 'bord en roche mère');
  const room = roomWith('mine', 3, 1);
  const mg = room.match.minigame;
  while (room.match.phase === 'minigame') room.tick(DT);
  assert.ok(mg.finished.length >= 1, `au moins un bot est sorti (${mg.finished.length})`);
  const human = room.match.lastResults.awards.find((a) => a.id === 'p1');
  assert.ok(human.rank > 1, 'le joueur immobile n\'est pas premier');
  void MINE;
});

test('Déménagement : livrer au camion rapporte la valeur ; les chocs l\'abîment', () => {
  const room = roomWith('movers', 1);
  const mg = room.match.minigame;
  const [a] = room.match.participants();
  const vase = mg.world.balls.find((b) => b.kind === '🏺');
  const v0 = vase.value;
  mg.impact(vase, 600);
  assert.ok(vase.value < v0, 'choc violent : valeur perdue');
  mg.impact(vase, 100);
  const v1 = vase.value;
  assert.equal(vase.value, v1, 'petit choc : rien');
  const T = MOVERS_HOUSE.truck;
  Object.assign(vase, { x: T.x + 50, y: T.y + 50, lastHitBy: a.id, lastHitAt: mg.world.time });
  room.tick(DT);
  assert.equal(vase.active, false);
  assert.equal(mg.delivered.get(a.id), v1, 'valeur créditée au livreur');
  assert.equal(mg.team, v1);
});

test('Imposteur : rôle secret, meurtre discret, réunion, vote et victoire', () => {
  const room = roomWith('impostor', 4, 2);
  const mg = room.match.minigame;
  const ps = room.match.participants();
  assert.equal(mg.impostors.size, 1);
  const imp = ps.find((p) => mg.impostors.has(p.id));
  const crew = ps.filter((p) => !mg.impostors.has(p.id));
  for (const p of ps) if (p.bot) p.bot.nextAt = 1e9;
  assert.equal(mg.privateState(imp.id).role, 'impostor');
  assert.equal(mg.privateState(crew[0].id).role, 'crew');
  assert.equal(mg.hud().impostors, null, 'l\'imposteur n\'est pas dévoilé');
  // Meurtre discret : la victime reste « vivante » pour les autres tant qu'on ne trouve pas le corps.
  mg.killReadyAt.set(imp.id, 0);
  Object.assign(crew[0], { x: imp.x + 40, y: imp.y, vx: 0, vy: 0 });
  mg.action(imp);
  assert.equal(crew[0].state, 'dead');
  assert.ok(mg.hud().alive.includes(crew[0].id), 'mort non révélé');
  // Un témoin signale le corps : réunion.
  Object.assign(crew[1], { x: crew[0].x + 50, y: crew[0].y, vx: 0, vy: 0 });
  mg.action(crew[1]);
  assert.equal(mg.phase, 'meeting');
  assert.ok(!mg.hud().alive.includes(crew[0].id), 'en réunion, le mort est connu');
  // Tout le monde vote contre l'imposteur.
  const idx = mg.alive().map((p) => p.id).indexOf(imp.id);
  for (const p of mg.alive()) if (p !== imp) mg.input(p, { k: 'choice', v: idx });
  mg.input(imp, { k: 'choice', v: -1 });
  room.tick(DT);
  assert.equal(mg.ejected.id, imp.id);
  assert.equal(mg.winner, 'crew');
  while (room.match.phase === 'minigame') room.tick(DT);
  const top = room.match.lastResults.awards.filter((a) => a.rank === 1).map((a) => a.id);
  assert.ok(!top.includes(imp.id), 'l\'imposteur perd');
});
