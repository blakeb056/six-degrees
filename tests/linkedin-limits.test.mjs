// The one daily limit and the cooldown lock, as the Scan page reads them. The
// scanner writes the same files, and its own Python is run on them here so the
// two can't disagree about what the limit is or what's left of it.
//
// Blake, 2026-10-05: "we need to simplify this and allow more usage as it's
// constrained too much. Just a simple default limit for the day and a button
// to lift restrictions for this session."
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  usage, readLimits, writeLimits, readCooldown, linkedinState, sessionLift, DEFAULT_LIMITS, DAILY_RANGE,
  validDaily, budgetFileProblem, mergeTimes, mergeBudgetFiles,
} from '../lib/linkedin-limits.js';
import { liftLimits, putLimitsBack, liftedAt, liftEnded } from '../lib/limits-lift.js';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixdeg-limits-'));
const write = (dir, name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value));
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

// Every test starts with the limits on: the lift is this process's memory.
afterEach(() => putLimitsBack());

/** Run scrape.py's own functions (lifted out of the file, nothing else of it) and print `expr`. */
function scanner(t, dir, expr, { lifted = false, args = [] } = {}) {
  const lift = `
import ast, json, os, sys, time
from datetime import datetime
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
want = {'_home', '_read_activity', 'linkedin_usage', 'search_limits', 'searches_left', 'profiles_left',
        'limits_lifted', '_write_json_atomic', 'read_cooldown', '_cooldown_on_file'}
consts = {'DEFAULT_DAILY_SEARCHES', 'DAILY_MAX', 'LIMITS', 'DAY_SECONDS', 'INVITE_DAY_CAP'}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in want)
        or (isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in consts for x in n.targets))]
ns = {'json': json, 'os': os, 'Path': Path, 'time': time, 'datetime': datetime, 'sys': sys}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
argv = sys.argv[2:]
print(json.dumps(eval(${JSON.stringify(expr)}, ns, {'argv': argv})))
`;
  const env = { ...process.env, SIX_DEGREES_HOME: dir, SIX_DEGREES_LIMITS_LIFTED: lifted ? '1' : '0' };
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER, ...args], { encoding: 'utf8', env });
  if (noPython(t, r)) return undefined;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('usage counts the last 24 hours: searches, profile views, and Auto\'s requests a day and a week', () => {
  const dir = scratch();
  const now = Date.UTC(2026, 8, 24, 12);
  const s = (hoursAgo) => now / 1000 - hoursAgo * 3600;
  write(dir, 'linkedin-activity.json', {
    searches: [s(1), s(5), s(23), s(25), s(24 * 20), s(24 * 30)],
    profiles: [s(2), s(30)],
    invites: [s(3), s(30), s(24 * 8)],
  });
  assert.deepEqual(usage(dir, now), { searchesToday: 3, profilesToday: 1, invitesToday: 1, invitesWeek: 2 });
  rmSync(dir, { recursive: true, force: true });
});

test('a damaged record reads as the day used up, never as nothing searched', () => {
  const dir = scratch();
  writeFileSync(path.join(dir, 'linkedin-activity.json'), '{"searches": [1, 2');
  const st = linkedinState(dir);
  assert.equal(st.leftToday, 0);
  assert.equal(st.profilesLeftToday, 0, 'profile views too, as the scanner reads it');
  assert.equal(st.limitReached, true);
  assert.equal(st.unreadable, true);
  rmSync(dir, { recursive: true, force: true });
});

test('one limit: searches a day, 50 by default, any whole number from 1 to 1000', () => {
  const dir = scratch();
  assert.deepEqual(DEFAULT_LIMITS, { daily: 50, pace: 'fast', gentle: true, profileReads: false });
  assert.deepEqual(DAILY_RANGE, { min: 1, max: 1000 });
  assert.deepEqual(readLimits(dir), DEFAULT_LIMITS);
  writeLimits(dir, { daily: 137 });
  assert.deepEqual(readLimits(dir), { daily: 137, pace: 'fast', gentle: true, profileReads: false }, 'not just the old menu’s numbers');
  for (const daily of [0, -5, 1001, 12.5, '80', null, undefined, true]) {
    writeLimits(dir, { daily });
    assert.equal(readLimits(dir).daily, 137, `${daily} keeps what is saved`);
  }
  writeLimits(dir, { daily: 1 });
  writeLimits(dir, { pace: 'slow' });
  assert.deepEqual(readLimits(dir), { daily: 1, pace: 'slow', gentle: true, profileReads: false }, 'saving the speed keeps the number');
  writeLimits(dir, { daily: 1000 });
  assert.deepEqual(read(dir, 'scan-limits.json'), { daily: 1000, pace: 'slow', gentle: true, profileReads: false }, 'only these four are written');
  assert.ok(validDaily(1) && validDaily(1000) && !validDaily(0) && !validDaily(1001));
  rmSync(dir, { recursive: true, force: true });
});

test('a saved file from before keeps its daily number; the monthly and profile-view caps are dropped silently', () => {
  const dir = scratch();
  write(dir, 'scan-limits.json', { daily: 200, monthly: 250, profiles: 10, pace: 'medium' });
  assert.deepEqual(readLimits(dir), { daily: 200, pace: 'medium', gentle: true, profileReads: false });
  const st = linkedinState(dir);
  assert.equal(st.leftMonth, undefined, 'no monthly budget');
  assert.equal(st.profilesLeftToday, 200, 'profile views count against the daily number, not the old 10');
  writeLimits(dir, { daily: 150 });
  assert.deepEqual(read(dir, 'scan-limits.json'), { daily: 150, pace: 'medium', gentle: true, profileReads: false }, 'the first save drops the rest');
  // The old "0, no daily limit" is not a number the app saves: the default.
  write(dir, 'scan-limits.json', { daily: 0, monthly: 0, profiles: 0 });
  assert.deepEqual(readLimits(dir), { daily: 50, pace: 'fast', gentle: true, profileReads: false });
  rmSync(dir, { recursive: true, force: true });
});

test('the single daily limit is enforced on searches and on profile views, each on its own count', () => {
  const dir = scratch();
  const now = Date.UTC(2026, 8, 24, 12);
  const s = (hoursAgo) => now / 1000 - hoursAgo * 3600;
  writeLimits(dir, { daily: 10 });
  write(dir, 'linkedin-activity.json', { searches: Array.from({ length: 9 }, (_, i) => s(i + 1)), profiles: [s(1), s(30)] });
  let st = linkedinState(dir, now);
  assert.deepEqual([st.leftToday, st.limitReached, st.profilesLeftToday], [1, false, 9]);
  write(dir, 'linkedin-activity.json', { searches: Array.from({ length: 12 }, (_, i) => s(i + 1)), profiles: [] });
  st = linkedinState(dir, now);
  assert.deepEqual([st.leftToday, st.limitReached], [0, true], 'never below 0 when the number was lowered');
  // A search 24 hours old has stopped counting: a rolling day, not since midnight.
  write(dir, 'linkedin-activity.json', { searches: Array.from({ length: 10 }, () => s(24)), profiles: [] });
  assert.equal(linkedinState(dir, now).limitReached, false);
  rmSync(dir, { recursive: true, force: true });
});

test('lifting for this session: no daily limit and no cooldown, until it is put back', () => {
  const dir = scratch();
  const now = Date.now();
  writeLimits(dir, { daily: 5 });
  write(dir, 'linkedin-activity.json', { searches: Array.from({ length: 8 }, (_, i) => now / 1000 - 60 * (i + 1)), profiles: [now / 1000 - 30] });
  write(dir, 'linkedin-cooldown.json', { until: now / 1000 + 3600, reason: 'LinkedIn pushed back: a security check', set_at: now / 1000 - 600 });
  let st = linkedinState(dir, now);
  assert.equal(st.limitReached, true);
  assert.ok(st.cooldown);

  liftLimits(now);
  st = linkedinState(dir, now);
  assert.equal(st.lifted, true);
  assert.equal(st.liftedAt, now);
  assert.equal(st.leftToday, null, 'nothing is left "of" a limit');
  assert.equal(st.profilesLeftToday, null);
  assert.equal(st.limitReached, false);
  assert.equal(st.cooldown, null, 'the cooldown is off');
  assert.match(st.heldCooldown.reason, /security check/, 'and comes back with the limits');
  assert.equal(st.searchesToday, 8, 'still counted');
  assert.deepEqual(readLimits(dir), { daily: 5, pace: 'fast', gentle: true, profileReads: false }, 'the saved number is untouched');
  assert.ok(readCooldown(dir, now), 'and so is the pause on file: nothing is written');

  putLimitsBack();
  st = linkedinState(dir, now);
  assert.equal(st.lifted, false);
  assert.equal(st.limitReached, true);
  assert.ok(st.cooldown);
  assert.equal(liftEnded().why, 'by-hand');
  rmSync(dir, { recursive: true, force: true });
});

test('LinkedIn pushing back after the lift puts the limits back by themselves', () => {
  const dir = scratch();
  const now = Date.now();
  liftLimits(now - 60_000);
  assert.ok(sessionLift(dir, now), 'no pause on file');
  // A pause from before the lift doesn't end it.
  write(dir, 'linkedin-cooldown.json', { until: now / 1000 + 3600, reason: 'old', set_at: (now - 3_600_000) / 1000 });
  assert.ok(sessionLift(dir, now));
  // The scanner writes a new one: a check LinkedIn asked for after the lift.
  write(dir, 'linkedin-cooldown.json', { until: now / 1000 + 86400, reason: 'LinkedIn pushed back: a security check', set_at: now / 1000 - 5 });
  assert.equal(sessionLift(dir, now), null);
  assert.equal(liftedAt(), null);
  assert.equal(liftEnded().why, 'pushback');
  assert.ok(linkedinState(dir, now).cooldown, 'the pause holds again');
  rmSync(dir, { recursive: true, force: true });
});

test('a cooldown shows until it ends; a pause lifted by hand before 2026-10-05 reads as none', () => {
  const dir = scratch();
  const now = Date.now();
  write(dir, 'linkedin-cooldown.json', { until: now / 1000 + 3600, reason: 'LinkedIn pushed back: a security check', set_at: now / 1000 });
  const cd = readCooldown(dir, now);
  assert.ok(cd && cd.until > now);
  assert.match(cd.reason, /security check/);
  assert.equal(readCooldown(dir, now + 2 * 3600 * 1000), null, 'ended');
  write(dir, 'linkedin-cooldown.json', { until: now / 1000, reason: 'x', set_at: now / 1000 - 60, lifted_at: now / 1000, was_until: now / 1000 + 3600 });
  assert.equal(readCooldown(dir, now), null);
  rmSync(dir, { recursive: true, force: true });
});

test('the scanner reads the number the Scan page saved, and old or odd files the same way', (t) => {
  const cases = [
    [{ daily: 25, pace: 'fast' }, 25],
    [{ daily: 200, monthly: 500, profiles: 10 }, 200],   // from before: the daily number stays
    [{ daily: 0, monthly: 0 }, 50],                        // the old "no limit"
    [{ daily: 5000 }, 50],
    [{ daily: '25' }, 50],
    [{ daily: true }, 50],
    [null, 50],
  ];
  for (const [limits, want] of cases) {
    const dir = scratch();
    if (limits) write(dir, 'scan-limits.json', limits);
    const py = scanner(t, dir, 'search_limits()');
    const js = readLimits(dir).daily;
    rmSync(dir, { recursive: true, force: true });
    if (py === undefined) return;
    assert.deepEqual(py, { daily: want, profiles: want }, JSON.stringify(limits));
    assert.equal(js, want, `the page agrees for ${JSON.stringify(limits)}`);
  }
});

test('the scanner and the Scan page agree on what\'s left, limits on and lifted', (t) => {
  const now = Date.now();
  const sec = now / 1000;
  const dir = scratch();
  write(dir, 'scan-limits.json', { daily: 10 });
  write(dir, 'linkedin-activity.json', {
    searches: Array.from({ length: 12 }, (_, i) => sec - 600 * (i + 1)), profiles: [sec - 60, sec - 90000],
  });
  write(dir, 'linkedin-cooldown.json', { until: sec + 3600, reason: 'LinkedIn pushed back', set_at: sec - 60 });
  const on = scanner(t, dir, '[searches_left(float(argv[0])), profiles_left(float(argv[0])), read_cooldown() is not None]', { args: [String(sec)] });
  if (on === undefined) return;
  const js = linkedinState(dir, now);
  assert.deepEqual(on, [[0, 'daily'], 9, true]);
  assert.deepEqual([js.leftToday, js.profilesLeftToday, Boolean(js.cooldown)], [0, 9, true]);

  const lifted = scanner(t, dir, '[searches_left(float(argv[0]))[0] >= 10 ** 9, profiles_left(float(argv[0])) >= 10 ** 9, read_cooldown(), _cooldown_on_file() is not None]',
    { lifted: true, args: [String(sec)] });
  assert.deepEqual(lifted, [true, true, null, true], 'no limit and no cooldown; the pause is still on file');
  liftLimits(now);   // after the pause was set, so it doesn't end the lift
  const st = linkedinState(dir, now);
  assert.deepEqual([st.leftToday, st.profilesLeftToday, st.cooldown], [null, null, null]);
  rmSync(dir, { recursive: true, force: true });
});

// ── another computer's limits, brought in by an import ───────────────────────
// They belong to the LinkedIn account, not to a computer. An import merges the
// other computer's files with these instead of replacing them: replacing them
// forgot today's searches and lifted a cooldown (review R1).

test('a limits file from another computer is held to the rules the app writes by', () => {
  assert.equal(budgetFileProblem('scan-limits.json', { daily: 137 }), null);
  assert.equal(budgetFileProblem('scan-limits.json', { daily: 50, monthly: 0, profiles: 10 }), null, 'an old copy\'s other caps are ignored');
  assert.equal(budgetFileProblem('scan-limits.json', { daily: 25, note: 'extra keys are ignored' }), null);
  assert.equal(budgetFileProblem('scan-limits.json', {}), null, 'missing values read as the defaults');
  // REGRESSION (review R2): a number the app would never save is refused, not passed on.
  assert.match(budgetFileProblem('scan-limits.json', { daily: 0 }), /daily limit \(0\) is not one Sixgree offers/);
  assert.match(budgetFileProblem('scan-limits.json', { daily: 5000 }), /daily limit \(5000\)/);
  assert.match(budgetFileProblem('scan-limits.json', { daily: '50' }), /daily limit/);
  assert.match(budgetFileProblem('scan-limits.json', [50, 250]), /not a JSON object/);

  assert.equal(budgetFileProblem('linkedin-activity.json', { searches: [1758800000.123456, 1758800000], profiles: [] }), null);
  assert.equal(budgetFileProblem('linkedin-activity.json', {}), null);
  for (const bad of [{ searches: ['1758800000'] }, { searches: [-5] }, { searches: 'lots' }, { profiles: [null] }]) {
    assert.match(budgetFileProblem('linkedin-activity.json', bad), /not a list of times/, JSON.stringify(bad));
  }

  assert.equal(budgetFileProblem('linkedin-cooldown.json', { until: 1758900000.5, reason: 'LinkedIn pushed back', set_at: 1758800000 }), null);
  assert.match(budgetFileProblem('linkedin-cooldown.json', {}), /no end time/);
  assert.match(budgetFileProblem('linkedin-cooldown.json', { until: 'tomorrow' }), /no end time/);
  assert.match(budgetFileProblem('linkedin-cooldown.json', { until: 1, reason: 42 }), /not text/);
});

test('two records of searches merge with each search counted once', () => {
  assert.deepEqual(mergeTimes([1, 2, 3], [3, 4]), [1, 2, 3, 4]);
  // The same history on both computers (one was imported from the other) is not counted twice.
  assert.deepEqual(mergeTimes([5, 6, 7], [5, 6, 7]), [5, 6, 7]);
  // One click that cost 3 searches is one time written 3 times (charge_linkedin(n)): all 3 stay.
  assert.deepEqual(mergeTimes([9, 9, 9], [9]), [9, 9, 9]);
  assert.deepEqual(mergeTimes([9], [9, 9, 9, 10]), [9, 9, 9, 10]);
  assert.deepEqual(mergeTimes([], [2, 1]), [1, 2]);
});

test('REGRESSION: importing onto a computer that has scanned keeps its searches, adds the other\'s, and keeps the later pause', () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const sec = now / 1000;
  const here = scratch();
  const from = scratch();
  const mine = Array.from({ length: 40 }, (_, i) => sec - 60 * i);             // 40 searches today, here
  write(here, 'linkedin-activity.json', { searches: mine, profiles: [sec - 10] });
  write(here, 'linkedin-cooldown.json', { until: sec + 3600, reason: 'LinkedIn pushed back', set_at: sec });
  write(here, 'scan-limits.json', { daily: 25 });
  // The other computer: 5 searches of its own, 2 it shares with this one, a longer pause, a looser limit.
  write(from, 'linkedin-activity.json', { searches: [...mine.slice(0, 2), sec - 7200, sec - 7300, sec - 7400, sec - 7500, sec - 7600], profiles: [] });
  write(from, 'linkedin-cooldown.json', { until: sec + 86400, reason: 'A security check', set_at: sec - 100 });
  write(from, 'scan-limits.json', { daily: 200 });

  mergeBudgetFiles({ dir: here, from });
  const state = linkedinState(here, now);
  assert.equal(state.searchesToday, 45, 'this computer\'s 40, plus the other\'s 5; the 2 both had count once');
  assert.equal(state.profilesToday, 1);
  assert.equal(state.cooldown.until, (sec + 86400) * 1000, 'the pause that ends later');
  assert.equal(state.cooldown.reason, 'A security check');
  assert.deepEqual(state.limits, { daily: 25, pace: 'fast', gentle: true, profileReads: false }, 'the limit chosen here stays');

  // A pause here that ends later than the copy's stays as it is.
  write(from, 'linkedin-cooldown.json', { until: sec + 60, reason: 'shorter', set_at: sec });
  mergeBudgetFiles({ dir: here, from });
  assert.equal(readCooldown(here, now).reason, 'A security check');

  // Doing it again (a start that stopped part-way) changes nothing.
  const once = ['linkedin-activity.json', 'linkedin-cooldown.json', 'scan-limits.json'].map((f) => readFileSync(path.join(here, f), 'utf8'));
  mergeBudgetFiles({ dir: here, from });
  const twice = ['linkedin-activity.json', 'linkedin-cooldown.json', 'scan-limits.json'].map((f) => readFileSync(path.join(here, f), 'utf8'));
  assert.deepEqual(twice, once);
  for (const dir of [here, from]) rmSync(dir, { recursive: true, force: true });
});

test('a computer with no limits file takes the copy\'s daily number, and nothing else of an old one', () => {
  const here = scratch();
  const from = scratch();
  write(from, 'linkedin-activity.json', { searches: [100, 200], profiles: [150] });
  write(from, 'linkedin-cooldown.json', { until: 4000000000, reason: 'LinkedIn pushed back', set_at: 100 });
  write(from, 'scan-limits.json', { daily: 25, monthly: 100, profiles: 10, pace: 'slow', left: 'over' });
  mergeBudgetFiles({ dir: here, from });
  assert.deepEqual(read(here, 'linkedin-activity.json'), { searches: [100, 200], profiles: [150] });
  assert.deepEqual(read(here, 'linkedin-cooldown.json'), { until: 4000000000, reason: 'LinkedIn pushed back', set_at: 100 });
  assert.deepEqual(read(here, 'scan-limits.json'), { daily: 25, pace: 'slow' }, 'only the values the app understands');
  rmSync(here, { recursive: true, force: true });
  const bare = scratch();
  write(from, 'scan-limits.json', {});
  mergeBudgetFiles({ dir: bare, from });
  assert.deepEqual(read(bare, 'scan-limits.json'), { daily: DEFAULT_LIMITS.daily });
  for (const dir of [bare, from]) rmSync(dir, { recursive: true, force: true });
});

test('a record here that can\'t be read is left alone: the scanner reads it as today used up', () => {
  const here = scratch();
  const from = scratch();
  writeFileSync(path.join(here, 'linkedin-activity.json'), '{"searches": [1, 2');
  write(from, 'linkedin-activity.json', { searches: [100], profiles: [] });
  mergeBudgetFiles({ dir: here, from });
  assert.equal(readFileSync(path.join(here, 'linkedin-activity.json'), 'utf8'), '{"searches": [1, 2');
  assert.equal(linkedinState(here).leftToday, 0);
  for (const dir of [here, from]) rmSync(dir, { recursive: true, force: true });
});

test('the scanner counts a merged record the way the Scan page does', (t) => {
  const here = scratch();
  const from = scratch();
  const now = Date.now();
  const sec = now / 1000;
  write(here, 'linkedin-activity.json', { searches: [sec - 30.25, sec - 30.25, sec - 90000], profiles: [sec - 5] });
  write(from, 'linkedin-activity.json', { searches: [sec - 30.25, sec - 400.5], profiles: [] });
  mergeBudgetFiles({ dir: here, from });
  const py = scanner(t, here, 'linkedin_usage(float(argv[0]))', { args: [String(sec)] });
  const js = usage(here, now);
  for (const dir of [here, from]) rmSync(dir, { recursive: true, force: true });
  if (py === undefined) return;
  assert.equal(py.searches_today, 3, 'the charge of 2 at one time, and the other computer\'s own search');
  assert.deepEqual([py.searches_today, py.profiles_today], [js.searchesToday, js.profilesToday]);
});
