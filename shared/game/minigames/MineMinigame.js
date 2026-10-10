import { MINE_STAGE } from '../../maps.js';
import { MINE, TILE, DIG_TIME, generateMine, newMiner, stepMiner, exitDistance, tileAt, cellIndex } from '../mine.js';
import { groupRanking } from './MinigameRegistry.js';

const TAIL = 150; // cases creusées renvoyées à chaque instantané (le reste par resynchronisation)

// La Mine (Terraria × Minecraft) : vue de côté, tout est noir sauf autour de sa lampe.
// Une flèche indique la sortie ; on avance en creusant (terre rapide, pierre lente, roche
// mère infranchissable). Les galeries creusées par les autres restent : on peut les suivre.
// Le premier sorti gagne ; les autres sont classés à la distance qu'il leur restait.
export class MineMinigame {
  static id = 'mine';
  static name = 'La Mine';
  static description = 'Tout est noir. Une flèche montre la sortie : creuse ta galerie (glisse le doigt dans une direction) et sors le premier !';
  static durationSeconds = 100;
  static controls = 'stick';

  initialize(ctx) {
    this.ctx = ctx;
    this.seed = ctx.rng.int(1, 1e9);
    this.grid = generateMine(this.seed);
    this.dug = [];
    this.miners = new Map();
    this.finished = [];
    this.world = ctx.createWorld({ map: MINE_STAGE, rules: { items: false, respawn: false }, hooks: {} });
    this.world.rules.frozen = true; // la physique de palet ne joue pas ici
    ctx.players.forEach((p, i) => {
      const b = newMiner(this.grid);
      b.x += (i % 4) * 18 - 27; // côte à côte dans la salle de départ
      this.miners.set(p.id, b);
    });
    this.brains = new Map();
  }

  start() {}

  // Itinéraire d'un bot, en tenant compte de la gravité : les nœuds sont les cases où l'on peut se
  // tenir debout. Mouvements : aller ou creuser à côté (puis tomber s'il y a du vide), creuser
  // sous ses pieds (puis tomber), monter d'une marche (creuser la case à hauteur de tête, et celle
  // au-dessus de soi si besoin). Roche mère infranchissable. Dijkstra à seaux (coûts entiers).
  path(from, salt = 0) {
    const g = this.grid;
    // Préférences propres à chaque bot : ils ne creusent pas tous la même galerie.
    const jitter = (x, y) => (salt ? ((x * 73856093) ^ (y * 19349663) ^ salt) >>> 0 : 0) % 3;
    const { cols, rows } = g;
    const air = (x, y) => tileAt(g, x, y) === TILE.AIR;
    const rock = (x, y) => tileAt(g, x, y) === TILE.ROCK;
    const dig = (x, y) => [1, 2, 3, 99, 3][tileAt(g, x, y)] + jitter(x, y);
    const land = (x, y) => { let yy = y; while (yy < rows - 2 && air(x, yy + 1)) yy += 1; return yy; };
    const start = cellIndex(from.x, land(from.x, from.y));
    const ex = g.exit.x;
    const ey = g.exit.y;
    const cost = new Map([[start, 0]]);
    const prev = new Map();
    const buckets = [[start]];
    let goal = -1;
    for (let c = 0; c < buckets.length && goal < 0 && c < 4000; c++) {
      for (const i of buckets[c] ?? []) {
        if (cost.get(i) !== c) continue;
        const x = i % cols;
        const y = (i - x) / cols;
        if (Math.abs(x - ex) <= 1 && Math.abs(y - ey) <= 1) { goal = i; break; }
        const moves = [];
        for (const d of [1, -1]) {
          const nx = x + d;
          if (!rock(nx, y)) moves.push([nx, land(nx, y), dig(nx, y)]);
          // Marche : la case à côté est pleine (elle nous porte), on passe au-dessus.
          else if (!rock(nx, y - 1) && !rock(x, y - 1) && y > 1) moves.push([nx, y - 1, dig(nx, y - 1) + dig(x, y - 1) + 2]);
          if (!air(nx, y) && !rock(nx, y - 1) && !rock(x, y - 1) && y > 1) moves.push([nx, y - 1, dig(nx, y - 1) + dig(x, y - 1) + 2]);
        }
        if (!rock(x, y + 1) && y < rows - 2) moves.push([x, land(x, y + 1), dig(x, y + 1)]);
        for (const [nx, ny, k] of moves) {
          if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1 || k >= 99) continue;
          const j = ny * cols + nx;
          const nc = c + k;
          if (nc >= (cost.get(j) ?? Infinity)) continue;
          cost.set(j, nc);
          prev.set(j, i);
          (buckets[nc] ??= []).push(j);
        }
      }
    }
    if (goal < 0) return null;
    const out = [];
    for (let i = goal; i !== start && i !== undefined; i = prev.get(i)) out.push(i);
    return out.reverse();
  }

  // Bots : ils suivent leur itinéraire case par case, à la vitesse de marche (plus vite quand ils
  // tombent), en creusant chaque case nécessaire au même rythme qu'un humain.
  botMove(p, b, dt) {
    const t = this.world.time;
    const C = MINE.cell;
    let br = this.brains.get(p.id);
    if (!br) {
      const skill = p.bot.skill ?? 0.7;
      // Les bots voient dans le noir : on compense par un rythme plus lent qu'un humain attentif.
      br = { path: null, i: 0, pause: 0, dig: null, salt: this.ctx.rng.int(1, 1e9), pace: 0.45 + skill * 0.3 };
      this.brains.set(p.id, br);
    }
    b.ground = true;
    if (t < br.pause) return;
    if ((p.bot.skill ?? 0.7) < 0.75 && this.ctx.rng.next() < 0.006) br.pause = t + 0.5;
    const cx = Math.floor(b.x / C);
    const cy = Math.floor(b.y / C);
    if (!br.path) { br.path = this.path({ x: cx, y: cy }, br.salt) ?? []; br.i = 0; }
    dt *= br.pace;
    const next = br.path[br.i];
    if (next === undefined) return;
    const n = this.cellOf(next);
    // Cases à dégager : la case visée, et celle au-dessus de soi pour une marche montante.
    const need = [[n.x, n.y]];
    if (n.y < cy && n.x !== cx) need.push([cx, cy - 1]);
    const block = need.find(([x, y]) => tileAt(this.grid, x, y) !== TILE.AIR);
    if (block) {
      const [x, y] = block;
      if (tileAt(this.grid, x, y) === TILE.ROCK) { br.path = null; return; }
      if (!br.dig || br.dig.x !== x || br.dig.y !== y) br.dig = { x, y, prog: 0 };
      br.dig.prog += dt;
      b.dig = { ...br.dig };
      b.facing = Math.sign(x - cx) || b.facing;
      if (br.dig.prog >= DIG_TIME[tileAt(this.grid, x, y)]) {
        this.grid.cells[cellIndex(x, y)] = TILE.AIR;
        this.dug.push(cellIndex(x, y));
        this.world.emit('dig', { id: p.id, x, y });
        br.dig = null;
        b.dig = null;
      }
      return;
    }
    // Avancer vers le centre de la case (le bas du corps posé sur le sol de la case).
    const tx = (n.x + 0.5) * C;
    const ty = (n.y + 1) * C - MINE.h / 2;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const d = Math.hypot(dx, dy);
    const speed = dy > 4 ? MINE.walk * 2 : MINE.walk;
    if (dx) b.facing = Math.sign(dx);
    if (d <= speed * dt) { b.x = tx; b.y = ty; br.i += 1; } else { b.x += (dx / d) * speed * dt; b.y += (dy / d) * speed * dt; }
  }

  cellOf(i) {
    const x = i % this.grid.cols;
    const y = (i - x) / this.grid.cols;
    return { x, y, dist: (ax, ay) => Math.abs(ax - x) + Math.abs(ay - y) };
  }

  update(dt) {
    this.world.rules.frozen = true;
    const C = MINE.cell;
    for (const p of this.ctx.players) {
      const b = this.miners.get(p.id);
      if (!b || this.finished.includes(p.id) || p.connected === false) continue;
      if (p.bot) this.botMove(p, b, dt);
      else stepMiner(this.grid, b, { mx: p.input?.mx ?? 0, my: p.input?.my ?? 0 }, dt, (cx, cy) => {
        this.dug.push(cellIndex(cx, cy));
        this.world.emit('dig', { id: p.id, x: cx, y: cy });
      });
      if (Math.hypot(b.x - (this.grid.exit.x + 0.5) * C, b.y - (this.grid.exit.y + 0.5) * C) < C * 1.6) {
        this.finished.push(p.id);
        this.world.emit('finish', { id: p.id, place: this.finished.length });
      }
    }
  }

  isOver() {
    const active = this.ctx.players.filter((p) => p.connected !== false);
    return active.length > 0 && active.every((p) => this.finished.includes(p.id));
  }

  finish() {
    const finished = this.finished.map((id) => [id]);
    const rest = this.ctx.players
      .filter((p) => !this.finished.includes(p.id))
      .map((p) => ({ id: p.id, score: p.connected === false ? -1e9 : -Math.round(exitDistance(this.grid, this.miners.get(p.id)) * 10) }))
      .sort((a, b) => b.score - a.score);
    return { ranking: [...finished, ...groupRanking(rest)], summary: 'Classement à l\'arrivée, puis à la distance restante jusqu\'à la sortie.' };
  }

  hud() {
    const t = this.world.time;
    // Toutes les 3 s, la liste complète des cases creusées ; sinon seulement la fin.
    const full = Math.floor(t / 3) !== this.lastFull;
    if (full) this.lastFull = Math.floor(t / 3);
    const from = full ? 0 : Math.max(0, this.dug.length - TAIL);
    return {
      kind: 'mine',
      seed: this.seed,
      dugFrom: from,
      dug: this.dug.slice(from),
      dugCount: this.dug.length,
      exit: this.grid.exit,
      finished: this.finished.slice(),
      miners: this.ctx.players.map((p) => {
        const b = this.miners.get(p.id);
        return [p.id, Math.round(b.x), Math.round(b.y), b.facing, b.dig ? cellIndex(b.dig.x, b.dig.y) : -1, b.dig ? Math.round(Math.min(1, b.dig.prog / DIG_TIME[tileAt(this.grid, b.dig.x, b.dig.y)]) * 10) / 10 : 0];
      }),
    };
  }

  // État exact du joueur, pour que son téléphone rejoue sa propre physique sans attendre.
  privateState(playerId) {
    const b = this.miners.get(playerId);
    return b ? { mine: { x: b.x, y: b.y, vx: b.vx, vy: b.vy, ground: b.ground, facing: b.facing } } : null;
  }

  botMode() {
    return 'none';
  }

  dispose() {}
}
