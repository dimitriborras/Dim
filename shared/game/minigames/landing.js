// Détecte qu'une figurine vient de s'arrêter après SA propre pichenette (ou petite tape) :
// c'est le moment où l'on compte la carte, la case… sur laquelle elle s'est posée.
// Être poussé par quelqu'un ne déclenche rien, sauf pendant sa propre glissade.
export class LandingTracker {
  constructor() {
    this.state = new Map();
  }

  // Appelle `onLand(p)` pour chaque figurine qui vient de se poser.
  update(world, onLand) {
    for (const p of world.players) {
      if (p.state !== 'alive') continue;
      let st = this.state.get(p.id);
      // Les pichenettes d'avant la phase ont été effacées (resetBody) : on part de zéro.
      if (!st) { st = { lastFlick: -50, moving: false }; this.state.set(p.id, st); }
      if ((p.lastFlickAt ?? -1) > st.lastFlick) {
        st.lastFlick = p.lastFlickAt;
        st.moving = true;
      }
      if (st.moving && Math.hypot(p.vx, p.vy) < 15 && world.time - st.lastFlick > 0.2) {
        st.moving = false;
        onLand(p);
      }
    }
  }

  moving(id) {
    return this.state.get(id)?.moving ?? false;
  }
}

// Index du rectangle (carte, case…) qui contient ce point, ou -1.
export function rectAt(rects, x, y) {
  return rects.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
}
