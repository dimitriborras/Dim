import { REWARDS, CONTRACT } from '../constants.js';

// Deux ressources distinctes : les crédits (achats) et les points de tournoi (victoire).
// Aucune fonction ne convertit des crédits en points.
export class ScoreSystem {
  constructor() {
    this.killLog = new Map(); // "killer>victim" -> nombre d'éliminations pendant ce combat
    this.championId = null;
  }

  static initPlayer(p) {
    p.credits = 0;
    p.points = 0;
    p.stats = { kills: 0, deaths: 0, damage: 0, wins: 0, bounties: 0 };
  }

  addCredits(p, amount, reason, events) {
    if (amount <= 0) return;
    p.credits += amount;
    events?.push({ type: 'credits', id: p.id, amount, reason });
  }

  addPoints(p, amount, reason, events) {
    if (amount <= 0) return;
    p.points += amount;
    events?.push({ type: 'points', id: p.id, amount, reason });
  }

  // `ranking` : liste de groupes ex aequo, du meilleur au moins bon. ex. [[a], [b, c], [d]]
  awardMinigame(ranking, playersById, events, { finale = false } = {}) {
    const table = finale ? REWARDS.finale : REWARDS.minigame;
    const fallback = finale ? REWARDS.finaleParticipation : REWARDS.participation;
    const results = [];
    let rank = 0;
    for (const group of ranking) {
      const reward = table[rank] ?? fallback;
      for (const id of group) {
        const p = playersById.get(id);
        if (!p) continue;
        this.addCredits(p, reward.credits, finale ? 'Finale' : 'Mini-jeu', events);
        this.addPoints(p, reward.points, finale ? 'Finale' : 'Mini-jeu', events);
        results.push({ id, rank: rank + 1, credits: reward.credits, points: reward.points });
      }
      rank += group.length;
    }
    if (!finale) {
      const winners = ranking[0] ?? [];
      // Un seul champion : en cas d'égalité, aucun bonus pour éviter de multiplier les primes.
      this.championId = winners.length === 1 ? winners[0] : null;
      for (const id of winners) {
        const p = playersById.get(id);
        if (p) p.stats.wins += 1;
      }
    }
    return results;
  }

  beginCombat() {
    this.killLog.clear();
  }

  // Points dégressifs pour les éliminations répétées de la même victime.
  onKill(killer, victim, events) {
    killer.stats.kills += 1;
    victim.stats.deaths += 1;
    const key = `${killer.id}>${victim.id}`;
    const n = this.killLog.get(key) ?? 0;
    this.killLog.set(key, n + 1);
    const pts = REWARDS.killPoints[Math.min(n, REWARDS.killPoints.length - 1)];
    this.addPoints(killer, pts, 'Élimination', events);
    if (n === 0) this.addCredits(killer, REWARDS.killCredits, 'Élimination', events);
    if (victim.id === this.championId && n === 0) {
      killer.stats.bounties += 1;
      this.addPoints(killer, REWARDS.championKillPoints, 'Prime du champion', events);
      this.addCredits(killer, REWARDS.championKillCredits, 'Prime du champion', events);
    }
    return pts;
  }

  // Fin de la Mêlée : points de survie et fin du bonus du champion.
  endCombat(players, events) {
    for (const p of players) {
      if (!p.diedThisCombat) this.addPoints(p, REWARDS.survivePoints, 'Survie', events);
    }
    this.championId = null;
  }

  // Contrats de rattrapage : uniquement des crédits, pour les joueurs dans la moitié basse.
  assignContracts(players, rng) {
    const sorted = ScoreSystem.ranking(players);
    const lead = sorted[0]?.points ?? 0;
    const half = Math.floor(sorted.length / 2);
    const contracts = new Map();
    sorted.forEach((p, i) => {
      if (i < Math.max(1, sorted.length - half) || p.points >= lead) return;
      const options = ['pocket', 'slam', 'ball', 'survive'];
      if (this.championId && this.championId !== p.id) options.push('bounty');
      const kind = rng.pick(options);
      contracts.set(p.id, ScoreSystem.makeContract(kind));
    });
    return contracts;
  }

  static makeContract(kind) {
    const c = (label, goal, reward = CONTRACT.rewardCredits) => ({ kind, label, goal, progress: 0, reward, done: false });
    switch (kind) {
      case 'pocket': return c('Empocher un adversaire', 1);
      case 'slam': return c(`Placer ${CONTRACT.slamTarget} cartons`, CONTRACT.slamTarget);
      case 'ball': return c('Empocher une boule', 1);
      case 'bounty': return c('Empocher le champion', 1);
      default: return { ...c('Ne jamais tomber', 1, CONTRACT.surviveRewardCredits), kind: 'survive' };
    }
  }

  static progressContract(p, kind, amount, events, score) {
    const c = p.contract;
    if (!c || c.done || c.kind !== kind) return;
    c.progress = Math.min(c.goal, c.progress + amount);
    if (c.progress >= c.goal) {
      c.done = true;
      score.addCredits(p, c.reward, 'Contrat rempli', events);
    }
  }

  // Classement : points, puis éliminations, puis victoires de mini-jeux, puis ordre d'arrivée.
  static ranking(players) {
    return players.slice().sort((a, b) =>
      b.points - a.points ||
      b.stats.wins - a.stats.wins ||
      b.stats.kills - a.stats.kills ||
      a.joinOrder - b.joinOrder);
  }
}
