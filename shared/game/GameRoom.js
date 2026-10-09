import { MAX_PLAYERS, PLAYER_COLORS, SNAPSHOT_EVERY_TICKS, DEFAULT_ROUNDS, ROUND_OPTIONS, TICK_RATE } from '../constants.js';
import { ITEMS, publicItem } from '../items.js';
import { createRng } from '../rng.js';
import { parseClientMessage, sanitizeName } from '../protocol.js';
import { MatchManager } from './MatchManager.js';
import { InventorySystem } from './InventorySystem.js';
import { ScoreSystem } from './ScoreSystem.js';
import { BotBrain, botName } from './Bot.js';

const randomToken = (rng) => Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng.next() * 36)]).join('');

function makePlayer({ id, name, color, joinOrder, bot = null }) {
  const p = {
    id, name, color, joinOrder, bot,
    connected: true, touch: false, inMatch: false,
    input: { mx: 0, my: 0, aim: 0, fire: false },
    actions: [],
    aim: 0, x: 0, y: 0, vx: 0, vy: 0,
    inv: InventorySystem.create(),
    channel: null, contract: null, championShield: false,
  };
  ScoreSystem.initPlayer(p);
  return p;
}

// Salle privée : joueurs, hôte, connexions et diffusion de l'état.
// Indépendante du transport : `client` est n'importe quel objet { send(obj) }.
export class GameRoom {
  constructor({ code, seed = Date.now(), onClose = () => {} } = {}) {
    this.code = code;
    this.rng = createRng(seed);
    this.onClose = onClose;
    this.players = new Map();
    this.clients = new Map(); // playerId -> client
    this.tokens = new Map(); // token -> playerId
    this.hostId = null;
    this.settings = { rounds: DEFAULT_ROUNDS };
    this.nextPlayer = 1;
    this.tickCount = 0;
    this.closed = false;
    this.match = new MatchManager(this);
  }

  // ------------------------------------------------------------ connexions
  join(client, { name, token, touch } = {}) {
    if (this.closed) return { ok: false, reason: 'Salle fermée' };
    const existingId = token ? this.tokens.get(token) : null;
    if (existingId && this.players.has(existingId)) {
      const p = this.players.get(existingId);
      const old = this.clients.get(p.id);
      if (old && old !== client) old.close?.();
      this.clients.set(p.id, client);
      p.connected = true;
      p.touch = !!touch;
      if (this.match.inMatch && p.inMatch) this.match.onReconnect(p);
      else if (!this.match.world.players.includes(p)) this.match.onJoinLobby(p);
      if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = p.id;
      this.welcome(p, client, token);
      return { ok: true, player: p };
    }
    if (this.match.inMatch) return { ok: false, reason: 'Partie en cours : attendez le retour au lobby' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, reason: 'Salle pleine (8 joueurs)' };

    const p = this.createPlayer(sanitizeName(name), null);
    p.touch = !!touch;
    const tk = randomToken(this.rng);
    this.tokens.set(tk, p.id);
    p.token = tk;
    this.clients.set(p.id, client);
    if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = p.id;
    this.welcome(p, client, tk);
    this.match.emit('join', { id: p.id, name: p.name });
    return { ok: true, player: p };
  }

  createPlayer(name, bot) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const id = `p${this.nextPlayer}`;
    const p = makePlayer({ id, name, color, joinOrder: this.nextPlayer++, bot });
    this.players.set(id, p);
    this.match.onJoinLobby(p);
    return p;
  }

  welcome(p, client, token) {
    client.send({
      t: 'welcome',
      id: p.id,
      code: this.code,
      token,
      items: Object.values(ITEMS).map(publicItem),
      tickRate: TICK_RATE,
    });
  }

  leave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.clients.delete(playerId);
    if (this.match.inMatch && p.inMatch) {
      // Conservé au classement, peut revenir avec son jeton.
      p.connected = false;
      p.input = { mx: 0, my: 0, aim: p.aim, fire: false };
      this.match.onDisconnect(p);
    } else {
      this.match.onDisconnect(p);
      this.players.delete(playerId);
      this.tokens.delete(p.token);
    }
    this.match.emit('leave', { id: p.id, name: p.name });
    if (this.hostId === playerId) this.migrateHost();
    if (![...this.players.values()].some((x) => !x.bot && x.connected)) this.close();
  }

  migrateHost() {
    const humans = [...this.players.values()].filter((x) => !x.bot && x.connected).sort((a, b) => a.joinOrder - b.joinOrder);
    this.hostId = humans[0]?.id ?? null;
    if (this.hostId) this.match.emit('host', { id: this.hostId });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this);
  }

  addBot() {
    if (this.match.inMatch || this.players.size >= MAX_PLAYERS) return false;
    const count = [...this.players.values()].filter((p) => p.bot).length;
    const p = this.createPlayer(`🤖 ${botName(count)}`, new BotBrain(this.rng));
    this.match.emit('join', { id: p.id, name: p.name });
    return true;
  }

  removeBot() {
    if (this.match.inMatch) return false;
    const bots = [...this.players.values()].filter((p) => p.bot);
    const last = bots[bots.length - 1];
    if (!last) return false;
    this.match.onDisconnect(last);
    this.players.delete(last.id);
    return true;
  }

  // ------------------------------------------------------------ messages
  handle(playerId, raw) {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    const msg = parseClientMessage(raw);
    if (!msg) return;
    const isHost = playerId === this.hostId;
    switch (msg.t) {
      case 'in':
        p.input.mx = msg.mx;
        p.input.my = msg.my;
        if (msg.a !== null) p.input.aim = msg.a;
        p.input.fire = msg.f;
        if (p.actions.length < 12) p.actions.push(...msg.act);
        if (msg.s !== null) p.inputSeq = msg.s;
        if (msg.fl) p.pendingFlick = msg.fl;
        break;
      case 'buy': {
        const res = this.match.buy(p, msg.item, msg.slot);
        this.match.recordShop(p, res, msg.item);
        break;
      }
      case 'cancelBuy':
        this.match.shop.cancel(p);
        break;
      case 'start':
        if (isHost && !this.match.start(this.settings.rounds)) this.send(p.id, { t: 'error', reason: 'Il faut au moins 2 joueurs (ajoutez des bots).' });
        break;
      case 'settings':
        if (isHost && !this.match.inMatch && ROUND_OPTIONS.includes(msg.rounds)) this.settings.rounds = msg.rounds;
        break;
      case 'addBot':
        if (isHost) this.addBot();
        break;
      case 'removeBot':
        if (isHost) this.removeBot();
        break;
      case 'toLobby':
        if (isHost && this.match.inMatch) this.match.enterLobby();
        break;
      case 'ping':
        this.send(p.id, { t: 'pong', c: msg.c });
        break;
      case 'touch':
        p.touch = msg.on;
        break;
      default:
        break;
    }
  }

  notifyShop(p, result, itemId) {
    if (p.bot) return;
    this.send(p.id, { t: 'shop', item: itemId, ok: !!result?.ok, pending: !!result?.pending, reason: result?.reason ?? null });
  }

  send(playerId, msg) {
    this.clients.get(playerId)?.send(msg);
  }

  // ------------------------------------------------------------ boucle
  tick(dt) {
    if (this.closed) return;
    // Dernière commande prise en compte par ce pas de simulation (pour la prédiction client).
    for (const p of this.players.values()) p.ackSeq = p.inputSeq ?? 0;
    this.match.tick(dt);
    this.tickCount += 1;
    if (this.tickCount % SNAPSHOT_EVERY_TICKS === 0) this.broadcast();
  }

  roster() {
    return [...this.players.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => ({
        id: p.id, name: p.name, color: p.color, bot: !!p.bot, conn: p.connected,
        host: p.id === this.hostId, inMatch: p.inMatch,
        pts: p.points, cr: p.credits, k: p.stats.kills, d: p.stats.deaths, w: p.stats.wins,
      }));
  }

  broadcast() {
    const w = this.match.world;
    const events = [...this.match.events, ...w.events];
    this.match.events = [];
    w.events = [];
    const base = {
      t: 'snap',
      code: this.code,
      host: this.hostId,
      settings: this.settings,
      roster: this.roster(),
      m: this.match.meta(),
      w: w.snapshot(),
      ev: events,
    };
    for (const [id, client] of this.clients) {
      const p = this.players.get(id);
      if (!p) continue;
      client.send({ ...base, you: this.privateView(p) });
    }
  }

  privateView(p) {
    const t = this.match.time;
    return {
      id: p.id,
      credits: p.credits,
      points: p.points,
      inv: InventorySystem.view(p.inv, t),
      channel: p.channel ? { item: p.channel.itemId, progress: Math.min(1, (t - p.channel.start) / (p.channel.until - p.channel.start)) } : null,
      contract: p.contract,
      dash: Math.max(0, (p.flickReadyAt ?? 0) - t),
      respawn: p.state === 'dead' ? Math.max(0, p.respawnAt - t) : 0,
      inMatch: p.inMatch,
      // État physique exact du joueur, pour que son client rejoue ses commandes non confirmées.
      body: {
        seq: p.ackSeq ?? 0,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx * 10) / 10,
        vy: Math.round(p.vy * 10) / 10,
        ms: p.maxSpeed ?? 0,
        free: p.state === 'alive' && !this.match.world.rules.frozen && t >= (p.flingUntil ?? 0) && t >= (p.toppleUntil ?? 0)
          && t >= (p.slipUntil ?? 0) && t >= (p.airborneUntil ?? 0),
      },
    };
  }
}
