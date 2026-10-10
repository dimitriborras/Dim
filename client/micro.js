// Interface des micro-jeux (La Rafale) : mot d'ordre géant, mèche qui brûle, une scène
// par micro-jeu et un tampon « Réussi / Raté ». Les gestes sont envoyés au serveur avec
// l'instant estimé côté serveur (`serverNow`) pour que les jeux de réflexe restent équitables.
import { vibrate } from './settings.js';
import { SKILLS } from '../shared/game/minigames/micros.js';
import { Mic } from './mic.js';

const RPS = ['✊', '✋', '✌️'];
const LIAR_CARDS = ['🍀', '💀'];

const PADS = ['#ff4d4d', '#3d8bff', '#3ddc84', '#ffd23d'];
// Position des gobelets après les `k` premiers échanges (pos[gobelet] = emplacement).
function cupSlots(swaps, k) {
  const pos = [0, 1, 2];
  for (let i = 0; i < k && i < swaps.length; i++) {
    const [a, b] = swaps[i];
    const ca = pos.indexOf(a);
    const cb = pos.indexOf(b);
    pos[ca] = b;
    pos[cb] = a;
  }
  return pos;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MicroOverlay {
  constructor(root, { send, serverNow, sfx, nameOf = () => '?' }) {
    this.nameOf = nameOf;
    this.mic = new Mic();
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
      <div class="m-skill"></div>
      <div class="m-verb"></div>
      <div class="m-vsline"></div>
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
      if (this.mic.state === 'on') this.mic.stop();
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
    const sk = SKILLS[h.skill];
    const skill = this.el('.m-skill');
    skill.innerHTML = `${sk ? `<span>${sk.icon} ${esc(sk.label)}</span>` : ''}<span class="lvl">${'★'.repeat(h.level ?? 1)}</span>${h.boss ? '<span class="boss">👑 BOSS · 2 pts</span>' : ''}`;
    skill.hidden = h.phase === 'result';
    this.el('.m-result').innerHTML = '';
    const verb = this.el('.m-verb');
    verb.textContent = h.verb.replace(/ ([!?])/g, '\u00a0$1'); // le « ! » ne part pas seul à la ligne
    verb.classList.remove('pop');
    void verb.offsetWidth; // relance l'animation
    verb.classList.add('pop');
    this.el('.m-hint').textContent = h.phase === 'announce' && h.index > 0 && h.index % 3 === 0 ? `⚡ PLUS VITE ! — ${h.hint}` : h.hint;
    // Le micro n'est ouvert que le temps du micro-jeu de souffle.
    if (h.id === 'blow' && h.phase !== 'result') this.mic.start();
    else if (this.mic.state === 'on') this.mic.stop();
    if (h.phase === 'announce') {
      this.stage.innerHTML = '';
      this.local = {};
      this.tone('microAnnounce');
      if (h.id === 'blow') this.el('.m-hint').textContent = '🎤 Autorise le micro… et prépare-toi à souffler !';
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
    const you = this.you ?? {};
    const duel = h.data?.pairs && you.opp
      ? `<div class="m-vs">${h.id === 'rps' ? `${RPS[you.choice] ?? '…'} <small>contre</small> ${RPS[you.oppChoice] ?? '…'}` : `<small>contre</small> ${esc(this.nameOf(you.opp))}`}</div>`
      : '';
    let extra = '';
    if ((h.id === 'minority' || h.id === 'unique') && you.counts) {
      const opts = h.data.options;
      extra = `<div class="m-tally">${you.counts.map((n, i) => `<span class="${you.choice === (h.id === 'unique' ? i + 1 : i) ? 'mine' : ''} ${h.id === 'unique' && you.winning === i + 1 ? 'win' : ''}"><b>${opts[i]}</b><i>${'●'.repeat(n) || '·'}</i></span>`).join('')}</div>`;
    } else if (h.id === 'liar' && you.truth !== undefined) {
      extra = `<div class="m-vs">${you.role === 'teller' ? 'Tu as' : `${esc(this.nameOf(you.opp))} a`} ${you.lied ? '<b class="bad">menti</b>' : 'dit <b class="ok">la vérité</b>'} : la carte était ${LIAR_CARDS[you.truth]}</div>`;
    }
    res.innerHTML = mine === undefined ? '' : extra + (h.id === 'liar' ? '' : duel) + `<div class="stamp ${mine ? 'ok' : 'ko'}">${mine ? `✔ RÉUSSI !<small>+${h.boss ? 2 : 1}</small>` : '✘ RATÉ'}</div><div class="others">${row}</div>`;
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
      case 'moles':
        st.innerHTML = `<div class="m-counter">🐹 <b>0</b> / 3</div><div class="m-moles">${Array.from({ length: 9 }, (_, i) => `<button class="m-hole" data-hole="${i}"><span></span></button>`).join('')}</div>`;
        break;
      case 'calc':
        st.innerHTML = `<div class="m-word m-calc">${esc(d.text)} = ?</div>
          <div class="m-choices">${d.options.map((n, i) => `<button class="m-choice" data-choice="${i}">${n}</button>`).join('')}</div>`;
        break;
      case 'intrus':
        st.innerHTML = `<div class="m-grid2">${d.items.map((e, i) => `<button class="m-choice m-emoji" data-choice="${i}">${e}</button>`).join('')}</div>`;
        break;
      case 'cups':
        st.innerHTML = `<div class="m-cups">${[0, 1, 2].map((c) => `<button class="m-cup" data-cup="${c}"><span class="cup">🥤</span>${c === d.ball ? '<span class="ball">🔴</span>' : ''}</button>`).join('')}</div><div class="m-counter m-cups-msg">Regarde bien…</div>`;
        break;
      case 'simon':
        st.innerHTML = `<div class="m-counter m-simon-msg">Regarde…</div><div class="m-simon">${PADS.map((c, i) => `<button class="m-pad" data-pad="${i}" style="--c:${c}"></button>`).join('')}</div><div class="m-dots">${d.seq.map(() => '<i></i>').join('')}</div>`;
        break;
      case 'bigger':
        st.innerHTML = `<div class="m-piles">${d.piles.map((pile, i) => `<button class="m-pile" data-choice="${i}">${pile.map(([x, y]) => `<span style="left:${x * 100}%;top:${y * 100}%">${d.emoji}</span>`).join('')}</button>`).join('')}</div>`;
        break;
      case 'aim':
        st.innerHTML = '<div class="m-aimbox"><span class="m-target">🎯</span></div><div class="m-counter">Essais : <b>3</b></div>';
        break;
      case 'spell':
        st.innerHTML = `<div class="m-big">${esc(d.emoji)}</div>
          <div class="m-choices m-col">${d.options.map((w, i) => `<button class="m-choice" data-choice="${i}">${esc(w)}</button>`).join('')}</div>`;
        break;
      case 'tug':
        st.innerHTML = `<div class="m-vs">Toi <small>contre</small> ${esc(this.nameOf(d.pairs?.[this.youId]))}</div><div class="m-rope"><div class="m-knot">🎀</div><span class="me">🫵</span><span class="them">😤</span></div><div class="m-tapzone">TAPE, TAPE, TAPE !</div>`;
        break;
      case 'western':
        st.innerHTML = `<div class="m-vs">Toi <small>contre</small> ${esc(this.nameOf(d.pairs?.[this.youId]))}</div><div class="m-draw m-western">🤠 … 🤠</div>`;
        break;
      case 'rps':
        st.innerHTML = `<div class="m-vs">Toi <small>contre</small> ${esc(this.nameOf(d.pairs?.[this.youId]))}</div><div class="m-choices">${RPS.map((e, i) => `<button class="m-choice m-emoji" data-choice="${i}">${e}</button>`).join('')}</div>`;
        break;
      case 'minority':
        st.innerHTML = `<div class="m-hint2">🤫 Personne ne voit ton choix avant la fin</div><div class="m-choices">${d.options.map((e, i) => `<button class="m-choice m-emoji" data-choice="${i}">${e}</button>`).join('')}</div>`;
        break;
      case 'unique':
        st.innerHTML = `<div class="m-hint2">🤫 Le plus petit nombre que personne d'autre n'a choisi</div><div class="m-choices m-five">${d.options.map((n, i) => `<button class="m-choice" data-choice="${n}">${n}</button>`).join('')}</div>`;
        break;
      case 'liar':
        st.innerHTML = `<div class="m-vs">Toi <small>contre</small> ${esc(this.nameOf(d.pairs?.[this.youId]))}</div><div class="m-liar"></div>`;
        break;
      case 'blow':
        st.innerHTML = `<div class="m-cake">${Array.from({ length: d.candles }, () => '<span class="m-candle"><i>🔥</i></span>').join('')}<div class="m-cake-base">🎂</div></div>
          <div class="m-meter"><i></i></div><div class="m-counter m-blow-msg"></div>`;
        break;
      default:
        st.innerHTML = '';
    }
  }

  stamp() {
    return Math.round(this.serverNow() * 1000) / 1000;
  }

  bindStage() {
    const st = this.stage;
    st.addEventListener('pointerdown', (e) => {
      const h = this.hud;
      if (!h || h.phase !== 'play') return;
      const lb = e.target.closest('[data-liar]');
      if (lb && h.id === 'liar') {
        if (this.local.liarSent === lb.closest('.m-liar')?.dataset.key) return;
        this.local.liarSent = lb.closest('.m-liar')?.dataset.key;
        lb.classList.add('picked');
        this.send({ t: 'mg', k: 'choice', v: Number(lb.dataset.liar) });
        vibrate(12);
        return;
      }
      const choice = e.target.closest('[data-choice]');
      if (choice) {
        if (this.local.choice !== undefined) return;
        this.local.choice = Number(choice.dataset.choice);
        choice.classList.add('picked');
        this.send({ t: 'mg', k: 'choice', v: this.local.choice });
        vibrate(10);
        return;
      }
      const hole = e.target.closest('[data-hole]');
      if (hole && h.id === 'moles') {
        this.send({ t: 'mg', k: 'choice', v: Number(hole.dataset.hole), at: this.stamp() });
        hole.classList.remove('whack');
        void hole.offsetWidth;
        hole.classList.add('whack');
        this.tone('microTap');
        vibrate(8);
        return;
      }
      const pad = e.target.closest('[data-pad]');
      if (pad && h.id === 'simon') {
        const d = h.data;
        if (this.serverNow() < d.start + 0.4 + d.seq.length * d.step - 0.1 || this.local.failed) return;
        const v = Number(pad.dataset.pad);
        this.send({ t: 'mg', k: 'choice', v });
        const i = this.local.i ?? 0;
        if (d.seq[i] === v) this.local.i = i + 1;
        else this.local.failed = true;
        pad.classList.remove('lit');
        void pad.offsetWidth;
        pad.classList.add('lit');
        this.tone('microTap');
        vibrate(8);
        return;
      }
      const cup = e.target.closest('[data-cup]');
      if (cup && h.id === 'cups') {
        const d = h.data;
        if (this.local.choice !== undefined || this.serverNow() < d.start + d.reveal + d.swaps.length * d.swapTime - 0.1) return;
        this.local.choice = cupSlots(d.swaps, d.swaps.length)[Number(cup.dataset.cup)];
        cup.classList.add('picked');
        this.send({ t: 'mg', k: 'choice', v: this.local.choice });
        vibrate(10);
        return;
      }
      if (h.id === 'aim') {
        const box = st.querySelector('.m-aimbox');
        const r = box?.getBoundingClientRect();
        if (!r || (this.local.tries ?? 0) >= 3 || this.local.hit) return;
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        this.local.tries = (this.local.tries ?? 0) + 1;
        this.send({ t: 'mg', k: 'tap', v: 1, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, at: this.stamp() });
        const mark = document.createElement('i');
        mark.className = 'm-shot';
        mark.style.left = `${x * 100}%`;
        mark.style.top = `${y * 100}%`;
        box.appendChild(mark);
        this.tone('microTap');
        vibrate(12);
        e.preventDefault();
        return;
      }
      if (h.id === 'tug') {
        this.local.taps = (this.local.taps ?? 0) + 1;
        this.send({ t: 'mg', k: 'tap', v: 1 });
        this.tone('microTap');
        vibrate(5);
        e.preventDefault();
        return;
      }
      if (h.id === 'western') {
        if (this.local.tapped) return;
        this.local.tapped = this.serverNow();
        this.send({ t: 'mg', k: 'tap', v: 1, at: Math.round(this.local.tapped * 1000) / 1000 });
        this.tone('punch');
        vibrate(20);
        e.preventDefault();
        return;
      }
      if (h.id === 'blow') {
        this.local.rub = { x: e.clientX, y: e.clientY, t: performance.now() };
        e.preventDefault();
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
      // Sans micro, frotter l'écran fait office de souffle.
      if (this.hud?.id === 'blow' && this.local.rub) {
        const r = this.local.rub;
        const now = performance.now();
        const dt = Math.max(1, now - r.t);
        const speed = Math.hypot(e.clientX - r.x, e.clientY - r.y) / dt; // px/ms
        this.local.rubLevel = Math.max(this.local.rubLevel ?? 0, Math.min(1, speed / 1.2));
        this.local.rub = { x: e.clientX, y: e.clientY, t: now };
        return;
      }
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
    const end = (e) => { this.local.rub = null; if (this.local.winding === e.pointerId) this.local.winding = null; };
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
    const vsl = this.el('.m-vsline');
    const rivals = this.you?.rivals;
    const vsTxt = h.physics && rivals?.length ? `Toi contre ${rivals.map((id) => this.nameOf(id)).join(' et ')}` : '';
    if (vsl.textContent !== vsTxt) vsl.textContent = vsTxt;
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
      case 'liar': {
        const box = this.stage.querySelector('.m-liar');
        if (!box) break;
        const teller = you.role === 'teller';
        const announce = now < d.split;
        let key;
        let html;
        if (teller) {
          key = `t${you.card}|${you.claim}|${announce}`;
          html = `<div class="m-card">${LIAR_CARDS[you.card] ?? '?'}<small>ta carte (secrète)</small></div>`
            + (you.claim === null && announce
              ? `<div class="m-choices m-two"><button class="m-choice" data-liar="0">J'annonce 🍀</button><button class="m-choice" data-liar="1">J'annonce 💀</button></div><div class="m-hint2">Dis la vérité… ou mens !</div>`
              : `<div class="m-hint2">${you.claim === null ? '⌛ Trop tard pour annoncer' : `Tu as annoncé ${LIAR_CARDS[you.claim]}… va-t-il te croire ?`}</div>`);
        } else {
          key = `g${you.claim}|${you.verdict}|${announce}`;
          html = you.claim === null
            ? `<div class="m-card back">🂠<small>${announce ? 'il regarde sa carte…' : 'aucune annonce'}</small></div>`
            : `<div class="m-card">${LIAR_CARDS[you.claim]}<small>il annonce</small></div>`
              + (you.verdict === null && !announce
                ? '<div class="m-choices m-two"><button class="m-choice" data-liar="0">👍 Je te crois</button><button class="m-choice liar" data-liar="1">👉 MENTEUR !</button></div>'
                : `<div class="m-hint2">${you.verdict ? (you.verdict === 'liar' ? 'Tu l\'accuses de mentir…' : 'Tu le crois…') : 'Attends le verdict…'}</div>`);
        }
        if (box.dataset.key !== key) { box.dataset.key = key; box.innerHTML = html; }
        break;
      }
      case 'tug': {
        const k = Math.max(-1, Math.min(1, you.rope ?? 0));
        const knot = this.stage.querySelector('.m-knot');
        if (knot) knot.style.left = `${50 - k * 36}%`; // le nœud vient de ton côté quand tu gagnes
        break;
      }
      case 'western': {
        const el = this.stage.querySelector('.m-western');
        if (!el) break;
        const go = now >= d.signalAt;
        const early = this.local.tapped !== undefined && this.local.tapped < d.signalAt;
        el.classList.toggle('go', go && !early);
        el.classList.toggle('early', early);
        const txt = early ? '😬 Faux départ !' : this.local.tapped ? (you.oppAt !== null && you.oppAt !== undefined && you.oppAt < this.local.tapped ? '💥 Trop lent…' : '💥 PAN !') : go ? '🔔 DÉGAINE !' : '🤠 … 🤠';
        if (el.textContent !== txt) {
          el.textContent = txt;
          if (go && !early && !this.local.tapped) vibrate(40);
        }
        break;
      }
      case 'blow': {
        const mic = this.mic.read();
        const rub = this.local.rubLevel ?? 0;
        this.local.rubLevel = rub * 0.8; // le frottement retombe vite quand on arrête
        const v = Math.max(mic, rub);
        if (!this.local.sentAt || performance.now() - this.local.sentAt > 90) {
          if (v > 0.05) this.send({ t: 'mg', k: 'blow', v: Math.round(v * 100) / 100 });
          this.local.sentAt = performance.now();
          this.local.breath = Math.min(d.candles, (this.local.breath ?? 0) + v * 0.09 * 2.6);
        }
        const out = Math.max(you.out ?? 0, Math.floor(this.local.breath ?? 0));
        this.stage.querySelectorAll('.m-candle').forEach((c, i) => c.classList.toggle('out', i < out));
        const meter = this.stage.querySelector('.m-meter i');
        if (meter) meter.style.transform = `scaleX(${v})`;
        const msg = this.stage.querySelector('.m-blow-msg');
        const txt = this.mic.state === 'on' ? '🎤 Souffle fort !' : this.mic.state === 'asking' ? '🎤 Autorise le micro… ou frotte l\'écran' : '👆 Pas de micro : frotte l\'écran très vite !';
        if (msg && msg.textContent !== txt) msg.textContent = txt;
        break;
      }
      case 'moles': {
        const holes = this.stage.querySelectorAll('.m-hole');
        holes.forEach((el, i) => {
          const pop = d.pops.find((x) => x.hole === i && now >= x.from && now <= x.to);
          const face = pop ? (pop.bomb ? '💣' : '🐹') : '';
          const span = el.firstChild;
          if (span.textContent !== face) span.textContent = face;
          el.classList.toggle('up', !!pop);
        });
        const c = this.stage.querySelector('.m-counter b');
        if (c) c.textContent = you.bomb ? '💥' : you.hits ?? 0;
        break;
      }
      case 'cups': {
        const t = now - d.start;
        const n = d.swaps.length;
        const k = Math.max(0, Math.floor((t - d.reveal) / d.swapTime));
        const frac = t < d.reveal ? 0 : Math.min(1, ((t - d.reveal) / d.swapTime) - k);
        const from = cupSlots(d.swaps, Math.min(k, n));
        const to = cupSlots(d.swaps, Math.min(k + 1, n));
        const done = k >= n;
        const ease = frac * frac * (3 - 2 * frac);
        this.stage.querySelectorAll('.m-cup').forEach((el, c) => {
          const slot = done ? from[c] : from[c] + (to[c] - from[c]) * ease;
          const moving = !done && from[c] !== to[c];
          const lift = t < d.reveal * 0.8 ? -46 : 0;
          const arc = moving ? Math.sin(ease * Math.PI) * (to[c] > from[c] ? -26 : 26) : 0;
          el.style.transform = `translate(${(slot - 1) * 105}%, ${arc}px)`;
          const up = el.classList.contains('picked') ? -46 : lift;
          el.querySelector('.cup').style.transform = `translateY(${up}px)`;
          const ball = el.querySelector('.ball');
          if (ball) ball.style.opacity = up ? 1 : 0;
        });
        const msg = this.stage.querySelector('.m-cups-msg');
        const txt = done ? (this.local.choice !== undefined ? '🤞' : 'Où est la bille ?') : 'Regarde bien…';
        if (msg && msg.textContent !== txt) msg.textContent = txt;
        break;
      }
      case 'simon': {
        const t = now - d.start - 0.4;
        const showing = t < d.seq.length * d.step;
        const i = Math.floor(t / d.step);
        const lit = showing && i >= 0 && t - i * d.step < d.step * 0.7 ? d.seq[i] : -1;
        this.stage.querySelectorAll('.m-pad').forEach((el, j) => el.classList.toggle('show', j === lit));
        const msg = this.stage.querySelector('.m-simon-msg');
        const done = this.local.i ?? 0;
        const txt = showing ? 'Regarde…' : this.local.failed ? '✘ Raté !' : done >= d.seq.length ? '✔ Bravo !' : 'À toi !';
        if (msg && msg.textContent !== txt) msg.textContent = txt;
        this.stage.querySelectorAll('.m-dots i').forEach((el, j) => el.classList.toggle('on', j < done));
        break;
      }
      case 'aim': {
        const target = this.stage.querySelector('.m-target');
        const x = 0.5 + 0.38 * Math.sin(((now - d.start) / d.p1) * Math.PI * 2 + d.f1);
        const y = 0.5 + 0.34 * Math.sin(((now - d.start) / d.p2) * Math.PI * 2 + d.f2);
        if (target && !you.hit) { target.style.left = `${x * 100}%`; target.style.top = `${y * 100}%`; }
        if (target) target.classList.toggle('hit', !!you.hit);
        const c = this.stage.querySelector('.m-counter b');
        const left = you.hit ? '🎯 Touché !' : String(3 - Math.max(this.local.tries ?? 0, you.tries ?? 0));
        if (c && c.textContent !== left) c.textContent = left;
        break;
      }
      default:
        break;
    }
  }
}
