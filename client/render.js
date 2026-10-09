// Rendu Canvas 2D : formes provisoires mais silhouettes lisibles (murs, bumpers,
// bords dangereux, ressorts), figurines « plastique » et effets de retour.
import { MAPS } from '../shared/maps.js';
import { PLAYER, HAZARD } from '../shared/constants.js';
import { settings } from './settings.js';

const WALL_COLORS = ['#ff5a5a', '#3d8bff', '#3ddc84', '#ffd23d', '#c45cff', '#ff8f3d'];
const WEAPON_COLORS = { pistol: '#ff9f1c', glue_launcher: '#7bdc3d', spring_glove: '#ff4d6d' };

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = [];
    this.cam = { x: 800, y: 500, scale: 1 };
    this.fallStart = new Map();
    this.shake = 0;
    this.flash = new Map(); // id -> fin du flash blanc (touché)
    this.recoil = new Map(); // id -> instant du dernier tir
    this.dmgDirs = []; // directions d'où viennent les dégâts reçus
    this.hitMarkers = []; // touches infligées par le joueur local
    this.hitStopUntil = 0; // micro-gel de l'image sur un impact décisif
    this.stripe = this.makeStripe();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  makeStripe() {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255, 210, 61, 0.55)';
    g.fillRect(0, 0, 24, 24);
    g.fillStyle = 'rgba(30, 30, 30, 0.55)';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(12, 0); g.lineTo(0, 12); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(24, 0); g.lineTo(24, 12); g.lineTo(12, 24); g.lineTo(0, 24); g.closePath(); g.fill();
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  updateCamera(map, focus) {
    const pad = 30;
    if (!map.follow) {
      const fit = Math.min(this.W / (map.width + pad), this.H / (map.height + pad));
      // Petit écran : l'arène entière serait illisible, on zoome et on suit le joueur.
      const small = Math.min(this.W, this.H) < 560;
      const scale = small && focus ? Math.max(fit, Math.min(this.H / 640, this.W / 980)) : fit;
      if (scale === fit) {
        this.cam = { x: map.width / 2, y: map.height / 2, scale };
        return;
      }
      const hx = this.W / 2 / scale;
      const hy = this.H / 2 / scale;
      const tx = Math.max(hx - 60, Math.min(map.width - hx + 60, focus.x));
      const ty = Math.max(hy - 60, Math.min(map.height - hy + 60, focus.y));
      const same = Math.abs(this.cam.scale - scale) < 1e-6;
      this.cam = { x: same ? this.cam.x + (tx - this.cam.x) * 0.18 : tx, y: same ? this.cam.y + (ty - this.cam.y) * 0.18 : ty, scale };
      return;
    }
    const scale = Math.min(this.H / (map.height + pad), this.W / 900);
    const half = this.W / 2 / scale;
    const fx = focus ? focus.x + 150 : half;
    const x = Math.max(half - 100, Math.min(map.width - half + 100, fx));
    // Lissage pour éviter les à-coups.
    const cx = this.cam.scale === scale ? this.cam.x + (x - this.cam.x) * 0.15 : x;
    this.cam = { x: cx, y: map.height / 2, scale };
  }

  toScreen(x, y) {
    const { cam } = this;
    return { x: (x - cam.x) * cam.scale + this.W / 2, y: (y - cam.y) * cam.scale + this.H / 2 };
  }

  toWorld(sx, sy) {
    const { cam } = this;
    return { x: (sx - this.W / 2) / cam.scale + cam.x, y: (sy - this.H / 2) / cam.scale + cam.y };
  }

  // ------------------------------------------------------------ effets
  addEvent(ev, players, youId) {
    const now = performance.now() / 1000;
    const p = ev.id ? players.get(ev.id) : null;
    const push = (fx) => this.effects.push({ born: now, ...fx });
    switch (ev.type) {
      case 'impact': push({ kind: 'spark', x: ev.x, y: ev.y, life: 0.25, color: ev.kind === 'glue' ? '#7bdc3d' : '#7df9ff' }); break;
      case 'dmg':
        push({ kind: 'text', x: ev.x, y: ev.y - 30, text: `-${ev.amount}`, color: ev.by === youId ? '#ffffff' : '#ff5a5a', life: 0.8, size: ev.by === youId ? 20 : 16 });
        this.flash.set(ev.id, now + 0.09);
        if (ev.id === youId) {
          if (ev.ax !== null) this.dmgDirs.push({ a: Math.atan2(ev.ay - ev.y, ev.ax - ev.x), born: now });
          this.shake = Math.max(this.shake, 5);
        }
        if (ev.by === youId) this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: false });
        break;
      case 'push':
        this.flash.set(ev.id, now + 0.06);
        if (ev.by === youId) this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: false, soft: true });
        break;
      case 'shot':
        this.recoil.set(ev.id, now);
        push({ kind: 'muzzle', id: ev.id, life: 0.07, color: ev.kind === 'glue' ? '#b6ff7a' : '#fff3b0' });
        break;
      case 'dash':
        push({ kind: 'dust', id: ev.id, life: 0.35 });
        break;
      case 'boom':
        push({ kind: 'ring', x: ev.x, y: ev.y, r: ev.r, life: 0.45, color: '#ff6fb5' });
        for (let i = 0; i < 26; i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 120 + Math.random() * 260, life: 0.9, color: WALL_COLORS[i % WALL_COLORS.length] });
        this.shake = 8;
        break;
      case 'punch': if (p) push({ kind: 'punch', id: ev.id, aim: ev.aim, life: 0.16 }); break;
      case 'teleport':
        push({ kind: 'ring', x: ev.fx, y: ev.fy, r: 40, life: 0.35, color: '#c45cff' });
        push({ kind: 'ring', x: ev.tx, y: ev.ty, r: 40, life: 0.35, color: '#c45cff' });
        break;
      case 'elim':
        push({ kind: 'text', x: ev.x, y: ev.y - 20, text: ev.cause === 'fall' ? '💫 CHUTE !' : '💥 K.O. !', color: '#ffd23d', life: 1.1, size: 22 });
        for (let i = 0; i < 16; i++) push({ kind: 'confetti', x: ev.x, y: ev.y, a: Math.random() * 6.28, s: 80 + Math.random() * 160, life: 0.7, color: '#ffffff' });
        this.shake = Math.max(this.shake, ev.killer === youId || ev.victim === youId ? 9 : 4);
        if (ev.killer === youId) {
          this.hitMarkers.push({ x: ev.x, y: ev.y, born: now, kill: true });
          this.hitStopUntil = now + 0.08;
        }
        break;
      case 'bump': push({ kind: 'ring', x: ev.x, y: ev.y, r: 46, life: 0.3, color: '#ff4d6d' }); break;
      case 'spring': push({ kind: 'ring', x: ev.x, y: ev.y, r: 50, life: 0.35, color: '#3ddc84' }); break;
      case 'slip': push({ kind: 'text', x: ev.x, y: ev.y - 30, text: '🍌 Glissade !', color: '#ffe066', life: 1 }); break;
      case 'shieldBreak': push({ kind: 'text', x: ev.x, y: ev.y - 40, text: '🛡️ Bouclier brisé', color: '#ffd23d', life: 1 }); push({ kind: 'ring', x: ev.x, y: ev.y, r: 40, life: 0.4, color: '#ffd23d' }); break;
      case 'blocked': push({ kind: 'ring', x: ev.x, y: ev.y, r: 34, life: 0.25, color: '#7df9ff' }); break;
      case 'coin': push({ kind: 'text', x: ev.x, y: ev.y - 20, text: `+${ev.value}`, color: '#ffd23d', life: 0.7 }); break;
      case 'fizzle': push({ kind: 'spark', x: ev.x, y: ev.y, life: 0.2, color: '#999' }); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ rendu principal
  draw(state) {
    const { ctx, dpr } = this;
    const map = MAPS[state.map] ?? MAPS.arena;
    const me = state.players.find((p) => p.id === state.youId);
    this.updateCamera(map, me);
    const now = performance.now() / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackdrop();

    const { cam } = this;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.1) {
      sx = (Math.random() - 0.5) * this.shake * settings.shake;
      sy = (Math.random() - 0.5) * this.shake * settings.shake;
      this.shake *= 0.85;
    }
    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * (this.W / 2 - cam.x * cam.scale + sx), dpr * (this.H / 2 - cam.y * cam.scale + sy));

    this.drawMap(map, state.movers, state.time);
    for (const pk of state.pickups) this.drawPickup(pk, now);
    for (const tr of state.traps) this.drawBanana(tr);
    for (const d of state.decoys) {
      const owner = state.roster.get(d.owner);
      if (owner) this.drawFigure({ x: d.x, y: d.y, a: d.a, s: 'alive', f: '', w: 'pistol', hp: 100 }, owner, now, { decoy: d.owner === state.youId });
    }
    const order = state.players.slice().sort((a, b) => a.y - b.y);
    for (const p of order) {
      const info = state.roster.get(p.id);
      if (!info || p.s === 'dead') continue;
      this.drawFigure(p, info, now, { hud: p.id === state.youId ? state.myHud : null, me: p.id === state.youId, champion: p.id === state.champion, crown: p.id === state.crownHolder, channel: p.id === state.youId ? state.channel : null, showHp: state.showHp });
    }
    for (const b of state.bombs) this.drawBomb(b, now);
    for (const pr of state.proj) this.drawProjectile(pr);
    if (me && me.s === 'alive') this.drawAim(me, state);
    this.drawEffects(now, state);
    this.drawOverlay(now, state, me);
  }

  // Couche d'interface dessinée en coordonnées écran par-dessus le monde.
  drawOverlay(now, state, me) {
    const { ctx, dpr, W, H } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Vie basse : bords rouges qui battent.
    if (me && me.s === 'alive' && state.showHp && me.hp <= 35) {
      const beat = 0.35 + 0.25 * Math.sin(now * (me.hp <= 20 ? 12 : 7));
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(1, `rgba(255,0,40,${beat})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // Direction des dégâts reçus : arcs rouges autour du joueur.
    this.dmgDirs = this.dmgDirs.filter((d) => now - d.born < 0.9);
    if (me && this.dmgDirs.length) {
      const c = this.toScreen(me.x, me.y);
      const R = Math.min(W, H) * 0.22;
      for (const d of this.dmgDirs) {
        const k = 1 - (now - d.born) / 0.9;
        ctx.strokeStyle = `rgba(255, 60, 60, ${0.9 * k})`;
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, d.a - 0.32, d.a + 0.32);
        ctx.stroke();
      }
    }
    // Adversaires hors de l'écran : flèche colorée sur le bord, dans leur direction.
    if (me) {
      const c = this.toScreen(me.x, me.y);
      const m = 18;
      for (const o of state.players) {
        if (o.id === state.youId || o.s !== 'alive') continue;
        const p = this.toScreen(o.x, o.y);
        if (p.x > m && p.x < W - m && p.y > m && p.y < H - m) continue;
        const a = Math.atan2(p.y - c.y, p.x - c.x);
        const kx = Math.cos(a) > 0 ? (W - m - c.x) / Math.cos(a) : (m - c.x) / Math.cos(a);
        const ky = Math.sin(a) > 0 ? (H - m - c.y) / Math.sin(a) : (m - c.y) / Math.sin(a);
        const k = Math.min(Math.abs(kx), Math.abs(ky));
        const x = c.x + Math.cos(a) * k;
        const y = c.y + Math.sin(a) * k;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = state.roster.get(o.id)?.color ?? '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    // Marqueurs de touche : la confirmation immédiate qu'un tir a porté.
    this.hitMarkers = this.hitMarkers.filter((h) => now - h.born < (h.kill ? 0.45 : 0.22));
    for (const h of this.hitMarkers) {
      const p = this.toScreen(h.x, h.y);
      const k = (now - h.born) / (h.kill ? 0.45 : 0.22);
      const s = (h.kill ? 16 : 9) + k * 6;
      ctx.strokeStyle = h.kill ? '#ff3355' : h.soft ? 'rgba(125,249,255,0.9)' : '#ffffff';
      ctx.lineWidth = h.kill ? 4 : 3;
      ctx.globalAlpha = 1 - k * 0.7;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(p.x + dx * s * 0.45, p.y + dy * s * 0.45);
        ctx.lineTo(p.x + dx * s, p.y + dy * s);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawBackdrop() {
    const { ctx, W, H } = this;
    const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#2a3466');
    g.addColorStop(1, '#0d1128');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawMap(map, movers, time) {
    const { ctx } = this;
    // Ombre portée : la table est surélevée au-dessus du vide.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const r of map.platforms) ctx.fillRect(r.x + 10, r.y + 16, r.w, r.h);
    for (const r of map.platforms) {
      ctx.fillStyle = '#e9d7ad';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(150, 110, 60, 0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = r.y + 22; y < r.y + r.h; y += 44) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
      ctx.stroke();
      ctx.strokeStyle = '#a77d45';
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (map.hazardEdges) {
      ctx.fillStyle = this.stripe;
      const b = HAZARD.band;
      for (const r of map.platforms) {
        ctx.fillRect(r.x, r.y, r.w, b);
        ctx.fillRect(r.x, r.y + r.h - b, r.w, b);
        ctx.fillRect(r.x, r.y + b, b, r.h - 2 * b);
        ctx.fillRect(r.x + r.w - b, r.y + b, b, r.h - 2 * b);
      }
    }
    for (const h of map.holes) {
      ctx.fillStyle = '#121735';
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.strokeStyle = '#a77d45';
      ctx.lineWidth = 4;
      ctx.strokeRect(h.x, h.y, h.w, h.h);
    }
    // Course : points de contrôle et arrivée.
    if (map.checkpoints) {
      ctx.setLineDash([12, 10]);
      ctx.strokeStyle = 'rgba(61, 139, 255, 0.6)';
      ctx.lineWidth = 4;
      for (const x of map.checkpoints.slice(1)) {
        ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x, 600); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let y = 100; y < 600; y += 20) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (y / 20 + i) % 2 ? '#111' : '#fff';
          ctx.fillRect(map.finishX + i * 20, y, 20, 20);
        }
      }
    }
    // Plateformes mobiles.
    (movers ?? []).forEach(([x, y], i) => {
      const mp = map.movingPlatforms[i];
      if (!mp) return;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 6, y + 10, mp.w, mp.h);
      ctx.fillStyle = '#ff9f43';
      ctx.fillRect(x, y, mp.w, mp.h);
      ctx.strokeStyle = '#b8621a';
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, mp.w, mp.h);
      ctx.fillStyle = '#b8621a';
      const arrow = mp.axis === 'x' ? '⇆' : '⇅';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arrow, x + mp.w / 2, y + mp.h / 2);
    });
    // Ressorts.
    for (const s of map.springs) {
      ctx.fillStyle = '#2f9e5b';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = '#a6ffcb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const yy = s.y + 10 + i * ((s.h - 20) / 3); ctx.moveTo(s.x + 8, yy); ctx.lineTo(s.x + s.w - 8, yy); }
      ctx.stroke();
      ctx.save();
      ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
      ctx.rotate(s.dir);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(4, -12); ctx.lineTo(4, 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Bumpers.
    const pulse = 1 + Math.sin(time * 6) * 0.04;
    for (const b of map.bumpers) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(b.x + 4, b.y + 8, b.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.55, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.25, 0, 7); ctx.fill();
    }
    // Murs : blocs de construction.
    map.walls.forEach((w, i) => {
      const c = WALL_COLORS[i % WALL_COLORS.length];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(w.x + 6, w.y + 10, w.w, w.h);
      ctx.fillStyle = shade(c, -0.25);
      ctx.fillRect(w.x, w.y + 6, w.w, w.h - 6 + 6);
      ctx.fillStyle = c;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = shade(c, 0.35);
      const step = 22;
      for (let x = w.x + step / 2; x < w.x + w.w; x += step) {
        for (let y = w.y + step / 2; y < w.y + w.h; y += step) {
          ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
        }
      }
    });
  }

  drawFigure(p, info, now, opts = {}) {
    const { ctx } = this;
    const f = p.f || '';
    let scale = 1;
    let alpha = 1;
    if (p.s === 'falling') {
      if (!this.fallStart.has(p.id)) this.fallStart.set(p.id, now);
      const k = Math.min(1, (now - this.fallStart.get(p.id)) / (PLAYER.fallTime + 0.1));
      scale = 1 - k * 0.85;
      alpha = 1 - k * 0.6;
    } else {
      this.fallStart.delete(p.id);
    }
    const air = f.includes('j');
    if (air) scale *= 1.22;
    if (f.includes('i')) alpha *= 0.45 + 0.4 * Math.sin(now * 30);
    if (opts.decoy) alpha *= 0.55;

    ctx.save();
    ctx.globalAlpha = Math.max(0.1, alpha);
    const R = PLAYER.radius;
    // Ombre.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x + (air ? 10 : 3), p.y + (air ? 22 : 6), R * (air ? 0.8 : 1), R * 0.55, 0, 0, 7);
    ctx.fill();

    // Recul de l'arme au tir et étirement pendant l'esquive.
    const rk = Math.max(0, 1 - (now - (this.recoil.get(p.id) ?? -9)) / 0.1);
    ctx.translate(p.x - Math.cos(p.a) * rk * 4, p.y - Math.sin(p.a) * rk * 4 - (air ? 10 : 0));
    ctx.scale(scale, scale);
    if (f.includes('d')) ctx.scale(1.12, 0.9);
    if (f.includes('l')) ctx.rotate(now * 14);
    const color = info.color;

    // Arme orientée dans la direction de visée.
    ctx.save();
    ctx.rotate(p.a);
    const punching = this.effects.some((e) => e.kind === 'punch' && e.id === p.id);
    ctx.fillStyle = WEAPON_COLORS[p.w] ?? '#ff9f1c';
    if (p.w === 'spring_glove') {
      ctx.fillRect(8, -4, punching ? 46 : 18, 8);
      ctx.beginPath(); ctx.arc(punching ? 56 : 28, 0, 10, 0, 7); ctx.fill();
    } else {
      ctx.fillRect(10, -6, 24, 12);
      ctx.fillStyle = shade(WEAPON_COLORS[p.w] ?? '#ff9f1c', -0.35);
      ctx.fillRect(30, -4, 8, 8);
    }
    ctx.restore();

    // Socle, corps et tête façon figurine plastique.
    ctx.fillStyle = shade(color, -0.45);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    const body = ctx.createRadialGradient(-5, -12, 2, 0, -4, 18);
    body.addColorStop(0, shade(color, 0.55));
    body.addColorStop(0.5, color);
    body.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, -3, 15, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -15, 10.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.ellipse(-4, -19, 3.5, 2.2, -0.6, 0, 7); ctx.fill();
    // Yeux qui suivent la visée.
    const ex = Math.cos(p.a) * 3;
    const ey = Math.sin(p.a) * 2;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-3.5 + ex, -15 + ey, 1.9, 0, 7); ctx.arc(3.5 + ex, -15 + ey, 1.9, 0, 7); ctx.fill();
    if (f.includes('g')) {
      ctx.fillStyle = 'rgba(123, 220, 61, 0.65)';
      ctx.beginPath(); ctx.arc(-8, 4, 6, 0, 7); ctx.arc(7, 7, 5, 0, 7); ctx.arc(0, -8, 4, 0, 7); ctx.fill();
    }
    if (now < (this.flash.get(p.id) ?? 0)) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.arc(0, -3, 15, 0, 7); ctx.arc(0, -15, 10.5, 0, 7); ctx.fill();
    }
    ctx.restore();
    if (opts.hud && p.s === 'alive') this.drawOwnHud(p, opts.hud, now);

    ctx.save();
    ctx.globalAlpha = Math.max(0.15, alpha);
    if (f.includes('b')) {
      ctx.fillStyle = 'rgba(125, 249, 255, 0.22)';
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y - 6, 32, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (f.includes('c')) {
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(p.x, p.y - 4, 29, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (f.includes('d')) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 7); ctx.stroke();
    }

    // Étiquettes au-dessus de la tête (taille constante à l'écran).
    const s = this.cam.scale;
    const fs = Math.max(11, 13 * s) / s;
    ctx.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let top = p.y - 34;
    if (opts.showHp && p.s === 'alive') {
      const w = 40;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - w / 2, top - 6, w, 6);
      ctx.fillStyle = p.hp > 50 ? '#3ddc84' : p.hp > 25 ? '#ffd23d' : '#ff5a5a';
      ctx.fillRect(p.x - w / 2, top - 6, (w * p.hp) / 100, 6);
      top -= 8;
    }
    const name = (opts.decoy ? '(leurre) ' : '') + info.name;
    ctx.lineWidth = 3 / s;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(name, p.x, top);
    ctx.fillStyle = opts.me ? '#ffd23d' : '#fff';
    ctx.fillText(name, p.x, top);
    top -= fs + 2;
    const badges = `${opts.crown ? '👑' : ''}${opts.champion ? '🎯 PRIME' : ''}${f.includes('p') ? '🛒' : ''}`;
    if (badges) ctx.fillText(badges, p.x, top);
    if (opts.channel) {
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + opts.channel.progress * Math.PI * 2); ctx.stroke();
    }
    if (opts.me) {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath(); ctx.moveTo(p.x, p.y + 30); ctx.lineTo(p.x - 7, p.y + 40); ctx.lineTo(p.x + 7, p.y + 40); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // Munitions et esquive affichées sous le personnage : pas besoin de quitter l'action des yeux.
  drawOwnHud(p, hud, now) {
    const { ctx } = this;
    const R = 27;
    const start = Math.PI * 0.2;
    const span = Math.PI * 0.6;
    ctx.save();
    ctx.lineCap = 'butt';
    if (hud.reloading > 0) {
      ctx.strokeStyle = 'rgba(255, 210, 61, 0.9)';
      ctx.lineWidth = 4;
      const t = (now * 2) % 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, start + span * t, start + span * Math.min(1, t + 0.25)); ctx.stroke();
    } else if (hud.maxAmmo) {
      const n = hud.maxAmmo;
      const gap = 0.03;
      const seg = span / n;
      ctx.lineWidth = 4;
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = i < hud.ammo ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, R, start + span - (i + 1) * seg + gap, start + span - i * seg - gap); ctx.stroke();
      }
    }
    // Esquive : arc gauche, plein = disponible.
    const ready = hud.dash <= 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI * 0.82, Math.PI * 1.18); ctx.stroke();
    ctx.strokeStyle = ready ? '#7df9ff' : 'rgba(125,249,255,0.55)';
    const k = ready ? 1 : 1 - hud.dash / 4;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, Math.PI * 1.18 - Math.PI * 0.36 * k, Math.PI * 1.18); ctx.stroke();
    ctx.restore();
  }

  drawAim(me, state) {
    const { ctx } = this;
    const len = state.touch ? 150 : 90;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(me.x + Math.cos(me.a) * 30, me.y + Math.sin(me.a) * 30);
    ctx.lineTo(me.x + Math.cos(me.a) * len, me.y + Math.sin(me.a) * len);
    ctx.stroke();
    ctx.restore();
    if (state.mouseWorld && !state.touch) {
      const { x, y } = state.mouseWorld;
      ctx.strokeStyle = '#ffd23d';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.moveTo(x - 16, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 16); ctx.stroke();
    }
  }

  drawProjectile(pr) {
    const { ctx } = this;
    if (pr.kind === 'glue') {
      ctx.fillStyle = 'rgba(123, 220, 61, 0.35)';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r + 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#7bdc3d';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, 7); ctx.fill();
      return;
    }
    if (pr.px !== undefined) {
      ctx.strokeStyle = 'rgba(125, 249, 255, 0.5)';
      ctx.lineWidth = pr.r * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pr.px, pr.py); ctx.lineTo(pr.x, pr.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(125, 249, 255, 0.35)';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r + 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8feff';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, 7); ctx.fill();
  }

  drawBanana(tr) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = tr.armed ? 1 : 0.45;
    ctx.translate(tr.x, tr.y);
    ctx.rotate(0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(3, 5, 16, 8, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -8, 14, 0.4, Math.PI - 0.4); ctx.stroke();
    ctx.strokeStyle = '#6b4a16';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -8, 14, 0.3, 0.45); ctx.stroke();
    ctx.restore();
  }

  drawBomb(b, now) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + 6, 11, 6, 0, 0, 7); ctx.fill();
    const blink = b.fuse < 0.5 && Math.sin(now * 40) > 0;
    ctx.fillStyle = blink ? '#fff' : '#ff6fb5';
    ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath(); ctx.arc(b.x + 6, b.y - 10, 3 + Math.random() * 2, 0, 7); ctx.fill();
  }

  drawPickup(pk, now) {
    const { ctx } = this;
    const bob = Math.sin(now * 4 + pk.id) * 3;
    if (pk.kind === 'crown') {
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,210,61,0.3)';
      ctx.beginPath(); ctx.arc(pk.x, pk.y, 30 + Math.sin(now * 5) * 4, 0, 7); ctx.fill();
      ctx.fillText('👑', pk.x, pk.y + bob);
      return;
    }
    const gold = pk.kind === 'gold';
    const r = gold ? 15 : 10;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(pk.x + 2, pk.y + 6, r, r * 0.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = gold ? '#ffb300' : '#ffd23d';
    ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#b08a12';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, r * 0.62, 0, 7); ctx.stroke();
    if (gold) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('3', pk.x, pk.y + bob + 1);
    }
  }

  drawEffects(now, state) {
    const { ctx } = this;
    const s = this.cam.scale;
    this.effects = this.effects.filter((e) => now - e.born < e.life);
    for (const e of this.effects) {
      const k = (now - e.born) / e.life;
      ctx.globalAlpha = 1 - k;
      switch (e.kind) {
        case 'spark':
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(e.x, e.y, 6 + k * 18, 0, 7); ctx.stroke();
          break;
        case 'ring':
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 5 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.3 + k * 0.9), 0, 7); ctx.stroke();
          break;
        case 'confetti':
          ctx.fillStyle = e.color;
          ctx.fillRect(e.x + Math.cos(e.a) * e.s * k - 3, e.y + Math.sin(e.a) * e.s * k + 60 * k * k - 2, 6, 4);
          break;
        case 'text': {
          const fs = Math.max(13, (e.size ?? 16) * s) / s;
          ctx.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3 / s;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(e.text, e.x, e.y - k * 30);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, e.x, e.y - k * 30);
          break;
        }
        case 'muzzle': {
          const p = state.players.find((x) => x.id === e.id);
          if (!p) break;
          const mx = p.x + Math.cos(p.a) * 42;
          const my = p.y + Math.sin(p.a) * 42;
          ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(mx, my, 9 * (1 - k * 0.5), 0, 7); ctx.fill();
          break;
        }
        case 'dust': {
          const p = state.players.find((x) => x.id === e.id);
          if (!p) break;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          for (let i = 0; i < 5; i++) {
            const a = i * 1.26 + e.born;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 18 * (1 + k), p.y + 12 + Math.sin(a) * 6 * (1 + k), 5 * (1 - k) + 1, 0, 7); ctx.fill();
          }
          break;
        }
        case 'punch': {
          const p = state.players.find((x) => x.id === e.id);
          if (!p) break;
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(p.x, p.y, 70, e.aim - 0.6, e.aim + 0.6); ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
