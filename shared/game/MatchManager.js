import { PHASES, MIN_PLAYERS } from '../constants.js';
import { ARENA } from '../maps.js';
import { World, resetBody } from './World.js';
import { CombatSystem } from './CombatSystem.js';
import { InventorySystem } from './InventorySystem.js';
import { ScoreSystem } from './ScoreSystem.js';
import { ShopSystem } from './ShopSystem.js';
import { MinigameRegistry } from './minigames/MinigameRegistry.js';
import { RaceMinigame } from './minigames/RaceMinigame.js';
import { CoinRushMinigame } from './minigames/CoinRushMinigame.js';
import { CrownFinale } from './minigames/CrownFinale.js';
import { MicroRushMinigame } from './minigames/MicroRushMinigame.js';

export function defaultRegistry() {
  return new MinigameRegistry().register(RaceMinigame).register(CoinRushMinigame).register(MicroRushMinigame).register(CrownFinale);
}

const SAFE_RULES = { damage: false, weapons: 'none', items: false, respawn: true, respawnDelay: 1, respawnInvuln: 0.5 };
const COMBAT_RULES = { damage: true, weapons: 'all', items: true, respawn: true, respawnDelay: 3, respawnInvuln: 1 };
const PRACTICE_RULES = { damage: true, weapons: 'all', items: true, respawn: true, respawnDelay: 1.5, respawnInvuln: 1 };

// Phases de partie : lobby -> [intro -> mini-jeu -> récompenses/boutique -> combat -> derniers achats] x N
//                    -> intro finale -> finale -> classement -> lobby.
export class MatchManager {
  constructor(room) {
    this.room = room;
    this.rng = room.rng;
    this.registry = defaultRegistry();
    this.score = new ScoreSystem();
    this.shop = new ShopSystem(this.rng);
    this.events = [];
    this.time = 0;
    this.phase = 'lobby';
    this.phaseEnd = Infinity;
    this.round = 0;
    this.rounds = 0;
    this.plan = [];
    this.minigame = null;
    this.lastResults = null;
    this.standings = null;
    this.world = null;
    this.enterLobby();
  }

  get inMatch() {
    return this.phase !== 'lobby';
  }

  participants() {
    return [...this.room.players.values()].filter((p) => (this.inMatch ? p.inMatch : true));
  }

  active() {
    return this.participants().filter((p) => p.connected);
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  setWorld(world) {
    if (this.world) this.events.push(...this.world.events);
    this.epoch = (this.epoch ?? 0) + 1;
    world.epoch = this.epoch;
    this.world = world;
  }

  createWorld({ map, rules, hooks }) {
    const players = this.active();
    const spawns = this.rng.shuffle(map.spawns);
    players.forEach((p, i) => resetBody(p, spawns[i % spawns.length]));
    const world = new World({ map, players, rules, hooks, rng: this.rng, time: this.time });
    this.setWorld(world);
    return world;
  }

  setPhase(phase, duration) {
    this.phase = phase;
    this.phaseEnd = this.time + duration;
    this.emit('phase', { phase });
  }

  // ------------------------------------------------------------ lobby
  enterLobby() {
    for (const p of this.room.players.values()) {
      p.inMatch = false;
      p.inv = InventorySystem.create();
      p.championShield = false;
      p.contract = null;
      p.channel = null;
    }
    this.minigame = null;
    this.round = 0;
    this.createWorld({ map: ARENA, rules: PRACTICE_RULES, hooks: {} });
    this.phase = 'lobby';
    this.phaseEnd = Infinity;
    this.emit('phase', { phase: 'lobby' });
  }

  canStart() {
    return this.phase === 'lobby' && this.active().length >= MIN_PLAYERS;
  }

  start(rounds) {
    if (!this.canStart()) return false;
    for (const p of this.active()) {
      p.inMatch = true;
      ScoreSystem.initPlayer(p);
      p.inv = InventorySystem.create();
    }
    this.rounds = rounds;
    this.round = 1;
    this.plan = this.registry.plan(rounds, this.rng);
    // La Rafale ouvre la partie : des gestes simples, idéal pour découvrir le jeu.
    const mi = this.plan.indexOf('micro');
    if (mi > 0) [this.plan[0], this.plan[mi]] = [this.plan[mi], this.plan[0]];
    else if (mi < 0 && this.registry.get('micro')) this.plan[0] = 'micro';
    this.lastResults = null;
    this.standings = null;
    this.enterIntro();
    return true;
  }

  // ------------------------------------------------------------ mini-jeux
  enterIntro() {
    const finale = this.round > this.rounds;
    const id = finale ? this.registry.list({ finale: true })[0].id : this.plan[this.round - 1];
    this.disposeMinigame();
    const mg = this.registry.create(id);
    mg.initialize({
      players: this.participants(),
      rng: this.rng,
      time: this.time,
      createWorld: (opts) => this.createWorld(opts),
    });
    for (const p of this.participants()) InventorySystem.refresh(p.inv);
    this.minigame = mg;
    this.world.rules.frozen = true;
    this.setPhase(finale ? 'finaleIntro' : 'intro', PHASES.intro);
  }

  enterMinigame() {
    this.world.rules.frozen = false;
    this.minigame.start();
    const finale = this.phase === 'finaleIntro';
    this.setPhase(finale ? 'finale' : 'minigame', this.minigame.constructor.durationSeconds);
  }

  endMinigame() {
    const mg = this.minigame;
    const finale = this.phase === 'finale';
    const result = mg.finish();
    const byId = new Map(this.participants().map((p) => [p.id, p]));
    const awards = this.score.awardMinigame(result.ranking, byId, this.events, { finale });
    this.lastResults = { name: mg.constructor.name, summary: result.summary, awards, finale };
    this.disposeMinigame();
    if (finale) this.enterFinal();
    else this.enterRewards();
  }

  disposeMinigame() {
    if (this.minigame) this.minigame.dispose();
    this.minigame = null;
  }

  // ------------------------------------------------------------ combat
  combatHooks() {
    return {
      onEliminated: (victim, killerId) => {
        if (this.phase !== 'combat') return;
        victim.diedThisCombat = true;
        const killer = killerId ? this.room.players.get(killerId) : null;
        if (killer && killer.inMatch) {
          this.score.onKill(killer, victim, this.events);
          ScoreSystem.progressContract(killer, 'eliminate', 1, this.events, this.score);
        }
      },
      onDamage: (attacker, victim, dmg) => {
        if (this.phase !== 'combat') return;
        attacker.stats.damage += dmg;
        ScoreSystem.progressContract(attacker, 'damage', dmg, this.events, this.score);
        if (victim.id === this.score.championId) ScoreSystem.progressContract(attacker, 'bounty', 1, this.events, this.score);
      },
    };
  }

  enterRewards() {
    this.shop.rotate(this.round);
    this.createWorld({ map: ARENA, rules: SAFE_RULES, hooks: this.combatHooks() });
    for (const p of this.participants()) {
      p.contract = null;
      p.championShield = p.id === this.score.championId;
    }
    if (this.score.championId) this.emit('champion', { id: this.score.championId });
    this.setPhase('rewards', PHASES.rewards);
  }

  enterCombat() {
    const w = this.world;
    Object.assign(w.rules, COMBAT_RULES);
    w.projectiles = [];
    w.traps = [];
    const spawns = this.rng.shuffle(w.map.spawns);
    this.score.beginCombat();
    const contracts = this.score.assignContracts(this.participants(), this.rng);
    this.participants().forEach((p, i) => {
      p.diedThisCombat = false;
      p.contract = contracts.get(p.id) ?? null;
      p.championShield = p.id === this.score.championId;
      InventorySystem.refresh(p.inv);
      if (p.connected) resetBody(p, spawns[i % spawns.length]);
    });
    this.setPhase('combat', PHASES.combat);
  }

  endCombat() {
    // Fin du chronomètre pendant un achat : la transaction est validée (crédits revérifiés).
    this.shop.update(this.participants(), this.time, true);
    for (const p of this.participants()) {
      if (p.contract?.kind === 'survive' && !p.diedThisCombat && p.connected) {
        ScoreSystem.progressContract(p, 'survive', 1, this.events, this.score);
      }
      p.championShield = false;
    }
    this.score.endCombat(this.participants().filter((p) => p.connected), this.events);
    Object.assign(this.world.rules, SAFE_RULES);
    for (const p of this.participants()) {
      p.contract = null;
      if (p.state === 'dead' || p.state === 'falling') CombatSystem.respawn(this.world, p);
    }
    this.setPhase('lastShop', PHASES.lastShop);
  }

  // ------------------------------------------------------------ fin de partie
  enterFinal() {
    this.standings = ScoreSystem.ranking(this.participants()).map((p, i) => ({
      rank: i + 1, id: p.id, name: p.name, color: p.color, points: p.points, credits: p.credits,
      kills: p.stats.kills, wins: p.stats.wins, connected: p.connected,
    }));
    this.createWorld({ map: ARENA, rules: SAFE_RULES, hooks: {} });
    this.setPhase('final', PHASES.finalResults);
  }

  // ------------------------------------------------------------ boucle
  shopMode() {
    if (this.phase === 'rewards' || this.phase === 'lastShop') return 'safe';
    if (this.phase === 'combat') return 'combat';
    return 'closed';
  }

  // Geste de mini-jeu (tape, choix, rotation…), validé par le mini-jeu lui-même.
  minigameInput(p, msg) {
    if ((this.phase === 'minigame' || this.phase === 'finale') && p.inMatch) this.minigame?.input?.(p, msg);
  }

  buy(p, itemId, slot) {
    if (!p.inMatch) return { ok: false, reason: 'Boutique disponible pendant la partie' };
    return this.shop.request(p, itemId, slot, this.shopMode(), this.time);
  }

  tick(dt) {
    const w = this.world;
    const mode = this.botMode();
    const extra = {
      championId: this.score.championId,
      crown: this.minigame?.constructor.id === 'crown'
        ? { holder: this.minigame.holder, pos: this.minigame.holder ? null : this.minigame.crown }
        : null,
      micro: this.minigame?.botHint?.() ?? null,
    };
    for (const p of w.players) {
      if (!p.bot) continue;
      p.bot.think(p, w, mode, extra);
      if (this.shopMode() === 'safe' && this.rng.next() < 0.03) {
        const item = p.bot.shop(p, this.shop, this.rng);
        if (item) this.recordShop(p, this.buy(p, item, this.rng.next() < 0.5 ? 1 : 2), item);
      }
    }

    w.step(dt);
    this.time = w.time;

    if (this.phase === 'combat') {
      for (const { player, result } of this.shop.update(this.participants(), this.time)) {
        this.recordShop(player, result, result.itemId);
      }
    }
    if (this.phase === 'minigame' || this.phase === 'finale') {
      this.minigame.update(dt);
      const cap = this.minigame.timeLeftCap?.();
      if (cap !== null && cap !== undefined) this.phaseEnd = Math.min(this.phaseEnd, cap);
    }

    if (this.time >= this.phaseEnd || ((this.phase === 'minigame' || this.phase === 'finale') && this.minigame.isOver())) {
      this.advance();
    }
  }

  recordShop(p, result, itemId) {
    if (result?.ok && !result.pending) this.emit('bought', { id: p.id, item: itemId });
    this.room.notifyShop?.(p, result, itemId);
  }

  advance() {
    switch (this.phase) {
      case 'intro':
      case 'finaleIntro':
        return this.enterMinigame();
      case 'minigame':
      case 'finale':
        return this.endMinigame();
      case 'rewards':
        return this.enterCombat();
      case 'combat':
        return this.endCombat();
      case 'lastShop':
        this.round += 1;
        return this.enterIntro();
      case 'final':
        return this.enterLobby();
      default:
        return undefined;
    }
  }

  botMode() {
    if (this.phase === 'lobby') return 'lobby';
    if (this.phase === 'combat') return 'combat';
    if (this.phase === 'minigame' || this.phase === 'finale') return this.minigame.botMode?.() ?? this.minigame.constructor.id;
    return 'safe';
  }

  // ------------------------------------------------------------ connexions
  onDisconnect(p) {
    p.channel = null;
    const i = this.world.players.indexOf(p);
    if (i >= 0) this.world.players.splice(i, 1);
  }

  onReconnect(p) {
    if (this.world.players.includes(p)) return;
    this.world.players.push(p);
    p.state = 'dead';
    p.actions = [];
    CombatSystem.respawn(this.world, p);
  }

  onJoinLobby(p) {
    const spawn = CombatSystem.safestSpawn(this.world, p);
    resetBody(p, spawn);
    this.world.players.push(p);
  }

  meta() {
    const mg = this.minigame;
    return {
      phase: this.phase,
      timeLeft: Number.isFinite(this.phaseEnd) ? Math.max(0, Math.round((this.phaseEnd - this.time) * 10) / 10) : null,
      round: this.round,
      rounds: this.rounds,
      mg: mg ? { id: mg.constructor.id, name: mg.constructor.name, description: mg.constructor.description } : null,
      hud: mg && (this.phase === 'minigame' || this.phase === 'finale' || this.phase === 'intro' || this.phase === 'finaleIntro') ? mg.hud() : null,
      champion: this.score.championId,
      results: this.phase === 'rewards' || this.phase === 'final' ? this.lastResults : null,
      standings: this.phase === 'final' ? this.standings : null,
      shop: this.shopMode(),
      offers: this.shop.offers,
      map: this.world.map.id,
    };
  }
}
