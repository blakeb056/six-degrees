// The replay of how your network was built, as numbers (Blake, 2026-10-17:
// "my recordings come at the very end and don't capture the dots individually
// showing ... slowing it down if there's a bunch of connections at once, as it
// feels like it's almost skipping"). The stage draws it
// (app/components/ReplayStage.js); everything here is pure, so it is tested.
//
// Why the old replay came at the very end: it ran the calendar in a straight
// line, first date to last. A network grows faster every year, so most people
// arrived in the last few seconds, and everyone in a scanned circle shares the
// day their connection was made, so hundreds landed in one frame. Here time is
// counted in people instead: each one has a moment of their own, in order, a
// busy day is slowed down, a quiet year passes in under a second, and a circle
// blooms round the person it came through.

import { bornTimes } from './galaxy-lab.js';

export const DAY = 86400000;
/** The speeds offered, slowest first. 1 is the paced replay as built. */
export const RATES = Object.freeze([0.25, 0.5, 1, 2, 4]);
/** You alone on screen before the first arrival, in seconds at 1x. */
export const LEAD_IN = 0.8;
/** Held at the end, so the last arrivals settle before it stops. */
export const TAIL = 1.5;
/** A replay longer than this at 1x is played faster, as far as the floors below allow. */
export const AUTO_MAX = 180;
/** One shorter than this is slowed to it, so a small network still reads. */
export const AUTO_MIN = 12;
/** However fast it is squeezed, one arrival a frame at 30 frames a second, and a circle at least this long. */
export const ARRIVAL_FLOOR = 1 / 30;
export const BLOOM_FLOOR = 0.4;
/** The longest a quiet stretch of the calendar takes. */
export const QUIET_MAX = 0.9;

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sameDay = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < DAY);

// Notable first, then the stronger, then by id: the same order every time.
const byRank = (a, b) => ((TIER_RANK[a.tier] ?? 5) - (TIER_RANK[b.tier] ?? 5))
  || ((Number(b.power_score) || 0) - (Number(a.power_score) || 0))
  || String(a.id).localeCompare(String(b.id));

/**
 * Who a person's line comes from in the replay, along the chain
 * (lib/galaxy.js galaxyChain): the bridge they came through at any step, else
 * you (`you`) for one of your connections, else nobody (`none`: the people a
 * company scan finds, whom you don't know through anyone drawn).
 */
export function lineSource(id, parentOf, none = null, you = '__center__') {
  const p = parentOf?.get(id);
  if (p != null && p !== id) return p;
  return none?.has(id) ? null : you;
}

/**
 * The order everyone appears in, one at a time. Each person has a moment
 * (lib/galaxy-lab.js bornTimes): your connections the day you connected, and
 * anyone in a circle the moment the person they came through arrived. Someone
 * with a moment of their own is an arrival, sorted by date (notable first on
 * the same day); the people who came with them ride in right after, nearest
 * first (their circle, then the circles inside it), so a circle grows round
 * its bridge. Undated people come first, before the dates begin.
 *
 * `people`: the Galaxy's nodes without you ({ id, degree, connected_date, tier,
 * power_score }); `parentOf`: id → the id they hang off.
 * Returns [{ id, t, parent, rider, group }] in order, `parent` the id they came
 * through (null for none), `rider` true for someone who came with another, and
 * `group` the arrival's index in the list of arrivals.
 */
export function replayOrder(people = [], parentOf = new Map()) {
  const born = bornTimes(people, parentOf);
  const t = new Map(people.map((p, i) => [p.id, born[i]]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const parentIn = (p) => {
    const up = parentOf.get(p.id);
    return up != null && up !== p.id && byId.has(up) ? up : null;
  };
  const kids = new Map();
  const arrivals = [];
  for (const p of people) {
    const up = parentIn(p);
    if (up != null && t.get(up) === t.get(p.id)) {
      if (!kids.has(up)) kids.set(up, []);
      kids.get(up).push(p);
    } else arrivals.push(p);
  }
  for (const list of kids.values()) list.sort(byRank);
  const out = [];
  const done = new Set();
  let groups = 0;
  const emit = (lead) => {
    const group = groups++;
    const queue = [lead];
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q];
      if (done.has(p.id)) continue;
      done.add(p.id);
      out.push({ id: p.id, t: t.get(p.id), parent: parentIn(p), rider: q > 0, group });
      for (const k of kids.get(p.id) || []) if (!done.has(k.id)) queue.push(k);
    }
  };
  const byMoment = (a, b) => (t.get(a.id) - t.get(b.id) || 0) || byRank(a, b);
  arrivals.sort((a, b) => {
    const ta = t.get(a.id), tb = t.get(b.id);
    if (ta === tb) return byRank(a, b);
    return ta < tb ? -1 : 1;
  });
  for (const a of arrivals) emit(a);
  // Riders round a loop that never reaches an arrival: each its own arrival, in date order.
  const left = people.filter((p) => !done.has(p.id)).sort(byMoment);
  for (const p of left) if (!done.has(p.id)) emit(p);
  return out;
}

/** How long a quiet stretch of `ms` on the calendar takes, in seconds at 1x: longer for longer, never over QUIET_MAX. */
export function quietGap(ms) {
  const days = Math.max(0, ms) / DAY;
  return clamp(0.06 + 0.07 * Math.log2(1 + days), 0.06, QUIET_MAX);
}

/** Each arrival's share of a busy day of `k`: slowed, but a day of thousands still ends. */
export const burstGap = (k) => clamp(1.2 / Math.sqrt(Math.max(1, k)), 1 / 60, 0.12);

/** How long a circle of `m` takes to grow round its bridge, at 1x. */
export const bloomLength = (m) => (m > 0 ? clamp(0.3 * Math.sqrt(m), BLOOM_FLOOR, 3.5) : 0);

/**
 * Fitting a replay's gaps into `target` seconds: quiet stretches give way
 * first, down to their floors, and only then the busy ones (a crowded day, a
 * circle growing), so squeezing a long replay never hurries the moments that
 * were slowed down on purpose. `busy[i]` marks a busy gap; `floor[i]` is the
 * least each gap may become. A replay under AUTO_MIN is stretched instead, up
 * to three times. Returns { gaps, quiet, busy } with the two scales used.
 */
export function fitGaps(gaps, floor, busy, target = AUTO_MAX) {
  const n = gaps.length;
  const sum = (sq, sb) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += Math.max(gaps[i] * (busy[i] ? sb : sq), Math.min(gaps[i], floor[i]));
    return t;
  };
  const scaled = (sq, sb) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.max(gaps[i] * (busy[i] ? sb : sq), Math.min(gaps[i], floor[i]));
    return { gaps: out, quiet: sq, busy: sb };
  };
  const natural = sum(1, 1);
  if (natural <= target) {
    const s = natural > 0 && natural < AUTO_MIN ? Math.min(3, AUTO_MIN / natural) : 1;
    return scaled(s, s);
  }
  // The scale in [0, 1] that brings the total to the target, the other held at `fixed`.
  const solve = (which, fixed) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const t = which === 'quiet' ? sum(mid, fixed) : sum(fixed, mid);
      if (t > target) hi = mid;
      else lo = mid;
    }
    return lo;
  };
  if (sum(0, 1) <= target) return scaled(solve('quiet', 1), 1);
  return scaled(0, solve('busy', 0));
}

/**
 * The paced timeline: every entry of replayOrder given `at`, the second it
 * appears at 1x. Between two arrivals, the calendar's gap (quietGap); inside a
 * busy day, burstGap; a circle spread over bloomLength right after its bridge.
 * Then the whole is fitted between AUTO_MIN and AUTO_MAX seconds (fitGaps),
 * never squeezing an arrival under ARRIVAL_FLOOR or a circle under
 * BLOOM_FLOOR, so however big the network, no two arrivals share a frame.
 *
 * Returns { entries, total, natural, quiet, busy, bursts }.
 */
export function pacePlan(order = [], { target = AUTO_MAX } = {}) {
  // Each arrival's busy day: how many arrivals share it.
  const leads = [];
  for (let i = 0; i < order.length; i++) if (!order[i].rider) leads.push(i);
  const dayRun = new Map();
  for (let a = 0; a < leads.length;) {
    let b = a + 1;
    while (b < leads.length && sameDay(order[leads[b]].t, order[leads[a]].t)) b++;
    for (let j = a; j < b; j++) dayRun.set(leads[j], b - a);
    a = b;
  }
  // Riders per arrival.
  const riders = new Map();
  for (const e of order) if (e.rider) riders.set(e.group, (riders.get(e.group) || 0) + 1);

  const gaps = new Float64Array(order.length);
  const floor = new Float64Array(order.length);
  const busy = new Uint8Array(order.length);
  let prevT;
  for (let i = 0; i < order.length; i++) {
    const e = order[i];
    if (e.rider) {
      const m = riders.get(e.group) || 1;
      const bloom = bloomLength(m);
      gaps[i] = bloom / m;
      floor[i] = Math.min(bloom, BLOOM_FLOOR) / m;
      busy[i] = 1;
      continue;
    }
    if (i > 0) {
      const day = sameDay(prevT, e.t);
      gaps[i] = day ? burstGap(dayRun.get(i))
        : !Number.isFinite(prevT) ? QUIET_MAX
          : Math.max(quietGap(e.t - prevT), burstGap(dayRun.get(i)));
      // A quiet stretch keeps a quarter of its beat, so a long one still reads as time passing.
      floor[i] = day ? ARRIVAL_FLOOR : Math.max(ARRIVAL_FLOOR, gaps[i] / 4);
      busy[i] = day ? 1 : 0;
    }
    prevT = e.t;
  }
  let natural = 0;
  for (const g of gaps) natural += g;
  const fitted = fitGaps(gaps, floor, busy, target);

  const entries = new Array(order.length);
  let at = LEAD_IN;
  for (let i = 0; i < order.length; i++) {
    at += fitted.gaps[i];
    entries[i] = { ...order[i], at };
  }
  const total = (entries.length ? entries[entries.length - 1].at : LEAD_IN) + TAIL;
  return { entries, total, natural, quiet: fitted.quiet, busy: fitted.busy, bursts: findBursts(entries) };
}

/**
 * The busy stretches, for the scrubber: runs of people arriving on the same
 * day (an arrival and its circle count together), at least `min` of them.
 * Returns [{ from, to, size, t }] in replay seconds.
 */
export function findBursts(entries = [], { min = 6 } = {}) {
  const out = [];
  for (let a = 0; a < entries.length;) {
    let b = a + 1;
    while (b < entries.length && sameDay(entries[b].t, entries[a].t)) b++;
    if (b - a >= min) out.push({ from: entries[a].at, to: entries[b - 1].at, size: b - a, t: entries[a].t });
    a = b;
  }
  return out;
}

/** How many have appeared by `pos`: the entries' `at`s are in order, so a binary search. */
export function countAt(entries, pos) {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].at <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The calendar at `pos`, flowing between one arrival and the next so a quiet
 * year visibly passes: null before the first dated arrival.
 */
export function calendarAt(entries, pos) {
  const n = countAt(entries, pos);
  let prev = null;
  for (let i = n - 1; i >= 0; i--) if (!entries[i].rider && Number.isFinite(entries[i].t)) { prev = entries[i]; break; }
  if (!prev) return null;
  let next = null;
  for (let i = n; i < entries.length; i++) if (!entries[i].rider && Number.isFinite(entries[i].t) && entries[i].t > prev.t) { next = entries[i]; break; }
  if (!next || next.at <= prev.at) return prev.t;
  const f = clamp((pos - prev.at) / (next.at - prev.at), 0, 1);
  return prev.t + (next.t - prev.t) * f;
}

/** Where on the replay a calendar moment falls: the first entry on or after it (a job start, a post). */
export function posOfTime(entries, t) {
  for (const e of entries) if (Number.isFinite(e.t) && e.t >= t) return e.at;
  return null;
}

/** The first arrival of each year, for the scrubber's ticks: [{ year, at }]. */
export function yearMarks(entries = []) {
  const out = [];
  let last = null;
  for (const e of entries) {
    if (e.rider || !Number.isFinite(e.t)) continue;
    const y = new Date(e.t).getUTCFullYear();
    if (y !== last) { out.push({ year: y, at: e.at }); last = y; }
  }
  return out;
}

/** The nearest offered speed to `r`. */
export function clampRate(r) {
  const v = Number(r);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return RATES.reduce((best, x) => (Math.abs(Math.log(x / v)) < Math.abs(Math.log(best / v)) ? x : best), RATES[0]);
}

/** The next speed up (`dir` 1) or down (-1), stopping at the ends. */
export function stepRate(r, dir) {
  const i = RATES.indexOf(clampRate(r));
  return RATES[clamp(i + Math.sign(dir || 0), 0, RATES.length - 1)];
}

/**
 * The replay `dtMs` of real time later at `rate`. A frame that came late
 * (a busy moment, a tab in the background) moves on by `maxMs` at most, so
 * the replay slows down rather than skipping people.
 */
export function advance(pos, dtMs, rate, total, maxMs = 100) {
  const dt = clamp(Number(dtMs) || 0, 0, maxMs) / 1000;
  return clamp(pos + dt * clampRate(rate), 0, total);
}

/** A point along the scrubber (`x` of `width`) as a place in the replay. */
export const scrubTo = (x, width, total) => (width > 0 ? clamp(x / width, 0, 1) * total : 0);

/** How long the replay lasts at `rate`, as words: "2 min 10 s", "45 s". */
export function lengthAt(total, rate = 1) {
  const s = Math.max(0, Math.round(total / clampRate(rate)));
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}

/** A clock for the scrubber: 0:42. */
export function clockText(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Gentle physics for someone riding in round their bridge: how far along the
 * way out they are `age` seconds after appearing, as a spring that overshoots a
 * little and settles (0 at the bridge, 1 at their place).
 */
export function springAt(age, { zeta = 0.62, omega = 9 } = {}) {
  if (!(age > 0)) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * age) * (Math.cos(wd * age) + ((zeta * omega) / wd) * Math.sin(wd * age));
}

/** An arrival's dash out along its line from the one they came through: eased, no overshoot. */
export function dashAt(age, length = 0.45) {
  if (!(age > 0)) return 0;
  if (age >= length) return 1;
  const f = age / length;
  return 1 - Math.pow(1 - f, 3);
}

/** How big a dot is as it pops in: from nothing, half as big again, then its size. */
export function popAt(age) {
  if (!(age > 0)) return 0;
  if (age < 0.12) return (age / 0.12) * 1.5;
  if (age < 0.5) return 1.5 - 0.5 * ((age - 0.12) / 0.38);
  return 1;
}

/**
 * A view that fits a box of the map ({ x0, y0, x1, y1 }) in a `w` by `h`
 * screen, with `pad` round it: { k, x, y } as d3's zoom has it (screen =
 * graph * k + x). `minSpan` keeps a box of a few dots from filling the screen.
 */
export function fitBox(box, w, h, { pad = 40, minSpan = 300, maxK = 2.5, minK = 0.04 } = {}) {
  if (!box || !(w > 0) || !(h > 0) || !Number.isFinite(box.x0)) return { k: 1, x: w / 2, y: h / 2 };
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const bw = Math.max(minSpan, box.x1 - box.x0), bh = Math.max(minSpan, box.y1 - box.y0);
  const k = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), minK, maxK);
  return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
}

/**
 * A view eased `f` of the way (0 to 1) from `a` to `b` in a `w` by `h` screen:
 * the zoom in proportion, so zooming feels even, and the map's point in the
 * middle of the screen moving in a straight line.
 */
export function easeView(a, b, f, w = 0, h = 0) {
  if (!a) return b;
  const t = clamp(f, 0, 1);
  const k = a.k * Math.pow(b.k / a.k, t);
  const ax = (w / 2 - a.x) / a.k, ay = (h / 2 - a.y) / a.k;
  const bx = (w / 2 - b.x) / b.k, by = (h / 2 - b.y) / b.k;
  const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
  return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
}

// The stage's state: whether it is open, playing, where it is and whether it
// is recording. Not kept anywhere: it starts closed each visit. Follows
// useSyncExternalStore's rules, a new object only when something changes.
const listeners = new Set();
let state = { open: false, playing: false, pos: 0, recording: false, seek: 0 };
let pendingRecord = null;

export const replayNow = () => state;
export function watchReplay(f) { listeners.add(f); return () => listeners.delete(f); }
export function setReplay(patch) {
  const next = { ...state, ...patch };
  if (Object.keys(patch).every((k) => Object.is(next[k], state[k]))) return;
  state = next;
  listeners.forEach((f) => f());
}

/** Open the stage and play from the start. */
export const openReplay = () => setReplay({ open: true, playing: true, pos: 0, seek: state.seek + 1 });

/** Close it: a recording under way stops and is thrown away. */
export function closeReplay() {
  if (state.recording) finishRecording(new Error('The recording was stopped before the end.'));
  setReplay({ open: false, playing: false, recording: false });
}

/**
 * Open the stage and record the replay from the start; resolves once the stage
 * has saved the video (finishRecording), rejects if it couldn't.
 */
export function requestRecording() {
  return new Promise((resolve, reject) => {
    pendingRecord?.reject(new Error('A new recording started.'));
    pendingRecord = { resolve, reject };
    setReplay({ open: true, recording: true, playing: true, pos: 0, seek: state.seek + 1 });
  });
}

/** The stage says the recording is done: saved (no error) or not. */
export function finishRecording(error = null) {
  const p = pendingRecord;
  pendingRecord = null;
  setReplay({ recording: false });
  if (!p) return;
  if (error) p.reject(error);
  else p.resolve();
}
