// Interface DOM : phases, chronomètre, classement, inventaire, boutique, lobby.
import { ROUND_OPTIONS } from '../shared/constants.js';
import { settings, setSetting } from './settings.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PHASE_LABEL = {
  lobby: 'Lobby — entraînement libre',
  intro: 'Préparez-vous…',
  minigame: '',
  rewards: 'Résultats & boutique sûre',
  combat: '⚔️ COMBAT',
  lastShop: '🛒 Derniers achats',
  finaleIntro: '🏆 FINALE',
  finale: '🏆 FINALE',
  final: 'Classement final',
};

const CATEGORY_LABEL = { weapon: 'arme', gadget: 'gadget', consumable: 'consommable', upgrade: 'amélioration' };

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
      const b = e.target.closest('button[data-item]');
      if (!b) return;
      const slot = b.dataset.slot ? Number(b.dataset.slot) : undefined;
      this.send({ t: 'buy', item: b.dataset.item, slot });
    });
    $('#shopItems').addEventListener('click', (e) => {
      if (e.target.closest('button[data-cancel]')) this.send({ t: 'cancelBuy' });
    });
    $('#lobby').addEventListener('click', (e) => this.onLobbyClick(e));
    $('#lobby').addEventListener('change', (e) => {
      if (e.target.id === 'rounds') this.send({ t: 'settings', rounds: Number(e.target.value) });
    });
    $('#slots').addEventListener('click', (e) => {
      const s = e.target.closest('[data-slot]');
      if (s) this.onSlotTap?.(Number(s.dataset.slot));
    });
    $('#consumables').addEventListener('click', (e) => {
      const s = e.target.closest('[data-cons]');
      if (s) this.onConsumableTap?.(Number(s.dataset.cons));
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
        if (ev.killer === youId) this.announce(`💥 ${plain(ev.victim)} ${ev.cause === 'fall' ? 'poussé dans le vide' : 'K.O.'} !`, 'good');
        else if (ev.victim === youId) this.announce(ev.killer ? `Éliminé par ${plain(ev.killer)}` : ev.cause === 'fall' ? 'Tombé dans le vide…' : 'K.O. !', 'bad');
        if (ev.killer) this.pushFeed(`${this.name(ev.killer)} ${ev.cause === 'fall' ? '🌀 pousse' : '💥'} ${this.name(ev.victim)}`);
        else this.pushFeed(`${this.name(ev.victim)} ${ev.cause === 'fall' ? 'tombe dans le vide' : 'est K.O.'}`);
        break;
      case 'bought': this.pushFeed(`${this.name(ev.id)} achète ${it(ev.item)?.icon ?? ''} ${esc(it(ev.item)?.name ?? '')}`); break;
      case 'points':
        if (ev.id === youId && ev.reason !== 'Mini-jeu' && ev.reason !== 'Finale') this.pushFeed(`🏆 +${ev.amount} pts — ${esc(ev.reason)}`);
        break;
      case 'credits':
        if (ev.id === youId && (ev.reason === 'Contrat rempli' || ev.reason === 'Prime du champion')) {
          this.pushFeed(`💰 +${ev.amount} crédits — ${esc(ev.reason)}`);
          this.announce(`${ev.reason === 'Contrat rempli' ? '📜' : '🎯'} ${esc(ev.reason)}<small>+${ev.amount} crédits</small>`, 'good');
        }
        break;
      case 'champion':
        this.pushFeed(`🎯 ${this.name(ev.id)} est le champion : bouclier + prime !`);
        this.announce(ev.id === youId ? '🎯 Tu es le champion !<small>Bouclier actif… mais ta tête est mise à prix</small>' : `🎯 Prime sur ${plain(ev.id)}<small>+2 pts et +30 crédits pour qui l'élimine</small>`, ev.id === youId ? 'good' : '');
        break;
      case 'join': this.pushFeed(`➕ ${esc(ev.name)} rejoint la salle`); break;
      case 'leave': this.pushFeed(`➖ ${esc(ev.name)} est parti`); break;
      case 'host': this.pushFeed(`⭐ ${this.name(ev.id)} devient l'hôte`); break;
      case 'finish': this.pushFeed(`🏁 ${this.name(ev.id)} arrive ${ev.place === 1 ? '1er' : `${ev.place}e`} !`); break;
      case 'crownTake': this.pushFeed(`👑 ${this.name(ev.id)} prend la couronne`); break;
      case 'coinLoss': if (ev.id === youId) this.toast(`Chute : -${ev.amount} jetons`, true); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ mise à jour par instantané
  update(snap, youId) {
    const { m, you } = snap;
    this.roster = new Map(snap.roster.map((r) => [r.id, r]));
    this.youId = youId;
    this.isHost = snap.host === youId;

    if (m.phase !== this.lastPhase) {
      this.phaseStartedAt = performance.now();
      if (m.phase === 'rewards' || m.phase === 'lastShop') this.toggleShop(true);
      if (m.phase === 'combat' || m.phase === 'intro' || m.phase === 'finaleIntro' || m.phase === 'lobby') this.toggleShop(false);
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
    this.renderInventory(you, m);
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
      if (m.hud?.kind === 'crown') return `👑 ${(m.hud.held[r.id] ?? 0).toFixed(0)}s`;
      return inMatch ? `${r.pts} pts` : r.host ? '⭐' : '';
    };
    const head = inMatch ? `<div class="head"><span>Classement</span><span>${m.hud?.kind === 'coins' ? 'jetons' : m.hud?.kind === 'crown' ? 'couronne' : 'points'}</span></div>` : '<div class="head"><span>Joueurs</span></div>';
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
      const champ = m.champion ? `<p>🎯 ${this.name(m.champion)} est le champion : un bouclier absorbe sa première attaque, mais sa tête est mise à prix (+2 pts, +30 💰).</p>` : '';
      html = `<div class="card"><h2>${esc(m.results.name)}</h2><table class="res"><tr><th>#</th><th>Joueur</th><th>Crédits</th><th>Points</th></tr>${rows}</table>${champ}<p>Achetez maintenant : la boutique est sûre. Combat dans ${Math.ceil(m.timeLeft ?? 0)} s.</p></div>`;
    } else if (m.phase === 'final' && m.standings) {
      const s = m.standings;
      const pod = [s[1], s[0], s[2]].filter(Boolean).map((p) => `<div class="p${p.rank}">${p.rank === 1 ? '👑' : p.rank}<br>${esc(p.name)}<br>${p.points} pts</div>`).join('');
      const rows = s.map((p) => `<tr><td>${p.rank}</td><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}${p.connected ? '' : ' (déco.)'}</td><td class="num">${p.points}</td><td class="num">${p.kills}</td><td class="num">${p.wins}</td></tr>`).join('');
      html = `<div class="card"><h2>🏆 ${esc(s[0]?.name ?? '')} remporte le tournoi !</h2><div class="podium">${pod}</div><table class="res"><tr><th>#</th><th>Joueur</th><th>Points</th><th>Élim.</th><th>Victoires</th></tr>${rows}</table><p>Retour au lobby dans ${Math.ceil(m.timeLeft ?? 0)} s</p></div>`;
    } else if (you?.respawn > 0 && m.phase !== 'lobby') {
      html = `<div class="msg">Réapparition dans ${you.respawn.toFixed(1)} s</div>`;
    } else if (m.phase === 'combat' && sinceStart < 1.6) {
      html = '<div class="big">COMBAT !</div>';
    } else if ((m.phase === 'minigame' || m.phase === 'finale') && sinceStart < 1.2) {
      html = '<div class="big">GO !</div>';
    } else if (m.phase === 'lastShop') {
      html = `<div class="msg">Derniers achats — ${m.round >= m.rounds ? 'finale' : 'manche suivante'} dans ${Math.ceil(m.timeLeft ?? 0)} s</div>`;
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
        <p class="hint">Déplacez-vous et tirez librement pour vous échauffer. ${snap.roster.length}/8 joueurs — 4 à 8 recommandés.</p>
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

  renderInventory(you, m) {
    if (!you) return;
    const inv = you.inv;
    const weaponsOnlyPistol = m.phase === 'minigame' && m.mg?.id !== 'crown';
    const slots = inv.slots.map((s, i) => {
      if (!s) return `<div class="slot empty" data-slot="${i}"><span class="key">${i + 1}</span><span class="ico">＋</span></div>`;
      const def = this.items.get(s.id);
      const pct = s.reloading ? 100 : s.cooldownTotal ? Math.min(100, (s.cooldown / s.cooldownTotal) * 100) : 0;
      const disabled = weaponsOnlyPistol && s.id !== 'pistol';
      const ammo = s.reloading ? '⟳' : s.ammo !== null ? `${s.ammo}/${s.maxAmmo}` : '';
      return `<div class="slot ${i === inv.active ? 'active' : ''} ${disabled ? 'disabled' : ''}" data-slot="${i}" title="${esc(def?.name ?? '')}">
        <span class="key">${i + 1}</span>${s.level > 1 ? '<span class="lvl">Mk II</span>' : ''}
        <span class="ico">${def?.icon ?? '?'}</span><span class="ammo">${ammo}</span><i class="cd" style="height:${pct}%"></i></div>`;
    }).join('');
    const cons = inv.consumables.map((c, i) => {
      const def = c ? this.items.get(c) : null;
      return `<div class="slot small ${c ? '' : 'empty'}" data-cons="${i}" title="${esc(def?.name ?? 'vide')}"><span class="key">${i === 0 ? 'R' : 'F'}</span><span class="ico">${def?.icon ?? '·'}</span></div>`;
    }).join('');
    if ($('#slots').innerHTML !== slots) $('#slots').innerHTML = slots;
    if ($('#consumables').innerHTML !== cons) $('#consumables').innerHTML = cons;
    $('#dash .cd').style.height = `${Math.min(100, (you.dash / 2.4) * 100)}%`;
    $('#wallet').innerHTML = you.inMatch ? `💰 ${you.credits}<br>🏆 ${you.points}` : '💰 —<br>🏆 —';
    this.renderTouchButtons(you);
  }

  // Boutons tactiles : n'afficher que ce qui est utilisable, avec l'icône de l'objet et sa recharge.
  renderTouchButtons(you) {
    const inv = you.inv;
    const setBtn = (id, icon, cdPct) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.hidden = !icon;
      if (!icon) return;
      const html = `${icon}<i class="ring" style="--cd:${cdPct.toFixed(0)}%"></i>`;
      if (b.innerHTML !== html) b.innerHTML = html;
    };
    inv.consumables.forEach((c, i) => setBtn(`tc${i}`, c ? this.items.get(c)?.icon : null, 0));
    const gadget = inv.slots.find((s) => s && this.items.get(s.id)?.category === 'gadget');
    setBtn('tgadget', gadget ? this.items.get(gadget.id)?.icon : null, gadget?.cooldownTotal ? (gadget.cooldown / gadget.cooldownTotal) * 100 : 0);
    const weapons = inv.slots.filter((s) => s && this.items.get(s.id)?.category === 'weapon').length;
    setBtn('tweapon', weapons > 1 ? '🔁' : null, 0);
    setBtn('tdash', '🪀', (you.dash / 2.4) * 100);
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
    bindCheck('#setAutoFire', 'autoFire');
    bindCheck('#setAimAssist', 'aimAssist');
    bindCheck('#setHaptics', 'haptics');
    bindCheck('#setLefty', 'leftHanded');
    bindCheck('#setTilt', 'tiltShift');
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
    el.textContent = c.done
      ? `✅ Contrat rempli : +${c.reward} crédits`
      : `📜 Contrat de rattrapage : ${c.label} (${Math.floor(c.progress)}/${c.goal}) → +${c.reward} 💰`;
  }

  renderMiniHud(m) {
    const el = $('#minihud');
    if (m.hud?.kind === 'race') {
      const dots = m.hud.players.map((p) => {
        const r = this.roster.get(p.id);
        return r ? `<span class="dot" title="${esc(r.name)}" style="left:${(p.progress * 100).toFixed(1)}%;background:${r.color};${p.id === this.youId ? 'width:16px;height:16px;top:0' : ''}"></span>` : '';
      }).join('');
      el.innerHTML = `<div class="race-bar">${dots}<span class="flag">🏁</span></div>`;
    } else if (el.innerHTML) {
      el.innerHTML = '';
    }
    $('#contract').style.top = m.hud?.kind === 'race' ? '84px' : '56px';
  }

  renderFeed() {
    const now = performance.now();
    this.feed = this.feed.filter((f) => now - f.at < 6000);
    const html = this.feed.map((f) => `<div class="item">${f.html}</div>`).join('');
    if ($('#feed').innerHTML !== html) $('#feed').innerHTML = html;
  }

  renderShop(you, m) {
    if (!you) return;
    const mode = m.shop;
    const key = JSON.stringify([m.offers, you.credits, you.inv.slots.map((s) => s && [s.id, s.level]), you.inv.consumables, mode, you.channel?.item, you.inMatch]);
    const modeEl = $('#shopMode');
    modeEl.className = mode === 'combat' ? 'combat' : '';
    modeEl.textContent = mode === 'safe' ? 'Phase sûre : achat immédiat'
      : mode === 'combat' ? 'En combat : 1,5 s d\'achat, ralenti et sans tir !'
        : 'Fermée pour le moment';
    if (you.channel) {
      const bar = document.querySelector('#shopItems .channel i');
      if (bar) bar.style.width = `${you.channel.progress * 100}%`;
    }
    if (key === this.shopKey) return;
    this.shopKey = key;
    const inv = you.inv;
    const permanentFull = inv.slots.every((s) => s);
    const consFull = inv.consumables.every((c) => c);
    const html = m.offers.map((id) => {
      const d = this.items.get(id);
      if (!d) return '';
      const owned = d.category === 'upgrade'
        ? inv.slots.some((s) => s?.id === 'pistol' && s.level >= 2)
        : (d.category === 'weapon' || d.category === 'gadget') && inv.slots.some((s) => s?.id === id);
      const afford = you.credits >= d.price;
      let actions;
      if (!you.inMatch || mode === 'closed') actions = '<span class="note">Indisponible</span>';
      else if (you.channel?.item === id) actions = '<div class="channel" style="flex:1"><i style="width:0%"></i></div><button class="btn small ghost" data-cancel="1">Annuler</button>';
      else if (owned) actions = `<span class="note">${d.category === 'upgrade' ? 'Niveau max atteint' : 'Déjà équipé'}</span>`;
      else if (d.category === 'consumable' && consFull) actions = '<span class="note">Emplacements de consommables pleins</span>';
      else if ((d.category === 'weapon' || d.category === 'gadget') && permanentFull) {
        actions = [1, 2].map((i) => `<button class="btn small" data-item="${id}" data-slot="${i}" ${afford ? '' : 'disabled'}>Remplacer ${this.items.get(inv.slots[i].id)?.icon ?? ''} (empl. ${i + 1})</button>`).join('');
      } else {
        const where = d.category === 'consumable' ? 'consommable' : d.category === 'upgrade' ? 'améliore le pistolet' : `empl. ${inv.slots.findIndex((s, i) => i > 0 && !s) + 1}`;
        actions = `<button class="btn small ${afford ? 'primary' : ''}" data-item="${id}" ${afford ? '' : 'disabled'}>Acheter</button><span class="note">→ ${where}</span>`;
      }
      return `<div class="offer ${owned ? 'owned' : ''}">
        <span class="ico">${d.icon}</span>
        <span class="title">${esc(d.name)}<span class="tag">${CATEGORY_LABEL[d.category]} · ${esc(d.role)}</span></span>
        <span class="price">${d.price} 💰</span>
        <span class="desc">${esc(d.description)}</span>
        <span class="counter">Contre : ${esc(d.counters)}</span>
        <div class="buy">${actions}</div>
      </div>`;
    }).join('');
    $('#shopItems').innerHTML = html;
  }

  renderFullTable(snap, show) {
    const el = $('#fullTable');
    el.hidden = !show;
    if (!show) return;
    const rows = snap.roster.slice().sort((a, b) => b.pts - a.pts).map((r, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="background:${r.color}"></span> ${esc(r.name)}</td><td class="num">${r.pts}</td><td class="num">${r.cr}</td><td class="num">${r.k}</td><td class="num">${r.d}</td><td class="num">${r.w}</td></tr>`).join('');
    el.innerHTML = `<table class="res"><tr><th>#</th><th>Joueur</th><th>Points</th><th>Crédits</th><th>Élim.</th><th>Chutes/K.O.</th><th>Victoires</th></tr>${rows}</table>`;
  }
}
