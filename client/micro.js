// Interface des micro-jeux (La Rafale) : mot d'ordre géant, mèche qui brûle, une scène
// par micro-jeu et un tampon « Réussi / Raté ». Les gestes sont envoyés au serveur avec
// l'instant estimé côté serveur (`serverNow`) pour que les jeux de réflexe restent équitables.
import { vibrate } from './settings.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MicroOverlay {
  constructor(root, { send, serverNow, sfx }) {
    this.root = root;
    this.send = send;
    this.serverNow = serverNow;
    this.sfx = sfx;
    this.hud = null;
    this.you = null;
    this.key = '';
    this.local = {}; // état local optimiste (tapes, tours, choix)
    this.phaseTotal = 1;
    root.innerHTML = `
      <div class="m-top"><span class="m-count"></span><span class="m-speed"></span></div>
      <div class="m-verb"></div>
      <div class="m-hint"></div>
      <div class="m-stage"></div>
      <div class="m-fuse"><i></i><b>🔥</b></div>
      <div class="m-result"></div>`;
    this.el = (s) => root.querySelector(s);
    this.stage = this.el('.m-stage');
    this.bindStage();
  }

  tone(kind) {
    this.sfx?.play({ type: kind }, null);
  }

  // Appelée à chaque instantané (15 par seconde).
  update(snap) {
    const h = snap.m.hud;
    this.you = snap.you?.micro ?? null;
    this.youId = snap.you?.id;
    if (!h || h.kind !== 'micro' || snap.m.phase !== 'minigame') {
      if (!this.root.hidden) { this.root.hidden = true; document.body.classList.remove('micro-on', 'micro-phys'); }
      this.hud = null;
      return;
    }
    this.root.hidden = false;
    document.body.classList.add('micro-on');
    document.body.classList.toggle('micro-phys', !!h.physics && h.phase === 'play');
    const key = `${h.index}|${h.phase}`;
    if (key !== this.key) this.enterPhase(h, key);
    this.hud = h;
  }

  enterPhase(h, key) {
    this.key = key;
    this.phaseTotal = Math.max(0.3, h.phaseEnd - this.serverNow());
    const r = this.root;
    r.dataset.phase = h.phase;
    r.dataset.id = h.id ?? '';
    this.el('.m-count').textContent = `Micro-jeu ${h.index + 1}/${h.total}`;
    this.el('.m-speed').textContent = h.speed > 1 ? `Vitesse ×${h.speed.toFixed(1)}` : '';
    this.el('.m-result').innerHTML = '';
    const verb = this.el('.m-verb');
    verb.textContent = h.verb;
    verb.classList.remove('pop');
    void verb.offsetWidth; // relance l'animation
    verb.classList.add('pop');
    this.el('.m-hint').textContent = h.phase === 'announce' && h.index > 0 && h.index % 3 === 0 ? `⚡ PLUS VITE ! — ${h.hint}` : h.hint;
    if (h.phase === 'announce') {
      this.stage.innerHTML = '';
      this.local = {};
      this.tone('microAnnounce');
    } else if (h.phase === 'play') {
      this.buildStage(h);
    } else if (h.phase === 'result') {
      this.stage.innerHTML = '';
      this.showResult(h);
    }
  }

  showResult(h) {
    const mine = h.results?.[this.youId];
    const res = this.el('.m-result');
    const row = Object.entries(h.results ?? {}).map(([id, ok]) => `<span class="${ok ? 'ok' : 'ko'}" data-id="${esc(id)}">${ok ? '✔' : '✘'}</span>`).join('');
    res.innerHTML = mine === undefined ? '' : `<div class="stamp ${mine ? 'ok' : 'ko'}">${mine ? '✔ RÉUSSI !<small>+1</small>' : '✘ RATÉ'}</div><div class="others">${row}</div>`;
    if (mine !== undefined) {
      this.tone(mine ? 'microWin' : 'microLose');
      vibrate(mine ? [20, 40, 20] : 80);
    }
  }

  // ------------------------------------------------------------ scènes
  buildStage(h) {
    const d = h.data ?? {};
    const st = this.stage;
    this.local = {};
    switch (h.id) {
      case 'pump':
        st.innerHTML = `<div class="m-big balloon">🎈</div><div class="m-counter"><b>0</b> / ${d.need}</div><div class="m-tapzone">TAPE ICI</div>`;
        break;
      case 'draw':
        st.innerHTML = '<div class="m-draw">⏳ Attends…</div>';
        break;
      case 'stroop':
        st.innerHTML = `<div class="m-word" style="color:${esc(d.ink)}">${esc(d.word)}</div>
          <div class="m-choices">${d.options.map((o, i) => `<button class="m-choice" data-choice="${i}">${esc(o.name)}</button>`).join('')}</div>`;
        break;
      case 'count':
        st.innerHTML = `<div class="m-box">${d.items.map((it) => `<span style="left:${it.x * 100}%;top:${it.y * 100}%;transform:translate(-50%,-50%) rotate(${it.r}rad)">${d.emoji}</span>`).join('')}</div>
          <div class="m-choices" hidden>${d.options.map((n, i) => `<button class="m-choice" data-choice="${i}">${n}</button>`).join('')}</div>`;
        break;
      case 'snap':
        st.innerHTML = `<div class="m-track"><div class="m-slot" style="left:${(d.zone - d.width / 2) * 100}%;width:${d.width * 100}%"></div><div class="m-brick">🧱</div></div><div class="m-tapzone">TAPE AU BON MOMENT</div>`;
        break;
      case 'wind':
        st.innerHTML = `<div class="m-wind"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="bg"/><circle cx="50" cy="50" r="44" class="fg" pathLength="100"/></svg><span class="m-key">🗝️</span></div><div class="m-counter">Tourne avec ton doigt</div>`;
        break;
      default:
        st.innerHTML = '';
    }
  }

  bindStage() {
    const st = this.stage;
    st.addEventListener('pointerdown', (e) => {
      const h = this.hud;
      if (!h || h.phase !== 'play') return;
      const choice = e.target.closest('[data-choice]');
      if (choice) {
        if (this.local.choice !== undefined) return;
        this.local.choice = Number(choice.dataset.choice);
        choice.classList.add('picked');
        this.send({ t: 'mg', k: 'choice', v: this.local.choice });
        vibrate(10);
        return;
      }
      if (h.id === 'pump') {
        this.local.taps = (this.local.taps ?? 0) + 1;
        this.send({ t: 'mg', k: 'tap', v: 1 });
        this.tone('microTap');
        vibrate(5);
      } else if (h.id === 'draw' || h.id === 'snap') {
        if (this.local.tapped) return;
        this.local.tapped = this.serverNow();
        this.send({ t: 'mg', k: 'tap', v: 1, at: Math.round(this.local.tapped * 1000) / 1000 });
        vibrate(12);
      } else if (h.id === 'wind') {
        const r = st.querySelector('.m-wind').getBoundingClientRect();
        this.local.cx = r.left + r.width / 2;
        this.local.cy = r.top + r.height / 2;
        this.local.angle = Math.atan2(e.clientY - this.local.cy, e.clientX - this.local.cx);
        this.local.winding = e.pointerId;
        st.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    });
    st.addEventListener('pointermove', (e) => {
      if (this.hud?.id !== 'wind' || this.local.winding !== e.pointerId) return;
      const a = Math.atan2(e.clientY - this.local.cy, e.clientX - this.local.cx);
      let da = a - this.local.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this.local.angle = a;
      this.local.acc = (this.local.acc ?? 0) + Math.abs(da) / (Math.PI * 2);
      this.local.turns = (this.local.turns ?? 0) + Math.abs(da) / (Math.PI * 2);
      this.local.rot = (this.local.rot ?? 0) + da;
    });
    const end = (e) => { if (this.local.winding === e.pointerId) this.local.winding = null; };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
  }

  // Appelée à chaque image : mèche, brique qui bouge, signal, ballon…
  frame() {
    const h = this.hud;
    if (!h) return;
    const now = this.serverNow();
    const left = Math.max(0, h.phaseEnd - now);
    const fuse = this.el('.m-fuse');
    fuse.hidden = h.phase !== 'play';
    if (h.phase === 'play') {
      const k = Math.min(1, left / this.phaseTotal);
      fuse.querySelector('i').style.transform = `scaleX(${k})`;
      fuse.querySelector('b').style.left = `${k * 100}%`;
    }
    if (h.phase !== 'play') return;
    const d = h.data ?? {};
    const you = this.you ?? {};
    switch (h.id) {
      case 'pump': {
        const taps = Math.max(this.local.taps ?? 0, you.taps ?? 0);
        const k = Math.min(1, taps / d.need);
        const b = this.stage.querySelector('.balloon');
        if (b) b.style.transform = `scale(${0.6 + k * 1.6})`;
        const c = this.stage.querySelector('.m-counter b');
        if (c) c.textContent = taps;
        break;
      }
      case 'draw': {
        const el = this.stage.querySelector('.m-draw');
        if (!el) break;
        const go = now >= d.signalAt;
        const early = this.local.tapped !== undefined && this.local.tapped < d.signalAt;
        el.classList.toggle('go', go && !early);
        el.classList.toggle('early', early);
        const html = early ? '😬 Faux départ !' : this.local.tapped ? '⚡ Pan !' : go ? '🔔 TAPE !' : '⏳ Attends…';
        if (el.textContent !== html) {
          el.textContent = html;
          if (go && !early && !this.local.tapped) vibrate(30);
        }
        break;
      }
      case 'count': {
        const shown = now < (h.phaseEnd - this.phaseTotal) + d.showFor;
        const box = this.stage.querySelector('.m-box');
        const ch = this.stage.querySelector('.m-choices');
        if (box) box.hidden = !shown;
        if (ch) ch.hidden = shown;
        break;
      }
      case 'snap': {
        const brick = this.stage.querySelector('.m-brick');
        const t = this.local.tapped ?? now;
        const pos = 0.5 + 0.45 * Math.sin(((t - d.start) / d.period) * Math.PI * 2 + d.phase);
        if (brick) brick.style.left = `${pos * 100}%`;
        break;
      }
      case 'wind': {
        // Envoi groupé des tours parcourus (environ 20 fois par seconde).
        if (this.local.acc > 0.02 && (!this.local.sentAt || performance.now() - this.local.sentAt > 50)) {
          this.send({ t: 'mg', k: 'wind', v: Math.round(this.local.acc * 1000) / 1000 });
          this.local.acc = 0;
          this.local.sentAt = performance.now();
        }
        const turns = Math.max(this.local.turns ?? 0, you.turns ?? 0);
        const fg = this.stage.querySelector('.fg');
        if (fg) fg.style.strokeDasharray = `${Math.min(100, (turns / d.need) * 100)} 100`;
        const key = this.stage.querySelector('.m-key');
        if (key) key.style.transform = `translate(-50%, -50%) rotate(${this.local.rot ?? 0}rad)`;
        break;
      }
      default:
        break;
    }
  }
}
