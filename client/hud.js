// Interface DOM : phases, chronomètre, classement, inventaire, boutique, lobby.
import { ROUND_OPTIONS } from '../shared/constants.js';
import { settings, setSetting } from './settings.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PHASE_LABEL = {
  lobby: '🎱 Billard libre',
  intro: 'Préparez-vous…',
  minigame: '',
  rewards: '🎰 Distributeur',
  combat: '🎱 MÊLÉE',
  lastShop: 'Fin de la Mêlée',
  finaleIntro: '🏆 FINALE',
  finale: '🏆 FINALE',
  final: 'Classement final',
};

const CATEGORY_LABEL = { perk: 'atout permanent', gadget: 'gadget · bouton rond' };

export class Hud {
  constructor({ send, items, onShopToggle }) {
    this.send = send;
    this.items = new Map(items.map((i) => [i.id, i]));
    this.onShopToggle = onShopToggle;
    this.feed = [];
    this.shopOpen = false;
    this.shopKey = '';
    this.lobbyKey = '';
    this.lastPhase = null;
    this.lobbyCollapsed = false;
    this.toastTimer = 0;
    this.phaseStartedAt = 0;
    $('#shopBtn').onclick = () => this.toggleShop();
    this.bindSettings();
    $('#shopClose').onclick = () => this.toggleShop(false);
    $('#shopItems').addEventListener('click', (e) => {
      const b = e.target.closest('[data-item]');
      if (b && !b.disabled) this.send({ t: 'buy', item: b.dataset.item });
      if (e.target.closest('[data-reroll]')) this.send({ t: 'reroll' });
    });
    $('#lobby').addEventListener('click', (e) => this.onLobbyClick(e));
    $('#lobby').addEventListener('change', (e) => {
      if (e.target.id === 'rounds') this.send({ t: 'settings', rounds: Number(e.target.value) });
    });
    $('#itemBtn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onItem?.();
      e.currentTarget.classList.add('on');
      setTimeout(() => $('#itemBtn').classList.remove('on'), 140);
    });
  }

  toggleShop(force) {
    this.shopOpen = force ?? !this.shopOpen;
    $('#shop').hidden = !this.shopOpen;
    this.shopKey = '';
    document.body.classList.toggle('shop-open', this.shopOpen);
    this.onShopToggle?.(this.shopOpen);
  }

  toast(text, bad = false) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  name(id) {
    const p = this.roster?.get(id);
    return p ? `<span class="dot" style="background:${p.color}"></span> ${esc(p.name)}` : '?';
  }

  pushFeed(html) {
    this.feed.unshift({ html, at: performance.now() });
    this.feed = this.feed.slice(0, document.body.classList.contains('touch') ? 2 : 6);
  }

  onEvent(ev, youId) {
    const it = (id) => this.items.get(id);
    const plain = (id) => esc(this.roster?.get(id)?.name ?? '?');
    switch (ev.type) {
      case 'elim':
        {
          const into = this.map === 'arena' || this.map === 'golf' ? 'dans une poche' : 'dans le vide';
          if (ev.killer === youId) this.announce(`🎱 ${plain(ev.victim)} poussé ${into} !`, 'good');
          else if (ev.victim === youId) this.announce(ev.killer ? `Poussé par ${plain(ev.killer)}` : `Tombé ${into}…`, 'bad');
        }
        {
          const pool = this.map === 'arena';
          if (ev.killer) this.pushFeed(`${this.name(ev.killer)} ${ev.cause === 'fall' ? (pool ? '🎱 empoche' : '🌀 pousse') : '💥'} ${this.name(ev.victim)}`);
          else this.pushFeed(`${this.name(ev.victim)} ${ev.cause === 'fall' ? (pool ? 'tombe dans une poche' : 'tombe dans le vide') : 'est K.O.'}`);
        }
        break;
      case 'bought': this.pushFeed(`${this.name(ev.id)} achète ${it(ev.item)?.icon ?? ''} ${esc(it(ev.item)?.name ?? '')}`); break;
      case 'points':
        if (ev.id === youId && ev.reason === 'Carton') this.announce('💥 CARTON !<small>+1 point</small>', 'good');
        else if (ev.id === youId && ev.reason === 'Boule empochée') this.announce('🎱 Boule empochée !<small>+1 point</small>', 'good');
        else if (ev.id === youId && ev.reason !== 'Mini-jeu' && ev.reason !== 'Finale') this.pushFeed(`🏆 +${ev.amount} pts — ${esc(ev.reason)}`);
        break;
      case 'credits':
        if (ev.id === youId && (ev.reason === 'Contrat rempli' || ev.reason === 'Prime du champion')) {
          this.pushFeed(`💰 +${ev.amount} crédits — ${esc(ev.reason)}`);
          this.announce(`${ev.reason === 'Contrat rempli' ? '📜' : '🎯'} ${esc(ev.reason)}<small>+${ev.amount} crédits</small>`, 'good');
        }
        break;
      case 'lobbyPoint':
        if (ev.reason === 'slam') {
          if (ev.id === youId) this.announce(`💥 CARTON !<small>+1</small>`, 'good');
        } else if (ev.id === youId) this.announce(`🎱 ${plain(ev.victim)} empoché !<small>+3</small>`, 'good');
        else if (ev.victim === youId) this.announce(`🎱 Empoché par ${plain(ev.id)}`, 'bad');
        break;
      case 'champion':
        this.pushFeed(`🎯 ${this.name(ev.id)} est le champion : bouclier + prime !`);
        this.announce(ev.id === youId ? '🎯 Tu es le champion !<small>Une bouée gratuite… mais ta tête est mise à prix</small>' : `🎯 Prime sur ${plain(ev.id)}<small>+2 pts et +30 crédits pour qui l'empoche</small>`, ev.id === youId ? 'good' : '');
        break;
      case 'join': this.pushFeed(`➕ ${esc(ev.name)} rejoint la salle`); break;
      case 'leave': this.pushFeed(`➖ ${esc(ev.name)} est parti`); break;
      case 'host': this.pushFeed(`⭐ ${this.name(ev.id)} devient l'hôte`); break;
      case 'finish': this.pushFeed(`🏁 ${this.name(ev.id)} arrive ${ev.place === 1 ? '1er' : `${ev.place}e`} !`); break;
      case 'crownTake': this.pushFeed(`👑 ${this.name(ev.id)} prend la couronne`); break;
      case 'crownSteal':
        if (ev.id === youId) this.announce('👑 Couronne volée !', 'good');
        else if (ev.victim === youId) this.announce(`👑 ${plain(ev.id)} t'a volé la couronne !`, 'bad');
        break;
      case 'saved': if (ev.id === youId) this.announce('🛟 Sauvé par la bouée !', 'good'); break;
      case 'meneEnd':
        if (ev.scores?.[youId] !== undefined) this.announce(`🎯 Mène terminée<small>+${ev.scores[youId]} point${ev.scores[youId] > 1 ? 's' : ''}</small>`, ev.scores[youId] > 0 ? 'good' : '');
        break;
      case 'coinLoss': if (ev.id === youId) this.toast(`Chute : -${ev.amount} jetons`, true); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ mise à jour par instantané
  update(snap, youId) {
    const { m, you } = snap;
    this.roster = new Map(snap.roster.map((r) => [r.id, r]));
    this.map = snap.w.map;
    this.youId = youId;
    this.isHost = snap.host === youId;

    if (m.phase !== this.lastPhase) {
      this.phaseStartedAt = performance.now();
      if (m.phase === 'rewards' && you?.inMatch) this.toggleShop(true);
      else this.toggleShop(false);
      this.lastPhase = m.phase;
    }

    // Barre du haut.
    $('#round').textContent = m.phase === 'lobby' ? `Salle ${snap.code}` : m.round > m.rounds ? 'Finale' : `Manche ${m.round}/${m.rounds}`;
    $('#phase').textContent = (m.phase === 'minigame' || m.phase === 'finale') ? m.mg?.name ?? '' : PHASE_LABEL[m.phase] ?? '';
    const tl = m.timeLeft;
    const timer = $('#timer');
    timer.textContent = tl === null ? '' : `${Math.ceil(tl)} s`;
    timer.classList.toggle('hurry', tl !== null && tl <= 5 && ['combat', 'minigame', 'finale'].includes(m.phase));

    this.renderScoreboard(snap, m);
    this.renderCenter(snap, m, you);
    this.renderLobby(snap, m);
    this.renderInventory(you);
    this.renderContract(you);
    this.renderMiniHud(m);
    this.renderFeed();
    if (this.shopOpen) this.renderShop(you, m);
    $('#shopBtn').hidden = m.shop === 'closed';
  }

  renderScoreboard(snap, m) {
    const inMatch = m.phase !== 'lobby';
    const rows = snap.roster.filter((r) => !inMatch || r.inMatch).slice();
    if (inMatch) rows.sort((a, b) => b.pts - a.pts || b.w - a.w || b.k - a.k);
    const extra = (r) => {
      if (m.hud?.kind === 'coins') return `🪙 ${m.hud.scores[r.id] ?? 0}`;
      if (m.hud?.kind === 'micro') return `⭐ ${m.hud.scores[r.id] ?? 0}`;
      if (m.hud?.kind === 'crown') return `👑 ${(m.hud.held[r.id] ?? 0).toFixed(0)}s`;
      if (m.hud?.kind === 'palet') return `🎯 ${m.hud.scores[r.id] ?? 0}`;
      if (m.hud?.kind === 'glutton') return m.hud.out.includes(r.id) ? '💀' : '🟢';
      return inMatch ? `${r.pts} pts` : `🎱 ${r.ls ?? 0}${r.host ? ' ⭐' : ''}`;
    };
    const unit = { coins: 'jetons', crown: 'couronne', palet: 'cible', glutton: 'en vie', micro: 'réussis' }[m.hud?.kind] ?? 'points';
    const head = inMatch ? `<div class="head"><span>Classement</span><span>${unit}</span></div>` : '<div class="head"><span>Joueurs</span></div>';
    $('#scoreboard').innerHTML = head + rows.map((r) => `
      <div class="row ${r.id === this.youId ? 'me' : ''} ${r.conn ? '' : 'off'}">
        <span class="dot" style="background:${r.color}"></span>
        <span class="name">${r.id === m.champion ? '🎯 ' : ''}${esc(r.name)}</span>
        <span class="val">${extra(r)}</span>
      </div>`).join('');
  }

  renderCenter(snap, m, you) {
    const c = $('#center');
    let html = '';
    const sinceStart = (performance.now() - this.phaseStartedAt) / 1000;
    if ((m.phase === 'intro' || m.phase === 'finaleIntro') && m.mg) {
      html = `<div class="card"><h2>${esc(m.mg.name)}</h2><p>${esc(m.mg.description)}</p><div class="big">${Math.max(1, Math.ceil(m.timeLeft ?? 0))}</div></div>`;
    } else if ((m.phase === 'rewards' || m.phase === 'final') && m.results && m.phase === 'rewards') {
      const rows = m.results.awards.map((a) => `<tr><td>${a.rank}</td><td>${this.name(a.id)}</td><td class="num">+${a.credits} 💰</td><td class="num">+${a.points} 🏆</td></tr>`).join('');
      const champ = m.champion ? `<p>🎯 ${this.name(m.champion)} est le champion : une bouée gratuite, mais sa tête est mise à prix (+2 pts, +30 💰).</p>` : '';
      html = `<div class="card"><h2>${esc(m.results.name)}</h2><table class="res"><tr><th>#</th><th>Joueur</th><th>Crédits</th><th>Points</th></tr>${rows}</table>${champ}<p>🎰 Distributeur ouvert. Mêlée sur le billard dans ${Math.ceil(m.timeLeft ?? 0)} s.</p></div>`;
    } else if (m.phase === 'final' && m.standings) {
      const s = m.standings;
      const pod = [s[1], s[0], s[2]].filter(Boolean).map((p) => `<div class="p${p.rank}">${p.rank === 1 ? '👑' : p.rank}<br>${esc(p.name)}<br>${p.points} pts</div>`).join('');
      const rows = s.map((p) => `<tr><td>${p.rank}</td><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}${p.connected ? '' : ' (déco.)'}</td><td class="num">${p.points}</td><td class="num">${p.kills}</td><td class="num">${p.wins}</td></tr>`).join('');
      html = `<div class="card"><h2>🏆 ${esc(s[0]?.name ?? '')} remporte le tournoi !</h2><div class="podium">${pod}</div><table class="res"><tr><th>#</th><th>Joueur</th><th>Points</th><th>Élim.</th><th>Victoires</th></tr>${rows}</table><p>Retour au lobby dans ${Math.ceil(m.timeLeft ?? 0)} s</p></div>`;
    } else if (you?.respawn > 0 && m.phase !== 'lobby') {
      html = `<div class="msg">Réapparition dans ${you.respawn.toFixed(1)} s</div>`;
    } else if (m.phase === 'combat' && sinceStart < 1.6) {
      html = '<div class="big">MÊLÉE !</div>';
    } else if (m.hud?.kind === 'palet' && m.hud.phase === 'score' && m.hud.last) {
      html = `<div class="msg">🎯 Mène ${m.hud.mene}/${m.hud.menes} : +${m.hud.last[this.youId] ?? 0}</div>`;
    } else if ((m.phase === 'minigame' || m.phase === 'finale') && sinceStart < 1.2) {
      html = '<div class="big">GO !</div>';
    } else if (m.phase === 'lastShop') {
      html = `<div class="msg">Fin de la Mêlée — ${m.round >= m.rounds ? 'finale' : 'manche suivante'} dans ${Math.ceil(m.timeLeft ?? 0)} s</div>`;
    }
    if (c.innerHTML !== html) c.innerHTML = html;
  }

  renderLobby(snap, m) {
    const el = $('#lobby');
    el.hidden = m.phase !== 'lobby';
    if (el.hidden) return;
    const link = `${location.origin}${location.pathname}?room=${snap.code}`;
    const solo = snap.code === 'SOLO';
    const key = JSON.stringify([snap.roster.map((r) => [r.id, r.name, r.conn, r.host]), snap.settings, this.isHost, this.lobbyCollapsed]);
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    el.classList.toggle('collapsed', this.lobbyCollapsed);
    const players = snap.roster.map((r) => `<div><span class="dot" style="background:${r.color}"></span>${esc(r.name)}${r.host ? ' ⭐' : ''}${r.id === this.youId ? ' (vous)' : ''}</div>`).join('');
    const hostCtl = this.isHost
      ? `<div class="row">
          <label>Manches <select id="rounds">${ROUND_OPTIONS.map((n) => `<option value="${n}" ${n === snap.settings.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button class="btn small" data-a="addBot">+ Bot</button>
          <button class="btn small" data-a="removeBot">− Bot</button>
          <button class="btn primary" data-a="start">Lancer la partie</button>
        </div>`
      : '<p class="hint">En attente du lancement par l\'hôte ⭐</p>';
    el.innerHTML = `
      <div class="row" style="justify-content:space-between;margin:0">
        <h2>${solo ? 'Entraînement solo' : 'Salle privée'}</h2>
        <button class="btn small ghost" data-a="collapse">${this.lobbyCollapsed ? 'Agrandir' : 'Réduire'}</button>
      </div>
      <div class="details">
        ${solo ? '<p class="hint">La simulation tourne dans votre navigateur avec des bots.</p>' : `<div>Code : <span class="code">${esc(snap.code)}</span></div>
        <div class="row"><input readonly value="${esc(link)}" style="flex:1;min-width:0"><button class="btn small" data-a="copy">Copier le lien</button></div>`}
        <div class="players">${players}</div>
        <p class="hint">🎱 Billard libre en attendant : +3 par adversaire empoché, +1 par gros choc. Les boules roulent : sers-t'en ! ${snap.roster.length}/8 joueurs — 4 à 8 recommandés.</p>
      </div>
      ${hostCtl}`;
    el.dataset.link = link;
  }

  onLobbyClick(e) {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'collapse') { this.lobbyCollapsed = !this.lobbyCollapsed; this.lobbyKey = ''; return; }
    if (a === 'copy') {
      const link = $('#lobby').dataset.link;
      navigator.clipboard?.writeText(link).then(() => this.toast('Lien copié !'), () => this.toast(link));
      return;
    }
    this.send({ t: a });
  }

  // Atouts (lecture seule) et bouton rond du gadget avec ses charges.
  renderInventory(you) {
    if (!you) return;
    const inv = you.inv;
    const perks = you.inMatch
      ? inv.perks.map((id) => `<span title="${esc(this.items.get(id)?.name ?? '')}">${this.items.get(id)?.icon ?? '?'}</span>`).join('')
        + (you.saves > 0 ? `<span class="saves" title="Bouée prête">🛟${you.saves > 1 ? you.saves : ''}</span>` : '')
      : '';
    if ($('#gear').innerHTML !== perks) $('#gear').innerHTML = perks;
    $('#wallet').innerHTML = you.inMatch ? `💰 ${you.credits}<br>🏆 ${you.points}` : '💰 —<br>🏆 —';
    const g = inv.gadget;
    const icon = g ? this.items.get(g.id)?.icon : null;
    const btn = $('#itemBtn');
    btn.classList.toggle('empty', !g || g.charges <= 0);
    const cd = g && g.cooldown > 0 ? 100 : 0;
    const html = `<span class="ico">${icon ?? '·'}</span>${g ? `<b class="count">${g.charges}</b>` : ''}<i class="ring" style="--cd:${cd}%"></i>`;
    if (btn.innerHTML !== html) btn.innerHTML = html;
  }

  announce(html, tone = '') {
    const el = document.querySelector('#announce');
    el.innerHTML = `<div class="a ${tone}">${html}</div>`;
  }

  bindSettings() {
    const panel = $('#settingsPanel');
    const open = (on) => {
      panel.hidden = !on;
      document.body.classList.toggle('settings-open', on);
    };
    $('#settingsBtn').onclick = () => open(panel.hidden);
    $('#settingsClose').onclick = () => open(false);
    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = !!settings[key];
      el.onchange = () => setSetting(key, el.checked);
    };
    bindCheck('#setHaptics', 'haptics');
    $('#setShake').value = String(settings.shake);
    $('#setShake').onchange = (e) => setSetting('shake', Number(e.target.value));
    $('#setVolume').value = String(settings.volume);
    $('#setVolume').oninput = (e) => setSetting('volume', Number(e.target.value));
  }

  renderContract(you) {
    const el = $('#contract');
    const c = you?.contract;
    el.hidden = !c;
    if (!c) return;
    el.classList.toggle('done', c.done);
    // Une ligne au début, puis une petite pastille (le détail reste au survol).
    const key = `${c.kind}|${c.label}`;
    if (key !== this.contractKey) { this.contractKey = key; this.contractShownAt = performance.now(); }
    const compact = performance.now() - this.contractShownAt > 5000;
    el.classList.toggle('compact', compact && !c.done);
    el.title = `Contrat de rattrapage : ${c.label} → +${c.reward} crédits`;
    const text = c.done
      ? `✅ Contrat rempli : +${c.reward} 💰`
      : compact
        ? `📜 ${Math.floor(c.progress)}/${c.goal} → +${c.reward} 💰`
        : `📜 ${c.label} (${Math.floor(c.progress)}/${c.goal}) → +${c.reward} 💰`;
    if (el.textContent !== text) el.textContent = text;
  }

  renderMiniHud(m) {
    const el = $('#minihud');
    if (m.hud?.kind === 'race') {
      const dots = m.hud.players.map((p) => {
        const r = this.roster.get(p.id);
        return r ? `<span class="dot" title="${esc(r.name)}" style="left:${(p.progress * 100).toFixed(1)}%;background:${r.color};${p.id === this.youId ? 'width:16px;height:16px;top:0' : ''}"></span>` : '';
      }).join('');
      el.innerHTML = `<div class="race-bar">${dots}<span class="flag">🏁</span></div>`;
    } else if (m.hud?.kind === 'palet') {
      const html = `<div class="mini-pill">🎯 Mène ${m.hud.mene}/${m.hud.menes} · 2 pichenettes</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'glutton') {
      const html = `<div class="mini-pill">🕳️ Poches ×${m.hud.scale.toFixed(1)} · ${m.hud.alive.length} en vie</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (el.innerHTML) {
      el.innerHTML = '';
    }
    document.body.classList.toggle('race-on', ['race', 'palet', 'glutton'].includes(m.hud?.kind));
  }

  renderFeed() {
    const now = performance.now();
    this.feed = this.feed.filter((f) => now - f.at < 6000);
    const html = this.feed.map((f) => `<div class="item">${f.html}</div>`).join('');
    if ($('#feed').innerHTML !== html) $('#feed').innerHTML = html;
  }

  // Le Distributeur : trois capsules personnelles, achat direct, relance.
  renderShop(you, m) {
    if (!you) return;
    const open = m.shop === 'open' && you.inMatch;
    const key = JSON.stringify([you.offers, you.credits, you.inv, you.freeRerolls, open]);
    $('#shopMode').textContent = open ? `${Math.ceil(m.timeLeft ?? 0)} s avant la Mêlée` : 'Fermé : rouvre après chaque mini-jeu';
    if (key === this.shopKey) return;
    this.shopKey = key;
    const inv = you.inv;
    const cards = (you.offers ?? []).map((id) => {
      const d = this.items.get(id);
      if (!d) return '';
      const afford = you.credits >= d.price;
      let note = '';
      if (d.category === 'perk' && inv.perks.length >= 3) note = `remplace ${this.items.get(inv.perks[0])?.icon ?? ''}`;
      if (d.category === 'gadget' && inv.gadget) note = `remplace ${this.items.get(inv.gadget.id)?.icon ?? ''}`;
      return `<button class="capsule ${d.category} ${afford ? '' : 'poor'}" data-item="${id}" ${open && afford ? '' : 'disabled'}>
        <span class="ico">${d.icon}</span>
        <span class="title">${esc(d.name)}</span>
        <span class="tag">${CATEGORY_LABEL[d.category]}${d.charges ? ` · ${d.charges} charge${d.charges > 1 ? 's' : ''}` : ''}</span>
        <span class="desc">${esc(d.description)}</span>
        <span class="tip">${esc(d.tip ?? '')}</span>
        <span class="price">${d.price} 💰${note ? `<small> · ${note}</small>` : ''}</span>
      </button>`;
    }).join('');
    const empty = !cards ? '<p class="note">Main vide : relance pour de nouvelles capsules.</p>' : '';
    const free = you.freeRerolls > 0;
    const reroll = `<button class="btn small ${free ? 'primary' : ''}" data-reroll="1" ${open && (free || you.credits >= 15) ? '' : 'disabled'}>🔄 Relancer ${free ? '(gratuit)' : '(15 💰)'}</button>`;
    const owned = `<div class="owned">Atouts : ${inv.perks.map((id) => this.items.get(id)?.icon).join(' ') || '—'} · Gadget : ${inv.gadget ? this.items.get(inv.gadget.id)?.icon : '—'}</div>`;
    $('#shopItems').innerHTML = `<div class="capsules">${cards}</div>${empty}<div class="shop-foot">${reroll}<span class="wallet">💰 ${you.credits}</span></div>${owned}`;
  }

  renderFullTable(snap, show) {
    const el = $('#fullTable');
    el.hidden = !show;
    if (!show) return;
    const rows = snap.roster.slice().sort((a, b) => b.pts - a.pts).map((r, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="background:${r.color}"></span> ${esc(r.name)}</td><td class="num">${r.pts}</td><td class="num">${r.cr}</td><td class="num">${r.k}</td><td class="num">${r.d}</td><td class="num">${r.w}</td></tr>`).join('');
    el.innerHTML = `<table class="res"><tr><th>#</th><th>Joueur</th><th>Points</th><th>Crédits</th><th>Élim.</th><th>Chutes/K.O.</th><th>Victoires</th></tr>${rows}</table>`;
  }
}
