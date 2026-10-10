// Réglages du joueur, conservés dans ce navigateur.
const KEY = 'pp-settings';

const DEFAULTS = {
  shake: 1, // 0, 0.5 ou 1 : intensité des tremblements de l'écran
  haptics: true, // vibrations (Android)
  volume: 0.8,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const listeners = new Set();
export const settings = load();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* stockage indisponible */ }
  for (const fn of listeners) fn(key, value);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
}

export function vibrate(pattern) {
  if (settings.haptics) navigator.vibrate?.(pattern);
}
