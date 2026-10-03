// The theme in use, in this browser (lib/themes.js has what a theme is). Read
// once when the page loads, before anything draws, so the dots, your dot and
// the map's lines come out in its colours; changed from Settings → Appearance.
//
// Kept in localStorage, like the Galaxy's sliders: a look belongs to the
// screen it's on. The CSS variables are kept beside it, ready made, for the
// script in app/layout.js that puts them on the page before it paints, so a
// theme never flashes the standard colours first.

import { cleanTheme, resolveTheme, themeVars, themeAttrs, TIER_COLORS, MAP_LOOK } from './themes.js';

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
  Object.assign(MAP_LOOK, { you: theme.you, lines: theme.lines, line: theme.line, bg: theme.bg });
  if (typeof document === 'undefined') return;
  const vars = themeVars(next);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  Object.assign(root.dataset, themeAttrs(next));
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

export function setTheme(next) {
  choice = cleanTheme(next);
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* this visit only */ }
  apply(choice);
  listeners.forEach((f) => f());
}

export function watchTheme(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}
