// Micro-jeux à la WarioWare : un mot d'ordre, un geste, quelques secondes.
// Chaque définition fabrique une instance pour une manche de la rafale :
//
//   create({ rng, speed, start }) -> {
//     duration,                       secondes de jeu (raccourcies quand ça accélère)
//     data,                           données publiques pour l'affichage client
//     input(p, msg, now),             geste reçu (msg = { k, v, at })
//     bot(p, now, rng, skill),        geste d'un bot ou null
//     progress(p),                    état privé renvoyé au joueur
//     won(p, world),                  verdict à la fin
//   }
//
// `physics` : le micro-jeu se joue avec les figurines sur la petite table (pichenette normale).
// Les gestes horodatés (`at`, en temps serveur estimé par le client) rendent les jeux de
// réflexe équitables malgré le ping ; un écart trop grand avec l'heure réelle est refusé.

const plausible = (at, now) => Number.isFinite(at) && Math.abs(at - now) < 0.6;

// Capacités sollicitées : la rafale les alterne pour varier les plaisirs.
export const SKILLS = {
  reflex: { label: 'Réflexe', icon: '⚡' },
  speed: { label: 'Vitesse', icon: '💪' },
  reading: { label: 'Lecture', icon: '👓' },
  observation: { label: 'Observation', icon: '👁️' },
  timing: { label: 'Timing', icon: '⏱️' },
  memory: { label: 'Mémoire', icon: '🧠' },
  math: { label: 'Calcul', icon: '🔢' },
  precision: { label: 'Précision', icon: '🎯' },
  language: { label: 'Langage', icon: '🗣️' },
  physics: { label: 'Physique', icon: '🎱' },
};

function perPlayer(init) {
  const m = new Map();
  return (p) => {
    if (!m.has(p.id)) m.set(p.id, init());
    return m.get(p.id);
  };
}

const COLORS = [
  { name: 'ROUGE', hex: '#ff4d4d' },
  { name: 'BLEU', hex: '#3d8bff' },
  { name: 'VERT', hex: '#3ddc84' },
  { name: 'JAUNE', hex: '#ffd23d' },
];

export const MICROS = [
  {
    id: 'pump',
    skill: 'speed',
    level: 1,
    verb: 'GONFLE !',
    hint: 'Tape vite, vite, vite !',
    create({ speed }) {
      const need = 11;
      const st = perPlayer(() => ({ taps: 0, last: 0 }));
      return {
        duration: 4 / speed,
        data: { need },
        input(p, msg, now) {
          if (msg.k !== 'tap') return;
          const s = st(p);
          if (now - s.last < 0.045) return; // au plus ~22 tapes par seconde
          s.last = now;
          s.taps += 1;
        },
        bot(p, now, rng, skill) { return rng.next() < 0.1 + skill * 0.12 ? { k: 'tap' } : null; },
        progress(p) { return { taps: st(p).taps }; },
        won(p) { return st(p).taps >= need; },
      };
    },
  },
  {
    id: 'draw',
    skill: 'reflex',
    level: 1,
    verb: 'DÉGAINE !',
    hint: 'Attends le signal… puis tape ! Pas de faux départ.',
    create({ rng, speed, start }) {
      const duration = 4.2 / Math.sqrt(speed);
      const signalAt = start + rng.range(1.0, duration - 1.4);
      const window = 0.85 / Math.sqrt(speed);
      const st = perPlayer(() => ({ at: null }));
      return {
        duration,
        data: { signalAt, window },
        input(p, msg, now) {
          if (msg.k !== 'tap' || st(p).at !== null) return;
          st(p).at = plausible(msg.at, now) ? msg.at : now;
        },
        bot(p, now, rng, skill) {
          if (st(p).at !== null) return null;
          if (now < signalAt && rng.next() < 0.002 * (1.2 - skill)) return { k: 'tap', at: now }; // faux départ
          if (now >= signalAt + 0.18 + (1 - skill) * 0.5 && rng.next() < 0.3) return { k: 'tap', at: now };
          return null;
        },
        progress(p) { return { at: st(p).at }; },
        won(p) { const at = st(p).at; return at !== null && at >= signalAt && at <= signalAt + window; },
      };
    },
  },
  {
    id: 'stroop',
    skill: 'reading',
    level: 2,
    verb: 'COULEUR !',
    hint: 'Touche la COULEUR de l\'encre, pas le mot !',
    create({ rng, speed }) {
      const word = rng.int(0, COLORS.length - 1);
      let ink = rng.int(0, COLORS.length - 1);
      if (ink === word) ink = (ink + 1 + rng.int(0, 2)) % COLORS.length;
      const others = rng.shuffle(COLORS.map((_, i) => i).filter((i) => i !== ink)).slice(0, 2);
      const options = rng.shuffle([ink, ...others]);
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 3.6 / speed,
        data: { word: COLORS[word].name, ink: COLORS[ink].hex, options: options.map((i) => COLORS[i]) },
        input(p, msg) {
          if (msg.k !== 'choice' || st(p).choice !== null) return;
          const i = Math.round(msg.v);
          if (i >= 0 && i < options.length) st(p).choice = options[i];
        },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.05) return null;
          const right = options.indexOf(ink);
          return { k: 'choice', v: rng.next() < 0.35 + skill * 0.45 ? right : (right + 1) % options.length };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === ink; },
      };
    },
  },
  {
    id: 'count',
    skill: 'observation',
    level: 2,
    verb: 'COMPTE !',
    hint: 'Combien de canards ?',
    create({ rng, speed }) {
      const n = rng.int(3, 8);
      const items = Array.from({ length: n }, () => ({ x: rng.range(0.08, 0.92), y: rng.range(0.1, 0.9), r: rng.range(-0.4, 0.4) }));
      const options = rng.shuffle([n, n + (rng.next() < 0.5 ? 1 : -1), n + (rng.next() < 0.5 ? 2 : -2)]);
      const showFor = 1.5 / speed;
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 4.4 / speed,
        data: { items, options, showFor, emoji: '🐤' },
        input(p, msg) {
          if (msg.k !== 'choice' || st(p).choice !== null) return;
          const i = Math.round(msg.v);
          if (i >= 0 && i < options.length) st(p).choice = options[i];
        },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.04) return null;
          const right = options.indexOf(n);
          return { k: 'choice', v: rng.next() < 0.35 + skill * 0.45 ? right : (right + 1) % 3 };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === n; },
      };
    },
  },
  {
    id: 'snap',
    skill: 'timing',
    level: 2,
    verb: 'EMBOÎTE !',
    hint: 'Tape quand la brique est au-dessus du trou.',
    create({ rng, speed, start }) {
      const period = 1.8 / speed;
      const zone = rng.range(0.25, 0.75);
      const width = 0.22;
      const phase = rng.range(0, Math.PI * 2);
      const pos = (t) => 0.5 + 0.45 * Math.sin(((t - start) / period) * Math.PI * 2 + phase);
      const st = perPlayer(() => ({ at: null }));
      return {
        duration: 4 / Math.sqrt(speed),
        data: { period, zone, width, phase, start },
        input(p, msg, now) {
          if (msg.k !== 'tap' || st(p).at !== null) return;
          st(p).at = plausible(msg.at, now) ? msg.at : now;
        },
        bot(p, now, rng, skill) {
          if (st(p).at !== null) return null;
          const err = (1 - skill) * 0.18 * (rng.next() - 0.5);
          return Math.abs(pos(now) - zone + err) < width * 0.4 && rng.next() < 0.7 ? { k: 'tap', at: now } : null;
        },
        progress(p) { return { at: st(p).at }; },
        won(p) { const at = st(p).at; return at !== null && Math.abs(pos(at) - zone) <= width / 2; },
      };
    },
  },
  {
    id: 'wind',
    skill: 'speed',
    level: 1,
    verb: 'REMONTE !',
    hint: 'Fais tourner la clé avec ton doigt.',
    create({ speed }) {
      const need = 2.5;
      const st = perPlayer(() => ({ turns: 0, last: 0 }));
      return {
        duration: 4.2 / speed,
        data: { need },
        input(p, msg, now) {
          if (msg.k !== 'wind') return;
          const s = st(p);
          const dt = Math.max(0.03, now - s.last);
          s.last = now;
          // Au plus ~5 tours par seconde : un humain ne tourne pas plus vite.
          s.turns += Math.max(0, Math.min(Math.abs(msg.v), 5 * dt, 0.5));
        },
        bot(p, now, rng, skill) { return rng.next() < 0.6 ? { k: 'wind', v: 0.06 + skill * 0.06 } : null; },
        progress(p) { return { turns: Math.round(st(p).turns * 100) / 100 }; },
        won(p) { return st(p).turns >= need; },
      };
    },
  },
  {
    id: 'circle',
    skill: 'physics',
    level: 2,
    verb: 'DANS LE CERCLE !',
    hint: 'Finis ta glissade dans la cible (et pousse les autres dehors).',
    physics: 'circle',
    create({ speed }) {
      return {
        duration: 5.5 / Math.sqrt(speed),
        data: { radius: 85 },
        input() {},
        bot() { return null; },
        progress() { return {}; },
        won(p, world) {
          const c = world.map.center;
          return p.state === 'alive' && Math.hypot(p.x - c.x, p.y - c.y) <= 85;
        },
      };
    },
  },
  {
    id: 'survive',
    skill: 'physics',
    level: 2,
    verb: 'RESTE SUR LA TABLE !',
    hint: 'Ne tombe pas. Pousse les autres.',
    physics: 'survive',
    create({ speed }) {
      return {
        duration: 6 / Math.sqrt(speed),
        data: {},
        input() {},
        bot() { return null; },
        progress() { return {}; },
        won(p) { return p.state === 'alive'; },
      };
    },
  },
  {
    id: 'moles',
    skill: 'reflex',
    level: 2,
    verb: 'TAPE LES TAUPES !',
    hint: 'Tape 3 taupes 🐹… mais jamais une bombe 💣 !',
    create({ rng, speed, start }) {
      const duration = 4.6 / Math.sqrt(speed);
      const need = 3;
      // Apparitions planifiées : trou (0 à 8), début, fin, bombe ou non.
      const pops = [];
      let t = start + 0.35;
      while (t < start + duration - 0.35) {
        const life = rng.range(0.55, 0.85) / Math.sqrt(speed);
        pops.push({ hole: rng.int(0, 8), from: t, to: t + life, bomb: rng.next() < 0.3 });
        t += rng.range(0.28, 0.45) / Math.sqrt(speed);
      }
      const at = (hole, time) => pops.find((p) => p.hole === hole && time >= p.from && time <= p.to) ?? null;
      const st = perPlayer(() => ({ hits: new Set(), bomb: false }));
      return {
        duration,
        data: { pops },
        input(p, msg, now) {
          if (msg.k !== 'choice') return;
          const time = plausible(msg.at, now) ? msg.at : now;
          const pop = at(Math.round(msg.v), time);
          if (!pop) return;
          if (pop.bomb) st(p).bomb = true;
          else st(p).hits.add(pops.indexOf(pop));
        },
        bot(p, now, rng, skill) {
          if (st(p).hits.size >= need || rng.next() > 0.25) return null;
          const visible = pops.filter((x) => now >= x.from + 0.25 - skill * 0.1 && now <= x.to);
          const pick = visible[Math.floor(rng.next() * visible.length)];
          if (!pick || (pick.bomb && rng.next() > 0.08)) return null;
          return { k: 'choice', v: pick.hole, at: now };
        },
        progress(p) { return { hits: st(p).hits.size, bomb: st(p).bomb }; },
        won(p) { return st(p).hits.size >= need && !st(p).bomb; },
      };
    },
  },
  {
    id: 'calc',
    skill: 'math',
    level: 2,
    verb: 'CALCULE !',
    hint: 'Vite, le bon résultat !',
    create({ rng, speed }) {
      const hard = speed > 1.3;
      let a; let b; let op; let res;
      if (hard && rng.next() < 0.5) { a = rng.int(2, 9); b = rng.int(2, 9); op = '×'; res = a * b; }
      else if (rng.next() < 0.5) { b = rng.int(2, 9); a = b + rng.int(2, 12); op = '−'; res = a - b; }
      else { a = rng.int(3, 15); b = rng.int(2, 12); op = '+'; res = a + b; }
      const wrong = new Set();
      while (wrong.size < 2) { const w = res + rng.int(-3, 3); if (w !== res && w >= 0) wrong.add(w); }
      const options = rng.shuffle([res, ...wrong]);
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 4.2 / speed,
        data: { text: `${a} ${op} ${b}`, options },
        input(p, msg) { if (msg.k === 'choice' && st(p).choice === null) st(p).choice = options[Math.round(msg.v)] ?? -1; },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.04) return null;
          const right = options.indexOf(res);
          return { k: 'choice', v: rng.next() < 0.4 + skill * 0.45 ? right : (right + 1) % 3 };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === res; },
      };
    },
  },
  {
    id: 'intrus',
    skill: 'observation',
    level: 1,
    verb: "L'INTRUS !",
    hint: "Touche celui qui n'a rien à faire là.",
    create({ rng, speed }) {
      const families = [
        ['🍎', '🍐', '🍌', '🍇', '🍓', '🍒'], ['🚗', '🚌', '🚲', '🚜', '🚒', '🛵'], ['🐶', '🐱', '🐭', '🐰', '🦊', '🐻'],
        ['⚽', '🏀', '🎾', '🏈', '🏐', '🎱'], ['🎸', '🎺', '🥁', '🎻', '🎷', '🪗'], ['🌵', '🌲', '🌴', '🌻', '🌷', '🍄'],
      ];
      const fi = rng.int(0, families.length - 1);
      let oi = rng.int(0, families.length - 2);
      if (oi >= fi) oi += 1;
      const same = rng.shuffle(families[fi]).slice(0, 3);
      const odd = rng.pick(families[oi]);
      const items = rng.shuffle([...same, odd]);
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 3.6 / speed,
        data: { items },
        input(p, msg) { if (msg.k === 'choice' && st(p).choice === null) st(p).choice = items[Math.round(msg.v)] ?? null; },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.05) return null;
          const right = items.indexOf(odd);
          return { k: 'choice', v: rng.next() < 0.5 + skill * 0.4 ? right : (right + 1) % 4 };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === odd; },
      };
    },
  },
  {
    id: 'cups',
    skill: 'observation',
    level: 3,
    verb: 'SUIS LA BILLE !',
    hint: 'Garde l\'œil sur le gobelet qui cache la bille.',
    create({ rng, speed, start }) {
      const reveal = 0.9;
      const swapTime = 0.42 / speed;
      const n = 3 + Math.round(speed * 1.5);
      const swaps = Array.from({ length: n }, () => { const a = rng.int(0, 2); return [a, (a + rng.int(1, 2)) % 3]; });
      // Chaque gobelet garde son identité ; on suit la position de celui qui cache la bille.
      const ball = rng.int(0, 2);
      const pos = [0, 1, 2]; // pos[gobelet] = emplacement
      for (const [a, b] of swaps) {
        const ca = pos.indexOf(a);
        const cb = pos.indexOf(b);
        pos[ca] = b;
        pos[cb] = a;
      }
      const answer = pos[ball]; // emplacement final de la bille
      const shuffleEnd = start + reveal + n * swapTime;
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: reveal + n * swapTime + 2.2,
        data: { start, reveal, swapTime, swaps, ball },
        input(p, msg, now) {
          if (msg.k !== 'choice' || st(p).choice !== null || now < shuffleEnd - 0.1) return;
          st(p).choice = Math.round(msg.v);
        },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || now < shuffleEnd + 0.3 || rng.next() > 0.06) return null;
          return { k: 'choice', v: rng.next() < 0.3 + skill * 0.5 ? answer : (answer + 1 + rng.int(0, 1)) % 3 };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === answer; },
      };
    },
  },
  {
    id: 'simon',
    skill: 'memory',
    level: 3,
    verb: 'RÉPÈTE !',
    hint: 'Retiens la suite de couleurs, puis rejoue-la.',
    create({ rng, speed, start }) {
      const len = speed > 1.3 ? 4 : 3;
      const step = 0.55 / Math.sqrt(speed);
      const seq = Array.from({ length: len }, () => rng.int(0, 3));
      const showEnd = start + 0.4 + len * step;
      const st = perPlayer(() => ({ i: 0, failed: false }));
      return {
        duration: 0.4 + len * step + 2.6,
        data: { seq, start, step },
        input(p, msg, now) {
          const s = st(p);
          if (msg.k !== 'choice' || s.failed || s.i >= len || now < showEnd - 0.1) return;
          if (Math.round(msg.v) === seq[s.i]) s.i += 1;
          else s.failed = true;
        },
        bot(p, now, rng, skill) {
          const s = st(p);
          if (s.failed || s.i >= len || now < showEnd + 0.3 || rng.next() > 0.3) return null;
          return { k: 'choice', v: rng.next() < 0.75 + skill * 0.2 ? seq[s.i] : (seq[s.i] + 1) % 4 };
        },
        progress(p) { return { i: st(p).i, failed: st(p).failed }; },
        won(p) { return !st(p).failed && st(p).i >= len; },
      };
    },
  },
  {
    id: 'bigger',
    skill: 'observation',
    level: 1,
    verb: 'LE PLUS GROS TAS !',
    hint: 'Où y a-t-il le plus de bonbons ? Pas le temps de compter !',
    create({ rng, speed }) {
      const a = rng.int(9, 22);
      let b = a + (rng.next() < 0.5 ? 1 : -1) * rng.int(3, 7);
      b = Math.max(4, b);
      const dots = (n) => Array.from({ length: n }, () => [rng.range(0.08, 0.92), rng.range(0.1, 0.9)]);
      const piles = [dots(a), dots(b)];
      const answer = a > b ? 0 : 1;
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 2.8 / speed,
        data: { piles, emoji: '🍬' },
        input(p, msg) { if (msg.k === 'choice' && st(p).choice === null) st(p).choice = Math.round(msg.v); },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.07) return null;
          return { k: 'choice', v: rng.next() < 0.5 + skill * 0.45 ? answer : 1 - answer };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === answer; },
      };
    },
  },
  {
    id: 'aim',
    skill: 'precision',
    level: 2,
    verb: 'VISE !',
    hint: 'Touche la cible qui bouge. Trois essais.',
    create({ rng, speed, start }) {
      const p1 = rng.range(1.6, 2.2) / speed;
      const p2 = rng.range(1.1, 1.6) / speed;
      const f1 = rng.range(0, 6.28);
      const f2 = rng.range(0, 6.28);
      const r = 0.1;
      const pos = (t) => ({
        x: 0.5 + 0.38 * Math.sin(((t - start) / p1) * Math.PI * 2 + f1),
        y: 0.5 + 0.34 * Math.sin(((t - start) / p2) * Math.PI * 2 + f2),
      });
      const st = perPlayer(() => ({ tries: 0, hit: false }));
      return {
        duration: 4 / Math.sqrt(speed),
        data: { start, p1, p2, f1, f2, r },
        input(p, msg, now) {
          const s = st(p);
          if (msg.k !== 'tap' || s.hit || s.tries >= 3 || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
          s.tries += 1;
          const q = pos(plausible(msg.at, now) ? msg.at : now);
          // Un peu de tolérance : le doigt cache la cible.
          if (Math.hypot(q.x - msg.x, (q.y - msg.y) * 0.75) < r * 1.3) s.hit = true;
        },
        bot(p, now, rng, skill) {
          const s = st(p);
          if (s.hit || s.tries >= 3 || rng.next() > 0.08) return null;
          const q = pos(now);
          const err = (1.2 - skill) * 0.12;
          return { k: 'tap', x: q.x + rng.range(-err, err), y: q.y + rng.range(-err, err), at: now };
        },
        progress(p) { return { tries: st(p).tries, hit: st(p).hit }; },
        won(p) { return st(p).hit; },
      };
    },
  },
  {
    id: 'spell',
    skill: 'language',
    level: 2,
    verb: 'ORTHOGRAPHE !',
    hint: 'Choisis le mot bien écrit.',
    create({ rng, speed }) {
      const WORDS = [
        ['🐘', 'ÉLÉPHANT', 'ÉLÉFANT', 'ÉLÉPHAN'], ['🦒', 'GIRAFE', 'GIRAFFE', 'GIRRAFE'], ['🐊', 'CROCODILE', 'CROCCODILE', 'CROQUODILE'],
        ['🦛', 'HIPPOPOTAME', 'HIPOPOTAME', 'HIPPOPOTTAME'], ['🦋', 'PAPILLON', 'PAPILION', 'PAPPILLON'], ['🐌', 'ESCARGOT', 'ESCARGO', 'ESKARGOT'],
        ['🍄', 'CHAMPIGNON', 'CHAMPIGNION', 'CHANPIGNON'], ['☂️', 'PARAPLUIE', 'PARAPLUI', 'PARRAPLUIE'], ['🦕', 'DINOSAURE', 'DINOZAURE', 'DINAUSORE'],
        ['💻', 'ORDINATEUR', 'ORDINATEURE', 'ORDINNATEUR'], ['🐿️', 'ÉCUREUIL', 'ÉCUREUILLE', 'ÉQUUREUIL'], ['🍫', 'CHOCOLAT', 'CHOCOLA', 'CHOKOLAT'],
      ];
      const [emoji, right, ...bad] = rng.pick(WORDS);
      const options = rng.shuffle([right, ...bad]);
      const st = perPlayer(() => ({ choice: null }));
      return {
        duration: 4 / speed,
        data: { emoji, options },
        input(p, msg) { if (msg.k === 'choice' && st(p).choice === null) st(p).choice = options[Math.round(msg.v)] ?? ''; },
        bot(p, now, rng, skill) {
          if (st(p).choice !== null || rng.next() > 0.04) return null;
          const i = options.indexOf(right);
          return { k: 'choice', v: rng.next() < 0.45 + skill * 0.45 ? i : (i + 1) % 3 };
        },
        progress(p) { return { choice: st(p).choice }; },
        won(p) { return st(p).choice === right; },
      };
    },
  },
  {
    id: 'golf',
    skill: 'physics',
    level: 3,
    verb: 'MINI-GOLF !',
    hint: 'Fais tomber ta figurine dans le trou. Dose bien ta pichenette !',
    physics: 'golf',
    create({ speed }) {
      return {
        duration: 6.5 / Math.sqrt(speed),
        data: {},
        input() {},
        bot() { return null; },
        progress() { return {}; },
        // Seule façon de « tomber » sur ce green : le trou.
        won(p) { return p.state !== 'alive' && p.holed === true; },
      };
    },
  },
];

export const MICRO_BY_ID = new Map(MICROS.map((m) => [m.id, m]));
