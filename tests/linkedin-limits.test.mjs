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
} from '../lib/linkedin-limits.js';

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
  const r = spawnSync('python3', ['-c', lift, SCRAPER, ...instants.map(String)], { encoding: 'utf8' });
  if (r.error) { t.skip('python3 is not available here'); return; }
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
  const r = spawnSync('python3', ['-c', lift, SCRAPER], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: dir } });
  if (r.error) { t.skip('python3 is not available here'); return; }
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { daily: 25, monthly: 500 });
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8')), { daily: 25, monthly: 500 });
  rmSync(dir, { recursive: true, force: true });
});
