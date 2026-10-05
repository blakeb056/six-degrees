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
// Dark or light is the background's own: a look whose background is light
// (Daylight, or any colour you pick) turns the words, borders and
// raised surfaces dark (lightTokens). The app's colours are CSS variables
// whose fallbacks are the dark values they always had, so a dark look sets
// none of them and draws exactly as before (Blake, 2026-10-03: "id like a
// light mode").
//
// A look also has a way of drawing buttons (`buttons`, app/globals.css
// html[data-buttons]) and the map's dots (`dots`, app/components/ForceGraph.js):
// frosted glass, every look's own, or soft; solid, droplet, flat, glow or plain
// (Blake, 2026-10-05: "for the buttons lets make frost default and have soft as
// the only other option").
//
// What arrives from storage or a pasted theme code is untrusted: cleanTheme
// keeps only #rrggbb colours, the listed choices and numbers in range, so
// nothing else can reach the stylesheet.

// Tier C is green on every look (Blake, 2026-10-05: "tier c like a destiny 1 green"),
// so the tiers read as a game's rarity ladder: gold, purple, blue, green, grey.

export const BACKDROPS = ['none', 'stars', 'grid', 'glow', 'horizon'];
export const FONTS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
};
export const LINE_MODES = ['tier', 'one'];
export const BUTTONS = ['frosted', 'soft'];
export const DOTS = ['solid', 'droplet', 'flat', 'glow', 'plain'];

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
  tiers: Object.freeze({ S: '#ffd700', A: '#9b59b6', B: '#3498db', C: '#4caf63', D: '#bdc3c7' }),
  you: '#ffffff', lines: 'tier', line: '#5a6274', font: 'system', buttons: 'frosted', dots: 'solid',
});

export const THEMES = Object.freeze([
  STANDARD,
  Object.freeze({
    id: 'daylight', name: 'Daylight', blurb: 'Light, designed for it: white panels, ink text, deeper dots that read on white.',
    bg: '#f4f6fb', bg2: '#dfe5f2', backdrop: 'none', panel: '#ffffff', glass: 0.25, accent: '#2563eb',
    tiers: Object.freeze({ S: '#d99a00', A: '#8e44ad', B: '#2f80ed', C: '#2e8b46', D: '#a4afba' }),
    you: '#111827', lines: 'tier', line: '#c5cbd8', font: 'system', buttons: 'frosted', dots: 'solid',
  }),
  Object.freeze({
    id: 'contrast', name: 'High contrast', blurb: 'Pure black, the brightest dots, solid panels. Easiest to read.',
    bg: '#000000', bg2: '#000000', backdrop: 'none', panel: '#000000', glass: 0, accent: '#4cc9f0',
    tiers: Object.freeze({ S: '#ffe500', A: '#d08bff', B: '#4cc9f0', C: '#5ee07a', D: '#ffffff' }),
    you: '#ffffff', lines: 'tier', line: '#8a8a8a', font: 'system', buttons: 'frosted', dots: 'solid',
    fg: Object.freeze(['#ffffff', '#f2f2f2', '#d9d9d9', '#bdbdbd', '#a0a0a0']), ink: '255, 255, 255',
  }),
  Object.freeze({
    id: 'obsidian', name: 'Obsidian', blurb: 'Graphite and violet, grey links: the note-taking app’s graph.',
    bg: '#1e1e1e', bg2: '#262626', backdrop: 'none', panel: '#262626', glass: 0.1, accent: '#8a7cf7',
    tiers: Object.freeze({ S: '#e0c25a', A: '#a88bfa', B: '#7aa2f7', C: '#6cbf7a', D: '#c7c7c7' }),
    you: '#a88bfa', lines: 'one', line: '#5c5c5c', font: 'system', buttons: 'frosted', dots: 'flat',
    fg: Object.freeze(['#dcddde', '#bababa', '#999999', '#777777', '#5c5c5c']), ink: '220, 221, 222',
  }),
  Object.freeze({
    id: 'glass', name: 'Glass', blurb: 'Frosted panels over slow colour: a heads-up display, see-through.',
    bg: '#0b1020', bg2: '#5b21b6', backdrop: 'glow', panel: '#12121e', glass: 0.9, accent: '#7dd3fc',
    tiers: Object.freeze({ S: '#fde68a', A: '#f0abfc', B: '#7dd3fc', C: '#86efac', D: '#e2e8f0' }),
    you: '#ffffff', lines: 'tier', line: '#94a3b8', font: 'rounded', buttons: 'frosted', dots: 'droplet',
    fg: Object.freeze(['#ffffff', '#f1f4ff', '#cdd3e6', '#adb4cb', '#929ab2']), ink: '255, 255, 255',
  }),
  Object.freeze({
    id: 'space', name: 'Space', blurb: 'Your network as a star chart: deep black, a nebula, stars behind it all.',
    bg: '#04050d', bg2: '#2b1055', backdrop: 'stars', panel: '#0b0d1f', glass: 0.5, accent: '#a78bfa',
    tiers: Object.freeze({ S: '#ffd166', A: '#c77dff', B: '#4cc9f0', C: '#57cc80', D: '#6c757d' }),
    you: '#ffffff', lines: 'tier', line: '#3a3f5c', font: 'system', buttons: 'frosted', dots: 'glow',
    fg: Object.freeze(['#eef2ff', '#cdd5f0', '#9aa5c4', '#76809e', '#565f7c']), ink: '205, 218, 255',
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

// Looks that have gone, and the one each becomes. Paper went after 1.0.0 (Blake,
// 2026-10-04: "lets remove the paper ui"); whoever had it keeps a light look,
// Daylight, rather than being dropped into Standard's dark one. Analyst (light)
// and Synthwave (dark) went on 2026-10-05 ("lets remove synth wave and analyst"):
// each becomes the look of its own lightness. Their own changes on top are
// kept, their own tier colours included; a button style that has gone falls
// back to the look's own, frosted glass.
const RETIRED = Object.freeze({ paper: 'daylight', analyst: 'daylight', synthwave: 'standard' });

/**
 * A saved or pasted choice made safe: { base, custom }, where custom holds only
 * the fields that are valid and differ from nothing in particular (they are
 * your changes, kept as you made them).
 */
export function cleanTheme(raw) {
  const asked = typeof raw?.base === 'string' && Object.hasOwn(RETIRED, raw.base) ? RETIRED[raw.base] : raw?.base;
  const base = presetOf(asked).id;
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
  if (BUTTONS.includes(c.buttons)) custom.buttons = c.buttons;
  if (DOTS.includes(c.dots)) custom.dots = c.dots;
  const glass = Number(c.glass);
  if (c.glass != null && Number.isFinite(glass)) custom.glass = Math.round(Math.min(1, Math.max(0, glass)) * 100) / 100;
  return { base, custom };
}

/**
 * In lib/settings.js, so the look travels with a backup, an export and a
 * restore. null until a look is saved on this network: the browser's own
 * choice then stands and is saved once (lib/theme-store.js).
 */
export const THEME_SETTING = {
  default: null,
  parse(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A look is a preset with your own changes on top.');
    return cleanTheme(value);
  },
};

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

/** a, moved t of the way to b. */
const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;

/** How light a colour is, 0 to 1 (relative luminance). */
export function luminance(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** A light look: its background is light, whatever it's called. */
export const isLight = (theme) => luminance(theme.bg) > 0.45;

/**
 * What a light look puts on top of the dark defaults: the overlays that raise a
 * surface or draw a border turn to ink, the panels' dark wash to white, the
 * words to five steps of ink, and the app's own colours to deeper shades that
 * read as words on a light page (gold text on white disappears).
 *
 * The words are Apple's label colours (Blake, 2026-10-05: "for daylight i like it
 * but make the text actually look good and make it more apple like"): #1d1d1f,
 * then the grey of 60, 60, 67 at steps that each still pass WCAG AA (4.5:1) on
 * white frosted glass. Apple's own secondary (60% of that grey) is 3.6:1, too
 * faint for words this small, so even the faintest step here is darker:
 * #1d1d1f 16.8:1, #3a3a3f 11.3:1, #545458 7.5:1, #636369 6.0:1, #6e6e73 5.1:1 on white.
 */
function lightTokens() {
  return {
    '--sd-ink': '28, 28, 34',
    // A tier's colour as words: mixed toward this ink (color-mix with
    // var(--sd-tier-ink, <the colour>), which a dark look leaves as it is).
    '--sd-tier-ink': '#1d1d1f',
    '--sd-shade': '255, 255, 255',
    '--sd-fg-1': '#1d1d1f', '--sd-fg-2': '#3a3a3f', '--sd-fg-3': '#545458', '--sd-fg-4': '#636369', '--sd-fg-5': '#6e6e73',
    '--sd-gold': '#8a6100', '--sd-blue': '#1f63b3', '--sd-orange': '#c2410c', '--sd-green': '#0b7a47',
    '--sd-purple': '#6d3fa8', '--sd-cyan': '#0e7490', '--sd-coral': '#c2410c', '--sd-red': '#c0392b',
  };
}

/**
 * The CSS variables a choice sets on the page. Every value is built here from
 * cleaned colours and numbers, never copied from what was saved.
 */
export function themeVars(choice) {
  const t = resolveTheme(choice);
  const glass = Math.min(1, Math.max(0, Number(t.glass) || 0));
  const preset = presetOf(t.id);
  return {
    '--sd-bg': t.bg,
    '--sd-bg2': t.bg2,
    '--sd-accent': t.accent,
    // The side panels: the theme's tint, more see-through and more blurred the
    // more glass. Never clearer than about 40%: a panel full of words is
    // Apple's "regular" glass, which keeps them readable, not the clear kind.
    // A light look's panels are macOS's: white glass, 52 to 82% opaque (Daylight's 75%),
    // blurred 22 to 42 px and saturated 180%, so the map behind them shows as colour,
    // never as shapes under the words.
    '--sd-panel': isLight(t)
      ? rgba(t.panel, Math.round((0.82 - 0.3 * glass) * 100) / 100)
      : rgba(t.panel, Math.round((0.92 - 0.55 * glass) * 100) / 100),
    '--sd-panel-blur': isLight(t)
      ? `blur(${Math.round(22 + 20 * glass)}px) saturate(1.8)`
      : `blur(${Math.round(8 + 18 * glass)}px) saturate(${(1 + 0.9 * glass).toFixed(2)})`,
    // The header: clear, or glass on a glass theme.
    '--sd-header': glass >= 0.6 ? rgba(t.panel, 0.22) : 'transparent',
    '--sd-header-blur': glass >= 0.6 ? 'blur(20px) saturate(1.8)' : 'none',
    // A dark look's own words and overlays: Obsidian's greys, brighter
    // "vibrant" ones on Glass (lib/themes.js presets).
    ...(!isLight(t) && preset.fg ? Object.fromEntries(preset.fg.map((c, i) => [`--sd-fg-${i + 1}`, c])) : {}),
    ...(!isLight(t) && preset.ink ? { '--sd-ink': preset.ink } : {}),
    '--sd-font': FONTS[t.font] || FONTS.system,
    '--sd-tier-s': t.tiers.S, '--sd-tier-a': t.tiers.A, '--sd-tier-b': t.tiers.B, '--sd-tier-c': t.tiers.C, '--sd-tier-d': t.tiers.D,
    ...(isLight(t) ? lightTokens() : {}),
    // Cards, pickers, tooltips and the notch, in the look's own colour (Standard keeps the navy they always had).
    ...(t.id === 'standard' && !t.customised ? {} : isLight(t)
      ? { '--sd-surface': 'rgba(255, 255, 255, 0.97)', '--sd-card': '#ffffff' }
      : { '--sd-surface': rgba(mix(t.bg, '#ffffff', 0.06), glass >= 0.6 ? 0.82 : 0.96), '--sd-card': mix(t.bg, '#ffffff', 0.08) }),
  };
}

/** What the html element carries for the stylesheet: the theme and its backdrop. */
export function themeAttrs(choice) {
  const t = resolveTheme(choice);
  return { theme: t.id, backdrop: t.backdrop, mode: isLight(t) ? 'light' : 'dark', buttons: t.buttons, dots: t.dots };
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
export const MAP_LOOK = { you: STANDARD.you, lines: STANDARD.lines, line: STANDARD.line, bg: STANDARD.bg, dots: STANDARD.dots, light: false, text: '#ffffff' };
