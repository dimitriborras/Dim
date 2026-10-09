import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../server/index.js';

const open = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  ws.on('open', () => resolve({ ws, inbox }));
  ws.on('error', reject);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('4 connexions WebSocket voient le même état', async () => {
  const srv = await createServer({ port: 0, log: () => {} });
  const url = `ws://localhost:${srv.port}/ws`;
  try {
    const host = await open(url);
    host.ws.send(JSON.stringify({ t: 'create', name: 'Hôte' }));
    await wait(150);
    const welcome = host.inbox.find((m) => m.t === 'welcome');
    assert.ok(welcome?.code);

    const others = [];
    for (let i = 0; i < 3; i++) {
      const c = await open(url);
      c.ws.send(JSON.stringify({ t: 'join', code: welcome.code, name: `J${i}` }));
      others.push(c);
    }
    const bad = await open(url);
    bad.ws.send(JSON.stringify({ t: 'join', code: 'ZZZZ', name: 'X' }));
    await wait(300);
    assert.ok(bad.inbox.some((m) => m.t === 'error'));

    host.ws.send(JSON.stringify({ t: 'start' }));
    await wait(600);
    const lastSnap = (c) => c.inbox.filter((m) => m.t === 'snap').at(-1);
    const all = [host, ...others].map(lastSnap);
    for (const s of all) {
      assert.equal(s.roster.length, 4);
      assert.equal(s.m.phase, 'intro');
    }
    assert.ok(all.every((s) => s.you.id), 'chaque client reçoit sa vue privée');
    for (const c of [host, ...others, bad]) c.ws.close();
  } finally {
    await srv.close();
  }
});

test('fichiers statiques servis, accès hors dossier refusé', async () => {
  const srv = await createServer({ port: 0, log: () => {} });
  try {
    const base = `http://localhost:${srv.port}`;
    assert.equal((await fetch(`${base}/client/index.html`)).status, 200);
    assert.equal((await fetch(`${base}/shared/items.js`)).status, 200);
    assert.equal((await fetch(`${base}/server/index.js`)).status, 404);
    assert.equal((await fetch(`${base}/client/%2e%2e/package.json`)).status, 404);
  } finally {
    await srv.close();
  }
});
