// Deux transports avec la même interface : en ligne (WebSocket vers le serveur
// faisant autorité) ou solo hors ligne (la même simulation tourne dans le navigateur).

export class OnlineConnection {
  constructor() {
    this.onMessage = () => {};
    this.onStatus = () => {};
    this.ws = null;
    this.hello = null;
    this.retries = 0;
    this.closedByUser = false;
    this.joined = false;
  }

  connect(hello) {
    this.hello = hello;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus('open');
      ws.send(JSON.stringify(this.hello));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.joined = true;
        this.retries = 0;
        // Pour revenir dans la même partie après une coupure.
        this.hello = { t: 'join', code: msg.code, name: this.hello.name, token: msg.token, touch: this.hello.touch };
        try { sessionStorage.setItem(`pp-token-${msg.code}`, msg.token); } catch { /* stockage indisponible */ }
      }
      if (msg.t === 'error' && msg.fatal) this.closedByUser = true;
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.closedByUser) { this.onStatus('closed'); return; }
      if (this.joined && this.retries < 10) {
        this.retries += 1;
        this.onStatus('reconnecting');
        setTimeout(() => this.connect(this.hello), Math.min(4000, 500 * 2 ** this.retries));
      } else {
        this.onStatus('closed');
      }
    };
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

export class LocalConnection {
  constructor() {
    this.onMessage = () => {};
    this.onStatus = () => {};
  }

  async connect(hello, { bots = 5 } = {}) {
    const [{ GameRoom }, { DT }] = await Promise.all([
      import('../shared/game/GameRoom.js'),
      import('../shared/constants.js'),
    ]);
    this.room = new GameRoom({ code: 'SOLO' });
    const client = { send: (m) => this.onMessage(m) };
    const res = this.room.join(client, { name: hello.name, touch: hello.touch });
    this.playerId = res.player.id;
    for (let i = 0; i < bots; i++) this.room.addBot();
    this.room.onClose = () => {};
    let acc = 0;
    let prev = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - prev) / 1000);
      prev = now;
      while (acc >= DT) { this.room.tick(DT); acc -= DT; }
    }, 1000 / 60);
    this.onStatus('open');
  }

  send(obj) {
    this.room?.handle(this.playerId, obj);
  }

  close() {
    clearInterval(this.timer);
  }
}
