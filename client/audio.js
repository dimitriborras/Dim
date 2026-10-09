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
    g.gain.setValueAtTime(v, t);
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
      case 'shot': if (mine) this.tone({ f: ev.kind === 'glue' ? 220 : 660, f2: ev.kind === 'glue' ? 120 : 330, d: 0.07, v: 0.04 }); break;
      case 'dmg': this.tone({ noise: true, d: 0.08, v: mine ? 0.12 : 0.05 }); break;
      case 'elim': this.tone({ f: 300, f2: 60, d: 0.35, type: 'sawtooth', v: 0.07 }); break;
      case 'boom': this.tone({ noise: true, d: 0.4, v: 0.14 }); break;
      case 'spring': case 'jump': this.tone({ f: 200, f2: 800, d: 0.2, type: 'sine', v: 0.08 }); break;
      case 'bump': this.tone({ f: 500, f2: 250, d: 0.1, type: 'triangle', v: 0.07 }); break;
      case 'coin': if (mine) this.tone({ f: 990, f2: 1480, d: 0.09, type: 'square', v: 0.04 }); break;
      case 'slip': this.tone({ f: 700, f2: 150, d: 0.3, type: 'sine', v: 0.07 }); break;
      case 'punch': this.tone({ f: 120, f2: 60, d: 0.12, type: 'square', v: 0.08 }); break;
      case 'teleport': this.tone({ f: 300, f2: 1200, d: 0.18, type: 'sine', v: 0.06 }); break;
      case 'bought': if (mine) this.tone({ f: 880, f2: 1320, d: 0.15, type: 'triangle', v: 0.07 }); break;
      case 'phase': this.tone({ f: 523, f2: 784, d: 0.2, type: 'triangle', v: 0.06 }); break;
      case 'shieldBreak': this.tone({ f: 1200, f2: 300, d: 0.25, type: 'triangle', v: 0.08 }); break;
      default: break;
    }
  }
}
