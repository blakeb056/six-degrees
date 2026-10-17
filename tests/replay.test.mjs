import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  replayOrder, pacePlan, fitGaps, findBursts, lineSource, countAt, calendarAt, posOfTime, yearMarks,
  quietGap, burstGap, bloomLength, clampRate, stepRate, advance, scrubTo, lengthAt, clockText,
  springAt, dashAt, popAt, fitBox, easeView,
  RATES, DAY, LEAD_IN, TAIL, AUTO_MAX, AUTO_MIN, ARRIVAL_FLOOR, BLOOM_FLOOR, QUIET_MAX,
  replayNow, openReplay, closeReplay, requestRecording, finishRecording, setReplay,
} from '../lib/replay.js';
import { galaxyChain } from '../lib/galaxy.js';
import { LAB_DEFAULTS } from '../lib/galaxy-lab.js';

// Invented people only.
const d1 = (id, date, tier = 'B', power = 5) => ({ id, degree: 1, connected_date: date, tier, power_score: power });
const d2 = (id, tier = 'C', power = 3) => ({ id, degree: 2, tier, power_score: power });
const T = (date) => Date.parse(date);

// ── The order everyone appears in ────────────────────────────────────────

test('order: by the day you connected, undated first, each person once', () => {
  const people = [d1('ben', '2023-07-15'), d1('ana', '2020-03-01'), d1('cy', null), d1('dot', '2021-01-01')];
  const order = replayOrder(people, new Map());
  assert.deepEqual(order.map((e) => e.id), ['cy', 'ana', 'dot', 'ben']);
  assert.equal(order[0].t, -Infinity);
  assert.equal(order[1].t, T('2020-03-01'));
  assert.ok(order.every((e) => !e.rider));
});

test('order: a circle rides in right after its bridge, nearest first, then the circles inside it', () => {
  const people = [
    d1('ana', '2020-03-01'), d1('ben', '2020-03-02'),
    d2('a1', 'D'), d2('a2', 'S'), d2('a3', 'B'),   // Ana's circle
    { id: 'a2x', degree: 2, tier: 'B' },            // in A2's circle, a step further
    d2('b1'),                                        // Ben's circle
  ];
  const parentOf = new Map([['a1', 'ana'], ['a2', 'ana'], ['a3', 'ana'], ['a2x', 'a2'], ['b1', 'ben']]);
  const order = replayOrder(people, parentOf);
  // Ana, her circle (S first: the notable arrive first), the circle inside it, then Ben and his.
  assert.deepEqual(order.map((e) => e.id), ['ana', 'a2', 'a3', 'a1', 'a2x', 'ben', 'b1']);
  assert.deepEqual(order.map((e) => e.rider), [false, true, true, true, true, false, true]);
  assert.equal(new Set(order.slice(0, 5).map((e) => e.group)).size, 1, 'Ana and everyone who came with her are one group');
  assert.notEqual(order[5].group, order[0].group);
  // Everyone after the one they came through.
  const at = new Map(order.map((e, i) => [e.id, i]));
  for (const [kid, parent] of parentOf) assert.ok(at.get(kid) > at.get(parent), `${kid} after ${parent}`);
});

test('order: someone you met through a circle and connected with later arrives on their own date, after the bridge', () => {
  const people = [d1('ana', '2020-03-01'), d2('dee'), { ...d1('fay', '2024-01-02'), unlocked_from_bridge_id: 'ana' }, d1('gus', '2022-06-01')];
  const parentOf = new Map([['dee', 'ana'], ['fay', 'ana']]);
  const order = replayOrder(people, parentOf);
  assert.deepEqual(order.map((e) => e.id), ['ana', 'dee', 'gus', 'fay']);
  assert.equal(order[3].rider, false);
  assert.equal(order[3].parent, 'ana', 'still drawn from the one they came through');
});

test('order: on the same day the notable come first, and a loop in the chain still shows everyone once', () => {
  const day = '2024-05-14';
  const order = replayOrder([d1('c', day, 'C'), d1('s', day, 'S', 9), d1('a', day, 'A', 7), d1('s2', day, 'S', 4)], new Map());
  assert.deepEqual(order.map((e) => e.id), ['s', 's2', 'a', 'c']);
  const loop = replayOrder([d2('x'), d2('y')], new Map([['x', 'y'], ['y', 'x']]));
  assert.deepEqual(loop.map((e) => e.id).sort(), ['x', 'y']);
});

// ── Pacing: bursts slow down, quiet stretches compress, nobody skips ──────

const network = ({ d1Count = 400, circles = [300, 120, 40], burstDay = '2024-05-14', burst = 60 } = {}) => {
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const start = T('2012-01-01'), end = T('2026-09-01');
  const people = [];
  const parentOf = new Map();
  for (let i = 0; i < d1Count; i++) {
    // Most of a network arrives in its last years.
    const u = Math.log(1 + rand() * (Math.E ** 3 - 1)) / 3;
    const date = i < burst ? burstDay : new Date(start + u * (end - start)).toISOString().slice(0, 10);
    people.push(d1(`p${i}`, date, 'SABCD'[i % 5], 1 + (i % 9)));
  }
  circles.forEach((size, b) => {
    for (let j = 0; j < size; j++) { const id = `c${b}-${j}`; people.push(d2(id)); parentOf.set(id, `p${burst + b}`); }
  });
  return { people, parentOf };
};

test('everyone appears at a moment of their own: no two people share a moment, and no two arrivals share a frame', () => {
  const { people, parentOf } = network();
  const plan = pacePlan(replayOrder(people, parentOf));
  assert.equal(plan.entries.length, people.length);
  for (let i = 1; i < plan.entries.length; i++) assert.ok(plan.entries[i].at > plan.entries[i - 1].at, `entry ${i} after ${i - 1}`);
  const arrivals = plan.entries.filter((e) => !e.rider);
  for (let i = 1; i < arrivals.length; i++) assert.ok(arrivals[i].at - arrivals[i - 1].at >= ARRIVAL_FLOOR - 1e-9);
  assert.equal(plan.entries[0].at, LEAD_IN, 'you alone first');
  assert.ok(Math.abs(plan.total - (plan.entries.at(-1).at + TAIL)) < 1e-9);
});

test('why it came at the very end: the calendar in a straight line put most people in the last seconds; paced, they spread out', () => {
  const { people, parentOf } = network();
  const plan = pacePlan(replayOrder(people, parentOf));
  const arrivals = plan.entries.filter((e) => !e.rider);
  const times = arrivals.map((e) => e.t);
  const min = Math.min(...times), max = Math.max(...times);
  const span = plan.total - LEAD_IN - TAIL;
  // Your connections in the last fifth of the replay: the old straight calendar, then paced.
  const linearLate = times.filter((t) => (t - min) / (max - min) > 0.8).length / times.length;
  const pacedLate = arrivals.filter((e) => (e.at - LEAD_IN) / span > 0.8).length / arrivals.length;
  assert.ok(linearLate > 0.45, `the old way, ${linearLate}`);
  assert.ok(pacedLate < 0.3, `paced, ${pacedLate}`);
  // And the most people landing in one frame of a 15-second straight replay, against the paced one at 30 a second.
  const most = (ats) => { const n = new Map(); for (const a of ats) n.set(Math.floor(a), (n.get(Math.floor(a)) || 0) + 1); return Math.max(...n.values()); };
  const all = plan.entries.map((e) => e.t).filter(Number.isFinite);
  assert.ok(most(all.map((t) => ((t - min) / (max - min)) * 15 * 12)) > 300, 'hundreds at once, the old way');
  assert.ok(most(arrivals.map((e) => e.at * 30)) === 1, 'one connection a frame at most, paced');
});

test('a busy day is slowed down and a quiet year passes in under a second', () => {
  assert.ok(quietGap(365 * DAY) < QUIET_MAX);
  assert.ok(quietGap(10 * 365 * DAY) <= QUIET_MAX);
  assert.equal(quietGap(1e6 * DAY), QUIET_MAX);
  assert.ok(quietGap(30 * DAY) > quietGap(DAY), 'longer for longer');
  assert.ok(burstGap(20) > burstGap(2000) && burstGap(2000) >= 1 / 60, 'a crowded day shares out its time, never under a frame at 60');
  // Sixty people on one day take far longer than a day of the calendar elsewhere does.
  const { people, parentOf } = network({ circles: [] });
  const plan = pacePlan(replayOrder(people, parentOf));
  const day = plan.entries.filter((e) => e.t === T('2024-05-14'));
  assert.equal(day.length, 60);
  const dayLength = day.at(-1).at - day[0].at;
  assert.ok(dayLength > 3, `the busy day lasts ${dayLength.toFixed(2)} s`);
  assert.ok(dayLength > 20 * quietGap(DAY));
});

test('a circle grows over a beat round its bridge: longer for a bigger circle, never under its floor', () => {
  assert.equal(bloomLength(0), 0);
  assert.equal(bloomLength(1), BLOOM_FLOOR);
  assert.ok(bloomLength(100) > bloomLength(10));
  assert.ok(bloomLength(100000) <= 3.5);
  const { people, parentOf } = network({ circles: [300] });
  const plan = pacePlan(replayOrder(people, parentOf));
  const circle = plan.entries.filter((e) => e.id.startsWith('c0-'));
  const bridge = plan.entries.find((e) => e.id === parentOf.get('c0-0'));
  assert.equal(circle.length, 300);
  assert.ok(circle[0].at > bridge.at, 'after their bridge');
  assert.ok(circle.at(-1).at - bridge.at >= BLOOM_FLOOR);
});

test('a long replay is fitted to a few minutes by squeezing quiet stretches first, busy ones only after', () => {
  // Fits without touching the busy part: only the quiet scale moves.
  const gaps = Float64Array.from([0.8, 0.8, 0.8, 0.1, 0.1]);
  const floor = Float64Array.from([0.2, 0.2, 0.2, 0.05, 0.05]);
  const busy = Uint8Array.from([0, 0, 0, 1, 1]);
  const a = fitGaps(gaps, floor, busy, 1.5);
  assert.equal(a.busy, 1);
  assert.ok(a.quiet < 1);
  assert.ok(Math.abs(a.gaps.reduce((s, g) => s + g, 0) - 1.5) < 1e-6);
  // Too long even with every quiet gap at its floor: then the busy ones give way.
  const b = fitGaps(gaps, floor, busy, 0.7);
  assert.equal(b.quiet, 0);
  assert.ok(b.busy < 1);
  assert.deepEqual([...b.gaps.slice(0, 3)], [0.2, 0.2, 0.2]);
  // Short ones are stretched, up to three times.
  const c = fitGaps(Float64Array.from([1, 1]), Float64Array.from([0, 0]), Uint8Array.from([0, 0]), 100);
  assert.ok(Math.abs(c.gaps[0] - Math.min(3, AUTO_MIN / 2)) < 1e-9);
  // A big network lands at AUTO_MAX.
  const big = network({ d1Count: 3000, circles: [980, 950, 500, 310, 260, 180, 175, 150, 120] });
  const plan = pacePlan(replayOrder(big.people, big.parentOf));
  assert.ok(plan.natural > AUTO_MAX);
  assert.ok(Math.abs(plan.total - (AUTO_MAX + LEAD_IN + TAIL)) < 0.5, `total ${plan.total}`);
});

test('bursts for the timeline: runs on the same day, an arrival and its circle together, small ones left out', () => {
  const e = (id, t, at, rider = false) => ({ id, t, at, rider });
  const entries = [
    e('a', T('2020-01-01'), 1), e('b', T('2020-05-01'), 2),
    ...Array.from({ length: 8 }, (_, i) => e(`x${i}`, T('2021-02-02'), 3 + i * 0.1, i > 0)),
    e('c', T('2022-01-01'), 5), e('d', T('2022-01-01'), 5.1),
  ];
  const bursts = findBursts(entries, { min: 6 });
  assert.equal(bursts.length, 1);
  assert.deepEqual({ ...bursts[0], from: +bursts[0].from.toFixed(2), to: +bursts[0].to.toFixed(2) }, { from: 3, to: 3.7, size: 8, t: T('2021-02-02') });
  const { people, parentOf } = network();
  const plan = pacePlan(replayOrder(people, parentOf));
  assert.ok(plan.bursts.some((b) => b.t === T('2024-05-14') && b.size >= 60), 'the busy day is on the timeline');
  assert.ok(plan.bursts.every((b) => b.to >= b.from && b.size >= 6));
});

// ── The line each person arrives along ───────────────────────────────────

test('each person\'s line comes from whoever they came through: you, their bridge, and so on along the chain', () => {
  const parentOf = new Map([['dee', 'ana'], ['hal', 'dee']]);
  assert.equal(lineSource('ana', parentOf), '__center__');
  assert.equal(lineSource('dee', parentOf), 'ana');
  assert.equal(lineSource('hal', parentOf), 'dee');
  assert.equal(lineSource('co', parentOf, new Set(['co'])), null, 'a company scan\'s find: no line to you');
  // With the Galaxy's own chain: a circle scanned from someone you met through one of yours.
  const rows = [
    { id: 'ana', degree: 1, profile_url: 'https://www.linkedin.com/in/ana' },
    { id: 'bo', degree: 1, profile_url: 'https://www.linkedin.com/in/bo', unlocked_from_bridge_id: 'dee' },
    { id: 'dee', degree: 2, source_connection_id: 'ana', profile_url: 'https://www.linkedin.com/in/dee' },
    { id: 'eve', degree: 2, source_connection_id: 'bo', profile_url: 'https://www.linkedin.com/in/eve' },
    { id: 'zed', degree: 3, profile_url: 'https://www.linkedin.com/in/zed' },
  ];
  const chain = galaxyChain(rows);
  assert.equal(lineSource('ana', chain.parentOf, chain.none), '__center__');
  assert.equal(lineSource('dee', chain.parentOf, chain.none), 'ana');
  assert.equal(lineSource('bo', chain.parentOf, chain.none), 'dee');
  assert.equal(lineSource('eve', chain.parentOf, chain.none), 'bo');
  assert.equal(lineSource('zed', chain.parentOf, chain.none), null);
});

// ── Speed and scrubbing ──────────────────────────────────────────────────

test('speeds from a quarter to four times, stepping and snapping to the ones offered', () => {
  assert.deepEqual([...RATES], [0.25, 0.5, 1, 2, 4]);
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(3), 4);
  assert.equal(clampRate(0.3), 0.25);
  assert.equal(clampRate('nonsense'), 1);
  assert.equal(clampRate(-2), 1);
  assert.equal(stepRate(1, 1), 2);
  assert.equal(stepRate(4, 1), 4);
  assert.equal(stepRate(0.25, -1), 0.25);
  assert.equal(stepRate(1, -1), 0.5);
});

test('playing moves on by the time passed times the speed; a late frame slows it rather than skipping', () => {
  assert.equal(advance(10, 50, 1, 100), 10.05);
  assert.equal(advance(10, 50, 4, 100), 10.2);
  assert.equal(advance(10, 50, 0.25, 100), 10.0125);
  assert.equal(advance(10, 5000, 1, 100), 10.1, 'a frame 5 s late moves on by 100 ms at most');
  assert.equal(advance(99.99, 50, 4, 100), 100, 'never past the end');
  assert.equal(advance(0, -20, 1, 100), 0);
});

test('scrubbing: a point on the timeline is a place in the replay, and the counts and the date follow it', () => {
  assert.equal(scrubTo(50, 200, 80), 20);
  assert.equal(scrubTo(-10, 200, 80), 0);
  assert.equal(scrubTo(400, 200, 80), 80);
  assert.equal(scrubTo(5, 0, 80), 0);
  const e = (id, t, at, rider = false) => ({ id, t, at, rider });
  const entries = [e('u', -Infinity, 0.8), e('a', T('2020-01-01'), 1), e('a1', T('2020-01-01'), 1.2, true), e('b', T('2022-01-01'), 3)];
  assert.equal(countAt(entries, 0), 0);
  assert.equal(countAt(entries, 1), 2);
  assert.equal(countAt(entries, 2.5), 3);
  assert.equal(countAt(entries, 99), 4);
  assert.equal(calendarAt(entries, 0.9), null, 'undated: before the dates');
  assert.equal(calendarAt(entries, 1), T('2020-01-01'));
  assert.equal(calendarAt(entries, 2), T('2020-01-01') + (T('2022-01-01') - T('2020-01-01')) / 2, 'the calendar flows between arrivals');
  assert.equal(calendarAt(entries, 5), T('2022-01-01'));
  assert.equal(posOfTime(entries, T('2021-06-01')), 3);
  assert.equal(posOfTime(entries, T('2030-01-01')), null);
  assert.deepEqual(yearMarks(entries), [{ year: 2020, at: 1 }, { year: 2022, at: 3 }]);
});

test('lengths and clocks in words', () => {
  assert.equal(lengthAt(130), '2 min 10 s');
  assert.equal(lengthAt(130, 2), '1 min 5 s');
  assert.equal(lengthAt(45), '45 s');
  assert.equal(lengthAt(120), '2 min');
  assert.equal(clockText(62.7), '1:02');
  assert.equal(clockText(-1), '0:00');
});

// ── Motion and the camera ────────────────────────────────────────────────

test('a circle springs out gently: from its bridge, a small overshoot, settled within about a second', () => {
  assert.equal(springAt(0), 0);
  let peak = 0;
  for (let t = 0; t <= 2; t += 0.01) peak = Math.max(peak, springAt(t));
  assert.ok(peak > 1 && peak < 1.12, `overshoot ${peak}`);
  assert.ok(Math.abs(springAt(1.1) - 1) < 0.02);
  assert.equal(dashAt(0), 0);
  assert.equal(dashAt(0.45), 1);
  assert.ok(dashAt(0.2) > 0.2 / 0.45, 'eases out');
  assert.equal(popAt(0), 0);
  assert.ok(popAt(0.12) > 1.4);
  assert.equal(popAt(1), 1);
});

test('the camera fits a box in the screen, and eases between two views with the zoom in proportion', () => {
  const v = fitBox({ x0: -100, y0: -50, x1: 300, y1: 150 }, 800, 600, { pad: 0, minSpan: 0, maxK: 10 });
  assert.equal(v.k, 2);
  assert.equal(v.x, 400 - 100 * 2);
  assert.equal(v.y, 300 - 50 * 2);
  const tiny = fitBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, 800, 600, { pad: 0, minSpan: 300, maxK: 10 });
  assert.equal(tiny.k, 2, 'a few dots never fill the screen');
  const a = { k: 1, x: 0, y: 0 }, b = { k: 4, x: -100, y: -50 };
  assert.deepEqual(easeView(a, b, 0, 800, 600), a);
  const end = easeView(a, b, 1, 800, 600);
  assert.ok(Math.abs(end.k - 4) < 1e-9 && Math.abs(end.x - b.x) < 1e-9 && Math.abs(end.y - b.y) < 1e-9);
  assert.ok(Math.abs(easeView(a, b, 0.5, 800, 600).k - 2) < 1e-9, 'halfway in zoom is the geometric middle');
});

// ── The stage's state ────────────────────────────────────────────────────

test('opening plays from the start; closing mid-recording throws the recording away', async () => {
  openReplay();
  assert.equal(replayNow().open, true);
  assert.equal(replayNow().playing, true);
  assert.equal(replayNow().pos, 0);
  const seek = replayNow().seek;
  openReplay();
  assert.equal(replayNow().seek, seek + 1, 'opening again starts again');
  const saved = requestRecording();
  assert.equal(replayNow().recording, true);
  finishRecording();
  await saved;
  assert.equal(replayNow().recording, false);
  const stopped = requestRecording();
  closeReplay();
  await assert.rejects(stopped, /stopped before the end/);
  assert.equal(replayNow().open, false);
  setReplay({ open: false, playing: false });
});

test('the replay\'s look is remembered with the other map settings, at 1x by each person', () => {
  assert.equal(LAB_DEFAULTS.replayRate, 1);
  assert.equal(LAB_DEFAULTS.replayView, 'person');
  assert.equal(LAB_DEFAULTS.replayColour, 'tier');
  assert.equal(LAB_DEFAULTS.replayCamera, 'whole');
});

test('a recording is the stage\'s own canvas, a frame at a time, credited, and saved on this computer', () => {
  const exp = readFileSync(new URL('../lib/galaxy-export.js', import.meta.url), 'utf8');
  assert.match(exp, /captureStream\(0\)/);
  assert.match(exp, /requestFrame\(\)/);
  assert.doesNotMatch(exp, /fetch\(/, 'nothing leaves the computer');
  const stage = readFileSync(new URL('../app/components/ReplayStage.js', import.meta.url), 'utf8');
  assert.match(stage, /fillText\(CREDIT,/);
  // One frame of the replay per frame of video, whatever the computer's pace.
  assert.match(stage, /L\.pos \+ r \/ FPS/);
});
