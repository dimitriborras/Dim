import { OnlineConnection, LocalConnection } from './net.js';
import { InputController } from './input.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Predictor } from './predict.js';
import { MicroOverlay } from './micro.js';
import { INTERP_DELAY_MS } from '../shared/constants.js';
import { MAPS, isGroundAt } from '../shared/maps.js';
import { simulateFlick } from '../shared/game/movement.js';
import { pointInRect } from '../shared/geometry.js';
import { vibrate } from './settings.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
// Mise en page : le téléphone tenu en vertical est le format principal.
const applyLayout = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);
applyLayout();
addEventListener('resize', applyLayout);

let conn = null;
let youId = null;
let hud = null;
let latest = null;
let snaps = [];
let clockOffset = null;
let showTable = false;
let ping = null;

// ------------------------------------------------------------ menu
const params = new URLSearchParams(location.search);
try { $('#name').value = localStorage.getItem('pp-name') ?? ''; } catch { /* ignore */ }
if (params.get('room')) {
  $('#code').value = params.get('room').toUpperCase().slice(0, 4);
}

const playerName = () => {
  const n = $('#name').value.trim() || `Figurine${Math.floor(Math.random() * 90 + 10)}`;
  try { localStorage.setItem('pp-name', n); } catch { /* ignore */ }
  return n;
};

const menuError = (msg) => { $('#menuError').textContent = msg; };

function startOnline(hello) {
  menuError('');
  conn = new OnlineConnection();
  conn.onMessage = onMessage;
  conn.onStatus = (s) => {
    if (s === 'reconnecting') $('#netinfo').textContent = 'Connexion perdue — reconnexion…';
    if (s === 'closed' && !youId) menuError('Serveur injoignable. Lancez « npm start » ou essayez l\'entraînement solo.');
    if (s === 'closed' && youId) { $('#netinfo').textContent = 'Déconnecté'; }
  };
  conn.connect(hello);
}

$('#btnCreate').onclick = () => startOnline({ t: 'create', name: playerName(), touch: isTouch });
$('#btnJoin').onclick = () => {
  const code = $('#code').value.trim().toUpperCase();
  if (code.length !== 4) { menuError('Entrez le code à 4 lettres de la salle.'); return; }
  let token = null;
  try { token = sessionStorage.getItem(`pp-token-${code}`); } catch { /* ignore */ }
  startOnline({ t: 'join', code, name: playerName(), token, touch: isTouch });
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnSolo').onclick = async () => {
  conn = new LocalConnection();
  conn.onMessage = onMessage;
  await conn.connect({ name: playerName(), touch: isTouch }, { bots: 5 });
  $('#netinfo').textContent = 'Solo hors ligne';
};

// ------------------------------------------------------------ réseau
function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      youId = msg.id;
      enterGame(msg);
      break;
    case 'snap':
      onSnap(msg);
      break;
    case 'shop':
      if (!msg.ok) hud?.toast(msg.reason ?? 'Achat impossible', true);
      else if (msg.reroll) { hud?.toast('🔄 Nouvelles capsules !'); sfx.play({ type: 'microAnnounce' }, null); }
      else { hud?.toast(`✔ ${hud?.items.get(msg.item)?.name ?? 'Acheté'}${msg.replaces ? ` (remplace ${hud?.items.get(msg.replaces)?.icon ?? ''})` : ''}`); vibrate([10, 30, 10]); }
      break;
    case 'error':
      if (!youId) menuError(msg.reason);
      else hud?.toast(msg.reason, true);
      break;
    case 'pong':
      ping = Math.round(performance.now() - msg.c);
      if (conn instanceof OnlineConnection) $('#netinfo').textContent = `${ping} ms`;
      break;
    default:
      break;
  }
}

function enterGame(welcome) {
  $('#menu').hidden = true;
  $('#hud').hidden = false;
  document.body.classList.add('playing');
  if (!hud) {
    hud = new Hud({ send: (m) => conn.send(m), items: welcome.items });
    hud.onItem = () => input.pressAction('item');
  }
  if (welcome.code && conn instanceof OnlineConnection) history.replaceState(null, '', `?room=${welcome.code}`);
  if (isTouch) {
    conn.send({ t: 'touch', on: true });
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  $('#netinfo').textContent = conn instanceof OnlineConnection ? '' : 'Solo hors ligne';
}

function onSnap(msg) {
  const now = performance.now() / 1000;
  const est = now - msg.w.t;
  if (clockOffset === null || est < clockOffset) clockOffset = est;
  else clockOffset += (est - clockOffset) * 0.02;
  snaps.push(msg);
  if (snaps.length > 30) snaps.shift();
  latest = msg;
  micro.update(msg);
  if (msg.you?.body) predictor.reconcile(msg.you.body, msg.w.map);
  const players = new Map(msg.roster.map((r) => [r.id, r]));
  for (const ev of msg.ev) {
    renderer.addEvent(ev, players, youId);
    if (ev.type === 'saved' && ev.id === youId) vibrate([15, 30, 15]);
    if (ev.type === 'bombPass' && (ev.id === youId || ev.from === youId)) vibrate(ev.id === youId ? [40, 30, 40] : 15);
    if (ev.type === 'elim' && ev.killer === youId) vibrate([25, 40, 60]);
    if (ev.type === 'elim' && ev.victim === youId) vibrate(120);
    sfx.play(ev, youId);
    hud?.onEvent(ev, youId);
  }
  hud?.update(msg, youId);
  hud?.renderFullTable(msg, showTable);
}

// ------------------------------------------------------------ commandes
const input = new InputController(canvas, {
  screenToWorld: (sx, sy) => renderer.toWorld(sx, sy),
  screenDir: (dx, dy) => renderer.screenDirToWorld(dx, dy),
  playerWorld: () => currentState?.players.find((p) => p.id === youId && p.s === 'alive') ?? null,
  onKey: (code, down) => {
    if (!hud) return;
    if (code === 'KeyB' && down) hud.toggleShop();
    if (code === 'Escape' && down) hud.toggleShop(false);
    if (code === 'KeyM' && down) hud.toast(sfx.toggle() ? 'Son coupé' : 'Son activé');
    if (code === 'Space' && down && micro.hud?.phase === 'play' && !micro.hud.physics) {
      micro.stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    }
    if (code === 'Tab') { showTable = down; if (latest) hud.renderFullTable(latest, showTable); }
  },
  onPadButton: (i) => {
    if (!hud) return;
    if (i === 9) hud.toggleShop(); // Start
    if (i === 8) { showTable = !showTable; if (latest) hud.renderFullTable(latest, showTable); } // Select
  },
});

setInterval(() => {
  if (!conn || !youId) return;
  const cmd = input.sample();
  predictor.record(cmd);
  conn.send(cmd);
}, 1000 / 30);
setInterval(() => {
  if (conn instanceof OnlineConnection && youId) conn.send({ t: 'ping', c: performance.now() });
}, 2000);

// ------------------------------------------------------------ interpolation
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

let frozenRenderT = 0;
function interpolate() {
  if (!snaps.length) return null;
  const now = performance.now() / 1000;
  // Micro-gel sur un impact décisif : l'image se fige ~80 ms, puis reprend.
  const renderT = now < renderer.hitStopUntil ? frozenRenderT : now - clockOffset - INTERP_DELAY_MS / 1000;
  frozenRenderT = renderT;
  let a = snaps[0];
  let b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].w.t <= renderT) { a = snaps[i - 1]; b = snaps[i]; break; }
  }
  if (renderT >= b.w.t || a.w.e !== b.w.e) a = b;
  const span = b.w.t - a.w.t;
  const k = span > 0 ? Math.max(0, Math.min(1, (renderT - a.w.t) / span)) : 1;
  const A = a.w;
  const B = b.w;
  const byId = (arr, key = 'id') => new Map(arr.map((x) => [x[key], x]));
  const pa = byId(A.players);
  const players = B.players.map((p) => {
    const q = pa.get(p.id);
    if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 160) return p;
    return { ...p, x: lerp(q.x, p.x, k), y: lerp(q.y, p.y, k), a: lerpAngle(q.a, p.a, k) };
  });
  const tupleMap = (arr) => new Map(arr.map((x) => [x[0], x]));
  const bombA = tupleMap(A.bombs);
  const bombs = B.bombs.map(([id, x, y, fuse]) => {
    const q = bombA.get(id);
    return q ? { x: lerp(q[1], x, k), y: lerp(q[2], y, k), fuse } : { x, y, fuse };
  });
  const decA = tupleMap(A.decoys);
  const decoys = B.decoys.map(([id, owner, x, y, ang]) => {
    const q = decA.get(id);
    return q ? { owner, x: lerp(q[2], x, k), y: lerp(q[3], y, k), a: ang } : { owner, x, y, a: ang };
  });
  const ballA = tupleMap(A.balls ?? []);
  const balls = (B.balls ?? []).map(([id, x, y, num]) => {
    const q = ballA.get(id);
    return q ? { id, num, x: lerp(q[1], x, k), y: lerp(q[2], y, k) } : { id, num, x, y };
  });
  const movers = B.movers.map((m, i) => (A.movers[i] ? [lerp(A.movers[i][0], m[0], k), lerp(A.movers[i][1], m[1], k)] : m));
  return {
    map: B.map,
    time: lerp(A.t, B.t, k),
    players,
    bombs,
    decoys,
    balls,
    movers,
    traps: B.traps.map(([id, x, y, armed]) => ({ id, x, y, armed })),
    pickups: B.pickups.map(([id, kind, x, y]) => ({ id, kind, x, y })),
  };
}

const predictor = new Predictor();
// Heure du serveur estimée (même référence que les instantanés) : sert aux micro-jeux de réflexe.
const serverNow = () => performance.now() / 1000 - (clockOffset ?? 0);
const micro = new MicroOverlay($('#micro'), { send: (m) => conn?.send(m), serverNow, sfx, nameOf: (id) => (id === 'ghost' ? '👻 Fantôme' : hud?.roster?.get(id)?.name ?? '?') });
// Aperçu de la pichenette : simulation exacte (même physique que le serveur) depuis la
// position affichée, avec les plateformes mobiles à leur position actuelle.
function trajectory(st, snap) {
  const ch = input.chargeState();
  if (!ch || ch.cancel || ch.tap) return null;
  const me = st.players.find((p) => p.id === youId);
  if (!me || me.s !== 'alive') return null;
  let map = MAPS[st.map] ?? MAPS.arena;
  // Poches gloutonnes : l'aperçu tient compte des poches agrandies.
  const scale = snap.m.hud?.kind === 'glutton' ? snap.m.hud.scale : 1;
  if (scale > 1 && map.pockets) map = { ...map, pockets: map.pockets.map((pk) => ({ ...pk, r: pk.r * scale })) };
  // Carrelage : l'aperçu ignore les dalles déjà tombées.
  if (snap.m.hud?.kind === 'tiles' && map.tiles) {
    const gone = new Set(snap.m.hud.gone);
    map = { ...map, platforms: map.platforms.filter((_, i) => !gone.has(i)) };
  }
  const movers = (st.movers ?? []).map(([x, y], i) => ({ x, y, w: map.movingPlatforms[i]?.w ?? 0, h: map.movingPlatforms[i]?.h ?? 0 }));
  const isGround = (x, y) => isGroundAt(map, movers, x, y);
  const springAt = (x, y) => map.springs.some((r) => pointInRect(x, y, r));
  const sim = simulateFlick(me, ch.a, ch.p, map, { isGround, stopAt: springAt, factor: snap.you?.body?.sf ?? 1 });
  return { ...sim, angle: ch.a, power: ch.p, ready: (predictor.pos ? predictor.energy : snap.you?.energy ?? 0) >= 1 };
}

// Petites étiquettes au-dessus des figurines selon le mini-jeu (total du vingt-et-un…).
function badgesFor(h) {
  if (h?.kind !== 'blackjack') return null;
  const out = {};
  for (const [id, st] of Object.entries(h.players)) out[id] = st.b ? ` 💥${st.t}` : ` 🃏${st.t}${st.s ? '✋' : ''}`;
  return out;
}

let currentState = null;
let lastTick = 0;
let lastFrame = performance.now();
function frame() {
  const nowMs = performance.now();
  const frameDt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  requestAnimationFrame(frame);
  micro.frame();
  const st = interpolate();
  if (!st || !latest) {
    renderer.ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    renderer.drawBackdrop();
    return;
  }
  const m = latest.m;
  // Joueur local : position prédite et visée immédiate, sans attendre le serveur.
  const predicted = predictor.display(frameDt);
  st.players = st.players.map((p) => {
    if (p.id !== youId || p.s !== 'alive') return p;
    return predicted ? { ...p, x: predicted.x, y: predicted.y } : p;
  });
  currentState = {
    ...st,
    youId,
    roster: new Map(latest.roster.map((r) => [r.id, r])),
    champion: m.phase === 'combat' || m.phase === 'rewards' ? m.champion : null,
    crownHolder: m.hud?.kind === 'crown' ? m.hud.holder : null,
    energy: predictor.pos ? predictor.energy : latest.you?.energy ?? 0,
    trajectory: trajectory(st, latest),
    microTarget: m.hud?.kind === 'micro' && m.hud.physics === 'circle' ? { ...MAPS.micro.center, r: m.hud.data?.radius ?? 85 } : null,
    energyMax: latest.you?.energyMax,
    pocketScale: m.hud?.kind === 'glutton' ? m.hud.scale : 1,
    tiles: m.hud?.kind === 'tiles' ? { gone: m.hud.gone, warn: m.hud.warn } : null,
    cards: m.hud?.kind === 'blackjack' ? m.hud.cards : null,
    bombHolder: m.hud?.kind === 'bomb' ? m.hud.holder : null,
    bombHeat: m.hud?.kind === 'bomb' ? m.hud.heat : 0,
    badges: badgesFor(m.hud),
    touch: isTouch,
  };
  renderer.draw(currentState);
  // Patate chaude : tic-tac de plus en plus rapide (la mèche n'est jamais affichée en secondes).
  if (currentState.bombHolder) {
    const period = 0.9 - (currentState.bombHeat ?? 0) * 0.75;
    if (nowMs / 1000 - lastTick > period) {
      lastTick = nowMs / 1000;
      sfx.tone({ f: currentState.bombHolder === youId ? 1400 : 1000, d: 0.03, type: 'square', v: currentState.bombHolder === youId ? 0.05 : 0.025 });
    }
  }
}
requestAnimationFrame(frame);

// Accès de débogage (console du navigateur) : plasticPanic.conn.room en mode solo.
window.plasticPanic = { get conn() { return conn; }, get state() { return currentState; }, renderer };
