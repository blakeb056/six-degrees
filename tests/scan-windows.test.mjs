// Scan windows (Blake, 2026-10-17), in place of the daily search limit: at most 60
// search pages a window, at most two windows a day, and a new window only 6 hours
// or more after the last one began. Every search page counts, by hand or not;
// profile pages don't. "Lift limits for this session" and Dev mode never pass them.
//
// The window is worked out the same way in two places, lib/scan-windows.js for the
// app and scripts/scrape.py scan_window for the scanner; these run both on the same
// records so the two can't disagree. Invented times only, on scratch data folders.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  WINDOW_DEFAULTS, WINDOW_RANGES, windowRules, windowsIn, scanWindow, windowWords, windowLine, windowRefusal,
} from '../lib/scan-windows.js';
import { linkedinState, linkedinUsage, readLimits, writeLimits, DEFAULT_LIMITS } from '../lib/linkedin-limits.js';
import { liftLimits, putLimitsBack, LIFT_LINE, DEV_LINE } from '../lib/limits-lift.js';
import { autoPlan } from '../lib/auto-scan.js';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';

const H = 3600;
const NOW = Date.UTC(2026, 9, 17, 16) / 1000;   // epoch seconds
const ms = (s) => s * 1000;
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-windows-'));
const write = (dir, name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value));
/** `n` search pages from `from` (epoch s), `gap` seconds apart. */
const pages = (from, n, gap = 30) => Array.from({ length: n }, (_, i) => from + i * gap);
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

afterEach(() => putLimitsBack());

// ── the maths ────────────────────────────────────────────────────────────────

test('the defaults are the ceilings: 60 a window, two a day, 6 hours apart, and a setting can only be stricter', () => {
  assert.deepEqual(WINDOW_DEFAULTS, { windowPages: 60, windowsPerDay: 2, windowGapHours: 6 });
  assert.deepEqual(WINDOW_RANGES.windowPages, { min: 1, max: 60 });
  assert.deepEqual(WINDOW_RANGES.windowsPerDay, { min: 1, max: 2 });
  assert.deepEqual(WINDOW_RANGES.windowGapHours, { min: 6, max: 24 });
  assert.deepEqual(windowRules(), { pages: 60, perDay: 2, gapSeconds: 6 * H });
  assert.deepEqual(windowRules({ windowPages: 30, windowsPerDay: 1, windowGapHours: 12 }), { pages: 30, perDay: 1, gapSeconds: 12 * H });
  // Looser than a ceiling reads as the ceiling, never past it.
  assert.deepEqual(windowRules({ windowPages: 120, windowsPerDay: 3, windowGapHours: 2 }), { pages: 60, perDay: 2, gapSeconds: 6 * H });
  assert.deepEqual(windowRules({ windowPages: 0, windowsPerDay: 1.5, windowGapHours: '8' }), { pages: 60, perDay: 2, gapSeconds: 6 * H });
});

test('a window holds 60 search pages: the 60th leaves none, and it says when the next opens', () => {
  const started = NOW - 2 * H;
  let w = scanWindow(pages(started, 34), ms(NOW));
  assert.deepEqual([w.index, w.of, w.used, w.cap, w.left, w.open, w.waiting], [1, 2, 34, 60, 26, true, false]);
  assert.equal(w.nextOpensAt, ms(started + 6 * H), 'the next window: 6 hours after this one began');
  assert.equal(windowWords(w), 'Window 1 of 2: 34 of 60');
  assert.match(windowLine(w, ms(NOW)), /^Window 1 of 2: 34 of 60 · next window opens \d{1,2}:\d{2}$/);
  w = scanWindow(pages(started, 60), ms(NOW));
  assert.deepEqual([w.used, w.left, w.full, w.waiting], [60, 0, true, true]);
  assert.match(windowRefusal(w), /^Scan window 1 of 2 is used: 60 of 60 search pages\. The next window opens /);
});

test('the 6-hour gap: a page before it is in the same window, and the first one after it opens the next', () => {
  const started = NOW - 6 * H;
  const one = pages(started, 60);
  // A page 5 h 59 min after the window began is still in it: full, nothing more.
  const before = scanWindow([...one], ms(started + 6 * H - 60));
  assert.deepEqual([before.index, before.used, before.left, before.open], [1, 60, 0, true]);
  // At 6 hours a page may open window 2.
  const at = scanWindow(one, ms(started + 6 * H));
  assert.deepEqual([at.index, at.used, at.left, at.open, at.waiting, at.nextOpensAt], [2, 0, 60, false, false, null]);
  const runs = windowsIn([...one, started + 6 * H + 5], 6 * H, NOW + 60);
  assert.deepEqual(runs.map((r) => r.used), [60, 1], 'the page at 6 h is window 2');
  // A used window that isn't full still closes when its 6 hours are over.
  const part = scanWindow(pages(started, 10), ms(started + 6 * H + 1));
  assert.deepEqual([part.index, part.used, part.left], [2, 0, 60]);
});

test('two windows a day: the third waits until the first is a day old, however long after the second', () => {
  const first = NOW - 10 * H;
  const second = NOW - 3 * H;
  const record = [...pages(first, 60), ...pages(second, 20)];
  const w = scanWindow(record, ms(NOW));
  assert.deepEqual([w.index, w.used, w.left, w.open], [2, 20, 40, true]);
  assert.equal(w.nextOpensAt, ms(first + 24 * H), 'not 6 hours after the second: a day after the first');
  // Window 2's 6 hours are over, and today's two windows are used: nothing until then.
  const later = scanWindow(record, ms(second + 6 * H + 60));
  assert.deepEqual([later.index, later.left, later.open, later.waiting], [2, 0, false, true]);
  assert.equal(later.nextOpensAt, ms(first + 24 * H));
  assert.match(windowRefusal(later), /today’s 2 windows are done/);
  // Then window 1 of the next day, a fresh 60.
  const next = scanWindow(record, ms(first + 24 * H));
  assert.deepEqual([next.index, next.left, next.waiting], [2, 60, false], 'the second of the last 24 hours, so 2 of 2');
  // So never more than 120 in any 24 hours.
  assert.ok(record.length + next.left <= 120 + 20, 'at most 60 more after a day');
});

test('a run of pages no window allowed (a record from before, by hand after the window) opens nothing', () => {
  // 283 searches in a day, as on 10/16, read as runs 6 hours apart: four of them, two too many.
  const busy = [...pages(NOW - 20 * H, 70, 60), ...pages(NOW - 13 * H, 70, 60), ...pages(NOW - 7 * H, 70, 60), ...pages(NOW - 1 * H, 73, 30)];
  const w = scanWindow(busy, ms(NOW));
  assert.equal(w.left, 0, 'nothing more today');
  assert.equal(w.waiting, true);
  assert.ok(w.index <= w.of, 'never "window 3 of 2"');
  // The next opens once two windows' starts are a day old and the stray run's 6 hours are over.
  assert.ok(w.nextOpensAt >= ms(NOW - 1 * H + 6 * H));
});

test('lifting the limits and Dev mode put the ceilings back and never pass them; the setting stricter otherwise', () => {
  const dir = scratch();
  try {
    writeLimits(dir, { windowPages: 30, windowsPerDay: 1, windowGapHours: 12 });
    assert.deepEqual([readLimits(dir).windowPages, readLimits(dir).windowsPerDay, readLimits(dir).windowGapHours], [30, 1, 12]);
    write(dir, 'linkedin-activity.json', { searches: pages(NOW - H, 30), profiles: [] });
    let st = linkedinState(dir, ms(NOW));
    assert.deepEqual([st.window.cap, st.window.of, st.searchesLeft, st.limitReached], [30, 1, 0, true], 'your 30 are used');
    liftLimits(ms(NOW));
    st = linkedinState(dir, ms(NOW));
    assert.equal(st.lifted, true);
    assert.deepEqual([st.window.cap, st.window.of, st.searchesLeft], [60, 2, 30], 'lifted: the ceiling, 60, and no more');
    putLimitsBack();
    writeLimits(dir, { dev: true }, ms(NOW));
    st = linkedinState(dir, ms(NOW));
    assert.equal(st.dev, true);
    assert.deepEqual([st.window.cap, st.window.of, st.searchesLeft], [60, 2, 30], 'Dev mode: the same ceiling');
    // Past 60 in Dev mode: still nothing.
    write(dir, 'linkedin-activity.json', { searches: pages(NOW - H, 60), profiles: [] });
    st = linkedinState(dir, ms(NOW));
    assert.deepEqual([st.searchesLeft, st.limitReached], [0, true]);
    // A file that asks for more than the ceilings reads as the ceilings, and isn't written that way.
    writeLimits(dir, { dev: false, windowPages: 200, windowsPerDay: 5, windowGapHours: 1 });
    assert.deepEqual([readLimits(dir).windowPages, readLimits(dir).windowsPerDay, readLimits(dir).windowGapHours], [30, 1, 12], 'kept what was saved');
    write(dir, 'scan-limits.json', { windowPages: 500, windowsPerDay: 9, windowGapHours: 0 });
    assert.deepEqual([readLimits(dir).windowPages, readLimits(dir).windowsPerDay, readLimits(dir).windowGapHours], [60, 2, 6]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the defaults are written only when stricter, and DEFAULT_LIMITS carries them', () => {
  const dir = scratch();
  try {
    assert.equal(DEFAULT_LIMITS.windowPages, 60);
    writeLimits(dir, { windowPages: 60, windowsPerDay: 2, windowGapHours: 6 });
    const saved = JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8'));
    for (const k of ['windowPages', 'windowsPerDay', 'windowGapHours']) assert.equal(saved[k], undefined, k);
    writeLimits(dir, { windowGapHours: 8 });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8')).windowGapHours, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the usage report and Auto scan go by the window', () => {
  const dir = scratch();
  try {
    write(dir, 'linkedin-activity.json', { searches: pages(NOW - 2 * H, 60), profiles: [] });
    const u = linkedinUsage(dir, ms(NOW));
    assert.equal(u.windowOpensAt, ms(NOW - 2 * H + 6 * H));
    for (const gone of ['leftToday', 'devCeiling', 'devLeftToday', 'ceiling', 'ceilingLeftToday', 'dayFreesAt', 'devFreesAt', 'ceilingFreesAt']) {
      assert.equal(u[gone], undefined, `${gone}: the daily limit and its ceiling are gone`);
    }
    const plan = autoPlan({ now: ms(NOW), pace: 'fast', left: u.searchesLeft, opensAt: u.windowOpensAt });
    assert.equal(plan.kind, 'stop');
    assert.equal(plan.as, 'limit');
    assert.match(plan.reason, /^The scan window is used, and the next opens at .+, so Auto scan has stopped\.$/);
    // A sitting is never more than what's left of the window.
    assert.deepEqual(autoPlan({ now: new Date(2026, 9, 17, 12).getTime(), pace: 'fast', left: 5 }), { kind: 'go', sitting: 5 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the words say the windows: the lift, Dev mode, help and the risk', () => {
  for (const line of [LIFT_LINE, DEV_LINE]) {
    assert.match(line, /60 search pages a window, two windows a day, 6 hours apart/);
    assert.doesNotMatch(line, /250|ceiling of|daily limit/);
    assert.doesNotMatch(line, /—/);
  }
  assert.doesNotMatch(src('lib/help.js'), /daily limit/);
  assert.doesNotMatch(src('lib/scan-risk.js'), /50 searches a day/);
  assert.doesNotMatch(src('lib/linkedin-limits.js'), /DEV_CEILING/);
  assert.doesNotMatch(src('scripts/scrape.py'), /DEV_CEILING|dev_ceiling_message/);
});

// ── the scanner says the same ────────────────────────────────────────────────

// The harness stands in for the scanner's count of searches; these cases want the real one.
const REAL_COUNT = `
import ast as _ast
_tree = _ast.parse(open(ns['__file__']).read())
_fns = [n for n in _tree.body if isinstance(n, _ast.FunctionDef) and n.name in ('searches_left', 'charge_linkedin')]
exec(compile(_ast.Module(body=_fns, type_ignores=[]), 'scrape.py', 'exec'), ns)
`;

/** scrape.py's own window code (through the test harness) on a scratch data folder. */
function scanner(t, script, { limits, lifted = false } = {}) {
  if (noScanner(t)) return null;
  const home = scratch();
  try {
    if (limits) write(home, 'scan-limits.json', limits);
    const env = { ...process.env, SIX_DEGREES_HOME: home, SIX_DEGREES_LIMITS_LIFTED: lifted ? '1' : '0' };
    const r = spawnSync(PYTHON, [HARNESS, SCRAPER, REAL_COUNT + script], { encoding: 'utf8', env });
    if (noPython(t, r)) return null;
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const RECORDS = {
  empty: [],
  part: pages(NOW - 2 * H, 34),
  full: pages(NOW - 2 * H, 60),
  second: [...pages(NOW - 10 * H, 60), ...pages(NOW - 3 * H, 20)],
  done: [...pages(NOW - 13 * H, 60), ...pages(NOW - 7 * H, 60)],
  stray: [...pages(NOW - 20 * H, 70, 60), ...pages(NOW - 13 * H, 70, 60), ...pages(NOW - 7 * H, 70, 60), ...pages(NOW - H, 73, 30)],
  future: [...pages(NOW - H, 10), NOW + 5 * H],
};

test('scrape.py scan_window says what lib/scan-windows.js says, record for record, setting for setting', (t) => {
  const settings = [{}, { windowPages: 30, windowsPerDay: 1, windowGapHours: 12 }, { windowPages: 500, windowsPerDay: 7, windowGapHours: 1 }];
  const r = scanner(t, `
records = ${JSON.stringify(RECORDS)}
settings = ${JSON.stringify(settings)}
out['consts'] = [ns['WINDOW_PAGES'], ns['WINDOWS_PER_DAY'], ns['WINDOW_GAP_HOURS'], ns['WINDOW_RANGES']]
out['py'] = {}
for i, limits in enumerate(settings):
    (home / 'scan-limits.json').write_text(json.dumps(limits))
    for name, rec in records.items():
        out['py'][f'{i}:{name}'] = ns['scan_window'](now=${NOW}, searches=rec)
`);
  if (!r) return;
  assert.deepEqual(r.out.consts, [60, 2, 6, { windowPages: [1, 60], windowsPerDay: [1, 2], windowGapHours: [6, 24] }]);
  settings.forEach((limits, i) => {
    for (const [name, rec] of Object.entries(RECORDS)) {
      const js = scanWindow(rec, ms(NOW), windowRules(limits));
      const py = r.out.py[`${i}:${name}`];
      const key = `${JSON.stringify(limits)} ${name}`;
      assert.deepEqual([py.index, py.of, py.used, py.cap, py.left, py.open, py.full, py.waiting, py.today],
        [js.index, js.of, js.used, js.cap, js.left, js.open, js.full, js.waiting, js.today], key);
      assert.equal(py.next_opens_at == null ? null : ms(py.next_opens_at), js.nextOpensAt, key);
      assert.equal(py.started_at == null ? null : ms(py.started_at), js.startedAt, key);
    }
  });
});

test('scrape.py: lifted or in Dev mode, the ceilings, and its words when the window stops a scan', (t) => {
  const r = scanner(t, `
out['rules'] = ns['window_rules']()
ns['LIMITS']['lifted'] = True
out['lifted'] = ns['window_rules']()
ns['LIMITS']['lifted'] = False
ns['_charge']({'searches': [], 'profiles': [], 'invites': []}, 'searches', 60, clock.t - 3600)
out['left'] = ns['searches_left']()
out['said'] = ns['budget_message']('window')
`, { limits: { windowPages: 20, windowGapHours: 8 } });
  if (!r) return;
  assert.deepEqual(r.out.rules, { pages: 20, per_day: 2, gap: 8 * H });
  assert.deepEqual(r.out.lifted, { pages: 60, per_day: 2, gap: 6 * H }, 'lifted: the ceilings, never more');
  assert.deepEqual(r.out.left, [0, 'window']);
  assert.match(r.out.said, /^Scan window 1 of 2 is used: 60 of 20 search pages\. The next window opens at .+\. The next run carries on from the same page\.$/);
  const dev = scanner(t, `
ns['_charge']({'searches': [], 'profiles': [], 'invites': []}, 'searches', 59, clock.t - 3600)
out['dev'] = ns['dev_mode']()
out['rules'] = ns['window_rules']()
out['left'] = ns['searches_left']()
`, { limits: { dev: true, devSince: 1, windowPages: 10 } });
  if (!dev) return;
  assert.equal(dev.out.dev, true);
  assert.deepEqual(dev.out.rules, { pages: 60, per_day: 2, gap: 6 * H }, 'Dev mode: the ceilings');
  assert.deepEqual(dev.out.left, [1, 'window'], 'one page of the 60 left, Dev mode or not');
});

test('the scan light and the end of a run read the scanner\'s window words', async () => {
  const { scanLight } = await import('../lib/scan-light.js');
  const line = '  Scan window 2 of 2 is used: 60 of 60 search pages. The next window opens at Sat Oct 17, 9:12 PM. The next run carries on from the same page.';
  const light = scanLight({ running: true, action: 'bridge', target: { name: 'Invented Bridge' }, log: ['Mapping the circle behind Invented Bridge…', line], mode: 'auto' }, Date.now());
  assert.equal(light.headline, 'Stopped: scan window 2 of 2 is used');
});
