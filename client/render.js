// Rendu « diorama » : le bureau d'une chambre d'enfant, la nuit, vu de trois quarts.
// La simulation reste en 2D vue de dessus ; l'affichage projette le sol en perspective
// (compression verticale TILT) et dresse les objets en hauteur (z).
//
// Performance (objectif : 60 i/s sur un téléphone moyen) :
//   - le décor fixe est dessiné UNE fois dans une image hors écran, recopiée à chaque image ;
//   - briques, balles, figurines, noms et émojis sont pré-dessinés puis simplement copiés ;
//   - la résolution s'adapte toute seule si les images mettent trop de temps à venir.
import { MAPS } from '../shared/maps.js';
import { PLAYER, HAZARD } from '../shared/constants.js';
import { settings } from './settings.js';
import { TILT } from './input.js';

const WALL_COLORS = ['#ff5a5a', '#3d8bff', '#3ddc84', '#ffd23d', '#c45cff', '#ff8f3d'];
const WALL_H = 34; // hauteur des briques
const TABLE_T = 30; // épaisseur du plateau du bureau
const FALL_TIME = PLAYER.fallTime + 0.15;
const PAD_TOP = 10; // marge au-dessus du sol dans l'image du décor
const MARGIN_X = 260;
const MARGIN_TOP = 220;
const MARGIN_BOTTOM = 280;
// Silhouette d'une figurine (unités monde) : socle à (0, 0), tête vers le haut.
const FIG = { w: 46, h: 62, ax: 23, ay: 50 };

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.effects = [];
    this.cam = { x: 800, y: 500, scale: 1 };
    this.shake = 0;
    this.shx = 0;
    this.shy = 0;
    this.anim = new Map(); // état d'animation par figurine (sautillement, balancier, chute)
    this.flash = new Map(); // id -> fin du flash blanc (touché)
    this.recoil = new Map(); // id -> instant du dernier tir
    this.dmgDirs = [];
    this.hitMarkers = [];
    this.hitStopUntil = 0;
    this.lastDraw = performance.now();
    // Qualité adaptative : ratio de pixels entre 1 et celui de l'écran (max 2).
    this.maxPr = Math.min(2, devicePixelRatio || 1);
    this.pr = this.maxPr;
    this.frameTimes = [];
    this.raiseBlockedUntil = 0;
    this.cache = { key: '', static: null, sp: 1, walls: new Map(), bumpers: new Map(), figs: new Map(), labels: new Map(), emoji: new Map() };
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.pr);
    this.canvas.height = Math.round(this.H * this.pr);
    this.cache.key = '';
  }

  // Ajuste la résolution selon le temps réel entre deux images.
  adaptQuality(dtMs, now) {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 21 && this.pr > 1) {
      this.pr = Math.max(1, this.pr - 0.25);
      this.raiseBlockedUntil = now + 15;
      this.resize();
    } else if (avg < 17.5 && this.pr < this.maxPr && now > this.raiseBlockedUntil) {
      this.pr = Math.min(this.maxPr, this.pr + 0.25);
      this.raiseBlockedUntil = now + 6;
      this.resize();
    }
  }

  // ------------------------------------------------------------ caméra et projection
  // Vue tournée d'un quart de tour (téléphone en vertical) : la longueur de la table
  // s'affiche de haut en bas. Seul l'affichage pivote ; la simulation ne change pas.
  // Repère de vue : u (horizontal à l'écran), v (profondeur, compressée par TILT).
  V(x, y) {
    return this.rot ? { u: y, v: x } : { u: x, v: y };
  }

  VR(r) {
    return this.rot ? { x: r.y, y: r.x, w: r.h, h: r.w } : r;
  }

  viewDims(map) {
    return this.rot ? { w: map.height, h: map.width } : { w: map.width, h: map.height };
  }

  // Direction glissée à l'écran (en pixels) -> angle dans le monde.
  screenDirToWorld(dx, dy) {
    const du = dx;
    const dv = dy / TILT;
    return this.rot ? Math.atan2(du, dv) : Math.atan2(dv, du);
  }

  updateCamera(map, focus) {
    this.rot = this.H > this.W && !map.follow;
    const pad = 40;
    const visH = (h) => h * TILT + TABLE_T + 70;
    const dims = this.viewDims(map);
    const f = focus ? this.V(focus.x, focus.y) : null;
    if (map.compact) {
      // Petite table : cadrée en entier, centrée.
      const p0 = this.VR(map.platforms[0]);
      const scale = Math.min(this.W / (p0.w + 90), this.H / visH(p0.h + 160), 1.6);
      this.cam = { x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 + 20, scale };
      return;
    }
    const fit = Math.min(this.W / (dims.w + pad), this.H / visH(dims.h + pad));
    // Petit écran : zoom lisible et caméra qui suit le joueur si la table ne tient pas.
    const small = Math.min(this.W, this.H) < 560;
    let scale = fit;
    if (map.follow) scale = Math.min(this.H / visH(dims.h + pad), this.W / 900);
    if (small) scale = Math.max(scale, Math.min(this.W / (this.rot ? 960 : 720), this.H / visH(560)));
    const hx = this.W / 2 / scale;
    const hy = this.H / 2 / (scale * TILT);
    const following = f && (scale > fit * 1.02 || map.follow);
    // Si toute la largeur tient à l'écran, on ne suit que dans la profondeur.
    const fitsWidth = this.W / scale >= dims.w - 60;
    const tx = following && !fitsWidth ? clamp(map.follow ? f.u + 120 : f.u, Math.min(dims.w / 2, hx - 120), Math.max(dims.w / 2, dims.w - hx + 120)) : dims.w / 2;
    const ty = following ? clamp(f.v, Math.min(dims.h / 2, hy - 120), Math.max(dims.h / 2, dims.h - hy + 160)) : dims.h / 2 + 30;
    const same = Math.abs(this.cam.scale - scale) < 1e-6 && this.cam.rot === this.rot;
    const k = 0.16;
    this.cam = { x: same ? this.cam.x + (tx - this.cam.x) * k : tx, y: same ? this.cam.y + (ty - this.cam.y) * k : ty, scale, rot: this.rot };
  }

  toScreenV(u, v, z = 0) {
    const { cam } = this;
    return {
      x: (u - cam.x) * cam.scale + this.W / 2 + this.shx,
      y: ((v - cam.y) * TILT - z) * cam.scale + this.H / 2 + this.shy,
    };
  }

  toScreen(x, y, z = 0) {
    const q = this.V(x, y);
    return this.toScreenV(q.u, q.v, z);
  }

  toWorld(sx, sy) {
    const { cam } = this;
    const u = (sx - this.W / 2) / cam.scale + cam.x;
    const v = (sy - this.H / 2) / (cam.scale * TILT) + cam.y;
    return this.rot ? { x: v, y: u } : { x: u, y: v };
  }

  // Direction monde -> angle à l'écran.
  screenAngle(a) {
    const du = this.rot ? Math.sin(a) : Math.cos(a);
    const dv = this.rot ? Math.cos(a) : Math.sin(a);
    return Math.atan2(dv * TILT, du);
  }

  groundTransform() {
    const { ctx, pr, cam } = this;
    const e = pr * (this.W / 2 - cam.x * cam.scale + this.shx);
    const f = pr * (this.H / 2 - cam.y * cam.scale * TILT + this.shy);
    if (this.rot) ctx.setTransform(0, pr * cam.scale * TILT, pr * cam.scale, 0, e, f);
    else ctx.setTransform(pr * cam.scale, 0, 0, pr * cam.scale * TILT, e, f);
  }

  screenTransform() {
    this.ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
  }

  animOf(id) {
    let a = this.anim.get(id);
    if (!a) {
      a = { x: null, y: null, vx: 0, vy: 0, lean: 0, leanV: 0, hop: 0, fallStart: null, toppleDir: 1, lastFlag: '' };
      this.anim.set(id, a);
    }
    return a;
  }

  // ------------------------------------------------------------ caches
  ensureCaches(map) {
    this.currentMap = map;
    const s = this.cam.scale;
    const key = `${map.id}|${s.toFixed(5)}|${this.pr}|${this.rot}`;
    if (this.cache.key === key) return;
    this.cache.key = key;
    this.cache.walls.clear();
    this.cache.bumpers.clear();
    this.cache.figs.clear();
    this.cache.labels.clear();
    this.cache.emoji.clear();
    this.buildStatic(map, s);
  }

  // Décor fixe : parquet, ombre et tranche du bureau, plateau, rubans, tiroirs, ressorts, lampe.
  buildStatic(map, s) {
    const X0 = -MARGIN_X;
    const Y0 = -MARGIN_TOP;
    const dims = this.viewDims(map);
    const wW = dims.w + MARGIN_X * 2;
    const wH = (dims.h + MARGIN_TOP + MARGIN_BOTTOM) * TILT + PAD_TOP;
    let sp = this.pr;
    // Limite mémoire : les très grandes cartes sont dessinées un peu moins finement.
    while (wW * s * sp * wH * s * sp > 14e6 && sp > 0.5) sp -= 0.25;
    const c = makeCanvas(wW * s * sp, wH * s * sp);
    const g = c.getContext('2d', { alpha: false });
    const k = s * sp;
    // PV : repère de vue (u, v) ; P : coordonnées du monde ; ground : dessin direct en coordonnées monde.
    const PV = (u, v, z = 0) => ({ x: (u - X0) * k, y: ((v - Y0) * TILT - z + PAD_TOP) * k });
    const P = (x, y, z = 0) => { const q = this.V(x, y); return PV(q.u, q.v, z); };
    const ground = () => (this.rot
      ? g.setTransform(0, k * TILT, k, 0, -X0 * k, (-Y0 * TILT + PAD_TOP) * k)
      : g.setTransform(k, 0, 0, k * TILT, -X0 * k, (-Y0 * TILT + PAD_TOP) * k));
    const screen = () => g.setTransform(1, 0, 0, 1, 0, 0);

    // Parquet de la chambre, loin sous le bureau.
    screen();
    g.fillStyle = '#16142b';
    g.fillRect(0, 0, c.width, c.height);
    const plank = 46 * sp;
    for (let y = 0, i = 0; y < c.height; y += plank, i++) {
      g.fillStyle = i % 2 ? '#1c1934' : '#19172f';
      g.fillRect(0, y, c.width, plank - 2 * sp);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = (i * 173 * sp) % (260 * sp); x < c.width; x += 260 * sp) g.fillRect(x, y, 2 * sp, plank - 2 * sp);
    }
    if (map.theme === 'pool') this.drawPoolStatic(g, c, P, PV, ground, screen, map);
    else {
      // Ombre puis tranche avant du plateau.
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const r0 of map.platforms) {
        const r = this.VR(r0);
        const a = PV(r.x + 30, r.y + 40, -TABLE_T - 40);
        const b = PV(r.x + r.w + 30, r.y + r.h + 40, -TABLE_T - 40);
        g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      for (const r0 of map.platforms) {
        const r = this.VR(r0);
        const a = PV(r.x, r.y + r.h, 0);
        const b = PV(r.x + r.w, r.y + r.h, -TABLE_T);
        const gr = g.createLinearGradient(0, a.y, 0, b.y);
        gr.addColorStop(0, '#9a6a3c');
        gr.addColorStop(1, '#5a3a1f');
        g.fillStyle = gr;
        g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      // Plateau en bois.
      ground();
      for (const r of map.platforms) {
        g.fillStyle = '#c8955c';
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = 'rgba(110, 70, 30, 0.22)';
        g.lineWidth = 3;
        g.beginPath();
        for (let y = r.y + 26; y < r.y + r.h; y += 52) {
          g.moveTo(r.x, y);
          for (let x = r.x; x <= r.x + r.w; x += 80) g.lineTo(x, y + Math.sin((x + y) * 0.013) * 5);
        }
        g.stroke();
        g.strokeStyle = '#e2b57f';
        g.beginPath(); g.moveTo(r.x, r.y + r.h); g.lineTo(r.x + r.w, r.y + r.h); g.stroke();
      }
      if (map.hazardEdges) {
        // Ruban adhésif de chantier au bord du bureau.
        const b = HAZARD.band;
        for (const r of map.platforms) {
          const strip = (x, y, w, h) => {
            g.save();
            g.beginPath(); g.rect(x, y, w, h); g.clip();
            g.fillStyle = 'rgba(255, 210, 61, 0.5)';
            g.fillRect(x, y, w, h);
            g.fillStyle = 'rgba(30, 30, 30, 0.45)';
            for (let d = -h - w; d < w + h; d += 24) {
              g.beginPath();
              g.moveTo(x + d, y); g.lineTo(x + d + 12, y); g.lineTo(x + d + 12 + h, y + h); g.lineTo(x + d + h, y + h);
              g.closePath(); g.fill();
            }
            g.restore();
          };
          strip(r.x, r.y, r.w, b);
          strip(r.x, r.y + r.h - b, r.w, b);
          strip(r.x, r.y + b, b, r.h - 2 * b);
          strip(r.x + r.w - b, r.y + b, b, r.h - 2 * b);
        }
      }
      for (const h of map.holes) {
        g.fillStyle = '#0d0b1c';
        g.fillRect(h.x, h.y, h.w, h.h);
      }
      if (map.checkpoints) {
        g.setLineDash([12, 10]);
        g.strokeStyle = 'rgba(61, 139, 255, 0.7)';
        g.lineWidth = 5;
        for (const x of map.checkpoints.slice(1)) { g.beginPath(); g.moveTo(x, 100); g.lineTo(x, 600); g.stroke(); }
        g.setLineDash([]);
        for (let y = 100; y < 600; y += 20) {
          for (let i = 0; i < 2; i++) {
            g.fillStyle = (y / 20 + i) % 2 ? '#111' : '#fff';
            g.fillRect(map.finishX + i * 20, y, 20, 20);
          }
        }
      }
      for (const spg of map.springs) {
        g.fillStyle = '#2f9e5b';
        g.fillRect(spg.x, spg.y, spg.w, spg.h);
        g.strokeStyle = '#a6ffcb';
        g.lineWidth = 3;
        g.beginPath();
        for (let i = 0; i < 4; i++) { const yy = spg.y + 10 + i * ((spg.h - 20) / 3); g.moveTo(spg.x + 8, yy); g.lineTo(spg.x + spg.w - 8, yy); }
        g.stroke();
        g.save();
        g.translate(spg.x + spg.w / 2, spg.y + spg.h / 2);
        g.rotate(spg.dir);
        g.fillStyle = '#fff';
        g.beginPath(); g.moveTo(24, 0); g.lineTo(4, -13); g.lineTo(4, 13); g.closePath(); g.fill();
        g.restore();
      }
      // Paroi intérieure des tiroirs (face tournée vers nous).
      screen();
      for (const h0 of map.holes) {
        const h = this.VR(h0);
        const a = PV(h.x, h.y, 0);
        const b = PV(h.x + h.w, h.y, -TABLE_T);
        const gr = g.createLinearGradient(0, a.y, 0, b.y);
        gr.addColorStop(0, '#6b4524');
        gr.addColorStop(1, '#2a1a0e');
        g.fillStyle = gr;
        g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      // Cible du Palet : anneaux peints sur la piste.
      if (map.target) {
        ground();
        const t = map.target;
        const colors = ['#ff4d6d', '#ffffff', '#3d8bff'];
        for (let i = t.rings.length - 1; i >= 0; i--) {
          g.fillStyle = colors[i % colors.length];
          g.globalAlpha = 0.55;
          g.beginPath(); g.arc(t.x, t.y, t.rings[i], 0, 7); g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.lineWidth = 3;
          g.stroke();
        }
        g.fillStyle = '#2a1a0e';
        g.beginPath(); g.arc(t.x, t.y, 6, 0, 7); g.fill();
        // Ligne de lancer.
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 4;
        g.setLineDash([16, 12]);
        const lane = map.platforms[0];
        g.beginPath(); g.moveTo(lane.x + 220, lane.y + 10); g.lineTo(lane.x + 220, lane.y + lane.h - 10); g.stroke();
        g.setLineDash([]);
        screen();
      }
      // Lampe de bureau : lumière chaude dans un coin, nuit bleutée ailleurs (intégrée au décor).
      const lamp = P(map.width * 0.12, map.height * 0.05, 120);
      const R = Math.max(c.width, c.height) * 0.9;
      const gr = g.createRadialGradient(lamp.x, lamp.y, R * 0.05, lamp.x, lamp.y, R);
      gr.addColorStop(0, 'rgba(255, 200, 120, 0.14)');
      gr.addColorStop(0.45, 'rgba(20, 24, 70, 0.0)');
      gr.addColorStop(1, 'rgba(8, 10, 40, 0.4)');
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
    }

    this.cache.static = c;
    this.cache.sp = sp;
    this.cache.origin = { X0, Y0 };
  }

  // Table de billard : cadre en bois, tapis vert, poches, lampe au-dessus du tapis.
  drawPoolStatic(g, c, P, PV, ground, screen, map) {
    const f = map.felt;
    const R = 40; // largeur des bandes
    const outer = { x: f.x - R, y: f.y - R, w: f.w + 2 * R, h: f.h + 2 * R };
    const ov = this.VR(outer);
    screen();
    g.fillStyle = 'rgba(0,0,0,0.4)';
    const s0 = PV(ov.x + 40, ov.y + 60, -TABLE_T * 2 - 40);
    const s1 = PV(ov.x + ov.w + 40, ov.y + ov.h + 60, -TABLE_T * 2 - 40);
    g.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
    // Tranche avant du meuble (plus épais qu'un bureau).
    const a = PV(ov.x, ov.y + ov.h, 0);
    const b = PV(ov.x + ov.w, ov.y + ov.h, -TABLE_T * 2);
    const gr = g.createLinearGradient(0, a.y, 0, b.y);
    gr.addColorStop(0, '#6a3a1a');
    gr.addColorStop(1, '#2e170a');
    g.fillStyle = gr;
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ground();
    g.fillStyle = '#6e3f1e';
    g.fillRect(outer.x, outer.y, outer.w, outer.h);
    // Tapis.
    g.fillStyle = '#17734a';
    g.fillRect(f.x, f.y, f.w, f.h);
    const felt = g.createRadialGradient(f.x + f.w / 2, f.y + f.h / 2, 50, f.x + f.w / 2, f.y + f.h / 2, f.w * 0.65);
    felt.addColorStop(0, 'rgba(120, 230, 160, 0.22)');
    felt.addColorStop(1, 'rgba(0, 30, 15, 0.35)');
    g.fillStyle = felt;
    g.fillRect(f.x, f.y, f.w, f.h);
    // Ligne de tête et mouches.
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(f.x + f.w * 0.25, f.y); g.lineTo(f.x + f.w * 0.25, f.y + f.h); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (const sx of [0.25, 0.5, 0.75]) { g.beginPath(); g.arc(f.x + f.w * sx, f.y + f.h / 2, 5, 0, 7); g.fill(); }
    // Poches : bord en cuir puis trou noir.
    for (const pk of map.pockets) {
      g.fillStyle = '#3a2412';
      g.beginPath(); g.arc(pk.x, pk.y, pk.r + 9, 0, 7); g.fill();
      g.fillStyle = '#050307';
      g.beginPath(); g.arc(pk.x, pk.y, pk.r, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.arc(pk.x - pk.r * 0.25, pk.y - pk.r * 0.3, pk.r * 0.5, 0, 7); g.fill();
    }
    // Lampe de billard au-dessus du tapis : lumière chaude au centre, nuit autour.
    screen();
    const lamp = P(f.x + f.w / 2, f.y + f.h / 2, 0);
    const Rl = Math.max(c.width, c.height) * 0.75;
    const lg = g.createRadialGradient(lamp.x, lamp.y, Rl * 0.08, lamp.x, lamp.y, Rl);
    lg.addColorStop(0, 'rgba(255, 220, 150, 0.12)');
    lg.addColorStop(0.5, 'rgba(20, 24, 70, 0.0)');
    lg.addColorStop(1, 'rgba(8, 10, 40, 0.5)');
    g.fillStyle = lg;
    g.fillRect(0, 0, c.width, c.height);
  }

  wallHeight(w) {
    return w.style === 'rail' ? 22 : w.style === 'chalk' ? 30 : WALL_H;
  }

  wallSprite(w0, i) {
    let c = this.cache.walls.get(i);
    if (c) return c;
    const k = this.cam.scale * this.pr;
    const H = this.wallHeight(w0);
    const w = { ...this.VR(w0), style: w0.style };
    c = makeCanvas(w.w * k + 2, (w.h * TILT + H) * k + 2);
    const g = c.getContext('2d');
    g.scale(k, k);
    const topH = w.h * TILT;
    if (w.style === 'rail') {
      // Bande de billard : bois verni, coussin vert côté tapis, mouches en nacre.
      g.fillStyle = '#4e2a12';
      g.fillRect(0, topH, w.w, H);
      g.fillStyle = '#8a5530';
      g.fillRect(0, 0, w.w, topH);
      const horizontal = w.w > w.h;
      const felt = this.currentMap?.felt ? this.VR(this.currentMap.felt) : null;
      const fc = felt ? { x: felt.x + felt.w / 2, y: felt.y + felt.h / 2 } : { x: 0, y: 0 };
      g.fillStyle = '#0f5a37';
      const lip = 10;
      if (horizontal) {
        if (w.y < fc.y) g.fillRect(0, topH - lip * TILT, w.w, lip * TILT);
        else g.fillRect(0, 0, w.w, lip * TILT);
      } else if (w.x < fc.x) g.fillRect(w.w - lip, 0, lip, topH);
      else g.fillRect(0, 0, lip, topH);
      g.fillStyle = '#f2e8d0';
      const n = Math.max(1, Math.round((horizontal ? w.w : w.h) / 170));
      for (let j = 1; j <= n; j++) {
        const t = j / (n + 1);
        const x = horizontal ? w.w * t : w.w / 2;
        const y = horizontal ? topH / 2 : topH * t;
        g.beginPath(); g.ellipse(x, y, 4, 4 * TILT, 0, 0, 7); g.fill();
      }
    } else if (w.style === 'chalk') {
      // Cube de craie bleue.
      g.fillStyle = '#1f5fbf';
      g.fillRect(0, topH, w.w, H);
      g.fillStyle = '#3d8bff';
      g.fillRect(0, 0, w.w, topH);
      g.fillStyle = '#7fb3ff';
      g.beginPath(); g.ellipse(w.w / 2, topH / 2, w.w * 0.28, w.h * 0.28 * TILT, 0, 0, 7); g.fill();
    } else {
      const col = WALL_COLORS[i % WALL_COLORS.length];
      g.fillStyle = shade(col, -0.28);
      g.fillRect(0, topH, w.w, H);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, topH, w.w, 3);
      g.fillStyle = col;
      g.fillRect(0, 0, w.w, topH);
      const step = 22;
      for (let x = step / 2; x < w.w; x += step) {
        for (let y = step / 2; y < w.h; y += step) {
          g.fillStyle = shade(col, -0.18);
          g.beginPath(); g.ellipse(x, y * TILT + 2, 6.5, 6.5 * TILT, 0, 0, 7); g.fill();
          g.fillStyle = shade(col, 0.3);
          g.beginPath(); g.ellipse(x, y * TILT - 1, 6, 6 * TILT, 0, 0, 7); g.fill();
        }
      }
    }
    this.cache.walls.set(i, c);
    return c;
  }

  // Balle en caoutchouc, ou boule de billard numérotée (`ball`).
  bumperSprite(r, ball = null) {
    const key = `${r}|${ball}`;
    let c = this.cache.bumpers.get(key);
    if (c) return c;
    const k = this.cam.scale * this.pr;
    c = makeCanvas(2 * r * k + 4, 2 * r * k + 4);
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.scale(k, k);
    if (ball !== null) {
      const col = { 1: '#f7c51e', 2: '#2f62d9', 3: '#d8262b', 4: '#7b2fbf', 5: '#f2721c', 8: '#151515' }[ball] ?? '#2f62d9';
      const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      gr.addColorStop(0, shade(col.length === 7 ? col : '#151515', 0.5));
      gr.addColorStop(0.5, col);
      gr.addColorStop(1, shade(col, -0.45));
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(0, -r * 0.05, r * 0.42, 0, 7); g.fill();
      g.fillStyle = '#111';
      g.font = `bold ${Math.round(r * 0.55)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(ball), 0, -r * 0.03);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(-r * 0.4, -r * 0.5, r * 0.22, r * 0.12, -0.6, 0, 7); g.fill();
    } else {
      const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#ffc2cf');
      gr.addColorStop(0.45, '#ff4d6d');
      gr.addColorStop(1, '#a3203a');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(0, 0, r * 0.98, r * 0.35, 0.3, 0, 7); g.stroke();
    }
    this.cache.bumpers.set(key, c);
    return c;
  }

  // Corps de figurine pré-dessiné (socle, corps, tête), normal ou blanc (flash d'impact).
  figSprite(color, white = false) {
    const key = `${color}|${white}`;
    let c = this.cache.figs.get(key);
    if (c) return c;
    const k = this.cam.scale * this.pr;
    c = makeCanvas(FIG.w * k, FIG.h * k);
    const g = c.getContext('2d');
    g.scale(k, k);
    g.translate(FIG.ax, FIG.ay);
    const fill = (style) => { g.fillStyle = white ? 'rgba(255,255,255,0.9)' : style; };
    fill(shade(color, -0.5));
    g.beginPath(); g.ellipse(0, 0, PLAYER.radius, PLAYER.radius * TILT * 0.75, 0, 0, 7); g.fill();
    fill(shade(color, -0.3));
    g.beginPath(); g.ellipse(0, -3, PLAYER.radius * 0.95, PLAYER.radius * TILT * 0.7, 0, 0, 7); g.fill();
    const body = g.createRadialGradient(-5, -26, 2, 0, -16, 19);
    body.addColorStop(0, shade(color, 0.6));
    body.addColorStop(0.5, color);
    body.addColorStop(1, shade(color, -0.32));
    fill(body);
    g.beginPath(); g.ellipse(0, -16, 14, 15, 0, 0, 7); g.fill();
    const head = g.createRadialGradient(-4, -40, 1, 0, -34, 12);
    head.addColorStop(0, shade(color, 0.6));
    head.addColorStop(0.55, color);
    head.addColorStop(1, shade(color, -0.3));
    fill(head);
    g.beginPath(); g.arc(0, -35, 11, 0, 7); g.fill();
    if (!white) {
      g.fillStyle = 'rgba(255,255,255,0.65)';
      g.beginPath(); g.ellipse(-4, -40, 3.5, 2.2, -0.6, 0, 7); g.fill();
    }
    this.cache.figs.set(key, c);
    return c;
  }

  labelSprite(text, color) {
    const key = `${text}|${color}`;
    let c = this.cache.labels.get(key);
    if (c) return c;
    const fs = Math.round(Math.max(11, 13 * Math.min(1.2, this.cam.scale)));
    const pr = this.pr;
    const probe = makeCanvas(1, 1).getContext('2d');
    probe.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    const w = probe.measureText(text).width + 8;
    c = makeCanvas(w * pr, (fs + 8) * pr);
    const g = c.getContext('2d');
    g.scale(pr, pr);
    g.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.strokeText(text, w / 2, (fs + 8) / 2);
    g.fillStyle = color;
    g.fillText(text, w / 2, (fs + 8) / 2);
    c.cssW = w;
    c.cssH = fs + 8;
    this.cache.labels.set(key, c);
    return c;
  }

  emojiSprite(ch, size) {
    const key = `${ch}|${size}`;
    let c = this.cache.emoji.get(key);
    if (c) return c;
    const px = Math.round(size * this.cam.scale);
    c = makeCanvas(px * 1.4 * this.pr, px * 1.4 * this.pr);
    const g = c.getContext('2d');
    g.scale(this.pr, this.pr);
    g.font = `${px}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, px * 0.7, px * 0.75);
    c.cssW = px * 1.4;
    this.cache.emoji.set(key, c);
    return c;
  }

  blit(sprite, x, y, w, h) {
    this.ctx.drawImage(sprite, Math.round(x * this.pr) / this.pr, Math.round(y * this.pr) / this.pr, w, h);
  }

  // ------------------------------------------------------------ événements -> effets
  addEvent(ev, players, youId) {
    const now = performance.now() / 1000;
    const push = (fx) => { if (this.effects.length < 160) this.effects.push({ born: now, ...fx }); };
    switch (ev.type) {
      case 'push':
        this.flash.set(ev.id, now + 0.06);
        this.kick(ev.id, 1, 5);
        if (ev.by === youId) this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: false, soft: true });
        break;
      case 'flick':
        push({ kind: 'dust', id: ev.id, life: 0.4 });
        break;
      case 'hop':
        push({ kind: 'dust', id: ev.id, life: 0.25 });
        break;
      case 'clack':
        push({ kind: 'clack', x: ev.x, y: ev.y, life: 0.3, power: ev.power });
        if (ev.power > 300) this.shake = Math.max(this.shake, Math.min(8, ev.power / 120));
        break;
      case 'thud': push({ kind: 'clack', x: ev.x, y: ev.y, life: 0.2, power: 120 }); break;
      case 'topple': push({ kind: 'text', x: ev.x, y: ev.y, text: 'BONK', color: '#ffe066', life: 0.6, size: 15 }); break;
      case 'slam':
        push({ kind: 'text', x: ev.x, y: ev.y, text: 'CARTON !', color: '#ff6fb5', life: 0.7, size: 20 });
        this.shake = Math.max(this.shake, ev.id === youId || ev.victim === youId ? 7 : 3);
        if (ev.id === youId) this.hitStopUntil = now + 0.05;
        break;
      case 'ballPocket':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: 50, life: 0.35, color: '#ffffff' });
        break;
      case 'pocket':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: 60, life: 0.4, color: '#ffffff' });
        push({ kind: 'text', x: ev.x, y: ev.y, text: '🎱 Empoché !', color: '#ffffff', life: 1, size: 18 });
        if (ev.by === youId) this.hitStopUntil = now + 0.07;
        break;
      case 'boom':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r, life: 0.45, color: ev.small ? '#ffd23d' : '#ff6fb5' });
        for (let i = 0; i < (ev.small ? 10 : 20); i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 120 + Math.random() * 260, life: 0.9, color: WALL_COLORS[i % WALL_COLORS.length] });
        this.shake = Math.max(this.shake, ev.small ? 5 : 8);
        break;
      case 'magnet':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r, life: 0.4, color: '#c45cff' });
        push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r * 0.5, life: 0.3, color: '#c45cff' });
        break;
      case 'saved':
        push({ kind: 'text', x: ev.x, y: ev.y, text: '🛟 Sauvé !', color: '#7df9ff', life: 1, size: 18 });
        push({ kind: 'ring', x: ev.x, y: ev.y, r: 40, life: 0.4, color: '#7df9ff' });
        break;
      case 'crownSteal':
        if (ev.id === youId) this.hitStopUntil = now + 0.08;
        break;
      case 'punch': push({ kind: 'punch', id: ev.id, aim: ev.aim, life: 0.16 }); break;
      case 'teleport':
        push({ kind: 'ring', x: ev.fx, y: ev.fy, r: 40, life: 0.35, color: '#c45cff' });
        push({ kind: 'ring', x: ev.tx, y: ev.ty, r: 40, life: 0.35, color: '#c45cff' });
        break;
      case 'elim':
        if (!(ev.cause === 'fall' && this.currentMap?.pockets)) push({ kind: 'text', x: ev.x, y: ev.y, text: ev.cause === 'fall' ? '💫 CHUTE !' : '💥 K.O. !', color: '#ffd23d', life: 1.1, size: 22 });
        for (let i = 0; i < 12; i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 80 + Math.random() * 160, life: 0.7, color: '#ffffff' });
        this.shake = Math.max(this.shake, ev.killer === youId || ev.victim === youId ? 9 : 4);
        if (ev.killer === youId) {
          this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: true });
          this.hitStopUntil = now + 0.08;
        }
        break;
      case 'bump': push({ kind: 'ring', x: ev.x, y: ev.y, r: 46, life: 0.3, color: '#ff4d6d' }); break;
      case 'spring': push({ kind: 'ring', x: ev.x, y: ev.y, r: 50, life: 0.35, color: '#3ddc84' }); break;
      case 'slip': push({ kind: 'text', x: ev.x, y: ev.y, text: '🍌 Glissade !', color: '#ffe066', life: 1 }); break;
      case 'shieldBreak':
        push({ kind: 'text', x: ev.x, y: ev.y, text: '🛡️ Bouclier brisé', color: '#ffd23d', life: 1 });
        push({ kind: 'ring', x: ev.x, y: ev.y, r: 40, life: 0.4, color: '#ffd23d' });
        break;
      case 'blocked': push({ kind: 'ring', x: ev.x, y: ev.y, r: 34, life: 0.25, color: '#7df9ff' }); break;
      case 'coin': push({ kind: 'text', x: ev.x, y: ev.y, text: `+${ev.value}`, color: '#ffd23d', life: 0.7 }); break;
      case 'fizzle': push({ kind: 'spark', x: ev.x, y: ev.y, life: 0.2, color: '#999' }); break;
      default: break;
    }
  }

  kick(id, dir, strength) {
    this.animOf(id).leanV += dir * strength;
  }

  // ------------------------------------------------------------ rendu principal
  draw(state) {
    const nowMs = performance.now();
    const dtMs = nowMs - this.lastDraw;
    const dt = Math.min(0.05, dtMs / 1000);
    this.lastDraw = nowMs;
    const now = nowMs / 1000;
    if (dtMs < 200) this.adaptQuality(dtMs, now);
    const map = MAPS[state.map] ?? MAPS.arena;
    const me = state.players.find((p) => p.id === state.youId);
    this.updateCamera(map, me);
    this.ensureCaches(map);

    this.shx = 0;
    this.shy = 0;
    if (this.shake > 0.1) {
      this.shx = (Math.random() - 0.5) * this.shake * settings.shake;
      this.shy = (Math.random() - 0.5) * this.shake * settings.shake;
      this.shake *= 0.85;
    }
    for (const p of state.players) this.updateAnim(p, dt, now);

    const { ctx } = this;
    this.screenTransform();
    ctx.fillStyle = '#16142b';
    ctx.fillRect(0, 0, this.W, this.H);
    const st = this.cache.static;
    const o = this.toScreenV(this.cache.origin.X0, this.cache.origin.Y0, PAD_TOP);
    this.blit(st, o.x, o.y, st.width / this.cache.sp, st.height / this.cache.sp);

    this.drawMovers(map, state.movers);
    this.groundTransform();
    this.drawGroundDynamic(state, now);
    this.screenTransform();
    this.drawSprites(map, state, now);
    this.drawEffects(now, state);
    this.drawOverlay(now, state, me);
  }

  drawBackdrop() {
    this.screenTransform();
    this.ctx.fillStyle = '#16142b';
    this.ctx.fillRect(0, 0, this.W, this.H);
  }

  updateAnim(p, dt, now) {
    const a = this.animOf(p.id);
    const q = this.V(p.x, p.y); // repère de vue : le balancier suit le mouvement à l'écran
    if (a.x === null || Math.hypot(q.u - a.x, q.v - a.y) > 160) { a.x = q.u; a.y = q.v; a.vx = 0; a.vy = 0; }
    const nvx = dt > 0 ? (q.u - a.x) / dt : 0;
    const nvy = dt > 0 ? (q.v - a.y) / dt : 0;
    const ax = dt > 0 ? (nvx - a.vx) / dt : 0;
    a.vx += (nvx - a.vx) * 0.5;
    a.vy += (nvy - a.vy) * 0.5;
    a.x = q.u;
    a.y = q.v;
    const f = p.f || '';
    const toppled = f.includes('k');
    if (toppled && !a.lastFlag.includes('k')) a.toppleDir = Math.sign(a.vx) || (Math.random() < 0.5 ? -1 : 1);
    a.lastFlag = f;
    // Palet qui glisse : la figurine penche dans le sens de la glissade, puis se redresse en oscillant.
    const target = toppled ? a.toppleDir * 1.5 : clamp(a.vx * 0.0004 - ax * 0.00012, -0.35, 0.35);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      a.leanV += (110 * (target - a.lean) - 7 * a.leanV) * h;
      a.lean += a.leanV * h;
    }
    a.lean = clamp(a.lean, -1.7, 1.7);
    if (p.s === 'falling') { if (a.fallStart === null) a.fallStart = now; } else a.fallStart = null;
  }

  drawMovers(map, movers) {
    const { ctx } = this;
    this.screenTransform();
    (movers ?? []).forEach(([x, y], i) => {
      const mp = map.movingPlatforms[i];
      if (!mp) return;
      const r = this.VR({ x, y, w: mp.w, h: mp.h });
      const a = this.toScreenV(r.x, r.y, 0);
      const b = this.toScreenV(r.x + r.w, r.y + r.h, 0);
      const c = this.toScreenV(r.x, r.y + r.h, -14);
      ctx.fillStyle = '#b8621a';
      ctx.fillRect(a.x, b.y, b.x - a.x, c.y - b.y);
      ctx.fillStyle = '#ffae57';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    });
  }

  // Éléments au sol qui bougent : ombres, anneau de prime, charges, aperçu de trajectoire.
  drawGroundDynamic(state, now) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    for (const p of state.players) {
      if (p.s !== 'alive') continue;
      const air = (p.f || '').includes('j');
      const x = p.x + (air ? 8 : 0);
      const y = p.y + (air ? 10 : 0);
      ctx.moveTo(x + PLAYER.radius, y);
      ctx.arc(x, y, PLAYER.radius * (air ? 0.75 : 1), 0, 7);
    }
    for (const d of state.decoys) { ctx.moveTo(d.x + PLAYER.radius, d.y); ctx.arc(d.x, d.y, PLAYER.radius, 0, 7); }
    for (const pk of state.pickups) { const r = pk.kind === 'crown' ? 20 : 11; ctx.moveTo(pk.x + r, pk.y); ctx.arc(pk.x, pk.y, r, 0, 7); }
    for (const b of state.balls ?? []) { ctx.moveTo(b.x + 21, b.y + 4); ctx.arc(b.x, b.y + 4, 21, 0, 7); }
    ctx.fill();
    if (state.pocketScale > 1.01 && this.currentMap?.pockets) {
      // Poches gloutonnes : le trou s'élargit par-dessus le décor.
      for (const pk of this.currentMap.pockets) {
        const r = pk.r * state.pocketScale;
        ctx.fillStyle = '#3a2412';
        ctx.beginPath(); ctx.arc(pk.x, pk.y, r + 8, 0, 7); ctx.fill();
        ctx.fillStyle = '#050307';
        ctx.beginPath(); ctx.arc(pk.x, pk.y, r, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(255, 77, 109, ${0.35 + 0.25 * Math.sin(now * 6)})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(pk.x, pk.y, r + 10, 0, 7); ctx.stroke();
      }
    }
    if (state.microTarget) {
      // Cible du micro-jeu « Dans le cercle ! ».
      const t = state.microTarget;
      ctx.fillStyle = 'rgba(255, 210, 61, 0.25)';
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.55, 0, 7); ctx.stroke();
    }
    const champ = state.players.find((p) => p.id === state.champion && p.s === 'alive');
    if (champ) {
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -now * 30;
      ctx.beginPath(); ctx.arc(champ.x, champ.y, 34, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    const me = state.players.find((p) => p.id === state.youId);
    if (!me || me.s !== 'alive') return;
    if (state.trajectory) this.drawTrajectory(me, state);
    this.energyMax = state.energyMax;
    this.drawEnergy(me, state.energy ?? 0);
  }

  // Charges de pichenette : trois pastilles sous la figurine.
  drawEnergy(me, energy) {
    const { ctx } = this;
    const n = this.energyMax ?? PLAYER.energyMax;
    for (let i = 0; i < n; i++) {
      const q = this.V(me.x, me.y);
      const off = (i - (n - 1) / 2) * 16;
      const wq = this.rot ? { x: q.v + 30, y: q.u + off } : { x: q.u + off, y: q.v + 30 };
      const x = wq.x;
      const y = wq.y;
      const fill = clamp(energy - i, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 7); ctx.fill();
      if (fill > 0) {
        ctx.fillStyle = fill >= 1 ? '#7df9ff' : 'rgba(125,249,255,0.45)';
        ctx.beginPath(); ctx.arc(x, y, 5 * (fill >= 1 ? 1 : 0.4 + 0.6 * fill), 0, 7); ctx.fill();
      }
    }
  }

  // Aperçu exact de la pichenette (même physique que le jeu) : rebonds marqués, arrivée
  // verte, ou croix rouge si la figurine finirait dans le vide.
  drawTrajectory(me, state) {
    const { ctx } = this;
    const tr = state.trajectory;
    const ok = tr.outcome !== 'fall';
    const color = !tr.ready ? 'rgba(200,200,220,0.6)' : ok ? 'rgba(255, 240, 160, 0.95)' : 'rgba(255, 80, 80, 0.95)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    tr.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const b of tr.bounces.slice(0, 4)) { ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 7); ctx.fill(); }
    const e = tr.end;
    if (ok) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(e.x, e.y, PLAYER.radius, 0, 7); ctx.stroke();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(e.x - 14, e.y - 14); ctx.lineTo(e.x + 14, e.y + 14); ctx.moveTo(e.x + 14, e.y - 14); ctx.lineTo(e.x - 14, e.y + 14); ctx.stroke();
    }
    // Élastique tendu derrière la figurine.
    if (tr.power !== undefined) {
      const dx = Math.cos(tr.angle);
      const dy = Math.sin(tr.angle);
      const back = 26 + 56 * tr.power;
      const bx = me.x - dx * back;
      const by = me.y - dy * back;
      ctx.strokeStyle = '#ff6fb5';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(me.x - dy * 16, me.y + dx * 16); ctx.lineTo(bx, by); ctx.lineTo(me.x + dy * 16, me.y - dx * 16);
      ctx.stroke();
      ctx.fillStyle = '#ff6fb5';
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ objets en relief, triés par profondeur
  drawSprites(map, state, now) {
    const items = [];
    // Tri par profondeur dans le repère de vue (v), pour que le plus proche passe devant.
    const depth = (o) => this.V(o.x, o.y).v;
    map.walls.forEach((w, i) => { const r = this.VR(w); items.push({ key: r.y + r.h, kind: 0, w, i, r }); });
    for (const b of map.bumpers) items.push({ key: depth(b), kind: 1, b });
    for (const tr of state.traps) items.push({ key: depth(tr) - 10, kind: 2, tr });
    for (const pk of state.pickups) items.push({ key: depth(pk), kind: 3, pk });
    for (const d of state.decoys) items.push({ key: depth(d), kind: 4, d });
    for (const p of state.players) if (p.s !== 'dead') items.push({ key: depth(p) + (p.s === 'falling' ? 2000 : 0), kind: 5, p });
    for (const b of state.bombs) items.push({ key: depth(b), kind: 6, b });
    for (const b of state.balls ?? []) items.push({ key: depth(b), kind: 8, b });
    items.sort((a, b) => a.key - b.key);
    const s = this.cam.scale;
    for (const it of items) {
      switch (it.kind) {
        case 0: {
          const sp = this.wallSprite(it.w, it.i);
          const o = this.toScreenV(it.r.x, it.r.y, this.wallHeight(it.w));
          this.blit(sp, o.x, o.y, sp.width / this.pr, sp.height / this.pr);
          break;
        }
        case 1: {
          const sp = this.bumperSprite(it.b.r, it.b.ball ?? null);
          const c = this.toScreen(it.b.x, it.b.y, it.b.r * 0.9);
          this.blit(sp, c.x - sp.width / this.pr / 2, c.y - sp.height / this.pr / 2, sp.width / this.pr, sp.height / this.pr);
          break;
        }
        case 2: {
          const sp = this.emojiSprite('🍌', 30);
          const c = this.toScreen(it.tr.x, it.tr.y, 4);
          this.ctx.globalAlpha = it.tr.armed ? 1 : 0.45;
          this.blit(sp, c.x - sp.cssW / 2, c.y - sp.cssW / 2, sp.cssW, sp.cssW);
          this.ctx.globalAlpha = 1;
          break;
        }
        case 3: this.drawPickup(it.pk, now, s); break;
        case 4: {
          const owner = state.roster.get(it.d.owner);
          if (owner) this.drawFigure({ id: `decoy${it.d.owner}`, x: it.d.x, y: it.d.y, a: it.d.a, s: 'alive', f: '' }, owner, now, { decoy: it.d.owner === state.youId });
          break;
        }
        case 5: {
          const info = state.roster.get(it.p.id);
          if (info) this.drawFigure(it.p, info, now, {});
          break;
        }
        case 6: this.drawBomb(it.b, now, s); break;
        case 8: {
          // Boule qui roule : le numéro tourne avec le déplacement.
          const sp = this.bumperSprite(19, it.b.num);
          const c = this.toScreen(it.b.x, it.b.y, 17);
          const w = sp.width / this.pr;
          const roll = ((it.b.x + it.b.y) / 19) % (Math.PI * 2);
          this.ctx.save();
          this.ctx.translate(c.x, c.y);
          this.ctx.rotate(roll);
          this.ctx.drawImage(sp, -w / 2, -w / 2, w, w);
          this.ctx.restore();
          break;
        }
        default: break;
      }
    }
    for (const p of state.players) {
      const info = state.roster.get(p.id);
      if (!info || p.s !== 'alive') continue;
      this.drawLabel(p, info, { me: p.id === state.youId, champion: p.id === state.champion, crown: p.id === state.crownHolder });
    }
    for (const d of state.decoys) {
      const owner = state.roster.get(d.owner);
      if (owner) this.drawLabel({ x: d.x, y: d.y, s: 'alive', f: '' }, owner, { decoy: d.owner === state.youId });
    }
  }

  drawFigure(p, info, now, opts = {}) {
    const { ctx } = this;
    const s = this.cam.scale;
    const f = p.f || '';
    const a = this.animOf(p.id);
    let alpha = 1;
    let z = 0;
    let scale = 1;
    if (p.s === 'falling') {
      const k = Math.min(1, (now - (a.fallStart ?? now)) / FALL_TIME);
      z = -k * k * 260;
      scale = 1 - k * 0.35;
      alpha = 1 - k * 0.5;
    }
    if (f.includes('j')) z += 26;
    if (f.includes('i')) alpha *= 0.45 + 0.4 * Math.sin(now * 30);
    if (opts.decoy) alpha *= 0.55;

    const base = this.toScreen(p.x, p.y, z);
    const rk = Math.max(0, 1 - (now - (this.recoil.get(p.id) ?? -9)) / 0.1);
    const sa = this.screenAngle(p.a);
    const ux = Math.cos(sa);
    const uy = Math.sin(sa);
    const stretch = f.includes('f') ? 0.1 : 0;

    ctx.save();
    ctx.globalAlpha = Math.max(0.1, alpha);
    ctx.translate(base.x - ux * rk * 4 * s, base.y - uy * rk * 4 * s);
    ctx.rotate(a.lean);
    ctx.scale(scale * (1 - stretch), scale * (1 + stretch));
    const facingAway = (this.rot ? Math.cos(p.a) : Math.sin(p.a)) < -0.25;
    const white = now < (this.flash.get(p.id) ?? 0);
    const spr = this.figSprite(info.color, white);
    ctx.drawImage(spr, -FIG.ax * s, -FIG.ay * s, FIG.w * s, FIG.h * s);
    if (!facingAway && !white) {
      ctx.save();
      ctx.scale(s, s);
      ctx.fillStyle = '#111';
      const ex = ux * 3.5;
      const ey = Math.max(0, uy) * 2;
      ctx.beginPath(); ctx.arc(-3.6 + ex, -35 + ey, 1.9, 0, 7); ctx.arc(3.6 + ex, -35 + ey, 1.9, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (f.includes('h')) {
      // Lest de plomb : socle sombre et épais.
      const foot = this.toScreen(p.x, p.y, z + 2);
      ctx.strokeStyle = 'rgba(60, 64, 80, 0.9)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(foot.x, foot.y, 22 * s, 22 * s * TILT, 0, 0, 7); ctx.stroke();
    }
    if (f.includes('b') || f.includes('c') || f.includes('g')) {
      const mid = this.toScreen(p.x, p.y, z + 20);
      ctx.lineWidth = 3;
      if (f.includes('b')) {
        ctx.fillStyle = 'rgba(125, 249, 255, 0.2)';
        ctx.strokeStyle = 'rgba(125, 249, 255, 0.9)';
        ctx.beginPath(); ctx.arc(mid.x, mid.y, 34 * s, 0, 7); ctx.fill(); ctx.stroke();
      }
      if (f.includes('c')) {
        ctx.strokeStyle = '#ffd23d';
        ctx.beginPath(); ctx.arc(mid.x, mid.y, 30 * s, 0, 7); ctx.stroke();
      }
      if (f.includes('g')) {
        ctx.fillStyle = 'rgba(123, 220, 61, 0.7)';
        ctx.beginPath(); ctx.arc(mid.x - 8 * s, mid.y + 4 * s, 6 * s, 0, 7); ctx.arc(mid.x + 7 * s, mid.y + 8 * s, 5 * s, 0, 7); ctx.fill();
      }
    }
  }

  drawLabel(p, info, opts) {
    const { ctx } = this;
    const s = this.cam.scale;
    const air = (p.f || '').includes('j');
    const top = this.toScreen(p.x, p.y, 58 + (air ? 26 : 0));
    let y = top.y;
    const lab = this.labelSprite((opts.decoy ? '(leurre) ' : '') + info.name, opts.me ? '#ffd23d' : '#ffffff');
    this.blit(lab, top.x - lab.cssW / 2, y - lab.cssH, lab.cssW, lab.cssH);
    y -= lab.cssH;
    const badges = `${opts.crown ? '👑' : ''}${opts.champion ? '🎯 PRIME' : ''}`;
    if (badges) {
      const b = this.labelSprite(badges, '#ffd23d');
      this.blit(b, top.x - b.cssW / 2, y - b.cssH, b.cssW, b.cssH);
    }
  }

  drawBomb(b, now, s) {
    const { ctx } = this;
    const c = this.toScreen(b.x, b.y, 11);
    const blink = b.fuse < 0.5 && Math.sin(now * 40) > 0;
    ctx.fillStyle = blink ? '#fff' : '#ff6fb5';
    ctx.beginPath(); ctx.arc(c.x, c.y, 11 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath(); ctx.arc(c.x + 6 * s, c.y - 10 * s, 4 * s, 0, 7); ctx.fill();
  }

  drawPickup(pk, now, s) {
    const { ctx } = this;
    const bob = Math.sin(now * 4 + pk.id) * 3;
    if (pk.kind === 'crown') {
      const sp = this.emojiSprite('👑', 40);
      const c = this.toScreen(pk.x, pk.y, 30 + bob);
      this.blit(sp, c.x - sp.cssW / 2, c.y - sp.cssW / 2, sp.cssW, sp.cssW);
      return;
    }
    const gold = pk.kind === 'gold';
    const r = (gold ? 15 : 10) * s;
    const c = this.toScreen(pk.x, pk.y, 14 + bob);
    const w = Math.max(0.15, Math.abs(Math.cos(now * 3 + pk.id)));
    ctx.fillStyle = '#b08a12';
    ctx.beginPath(); ctx.ellipse(c.x + 1.5 * s, c.y, r * w, r, 0, 0, 7); ctx.fill();
    ctx.fillStyle = gold ? '#ffb300' : '#ffd23d';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, r * w, r, 0, 0, 7); ctx.fill();
  }

  // ------------------------------------------------------------ effets
  drawEffects(now, state) {
    const { ctx } = this;
    const s = this.cam.scale;
    this.effects = this.effects.filter((e) => now - e.born < e.life);
    const findP = (id) => state.players.find((x) => x.id === id);
    for (const e of this.effects) {
      const k = (now - e.born) / e.life;
      ctx.globalAlpha = 1 - k;
      switch (e.kind) {
        case 'ring': {
          const c = this.toScreen(e.x, e.y, 0);
          const r = e.r * (0.3 + k * 0.9) * s;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 5 * (1 - k) + 1;
          ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * TILT, 0, 0, 7); ctx.stroke();
          break;
        }
        case 'spark': {
          const c = this.toScreen(e.x, e.y, 18);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(c.x, c.y, (6 + k * 18) * s, 0, 7); ctx.stroke();
          break;
        }
        case 'clack': {
          const c = this.toScreen(e.x, e.y, 20);
          const R = (14 + Math.min(30, e.power / 25)) * s * (0.6 + k);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2;
            ctx.moveTo(c.x + Math.cos(ang) * R * 0.45, c.y + Math.sin(ang) * R * 0.45);
            ctx.lineTo(c.x + Math.cos(ang) * R, c.y + Math.sin(ang) * R);
          }
          ctx.stroke();
          break;
        }
        case 'confetti': {
          const x = e.x + Math.cos(e.a) * e.s * k;
          const y = e.y + Math.sin(e.a) * e.s * k;
          const c = this.toScreen(x, y, Math.max(0, 20 + 140 * k - 220 * k * k));
          ctx.fillStyle = e.color;
          ctx.fillRect(c.x - 3, c.y - 2, 6, 4);
          break;
        }
        case 'text': {
          const c = this.toScreen(e.x, e.y, 60 + k * 30);
          const fs = Math.round(Math.max(13, (e.size ?? 16) * Math.min(1.2, s)));
          ctx.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(e.text, c.x, c.y);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, c.x, c.y);
          break;
        }
        case 'muzzle': {
          const p = findP(e.id);
          if (!p) break;
          const c = this.toScreen(p.x + Math.cos(p.a) * 40, p.y + Math.sin(p.a) * 40, 18);
          ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(c.x, c.y, 9 * s * (1 - k * 0.5), 0, 7); ctx.fill();
          break;
        }
        case 'dust': {
          const p = findP(e.id);
          if (!p) break;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const ang = i * 1.05 + e.born;
            const c = this.toScreen(p.x + Math.cos(ang) * 22 * (1 + k), p.y + Math.sin(ang) * 22 * (1 + k), 2);
            const r = (6 * (1 - k) + 1) * s;
            ctx.moveTo(c.x + r, c.y);
            ctx.arc(c.x, c.y, r, 0, 7);
          }
          ctx.fill();
          break;
        }
        case 'punch': {
          const p = findP(e.id);
          if (!p) break;
          const c = this.toScreen(p.x, p.y, 0);
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 5;
          const va = this.rot ? Math.atan2(Math.cos(e.aim), Math.sin(e.aim)) : e.aim;
          ctx.beginPath(); ctx.ellipse(c.x, c.y, 70 * s, 70 * s * TILT, 0, va - 0.6, va + 0.6); ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ couche d'interface (écran)
  drawOverlay(now, state, me) {
    const { ctx, W, H } = this;
    this.dmgDirs = this.dmgDirs.filter((d) => now - d.born < 0.9);
    if (me && this.dmgDirs.length) {
      const c = this.toScreen(me.x, me.y, 20);
      const R = Math.min(W, H) * 0.22;
      for (const d of this.dmgDirs) {
        const k = 1 - (now - d.born) / 0.9;
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.9 * k})`;
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        const da = this.screenAngle(d.wa);
        ctx.beginPath(); ctx.arc(c.x, c.y, R, da - 0.32, da + 0.32); ctx.stroke();
      }
    }
    if (me) {
      const c = this.toScreen(me.x, me.y, 20);
      const m = 18;
      for (const o of state.players) {
        if (o.id === state.youId || o.s !== 'alive') continue;
        const p = this.toScreen(o.x, o.y, 20);
        if (p.x > m && p.x < W - m && p.y > m && p.y < H - m) continue;
        const a = Math.atan2(p.y - c.y, p.x - c.x);
        const kx = Math.cos(a) > 0 ? (W - m - c.x) / Math.cos(a) : (m - c.x) / Math.cos(a);
        const ky = Math.sin(a) > 0 ? (H - m - c.y) / Math.sin(a) : (m - c.y) / Math.sin(a);
        const k = Math.min(Math.abs(kx), Math.abs(ky));
        ctx.save();
        ctx.translate(c.x + Math.cos(a) * k, c.y + Math.sin(a) * k);
        ctx.rotate(a);
        ctx.fillStyle = state.roster.get(o.id)?.color ?? '#fff';
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    this.hitMarkers = this.hitMarkers.filter((h) => now - h.born < (h.kill ? 0.45 : 0.22));
    for (const h of this.hitMarkers) {
      const p = this.toScreen(h.x, h.y, 22);
      const k = (now - h.born) / (h.kill ? 0.45 : 0.22);
      const sz = (h.kill ? 16 : 9) + k * 6;
      ctx.strokeStyle = h.kill ? '#ff3355' : h.soft ? 'rgba(125,249,255,0.9)' : '#ffffff';
      ctx.lineWidth = h.kill ? 4 : 3;
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(p.x + dx * sz * 0.45, p.y + dy * sz * 0.45);
        ctx.lineTo(p.x + dx * sz, p.y + dy * sz);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
