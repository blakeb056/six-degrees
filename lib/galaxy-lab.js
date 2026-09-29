// The Galaxy's physics lab (experimental): Obsidian-style sliders for the forces
// that lay the Galaxy out, and a replay of your network growing by the date you
// connected. The Filter panel writes here (GalaxyLab.js); the Galaxy reads it
// (ForceGraph.js) and changes the running layout in place, never rebuilding.
//
// Two stores: the sliders, remembered in this browser, and the replay's clock,
// which isn't. Both follow useSyncExternalStore's rules: a snapshot only changes
// when something in it does.

const KEY = 'six-degrees-galaxy-lab';

/** The layout as it has always been. Every slider is a multiple of today's value, or 0 for off. */
export const LAB_DEFAULTS = Object.freeze({
  on: false,        // the lab is on: without it, the Galaxy ignores everything below
  gravity: 0,       // a pull on every dot towards you, in the middle
  rings: 1,         // how hard each tier (or degree) holds its ring; 0 lets it find its own shape
  push: 15,         // how hard dots push each other apart
  pull: 1,          // how hard each person pulls the people who came through them
  distance: 1,      // how far out those people sit
  dotSize: 1,
  lines: 1,
  sizeBy: 'power',  // 'power' (power score) or 'reach' (how many hang off them)
  names: 'key',     // 'key' (you, S tier, catalysts), 'all' (all your connections), 'none'
  branch: true,     // hovering a dot lights up its branch and dims the rest
});

/** Let the layout find its own shape: no rings, each connection's circle bunched round them. */
export const CLUSTERS = Object.freeze({ gravity: 0.25, rings: 0, push: 25, pull: 2.5, distance: 0.35, sizeBy: 'reach' });

const listeners = new Set();
let cache = null;

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw && typeof raw === 'object' ? { ...LAB_DEFAULTS, ...raw } : LAB_DEFAULTS;
  } catch { return LAB_DEFAULTS; }
}

export function labNow() {
  if (!cache) cache = read();
  return cache;
}

export function setLab(patch) {
  cache = patch === null ? { ...LAB_DEFAULTS, on: labNow().on } : { ...labNow(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  listeners.forEach((f) => f());
}

export function watchLab(f) {
  listeners.add(f);
  const other = (e) => { if (e.key === KEY) { cache = null; f(); } };
  window.addEventListener('storage', other);
  return () => { listeners.delete(f); window.removeEventListener('storage', other); };
}

/** What the Galaxy should use: the sliders while the lab is on, today's layout otherwise. */
export const effectiveLab = (lab) => (lab.on ? lab : LAB_DEFAULTS);

// The replay's clock. `at` is a time in ms (null: everything shows); `min` and
// `max` are the first and last dates in the network on screen, set by the Galaxy
// (both null when it has no dates, as in the sample network).
const REPLAY_MS = 15000;
const clockListeners = new Set();
let clock = { at: null, playing: false, min: null, max: null, shown: 0, of: 0 };
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

/** Play from where the slider is (or the start) to the last date, over 15 s. */
export function play() {
  if (clock.min == null || clock.max == null || clock.max <= clock.min) return;
  const span = clock.max - clock.min;
  const from = clock.at == null || clock.at >= clock.max ? clock.min : clock.at;
  const started = performance.now() - ((from - clock.min) / span) * REPLAY_MS;
  setClock({ at: from, playing: true });
  const step = (now) => {
    const at = Math.min(clock.max, clock.min + ((now - started) / REPLAY_MS) * span);
    setClock({ at });
    if (at >= clock.max) { raf = null; setClock({ playing: false }); return; }
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
