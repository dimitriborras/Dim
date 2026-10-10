// Registre des mini-jeux indépendants. Chaque mini-jeu respecte le contrat :
//
//   id, name, description, durationSeconds, finale?
//   initialize(context)   context = { players, rng, time, createWorld(opts) }
//   start()
//   update(deltaSeconds)
//   isOver() -> boolean   (fin anticipée facultative)
//   finish() -> { ranking: string[][], summary: string }
//   hud() -> données d'affichage envoyées aux clients
//   dispose()
//
// Le serveur exécute ces règles faisant autorité ; le client n'affiche que `hud()` et le monde.

export class MinigameRegistry {
  constructor() {
    this.entries = new Map();
  }

  register(MinigameClass) {
    this.entries.set(MinigameClass.id, MinigameClass);
    return this;
  }

  get(id) {
    return this.entries.get(id) ?? null;
  }

  list({ finale = false } = {}) {
    return [...this.entries.values()].filter((m) => !!m.finale === finale);
  }

  // Séquence de manches : alterne les mini-jeux sans répéter deux fois de suite.
  plan(rounds, rng) {
    const pool = this.list().map((m) => m.id);
    const seq = [];
    let bag = [];
    while (seq.length < rounds) {
      if (bag.length === 0) bag = rng.shuffle(pool);
      const next = bag.shift();
      if (seq.length && seq[seq.length - 1] === next && pool.length > 1) {
        bag.push(next);
        continue;
      }
      seq.push(next);
    }
    return seq;
  }

  create(id) {
    const M = this.get(id);
    if (!M) throw new Error(`Mini-jeu inconnu : ${id}`);
    return new M();
  }
}

// Regroupe les ex aequo : entrées triées [{id, score}] -> [[id], [id, id], ...]
export function groupRanking(sorted, eq = (a, b) => a.score === b.score) {
  const groups = [];
  let prev = null;
  for (const e of sorted) {
    if (prev && eq(prev, e)) groups[groups.length - 1].push(e.id);
    else groups.push([e.id]);
    prev = e;
  }
  return groups;
}
