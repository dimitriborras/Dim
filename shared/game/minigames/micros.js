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
  duel: { label: 'Duel', icon: '⚔️' },
  breath: { label: 'Souffle', icon: '🌬️' },
  bluff: { label: 'Bluff', icon: '🃏' },
};

// Duels : chaque joueur affronte un adversaire désigné (`pairs` : id -> id adverse).
// Avec un nombre impair, le dernier affronte un « fantôme » piloté comme un bot.
export const GHOST_ID = 'ghost';
const ghostPlayer = () => ({ id: GHOST_ID, state: 'alive', bot: { skill: 0.55 } });
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function duelSetup(pairs) {
  // Paires dans les deux sens : le fantôme aussi connaît son adversaire.
  const both = new Map();
  for (const [a, b] of pairs ?? []) { both.set(a, b); both.set(b, a); }
  const opp = (p) => both.get(p.id) ?? null;
  const ghosts = pairs && [...pairs.values()].includes(GHOST_ID) ? [ghostPlayer()] : [];
  return { opp, ghosts, data: Object.fromEntries(pairs ?? []) };
}

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

// ------------------------------------------------------------ souffle
// Le téléphone écoute le micro (niveau sonore au-dessus du bruit ambiant) ; sans micro,
// on « souffle » en frottant l'écran. Le serveur ne reçoit qu'une intensité 0..1 et plafonne
// le débit : impossible d'éteindre les bougies plus vite qu'un vrai souffle.
MICROS.push({
  id: 'blow',
  skill: 'breath',
  level: 2,
  breath: true,
  verb: 'SOUFFLE !',
  hint: 'Souffle dans le micro pour éteindre les bougies (ou frotte l\'écran).',
  create({ speed }) {
    const candles = speed > 1.3 ? 6 : 5;
    const rate = 2.6; // bougies par seconde à pleine puissance
    const st = perPlayer(() => ({ breath: 0, last: null }));
    return {
      duration: 5.2 / Math.sqrt(speed),
      data: { candles },
      input(p, msg, now) {
        if (msg.k !== 'blow') return;
        const s = st(p);
        const dt = s.last === null ? 0.1 : Math.min(0.15, Math.max(0, now - s.last));
        s.last = now;
        s.breath = Math.min(candles, s.breath + Math.max(0, Math.min(1, msg.v)) * dt * rate);
      },
      bot(p, now, rng, skill) { return rng.next() < 0.7 ? { k: 'blow', v: 0.35 + skill * 0.5 } : null; },
      progress(p) { return { out: Math.floor(st(p).breath + 1e-9), breath: Math.round(st(p).breath * 100) / 100 }; },
      won(p) { return st(p).breath >= candles - 1e-9; },
    };
  },
});

// ------------------------------------------------------------ duels
MICROS.push(
  {
    id: 'tug',
    skill: 'duel',
    level: 1,
    duel: true,
    verb: 'TIRE !',
    hint: 'Tir à la corde : tape plus vite que ton adversaire !',
    create({ speed, pairs }) {
      const { opp, ghosts, data } = duelSetup(pairs);
      const need = 12; // tapes d'avance pour gagner tout de suite
      const rope = new Map(); // clé de paire -> position (+ = côté du plus petit id)
      const last = new Map();
      const winner = new Map(); // clé de paire -> id du gagnant par K.O.
      const sign = (p, o) => (p.id < o ? 1 : -1);
      return {
        duration: 4.4 / Math.sqrt(speed),
        data: { pairs: data, need },
        ghosts,
        input(p, msg, now) {
          const o = opp(p);
          if (msg.k !== 'tap' || !o) return;
          const k = pairKey(p.id, o);
          if (winner.has(k) || now - (last.get(p.id) ?? 0) < 0.045) return;
          last.set(p.id, now);
          const r = (rope.get(k) ?? 0) + sign(p, o);
          rope.set(k, r);
          if (Math.abs(r) >= need) winner.set(k, p.id);
        },
        bot(p, now, rng, skill) { return rng.next() < 0.12 + skill * 0.14 ? { k: 'tap' } : null; },
        progress(p) {
          const o = opp(p);
          if (!o) return {};
          const k = pairKey(p.id, o);
          return { rope: ((rope.get(k) ?? 0) * sign(p, o)) / need, opp: o, ko: winner.get(k) ?? null };
        },
        won(p) {
          const o = opp(p);
          if (!o) return false;
          const k = pairKey(p.id, o);
          if (winner.has(k)) return winner.get(k) === p.id;
          return (rope.get(k) ?? 0) * sign(p, o) > 0;
        },
      };
    },
  },
  {
    id: 'western',
    skill: 'duel',
    level: 2,
    duel: true,
    verb: 'DUEL !',
    hint: 'Au signal, dégaine avant ton adversaire. Faux départ = perdu.',
    create({ rng, speed, start, pairs }) {
      const { opp, ghosts, data } = duelSetup(pairs);
      const duration = 4.4 / Math.sqrt(speed);
      const signalAt = start + rng.range(1.2, duration - 1.3);
      const at = new Map();
      const shot = (id) => at.get(id) ?? null;
      const valid = (id) => shot(id) !== null && shot(id) >= signalAt;
      return {
        duration,
        data: { pairs: data, signalAt },
        ghosts,
        input(p, msg, now) {
          if (msg.k !== 'tap' || at.has(p.id) || !opp(p)) return;
          at.set(p.id, plausible(msg.at, now) ? msg.at : now);
        },
        bot(p, now, rng, skill) {
          if (at.has(p.id)) return null;
          if (now < signalAt && rng.next() < 0.002) return { k: 'tap', at: now };
          return now >= signalAt + 0.2 + (1 - skill) * 0.45 && rng.next() < 0.35 ? { k: 'tap', at: now } : null;
        },
        progress(p) { const o = opp(p); return { at: shot(p.id), opp: o, oppAt: o ? shot(o) : null }; },
        won(p) {
          const o = opp(p);
          if (!o || !valid(p.id)) return false;
          return !valid(o) || shot(p.id) < shot(o);
        },
      };
    },
  },
  {
    id: 'rps',
    skill: 'duel',
    level: 1,
    duel: true,
    verb: 'CHIFOUMI !',
    hint: 'Pierre, feuille ou ciseaux ? Égalité : personne ne gagne.',
    create({ speed, pairs }) {
      const { opp, ghosts, data } = duelSetup(pairs);
      const pick = new Map();
      return {
        duration: 3.6 / Math.sqrt(speed),
        data: { pairs: data },
        ghosts,
        input(p, msg) {
          if (msg.k !== 'choice' || pick.has(p.id) || !opp(p)) return;
          const v = Math.round(msg.v);
          if (v >= 0 && v <= 2) pick.set(p.id, v);
        },
        bot(p, now, rng) { return !pick.has(p.id) && rng.next() < 0.05 ? { k: 'choice', v: rng.int(0, 2) } : null; },
        // Le choix adverse reste secret pendant le jeu.
        progress(p) { return { choice: pick.get(p.id) ?? null, opp: opp(p) }; },
        reveal(p) { const o = opp(p); return { choice: pick.get(p.id) ?? null, oppChoice: o ? pick.get(o) ?? null : null }; },
        won(p) {
          const o = opp(p);
          const a = pick.get(p.id);
          if (!o || a === undefined) return false;
          const b = pick.get(o);
          if (b === undefined) return true;
          return (a - b + 3) % 3 === 1; // 0 pierre, 1 feuille, 2 ciseaux : feuille bat pierre…
        },
      };
    },
  },
);

// ------------------------------------------------------------ duels physiques
// Chaque groupe (2 joueurs, 3 si nombre impair) a son îlot. À la fin, le survivant le plus
// proche du centre de son îlot l'emporte : rester planqué au bord ne paie pas.
function isleWinner(groups) {
  return (p, world) => {
    const g = groups?.get(p.id);
    if (!g || p.state !== 'alive') return false;
    const c = world.map.targets[g.island];
    const d = (q) => Math.hypot(q.x - c.x, q.y - c.y);
    const rivals = world.players.filter((q) => q !== p && groups.get(q.id)?.island === g.island && q.state === 'alive');
    return rivals.every((q) => d(p) < d(q));
  };
}
MICROS.push(
  {
    id: 'sumo',
    skill: 'duel',
    level: 2,
    duel: true,
    physics: 'sumo',
    verb: 'SUMO !',
    hint: 'Seul contre seul sur ton îlot : pousse-le dans le vide !',
    create({ speed, groups }) {
      return {
        duration: 6 / Math.sqrt(speed),
        data: { groups: groups ? Object.fromEntries([...groups].map(([id, g]) => [id, g.island])) : {} },
        input() {},
        bot() { return null; },
        progress() { return {}; },
        won: isleWinner(groups),
      };
    },
  },
  {
    id: 'curl',
    skill: 'duel',
    level: 2,
    duel: true,
    physics: 'curl',
    verb: 'PALET DUEL !',
    hint: 'Une seule pichenette chacun : le plus près du centre gagne. Tu peux dégommer l\'autre.',
    create({ speed, groups }) {
      return {
        duration: 5.5 / Math.sqrt(speed),
        data: { groups: groups ? Object.fromEntries([...groups].map(([id, g]) => [id, g.island])) : {} },
        input() {},
        bot() { return null; },
        progress() { return {}; },
        won: isleWinner(groups),
      };
    },
  },
);

// ------------------------------------------------------------ bluff
// Psychologie et tromperie : tout le monde choisit en secret, on révèle au verdict.
const CHOICES3 = ['🍕', '🍔', '🌮'];
MICROS.push(
  {
    id: 'minority',
    skill: 'bluff',
    level: 1,
    bluff: true,
    verb: 'LA MINORITÉ !',
    hint: 'Choisis en secret. Seuls ceux du choix le MOINS populaire gagnent.',
    create({ speed }) {
      const pick = new Map();
      const counts = () => {
        const c = [0, 0, 0];
        for (const v of pick.values()) c[v] += 1;
        return c;
      };
      return {
        duration: 4.2 / Math.sqrt(speed),
        data: { options: CHOICES3 },
        input(p, msg) {
          if (msg.k !== 'choice' || pick.has(p.id)) return;
          const v = Math.round(msg.v);
          if (v >= 0 && v <= 2) pick.set(p.id, v);
        },
        bot(p, now, rng) { return !pick.has(p.id) && rng.next() < 0.04 ? { k: 'choice', v: rng.int(0, 2) } : null; },
        progress(p) { return { choice: pick.get(p.id) ?? null }; },
        reveal() { return { counts: counts() }; },
        won(p) {
          if (!pick.has(p.id)) return false;
          const c = counts();
          const used = c.filter((n) => n > 0);
          const min = Math.min(...used);
          // Tout le monde au même endroit, ou égalité parfaite : personne ne se démarque.
          if (used.length < 2 || used.every((n) => n === min)) return false;
          return c[pick.get(p.id)] === min;
        },
      };
    },
  },
  {
    id: 'unique',
    skill: 'bluff',
    level: 2,
    bluff: true,
    verb: 'NOMBRE UNIQUE !',
    hint: 'Le plus PETIT nombre choisi par une seule personne gagne. Trop évident = doublon !',
    create({ speed }) {
      const pick = new Map();
      const winner = () => {
        const c = new Map();
        for (const v of pick.values()) c.set(v, (c.get(v) ?? 0) + 1);
        const uniques = [...c.entries()].filter(([, n]) => n === 1).map(([v]) => v);
        return uniques.length ? Math.min(...uniques) : null;
      };
      return {
        duration: 4.4 / Math.sqrt(speed),
        data: { options: [1, 2, 3, 4, 5] },
        input(p, msg) {
          if (msg.k !== 'choice' || pick.has(p.id)) return;
          const v = Math.round(msg.v);
          if (v >= 1 && v <= 5) pick.set(p.id, v);
        },
        // Les bots aiment les petits nombres… comme tout le monde.
        bot(p, now, rng) { return !pick.has(p.id) && rng.next() < 0.04 ? { k: 'choice', v: rng.pick([1, 1, 2, 2, 2, 3, 3, 4, 5]) } : null; },
        progress(p) { return { choice: pick.get(p.id) ?? null }; },
        reveal() {
          const c = [0, 0, 0, 0, 0];
          for (const v of pick.values()) c[v - 1] += 1;
          return { counts: c, winning: winner() };
        },
        won(p) { return pick.has(p.id) && pick.get(p.id) === winner(); },
      };
    },
  },
  {
    id: 'liar',
    skill: 'bluff',
    level: 2,
    bluff: true,
    duel: true,
    verb: 'MENTEUR ?',
    hint: 'L\'un voit la carte et l\'annonce (vrai ou faux), l\'autre le croit… ou crie « Menteur ! ».',
    create({ rng, speed, start, pairs }) {
      const { opp, ghosts, data } = duelSetup(pairs);
      // Dans chaque paire, un « annonceur » tiré au sort et un « devin ».
      const tellers = new Set();
      for (const [a, b] of pairs ?? []) {
        if (tellers.has(a) || tellers.has(b)) continue;
        tellers.add(b === GHOST_ID || rng.next() < 0.5 ? a : b);
      }
      const card = new Map(); // annonceur -> carte réelle (0 = 🍀 chance, 1 = 💀 malchance)
      for (const id of tellers) card.set(id, rng.int(0, 1));
      const claim = new Map(); // annonceur -> carte annoncée
      const verdict = new Map(); // devin -> 'believe' | 'liar'
      const split = start + 2.6 / Math.sqrt(speed); // fin de l'annonce, début du verdict
      const tellerOf = (p) => (tellers.has(p.id) ? p.id : opp(p));
      const isTeller = (p) => tellers.has(p.id);
      const lie = (t) => claim.has(t) && claim.get(t) !== card.get(t);
      return {
        duration: 6.2 / Math.sqrt(speed),
        data: { pairs: data, split, tellers: [...tellers] },
        ghosts,
        input(p, msg, now) {
          if (msg.k !== 'choice' || !opp(p)) return;
          const v = Math.round(msg.v);
          if (isTeller(p)) {
            if (now <= split + 0.15 && !claim.has(p.id) && (v === 0 || v === 1)) claim.set(p.id, v);
          } else if (now >= split - 0.1 && claim.has(opp(p)) && !verdict.has(p.id) && (v === 0 || v === 1)) {
            verdict.set(p.id, v === 1 ? 'liar' : 'believe');
          }
        },
        bot(p, now, rng) {
          if (isTeller(p)) {
            if (claim.has(p.id) || now > split - 0.4 || rng.next() > 0.08) return null;
            const c = card.get(p.id);
            return { k: 'choice', v: rng.next() < 0.45 ? 1 - c : c }; // ment presque une fois sur deux
          }
          if (verdict.has(p.id) || now < split + 0.3 || !claim.has(opp(p)) || rng.next() > 0.08) return null;
          // Un « 🍀 » est plus souvent un mensonge qu'un « 💀 » : on se méfie un peu plus.
          const suspicious = claim.get(opp(p)) === 0 ? 0.55 : 0.4;
          return { k: 'choice', v: rng.next() < suspicious ? 1 : 0 };
        },
        progress(p) {
          if (!opp(p)) return {};
          const t = tellerOf(p);
          return isTeller(p)
            ? { role: 'teller', card: card.get(p.id), claim: claim.get(p.id) ?? null, opp: opp(p) }
            : { role: 'guesser', claim: claim.get(t) ?? null, verdict: verdict.get(p.id) ?? null, opp: opp(p) };
        },
        reveal(p) {
          const t = tellerOf(p);
          return t ? { truth: card.get(t), lied: lie(t) } : {};
        },
        won(p) {
          if (!opp(p)) return false;
          const t = tellerOf(p);
          const g = isTeller(p) ? opp(p) : p.id;
          // Sans annonce, le devin gagne ; sans verdict, l'annonceur gagne.
          let guesserRight;
          if (!claim.has(t)) guesserRight = true;
          else if (!verdict.has(g)) guesserRight = false;
          else guesserRight = (verdict.get(g) === 'liar') === lie(t);
          return isTeller(p) ? !guesserRight : guesserRight;
        },
      };
    },
  },
);

export const MICRO_BY_ID = new Map(MICROS.map((m) => [m.id, m]));
