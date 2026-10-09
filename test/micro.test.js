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
    case 'moles': for (const pop of d.pops.filter((x) => !x.bomb)) { const t = (pop.from + pop.to) / 2; inst.input(p, { k: 'choice', v: pop.hole, at: t }, t); } break;
    case 'calc': {
      const [a, op, b] = d.text.split(' ');
      const r = op === '+' ? +a + +b : op === '×' ? a * b : a - b;
      inst.input(p, { k: 'choice', v: d.options.indexOf(r) }, start + 1);
      break;
    }
    case 'intrus': {
      // L'intrus est le seul élément dont la famille diffère : on le repère par élimination via won().
      for (let i = 0; i < d.items.length; i++) {
        const probe = P('probe' + i);
        inst.input(probe, { k: 'choice', v: i }, start + 1);
        if (inst.won(probe)) { inst.input(p, { k: 'choice', v: i }, start + 1); break; }
      }
      break;
    }
    case 'cups': {
      const pos = [0, 1, 2];
      for (const [a, b] of d.swaps) { const ca = pos.indexOf(a); const cb = pos.indexOf(b); pos[ca] = b; pos[cb] = a; }
      inst.input(p, { k: 'choice', v: pos[d.ball] }, start + inst.duration - 0.5);
      break;
    }
    case 'simon': d.seq.forEach((c, i) => inst.input(p, { k: 'choice', v: c }, start + inst.duration - 2 + i * 0.2)); break;
    case 'bigger': inst.input(p, { k: 'choice', v: d.piles[0].length > d.piles[1].length ? 0 : 1 }, start + 0.8); break;
    case 'aim': {
      const t = start + 1;
      const x = 0.5 + 0.38 * Math.sin(((t - d.start) / d.p1) * Math.PI * 2 + d.f1);
      const y = 0.5 + 0.34 * Math.sin(((t - d.start) / d.p2) * Math.PI * 2 + d.f2);
      inst.input(p, { k: 'tap', x, y, at: t }, t);
      break;
    }
    case 'spell': {
      // Le bon mot est celui que won() accepte (les autres sont des fautes plausibles).
      for (let i = 0; i < d.options.length; i++) {
        const probe = P('probe' + i);
        inst.input(probe, { k: 'choice', v: i }, start + 1);
        if (inst.won(probe)) { inst.input(p, { k: 'choice', v: i }, start + 1); break; }
      }
      break;
    }
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

test('nouveaux micro-jeux : erreurs sanctionnées', () => {
  const moles = MICRO_BY_ID.get('moles').create({ rng: createRng(5), speed: 1, start: 0 });
  const p = P('a');
  const bomb = moles.data.pops.find((x) => x.bomb);
  for (const pop of moles.data.pops.filter((x) => !x.bomb)) { const t = (pop.from + pop.to) / 2; moles.input(p, { k: 'choice', v: pop.hole, at: t }, t); }
  if (bomb) {
    const t = (bomb.from + bomb.to) / 2;
    moles.input(p, { k: 'choice', v: bomb.hole, at: t }, t);
    assert.ok(!moles.won(p), 'une bombe touchée fait perdre');
  }
  const cups = MICRO_BY_ID.get('cups').create({ rng: createRng(5), speed: 1, start: 0 });
  const early = P('b');
  cups.input(early, { k: 'choice', v: 0 }, 0.5);
  assert.equal(cups.progress(early).choice, null, 'pas de choix pendant le mélange');
  const simon = MICRO_BY_ID.get('simon').create({ rng: createRng(5), speed: 1, start: 0 });
  const s = P('c');
  simon.input(s, { k: 'choice', v: (simon.data.seq[0] + 1) % 4 }, simon.duration - 1);
  simon.input(s, { k: 'choice', v: simon.data.seq[0] }, simon.duration - 0.9);
  assert.ok(simon.progress(s).failed && !simon.won(s), 'une erreur dans la suite est définitive');
  const aim = MICRO_BY_ID.get('aim').create({ rng: createRng(5), speed: 1, start: 0 });
  const a = P('d');
  for (let i = 0; i < 5; i++) aim.input(a, { k: 'tap', x: 0.01, y: 0.99, at: 1 }, 1);
  assert.equal(aim.progress(a).tries, 3, 'trois essais au plus');
});

test('séquence de la Rafale : rampe de difficulté, capacités alternées, pauses physiques et boss', () => {
  const room = new GameRoom({ code: 'SQ', seed: 3 });
  room.join({ send() {} }, { name: 'H' });
  room.addBot();
  room.match.start(3);
  const memory = new Set();
  const mg = room.match.minigame;
  for (let seed = 1; seed <= 30; seed++) {
    const seq = mg.plan(createRng(seed), memory.size > 20 ? new Set() : memory).map((id) => MICRO_BY_ID.get(id));
    assert.equal(seq.length, 10);
    assert.equal(new Set(seq.map((m) => m.id)).size, 10, 'aucun micro-jeu en double');
    assert.deepEqual(seq.map((m, i) => (m.physics ? i : -1)).filter((i) => i >= 0), [3, 6, 9], 'physique aux manches 4, 7 et 10');
    assert.equal(seq[9].level, 3, 'boss de niveau 3');
    assert.ok(seq.slice(0, 2).every((m) => m.level === 1), 'échauffement en niveau 1');
    assert.ok(seq[8].level === 3, 'le plus dur juste avant le boss');
    for (let i = 1; i < 10; i++) assert.notEqual(seq[i].skill, seq[i - 1].skill, `capacités alternées (${seq[i - 1].id} → ${seq[i].id})`);
  }
  // Mémoire du match : la deuxième rafale évite les micro-jeux simples déjà vus quand c'est possible.
  const mem = new Set();
  const first = mg.plan(createRng(40), mem);
  const second = mg.plan(createRng(41), mem);
  const simpleRepeats = second.filter((id) => !MICRO_BY_ID.get(id).physics && first.includes(id)).length;
  assert.ok(simpleRepeats <= 3, `peu de répétitions entre rafales (${simpleRepeats})`);
});

test('le match alterne La Rafale et les mini-jeux de palet', () => {
  const room = new GameRoom({ code: 'AL', seed: 9 });
  room.join({ send() {} }, { name: 'H' });
  room.addBot();
  room.match.start(5);
  const plan = room.match.plan;
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.filter((_, i) => i % 2 === 0), ['micro', 'micro', 'micro']);
  assert.ok(plan.filter((_, i) => i % 2 === 1).every((id) => id !== 'micro'));
  assert.notEqual(plan[1], plan[3], 'deux mini-jeux de palet différents');
});

test('mini-golf : le trou fait gagner, les bots savent viser', () => {
  let holed = 0;
  let total = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const room = new GameRoom({ code: 'GO' + seed, seed });
    room.join({ send() {} }, { name: 'H' });
    for (let i = 0; i < 5; i++) room.addBot();
    room.match.start(1);
    room.match.enterIntro();
    const mg = room.match.minigame;
    mg.sequence = ['golf'];
    while (room.match.phase === 'intro') room.tick(DT);
    assert.equal(mg.world.map.id, 'golf');
    while (mg.phase !== 'result' && room.match.phase === 'minigame') room.tick(DT);
    for (const p of room.match.participants().filter((x) => x.bot)) {
      total += 1;
      if (mg.results[p.id]) { holed += 1; assert.ok(p.holed); }
    }
    const human = room.match.participants().find((x) => !x.bot);
    assert.equal(mg.results[human.id], false, 'sans jouer, pas de trou');
  }
  assert.ok(holed >= total * 0.25, `les bots rentrent souvent la balle (${holed}/${total})`);
});
