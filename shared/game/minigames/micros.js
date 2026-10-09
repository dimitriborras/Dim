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
];

export const MICRO_BY_ID = new Map(MICROS.map((m) => [m.id, m]));
