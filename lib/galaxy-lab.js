// The Galaxy's physics lab (experimental): Obsidian-style sliders for the forces
// that lay the Galaxy out, and a replay of your network growing by the date you
// connected. The Filter panel writes here (GalaxyLab.js); the Galaxy reads it
// (ForceGraph.js) and changes the running layout in place, never rebuilding.
//
// Two stores: the sliders, remembered in this browser, and the replay's clock,
// which isn't. Both follow useSyncExternalStore's rules: a snapshot only changes
// when something in it does.

import { keyFor, score } from './separation.js';
import { warmthOf } from './linkedin-export.js';

const KEY = 'six-degrees-galaxy-lab';
const LAYOUTS_KEY = 'six-degrees-galaxy-layouts';

/** The layout as it has always been. Every slider is a multiple of today's value, or 0 for off. */
export const LAB_DEFAULTS = Object.freeze({
  on: true,         // always: the sliders are the Galaxy's own controls now (it was an experimental switch)
  gravity: 0,       // a pull on every dot towards you, in the middle
  rings: 1,         // how hard each tier (or degree) holds its ring; 0 lets it find its own shape
  push: 15,         // how hard dots push each other apart
  pull: 1,          // how hard each person pulls the people who came through them
  distance: 1,      // how far out those people sit
  dotSize: 1,
  lines: 1,
  sizeBy: 'power',  // 'power' (power score), 'links' (how many lines meet at them, as Obsidian sizes a note) or 'reach' (how many hang off them)
  orbit: 0,         // the whole map turning round you, in tenths of a radian a second; 0 holds still
  names: 'key',     // 'key' (you, S tier, catalysts) or 'all' (all your connections)
  branch: false,    // hovering a dot lights up its branch and dims the rest: off to start (Blake, 2026-10-02: it glitched)
  colourBy: 'tier', // 'tier', 'heat' (power as a thermal map), 'degree', 'company' or 'warmth' (from the Social tab)
  speed: 15,        // a replay's length, in seconds
  loop: false,      // start the replay again when it ends
  labels: true,     // names on the Galaxy at all: the Filter panel's switch, honoured with the lab off too
  v: 2,             // which defaults a saved setting was made under (2: the branch starts off)
});

/** The slider settings a saved layout keeps (not whether the lab is on, nor the names switch). */
const LAYOUT_KEYS = ['gravity', 'rings', 'push', 'pull', 'distance', 'orbit', 'dotSize', 'lines', 'sizeBy', 'names', 'branch', 'colourBy', 'speed', 'loop'];

/** The forces a layout sets, and the ones the Galaxy re-settles for when they change. */
export const FORCE_KEYS = ['gravity', 'rings', 'push', 'pull', 'distance'];

/**
 * Clusters, the way Obsidian draws a vault (Blake, 2026-10-03: "like obsidian
 * where it showing the nodes of the clusters all connecting back but retaining
 * a circular look but the nodes need to be a big thing"): no rings, a center
 * force strong enough to keep the whole network a round disc, each connection's
 * circle held round them by its links, everyone sized by how many lines meet at
 * them, so a connection with a scanned circle is a big hub. Someone in several
 * circles is linked to each, so they sit between those hubs and tie them together.
 */
export const CLUSTERS = Object.freeze({ gravity: 0.8, rings: 0, push: 6, pull: 6, distance: 0.15, sizeBy: 'links' });

/** What picking a layout does to the look, without being part of what makes it that layout. */
export const LAYOUT_LOOKS = Object.freeze({ rings: { lines: 1 }, orbit: { lines: 1 }, clusters: { lines: 3 } });

/**
 * Orbit, the old view, as a layout of the Galaxy (Blake, 2026-10-02: "add that as a
 * visual option instead so the person can interact with it"): every tier held hard
 * on its orbit, and each connection's circle drawn in close behind them. It's still
 * the Galaxy, so dragging and every slider work on it.
 */
export const ORBIT = Object.freeze({ gravity: 0, rings: 3, push: 6, pull: 4, distance: 0.22, sizeBy: 'power' });

/** Which layout the sliders are set to: 'rings', 'clusters', 'orbit', or null for your own. */
export function layoutOf(lab) {
  const is = (preset) => Object.entries(preset).every(([k, v]) => lab[k] === v);
  if (FORCE_KEYS.every((k) => lab[k] === LAB_DEFAULTS[k])) return 'rings';
  if (is(CLUSTERS)) return 'clusters';
  if (is(ORBIT)) return 'orbit';
  return null;
}

const listeners = new Set();
let cache = null;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    // `on` was a switch once; a setting saved back then mustn't turn the sliders off.
    // Saved before v2, the branch light-up was on by default; it starts off now.
    if (!raw || typeof raw !== 'object') return LAB_DEFAULTS;
    return { ...LAB_DEFAULTS, ...raw, ...(raw.v === LAB_DEFAULTS.v ? {} : { branch: false }), v: LAB_DEFAULTS.v, on: true };
  } catch { return LAB_DEFAULTS; }
}

export function labNow() {
  if (!cache) cache = read();
  return cache;
}

export function setLab(patch) {
  cache = patch === null ? { ...LAB_DEFAULTS, labels: labNow().labels } : { ...labNow(), ...patch, on: true };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  listeners.forEach((f) => f());
}

export function watchLab(f) {
  listeners.add(f);
  const other = (e) => { if (e.key === KEY) { cache = null; f(); } };
  window.addEventListener('storage', other);
  return () => { listeners.delete(f); window.removeEventListener('storage', other); };
}

/** What the Galaxy should use: the sliders while the lab is on, today's layout otherwise (with the names switch). */
export const effectiveLab = (lab) => (lab.on ? lab : lab.labels === LAB_DEFAULTS.labels ? LAB_DEFAULTS : { ...LAB_DEFAULTS, labels: lab.labels });

// Saved layouts: your own named slider settings, in this browser.
let layoutsCache = null;
const layoutListeners = new Set();
export function layoutsNow() {
  if (!layoutsCache) {
    try { layoutsCache = JSON.parse(localStorage.getItem(LAYOUTS_KEY) || '[]'); } catch { layoutsCache = []; }
    if (!Array.isArray(layoutsCache)) layoutsCache = [];
  }
  return layoutsCache;
}
function writeLayouts(list) {
  layoutsCache = list;
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(list)); } catch {}
  layoutListeners.forEach((f) => f());
}
export function watchLayouts(f) { layoutListeners.add(f); return () => layoutListeners.delete(f); }
export function saveLayout(name) {
  const label = String(name || '').trim().slice(0, 40);
  if (!label) return;
  const lab = labNow();
  const settings = Object.fromEntries(LAYOUT_KEYS.map((k) => [k, lab[k]]));
  writeLayouts([...layoutsNow().filter((l) => l.name !== label), { name: label, settings }]);
}
export function applyLayout(name) {
  const found = layoutsNow().find((l) => l.name === name);
  if (found) setLab(Object.fromEntries(LAYOUT_KEYS.filter((k) => k in found.settings).map((k) => [k, found.settings[k]])));
}
export function forgetLayout(name) { writeLayouts(layoutsNow().filter((l) => l.name !== name)); }

// The replay's clock. `at` is a time in ms (null: everything shows); `min` and
// `max` are the first and last dates in the network on screen, set by the Galaxy
// (both null when it has no dates, as in the sample network).
// The same store holds the lab's other passing state: what Find is looking
// for (and a count that asks the Galaxy to fly to the first match), a count
// that asks it to fit everyone on screen once it settles, and the Social tab's
// data once it's loaded.
const clockListeners = new Set();
let clock = { at: null, playing: false, min: null, max: null, of: 0, find: '', fly: 0, found: 0, fit: 0, social: undefined };
let raf = null;

export const clockNow = () => clock;

export function watchClock(f) {
  clockListeners.add(f);
  return () => clockListeners.delete(f);
}

export function setClock(patch) {
  const next = { ...clock, ...patch };
  if (Object.keys(patch).every((k) => Object.is(next[k], clock[k]))) return;
  clock = next;
  clockListeners.forEach((f) => f());
}

/** Play from where the slider is (or the start) to the last date, over the lab's replay length. */
export function play() {
  if (clock.min == null || clock.max == null || clock.max <= clock.min) return;
  const span = clock.max - clock.min;
  const REPLAY_MS = Math.max(1, Number(labNow().speed) || 15) * 1000;
  const from = clock.at == null || clock.at >= clock.max ? clock.min : clock.at;
  const started = performance.now() - ((from - clock.min) / span) * REPLAY_MS;
  setClock({ at: from, playing: true });
  const step = (now) => {
    const at = Math.min(clock.max, clock.min + ((now - started) / REPLAY_MS) * span);
    setClock({ at });
    if (at >= clock.max) {
      raf = null;
      setClock({ playing: false });
      if (labNow().loop) setTimeout(() => { if (!raf && clock.at === clock.max) { setClock({ at: clock.min }); play(); } }, 1200);
      return;
    }
    raf = requestAnimationFrame(step);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}

export function pause() {
  cancelAnimationFrame(raf);
  raf = null;
  setClock({ playing: false });
}

/** Back to everything showing. */
export function stopReplay() {
  pause();
  setClock({ at: null });
}

/**
 * When each dot appears in the replay: your connections on the day you
 * connected, and everyone in a circle with the connection whose circle it is
 * (they came with them). Undated connections are there from the start.
 * `parentOf` maps an id to the id it hangs off, as the Galaxy draws it.
 */
export function bornTimes(nodes, parentOf) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const bornOf = (n, depth = 0) => {
    if (memo.has(n.id)) return memo.get(n.id);
    let t = -Infinity;
    const p = parentOf.get(n.id);
    if (n.degree === 1 || p == null || depth > 6) {
      const own = n.connected_date ? Date.parse(n.connected_date) : NaN;
      t = Number.isNaN(own) ? -Infinity : own;
    }
    if (p != null && byId.has(p) && depth <= 6) t = Math.max(t, bornOf(byId.get(p), depth + 1));
    memo.set(n.id, t);
    return t;
  };
  return nodes.map((n) => bornOf(n));
}

/** How many hang off each dot, all the way down (not counting itself). */
export function reachCounts(nodes, parentOf) {
  const out = new Map(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) {
    let p = parentOf.get(n.id);
    for (let hops = 0; p != null && hops < 7; hops++) {
      out.set(p, (out.get(p) || 0) + 1);
      p = parentOf.get(p);
    }
  }
  return out;
}

/** The Social tab's data, loaded once: messages merged per profile, your jobs and your posts. */
let socialLoad = null;
export function loadSocial() {
  if (!socialLoad) {
    socialLoad = fetch('/api/social').then((r) => (r.ok ? r.json() : {})).then((d) => {
      setClock({ social: d.social ? mergeSocial(d.social) : null });
    }).catch(() => setClock({ social: null }));
  }
  return socialLoad;
}

/**
 * The export and the live sync together, per profile key, and the "now" warmth
 * is judged at: the newest thing the data knows, so an older export reads as it was.
 */
export function mergeSocial(social) {
  const merged = new Map();
  for (const [url, v] of Object.entries(social?.people || {})) merged.set(keyFor({ profile_url: url }), { ...v });
  for (const [url, v] of Object.entries(social?.live || {})) {
    const k = keyFor({ profile_url: url });
    const cur = merged.get(k) || { total: 0, recent: 0 };
    // The live sync's word on who wrote last counts when it's the newer news:
    // no export yet, or the conversation moved on since the export was made.
    if (v.last && (!cur.last || v.last > cur.last)) {
      cur.last = v.last;
      if (typeof v.lastFromThem === 'boolean') cur.lastFromThem = v.lastFromThem;
    }
    cur.unread = v.unread;
    cur.total = Math.max(cur.total || 0, 1);
    merged.set(k, cur);
  }
  let asOf = Math.max(social?.asOf || 0, social?.liveAt ? Date.parse(social.liveAt) || 0 : 0);
  for (const v of merged.values()) if ((v.last || 0) > asOf) asOf = v.last;
  return { merged, asOf, chapters: social?.chapters || [], posts: social?.posts?.posts || [] };
}

/** Your job starts and posts, oldest first, for the replay's timeline. */
export function milestones(social) {
  const out = [];
  for (const c of social?.chapters || []) if (Number.isFinite(c.from)) out.push({ t: c.from, kind: 'job', label: c.company });
  for (const p of social?.posts || []) if (Number.isFinite(p.t)) out.push({ t: p.t, kind: 'post', label: 'You posted' });
  return out.sort((a, b) => a.t - b.t);
}

/** Where you worked at a moment: the latest job started by then. */
export function chapterAt(social, t) {
  let at = null;
  for (const c of social?.chapters || []) if (Number.isFinite(c.from) && c.from <= t && (!at || c.from > at.from)) at = c;
  return at && (!Number.isFinite(at.to) || at.to > t) ? at : null;
}

const DEGREE_COLOURS = { 1: '#4FC3F7', 2: '#BA68C8', 3: '#FFB74D' };
const COMPANY_COLOURS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#A29BFE', '#00B894', '#FD79A8', '#74B9FF', '#E17055'];
const WARMTH_COLOURS = { warm: '#FF7043', cool: '#4FC3F7', dormant: '#8D6E63', never: '#546E7A' };
const OTHER = '#4a5568';

// Heat (Blake, 2026-10-02: "a thermal visual of power based on the dots"): a
// thermal camera's colours, cold violet through red and orange to white hot.
const HEAT_STOPS = ['#2b1b6b', '#6a1b9a', '#c2185b', '#f4511e', '#ffb300', '#fff3b0'];

/** The thermal colour at `t` (0 cold … 1 hottest). */
export function heatColour(t) {
  const x = Math.max(0, Math.min(1, Number(t) || 0)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
  const mix = (k) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f);
  return `#${[1, 3, 5].map((k) => mix(k).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Everyone's heat, 0 to 1: where their power score ranks among the people shown,
 * so the colours spread across whoever is on screen (a network of mostly B tier
 * still has its hot spots). Equal scores share a heat.
 */
export function heatOf(people = []) {
  return heatBy(people, score);
}

/** The same for anything with a value: each one's heat, 0 to 1, from where its value ranks. */
export function heatBy(items = [], valueOf = () => 0) {
  const values = [...new Set(items.map(valueOf))].sort((a, b) => a - b);
  const at = new Map(values.map((v, i) => [v, values.length > 1 ? i / (values.length - 1) : 1]));
  return (d) => at.get(valueOf(d)) ?? 0;
}
const companyKey = (c) => String(c || '').trim().toLowerCase();

/**
 * How to colour the Galaxy's dots, like Obsidian's groups: by tier (as it
 * always has), degree, company (the eight most common, the rest grey) or, with
 * the Social tab's data, how warm you are with each of your connections.
 * Returns { of(person) -> colour, legend: [[label, colour]] }.
 */
export function colourScheme(mode, people, tierColors, social) {
  if (mode === 'degree') {
    return {
      of: (d) => DEGREE_COLOURS[Math.min(d.degree || 1, 3)],
      legend: [['1st', DEGREE_COLOURS[1]], ['2nd', DEGREE_COLOURS[2]], ['3rd+', DEGREE_COLOURS[3]]],
    };
  }
  if (mode === 'company') {
    const counts = new Map();
    for (const p of people) {
      const k = companyKey(p.company);
      if (!k) continue;
      const c = counts.get(k) || { name: String(p.company).trim(), n: 0 };
      c.n += 1;
      counts.set(k, c);
    }
    const top = [...counts.entries()].filter(([, c]) => c.n > 1).sort((a, b) => b[1].n - a[1].n).slice(0, COMPANY_COLOURS.length);
    const colour = new Map(top.map(([k], i) => [k, COMPANY_COLOURS[i]]));
    return {
      of: (d) => colour.get(companyKey(d.company)) || OTHER,
      legend: [...top.map(([, c], i) => [c.name, COMPANY_COLOURS[i]]), ['Other', OTHER]],
    };
  }
  if (mode === 'heat') {
    const heat = heatOf(people);
    return {
      of: (d) => heatColour(heat(d)),
      heat,
      legend: [['Cold', heatColour(0.1)], ['Warm', heatColour(0.45)], ['Hot', heatColour(0.75)], ['Hottest', heatColour(1)]],
    };
  }
  if (mode === 'warmth' && social) {
    return {
      of: (d) => ((d.degree || 1) === 1 ? WARMTH_COLOURS[warmthOf(social.merged.get(keyFor(d)), social.asOf)] : '#2d3748'),
      legend: [['Warm', WARMTH_COLOURS.warm], ['Cool', WARMTH_COLOURS.cool], ['Dormant', WARMTH_COLOURS.dormant], ['Never messaged', WARMTH_COLOURS.never]],
    };
  }
  return { of: (d) => tierColors[d.tier] || '#666', legend: Object.entries(tierColors) };
}

/** Who Find matches: name, company, role or headline containing the text (2 letters or more). */
export function findMatches(nodes, query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return null;
  const hit = new Set();
  for (const n of nodes) {
    if ([n.name, n.company, n.role, n.headline].some((v) => v && String(v).toLowerCase().includes(q))) hit.add(n.id);
  }
  return hit;
}
