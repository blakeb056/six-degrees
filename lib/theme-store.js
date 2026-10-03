// The theme in use (lib/themes.js has what a theme is). Read once when the
// page loads, before anything draws, so the dots, your dot and the map's lines
// come out in its colours; changed from Settings → Appearance.
//
// Saved with the network's settings (lib/settings.js 'theme'), so a backup, an
// export or a restore carries the look with it. localStorage keeps a copy, the
// one read before the page paints: the CSS variables are kept beside it, ready
// made, for the script in app/layout.js that puts them on the page first, so a
// theme never flashes the standard colours. Once the server answers
// (app/components/ThemeLoader.js), its look wins (lib/synced-setting.js).

import { cleanTheme, resolveTheme, themeVars, themeAttrs, isLight, TIER_COLORS, MAP_LOOK } from './themes.js';
import { saveSettings } from './settings-client.js';
import { reconcileSaved, laterSaver } from './synced-setting.js';

const KEY = 'six-degrees-theme';
export const VARS_KEY = 'six-degrees-theme-vars';
const DEFAULT = Object.freeze({ base: 'standard', custom: {} });

const listeners = new Set();
let choice = DEFAULT;

function read() {
  try { return cleanTheme(JSON.parse(localStorage.getItem(KEY) || 'null') || DEFAULT); } catch { return DEFAULT; }
}

/** The dots and the map's look, and the page's variables, for a choice. */
function apply(next) {
  const theme = resolveTheme(next);
  Object.assign(TIER_COLORS, theme.tiers);
  const light = isLight(theme);
  Object.assign(MAP_LOOK, { you: theme.you, lines: theme.lines, line: theme.line, bg: theme.bg, dots: theme.dots, light, text: light ? '#11141c' : '#ffffff' });
  if (typeof document === 'undefined') return;
  const vars = themeVars(next);
  const root = document.documentElement;
  // A light look's words and borders go when a dark one comes: they fall back to the dark values.
  for (const k of [...root.style]) if (k.startsWith('--sd-') && !(k in vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  Object.assign(root.dataset, themeAttrs(next));
  root.style.colorScheme = light ? 'light' : 'dark';
  try { localStorage.setItem(VARS_KEY, JSON.stringify({ vars, attrs: themeAttrs(next) })); } catch { /* it's applied anyway */ }
}

if (typeof window !== 'undefined') {
  choice = read();
  apply(choice);
  // Another window changed it.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    choice = read();
    apply(choice);
    listeners.forEach((f) => f());
  });
}

export const themeNow = () => choice;
export const serverTheme = () => DEFAULT;

const same = (a, b) => JSON.stringify(cleanTheme(a)) === JSON.stringify(cleanTheme(b));
const saveLater = laterSaver((theme, { now }) => saveSettings({ theme }, { keepalive: now }));
// A look picked just before a reload is saved on the way out, or the
// network's older one would replace it as the page opens again.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => saveLater.flush());

function choose(next) {
  choice = cleanTheme(next);
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* this visit only */ }
  apply(choice);
  listeners.forEach((f) => f());
}

export function setTheme(next) {
  choose(next);
  saveLater(choice);
}

/**
 * The look saved with the network (GET /api/settings 'theme'), once the page
 * has it: it replaces this browser's copy, or, when the network has none yet,
 * this browser's look is saved to it once.
 */
export function adoptSavedTheme(saved) {
  const { use: next, save, changed } = reconcileSaved({
    saved: saved == null ? null : cleanTheme(saved), cached: choice, isDefault: (t) => same(t, DEFAULT), same,
  });
  if (save) saveSettings({ theme: choice });
  if (changed) choose(next);
}

export function watchTheme(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}
