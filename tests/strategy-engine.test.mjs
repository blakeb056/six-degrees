// The strategy engine (experimental): position in the network, not score
// (lib/strategy-engine.js). Every person here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, betweenness, strategyEngine, strategyEngineAsync, networkStamp, whyLine, gatekeeperLine } from '../lib/strategy-engine.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;
const d1 = (id, extra = {}) => ({ id, degree: 1, profile_url: url(id), name: id, tier: 'B', ...extra });
const d2 = (bridge, who, extra = {}) => ({ id: `${bridge}-${who}`, degree: 2, source_connection_id: bridge, profile_url: url(who), name: who, tier: 'B', ...extra });
const tie = (a, b) => ({ a_url: url(a), b_url: url(b) });

/** Betweenness the slow, obvious way: every pair, every shortest path, You never an endpoint. */
function bruteBetweenness(g) {
  const n = g.keys.length;
  const nb = (v) => Array.from(g.adj.subarray(g.start[v], g.start[v + 1]));
  const bfs = (s) => {
    const dist = new Array(n).fill(-1); const sigma = new Array(n).fill(0);
    dist[s] = 0; sigma[s] = 1; const q = [s];
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      for (const w of nb(v)) {
        if (dist[w] < 0) { dist[w] = dist[v] + 1; q.push(w); }
        if (dist[w] === dist[v] + 1) sigma[w] += sigma[v];
      }
    }
    return { dist, sigma };
  };
  const all = Array.from({ length: n }, (_, s) => bfs(s));
  const bc = new Array(n).fill(0);
  for (let s = 1; s < n; s++) {
    for (let t = s + 1; t < n; t++) {
      const st = all[s];
      if (st.dist[t] < 0) continue;
      for (let v = 0; v < n; v++) {
        if (v === s || v === t) continue;
        const sv = all[s]; const vt = all[v];
        if (sv.dist[v] < 0 || vt.dist[t] < 0) continue;
        if (sv.dist[v] + vt.dist[t] === st.dist[t]) bc[v] += (sv.sigma[v] * vt.sigma[t]) / st.sigma[t];
      }
    }
  }
  const pairs = ((n - 2) * (n - 3)) / 2;
  return bc.map((x, v) => (v === 0 ? 0 : x / pairs));
}

// The fixture: Maya and Tom are scanned; Lee is your connection with no
// circle scanned yet. Maya is low tier but the only way to five people at
// three companies; Tom shares one of his two with Maya.
function fixture() {
  return [
    d1('maya', { tier: 'D' }), d1('tom', { tier: 'S' }), d1('lee', { tier: 'A' }),
    d2('maya', 'ann', { company: 'Northwind Bank' }), d2('maya', 'bo', { company: 'Northwind Bank' }),
    d2('maya', 'cy', { company: 'Bluefin Health' }), d2('maya', 'di', { company: 'Quarry Software' }),
    d2('maya', 'ed', { company: 'Quarry Software' }), d2('maya', 'fay', { company: 'Oakline Studios' }),
    d2('tom', 'fay', { company: 'Oakline Studios' }), d2('tom', 'gus', { company: 'Harbor Labs' }),
  ];
}

test('exclusive reach: the people cut off from you if they went', () => {
  const r = strategyEngine(fixture(), []);
  const maya = r.people.get(url('maya'));
  const tom = r.people.get(url('tom'));
  assert.equal(maya.status, 'measured');
  assert.equal(maya.only, 5, 'ann, bo, cy, di, ed: fay is reachable through Tom too');
  assert.equal(maya.circle, 6);
  assert.equal(maya.onlySpan.companies, 3);
  assert.equal(tom.only, 1, 'gus');
  assert.equal(r.people.get(url('fay')).only, 0);
  assert.ok(maya.leverage > tom.leverage, 'a low tier never holds a gatekeeper down');
  assert.equal(maya.rank, 1);
  assert.equal(whyLine(maya), 'Low tier, but the only bridge to 5 people at 3 companies.');
  assert.match(gatekeeperLine(maya), /^Gatekeeper · reaches 5 only through them · spans \d industr/);
});

test('a chain past the 2nd degree: exclusive reach counts everyone behind the cut', () => {
  // you – maya – ann – zed (zed found in ann's circle): Maya cuts off ann and zed, ann cuts off zed.
  const rows = [d1('maya'), d2('maya', 'ann'), { id: 'ann-zed', degree: 3, source_connection_id: 'maya-ann', profile_url: url('zed'), name: 'zed' }];
  const r = strategyEngine(rows, []);
  assert.equal(r.people.get(url('maya')).only, 2);
  assert.equal(r.people.get(url('ann')).only, 1);
  assert.equal(r.people.get(url('ann')).status, 'measured');
  assert.equal(r.people.get(url('zed')).status, 'beyond');
});

test('a tie between two of your connections is an edge, and shared reach is not exclusive', () => {
  const rows = [d1('maya'), d1('tom'), d2('maya', 'ann'), d2('tom', 'ann')];
  const g = buildGraph(rows, [tie('maya', 'tom'), tie('maya', 'nobody')]);
  assert.equal(g.edges, 5, 'you–maya, you–tom, maya–ann, tom–ann, maya–tom; a tie to someone unknown is dropped');
  const r = strategyEngine(rows, [tie('maya', 'tom')]);
  assert.equal(r.people.get(url('maya')).only, 0);
  assert.equal(r.people.get(url('maya')).gatekeeper, false);
  assert.match(whyLine(r.people.get(url('maya'))), /another way in/);
});

test('betweenness on a known small graph, You never an endpoint', () => {
  // you – a, you – b; a – x, a – y, b – y. People: a, b, x, y (n = 4, pairs = 3 per node).
  // Pairs not involving You: (a,b) via you or y: y on 1 of 2 → y 0.5; (a,x), (a,y), (b,y) direct;
  // (b,x) b–you–a–x or b–y–a–x: a on both → a 1, y on one → y 0.5; (x,y) x–a–y → a 1. So a 2, y 1.
  const rows = [d1('a'), d1('b'), d2('a', 'x'), d2('a', 'y'), d2('b', 'y')];
  const g = buildGraph(rows, []);
  const bc = betweenness(g);
  const at = (k) => bc[g.index.get(url(k))];
  const pairs = (3 * 2) / 2;
  assert.ok(Math.abs(at('a') - 2 / pairs) < 1e-12, `a = ${at('a')}`);
  assert.ok(Math.abs(at('y') - 1 / pairs) < 1e-12, `y = ${at('y')}`);
  assert.equal(at('x'), 0);
  assert.equal(at('b'), 0);
});

test('the folded leaves and shared twins give the same betweenness as every pair counted by hand', () => {
  // A random network with plenty of leaves (unscanned connections, one-circle people) and twins.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 6; round++) {
    const rows = [];
    const bridges = 4 + Math.floor(rand() * 6);
    for (let b = 0; b < bridges; b++) rows.push(d1(`b${b}`));
    for (let p = 0; p < 25; p++) {
      const k = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < k; j++) rows.push(d2(`b${Math.floor(rand() * Math.max(1, bridges - 1))}`, `p${p}`));
    }
    const ties = [];
    for (let t = 0; t < 4; t++) ties.push(tie(`b${Math.floor(rand() * bridges)}`, `b${Math.floor(rand() * bridges)}`));
    const g = buildGraph(rows, ties);
    const fast = betweenness(g);
    const slow = bruteBetweenness(g);
    for (let v = 0; v < g.keys.length; v++) {
      assert.ok(Math.abs(fast[v] - slow[v]) < 1e-9, `round ${round}, ${g.keys[v]}: ${fast[v]} vs ${slow[v]}`);
    }
  }
});

test('an unscanned connection is not enough data, never a low score', () => {
  const r = strategyEngine(fixture(), []);
  const lee = r.people.get(url('lee'));
  assert.equal(lee.status, 'unscanned');
  assert.equal(lee.leverage, null);
  assert.equal(lee.rank, null);
  assert.equal(gatekeeperLine(lee), null);
  assert.match(whyLine(lee), /^Not enough data/);
  const ann = r.people.get(url('ann'));
  assert.equal(ann.status, 'beyond');
  assert.equal(ann.leverage, null);
  assert.match(whyLine(ann), /^Not enough data/);
  assert.match(whyLine(undefined), /^Not enough data/);
});

test('an empty network is fine', () => {
  const r = strategyEngine([], []);
  assert.equal(r.people.size, 0);
  assert.equal(r.nodes, 1);
});

test('performance: a 15,000-person network in under 2 seconds', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rows = [];
  const BRIDGES = 1500;
  const COMPANIES = ['Northwind Bank', 'Bluefin Health', 'Quarry Software', 'Oakline Studios', 'Harbor Labs', 'Juniper Foods', 'Cobalt Energy', 'Meadow Realty'];
  for (let b = 0; b < BRIDGES; b++) rows.push(d1(`b${b}`, { tier: 'BCDAS'[b % 5] }));
  // 70% of bridges have a circle scanned; people sit in 1 to 4 circles, most in one.
  const scanned = Math.floor(BRIDGES * 0.7);
  for (let p = 0; p < 13500; p++) {
    const r = rand();
    const k = r < 0.55 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : 4;
    const company = COMPANIES[Math.floor(rand() * COMPANIES.length)];
    for (let j = 0; j < k; j++) rows.push(d2(`b${Math.floor(rand() * scanned)}`, `p${p}`, { company }));
  }
  const ties = [];
  for (let t = 0; t < 3000; t++) ties.push(tie(`b${Math.floor(rand() * BRIDGES)}`, `b${Math.floor(rand() * BRIDGES)}`));
  // Two seconds on a person's computer; a shared CI runner is slower and busier, so it gets more room.
  // npm test runs every file at once, so the best of three is what the engine itself costs.
  const budget = process.env.CI ? 6000 : 2000;
  let ms = Infinity;
  let r;
  for (let attempt = 0; attempt < 3 && ms >= budget; attempt++) {
    const t0 = performance.now();
    r = strategyEngine(rows, ties);
    ms = Math.min(ms, performance.now() - t0);
  }
  console.log(`strategy engine: ${r.nodes} nodes, ${r.edges} edges, ${r.measured} measured, ${Math.round(ms)} ms`);
  assert.ok(r.nodes > 15000);
  assert.ok(ms < budget, `took ${Math.round(ms)} ms`);
});

test('the async run gives the same answer, and the stamp changes only when what it reads does', async () => {
  const rows = fixture();
  const sync = strategyEngine(rows, []);
  const later = await strategyEngineAsync(rows, []);
  for (const [key, e] of sync.people) {
    const a = later.people.get(key);
    assert.equal(a.leverage, e.leverage, key);
    assert.equal(a.only, e.only, key);
    assert.ok(Math.abs(a.betweenness - e.betweenness) < 1e-12, key);
  }
  const stamp = networkStamp(rows, []);
  assert.equal(networkStamp(fixture(), []), stamp);
  assert.notEqual(networkStamp(rows, [tie('maya', 'tom')]), stamp, 'a new tie');
  const rescored = fixture().map((r) => (r.id === 'maya' ? { ...r, tier: 'C' } : r));
  assert.notEqual(networkStamp(rescored, []), stamp, 'a tier moved, so the words may change');
});
