// Rendu « diorama » : le bureau d'une chambre d'enfant, la nuit, vu de trois quarts.
// La simulation reste en 2D vue de dessus ; seul l'affichage projette le sol en
// perspective (compression verticale TILT) et dresse les objets en hauteur (z).
import { MAPS } from '../shared/maps.js';
import { PLAYER, HAZARD } from '../shared/constants.js';
import { settings } from './settings.js';
import { TILT } from './input.js';

const WALL_COLORS = ['#ff5a5a', '#3d8bff', '#3ddc84', '#ffd23d', '#c45cff', '#ff8f3d'];
const WEAPON_COLORS = { pistol: '#ff9f1c', glue_launcher: '#7bdc3d', spring_glove: '#ff4d6d' };
const WALL_H = 34; // hauteur des briques
const TABLE_T = 30; // épaisseur du plateau du bureau
const FALL_TIME = PLAYER.fallTime + 0.15;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = [];
    this.cam = { x: 800, y: 500, scale: 1 };
    this.shake = 0;
    this.shx = 0;
    this.shy = 0;
    this.anim = new Map(); // état d'animation par figurine (sautillement, balancier, chute)
    this.flash = new Map(); // id -> fin du flash blanc (touché)
    this.recoil = new Map(); // id -> instant du dernier tir
    this.dmgDirs = []; // directions d'où viennent les dégâts reçus
    this.hitMarkers = []; // touches infligées par le joueur local
    this.hitStopUntil = 0; // micro-gel de l'image sur un impact décisif
    this.stripe = this.makeStripe();
    this.lastDraw = performance.now();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  makeStripe() {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255, 210, 61, 0.5)';
    g.fillRect(0, 0, 24, 24);
    g.fillStyle = 'rgba(30, 30, 30, 0.5)';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 0); g.lineTo(0, 12); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(24, 0); g.lineTo(24, 12); g.lineTo(12, 24); g.lineTo(0, 24); g.closePath(); g.fill();
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  // ------------------------------------------------------------ caméra et projection
  updateCamera(map, focus) {
    const pad = 40;
    const visH = (h) => h * TILT + TABLE_T + 70; // hauteur écran (en unités monde) d'une zone de sol
    if (!map.follow) {
      const fit = Math.min(this.W / (map.width + pad), this.H / visH(map.height + pad));
      // Petit écran : l'arène entière serait illisible, on zoome et on suit le joueur.
      const small = Math.min(this.W, this.H) < 560;
      const scale = small && focus ? Math.max(fit, Math.min(this.H / visH(560), this.W / 980)) : fit;
      if (scale === fit) {
        this.cam = { x: map.width / 2, y: map.height / 2 + 30, scale };
        return;
      }
      const hx = this.W / 2 / scale;
      const hy = this.H / 2 / (scale * TILT);
      const tx = clamp(focus.x, hx - 60, map.width - hx + 60);
      const ty = clamp(focus.y, hy - 80, map.height - hy + 120);
      const same = Math.abs(this.cam.scale - scale) < 1e-6;
      this.cam = { x: same ? this.cam.x + (tx - this.cam.x) * 0.18 : tx, y: same ? this.cam.y + (ty - this.cam.y) * 0.18 : ty, scale };
      return;
    }
    const scale = Math.min(this.H / visH(map.height + pad), this.W / 900);
    const half = this.W / 2 / scale;
    const fx = focus ? focus.x + 150 : half;
    const x = clamp(fx, half - 100, map.width - half + 100);
    const cx = this.cam.scale === scale ? this.cam.x + (x - this.cam.x) * 0.15 : x;
    this.cam = { x: cx, y: map.height / 2 + 30, scale };
  }

  // Monde (x, y au sol, z en hauteur) -> pixels écran.
  toScreen(x, y, z = 0) {
    const { cam } = this;
    return {
      x: (x - cam.x) * cam.scale + this.W / 2 + this.shx,
      y: ((y - cam.y) * TILT - z) * cam.scale + this.H / 2 + this.shy,
    };
  }

  // Pixels écran -> point du sol (z = 0).
  toWorld(sx, sy) {
    const { cam } = this;
    return { x: (sx - this.W / 2) / cam.scale + cam.x, y: (sy - this.H / 2) / (cam.scale * TILT) + cam.y };
  }

  // Direction monde -> angle à l'écran (le sol est écrasé verticalement).
  screenAngle(a) {
    return Math.atan2(Math.sin(a) * TILT, Math.cos(a));
  }

  groundTransform() {
    const { ctx, dpr, cam } = this;
    ctx.setTransform(
      dpr * cam.scale, 0, 0, dpr * cam.scale * TILT,
      dpr * (this.W / 2 - cam.x * cam.scale + this.shx),
      dpr * (this.H / 2 - cam.y * cam.scale * TILT + this.shy),
    );
  }

  screenTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  animOf(id) {
    let a = this.anim.get(id);
    if (!a) {
      a = { x: null, y: null, vx: 0, vy: 0, lean: 0, leanV: 0, hop: 0, fallStart: null, toppleDir: 1, lastFlag: '' };
      this.anim.set(id, a);
    }
    return a;
  }

  // ------------------------------------------------------------ événements -> effets
  addEvent(ev, players, youId) {
    const now = performance.now() / 1000;
    const push = (fx) => this.effects.push({ born: now, ...fx });
    switch (ev.type) {
      case 'impact': push({ kind: 'spark', x: ev.x, y: ev.y, life: 0.25, color: ev.kind === 'glue' ? '#7bdc3d' : '#7df9ff' }); break;
      case 'dmg':
        push({ kind: 'text', x: ev.x, y: ev.y, text: `-${ev.amount}`, color: ev.by === youId ? '#ffffff' : '#ff5a5a', life: 0.8, size: ev.by === youId ? 20 : 16 });
        this.flash.set(ev.id, now + 0.09);
        this.kick(ev.id, ev.ax !== null ? Math.sign(ev.x - ev.ax) || 1 : 1, 7);
        if (ev.id === youId) {
          if (ev.ax !== null) this.dmgDirs.push({ a: Math.atan2((ev.ay - ev.y) * TILT, ev.ax - ev.x), born: now });
          this.shake = Math.max(this.shake, 5);
        }
        if (ev.by === youId) this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: false });
        break;
      case 'push':
        this.flash.set(ev.id, now + 0.06);
        this.kick(ev.id, 1, 5);
        if (ev.by === youId) this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: false, soft: true });
        break;
      case 'shot':
        this.recoil.set(ev.id, now);
        push({ kind: 'muzzle', id: ev.id, life: 0.07, color: ev.kind === 'glue' ? '#b6ff7a' : '#fff3b0' });
        break;
      case 'flick':
        push({ kind: 'dust', id: ev.id, life: 0.4 });
        push({ kind: 'twang', id: ev.id, life: 0.25, power: ev.power });
        break;
      case 'clack':
        push({ kind: 'clack', x: ev.x, y: ev.y, life: 0.3, power: ev.power });
        if (ev.power > 300) this.shake = Math.max(this.shake, Math.min(8, ev.power / 120));
        break;
      case 'topple':
        push({ kind: 'text', x: ev.x, y: ev.y, text: 'BONK', color: '#ffe066', life: 0.6, size: 15 });
        break;
      case 'boom':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r, life: 0.45, color: '#ff6fb5' });
        for (let i = 0; i < 26; i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 120 + Math.random() * 260, life: 0.9, color: WALL_COLORS[i % WALL_COLORS.length] });
        this.shake = 8;
        break;
      case 'punch': push({ kind: 'punch', id: ev.id, aim: ev.aim, life: 0.16 }); break;
      case 'teleport':
        push({ kind: 'ring', x: ev.fx, y: ev.fy, r: 40, life: 0.35, color: '#c45cff' });
        push({ kind: 'ring', x: ev.tx, y: ev.ty, r: 40, life: 0.35, color: '#c45cff' });
        break;
      case 'elim':
        push({ kind: 'text', x: ev.x, y: ev.y, text: ev.cause === 'fall' ? '💫 CHUTE !' : '💥 K.O. !', color: '#ffd23d', life: 1.1, size: 22 });
        for (let i = 0; i < 16; i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 80 + Math.random() * 160, life: 0.7, color: '#ffffff' });
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

  // Petite secousse du balancier de la figurine (touchée, poussée).
  kick(id, dir, strength) {
    const a = this.animOf(id);
    a.leanV += dir * strength;
  }

  // ------------------------------------------------------------ rendu principal
  draw(state) {
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.lastDraw) / 1000);
    this.lastDraw = nowMs;
    const now = nowMs / 1000;
    const map = MAPS[state.map] ?? MAPS.arena;
    const me = state.players.find((p) => p.id === state.youId);
    this.updateCamera(map, me);

    this.shx = 0;
    this.shy = 0;
    if (this.shake > 0.1) {
      this.shx = (Math.random() - 0.5) * this.shake * settings.shake;
      this.shy = (Math.random() - 0.5) * this.shake * settings.shake;
      this.shake *= 0.85;
    }

    for (const p of state.players) this.updateAnim(p, dt, now);

    this.screenTransform();
    this.drawBackdrop();
    this.drawTable(map, state.movers);
    this.groundTransform();
    this.drawGround(map, state, now);
    this.drawSprites(map, state, now);
    this.drawEffects(now, state);
    this.drawNight(map);
    this.drawOverlay(now, state, me);
  }

  // Animation propre au client : sautillement à la marche, balancier de la figurine lestée,
  // renversement puis redressement, chute hors de la table.
  updateAnim(p, dt, now) {
    const a = this.animOf(p.id);
    if (a.x === null || Math.hypot(p.x - a.x, p.y - a.y) > 160) { a.x = p.x; a.y = p.y; a.vx = 0; a.vy = 0; }
    const nvx = dt > 0 ? (p.x - a.x) / dt : 0;
    const nvy = dt > 0 ? (p.y - a.y) / dt : 0;
    const ax = dt > 0 ? (nvx - a.vx) / dt : 0;
    a.vx += (nvx - a.vx) * 0.5;
    a.vy += (nvy - a.vy) * 0.5;
    a.x = p.x;
    a.y = p.y;
    const f = p.f || '';
    const toppled = f.includes('k');
    if (toppled && !a.lastFlag.includes('k')) a.toppleDir = Math.sign(a.vx) || (Math.random() < 0.5 ? -1 : 1);
    a.lastFlag = f;
    const target = toppled ? a.toppleDir * 1.5 : clamp(-ax * 0.00022, -0.4, 0.4);
    // Ressort amorti : la figurine oscille avant de se stabiliser.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      a.leanV += (110 * (target - a.lean) - 7 * a.leanV) * h;
      a.lean += a.leanV * h;
    }
    a.lean = clamp(a.lean, -1.7, 1.7);
    const speed = Math.hypot(a.vx, a.vy);
    if (speed > 40 && !toppled && !f.includes('f') && !f.includes('j')) a.hop += (speed * dt) / 24;
    else a.hop = Math.round(a.hop / Math.PI) * Math.PI; // se pose
    if (p.s === 'falling') { if (a.fallStart === null) a.fallStart = now; } else a.fallStart = null;
  }

  // ------------------------------------------------------------ décor
  drawBackdrop() {
    const { ctx, W, H, cam } = this;
    // Le sol de la chambre, loin sous le bureau : lames de parquet avec parallaxe.
    ctx.fillStyle = '#16142b';
    ctx.fillRect(0, 0, W, H);
    const plank = 46;
    const off = ((-cam.y * cam.scale * TILT * 0.45) % plank + plank) % plank;
    for (let y = -plank + off, i = 0; y < H + plank; y += plank, i++) {
      ctx.fillStyle = i % 2 ? '#1c1934' : '#19172f';
      ctx.fillRect(0, y, W, plank - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      const seam = (((-cam.x * cam.scale * 0.45) + i * 173) % 260 + 260) % 260;
      for (let x = seam - 260; x < W; x += 260) ctx.fillRect(x, y, 2, plank - 2);
    }
  }

  drawTable(map, movers) {
    const { ctx } = this;
    this.screenTransform();
    // Ombre du bureau sur le sol.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const r of map.platforms) {
      const a = this.toScreen(r.x + 30, r.y + 40, -TABLE_T - 40);
      const b = this.toScreen(r.x + r.w + 30, r.y + r.h + 40, -TABLE_T - 40);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // Tranche avant du plateau (épaisseur du bois).
    for (const r of map.platforms) {
      const a = this.toScreen(r.x, r.y + r.h, 0);
      const b = this.toScreen(r.x + r.w, r.y + r.h, -TABLE_T);
      const g = ctx.createLinearGradient(0, a.y, 0, b.y);
      g.addColorStop(0, '#9a6a3c');
      g.addColorStop(1, '#5a3a1f');
      ctx.fillStyle = g;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    (movers ?? []).forEach(([x, y], i) => {
      const mp = map.movingPlatforms[i];
      if (!mp) return;
      const a = this.toScreen(x, y + mp.h, 0);
      const b = this.toScreen(x + mp.w, y + mp.h, -14);
      ctx.fillStyle = '#b8621a';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    });
  }

  drawGround(map, state, now) {
    const { ctx } = this;
    // Plateau du bureau.
    for (const r of map.platforms) {
      ctx.fillStyle = '#c8955c';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(110, 70, 30, 0.22)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let y = r.y + 26; y < r.y + r.h; y += 52) {
        ctx.moveTo(r.x, y);
        for (let x = r.x; x <= r.x + r.w; x += 80) ctx.lineTo(x, y + Math.sin((x + y) * 0.013) * 5);
      }
      ctx.stroke();
      ctx.strokeStyle = '#e2b57f';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
    }
    if (map.hazardEdges) {
      // Bandes glissantes : ruban adhésif de chantier au bord du bureau.
      ctx.fillStyle = this.stripe;
      const b = HAZARD.band;
      for (const r of map.platforms) {
        ctx.fillRect(r.x, r.y, r.w, b);
        ctx.fillRect(r.x, r.y + r.h - b, r.w, b);
        ctx.fillRect(r.x, r.y + b, b, r.h - 2 * b);
        ctx.fillRect(r.x + r.w - b, r.y + b, b, r.h - 2 * b);
      }
    }
    // Trous : tiroir ouvert, on voit le fond très sombre.
    for (const h of map.holes) {
      ctx.fillStyle = '#0d0b1c';
      ctx.fillRect(h.x, h.y, h.w, h.h);
    }
    if (map.checkpoints) {
      ctx.setLineDash([12, 10]);
      ctx.strokeStyle = 'rgba(61, 139, 255, 0.7)';
      ctx.lineWidth = 5;
      for (const x of map.checkpoints.slice(1)) { ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x, 600); ctx.stroke(); }
      ctx.setLineDash([]);
      for (let y = 100; y < 600; y += 20) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (y / 20 + i) % 2 ? '#111' : '#fff';
          ctx.fillRect(map.finishX + i * 20, y, 20, 20);
        }
      }
    }
    // Paroi intérieure du tiroir (face tournée vers nous), dessinée en repère écran.
    this.screenTransform();
    for (const h of map.holes) {
      const a = this.toScreen(h.x, h.y, 0);
      const b = this.toScreen(h.x + h.w, h.y, -TABLE_T);
      const g = ctx.createLinearGradient(0, a.y, 0, b.y);
      g.addColorStop(0, '#6b4524');
      g.addColorStop(1, '#2a1a0e');
      ctx.fillStyle = g;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    this.groundTransform();
    // Plateformes mobiles (règle en plastique qui coulisse).
    (state.movers ?? []).forEach(([x, y], i) => {
      const mp = map.movingPlatforms[i];
      if (!mp) return;
      ctx.fillStyle = '#ffae57';
      ctx.fillRect(x, y, mp.w, mp.h);
      ctx.fillStyle = 'rgba(120, 60, 10, 0.5)';
      for (let k = 6; k < (mp.axis === 'x' ? mp.w : mp.h); k += 12) {
        if (mp.axis === 'x') ctx.fillRect(x + k, y, 2, k % 36 === 6 ? 18 : 10);
        else ctx.fillRect(x, y + k, k % 36 === 6 ? 18 : 10, 2);
      }
    });
    // Ressorts : plaques vertes avec flèche.
    for (const sp of map.springs) {
      ctx.fillStyle = '#2f9e5b';
      ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
      ctx.strokeStyle = '#a6ffcb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const yy = sp.y + 10 + i * ((sp.h - 20) / 3); ctx.moveTo(sp.x + 8, yy); ctx.lineTo(sp.x + sp.w - 8, yy); }
      ctx.stroke();
      ctx.save();
      ctx.translate(sp.x + sp.w / 2, sp.y + sp.h / 2);
      ctx.rotate(sp.dir);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(4, -13); ctx.lineTo(4, 13); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Ombres portées des figurines, projectiles et objets.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const p of state.players) {
      if (p.s !== 'alive') continue;
      const air = (p.f || '').includes('j');
      ctx.beginPath(); ctx.arc(p.x + (air ? 8 : 0), p.y + (air ? 10 : 0), PLAYER.radius * (air ? 0.75 : 1), 0, 7); ctx.fill();
    }
    for (const d of state.decoys) { ctx.beginPath(); ctx.arc(d.x, d.y, PLAYER.radius, 0, 7); ctx.fill(); }
    for (const pr of state.proj) { ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, 7); ctx.fill(); }
    for (const b of state.bombs) { ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, 7); ctx.fill(); }
    for (const pk of state.pickups) { ctx.beginPath(); ctx.arc(pk.x, pk.y, pk.kind === 'crown' ? 20 : 11, 0, 7); ctx.fill(); }
    // Anneau du champion (prime) au sol.
    const champ = state.players.find((p) => p.id === state.champion && p.s === 'alive');
    if (champ) {
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -now * 30;
      ctx.beginPath(); ctx.arc(champ.x, champ.y, 34, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Anneaux d'interface au sol autour du joueur local : munitions (droite) et pichenette (gauche).
    const me = state.players.find((p) => p.id === state.youId);
    if (me && me.s === 'alive' && state.myHud) this.drawOwnHud(me, state.myHud, now);
    if (me && me.s === 'alive' && state.charge) this.drawChargeGround(me, state);
    else if (me && me.s === 'alive') this.drawAimLine(me, state);
  }

  // ------------------------------------------------------------ objets en relief, triés par profondeur
  drawSprites(map, state, now) {
    this.screenTransform();
    const items = [];
    map.walls.forEach((w, i) => items.push({ key: w.y + w.h, draw: () => this.drawWall(w, i) }));
    for (const b of map.bumpers) items.push({ key: b.y, draw: () => this.drawBumper(b, now) });
    for (const tr of state.traps) items.push({ key: tr.y - 10, draw: () => this.drawBanana(tr) });
    for (const pk of state.pickups) items.push({ key: pk.y, draw: () => this.drawPickup(pk, now) });
    for (const d of state.decoys) {
      const owner = state.roster.get(d.owner);
      if (owner) items.push({ key: d.y, draw: () => this.drawFigure({ id: `decoy${d.owner}`, x: d.x, y: d.y, a: d.a, s: 'alive', f: '', w: 'pistol', hp: 100 }, owner, now, { decoy: d.owner === state.youId }) });
    }
    for (const p of state.players) {
      const info = state.roster.get(p.id);
      if (!info || p.s === 'dead') continue;
      items.push({ key: p.y + (p.s === 'falling' ? 2000 : 0), draw: () => this.drawFigure(p, info, now, {}) });
    }
    for (const b of state.bombs) items.push({ key: b.y, draw: () => this.drawBomb(b, now) });
    for (const pr of state.proj) items.push({ key: pr.y, draw: () => this.drawProjectile(pr) });
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();
    // Les étiquettes passent par-dessus tout le décor.
    for (const p of state.players) {
      const info = state.roster.get(p.id);
      if (!info || p.s !== 'alive') continue;
      this.drawLabel(p, info, { me: p.id === state.youId, champion: p.id === state.champion, crown: p.id === state.crownHolder, showHp: state.showHp, channel: p.id === state.youId ? state.channel : null });
    }
    for (const d of state.decoys) {
      const owner = state.roster.get(d.owner);
      if (owner) this.drawLabel({ x: d.x, y: d.y, hp: 100, s: 'alive', f: '' }, owner, { decoy: d.owner === state.youId });
    }
  }

  drawWall(w, i) {
    const { ctx } = this;
    const s = this.cam.scale;
    const c = WALL_COLORS[i % WALL_COLORS.length];
    const top0 = this.toScreen(w.x, w.y, WALL_H);
    const top1 = this.toScreen(w.x + w.w, w.y + w.h, WALL_H);
    const bot = this.toScreen(w.x, w.y + w.h, 0);
    // Face avant.
    ctx.fillStyle = shade(c, -0.28);
    ctx.fillRect(top0.x, top1.y, top1.x - top0.x, bot.y - top1.y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(top0.x, top1.y, top1.x - top0.x, 3 * s);
    // Dessus et tenons.
    ctx.fillStyle = c;
    ctx.fillRect(top0.x, top0.y, top1.x - top0.x, top1.y - top0.y);
    const step = 22;
    for (let x = w.x + step / 2; x < w.x + w.w; x += step) {
      for (let y = w.y + step / 2; y < w.y + w.h; y += step) {
        const p = this.toScreen(x, y, WALL_H);
        ctx.fillStyle = shade(c, -0.18);
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 2 * s, 6.5 * s, 6.5 * s * TILT, 0, 0, 7); ctx.fill();
        ctx.fillStyle = shade(c, 0.3);
        ctx.beginPath(); ctx.ellipse(p.x, p.y - 1 * s, 6 * s, 6 * s * TILT, 0, 0, 7); ctx.fill();
      }
    }
  }

  drawBumper(b, now) {
    // Balle rebondissante en caoutchouc.
    const { ctx } = this;
    const s = this.cam.scale;
    const squish = 1 + Math.sin(now * 6 + b.x) * 0.03;
    const c = this.toScreen(b.x, b.y, b.r * 0.9);
    const r = b.r * s * squish;
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, '#ffc2cf');
    g.addColorStop(0.45, '#ff4d6d');
    g.addColorStop(1, '#a3203a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, r * 0.98, r * 0.35, 0.3, 0, 7); ctx.stroke();
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
      z = -k * k * 260; // tombe vers le sol de la chambre
      scale = 1 - k * 0.35;
      alpha = 1 - k * 0.5;
    }
    const air = f.includes('j');
    if (air) z += 26;
    const moving = Math.hypot(a.vx, a.vy) > 40;
    if (moving && !f.includes('k')) z += Math.abs(Math.sin(a.hop)) * 6;
    if (f.includes('i')) alpha *= 0.45 + 0.4 * Math.sin(now * 30);
    if (opts.decoy) alpha *= 0.55;

    const base = this.toScreen(p.x, p.y, z);
    const rk = Math.max(0, 1 - (now - (this.recoil.get(p.id) ?? -9)) / 0.1);
    const sa = this.screenAngle(p.a);
    const ux = Math.cos(sa);
    const uy = Math.sin(sa);
    // Écrasement à l'atterrissage de chaque petit bond, étirement en pichenette.
    const land = moving ? (1 - Math.abs(Math.sin(a.hop))) * 0.1 : 0;
    const sx = (f.includes('f') ? 0.9 : 1 + land) * scale * s;
    const sy = (f.includes('f') ? 1.12 : 1 - land) * scale * s;

    ctx.save();
    ctx.globalAlpha = Math.max(0.1, alpha);
    ctx.translate(base.x - ux * rk * 4 * s, base.y - uy * rk * 4 * s);
    ctx.rotate(a.lean);
    ctx.scale(sx, sy);
    const color = info.color;

    const drawGun = () => {
      ctx.save();
      ctx.translate(0, -16);
      ctx.rotate(sa);
      const punching = this.effects.some((e) => e.kind === 'punch' && e.id === p.id);
      const gc = WEAPON_COLORS[p.w] ?? '#ff9f1c';
      ctx.fillStyle = gc;
      if (p.w === 'spring_glove') {
        ctx.fillRect(6, -3, punching ? 44 : 16, 6);
        ctx.beginPath(); ctx.arc(punching ? 54 : 26, 0, 9, 0, 7); ctx.fill();
      } else {
        ctx.fillRect(8, -5, 22, 10);
        ctx.fillStyle = shade(gc, -0.35);
        ctx.fillRect(27, -3.5, 7, 7);
      }
      ctx.restore();
    };
    const facingAway = Math.sin(p.a) < -0.25;
    if (facingAway) drawGun();

    // Socle lesté.
    ctx.fillStyle = shade(color, -0.5);
    ctx.beginPath(); ctx.ellipse(0, 0, PLAYER.radius, PLAYER.radius * TILT * 0.75, 0, 0, 7); ctx.fill();
    ctx.fillStyle = shade(color, -0.3);
    ctx.beginPath(); ctx.ellipse(0, -3, PLAYER.radius * 0.95, PLAYER.radius * TILT * 0.7, 0, 0, 7); ctx.fill();
    // Corps et tête en plastique brillant.
    const body = ctx.createRadialGradient(-5, -26, 2, 0, -16, 19);
    body.addColorStop(0, shade(color, 0.6));
    body.addColorStop(0.5, color);
    body.addColorStop(1, shade(color, -0.32));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, -16, 14, 15, 0, 0, 7); ctx.fill();
    const head = ctx.createRadialGradient(-4, -40, 1, 0, -34, 12);
    head.addColorStop(0, shade(color, 0.6));
    head.addColorStop(0.55, color);
    head.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = head;
    ctx.beginPath(); ctx.arc(0, -35, 11, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath(); ctx.ellipse(-4, -40, 3.5, 2.2, -0.6, 0, 7); ctx.fill();
    if (!facingAway) {
      // Yeux qui suivent la visée (de dos, on ne les voit pas).
      const ex = ux * 3.5;
      const ey = Math.max(0, uy) * 2;
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-3.6 + ex, -35 + ey, 1.9, 0, 7); ctx.arc(3.6 + ex, -35 + ey, 1.9, 0, 7); ctx.fill();
      drawGun();
    }
    if (f.includes('g')) {
      ctx.fillStyle = 'rgba(123, 220, 61, 0.7)';
      ctx.beginPath(); ctx.arc(-8, -10, 6, 0, 7); ctx.arc(7, -6, 5, 0, 7); ctx.arc(0, -26, 4, 0, 7); ctx.fill();
    }
    if (now < (this.flash.get(p.id) ?? 0)) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(0, -16, 14, 15, 0, 0, 7); ctx.arc(0, -35, 11, 0, 7); ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = Math.max(0.15, alpha);
    const mid = this.toScreen(p.x, p.y, z + 20);
    if (f.includes('b')) {
      ctx.fillStyle = 'rgba(125, 249, 255, 0.2)';
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mid.x, mid.y, 34 * s, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (f.includes('c')) {
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mid.x, mid.y, 30 * s, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  drawLabel(p, info, opts) {
    const { ctx } = this;
    const s = this.cam.scale;
    const air = (p.f || '').includes('j');
    const top = this.toScreen(p.x, p.y, 58 + (air ? 26 : 0));
    let y = top.y;
    const fs = Math.round(Math.max(11, 13 * Math.min(1.2, s)));
    ctx.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (opts.showHp) {
      const w = 40;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(top.x - w / 2, y - 6, w, 6);
      ctx.fillStyle = p.hp > 50 ? '#3ddc84' : p.hp > 25 ? '#ffd23d' : '#ff5a5a';
      ctx.fillRect(top.x - w / 2, y - 6, (w * p.hp) / 100, 6);
      y -= 8;
    }
    const name = (opts.decoy ? '(leurre) ' : '') + info.name;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(name, top.x, y);
    ctx.fillStyle = opts.me ? '#ffd23d' : '#fff';
    ctx.fillText(name, top.x, y);
    y -= fs + 2;
    const badges = `${opts.crown ? '👑' : ''}${opts.champion ? '🎯 PRIME' : ''}${(p.f || '').includes('p') ? '🛒' : ''}`;
    if (badges) { ctx.strokeText(badges, top.x, y); ctx.fillText(badges, top.x, y); }
    if (opts.channel) {
      const c = this.toScreen(p.x, p.y, 20);
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(c.x, c.y, 32 * s, -Math.PI / 2, -Math.PI / 2 + opts.channel.progress * Math.PI * 2); ctx.stroke();
    }
  }

  // Munitions (arc droit) et pichenette (arc gauche) au sol autour du joueur local.
  drawOwnHud(p, hud, now) {
    const { ctx } = this;
    const R = 30;
    ctx.save();
    ctx.lineCap = 'butt';
    const start = -Math.PI * 0.32;
    const span = Math.PI * 0.64;
    if (hud.reloading > 0) {
      ctx.strokeStyle = 'rgba(255, 210, 61, 0.95)';
      ctx.lineWidth = 5;
      const t = (now * 2) % 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, start + span * t, start + span * Math.min(1, t + 0.25)); ctx.stroke();
    } else if (hud.maxAmmo) {
      const n = hud.maxAmmo;
      const seg = span / n;
      ctx.lineWidth = 5;
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = i < hud.ammo ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, R, start + i * seg + 0.03, start + (i + 1) * seg - 0.03); ctx.stroke();
      }
    }
    const ready = hud.dash <= 0;
    const k = ready ? 1 : 1 - hud.dash / PLAYER.flickCooldown;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI * 0.68, Math.PI * 1.32); ctx.stroke();
    ctx.strokeStyle = ready ? '#7df9ff' : 'rgba(125,249,255,0.5)';
    ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI * 1.32 - Math.PI * 0.64 * k, Math.PI * 1.32); ctx.stroke();
    ctx.restore();
  }

  drawAimLine(me, state) {
    const { ctx } = this;
    const len = state.touch ? 150 : 90;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(me.x + Math.cos(me.a) * 34, me.y + Math.sin(me.a) * 34);
    ctx.lineTo(me.x + Math.cos(me.a) * len, me.y + Math.sin(me.a) * len);
    ctx.stroke();
    ctx.restore();
    if (state.mouseWorld && !state.touch) {
      const { x, y } = state.mouseWorld;
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.moveTo(x - 20, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 20, y); ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 20); ctx.stroke();
    }
  }

  // Aperçu de la pichenette au sol : élastique tendu derrière, trajectoire estimée devant.
  drawChargeGround(me, state) {
    const { ctx } = this;
    const { a, p } = state.charge;
    const ready = !state.myHud || state.myHud.dash <= 0;
    const v0 = PLAYER.flickMinSpeed + (PLAYER.flickMaxSpeed - PLAYER.flickMinSpeed) * p;
    const reach = v0 * (PLAYER.flickTime + 0.3 * p) * 0.9 + v0 / PLAYER.knockbackFriction;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const col = ready ? `hsl(${50 - p * 50}, 100%, 60%)` : 'rgba(180,180,200,0.6)';
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(me.x + dx * 34, me.y + dy * 34); ctx.lineTo(me.x + dx * reach, me.y + dy * reach); ctx.stroke();
    ctx.setLineDash([]);
    const tx = me.x + dx * reach;
    const ty = me.y + dy * reach;
    ctx.beginPath();
    ctx.moveTo(tx + dx * 18, ty + dy * 18);
    ctx.lineTo(tx - dy * 12, ty + dx * 12);
    ctx.lineTo(tx + dy * 12, ty - dx * 12);
    ctx.closePath(); ctx.fill();
    // Élastique : deux brins tirés vers l'arrière.
    const back = 26 + 56 * p;
    const bx = me.x - dx * back;
    const by = me.y - dy * back;
    ctx.strokeStyle = '#ff6fb5';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(me.x - dy * 16, me.y + dx * 16); ctx.lineTo(bx, by);
    ctx.lineTo(me.x + dy * 16, me.y - dx * 16);
    ctx.stroke();
    ctx.fillStyle = '#ff6fb5';
    ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill();
    ctx.restore();
  }

  drawProjectile(pr) {
    const { ctx } = this;
    const s = this.cam.scale;
    const c = this.toScreen(pr.x, pr.y, 18);
    const r = pr.r * s;
    if (pr.kind === 'glue') {
      ctx.fillStyle = 'rgba(123, 220, 61, 0.35)';
      ctx.beginPath(); ctx.arc(c.x, c.y, r + 6 * s, 0, 7); ctx.fill();
      ctx.fillStyle = '#7bdc3d';
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill();
      return;
    }
    if (pr.px !== undefined) {
      const t = this.toScreen(pr.px, pr.py, 18);
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.5)';
      ctx.lineWidth = r * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(125, 249, 255, 0.35)';
    ctx.beginPath(); ctx.arc(c.x, c.y, r + 6 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8feff';
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill();
  }

  drawBanana(tr) {
    const { ctx } = this;
    const s = this.cam.scale;
    const c = this.toScreen(tr.x, tr.y, 4);
    ctx.save();
    ctx.globalAlpha = tr.armed ? 1 : 0.45;
    ctx.font = `${Math.round(30 * s)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍌', c.x, c.y);
    ctx.restore();
  }

  drawBomb(b, now) {
    const { ctx } = this;
    const s = this.cam.scale;
    const c = this.toScreen(b.x, b.y, 11);
    const blink = b.fuse < 0.5 && Math.sin(now * 40) > 0;
    ctx.fillStyle = blink ? '#fff' : '#ff6fb5';
    ctx.beginPath(); ctx.arc(c.x, c.y, 11 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath(); ctx.arc(c.x + 6 * s, c.y - 10 * s, (3 + Math.random() * 2) * s, 0, 7); ctx.fill();
  }

  drawPickup(pk, now) {
    const { ctx } = this;
    const s = this.cam.scale;
    const bob = Math.sin(now * 4 + pk.id) * 3;
    if (pk.kind === 'crown') {
      const c = this.toScreen(pk.x, pk.y, 30 + bob);
      ctx.font = `${Math.round(40 * s)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👑', c.x, c.y);
      return;
    }
    // Jeton debout qui tourne sur lui-même.
    const gold = pk.kind === 'gold';
    const r = (gold ? 15 : 10) * s;
    const c = this.toScreen(pk.x, pk.y, 14 + bob);
    const w = Math.max(0.15, Math.abs(Math.cos(now * 3 + pk.id)));
    ctx.fillStyle = '#b08a12';
    ctx.beginPath(); ctx.ellipse(c.x + 1.5 * s, c.y, r * w, r, 0, 0, 7); ctx.fill();
    ctx.fillStyle = gold ? '#ffb300' : '#ffd23d';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, r * w, r, 0, 0, 7); ctx.fill();
    if (gold && w > 0.5) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(13 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('3', c.x, c.y + 1);
    }
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
          this.groundTransform();
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 5 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.3 + k * 0.9), 0, 7); ctx.stroke();
          this.screenTransform();
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
          // Choc de plastique : étoile blanche.
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
          const z = 20 + 140 * k - 220 * k * k;
          const c = this.toScreen(x, y, Math.max(0, z));
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
          for (let i = 0; i < 6; i++) {
            const ang = i * 1.05 + e.born;
            const c = this.toScreen(p.x + Math.cos(ang) * 22 * (1 + k), p.y + Math.sin(ang) * 22 * (1 + k), 2);
            ctx.beginPath(); ctx.arc(c.x, c.y, (6 * (1 - k) + 1) * s, 0, 7); ctx.fill();
          }
          break;
        }
        case 'twang': {
          // Vibration de l'élastique juste après le relâchement.
          const p = findP(e.id);
          if (!p) break;
          const c = this.toScreen(p.x, p.y, 20);
          ctx.strokeStyle = '#ff6fb5';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const wob = Math.sin(t * Math.PI * 4 + now * 60) * 8 * (1 - k) * s;
            const x = c.x - 30 * s + t * 60 * s;
            if (i === 0) ctx.moveTo(x, c.y + 26 * s + wob); else ctx.lineTo(x, c.y + 26 * s + wob);
          }
          ctx.stroke();
          break;
        }
        case 'punch': {
          const p = findP(e.id);
          if (!p) break;
          this.groundTransform();
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 70, e.aim - 0.6, e.aim + 0.6); ctx.stroke();
          this.screenTransform();
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // Ambiance de nuit : une lampe de bureau éclaire un coin, le reste baigne dans le bleu.
  drawNight(map) {
    const { ctx, W, H } = this;
    this.screenTransform();
    const lamp = map.follow
      ? { x: W * 0.25, y: -H * 0.1 }
      : this.toScreen(map.width * 0.12, map.height * 0.05, 120);
    const R = Math.max(W, H) * 1.05;
    const g = ctx.createRadialGradient(lamp.x, lamp.y, R * 0.05, lamp.x, lamp.y, R);
    g.addColorStop(0, 'rgba(255, 200, 120, 0.10)');
    g.addColorStop(0.45, 'rgba(20, 24, 70, 0.0)');
    g.addColorStop(1, 'rgba(8, 10, 40, 0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ couche d'interface (écran)
  drawOverlay(now, state, me) {
    const { ctx, W, H } = this;
    this.screenTransform();
    if (me && me.s === 'alive' && state.showHp && me.hp <= 35) {
      const beat = 0.35 + 0.25 * Math.sin(now * (me.hp <= 20 ? 12 : 7));
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(1, `rgba(255,0,40,${beat})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    this.dmgDirs = this.dmgDirs.filter((d) => now - d.born < 0.9);
    if (me && this.dmgDirs.length) {
      const c = this.toScreen(me.x, me.y, 20);
      const R = Math.min(W, H) * 0.22;
      for (const d of this.dmgDirs) {
        const k = 1 - (now - d.born) / 0.9;
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.9 * k})`;
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(c.x, c.y, R, d.a - 0.32, d.a + 0.32); ctx.stroke();
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
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
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
