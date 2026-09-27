// The search budget and the cooldown lock, as the Scan page reads them. The
// scanner writes the same files; the month boundary is checked against its
// own Python so the two can't disagree about when LinkedIn's month starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  monthStartPacific, nextMonthStartPacific, usage, readLimits, writeLimits,
  readCooldown, liftCooldown, linkedinState, DEFAULT_LIMITS,
  budgetFileProblem, mergeTimes, mergeBudgetFiles,
} from '../lib/linkedin-limits.js';
import { PYTHON, noPython } from './python.mjs';

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixdeg-limits-'));

test('LinkedIn\'s month starts at midnight Pacific on the 1st, summer and winter', () => {
  // 2026-09-24 is PDT (UTC-7): Sept 1 00:00 PDT = 07:00 UTC.
  assert.equal(new Date(monthStartPacific(Date.UTC(2026, 8, 24, 12))).toISOString(), '2026-09-01T07:00:00.000Z');
  // January is PST (UTC-8).
  assert.equal(new Date(monthStartPacific(Date.UTC(2027, 0, 15))).toISOString(), '2027-01-01T08:00:00.000Z');
  // Late on Sept 30 Pacific is already Oct 1 in UTC — still September for LinkedIn.
  assert.equal(new Date(monthStartPacific(Date.UTC(2026, 9, 1, 3))).toISOString(), '2026-09-01T07:00:00.000Z');
  assert.equal(new Date(nextMonthStartPacific(Date.UTC(2026, 8, 24))).toISOString(), '2026-10-01T07:00:00.000Z');
});

test('the scanner agrees on the month boundary', (t) => {
  const lift = `
import ast, sys, time
from datetime import datetime
src = open(sys.argv[1]).read()
tree = ast.parse(src)
want = {'month_start_pacific', 'next_month_start_pacific'}
body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in want]
body += [n for n in tree.body if isinstance(n, ast.Assign) and any(getattr(x, 'id', '') == 'PACIFIC' for x in n.targets)]
ns = {'datetime': datetime, 'time': time}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
for ms in [int(a) for a in sys.argv[2:]]:
    print(int(ns['month_start_pacific'](ms / 1000) * 1000), int(ns['next_month_start_pacific'](ms / 1000) * 1000))
`;
  const instants = [Date.UTC(2026, 8, 24, 12), Date.UTC(2027, 0, 15), Date.UTC(2026, 9, 1, 3), Date.UTC(2026, 10, 1, 7, 30)];
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER, ...instants.map(String)], { encoding: 'utf8' });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => l.split(' ').map(Number));
  instants.forEach((ms, i) => {
    assert.equal(rows[i][0], monthStartPacific(ms), `month start for ${new Date(ms).toISOString()}`);
    assert.equal(rows[i][1], nextMonthStartPacific(ms), `next month for ${new Date(ms).toISOString()}`);
  });
});

test('usage counts the last 24 hours and LinkedIn\'s month', () => {
  const dir = scratch();
  const now = Date.UTC(2026, 8, 24, 12);
  const s = (hoursAgo) => now / 1000 - hoursAgo * 3600;
  writeFileSync(path.join(dir, 'linkedin-activity.json'), JSON.stringify({
    searches: [s(1), s(5), s(23), s(25), s(24 * 20), s(24 * 30)],   // the last is in August
    profiles: [s(2), s(30)],
  }));
  assert.deepEqual(usage(dir, now), { searchesToday: 3, searchesMonth: 5, profilesToday: 1 });
  rmSync(dir, { recursive: true, force: true });
});

test('a damaged record reads as the day used up, never as nothing searched', () => {
  const dir = scratch();
  writeFileSync(path.join(dir, 'linkedin-activity.json'), '{"searches": [1, 2');
  const st = linkedinState(dir);
  assert.equal(st.leftToday, 0);
  assert.equal(st.unreadable, true);
  rmSync(dir, { recursive: true, force: true });
});

test('limits: defaults, only offered choices are saved, 0 means no monthly cap', () => {
  const dir = scratch();
  assert.deepEqual(readLimits(dir), DEFAULT_LIMITS);
  writeLimits(dir, { daily: 100, monthly: 0 });
  assert.deepEqual(readLimits(dir), { daily: 100, monthly: 0 });
  writeLimits(dir, { daily: 99999, monthly: -1 });
  assert.deepEqual(readLimits(dir), { daily: 100, monthly: 0 }, 'anything else is ignored');
  assert.equal(linkedinState(dir).leftMonth, null, 'no cap');
  rmSync(dir, { recursive: true, force: true });
});

test('a cooldown shows until it lifts, and can be lifted by hand', () => {
  const dir = scratch();
  const now = Date.now();
  writeFileSync(path.join(dir, 'linkedin-cooldown.json'),
    JSON.stringify({ until: now / 1000 + 3600, reason: 'LinkedIn pushed back: a security check', set_at: now / 1000 }));
  const cd = readCooldown(dir, now);
  assert.ok(cd && cd.until > now);
  assert.match(cd.reason, /security check/);
  assert.equal(readCooldown(dir, now + 2 * 3600 * 1000), null, 'expired');
  liftCooldown(dir);
  assert.equal(readCooldown(dir, now), null);
  liftCooldown(dir);   // lifting twice is fine
  rmSync(dir, { recursive: true, force: true });
});

test('the scanner reads the budget the Scan page saved', (t) => {
  const dir = scratch();
  writeLimits(dir, { daily: 25, monthly: 500 });
  const lift = `
import ast, json, os, sys, time
from pathlib import Path
src = open(sys.argv[1]).read()
tree = ast.parse(src)
want = {'search_limits', '_home'}
consts = {'DEFAULT_DAILY_SEARCHES', 'DEFAULT_MONTHLY_SEARCHES'}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in want)
        or (isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in consts for x in n.targets))]
ns = {'json': json, 'os': os, 'Path': Path}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
print(json.dumps(ns['search_limits']()))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: dir } });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { daily: 25, monthly: 500 });
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8')), { daily: 25, monthly: 500 });
  rmSync(dir, { recursive: true, force: true });
});

// ── another computer's budget, brought in by an import ───────────────────────
// The budget belongs to the LinkedIn account, not to a computer. An import
// merges the other computer's files with these instead of replacing them:
// replacing them forgot today's searches and lifted a cooldown (review R1).

const write = (dir, name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value));
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

test('a budget file from another computer is held to the rules the app writes by', () => {
  assert.equal(budgetFileProblem('scan-limits.json', { daily: 50, monthly: 0 }), null, 'no monthly cap is on the menu (Premium)');
  assert.equal(budgetFileProblem('scan-limits.json', { daily: 25, monthly: 100, note: 'extra keys are ignored' }), null);
  assert.equal(budgetFileProblem('scan-limits.json', {}), null, 'missing values read as the defaults');
  // REGRESSION (review R2): daily 0 is "no limit at all" to the scanner, and the menu never offers it.
  assert.match(budgetFileProblem('scan-limits.json', { daily: 0, monthly: 0 }), /daily limit \(0\) is not one Six Degrees offers/);
  assert.match(budgetFileProblem('scan-limits.json', { daily: 50, monthly: 300 }), /monthly limit \(300\)/);
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
  write(here, 'scan-limits.json', { daily: 25, monthly: 100 });
  // The other computer: 5 searches of its own, 2 it shares with this one, a longer pause, looser limits.
  write(from, 'linkedin-activity.json', { searches: [...mine.slice(0, 2), sec - 7200, sec - 7300, sec - 7400, sec - 7500, sec - 7600], profiles: [] });
  write(from, 'linkedin-cooldown.json', { until: sec + 86400, reason: 'A security check', set_at: sec - 100 });
  write(from, 'scan-limits.json', { daily: 200, monthly: 1000 });

  mergeBudgetFiles({ dir: here, from });
  const state = linkedinState(here, now);
  assert.equal(state.searchesToday, 45, 'this computer\'s 40, plus the other\'s 5; the 2 both had count once');
  assert.equal(state.profilesToday, 1);
  assert.equal(state.cooldown.until, (sec + 86400) * 1000, 'the pause that ends later');
  assert.equal(state.cooldown.reason, 'A security check');
  assert.deepEqual(state.limits, { daily: 25, monthly: 100 }, 'the limits chosen here stay');

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

test('a computer with no budget files takes the copy\'s, in the app\'s own layout', () => {
  const here = scratch();
  const from = scratch();
  write(from, 'linkedin-activity.json', { searches: [100, 200], profiles: [150] });
  write(from, 'linkedin-cooldown.json', { until: 4000000000, reason: 'LinkedIn pushed back', set_at: 100 });
  write(from, 'scan-limits.json', { monthly: 0, left: 'over' });
  mergeBudgetFiles({ dir: here, from });
  assert.deepEqual(read(here, 'linkedin-activity.json'), { searches: [100, 200], profiles: [150] });
  assert.deepEqual(read(here, 'linkedin-cooldown.json'), { until: 4000000000, reason: 'LinkedIn pushed back', set_at: 100 });
  assert.deepEqual(read(here, 'scan-limits.json'), { daily: DEFAULT_LIMITS.daily, monthly: 0 }, 'only the values the app understands');
  for (const dir of [here, from]) rmSync(dir, { recursive: true, force: true });
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
  const lift = `
import ast, json, os, sys, time
from datetime import datetime
from pathlib import Path
src = open(sys.argv[1]).read()
tree = ast.parse(src)
want = {'_home', '_read_activity', 'linkedin_usage', 'month_start_pacific', 'search_limits', '_write_json_atomic'}
consts = {'DEFAULT_DAILY_SEARCHES', 'DEFAULT_MONTHLY_SEARCHES', 'DAY_SECONDS', 'PACIFIC'}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in want)
        or (isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in consts for x in n.targets))]
ns = {'json': json, 'os': os, 'Path': Path, 'time': time, 'datetime': datetime}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
print(json.dumps(ns['linkedin_usage'](float(sys.argv[2]))))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER, String(sec)], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: here } });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  const js = usage(here, now);
  assert.equal(py.searches_today, 3, 'the charge of 2 at one time, and the other computer\'s own search');
  assert.deepEqual([py.searches_today, py.profiles_today], [js.searchesToday, js.profilesToday]);
  for (const dir of [here, from]) rmSync(dir, { recursive: true, force: true });
});
