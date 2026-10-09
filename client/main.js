import { OnlineConnection, LocalConnection } from './net.js';
import { InputController } from './input.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Predictor } from './predict.js';
import { INTERP_DELAY_MS } from '../shared/constants.js';
import { angleDiff } from '../shared/geometry.js';
import { settings, onSettingsChange, vibrate } from './settings.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const applyBodySettings = () => {
  document.body.classList.toggle('lefty', settings.leftHanded);
  document.body.classList.toggle('no-tilt', !settings.tiltShift);
};
applyBodySettings();
onSettingsChange(applyBodySettings);

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
      else if (msg.pending) hud?.toast('Transaction en cours… (1,5 s)');
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
    hud.onSlotTap = (i) => input.pressAction(`s${i}`);
    hud.onConsumableTap = (i) => input.pressAction(`c${i}`);
  }
  if (welcome.code && conn instanceof OnlineConnection) history.replaceState(null, '', `?room=${welcome.code}`);
  if (isTouch) {
    $('#touch').hidden = false;
    input.bindTouch($('#touch'));
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
  if (msg.you?.body) predictor.reconcile(msg.you.body, msg.w.map);
  const players = new Map(msg.roster.map((r) => [r.id, r]));
  for (const ev of msg.ev) {
    renderer.addEvent(ev, players, youId);
    if (ev.type === 'dmg' && ev.id === youId) vibrate(35);
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
  // Souris : point visé sur le sol (la vue est inclinée), puis angle depuis le joueur.
  aimFromMouse: (sx, sy) => {
    const me = currentState?.players.find((p) => p.id === youId);
    if (!me) return null;
    const w = renderer.toWorld(sx, sy);
    return Math.atan2(w.y - me.y, w.x - me.x);
  },
  onKey: (code, down) => {
    if (!hud) return;
    if (code === 'KeyB' && down) hud.toggleShop();
    if (code === 'Escape' && down) hud.toggleShop(false);
    if (code === 'KeyM' && down) hud.toast(sfx.toggle() ? 'Son coupé' : 'Son activé');
    if (code === 'Tab') { showTable = down; if (latest) hud.renderFullTable(latest, showTable); }
  },
  onPadButton: (i) => {
    if (!hud) return;
    if (i === 9) hud.toggleShop(); // Start
    if (i === 8) { showTable = !showTable; if (latest) hud.renderFullTable(latest, showTable); } // Select
  },
});

// Aide à la visée (tactile et manette uniquement) : la visée est légèrement attirée vers
// la cible la plus proche de la direction choisie. Elle ne vise jamais à la place du joueur.
function applyAimAssist(cmd) {
  if (!settings.aimAssist || !input.aimAssisted || !currentState) return;
  const me = currentState.players.find((p) => p.id === youId);
  if (!me || me.s !== 'alive') return;
  const targets = [
    ...currentState.players.filter((o) => o.id !== youId && o.s === 'alive'),
    ...currentState.decoys.filter((d) => d.owner !== youId),
  ];
  let best = null;
  for (const o of targets) {
    const dx = o.x - me.x;
    const dy = o.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d > 650 || d < 1) continue;
    const diff = angleDiff(Math.atan2(dy, dx), cmd.a);
    const tolerance = Math.min(0.35, 0.1 + 26 / d); // plus tolérant de près
    if (Math.abs(diff) < tolerance && (best === null || Math.abs(diff) < Math.abs(best))) best = diff;
  }
  if (best !== null) cmd.a = Math.round((cmd.a + best * 0.6) * 1000) / 1000;
}

setInterval(() => {
  if (!conn || !youId) return;
  const cmd = input.sample();
  applyAimAssist(cmd);
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
  const projA = tupleMap(A.proj);
  const proj = B.proj.map(([id, x, y, kind, r]) => {
    const q = projA.get(id);
    return q ? { x: lerp(q[1], x, k), y: lerp(q[2], y, k), px: q[1], py: q[2], kind, r } : { x, y, kind, r };
  });
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
  const movers = B.movers.map((m, i) => (A.movers[i] ? [lerp(A.movers[i][0], m[0], k), lerp(A.movers[i][1], m[1], k)] : m));
  return {
    map: B.map,
    time: lerp(A.t, B.t, k),
    players,
    proj,
    bombs,
    decoys,
    movers,
    traps: B.traps.map(([id, x, y, armed]) => ({ id, x, y, armed })),
    pickups: B.pickups.map(([id, kind, x, y]) => ({ id, kind, x, y })),
  };
}

const predictor = new Predictor();
function myHud(you) {
  if (!you) return null;
  const s = you.inv.slots[you.inv.active];
  return { ammo: s?.ammo ?? null, maxAmmo: s?.maxAmmo ?? null, reloading: s?.reloading ?? 0, dash: you.dash };
}

let currentState = null;
let lastFrame = performance.now();
function frame() {
  const nowMs = performance.now();
  const frameDt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  requestAnimationFrame(frame);
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
    return predicted ? { ...p, ...predicted, a: input.aim } : { ...p, a: input.aim };
  });
  currentState = {
    ...st,
    youId,
    roster: new Map(latest.roster.map((r) => [r.id, r])),
    champion: m.phase === 'combat' || m.phase === 'rewards' ? m.champion : null,
    crownHolder: m.hud?.kind === 'crown' ? m.hud.holder : null,
    channel: latest.you?.channel,
    myHud: myHud(latest.you),
    charge: input.chargeState(),
    showHp: ['combat', 'finale', 'lobby'].includes(m.phase),
    touch: isTouch,
    mouseWorld: renderer.toWorld(input.mouse.x, input.mouse.y),
  };
  renderer.draw(currentState);
}
requestAnimationFrame(frame);

// Accès de débogage (console du navigateur) : plasticPanic.conn.room en mode solo.
window.plasticPanic = { get conn() { return conn; }, get state() { return currentState; } };
