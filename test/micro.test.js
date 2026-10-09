import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MICROS, MICRO_BY_ID } from '../shared/game/minigames/micros.js';
import { GameRoom } from '../shared/game/GameRoom.js';
import { createRng } from '../shared/rng.js';
import { DT } from '../shared/constants.js';

const P = (id) => ({ id, state: 'alive', x: 0, y: 0 });

// Le geste idéal pour chaque micro-jeu non physique.
function play(id, inst, p, start) {
  const d = inst.data;
  switch (id) {
    case 'pump': for (let i = 0; i < d.need; i++) inst.input(p, { k: 'tap' }, start + 0.05 * (i + 1)); break;
    case 'draw': inst.input(p, { k: 'tap', at: d.signalAt + 0.2 }, d.signalAt + 0.2); break;
    case 'stroop': inst.input(p, { k: 'choice', v: d.options.findIndex((o) => o.hex === d.ink) }, start + 1); break;
    case 'count': inst.input(p, { k: 'choice', v: d.options.indexOf(d.items.length) }, start + 2); break;
    case 'snap': {
      for (let t = start; t < start + inst.duration; t += 0.005) {
        const pos = 0.5 + 0.45 * Math.sin(((t - d.start) / d.period) * Math.PI * 2 + d.phase);
        if (Math.abs(pos - d.zone) < d.width * 0.3) { inst.input(p, { k: 'tap', at: t }, t); break; }
      }
      break;
    }
    case 'wind': for (let i = 1; i <= 40; i++) inst.input(p, { k: 'wind', v: 0.1 }, start + i * 0.08); break;
    default: break;
  }
}

test('chaque micro-jeu simple se gagne avec le bon geste et se perd sans', () => {
  for (const def of MICROS.filter((m) => !m.physics)) {
    for (const speed of [1, 1.66]) {
      const inst = def.create({ rng: createRng(7), speed, start: 100 });
      const good = P('a');
      const idle = P('b');
      play(def.id, inst, good, 100);
      assert.ok(inst.won(good), `${def.id} gagné (vitesse ${speed})`);
      assert.ok(!inst.won(idle), `${def.id} perdu sans geste`);
    }
  }
});

test('anti-triche : faux départ, horodatage invraisemblable, tapes trop rapides', () => {
  const draw = MICRO_BY_ID.get('draw').create({ rng: createRng(3), speed: 1, start: 100 });
  const early = P('a');
  draw.input(early, { k: 'tap', at: draw.data.signalAt - 0.1 }, draw.data.signalAt - 0.1);
  draw.input(early, { k: 'tap', at: draw.data.signalAt + 0.1 }, draw.data.signalAt + 0.1);
  assert.ok(!draw.won(early), 'faux départ définitif');
  const liar = P('b');
  // Prétendre avoir tapé pile au signal alors que le message arrive 2 s plus tard : refusé.
  draw.input(liar, { k: 'tap', at: draw.data.signalAt + 0.1 }, draw.data.signalAt + 2.1);
  assert.ok(!draw.won(liar), 'horodatage trop éloigné de l\'heure réelle ignoré');

  const pump = MICRO_BY_ID.get('pump').create({ rng: createRng(3), speed: 1, start: 0 });
  const spam = P('c');
  for (let i = 0; i < 100; i++) pump.input(spam, { k: 'tap' }, 0.5 + i * 0.001);
  assert.ok(pump.progress(spam).taps < 5, 'rafale de tapes simultanées limitée');

  const wind = MICRO_BY_ID.get('wind').create({ rng: createRng(3), speed: 1, start: 0 });
  const spin = P('d');
  wind.input(spin, { k: 'wind', v: 10 }, 0.1);
  assert.ok(wind.progress(spin).turns <= 0.5, 'tours impossibles refusés');
});

test('La Rafale se déroule en entier et classe aux micro-jeux réussis', () => {
  const room = new GameRoom({ code: 'MR', seed: 12 });
  room.join({ send() {} }, { name: 'H' });
  for (let i = 0; i < 4; i++) room.addBot();
  room.match.start(1);
  room.match.plan = ['micro'];
  room.match.enterIntro();
  const mg = room.match.minigame;
  assert.equal(mg.sequence.length, 10);
  assert.ok(mg.sequence.filter((id) => MICRO_BY_ID.get(id).physics).length >= 2, 'au moins deux micro-jeux physiques');
  let ticks = 0;
  while (room.match.phase === 'intro' || room.match.phase === 'minigame') { room.tick(DT); ticks++; }
  assert.ok(ticks * DT < 100, 'durée raisonnable');
  const awards = room.match.lastResults.awards;
  assert.equal(awards.length, 5);
  const wins = Object.fromEntries(mg.wins);
  const top = awards.filter((a) => a.rank === 1).map((a) => a.id);
  assert.ok(top.every((id) => wins[id] === Math.max(...Object.values(wins))), 'le meilleur score gagne');
});
