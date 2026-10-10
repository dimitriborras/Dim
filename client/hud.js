// Interface DOM : phases, chronomètre, classement, inventaire, boutique, lobby.
import { ROUND_OPTIONS } from '../shared/constants.js';
import { settings, setSetting } from './settings.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PHASE_LABEL = {
  lobby: '🎱 Billard libre',
  pick: '🗳️ Choix du mini-jeu',
  intro: 'Préparez-vous…',
  minigame: '',
  rewards: '🎰 Distributeur',
  combat: '🎱 MÊLÉE',
  lastShop: 'Fin de la Mêlée',
  finaleIntro: '🏆 FINALE',
  finale: '🏆 FINALE',
  final: 'Classement final',
};

const GAME_ICON = {
  micro: '⚡', race: '🏁', coins: '🪙', palet: '🎯', glutton: '🕳️', bomb: '💣', tiles: '🟦', blackjack: '🃏',
  memory: '🧠', king: '👑', mine: '⛏️', movers: '🚚', impostor: '🔪', crown: '👑',
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
    $('#pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      this.send({ t: 'pick', i: Number(b.dataset.pick) });
      this.pickMine = Number(b.dataset.pick);
      this.pickKey = '';
    });
    $('#vote').addEventListener('click', (e) => {
      const b = e.target.closest('[data-vote]');
      if (!b || b.disabled) return;
      this.send({ t: 'mg', k: 'choice', v: Number(b.dataset.vote) });
      b.classList.add('picked');
    });
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
      case 'bombArm': if (ev.id === youId) this.announce('💣 Tu as la bombe !<small>Touche quelqu\'un pour la refiler</small>', 'bad'); break;
      case 'bombPass':
        if (ev.id === youId) this.announce(`💣 ${plain(ev.from)} t'a refilé la bombe !`, 'bad');
        else if (ev.from === youId) this.announce('😅 Bombe refilée !', 'good');
        break;
      case 'card':
        if (ev.id === youId) this.announce(`🃏 ${ev.value ? `+${ev.value === 11 ? 'As (11)' : ev.value}` : 'Hors carte'}<small>Total : ${ev.total}</small>`, ev.total > 21 ? 'bad' : 'good');
        break;
      case 'bust': if (ev.id === youId) this.announce(`💥 SAUTÉ ! (${ev.total})`, 'bad'); else this.pushFeed(`💥 ${this.name(ev.id)} saute à ${ev.total}`); break;
      case 'blackjack': if (ev.id === youId) this.announce('🃏 VINGT-ET-UN !', 'good'); else this.pushFeed(`🃏 ${this.name(ev.id)} fait 21 !`); break;
      case 'stand': this.pushFeed(`✋ ${this.name(ev.id)} reste à ${ev.total}`); break;
      case 'delivered': if (ev.id === youId) this.announce(`🚚 +${ev.value} € ${ev.kind}`, 'good'); else this.pushFeed(`🚚 ${ev.kind} livré (${ev.value} €)${ev.id ? ` par ${this.name(ev.id)}` : ''}`); break;
      case 'broken': this.pushFeed(`💥 ${ev.kind} cassé !`); break;
      case 'meeting':
        this.announce(`📢 RÉUNION !<small>${plain(ev.by)} a trouvé le corps de ${plain(ev.body)}</small>`, 'bad');
        break;
      case 'ejected':
        if (!ev.id) this.announce('🗳️ Personne n\'est éjecté…');
        else this.announce(`🚀 ${plain(ev.id)} est éjecté<small>${ev.impostor ? 'C\'était l\'imposteur !' : 'Ce n\'était pas l\'imposteur…'}</small>`, ev.impostor ? 'good' : 'bad');
        break;
      case 'impostorEnd': {
        const names = ev.impostors.map((id) => plain(id)).join(' et ');
        this.announce(`${ev.winner === 'crew' ? '👨‍🚀 L\'équipage gagne !' : '🔪 L\'imposteur gagne !'}<small>Imposteur : ${names}</small>`, 'good');
        this.pushFeed(`🔪 L'imposteur était ${ev.impostors.map((id) => this.name(id)).join(' et ')}`);
        break;
      }
      case 'memPair': if (ev.id === youId) this.announce(`🃏 Paire ! ${ev.face}${ev.face}`, 'good'); else this.pushFeed(`🃏 ${this.name(ev.id)} trouve ${ev.face}${ev.face}`); break;
      case 'memMiss': if (ev.id === youId) this.announce('❌ Pas la même…', 'bad'); break;
      case 'hillMove': this.announce('👑 La colline se déplace !'); break;
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
    this.hudKind = m.hud?.kind ?? null;
    this.renderVote(snap, m, you);
    this.renderPick(m);
    this.renderInventory(you);
    this.renderContract(you);
    this.youMicro = you?.micro ?? null;
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
      if (m.hud?.kind === 'glutton' || m.hud?.kind === 'tiles') return m.hud.out.includes(r.id) ? '💀' : '🟢';
      if (m.hud?.kind === 'memory') return `🃏 ${m.hud.pairs[r.id] ?? 0}`;
      if (m.hud?.kind === 'movers') return `${m.hud.delivered[r.id] ?? 0} €`;
      if (m.hud?.kind === 'impostor') return m.hud.alive.includes(r.id) ? (m.hud.impostors?.includes(r.id) ? '🔪' : '🟢') : '💀';
      if (m.hud?.kind === 'king') return `👑 ${(m.hud.held[r.id] ?? 0).toFixed(0)}s`;
      if (m.hud?.kind === 'mine') return m.hud.finished.includes(r.id) ? `🚪 ${m.hud.finished.indexOf(r.id) + 1}` : '⛏️';
      if (m.hud?.kind === 'bomb') return m.hud.out.includes(r.id) ? '💀' : m.hud.holder === r.id ? '💣' : '🟢';
      if (m.hud?.kind === 'blackjack') { const st = m.hud.players[r.id]; return st ? (st.b ? `💥${st.t}` : `${st.t}${st.s ? '✋' : ''}`) : ''; }
      return inMatch ? `${r.pts} pts` : `🎱 ${r.ls ?? 0}${r.host ? ' ⭐' : ''}`;
    };
    const unit = { movers: 'livré', impostor: 'état', coins: 'jetons', crown: 'couronne', palet: 'cible', glutton: 'en vie', tiles: 'en vie', bomb: 'en vie', blackjack: 'total', memory: 'paires', king: 'colline', mine: 'sortie', micro: 'réussis' }[m.hud?.kind] ?? 'points';
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
      html = `<div class="card"><h2>${esc(m.results.name)}</h2><table class="res"><tr><th>#</th><th>Joueur</th><th>Crédits</th><th>Points</th></tr>${rows}</table>${champ}<p>🎰 Distributeur ouvert. ${m.round === 1 || m.round === m.rounds ? 'Mêlée sur le billard' : m.round >= m.rounds ? 'Finale' : 'Vote de la prochaine manche'} dans ${Math.ceil(m.timeLeft ?? 0)} s.</p></div>`;
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
    const imp = this.hudKind === 'impostor' ? you.micro : null;
    let g = this.hudKind === 'blackjack' ? { id: '_stand', charges: 1, cooldown: 0 } : inv.gadget;
    let icon = g?.id === '_stand' ? '✋' : g ? this.items.get(g.id)?.icon : null;
    if (imp) {
      // L'imposteur : 🔪 quand une victime est à portée, 📢 près d'un corps, sinon le rôle en grisé.
      g = imp.canKill || imp.canReport ? { id: '_stand', charges: 1, cooldown: 0 } : null;
      icon = imp.canKill ? '🔪' : imp.canReport ? '📢' : imp.role === 'impostor' ? '🔪' : '📢';
    }
    const btn = $('#itemBtn');
    btn.classList.toggle('empty', !g || g.charges <= 0);
    const cd = g && g.cooldown > 0 ? 100 : 0;
    const html = `<span class="ico">${icon ?? '·'}</span>${g && g.id !== '_stand' ? `<b class="count">${g.charges}</b>` : ''}<i class="ring" style="--cd:${cd}%"></i>`;
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
    } else if (m.hud?.kind === 'mine') {
      const out = m.hud.finished.length;
      const html = `<div class="mini-pill">⛏️ Glisse le doigt pour avancer et creuser${out ? ` · 🚪 ${out} sorti${out > 1 ? 's' : ''}` : ''}</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'movers') {
      const h = m.hud;
      const html = `<div class="mini-pill">🚚 Livré <b>${h.team} €</b> / objectif ${h.quota} €${h.broken ? ` · 💥 ${h.broken} cassé${h.broken > 1 ? 's' : ''}` : ''}</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'impostor') {
      const me = this.youMicro;
      const role = me?.role === 'impostor' ? `🔪 Imposteur${me.killIn > 0 ? ` · prêt dans ${Math.ceil(me.killIn)} s` : ' · prêt !'}` : '👨‍🚀 Équipage';
      const html = `<div class="mini-pill ${me?.role === 'impostor' ? 'hot' : ''}">${role} · 🔧 tâches ${m.hud.tasks} %</div>`;
      // Le rôle secret, annoncé une fois au début de la manche.
      if (me?.role && this.roleShownFor !== m.round) {
        this.roleShownFor = m.round;
        const mates = me.mates?.length ? `<small>Complice : ${me.mates.map((id) => esc(this.roster.get(id)?.name ?? '?')).join(', ')}</small>` : '';
        this.announce(me.role === 'impostor'
          ? `🔪 Tu es l'IMPOSTEUR<small>Élimine en douce (bouton rond), ne te fais pas voir</small>${mates}`
          : '👨‍🚀 Tu fais partie de l\'ÉQUIPAGE<small>Fais tes tâches (cercles jaunes) et démasque l\'imposteur</small>', me.role === 'impostor' ? 'bad' : 'good');
      }
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'memory') {
      const html = '<div class="mini-pill">🃏 Arrête-toi sur une carte pour la retourner · trouve sa jumelle</div>';
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'king') {
      const mine = m.hud.king === this.youId;
      const html = `<div class="mini-pill ${mine ? 'big' : ''}">${mine ? '👑 Tu tiens la colline !' : m.hud.contested ? '⚔️ Colline disputée : personne ne marque' : '👑 Reste SEUL dans la zone'} · bouge dans ${Math.ceil(m.hud.moveIn ?? 0)} s</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'bomb') {
      const mine = m.hud.holder === this.youId;
      const html = `<div class="mini-pill ${mine ? 'hot' : ''}">${mine ? '💣 TU AS LA BOMBE : refile-la !' : `💣 ${m.hud.alive.length} en vie`}</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'tiles') {
      const html = `<div class="mini-pill">🟦 ${m.hud.alive.length} en vie · ne reste pas sur une dalle rouge !</div>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (m.hud?.kind === 'blackjack') {
      const st = m.hud.players[this.youId];
      const html = st ? `<div class="mini-pill big">🃏 Ton total : <b>${st.t}</b>${st.b ? ' — 💥 sauté !' : st.s ? ' — ✋ tu restes' : ' · bouton rond : « je reste »'}</div>` : '';
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (el.innerHTML) {
      el.innerHTML = '';
    }
    document.body.classList.toggle('race-on', ['race', 'palet', 'glutton', 'bomb', 'tiles', 'blackjack', 'mine', 'memory', 'king'].includes(m.hud?.kind));
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

  // Vote du prochain mini-jeu : trois cartes, la majorité l'emporte.
  renderPick(m) {
    const el = $('#pick');
    const show = m.phase === 'pick' && !!m.pick;
    el.hidden = !show;
    document.body.classList.toggle('pick-on', show);
    if (!show) { this.pickMine = null; this.pickKey = ''; return; }
    const votes = m.pick.votes;
    const optKey = m.pick.options.map((o) => o.id).join('|') + m.round;
    if (optKey !== this.pickOptKey) { this.pickOptKey = optKey; this.pickMine = null; }
    const mine = votes[this.youId] ?? this.pickMine ?? null;
    const key = JSON.stringify([m.pick.options.map((o) => o.id), votes, mine, Math.ceil(m.timeLeft ?? 0)]);
    if (key === this.pickKey) return;
    this.pickKey = key;
    const cards = m.pick.options.map((o, i) => {
      const voters = Object.entries(votes).filter(([, v]) => v === i).map(([id]) => this.roster.get(id));
      const dots = voters.map((r) => `<span class="dot" style="background:${r?.color ?? '#999'}" title="${esc(r?.name ?? '')}"></span>`).join('');
      return `<button class="pick-card ${o.id === 'micro' ? 'rafale' : ''} ${mine === i ? 'picked' : ''}" data-pick="${i}">
        <span class="ico">${GAME_ICON[o.id] ?? '🎲'}</span>
        <span class="title">${esc(o.name)}</span>
        <span class="desc">${esc(o.description)}</span>
        <span class="votes">${dots || '<i>aucun vote</i>'}</span>
      </button>`;
    }).join('');
    const melee = m.round === 1 || m.round === m.rounds;
    el.innerHTML = `<h2>🗳️ Manche ${m.round}/${m.rounds} : à vous de choisir !</h2>
      <div class="pick-cards">${cards}</div>
      <p class="note">⏱ ${Math.ceil(m.timeLeft ?? 0)} s · majorité, égalité tirée au sort${melee ? ' · 🎱 Mêlée après cette manche' : ''}</p>`;
  }

  // Réunion de l'imposteur : on vote pour éjecter quelqu'un (ou on passe).
  renderVote(snap, m, you) {
    const el = $('#vote');
    const h = m.hud;
    const show = h?.kind === 'impostor' && h.phase === 'meeting' && m.phase === 'minigame';
    el.hidden = !show;
    document.body.classList.toggle('vote-on', show);
    if (!show) { this.voteKey = ''; return; }
    const me = you?.micro;
    const canVote = h.alive.includes(this.youId) && !me?.vote;
    const key = JSON.stringify([h.alive, h.voted, canVote, Math.ceil(h.meetingLeft), me?.vote]);
    if (key === this.voteKey) return;
    this.voteKey = key;
    const rows = h.alive.map((id, i) => {
      const r = this.roster.get(id);
      const self = id === this.youId;
      const mate = me?.mates?.includes(id);
      return `<button class="vote-row ${me?.vote === id ? 'picked' : ''}" data-vote="${i}" ${canVote && !self ? '' : 'disabled'}>
        <span class="dot" style="background:${r?.color ?? '#999'}"></span><span class="nm">${esc(r?.name ?? '?')}${self ? ' (toi)' : ''}${mate ? ' 🔪' : ''}</span>
        ${h.voted.includes(id) ? '<span class="tag">a voté</span>' : ''}</button>`;
    }).join('');
    el.innerHTML = `<h2>📢 Réunion d'urgence</h2>
      <p>${esc(this.roster.get(h.reporter)?.name ?? '?')} a trouvé le corps de ${esc(this.roster.get(h.found)?.name ?? '?')}. Qui est l'imposteur ?</p>
      <div class="vote-list">${rows}</div>
      <div class="vote-foot"><button class="btn small ${me?.vote === 'skip' ? 'primary' : ''}" data-vote="-1" ${canVote ? '' : 'disabled'}>⏭ Passer</button><span>⏱ ${Math.ceil(h.meetingLeft)} s</span></div>
      ${h.alive.includes(this.youId) ? '' : '<p class="note">💀 Tu es éliminé : tu ne votes plus.</p>'}`;
  }

  renderFullTable(snap, show) {
    const el = $('#fullTable');
    el.hidden = !show;
    if (!show) return;
    const rows = snap.roster.slice().sort((a, b) => b.pts - a.pts).map((r, i) => `<tr><td>${i + 1}</td><td><span class="dot" style="background:${r.color}"></span> ${esc(r.name)}</td><td class="num">${r.pts}</td><td class="num">${r.cr}</td><td class="num">${r.k}</td><td class="num">${r.d}</td><td class="num">${r.w}</td></tr>`).join('');
    el.innerHTML = `<table class="res"><tr><th>#</th><th>Joueur</th><th>Points</th><th>Crédits</th><th>Élim.</th><th>Chutes/K.O.</th><th>Victoires</th></tr>${rows}</table>`;
  }
}
