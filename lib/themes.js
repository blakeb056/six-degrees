// Themes: how the app looks, chosen in Settings → Appearance (Blake, 2026-10-03:
// "2 ways they can edit the back round color, dots about everything you need to
// have it custom to that person like battle field 4 does but then also have our
// own custom uis ... obsidian ... google glass ... a super analytical one ...
// space etc this is for larpers after all").
//
// Two ways: a preset (THEMES), or a preset with your own changes on top
// (`custom`, every field optional). Either comes down to a handful of CSS
// variables on the page (themeVars), a backdrop the stylesheet draws
// (app/globals.css, html[data-backdrop]), and the dot colours the map draws with
// (TIER_COLORS, a live object every view reads).
//
// Every theme is dark underneath, so the text, which is light everywhere, reads
// on all of them: a theme changes what's behind it, not the words.
//
// What arrives from storage or a pasted theme code is untrusted: cleanTheme
// keeps only #rrggbb colours, the listed choices and numbers in range, so
// nothing else can reach the stylesheet.

export const BACKDROPS = ['none', 'stars', 'grid', 'glow', 'horizon'];
export const FONTS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
};
export const LINE_MODES = ['tier', 'one'];

/**
 * A theme. `bg` is the colour behind everything, `bg2` the second colour of its
 * backdrop, `panel` the side panels' tint and `glass` how see-through and
 * blurred they are (0 solid, 1 frosted glass). `tiers` are the dots, `you` your
 * own dot, `lines` how the map's lines are coloured ('tier', as the person they
 * lead to, or 'one', all `line`).
 */
export const STANDARD = Object.freeze({
  id: 'standard', name: 'Standard', blurb: 'The original: deep navy, gold, purple and blue.',
  bg: '#0a0a1a', bg2: '#1a1440', backdrop: 'none', panel: '#0a0f1e', glass: 0.35, accent: '#3498db',
  tiers: Object.freeze({ S: '#ffd700', A: '#9b59b6', B: '#3498db', C: '#95a5a6', D: '#bdc3c7' }),
  you: '#ffffff', lines: 'tier', line: '#5a6274', font: 'system',
});

export const THEMES = Object.freeze([
  STANDARD,
  Object.freeze({
    id: 'contrast', name: 'High contrast', blurb: 'Pure black, the brightest dots, solid panels. Easiest to read.',
    bg: '#000000', bg2: '#000000', backdrop: 'none', panel: '#000000', glass: 0, accent: '#4cc9f0',
    tiers: Object.freeze({ S: '#ffe500', A: '#d08bff', B: '#4cc9f0', C: '#e6e6e6', D: '#ffffff' }),
    you: '#ffffff', lines: 'tier', line: '#8a8a8a', font: 'system',
  }),
  Object.freeze({
    id: 'obsidian', name: 'Obsidian', blurb: 'Graphite and violet, grey links: the note-taking app’s graph.',
    bg: '#1e1e1e', bg2: '#262626', backdrop: 'none', panel: '#262626', glass: 0.1, accent: '#8a7cf7',
    tiers: Object.freeze({ S: '#e0c25a', A: '#a88bfa', B: '#7aa2f7', C: '#9aa0a6', D: '#c7c7c7' }),
    you: '#a88bfa', lines: 'one', line: '#5c5c5c', font: 'system',
  }),
  Object.freeze({
    id: 'glass', name: 'Glass', blurb: 'Frosted panels over slow colour: a heads-up display, see-through.',
    bg: '#0b1020', bg2: '#5b21b6', backdrop: 'glow', panel: '#ffffff', glass: 0.9, accent: '#7dd3fc',
    tiers: Object.freeze({ S: '#fde68a', A: '#f0abfc', B: '#7dd3fc', C: '#cbd5e1', D: '#e2e8f0' }),
    you: '#ffffff', lines: 'tier', line: '#94a3b8', font: 'rounded',
  }),
  Object.freeze({
    id: 'analyst', name: 'Analyst', blurb: 'A data terminal: a grid, monospace, colour-blind-safe dots.',
    bg: '#0d1117', bg2: '#161b22', backdrop: 'grid', panel: '#161b22', glass: 0, accent: '#58a6ff',
    tiers: Object.freeze({ S: '#e69f00', A: '#cc79a7', B: '#56b4e9', C: '#009e73', D: '#8b949e' }),
    you: '#f0f6fc', lines: 'one', line: '#30363d', font: 'mono',
  }),
  Object.freeze({
    id: 'space', name: 'Space', blurb: 'Your network as a star chart: deep black, a nebula, stars behind it all.',
    bg: '#04050d', bg2: '#2b1055', backdrop: 'stars', panel: '#0b0d1f', glass: 0.5, accent: '#a78bfa',
    tiers: Object.freeze({ S: '#ffd166', A: '#c77dff', B: '#4cc9f0', C: '#adb5bd', D: '#6c757d' }),
    you: '#ffffff', lines: 'tier', line: '#3a3f5c', font: 'system',
  }),
  Object.freeze({
    id: 'synthwave', name: 'Synthwave', blurb: 'Neon on a purple horizon. For the larpers.',
    bg: '#1a0b2e', bg2: '#ff2a6d', backdrop: 'horizon', panel: '#24103f', glass: 0.4, accent: '#ff2a6d',
    tiers: Object.freeze({ S: '#ffe66d', A: '#ff2a6d', B: '#05d9e8', C: '#d1f7ff', D: '#8c7aa9' }),
    you: '#ffffff', lines: 'tier', line: '#7a3b9e', font: 'rounded',
  }),
]);

const HEX = /^#[0-9a-f]{6}$/;
const colour = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  const full = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : s;
  return HEX.test(full) ? full : null;
};
const COLOUR_KEYS = ['bg', 'bg2', 'panel', 'accent', 'you', 'line'];
export const TIER_KEYS = ['S', 'A', 'B', 'C', 'D'];

export const presetOf = (id) => THEMES.find((t) => t.id === id) || STANDARD;

/**
 * A saved or pasted choice made safe: { base, custom }, where custom holds only
 * the fields that are valid and differ from nothing in particular (they are
 * your changes, kept as you made them).
 */
export function cleanTheme(raw) {
  const base = presetOf(raw?.base).id;
  const c = raw?.custom && typeof raw.custom === 'object' ? raw.custom : {};
  const custom = {};
  for (const k of COLOUR_KEYS) { const v = colour(c[k]); if (v) custom[k] = v; }
  if (c.tiers && typeof c.tiers === 'object') {
    const tiers = {};
    for (const t of TIER_KEYS) { const v = colour(c.tiers[t]); if (v) tiers[t] = v; }
    if (Object.keys(tiers).length) custom.tiers = tiers;
  }
  if (BACKDROPS.includes(c.backdrop)) custom.backdrop = c.backdrop;
  if (Object.hasOwn(FONTS, c.font ?? '')) custom.font = c.font;
  if (LINE_MODES.includes(c.lines)) custom.lines = c.lines;
  const glass = Number(c.glass);
  if (c.glass != null && Number.isFinite(glass)) custom.glass = Math.round(Math.min(1, Math.max(0, glass)) * 100) / 100;
  return { base, custom };
}

/** The theme a choice comes to: its preset with your changes on top. */
export function resolveTheme(choice) {
  const { base, custom } = cleanTheme(choice);
  const preset = presetOf(base);
  return {
    ...preset,
    ...custom,
    tiers: { ...preset.tiers, ...(custom.tiers || {}) },
    id: base,
    customised: Object.keys(custom).length > 0,
  };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => `rgba(${rgb(hex).join(', ')}, ${a})`;

/**
 * The CSS variables a choice sets on the page. Every value is built here from
 * cleaned colours and numbers, never copied from what was saved.
 */
export function themeVars(choice) {
  const t = resolveTheme(choice);
  const glass = Math.min(1, Math.max(0, Number(t.glass) || 0));
  return {
    '--sd-bg': t.bg,
    '--sd-bg2': t.bg2,
    '--sd-accent': t.accent,
    // The side panels: the theme's tint, more see-through and more blurred the more glass.
    '--sd-panel': rgba(t.panel, Math.round((0.92 - 0.82 * glass) * 100) / 100),
    '--sd-panel-blur': `blur(${Math.round(8 + 28 * glass)}px) saturate(${(1 + 0.6 * glass).toFixed(2)})`,
    // The header: clear, or frosted on a glass theme.
    '--sd-header': glass >= 0.6 ? rgba(t.panel, 0.06) : 'transparent',
    '--sd-header-blur': glass >= 0.6 ? 'blur(18px) saturate(1.4)' : 'none',
    '--sd-font': FONTS[t.font] || FONTS.system,
    '--sd-tier-s': t.tiers.S, '--sd-tier-a': t.tiers.A, '--sd-tier-b': t.tiers.B, '--sd-tier-c': t.tiers.C, '--sd-tier-d': t.tiers.D,
  };
}

/** What the html element carries for the stylesheet: the theme and its backdrop. */
export function themeAttrs(choice) {
  const t = resolveTheme(choice);
  return { theme: t.id, backdrop: t.backdrop };
}

// A theme code to share: the choice as base64 JSON, behind a short prefix.
const PREFIX = 'sd-theme:';
export function encodeTheme(choice) {
  const json = JSON.stringify(cleanTheme(choice));
  const b64 = typeof btoa === 'function' ? btoa(json) : Buffer.from(json, 'utf8').toString('base64');
  return PREFIX + b64;
}
/** A pasted code, cleaned; null if it isn't one. */
export function decodeTheme(code) {
  const s = String(code || '').trim();
  if (!s.startsWith(PREFIX) || s.length > 2000) return null;
  try {
    const b64 = s.slice(PREFIX.length);
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    const raw = JSON.parse(json);
    return raw && typeof raw === 'object' ? cleanTheme(raw) : null;
  } catch { return null; }
}

// The dot colours every view draws with: one object, filled from the theme in
// use before anything draws (lib/theme-store.js), so the many views that read
// it stay as they are. On the server it holds Standard's.
export const TIER_COLORS = { ...STANDARD.tiers };
// The rest of what the map draws from a theme: your dot, and its lines.
export const MAP_LOOK = { you: STANDARD.you, lines: STANDARD.lines, line: STANDARD.line, bg: STANDARD.bg };
