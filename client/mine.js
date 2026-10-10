// Affichage de la Mine : vue de côté, tout est noir sauf autour de sa lampe. Une flèche indique
// la sortie. La grille est régénérée ici à partir de la graine, puis tenue à jour avec les cases
// creusées envoyées par le serveur. Sa propre figurine est prédite avec la même physique que le
// serveur (shared/game/mine.js) : on creuse et on saute sans attendre le réseau.
import { MINE, TILE, generateMine, newMiner, stepMiner, cellIndex } from '../shared/game/mine.js';

const COLORS = {
  [TILE.DIRT]: ['#6b4526', '#74502c', '#5f3d21'],
  [TILE.STONE]: ['#5b606f', '#646a7a', '#535868'],
  [TILE.ROCK]: ['#24212f', '#2a2638', '#1f1c29'],
  [TILE.GOLD]: ['#5b606f', '#646a7a', '#535868'],
};
const LIGHT = 4.6; // rayon de la lampe, en cases

export class MineView {
  constructor() {
    this.seed = null;
    this.grid = null;
    this.me = null; // figurine prédite localement
    this.shown = new Map(); // id -> position affichée (lissée)
    this.fog = null;
  }

  // Appelé à chaque instantané.
  sync(snap, youId) {
    const h = snap.m.hud;
    if (h.seed !== this.seed) {
      this.seed = h.seed;
      this.grid = generateMine(h.seed);
      this.me = null;
      this.shown.clear();
    }
    for (const i of h.dug) this.grid.cells[i] = TILE.AIR;
    this.hud = h;
    this.youId = youId;
    const srv = snap.you?.micro?.mine;
    if (srv) {
      if (!this.me) this.me = { ...newMiner(this.grid), ...srv };
      // Recalage doux sur le serveur ; gros écart (ou arrêt) : on se cale franchement.
      const err = Math.hypot(srv.x - this.me.x, srv.y - this.me.y);
      if (err > 48 || h.finished.includes(youId)) Object.assign(this.me, srv);
      else { this.me.x += (srv.x - this.me.x) * 0.15; this.me.y += (srv.y - this.me.y) * 0.15; }
    }
  }

  // Appelé à chaque image.
  frame(dt, stick, playing) {
    if (!this.grid || !this.me) return;
    if (playing && !this.hud.finished.includes(this.youId)) stepMiner(this.grid, this.me, { mx: stick.x, my: stick.y }, Math.min(dt, 0.05));
    for (const [id, x, y, facing] of this.hud.miners) {
      if (id === this.youId) continue;
      const s = this.shown.get(id) ?? { x, y, facing };
      const k = Math.min(1, dt * 12);
      s.x += (x - s.x) * k;
      s.y += (y - s.y) * k;
      s.facing = facing;
      this.shown.set(id, s);
    }
  }

  draw(ctx, W, H, dpr, roster, now) {
    if (!this.grid || !this.me) return;
    const C = MINE.cell;
    const g = this.grid;
    const scale = Math.max(0.8, Math.min(2.2, Math.min(W, H) / (11 * C)));
    const camX = this.me.x;
    const camY = this.me.y;
    const toS = (x, y) => ({ x: (x - camX) * scale + W / 2, y: (y - camY) * scale + H / 2 });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0b16';
    ctx.fillRect(0, 0, W, H);
    // Cases visibles seulement.
    const x0 = Math.max(0, Math.floor((camX - W / 2 / scale) / C));
    const x1 = Math.min(g.cols - 1, Math.ceil((camX + W / 2 / scale) / C));
    const y0 = Math.max(0, Math.floor((camY - H / 2 / scale) / C));
    const y1 = Math.min(g.rows - 1, Math.ceil((camY + H / 2 / scale) / C));
    const S = C * scale + 0.5;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = g.cells[cellIndex(cx, cy)];
        const p = toS(cx * C, cy * C);
        if (t === TILE.AIR) {
          ctx.fillStyle = (cx + cy) % 2 ? '#1a1526' : '#181322';
          ctx.fillRect(p.x, p.y, S, S);
          continue;
        }
        const shade = COLORS[t][(cx * 7 + cy * 13) % 3];
        ctx.fillStyle = shade;
        ctx.fillRect(p.x, p.y, S, S);
        if (t === TILE.GOLD) {
          ctx.fillStyle = '#ffd23d';
          ctx.fillRect(p.x + S * 0.25, p.y + S * 0.3, S * 0.18, S * 0.18);
          ctx.fillRect(p.x + S * 0.6, p.y + S * 0.55, S * 0.14, S * 0.14);
        } else if (t === TILE.ROCK) {
          ctx.strokeStyle = 'rgba(160, 140, 255, 0.25)';
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x + 3, p.y + 3, S - 6, S - 6);
        } else if (t === TILE.DIRT && cy > 0 && g.cells[cellIndex(cx, cy - 1)] === TILE.AIR) {
          ctx.fillStyle = '#3e8a3a'; // un peu de mousse au-dessus de la terre
          ctx.fillRect(p.x, p.y, S, S * 0.12);
        }
      }
    }
    // La sortie : une porte lumineuse.
    const ex = toS((g.exit.x + 0.5) * C, (g.exit.y + 0.5) * C);
    ctx.font = `${Math.round(C * scale * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚪', ex.x, ex.y);
    // Fissures des cases en train d'être creusées.
    for (const [, , , , cell, prog] of this.hud.miners) {
      if (cell < 0) continue;
      const cx = cell % g.cols;
      const p = toS(cx * C, ((cell - cx) / g.cols) * C);
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + prog * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x + S * 0.2, p.y + S * 0.2); ctx.lineTo(p.x + S * 0.5, p.y + S * 0.5); ctx.lineTo(p.x + S * 0.4, p.y + S * 0.85);
      if (prog > 0.5) { ctx.moveTo(p.x + S * 0.5, p.y + S * 0.5); ctx.lineTo(p.x + S * 0.85, p.y + S * 0.35); }
      ctx.stroke();
    }
    // Figurines : les autres (lissées), puis soi.
    const drawMiner = (b, info, me) => {
      const p = toS(b.x, b.y);
      const w = MINE.w * scale;
      const h = MINE.h * scale;
      ctx.fillStyle = info?.color ?? '#fff';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, 6 * scale);
      else ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
      ctx.fill();
      ctx.fillStyle = '#111';
      const ey = p.y - h * 0.18;
      ctx.beginPath(); ctx.arc(p.x + b.facing * w * 0.12, ey, 2.2 * scale, 0, 7); ctx.arc(p.x + b.facing * w * 0.36, ey, 2.2 * scale, 0, 7); ctx.fill();
      // Casque de mineur et sa lampe.
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(p.x - w / 2, p.y - h / 2 - 3 * scale, w, 5 * scale);
      ctx.fillStyle = '#fff7c2';
      ctx.beginPath(); ctx.arc(p.x + b.facing * w * 0.45, p.y - h / 2 - 1 * scale, 3 * scale, 0, 7); ctx.fill();
      if (info) {
        ctx.font = `bold ${Math.round(11 * Math.min(1.4, scale))}px "Trebuchet MS", sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(info.name, p.x, p.y - h / 2 - 12 * scale);
        ctx.fillStyle = me ? '#ffd23d' : '#fff';
        ctx.fillText(info.name, p.x, p.y - h / 2 - 12 * scale);
      }
    };
    for (const [id, s] of this.shown) drawMiner(s, roster.get(id), false);
    drawMiner(this.me, roster.get(this.youId), true);

    // Le noir, percé par la lampe (qui vacille un peu).
    if (!this.fog || this.fog.width !== Math.round(W * dpr) || this.fog.height !== Math.round(H * dpr)) {
      this.fog = document.createElement('canvas');
      this.fog.width = Math.round(W * dpr);
      this.fog.height = Math.round(H * dpr);
    }
    const f = this.fog.getContext('2d');
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = 'rgba(0, 0, 0, 0.97)';
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    const me = toS(this.me.x, this.me.y);
    const R = LIGHT * C * scale * (1 + Math.sin(now * 9) * 0.015);
    const lg = f.createRadialGradient(me.x, me.y, R * 0.25, me.x, me.y, R);
    lg.addColorStop(0, 'rgba(0,0,0,1)');
    lg.addColorStop(0.7, 'rgba(0,0,0,0.85)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = lg;
    f.beginPath(); f.arc(me.x, me.y, R, 0, 7); f.fill();
    // La porte de sortie brille un peu dans le noir quand on s'en approche.
    const near = Math.hypot(ex.x - me.x, ex.y - me.y) < R * 2.2;
    if (near) {
      const eg = f.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, C * scale * 1.5);
      eg.addColorStop(0, 'rgba(0,0,0,0.9)');
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = eg;
      f.beginPath(); f.arc(ex.x, ex.y, C * scale * 1.5, 0, 7); f.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fog, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Flèche vers la sortie, autour de sa figurine, avec la distance.
    const a = Math.atan2(ex.y - me.y, ex.x - me.x);
    const dist = Math.round(Math.hypot((g.exit.x + 0.5) * C - this.me.x, (g.exit.y + 0.5) * C - this.me.y) / C);
    if (dist > 1) {
      const r = Math.min(W, H) * 0.2;
      const ax = me.x + Math.cos(a) * r;
      const ay = me.y + Math.sin(a) * r;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = '#ffd23d';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.restore();
      ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(`${dist} m`, ax, ay + 26);
      ctx.fillStyle = '#ffd23d';
      ctx.fillText(`${dist} m`, ax, ay + 26);
    }
  }
}
