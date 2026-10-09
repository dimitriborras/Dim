// Serveur PLASTIC PANIC : fichiers statiques + WebSocket. La simulation faisant
// autorité tourne ici (shared/game) ; les clients n'envoient que leurs commandes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from '../shared/game/GameRoom.js';
import { DT, TICK_RATE } from '../shared/constants.js';
import { MAX_MESSAGE_BYTES, sanitizeCode, sanitizeName } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIRS = ['client', 'shared'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function createServer({ port = 8080, log = console.log } = {}) {
  const rooms = new Map();

  const newCode = () => {
    for (;;) {
      const c = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(302, { location: `/client/${url.search}` });
      res.end();
      return;
    }
    let rel;
    try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { res.writeHead(400); res.end(); return; }
    const top = rel.split('/')[0];
    let file = path.normalize(path.join(ROOT, rel));
    if (!PUBLIC_DIRS.includes(top) || !file.startsWith(path.join(ROOT, top))) { res.writeHead(404); res.end('Introuvable'); return; }
    if (rel.endsWith('/') || rel === top) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Introuvable'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws) => {
    let room = null;
    let playerId = null;
    // Limitation de débit simple (seau à jetons) contre les messages en rafale.
    let tokens = 90;
    let last = Date.now();
    const client = {
      send(obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); },
      close() { ws.close(4000, 'remplacé'); },
    };

    ws.on('message', (data) => {
      const now = Date.now();
      tokens = Math.min(90, tokens + ((now - last) / 1000) * 60);
      last = now;
      if (tokens < 1) return;
      tokens -= 1;
      const text = data.toString();
      if (room) { room.handle(playerId, text); return; }

      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (!msg || (msg.t !== 'create' && msg.t !== 'join')) return;
      const touch = msg.touch === true;
      const name = sanitizeName(msg.name);
      let target;
      if (msg.t === 'create') {
        const code = newCode();
        target = new GameRoom({ code, onClose: (r) => { rooms.delete(r.code); log(`Salle ${r.code} fermée`); } });
        rooms.set(code, target);
        log(`Salle ${code} créée`);
      } else {
        target = rooms.get(sanitizeCode(msg.code));
        if (!target) { client.send({ t: 'error', reason: 'Salle introuvable', fatal: true }); return; }
      }
      const res = target.join(client, { name, token: typeof msg.token === 'string' ? msg.token : null, touch });
      if (!res.ok) { client.send({ t: 'error', reason: res.reason, fatal: true }); return; }
      room = target;
      playerId = res.player.id;
    });

    ws.on('close', () => {
      if (room && room.clients.get(playerId) === client) room.leave(playerId);
    });
    ws.on('error', () => {});
  });

  // Boucle de simulation à pas fixe pour toutes les salles.
  let acc = 0;
  let prev = performance.now();
  const loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - prev) / 1000);
    prev = now;
    while (acc >= DT) {
      for (const r of rooms.values()) {
        try { r.tick(DT); } catch (e) { log(`Erreur salle ${r.code}:`, e); }
      }
      acc -= DT;
    }
  }, 1000 / TICK_RATE / 2);

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        rooms,
        close: () => new Promise((r) => { clearInterval(loop); wss.close(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  createServer({ port }).then(({ port: p }) => {
    console.log(`PLASTIC PANIC prêt sur http://localhost:${p}`);
  });
}
