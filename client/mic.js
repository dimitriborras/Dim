// Micro du téléphone pour les micro-jeux de souffle. Le niveau sonore est comparé à un
// plancher de bruit qui s'adapte à la pièce (une soirée bruyante ne souffle pas à votre
// place). Seule une intensité 0..1 sort d'ici : aucun son n'est enregistré ni envoyé.
export class Mic {
  constructor() {
    this.state = 'off'; // off | asking | on | denied
    this.floor = 0.02;
    this.level = 0;
    this.buf = null;
  }

  async start() {
    if (this.state === 'on' || this.state === 'asking') return this.state;
    if (!navigator.mediaDevices?.getUserMedia) { this.state = 'denied'; return this.state; }
    this.state = 'asking';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.ctx = new AudioContext();
      await this.ctx.resume?.();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.state = 'on';
    } catch {
      this.state = 'denied';
    }
    return this.state;
  }

  // Intensité du souffle (0..1), à appeler à chaque image.
  read() {
    if (this.state !== 'on') return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    // Plancher : descend vite, remonte lentement (un souffle ne devient pas « le silence »).
    this.floor = rms < this.floor ? this.floor * 0.8 + rms * 0.2 : this.floor * 0.998 + rms * 0.002;
    const v = Math.max(0, Math.min(1, (rms - this.floor * 2.2 - 0.008) / 0.12));
    this.level = this.level * 0.5 + v * 0.5;
    return this.level;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
    this.stream = null;
    this.ctx = null;
    if (this.state === 'on') this.state = 'off';
  }
}
