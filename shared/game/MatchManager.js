import { PHASES, MIN_PLAYERS, REWARDS } from '../constants.js';
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
import { PaletMinigame } from './minigames/PaletMinigame.js';
import { GluttonMinigame } from './minigames/GluttonMinigame.js';
import { BombMinigame } from './minigames/BombMinigame.js';
import { TilesMinigame } from './minigames/TilesMinigame.js';
import { BlackjackMinigame } from './minigames/BlackjackMinigame.js';
import { MemoryMinigame } from './minigames/MemoryMinigame.js';
import { KingMinigame } from './minigames/KingMinigame.js';
import { MineMinigame } from './minigames/MineMinigame.js';
import { MoversMinigame } from './minigames/MoversMinigame.js';
import { ImpostorMinigame } from './minigames/ImpostorMinigame.js';

export function defaultRegistry() {
  return new MinigameRegistry()
    .register(RaceMinigame).register(CoinRushMinigame).register(PaletMinigame).register(GluttonMinigame)
    .register(BombMinigame).register(TilesMinigame).register(BlackjackMinigame)
    .register(MemoryMinigame).register(KingMinigame).register(MineMinigame).register(MoversMinigame)
    .register(ImpostorMinigame)
    .register(MicroRushMinigame).register(CrownFinale);
}

const SAFE_RULES = { items: false, respawn: true, respawnDelay: 1, respawnInvuln: 0.5 };
// La Mêlée : billard sans tir, gadgets autorisés. On marque en empochant les autres.
const COMBAT_RULES = { items: true, respawn: true, respawnDelay: 2, respawnInvuln: 1 };
// Lobby : billard libre, on marque en empochant les autres.
const PRACTICE_RULES = { items: false, respawn: true, respawnDelay: 1.2, respawnInvuln: 0.8 };

// Phases de partie : lobby -> [intro -> mini-jeu -> résultats + Distributeur -> Mêlée -> bilan] x N
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
      p.offers = [];
    }
    this.minigame = null;
    this.round = 0;
    // Billard libre : +3 par adversaire empoché, +1 par gros choc (« Carton ! »).
    const lobbyPoints = (p, n, reason, victim) => {
      p.lobbyScore = (p.lobbyScore ?? 0) + n;
      this.emit('lobbyPoint', { id: p.id, victim: victim.id, score: p.lobbyScore, n, reason });
    };
    this.createWorld({ map: ARENA, rules: PRACTICE_RULES, hooks: {
      onEliminated: (victim, killerId) => {
        const killer = killerId ? this.room.players.get(killerId) : null;
        if (killer) lobbyPoints(killer, 3, 'pocket', victim);
      },
      onSlam: (attacker, victim) => {
        if (this.world.time < (attacker.slamReadyAt ?? 0)) return;
        attacker.slamReadyAt = this.world.time + 1.2;
        lobbyPoints(attacker, 1, 'slam', victim);
      },
    } });
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
    this.plan = [];
    this.bigBag = [];
    this.microMemory = new Set();
    this.lastResults = null;
    this.standings = null;
    this.createWorld({ map: ARENA, rules: SAFE_RULES, hooks: {} });
    this.enterPick();
    return true;
  }

  // ------------------------------------------------------------ vote du prochain mini-jeu
  // Avant chaque manche : deux « gros » mini-jeux (tirés sans répétition dans le match) et La Rafale.
  // Chacun vote ; la majorité l'emporte (égalité : tirage au sort). Fin anticipée si tous les
  // humains ont voté.
  enterPick() {
    const big = this.registry.list().map((m) => m.id).filter((id) => id !== 'micro');
    const options = [];
    while (options.length < 2 && big.length) {
      if (!this.bigBag.length) this.bigBag = this.rng.shuffle(big);
      const id = this.bigBag.shift();
      if (!options.includes(id) && id !== this.plan[this.round - 2]) options.push(id);
    }
    if (this.registry.get('micro')) options.push('micro');
    // Les bots votent après un petit temps de réflexion.
    const botAt = new Map(this.participants().filter((p) => p.bot).map((p) => [p.id, this.time + this.rng.range(1.5, 6)]));
    this.pick = { options, votes: new Map(), botAt };
    this.setPhase('pick', PHASES.pick);
  }

  votePick(p, i) {
    if (this.phase !== 'pick' || !p.inMatch || !Number.isInteger(i) || i < 0 || i >= this.pick.options.length) return;
    this.pick.votes.set(p.id, i);
    this.emit('pickVote', { id: p.id, i });
  }

  endPick() {
    const { options, votes } = this.pick;
    const count = options.map((_, i) => [...votes.values()].filter((v) => v === i).length);
    const max = Math.max(...count);
    const top = options.map((_, i) => i).filter((i) => count[i] === max);
    const chosen = options[this.rng.pick(top)];
    // Les gros mini-jeux non choisis retournent dans le sac pour une prochaine fois.
    for (const id of options) if (id !== chosen && id !== 'micro') this.bigBag.push(id);
    this.plan[this.round - 1] = chosen;
    this.emit('picked', { id: chosen, votes: count });
    this.enterIntro();
  }

  // Après le Distributeur : Mêlée seulement après la première et la dernière manche.
  afterRewards() {
    if (this.round === 1 || this.round === this.rounds) return this.enterCombat();
    return this.nextRound();
  }

  nextRound() {
    this.round += 1;
    if (this.round > this.rounds) return this.enterIntro(); // finale
    return this.enterPick();
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
      memory: this.microMemory, // micro-jeux déjà joués dans ce match
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
      // Empocher un adversaire : points dégressifs sur la même victime, prime du champion.
      onEliminated: (victim, killerId) => {
        if (this.phase !== 'combat') return;
        victim.diedThisCombat = true;
        const killer = killerId ? this.room.players.get(killerId) : null;
        if (killer && killer.inMatch) {
          const champ = victim.id === this.score.championId;
          this.score.onKill(killer, victim, this.events);
          ScoreSystem.progressContract(killer, 'pocket', 1, this.events, this.score);
          if (champ) ScoreSystem.progressContract(killer, 'bounty', 1, this.events, this.score);
        }
      },
      // Gros choc : +1 point, au plus toutes les 2 s et 5 fois par Mêlée.
      onSlam: (attacker) => {
        if (this.phase !== 'combat' || !attacker.inMatch) return;
        if (this.world.time < (attacker.slamReadyAt ?? 0) || (attacker.slamsThisCombat ?? 0) >= 5) return;
        attacker.slamReadyAt = this.world.time + 2;
        attacker.slamsThisCombat = (attacker.slamsThisCombat ?? 0) + 1;
        this.score.addPoints(attacker, 1, 'Carton', this.events);
        ScoreSystem.progressContract(attacker, 'slam', 1, this.events, this.score);
      },
      // Boule numérotée empochée : +1 point (3 au plus par Mêlée).
      onBallPocket: (byId) => {
        const p = this.room.players.get(byId);
        if (this.phase !== 'combat' || !p?.inMatch || (p.ballsThisCombat ?? 0) >= REWARDS.maxBallPoints) return;
        p.ballsThisCombat = (p.ballsThisCombat ?? 0) + 1;
        this.score.addPoints(p, REWARDS.ballPoints, 'Boule empochée', this.events);
        ScoreSystem.progressContract(p, 'ball', 1, this.events, this.score);
      },
    };
  }

  enterRewards() {
    this.shop.open(ScoreSystem.ranking(this.participants()));
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
    w.traps = [];
    this.shop.close(this.participants());
    const spawns = this.rng.shuffle(w.map.spawns);
    this.score.beginCombat();
    const contracts = this.score.assignContracts(this.participants(), this.rng);
    this.participants().forEach((p, i) => {
      p.diedThisCombat = false;
      p.slamsThisCombat = 0;
      p.ballsThisCombat = 0;
      p.contract = contracts.get(p.id) ?? null;
      p.championShield = p.id === this.score.championId;
      InventorySystem.refresh(p.inv);
      if (p.connected) resetBody(p, spawns[i % spawns.length]);
    });
    this.setPhase('combat', PHASES.combat);
  }

  endCombat() {
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
    return this.phase === 'rewards' ? 'open' : 'closed';
  }

  // Geste de mini-jeu (tape, choix, rotation…), validé par le mini-jeu lui-même.
  minigameInput(p, msg) {
    if ((this.phase === 'minigame' || this.phase === 'finale') && p.inMatch) this.minigame?.input?.(p, msg);
  }

  buy(p, itemId) {
    if (!p.inMatch) return { ok: false, reason: 'Distributeur disponible pendant la partie' };
    return this.shop.buy(p, itemId, this.shopMode() === 'open');
  }

  reroll(p) {
    if (!p.inMatch) return { ok: false, reason: 'Distributeur disponible pendant la partie' };
    return this.shop.reroll(p, this.shopMode() === 'open');
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
      if (this.shopMode() === 'open' && this.rng.next() < 0.04) {
        const choice = p.bot.shop(p, this.rng);
        if (choice === 'reroll') this.recordShop(p, this.reroll(p), null);
        else if (choice) this.recordShop(p, this.buy(p, choice), choice);
      }
    }

    w.step(dt);
    this.time = w.time;

    if (this.phase === 'minigame' || this.phase === 'finale') {
      this.minigame.update(dt);
      const cap = this.minigame.timeLeftCap?.();
      if (cap !== null && cap !== undefined) this.phaseEnd = Math.min(this.phaseEnd, cap);
    }

    if (this.phase === 'pick') {
      for (const [id, at] of this.pick.botAt ?? []) {
        const p = this.room.players.get(id);
        if (p && this.time >= at && !this.pick.votes.has(id)) this.votePick(p, Math.floor(this.rng.next() * this.pick.options.length));
      }
      const humans = this.active().filter((p) => !p.bot);
      if (humans.length && humans.every((p) => this.pick.votes.has(p.id)) && this.time < this.phaseEnd - 1.5) this.phaseEnd = this.time + 1.5;
    }
    if (this.time >= this.phaseEnd || ((this.phase === 'minigame' || this.phase === 'finale') && this.minigame.isOver())) {
      this.advance();
    }
  }

  recordShop(p, result, itemId) {
    if (result?.ok && itemId) this.emit('bought', { id: p.id, item: itemId });
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
      case 'pick':
        return this.endPick();
      case 'rewards':
        return this.afterRewards();
      case 'combat':
        return this.endCombat();
      case 'lastShop':
        return this.nextRound();
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
      pick: this.phase === 'pick' ? {
        options: this.pick.options.map((id) => { const M = this.registry.get(id); return { id, name: M.name, description: M.description }; }),
        votes: Object.fromEntries(this.pick.votes),
      } : null,
      melee: { first: 1, last: this.rounds },
      map: this.world.map.id,
    };
  }
}
