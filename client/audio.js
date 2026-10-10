import { settings } from './settings.js';

// Petits sons synthétisés (aucun fichier audio) pour le retour immédiat.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('pp-muted') === '1'; } catch { /* ignore */ }
    const unlock = () => {
      if (!this.ctx) {
        try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
      }
      this.ctx?.resume?.();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('pp-muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    return this.muted;
  }

  tone({ f = 440, f2 = null, d = 0.08, type = 'square', v = 0.06, noise = false }) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    const t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, v * settings.volume), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    g.connect(c.destination);
    if (noise) {
      const len = Math.floor(c.sampleRate * d);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(t);
      return;
    }
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    o.connect(g);
    o.start(t);
    o.stop(t + d);
  }

  play(ev, youId) {
    const mine = ev.id === youId;
    switch (ev.type) {
      case 'push': if (ev.by === youId) this.tone({ f: 1200, d: 0.04, type: 'triangle', v: 0.03 }); break;
      case 'elim': this.tone({ f: 300, f2: 60, d: 0.35, type: 'sawtooth', v: 0.07 }); break;
      case 'boom': this.tone({ noise: true, d: 0.4, v: 0.14 }); break;
      case 'flick': this.tone({ f: 160, f2: 620, d: 0.14, type: 'sine', v: 0.08 }); break; // élastique relâché
      case 'clack': // choc de plastique dur : claquement sec
        this.tone({ f: 1800, f2: 900, d: 0.04, type: 'square', v: Math.min(0.12, 0.03 + ev.power / 8000) });
        this.tone({ noise: true, d: 0.05, v: Math.min(0.1, ev.power / 9000) });
        break;
      case 'microAnnounce': this.tone({ f: 660, f2: 990, d: 0.12, type: 'square', v: 0.05 }); break;
      case 'microTap': this.tone({ f: 500 + Math.random() * 300, d: 0.03, type: 'square', v: 0.03 }); break;
      case 'microWin':
        this.tone({ f: 784, f2: 1046, d: 0.12, type: 'triangle', v: 0.08 });
        setTimeout(() => this.tone({ f: 1046, f2: 1568, d: 0.16, type: 'triangle', v: 0.08 }), 110);
        break;
      case 'microLose': this.tone({ f: 220, f2: 110, d: 0.3, type: 'sawtooth', v: 0.06 }); break;
      case 'hop': if (mine) this.tone({ f: 520, f2: 760, d: 0.06, type: 'triangle', v: 0.04 }); break;
      case 'thud': this.tone({ f: 260, f2: 120, d: 0.06, type: 'square', v: 0.05 }); break;
      case 'slam': this.tone({ f: 140, f2: 70, d: 0.14, type: 'square', v: 0.09 }); break;
      case 'ballPocket': this.tone({ f: 380, f2: 110, d: 0.18, type: 'sine', v: 0.08 }); break;
      case 'pocket':
        this.tone({ f: 420, f2: 90, d: 0.22, type: 'sine', v: 0.1 }); // « plop » au fond de la poche
        this.tone({ f: 1600, f2: 1200, d: 0.03, type: 'square', v: 0.04 });
        break;
      case 'topple': this.tone({ f: 420, f2: 140, d: 0.18, type: 'triangle', v: 0.07 }); break;
      case 'spring': case 'jump': this.tone({ f: 200, f2: 800, d: 0.2, type: 'sine', v: 0.08 }); break;
      case 'bump': this.tone({ f: 500, f2: 250, d: 0.1, type: 'triangle', v: 0.07 }); break;
      case 'coin': if (mine) this.tone({ f: 990, f2: 1480, d: 0.09, type: 'square', v: 0.04 }); break;
      case 'slip': this.tone({ f: 700, f2: 150, d: 0.3, type: 'sine', v: 0.07 }); break;
      case 'punch': this.tone({ f: 120, f2: 60, d: 0.12, type: 'square', v: 0.08 }); break;
      case 'teleport': this.tone({ f: 300, f2: 1200, d: 0.18, type: 'sine', v: 0.06 }); break;
      case 'bought': if (mine) this.tone({ f: 880, f2: 1320, d: 0.15, type: 'triangle', v: 0.07 }); break;
      case 'phase': this.tone({ f: 523, f2: 784, d: 0.2, type: 'triangle', v: 0.06 }); break;
      case 'saved': this.tone({ f: 300, f2: 900, d: 0.25, type: 'sine', v: 0.08 }); break;
      case 'magnet': this.tone({ f: 900, f2: 200, d: 0.3, type: 'sine', v: 0.06 }); break;
      case 'crownSteal': this.tone({ f: 660, f2: 1320, d: 0.2, type: 'triangle', v: 0.08 }); break;
      case 'bombPass': this.tone({ f: 200, f2: 500, d: 0.08, type: 'square', v: 0.06 }); break;
      case 'bombArm': this.tone({ f: 120, f2: 180, d: 0.3, type: 'sawtooth', v: 0.06 }); break;
      case 'card': this.tone({ noise: true, d: 0.06, v: 0.05 }); this.tone({ f: 900, d: 0.05, type: 'triangle', v: 0.04 }); break;
      case 'bust': this.tone({ f: 300, f2: 80, d: 0.4, type: 'sawtooth', v: 0.07 }); break;
      case 'blackjack': this.tone({ f: 660, f2: 1320, d: 0.25, type: 'triangle', v: 0.08 }); break;
      case 'tileFall': this.tone({ f: 180, f2: 60, d: 0.12, type: 'triangle', v: 0.03 }); break;
      case 'meow': this.tone({ f: 700, f2: 1100, d: 0.18, type: 'sine', v: 0.05 }); this.tone({ f: 1100, f2: 600, d: 0.2, type: 'sine', v: 0.04 }); break;
      case 'damage': this.tone({ f: 220, f2: 160, d: 0.08, type: 'square', v: 0.04 }); break;
      case 'broken': this.tone({ noise: true, d: 0.35, v: 0.1 }); break;
      case 'delivered': this.tone({ f: 523, f2: 1046, d: 0.2, type: 'triangle', v: 0.07 }); break;
      case 'meeting': this.tone({ f: 880, f2: 440, d: 0.5, type: 'sawtooth', v: 0.07 }); break;
      case 'ejected': this.tone({ f: 400, f2: 80, d: 0.6, type: 'sine', v: 0.07 }); break;
      case 'impostorEnd': this.tone({ f: 330, f2: 990, d: 0.4, type: 'triangle', v: 0.08 }); break;
      case 'killSound': this.tone({ noise: true, d: 0.08, v: 0.03 }); break;
      case 'memFlip': this.tone({ noise: true, d: 0.05, v: 0.04 }); break;
      case 'memPair': this.tone({ f: 784, f2: 1568, d: 0.2, type: 'triangle', v: 0.07 }); break;
      case 'hillKing': if (mine) this.tone({ f: 660, f2: 990, d: 0.15, type: 'triangle', v: 0.06 }); break;
      case 'dig': if (mine) this.tone({ noise: true, d: 0.06, v: 0.05 }); break;
      case 'meneEnd': this.tone({ f: 523, f2: 1046, d: 0.2, type: 'triangle', v: 0.06 }); break;
      case 'shieldBreak': this.tone({ f: 1200, f2: 300, d: 0.25, type: 'triangle', v: 0.08 }); break;
      default: break;
    }
  }
}
