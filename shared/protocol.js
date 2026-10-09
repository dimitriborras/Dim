// Validation des messages client -> serveur. Tout message invalide est ignoré :
// le client n'envoie que des intentions (direction, visée, boutons), jamais un résultat.

import { ITEMS } from './items.js';
import { ROUND_OPTIONS } from './constants.js';

export const MAX_MESSAGE_BYTES = 2048;
const ACTIONS = new Set(['item', 'gadget', 'c0', 'c1', 's0', 's1', 's2', 'wn', 'wp']);

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

export function sanitizeName(name) {
  if (typeof name !== 'string') return 'Joueur';
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return clean || 'Joueur';
}

export function sanitizeCode(code) {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
}

// Retourne un message normalisé ou null.
export function parseClientMessage(raw) {
  let msg = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return null;
    try { msg = JSON.parse(raw); } catch { return null; }
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;

  switch (msg.t) {
    case 'in': {
      const mx = num(msg.mx, -1, 1) ?? 0;
      const my = num(msg.my, -1, 1) ?? 0;
      const a = num(msg.a, -10, 10);
      const act = Array.isArray(msg.act) ? msg.act.filter((x) => ACTIONS.has(x)).slice(0, 6) : [];
      const s = Number.isInteger(msg.s) && msg.s >= 0 ? msg.s : null;
      // Pichenette relâchée ce tick-ci : angle et puissance (0 à 1).
      // Pichenette relâchée (angle, puissance 0 à 1) ou petite tape (`hop`).
      const fl = msg.fl && typeof msg.fl === 'object' && num(msg.fl.a, -10, 10) !== null
        ? { a: num(msg.fl.a, -10, 10), p: num(msg.fl.p, 0, 1) ?? 0.5, hop: msg.fl.hop === true }
        : null;
      return { t: 'in', mx, my, a, f: msg.f === true || msg.f === 1, act, s, fl };
    }
    case 'buy': {
      if (typeof msg.item !== 'string' || !Object.hasOwn(ITEMS, msg.item)) return null;
      const slot = msg.slot === 1 || msg.slot === 2 ? msg.slot : undefined;
      return { t: 'buy', item: msg.item, slot };
    }
    case 'cancelBuy':
    case 'start':
    case 'addBot':
    case 'removeBot':
    case 'toLobby':
      return { t: msg.t };
    case 'settings': {
      const rounds = ROUND_OPTIONS.includes(msg.rounds) ? msg.rounds : null;
      return rounds ? { t: 'settings', rounds } : null;
    }
    case 'ping':
      return { t: 'ping', c: num(msg.c, 0, Number.MAX_SAFE_INTEGER) ?? 0 };
    case 'touch':
      return { t: 'touch', on: msg.on === true };
    case 'mg': {
      // Geste de micro-jeu : tape, choix (index), rotation (tours), avec l'instant estimé côté client.
      if (!['tap', 'choice', 'wind'].includes(msg.k)) return null;
      return { t: 'mg', k: msg.k, v: num(msg.v, -10, 10) ?? 0, at: num(msg.at, 0, 1e9) };
    }
    default:
      return null;
  }
}
