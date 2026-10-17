'use client';

// The replay of how your network was built, on a canvas of its own over the
// Galaxy (Blake, 2026-10-17: "make it like Obsidian ... a better way of
// showing the visual, and slowing it down if there's a bunch of connections at
// once"). Each person appears on their own, in order, at their place on the
// map: your connections dash out from you along their line, and the people in
// a circle spring out round the person they came through, so circles grow
// round their bridges. Notable people (S and A) are named as they arrive.
//
// lib/replay.js holds the order, the pacing and the maths; this draws it.
// Everything is drawn in a few batched paths a frame (one per colour), so
// thirteen thousand people cost a few milliseconds. The Galaxy underneath is
// held still meanwhile (its scene's freeze), and gives every dot its place.
// A recording draws this same canvas into a video frame by frame, so the
// video is exactly the paced replay (lib/galaxy-export.js startRecorder).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as d3 from 'd3';
import {
  replayOrder, pacePlan, lineSource, calendarAt, springAt, dashAt, popAt, fitBox, easeView, advance, clampRate,
  stepRate, RATES, clockText, yearMarks, posOfTime, replayNow, watchReplay, setReplay, closeReplay, finishRecording,
} from '../../lib/replay';
import { LAB_DEFAULTS, labNow, watchLab, setLab, clockNow, watchClock, colourScheme, chapterAt, milestones } from '../../lib/galaxy-lab';
import { MAP_LOOK } from '../../lib/themes';
import { canRecord, startRecorder, saveVideo, recordReplay, CREDIT } from '../../lib/galaxy-export';

const YOU = '__center__';
const MOVE = 1.1;          // real seconds a new dot takes to reach its place
const FRESH = 1.2;         // real seconds a new dot and its line stay bright
const CAPTION = 2.6;       // real seconds a notable name is shown as they arrive
const FOLLOW = 2.5;        // real seconds of arrivals the Follow camera keeps in view
const MAX_FRESH = 700;     // new dots drawn one by one at most; older ones join the batches
const MAX_CAPTIONS = 14;
const FPS = 30;            // a recording's frames a second
const HOLD = 0.8;          // seconds a recording holds the finished map
const NOTABLE = new Set(['S', 'A']);
const NARROW = 640;        // under this wide, the stage folds its options away and moves its words clear of the edge tabs

const upTo = (at, pos) => {
  let lo = 0, hi = at.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at[m] <= pos) lo = m + 1; else hi = m; }
  return lo;
};
const countBelow = (list, k) => {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < k) lo = m + 1; else hi = m; }
  return lo;
};
const radiusOf = (d) => {
  const r = Math.max(3, Math.min(12, (Number(d.power_score) || 1) * 1.3));
  return d.degree > 1 ? Math.max(2, r * 0.75) : r;
};
const dateText = (t, narrow) => new Date(t).toLocaleDateString(undefined, narrow
  ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
  : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const reducedMotion = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false;

/** Everything the frames need about who appears when, built once per set of people on the map. */
function buildData(nodes, chain) {
  const you = nodes.find((n) => n.id === YOU) || { id: YOU, x: 0, y: 0, name: 'You' };
  const people = nodes.filter((n) => n.id !== YOU);
  const byId = new Map(people.map((n) => [n.id, n]));
  const plan = pacePlan(replayOrder(people, chain?.parentOf || new Map()));
  const E = plan.entries;
  const n = E.length;
  const index = new Map(E.map((e, i) => [e.id, i]));
  const node = E.map((e) => byId.get(e.id));
  const at = Float64Array.from(E, (e) => e.at);
  const src = new Int32Array(n);
  const rider = new Uint8Array(n);
  const notable = new Uint8Array(n);
  const r = new Float32Array(n);
  const d1Upto = new Int32Array(n + 1);
  const kids = new Map();
  const stars = [];
  for (let i = 0; i < n; i++) {
    const d = node[i];
    const s = lineSource(E[i].id, chain?.parentOf, chain?.none, YOU);
    src[i] = s == null ? -1 : s === YOU ? -2 : (index.get(s) ?? -1);
    rider[i] = E[i].rider ? 1 : 0;
    notable[i] = NOTABLE.has(d.tier) ? 1 : 0;
    r[i] = radiusOf(d);
    d1Upto[i + 1] = d1Upto[i] + ((d.degree || 1) === 1 ? 1 : 0);
    if (src[i] >= 0) { if (!kids.has(src[i])) kids.set(src[i], []); kids.get(src[i]).push(i); }
    if (d.tier === 'S') stars.push(i);
  }
  stars.sort((a, b) => (Number(node[b].power_score) || 0) - (Number(node[a].power_score) || 0));
  const kidList = new Map([...kids].map(([b, list]) => [b, Int32Array.from(list)]));
  // Each bridge's circle: the people who rode in with them (not someone who connected later on their own date).
  const circles = new Map();
  for (const [b, list] of kidList) {
    const riders = list.filter((i) => rider[i]);
    if (riders.length) circles.set(b, riders);
  }
  return {
    you, plan, entries: E, n, node, at, src, rider, notable, r, d1Upto, stars,
    kids: kidList, circles, bridges: [...circles.keys()].sort((a, b) => a - b),
    px: new Float32Array(n), py: new Float32Array(n),
    years: yearMarks(E),
  };
}

/** The dots' colours, by tier or by degree, in batches: one list of people per colour, in order. */
function paintOf(D, mode, tierColors) {
  const scheme = colourScheme(mode === 'degree' ? 'degree' : 'tier', [], tierColors || {});
  const colours = [];
  const slot = new Map();
  const bucket = new Uint8Array(D.n);
  const lists = [];
  for (let i = 0; i < D.n; i++) {
    const c = scheme.of(D.node[i]) || '#8899aa';
    if (!slot.has(c)) { slot.set(c, colours.length); colours.push(c); lists.push([]); }
    bucket[i] = slot.get(c);
    lists[bucket[i]].push(i);
  }
  return { colours, bucket, lists: lists.map((l) => Int32Array.from(l)), legend: scheme.legend };
}

/** How big a circle's bubble is with `m` of its people in it, in the map's units. */
const bubbleR = (m) => 4 + 3 * Math.sqrt(m);

/**
 * Where each circle's bubble sits, by circle: just outside the map drawn by
 * circle (everyone but the people folded into bubbles), on the line from you
 * through its bridge, then nudged apart until no two overlap, each pulled
 * gently back towards that place. Worked out once for the people on the map,
 * at each circle's full size, so a bubble grows in place.
 */
function packBubbles(D) {
  const yx = D.you.x || 0, yy = D.you.y || 0;
  // How far out the map drawn by circle reaches: nearly everyone on it, a stray or two aside.
  const far = [];
  for (let i = 0; i < D.n; i++) if (!D.rider[i] || D.kids.has(i)) far.push(Math.hypot((D.node[i].x || 0) - yx, (D.node[i].y || 0) - yy));
  far.sort((a, b) => a - b);
  const edge = far.length ? far[Math.floor(0.98 * (far.length - 1))] : 0;
  const items = D.bridges.map((b) => {
    const R = bubbleR(D.circles.get(b).length);
    const bx = D.node[b].x || 0, by = D.node[b].y || 0;
    const len = Math.hypot(bx - yx, by - yy) || 1;
    const out = Math.max(len, edge) + R + 14;
    const ax = yx + ((bx - yx) / len) * out, ay = yy + ((by - yy) / len) * out;
    return { b, R, ax, ay, x: ax, y: ay };
  });
  const rounds = items.length > 600 ? 12 : items.length > 250 ? 30 : 60;
  for (let it = 0; it < rounds; it++) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const c = items[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const need = a.R + c.R + 4;
        if (Math.abs(dx) >= need || Math.abs(dy) >= need) continue;
        const d = Math.hypot(dx, dy);
        if (d >= need) continue;
        const ux = d > 1e-6 ? dx / d : Math.cos(i + j), uy = d > 1e-6 ? dy / d : Math.sin(i + j);
        const push = (need - d) / 2;
        a.x -= ux * push; a.y -= uy * push;
        c.x += ux * push; c.y += uy * push;
      }
    }
    for (const a of items) { a.x += (a.ax - a.x) * 0.04; a.y += (a.ay - a.y) * 0.04; }
  }
  return new Map(items.map((a) => [a.b, a]));
}

/**
 * Where everyone is at this moment, and the boxes the cameras fit: everyone
 * drawn so far (Whole map), and the newest arrival with the circle growing
 * round them (Follow). By circle, each circle is a bubble beside its bridge
 * (packBubbles), growing with each one who arrives, a line back to its bridge.
 */
function place(D, pos, rate, reduced, cluster) {
  const k = upTo(D.at, pos);
  const moveLo = reduced ? k : upTo(D.at, pos - MOVE * rate);
  const you = D.you;
  const yx = you.x || 0, yy = you.y || 0;
  let x0 = yx, y0 = yy, x1 = yx, y1 = yy;
  for (let i = 0; i < k; i++) {
    const d = D.node[i];
    const tx = d.x || 0, ty = d.y || 0;
    if (!(cluster && D.rider[i] && !D.kids.has(i))) {
      if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
    }
    if (i < moveLo) { D.px[i] = tx; D.py[i] = ty; continue; }
    const s = D.src[i];
    let sx = tx, sy = ty;
    if (s >= 0 && s < i) { sx = D.px[s]; sy = D.py[s]; } else if (s === -2) { sx = yx; sy = yy; }
    const age = (pos - D.at[i]) / rate;
    const f = D.rider[i] ? springAt(age) : dashAt(age);
    D.px[i] = sx + (tx - sx) * f;
    D.py[i] = sy + (ty - sy) * f;
  }

  const discs = [];
  const discOf = new Map();
  if (cluster) {
    if (!D.bubbles) D.bubbles = packBubbles(D);
    for (const b of D.bridges) {
      if (b >= k) break;
      const m = countBelow(D.circles.get(b), k);
      if (!m) continue;
      const at = D.bubbles.get(b);
      const cx = at.x, cy = at.y, r = bubbleR(m);
      const disc = { b, m, cx, cy, r };
      discs.push(disc);
      discOf.set(b, disc);
      if (cx - r < x0) x0 = cx - r; if (cx + r > x1) x1 = cx + r; if (cy - r < y0) y0 = cy - r; if (cy + r > y1) y1 = cy + r;
    }
    discs.sort((a, b) => b.m - a.m);
  }

  // Follow: the newest arrival and everyone who has come with them so far, and where they came from;
  // a lone arrival, with the last few before it.
  let recent = null;
  if (k > 0) {
    recent = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (x, y) => { if (x < recent.x0) recent.x0 = x; if (x > recent.x1) recent.x1 = x; if (y < recent.y0) recent.y0 = y; if (y > recent.y1) recent.y1 = y; };
    const group = D.entries[k - 1].group;
    const since = pos - FOLLOW * rate;
    const take = (i) => {
      add(D.node[i].x || 0, D.node[i].y || 0);
      const s = D.src[i];
      if (s >= 0) add(D.node[s].x || 0, D.node[s].y || 0);
      else if (s === -2) add(yx, yy);
    };
    let i = k - 1;
    for (let n = 0; i >= 0 && n < 800 && D.entries[i].group === group; i--, n++) take(i);
    // A lone arrival: the few who arrived just before them too, not the circles they brought.
    if (k - 1 - i < 3) for (let n = 0; i >= 0 && n < 6 && D.at[i] >= since; i--) if (!D.rider[i]) { take(i); n++; }
  }
  return { k, all: { x0, y0, x1, y1 }, recent, discs, discOf };
}

/** One frame of the replay onto `ctx`: the map, then the date and the colours' key on top. */
function render(ctx, D, P, f) {
  const { w, h, dpr, cam, pos, rate, k, cluster, reduced, discs, discOf } = f;
  const look = MAP_LOOK;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, w, h);
  const K = cam.k;
  ctx.setTransform(dpr * K, 0, 0, dpr * K, dpr * cam.x, dpr * cam.y);
  const vx0 = -cam.x / K, vy0 = -cam.y / K, vx1 = (w - cam.x) / K, vy1 = (h - cam.y) / K;
  const yx = D.you.x || 0, yy = D.you.y || 0;
  const fresh = Math.max(reduced ? k : upTo(D.at, pos - FRESH * rate), k - MAX_FRESH);
  // In a circle, folded into it: Each circle draws the circle, not the people in it.
  const hidden = (i) => cluster && D.rider[i] === 1 && !D.kids.has(i);
  const srcX = (s) => (s === -2 ? yx : D.px[s]);
  const srcY = (s) => (s === -2 ? yy : D.py[s]);
  const lineColour = (b) => (look.lines === 'one' ? look.line : P.colours[b]);
  const lineW = Math.max(0.7 / K, 0.5 * f.lines);
  const lineAlpha = look.light ? 0.3 : 0.17;
  const dotR = (i) => Math.max(D.r[i] * f.dotSize, 0.9 / K);

  // The lines everyone came along, one path per colour.
  if (f.lines > 0) {
    ctx.lineWidth = lineW;
    ctx.globalAlpha = lineAlpha;
    for (let b = 0; b < P.lists.length; b++) {
      const list = P.lists[b];
      ctx.beginPath();
      let any = false;
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        if (i >= fresh) break;
        const s = D.src[i];
        if (s === -1 || hidden(i)) continue;
        const ax = srcX(s), ay = srcY(s), bx = D.px[i], by = D.py[i];
        if ((ax < vx0 && bx < vx0) || (ax > vx1 && bx > vx1) || (ay < vy0 && by < vy0) || (ay > vy1 && by > vy1)) continue;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        any = true;
      }
      if (any) { ctx.strokeStyle = lineColour(b); ctx.stroke(); }
    }
  }

  // Each circle: a bubble beside its bridge, growing with everyone who has come so far, a line back to the bridge.
  if (cluster) {
    ctx.lineWidth = Math.max(1 / K, lineW);
    for (const d of discs) {
      const c = P.colours[P.bucket[d.b]];
      ctx.globalAlpha = look.light ? 0.45 : 0.35;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(D.px[d.b], D.py[d.b]);
      ctx.lineTo(d.cx, d.cy);
      ctx.stroke();
    }
    ctx.lineWidth = 1.2 / K;
    for (const d of discs) {
      if (d.cx + d.r < vx0 || d.cx - d.r > vx1 || d.cy + d.r < vy0 || d.cy - d.r > vy1) continue;
      const c = P.colours[P.bucket[d.b]];
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, d.r, 0, 2 * Math.PI);
      ctx.globalAlpha = look.light ? 0.22 : 0.18;
      ctx.fillStyle = c;
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = c;
      ctx.stroke();
    }
  }

  // Everyone settled, one path per colour; under Follow a little dimmer, so the newest stand out.
  ctx.globalAlpha = f.follow ? 0.55 : 0.92;
  for (let b = 0; b < P.lists.length; b++) {
    const list = P.lists[b];
    ctx.beginPath();
    let any = false;
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      if (i >= fresh) break;
      if (hidden(i)) continue;
      const x = D.px[i], y = D.py[i], r = dotR(i);
      if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      any = true;
    }
    if (any) { ctx.fillStyle = P.colours[b]; ctx.fill(); }
  }

  // The newest: a bright line drawing out, a dot popping in, a ripple for an arrival.
  for (let i = fresh; i < k; i++) {
    const age = (pos - D.at[i]) / rate;
    const life = Math.max(0, 1 - age / FRESH);
    const c = P.colours[P.bucket[i]];
    const s = D.src[i];
    if (f.lines > 0 && s !== -1 && !hidden(i)) {
      ctx.globalAlpha = lineAlpha + (0.85 - lineAlpha) * life;
      ctx.lineWidth = lineW * (1 + 1.5 * life);
      ctx.strokeStyle = look.lines === 'one' && life < 0.05 ? look.line : c;
      ctx.beginPath();
      ctx.moveTo(srcX(s), srcY(s));
      ctx.lineTo(D.px[i], D.py[i]);
      ctx.stroke();
    }
    if (hidden(i)) {
      // By circle: a spark from the bridge into its disc, gone as it lands.
      const d = discOf.get(s);
      if (!d || reduced || age >= MOVE) continue;
      const g = dashAt(age, MOVE);
      ctx.globalAlpha = 0.9 * (1 - g);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(D.px[s] + (d.cx - D.px[s]) * g, D.py[s] + (d.cy - D.py[s]) * g, Math.max(1.6 / K, dotR(i)), 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    const r = dotR(i);
    const x = D.px[i], y = D.py[i];
    ctx.globalAlpha = reduced ? Math.min(1, age / 0.3) : 1;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r * (reduced ? 1 : Math.max(0.05, popAt(age))), 0, 2 * Math.PI);
    ctx.fill();
    if (!reduced && (!D.rider[i] || D.notable[i]) && age < FRESH) {
      const g = age / FRESH;
      ctx.globalAlpha = 0.6 * (1 - g);
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5 / K;
      ctx.beginPath();
      ctx.arc(x, y, r + (6 + 16 * g) / K, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // You, in the middle of it all.
  ctx.globalAlpha = 1;
  ctx.fillStyle = look.you || '#ffffff';
  ctx.beginPath();
  ctx.arc(yx, yy, Math.max(9, 4 / K), 0, 2 * Math.PI);
  ctx.fill();

  // Names, in screen space so they read at any zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = (x) => x * K + cam.x, sy = (y) => y * K + cam.y;
  // A name is drawn only where no other is, the first asked for winning: arrivals, then the settled.
  const boxes = [];
  const name = (text, x, y, alpha, weight = 600, size = 11.5) => {
    if (alpha <= 0.02 || !text) return false;
    ctx.font = `${weight} ${size}px ${f.font}`;
    const half = ctx.measureText(text).width / 2 + 3;
    const box = [x - half, y - 1, x + half, y + size + 2];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return false;
    boxes.push(box);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = look.bg;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = look.text;
    ctx.fillText(text, x, y);
    return true;
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (f.labels) {
    name(D.you.name || 'You', sx(yx), sy(yy) + Math.max(9, 4 / K) * K + 4, 0.9, 700);
    const taken = new Set();
    // As they arrive: the notable, newest first.
    const captionLo = upTo(D.at, pos - CAPTION * rate);
    let shown = 0;
    for (let i = k - 1; i >= captionLo && shown < MAX_CAPTIONS; i--) {
      if (!D.notable[i] || hidden(i)) continue;
      const age = (pos - D.at[i]) / rate;
      const a = reduced ? 1 : Math.min(1, age / 0.25, (CAPTION - age) / 0.6);
      const x = sx(D.px[i]), y = sy(D.py[i]) + dotR(i) * K + 4;
      if (x < -60 || x > w + 60 || y < -20 || y > h + 20) continue;
      if (name(D.node[i].name, x, y, a, 700, 12.5)) shown++;
      taken.add(i);
    }
    // Settled: the strongest S tier on screen, more of them the closer you are.
    if (!cluster) {
      const room = K < 0.35 ? 8 : K < 0.8 ? 20 : 40;
      let n = 0;
      for (const i of D.stars) {
        if (n >= room) break;
        if (i >= k || taken.has(i) || hidden(i)) continue;
        const x = sx(D.px[i]), y = sy(D.py[i]) + dotR(i) * K + 3;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        if (name(D.node[i].name, x, y, 0.75, 600, 11)) n++;
      }
    } else {
      for (const d of discs.slice(0, 24)) {
        if (taken.has(d.b)) continue;
        const x = sx(d.cx), y = sy(d.cy) + d.r * K + 3;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        name(`${D.node[d.b].name} · ${d.m.toLocaleString()}`, x, y, 0.85, 600, 11);
      }
    }
  }

  // The date and how many so far, top left (the header's notch hangs over the middle,
  // and on a narrow screen the edge tabs over the top corners, so it starts lower there),
  // the colours' key beside or under it, and a busy moment says it is slowed down.
  const narrow = w < NARROW;
  const top0 = narrow ? 46 : 12;
  const t = calendarAt(D.entries, pos);
  const n1 = D.d1Upto[k], all1 = D.d1Upto[D.n];
  const job = t != null ? chapterAt(f.social, t) : null;
  const when = t == null ? (k ? 'Before the dates' : 'You') : dateText(t, narrow);
  const parts = [when, narrow ? `${n1.toLocaleString()} connections` : `${n1.toLocaleString()} of ${all1.toLocaleString()} connections`];
  if (k > n1) parts.push(`${k.toLocaleString()} people`);
  if (job && !narrow) parts.push(`at ${job.company}`);
  const stamp = parts.join(' · ');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `650 ${narrow ? 12 : 14}px ${f.font}`;
  const tw = ctx.measureText(stamp).width;
  const ph = narrow ? 26 : 30;
  const left = 12;
  ctx.globalAlpha = 1;
  ctx.fillStyle = look.light ? 'rgba(255,255,255,0.92)' : 'rgba(10,15,30,0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, top0, tw + 28, ph, ph / 2); else ctx.rect(left, top0, tw + 28, ph);
  ctx.fill();
  ctx.fillStyle = look.text;
  ctx.fillText(stamp, left + 14, top0 + ph / 2 + 0.5);

  // The key beside the date when there's room, else under it, clear of the Filters tab on the left edge.
  ctx.font = `500 11px ${f.font}`;
  const keyWidth = P.legend.reduce((sum, [label]) => sum + 22 + ctx.measureText(label).width, 0);
  const inline = left + tw + 28 + 16 + keyWidth < w / 2 - 80;
  let lx = inline ? left + tw + 28 + 14 : 64;
  const ly = inline ? top0 + ph / 2 + 0.5 : top0 + ph + 14;
  for (const [label, colour] of P.legend) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(lx + 4, ly, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = look.text;
    ctx.fillText(label, lx + 12, ly + 0.5);
    lx += 22 + ctx.measureText(label).width;
  }

  const burst = f.burst;
  if (burst) {
    ctx.font = `600 ${narrow ? 10.5 : 11.5}px ${f.font}`;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = look.light ? '#1d4ed8' : '#8fc9f5';
    const many = burst.size.toLocaleString();
    ctx.fillText(Number.isFinite(burst.t)
      ? `${many} at once on ${dateText(burst.t, false)}: slowed so each one shows`
      : `${many} with no date come first, one at a time`, 64, inline ? top0 + ph + 14 : ly + 20);
  }
  ctx.globalAlpha = 1;
}

/**
 * The replay's stage. Mounted with the Galaxy (ForceGraph.js), drawn only
 * while open (lib/replay.js openReplay, from the Physics panel's Replay).
 * `sceneRef` is the Galaxy's scene: its simulation's nodes give everyone's
 * place, and its freeze holds the map still underneath.
 */
export default function ReplayStage({ sceneRef, chain, tierColors }) {
  const rs = useSyncExternalStore(watchReplay, replayNow, replayNow);
  if (!rs.open) return null;
  return <Stage sceneRef={sceneRef} chain={chain} tierColors={tierColors} />;
}

const chip = (on) => ({
  padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
  border: on ? '1px solid color-mix(in srgb, var(--sd-accent, #3498db) 65%, transparent)' : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
  background: on ? 'color-mix(in srgb, var(--sd-accent, #3498db) 20%, transparent)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.04)',
  color: on ? 'var(--sd-fg-1, #e6edf5)' : 'var(--sd-fg-3, #9aa6b2)',
});

function Group({ label, value, options, onPick }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sd-fg-4, #6c7886)', marginRight: 2 }}>{label}</span>
      {options.map(([v, text, hint]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} title={hint} onClick={() => onPick(v)} style={chip(value === v)}>{text}</button>
      ))}
    </div>
  );
}

const RATE_TEXT = { 0.25: '¼×', 0.5: '½×', 1: '1×', 2: '2×', 4: '4×' };

function Stage({ sceneRef, chain, tierColors }) {
  const rs = useSyncExternalStore(watchReplay, replayNow, replayNow);
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  const social = useSyncExternalStore(watchClock, () => clockNow().social, () => undefined);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const barRef = useRef(null);
  const playRef = useRef(null);
  // What the frames keep between them; never read while rendering.
  const live = useRef({
    data: null, nodes: null, paint: null, paintKey: '', pos: 0, cam: null, free: false, snap: true, dirty: true, settled: false,
    last: 0, size: null, rec: null, frozen: null, uiAt: 0, ended: 0, seek: -1,
  });
  const props = useRef({ chain, tierColors, lab, rs, social });
  useEffect(() => {
    props.current = { chain, tierColors, lab, rs, social };
    // Anything the picture is drawn from changed: draw it again, even paused.
    live.current.dirty = true;
  });
  const [ui, setUi] = useState({ pos: 0, free: false });
  const [data, setData] = useState(null);   // the people as built, for the scrubber's marks
  const [narrow, setNarrow] = useState(false);
  // How far the stage runs past the bottom of the window (a phone's map does), so the controls sit above it.
  const [below, setBelow] = useState(0);
  const [opts, setOpts] = useState(null);   // the options row, folded away on a narrow screen until asked for
  const rate = clampRate(lab.replayRate);
  const camMode = lab.replayCamera === 'follow' ? 'follow' : 'whole';
  const recordable = useSyncExternalStore(() => () => {}, canRecord, () => false);
  const total = data?.plan.total || 0;

  const seekTo = (pos) => {
    const L = live.current;
    L.pos = Math.max(0, Math.min(total, pos));
    L.snap = !L.free;
    L.dirty = true;
    setUi((u) => ({ ...u, pos: L.pos }));
  };
  const togglePlay = () => {
    if (rs.recording) return;
    const L = live.current;
    if (!rs.playing && L.pos >= total - 0.05) { L.pos = 0; L.snap = true; L.dirty = true; }
    setReplay({ playing: !rs.playing });
  };
  const pickCamera = (v) => {
    live.current.free = false;
    live.current.snap = false;
    setUi((u) => ({ ...u, free: false }));
    setLab({ replayCamera: v });
  };
  const stopRecording = () => { if (live.current.rec) live.current.rec.stop = true; };

  // Opened: the play button has the focus, so Space plays and pauses, and Esc
  // closes a panel left open first (its own Esc), then the replay.
  useEffect(() => { playRef.current?.focus({ preventScroll: true }); }, []);

  // The frames.
  useEffect(() => {
    const L = live.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const font = getComputedStyle(wrap).fontFamily || 'system-ui, sans-serif';
    const resize = () => {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      L.size = { w, h, dpr };
      L.snap = true;
      L.dirty = true;
      setNarrow(w < NARROW);
      measureBelow();
    };
    const measureBelow = () => {
      const under = Math.max(0, Math.round(wrap.getBoundingClientRect().bottom - window.innerHeight));
      if (under !== L.below) { L.below = under; L.dirty = true; setBelow(under); }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener('resize', measureBelow);
    window.addEventListener('scroll', measureBelow, { passive: true, capture: true });

    // Wheel, drag and pinch move the camera by hand; picking a camera again hands it back.
    const zoom = d3.zoom().scaleExtent([0.03, 6]).on('zoom', (e) => {
      if (!e.sourceEvent) return;
      L.cam = { k: e.transform.k, x: e.transform.x, y: e.transform.y };
      L.dirty = true;
      if (!L.free) { L.free = true; setUi((u) => ({ ...u, free: true })); }
    });
    const sel = d3.select(canvas).call(zoom).on('dblclick.zoom', null);

    // The Galaxy holds still underneath while this plays, unless a focus already holds it.
    const holdStill = (scene) => {
      if (!scene || L.frozen === scene) return;
      if (wrap.parentElement?.classList.contains('cf-on')) return;
      scene.freeze?.(true);
      L.frozen = scene;
    };

    let raf = 0;
    const startRecording = () => {
      try {
        const { w, h } = L.size;
        const scale = Math.min(2, 1920 / w, 1920 / h);
        const rw = Math.max(2, Math.round((w * scale) / 2) * 2), rh = Math.max(2, Math.round((h * scale) / 2) * 2);
        const rc = document.createElement('canvas');
        rc.width = rw;
        rc.height = rh;
        L.rec = { canvas: rc, ctx: rc.getContext('2d'), recorder: startRecorder(rc, FPS), last: 0, held: 0, stop: false, saving: false };
        L.pos = 0;
        L.snap = true;
      } catch (e) {
        L.rec = null;
        finishRecording(e);
        setReplay({ playing: false });
      }
    };
    const endRecording = async (keep) => {
      const rec = L.rec;
      if (!rec || rec.saving) return;
      rec.saving = true;
      try {
        const out = await rec.recorder.stop();
        if (keep) { saveVideo(out.blob, out.ext); finishRecording(); } else finishRecording(new Error('The recording was stopped before the end.'));
      } catch (e) { finishRecording(e); }
      if (L.rec === rec) L.rec = null;
      setReplay({ playing: false });
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const { chain: ch, tierColors: tc, lab: lb, rs: st, social: so } = props.current;
      // A new start (openReplay, or a recording): from where the store says, the camera handed back.
      if (st.seek !== L.seek) {
        L.seek = st.seek;
        L.pos = st.pos;
        L.snap = true;
        L.dirty = true;
        if (L.free) { L.free = false; setUi((u) => ({ ...u, free: false })); }
      }
      const scene = sceneRef.current;
      const nodes = scene?.simulation?.nodes?.();
      if (nodes && nodes !== L.nodes && nodes.length) {
        L.nodes = nodes;
        L.data = buildData(nodes, ch);
        L.paintKey = '';
        L.pos = Math.min(L.pos, L.data.plan.total);
        L.snap = true;
        L.dirty = true;
        setData(L.data);
      }
      holdStill(scene);
      const D = L.data;
      if (!D || !L.size) { L.last = now; return; }
      const r = clampRate(lb.replayRate);
      const key = `${lb.replayColour}|${tc ? Object.values(tc).join() : ''}|${MAP_LOOK.lines}|${MAP_LOOK.line}|${MAP_LOOK.bg}|${MAP_LOOK.text}`;
      if (key !== L.paintKey) { L.paintKey = key; L.paint = paintOf(D, lb.replayColour, tc); L.dirty = true; }
      const total = D.plan.total;
      const reduced = reducedMotion();

      // Time: a recording steps one frame of the replay per frame of video, whatever
      // the computer's pace, so the video never skips; playing on screen follows the clock.
      const dt = L.last ? now - L.last : 0;
      L.last = now;
      if (st.recording && !L.rec) startRecording();
      const rec = L.rec;
      if (rec) {
        if (rec.saving) return;
        if (now - rec.last < 1000 / FPS - 2) return;
        rec.last = now;
        if (L.pos >= total || rec.stop) {
          rec.held += 1 / FPS;
          if (rec.held >= HOLD || rec.stop) { endRecording(true); }
        } else L.pos = Math.min(total, L.pos + r / FPS);
      } else if (st.playing) {
        L.pos = advance(L.pos, dt, r, total);
        if (L.pos >= total) {
          if (!L.ended) L.ended = now;
          if (!lb.loop) { setReplay({ playing: false }); L.ended = 0; }
          else if (now - L.ended > 1200) { L.pos = 0; L.ended = 0; L.snap = true; }
        }
      }

      // Paused and still: nothing to draw again.
      if (!st.playing && !rec && !L.dirty && L.settled) return;

      // Everyone's place, then the camera. A video has no controls over it, so it uses the whole height.
      const { w, h, dpr } = L.size;
      const cluster = lb.replayView === 'cluster';
      const placed = place(D, L.pos, r, reduced, cluster);
      const top = w < NARROW ? 112 : 80;
      const bottom = rec ? 24 : (barRef.current?.offsetHeight || 90) + 16 + (L.below || 0);
      L.settled = true;
      if (!L.free) {
        const mode = lb.replayCamera === 'follow' ? 'follow' : 'whole';
        const box = mode === 'follow' && placed.recent ? placed.recent : mode === 'follow' && L.followBox ? L.followBox : placed.all;
        if (mode === 'follow' && placed.recent) L.followBox = placed.recent;
        const v = fitBox(box, w, Math.max(80, h - top - bottom), mode === 'follow'
          ? { pad: 50, minSpan: 260, maxK: 2.2 } : { pad: 40, minSpan: 320, maxK: 1.6 });
        const target = { k: v.k, x: v.x, y: v.y + top };
        const tau = mode === 'follow' ? 0.45 : 0.7;
        L.cam = L.snap || reduced || !L.cam ? target : easeView(L.cam, target, 1 - Math.exp(-(rec ? 1000 / FPS : Math.min(dt, 100)) / 1000 / tau), w, h);
        L.settled = Math.abs(L.cam.k / target.k - 1) < 1e-3 && Math.abs(L.cam.x - target.x) < 0.5 && Math.abs(L.cam.y - target.y) < 0.5;
        canvas.__zoom = d3.zoomIdentity.translate(L.cam.x, L.cam.y).scale(L.cam.k);
      }
      L.snap = false;
      L.dirty = false;
      const burst = D.plan.bursts.find((b) => L.pos >= b.from && L.pos <= b.to + 0.4 * r && b.size >= 12) || null;
      render(ctx, D, L.paint, {
        w, h, dpr, cam: L.cam, pos: L.pos, rate: r, k: placed.k, reduced, font, burst, discs: placed.discs, discOf: placed.discOf,
        follow: lb.replayCamera === 'follow' && !L.free,
        cluster, labels: lb.labels !== false, lines: lb.lines ?? 1, dotSize: lb.dotSize ?? 1, social: so,
      });
      if (rec) {
        rec.ctx.drawImage(canvas, 0, 0, rec.canvas.width, rec.canvas.height);
        // The credit, as on every picture (lib/galaxy-export.js CREDIT).
        const s = rec.canvas.width / w;
        rec.ctx.save();
        rec.ctx.scale(s, s);
        rec.ctx.font = `11px ${font}`;
        rec.ctx.textAlign = 'right';
        rec.ctx.textBaseline = 'alphabetic';
        rec.ctx.fillStyle = MAP_LOOK.light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
        rec.ctx.fillText(CREDIT, w - 16, h - 16);
        rec.ctx.restore();
        rec.recorder.frame();
      }
      if (now - L.uiAt > 120 || !st.playing) {
        L.uiAt = now;
        setUi((u) => (Math.abs(u.pos - L.pos) < 1e-3 ? u : { ...u, pos: L.pos }));
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measureBelow);
      window.removeEventListener('scroll', measureBelow, { capture: true });
      sel.on('.zoom', null);
      if (L.rec) { const rec = L.rec; L.rec = null; rec.recorder.cancel(); finishRecording(new Error('The recording was stopped before the end.')); }
      if (L.frozen) { L.frozen.freeze?.(false); L.frozen = null; }
      // Gone with the map (another view, another page): closed, so it doesn't open again on the way back.
      if (!wrap.isConnected) setReplay({ open: false, playing: false });
    };
  }, [sceneRef]);

  // Space plays and pauses, the arrows move along, Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      const typing = (tag === 'INPUT' && e.target.type !== 'range') || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape') { e.preventDefault(); closeReplay(); return; }
      if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (tag === 'INPUT') return;   // the scrubber moves itself
        e.preventDefault();
        seekTo(live.current.pos + (e.key === 'ArrowRight' ? 3 : -3));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });


  const showOpts = opts ?? !narrow;
  // The scrubber's marks change only with the people, so they aren't redrawn as it plays.
  const strip = useMemo(() => {
    const D = data;
    if (!D || !total) return { bursts: [], marks: [], years: [] };
    const at = (v) => `${(v / total) * 100}%`;
    const years = [];
    for (const y of D.years) if (!years.length || (y.at - years.at(-1).at) / total > (narrow ? 0.12 : 0.07)) years.push(y);
    return {
      bursts: D.plan.bursts.map((b) => ({ key: `${b.from}-${b.size}`, size: b.size, left: at(b.from), width: at(b.to - b.from) })),
      marks: milestones(social).map((m) => ({ ...m, at: posOfTime(D.entries, m.t) })).filter((m) => m.at != null).map((m) => ({ ...m, left: at(m.at) })),
      years: years.map((y) => ({ year: y.year, left: at(y.at) })),
    };
  }, [data, total, social, narrow]);

  return (
    <div ref={wrapRef} role="region" aria-label="Replay of your network growing" style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'var(--sd-page, #0a0a1a)', fontFamily: 'var(--sd-font, system-ui, sans-serif)', overflow: 'hidden' }}>
      <canvas ref={canvasRef} aria-label="Your network appearing one person at a time" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }} />
      {data && data.n === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sd-fg-3, #9aa6b2)', fontSize: 13, pointerEvents: 'none' }}>
          No one on the map to replay.
        </div>
      )}
      <button type="button" onClick={closeReplay} aria-label="Close the replay" title="Close the replay (Esc)" style={{
        position: 'absolute', top: narrow ? 46 : 12, right: 12, width: 30, height: 30, borderRadius: 15, cursor: 'pointer', fontSize: 16, lineHeight: 1,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)', background: 'var(--sd-surface, rgba(10,15,30,0.85))', color: 'var(--sd-fg-2, #c8d2dc)',
      }}>×</button>

      <div ref={barRef} className="replay-bar" style={{
        position: 'absolute', left: narrow ? 8 : 16, right: narrow ? 8 : 16, bottom: (narrow ? 8 : 14) + below, padding: narrow ? '8px 10px' : '10px 14px',
        borderRadius: 14, border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)', background: 'var(--sd-surface, rgba(10,15,30,0.88))',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', boxShadow: '0 12px 32px -12px rgba(0,0,0,0.45)', color: 'var(--sd-fg-2, #c8d2dc)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button ref={playRef} type="button" onClick={togglePlay} disabled={rs.recording} aria-label={rs.playing ? 'Pause' : 'Play'} style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: 17, cursor: rs.recording ? 'default' : 'pointer', fontSize: 13, fontWeight: 700,
            border: '1px solid color-mix(in srgb, var(--sd-accent, #3498db) 65%, transparent)',
            background: 'color-mix(in srgb, var(--sd-accent, #3498db) 22%, transparent)', color: 'var(--sd-fg-1, #e6edf5)',
          }}>{rs.playing ? '❚❚' : '▶'}</button>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, height: 34 }}>
            {/* The busy stretches (a crowded day, a circle growing) and the years, along the replay. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: 8, right: 8, top: 2, height: 12, pointerEvents: 'none' }}>
              {strip.bursts.map((b) => (
                <span key={b.key} style={{
                  position: 'absolute', left: b.left, width: `max(2px, ${b.width})`, bottom: 0,
                  height: `${Math.min(100, 28 + 16 * Math.log2(b.size / 6 + 1))}%`, borderRadius: 1,
                  background: 'var(--sd-accent, #3498db)', opacity: 0.5,
                }} />
              ))}
              {strip.marks.map((m) => (
                <span key={`${m.kind}-${m.t}`} style={{
                  position: 'absolute', left: m.left, width: m.kind === 'job' ? 3 : 2, height: m.kind === 'job' ? 12 : 8, bottom: 0,
                  transform: 'translateX(-50%)', borderRadius: 1, background: m.kind === 'job' ? '#D4AF37' : '#74B9FF',
                }} />
              ))}
            </div>
            <input type="range" min={0} max={total || 1} step={0.01} value={Math.min(ui.pos, total || 1)} aria-label="Where in the replay"
              aria-valuetext={`${clockText(ui.pos / rate)} of ${clockText(total / rate)}`}
              onChange={(e) => seekTo(Number(e.target.value))}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', margin: 0, accentColor: 'var(--sd-accent, #3498db)' }} />
            <div aria-hidden="true" style={{ position: 'absolute', left: 8, right: 8, top: -11, height: 10, pointerEvents: 'none', fontSize: 9, color: 'var(--sd-fg-4, #6c7886)', fontVariantNumeric: 'tabular-nums' }}>
              {strip.years.map((y) => <span key={y.year} style={{ position: 'absolute', left: y.left, transform: 'translateX(-50%)' }}>{y.year}</span>)}
            </div>
          </div>
          <span style={{ flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--sd-fg-3, #9aa6b2)' }}>
            {clockText(ui.pos / rate)} / {clockText(total / rate)}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', marginTop: 8 }}>
          <Group label="Speed" value={rate} options={RATES.map((v) => [v, RATE_TEXT[v], `${v}× speed`])} onPick={(v) => setLab({ replayRate: v })} />
          {showOpts && (
            <>
              <Group label="Show" value={lab.replayView === 'cluster' ? 'cluster' : 'person'} onPick={(v) => setLab({ replayView: v })} options={[
                ['person', 'Each person', 'Every person as a dot, with a line to who they came through'],
                ['cluster', 'Each circle', 'Each circle on the map as one bubble beside its bridge, growing as its people arrive'],
              ]} />
              <Group label="Colour" value={lab.replayColour === 'degree' ? 'degree' : 'tier'} onPick={(v) => setLab({ replayColour: v })} options={[
                ['tier', 'Tier', 'S to D'], ['degree', 'Degree', '1st, 2nd, 3rd'],
              ]} />
              <Group label="Camera" value={ui.free ? null : camMode} onPick={pickCamera} options={[
                ['whole', 'Whole map', 'Everyone so far, zooming out as it grows'],
                ['follow', 'Follow', 'Close on whoever is arriving'],
              ]} />
              <Group label="Names" value={lab.labels !== false} onPick={(v) => setLab({ labels: v })} options={[[true, 'On'], [false, 'Off']]} />
            </>
          )}
          {narrow && (
            <button type="button" onClick={() => setOpts(!showOpts)} aria-expanded={showOpts} style={chip(false)}>{showOpts ? 'Fewer options' : 'Options'}</button>
          )}
          <span style={{ flex: 1 }} />
          {recordable && (rs.recording ? (
            <button type="button" onClick={stopRecording} title="Stop here and save what's recorded" style={{ ...chip(true), borderColor: 'rgba(231,76,60,0.6)', background: 'rgba(231,76,60,0.16)' }}>■ Stop and save</button>
          ) : (
            <button type="button" onClick={() => recordReplay().catch(() => {})}
              title="Record the replay from the start as a video, at this speed. It saves on this computer." style={{ ...chip(false), color: 'var(--sd-fg-2, #f5b7b1)' }}>● Record</button>
          ))}
        </div>
      </div>
      {rs.recording && (
        <div role="status" style={{ position: 'absolute', top: narrow ? 49 : 15, right: 52, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(231,76,60,0.85)' }}>
          ● Recording
        </div>
      )}
    </div>
  );
}
