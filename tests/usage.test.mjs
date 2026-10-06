// Scan → LinkedIn usage: the windows it counts, where the levels change,
// what a pushback file may give up (its time and reason, never LinkedIn's page),
// a pause lifted by hand (before 2026-10-05) that every reader takes as no
// pause, the session's lift, and Auto scan's rules against the scanner's own. Invented times and files in temporary folders;
// nothing here touches a real data folder or LinkedIn.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUTO, PEOPLE_PER_SEARCH, DANGER_AT, REPORTED_MONTH, LEVELS, usageLevel, searchedAfterPushback, countAfter,
  estimate, levelWarning, warningParts, barMax, untilText, agoText, hoursText,
} from '../lib/usage.js';
import {
  linkedinUsage, linkedinState, countWithin, freesAt, clearAt, newestPushback, lastPushback,
  readCooldown, budgetFileProblem, mergeBudgetFiles, writeLimits,
} from '../lib/linkedin-limits.js';
import { putLimitsBack } from '../lib/limits-lift.js';
import { RESTRICTED_AT, limitNote, riskyDaily } from '../lib/search-risk.js';
import { PYTHON, noPython } from './python.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const SCRAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scrape.py');
const H = 3600;
const DAY = 24 * H;
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixdeg-usage-'));
const write = (dir, name, value) => writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
// What lifting by hand wrote before 2026-10-05 (the Scan page's old "Lift it early"): an
// old file may still say so, and every reader takes it as a pause that has ended.
const liftedByHand = (pause, at) => ({ ...pause, until: at, lifted_at: at, was_until: pause.until });

// ── Auto scan's rules are the scanner's ──────────────────────────────────────

test('Auto scan\'s rules on the page are the ones scrape.py keeps', (t) => {
  const lift = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
want = {'DRIP_HOURS', 'SESSION_PAGES', 'SESSION_REST', 'AUTO_PUSHBACK_REST'}
gone = {'AUTO_DAY_CAP', 'AUTO_WEEK_CAP', '_auto_ceiling_wait'}
named = {getattr(x, 'id', '') for n in tree.body if isinstance(n, ast.Assign) for x in n.targets}
named |= {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
body = [n for n in tree.body if isinstance(n, ast.Assign) and any(getattr(x, 'id', '') in want for x in n.targets)]
ns = {}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
print(json.dumps({**{k: ns[k] for k in want}, 'gone': sorted(gone & named)}))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  assert.deepEqual(AUTO, {
    hours: py.DRIP_HOURS,
    sitting: py.SESSION_PAGES,
    sittingRest: py.SESSION_REST,
    pushbackRest: py.AUTO_PUSHBACK_REST,
  });
  // One limit (2026-10-05): Auto scan's own 40 a day and 200 a week are gone, from the page and the scanner.
  assert.deepEqual(py.gone, []);
  assert.equal(AUTO.day, undefined);
  assert.equal(AUTO.week, undefined);
  // And what the handoff named, so a change to the scanner is a change someone meant.
  assert.deepEqual([AUTO.hours, AUTO.pushbackRest], [[9, 18], 2 * DAY]);
  assert.equal(hoursText(AUTO.hours), '9 AM to 6 PM');
});

// ── levels ───────────────────────────────────────────────────────────────────

test('the levels change at 50, 100 and 60% of 373, and a pause outranks everything', () => {
  assert.equal(DANGER_AT, 224, '0.6 × 373 = 223.8, so 224 searches');
  assert.equal(RESTRICTED_AT, 373);
  const at = (searchesDay) => usageLevel({ searchesDay });
  assert.deepEqual([0, 50].map(at), ['ok', 'ok']);
  assert.deepEqual([51, 100].map(at), ['above-default', 'above-default']);
  assert.deepEqual([101, 223].map(at), ['risky', 'risky']);
  assert.deepEqual([224, 373, 500].map(at), ['danger', 'danger', 'danger']);
  assert.equal(usageLevel({ searchesDay: 0, cooldown: { until: Date.now() + H * 1000 } }), 'paused');
  assert.equal(usageLevel({ searchesDay: 300, cooldown: { until: 1 } }), 'paused');
  for (const unreadable of [null, undefined, Infinity, NaN]) {
    assert.equal(usageLevel({ searchesDay: unreadable }), 'unknown', String(unreadable));
  }
  for (const level of Object.keys(LEVELS)) assert.ok(LEVELS[level].label && LEVELS[level].color, level);
});

test('searching within a day of a pushback is too close, however few searches', () => {
  const now = Date.UTC(2026, 9, 3, 18);
  const pushback = (hoursAgo) => ({ at: now - hoursAgo * H * 1000 });
  assert.equal(usageLevel({ searchesDay: 3, lastPushback: pushback(3), searchesSincePushback: 1, now }), 'danger');
  assert.equal(usageLevel({ searchesDay: 3, lastPushback: pushback(3), searchesSincePushback: 0, now }), 'ok', 'nothing since: not searching');
  assert.equal(usageLevel({ searchesDay: 3, lastPushback: pushback(25), searchesSincePushback: 4, now }), 'ok', 'more than a day ago');
  assert.equal(usageLevel({ searchesDay: 3, lastPushback: { at: null }, searchesSincePushback: 4, now }), 'ok', 'no time to judge by');
  assert.equal(searchedAfterPushback({ lastPushback: pushback(-1), searchesSincePushback: 4, now }), false, 'a time ahead of this clock');
  assert.match(levelWarning('danger', { searchesDay: 3, lastPushback: pushback(3), now }), /pushed back 3 h ago/);
});

test('searches since a pushback leave out the one that met it', () => {
  const at = Date.UTC(2026, 9, 1, 15, 4, 5);
  const s = at / 1000;
  assert.equal(countAfter([s - 600, s + 0.5, s + 30], at), 0, 'the search that met it, a moment either side of the file\'s second');
  assert.equal(countAfter([s - 600, s + 30, s + 3600, s + 7200], at), 2);
  assert.equal(countAfter([s + 3600], null), 0, 'no pushback, nothing since');
});

test('every level\'s warning is a plain sentence with its numbers, and ok has none', () => {
  const now = Date.UTC(2026, 9, 3, 18);
  assert.equal(levelWarning('ok', {}), null);
  assert.match(levelWarning('danger', { searchesDay: 250, now }), /250 searches in the last 24 hours\. A real account was restricted after 373\./);
  assert.match(levelWarning('risky', { searchesDay: 120 }), /More than 100 .* 250 to 350/);
  assert.match(levelWarning('above-default', { searchesDay: 60 }), /More than the default 50/);
  assert.match(levelWarning('paused', { cooldown: { until: now + DAY * 1000, reason: 'LinkedIn pushed back: a security check' }, now }),
    /^Scanning is paused until .*\. LinkedIn pushed back: a security check\. Nothing that searches/);
  assert.match(levelWarning('paused', { cooldown: { until: now + H * 1000, reason: 'two people in a row with no clear answer' } }), /\. Two people in a row/);
  assert.match(levelWarning('unknown', {}), /couldn.t be read/);
  for (const level of Object.keys(LEVELS)) {
    const text = levelWarning(level, { searchesDay: 300, cooldown: { until: now, reason: 'x' }, lastPushback: { at: now }, now }) || '';
    assert.doesNotMatch(text, /—/, `${level}: no em dashes on screen`);
    assert.doesNotMatch(text, /scrap/i, `${level}: scanning, never scraping`);
  }
});

test('the warning names the 373 once, whatever the level and the budget', () => {
  const now = Date.UTC(2026, 9, 3, 18);
  const states = [
    ['above-default', { searchesDay: 72 }],
    ['risky', { searchesDay: 130 }],
    ['danger', { searchesDay: 248 }],
    ['danger', { searchesDay: 42, lastPushback: { at: now - 5 * H * 1000 } }],
    ['paused', { searchesDay: 41, cooldown: { until: now + H * 1000, reason: 'LinkedIn pushed back: a security check' } }],
    ['unknown', { searchesDay: null }],
    ['ok', { searchesDay: 10 }],
  ];
  const budgets = [{ daily: 50 }, { daily: 100 }, { daily: 200 }, { daily: 500 }];
  for (const [level, facts] of states) {
    for (const limits of budgets) {
      const said = warningParts(level, { ...facts, now }, limits).join(' ');
      const times = said.split(`restricted after ${RESTRICTED_AT}`).length - 1;
      assert.ok(times <= 1, `${level} at ${facts.searchesDay} with ${JSON.stringify(limits)}: said ${times} times`);
      // A risky budget still gets the rest of its note.
      if (limits.daily > 100) assert.match(said, new RegExp(`${limits.daily} a day can use up`), `${level} ${limits.daily}`);
      if (riskyDaily(limits.daily)) assert.match(said, new RegExp(`restricted after ${RESTRICTED_AT}`), `${level}: said once, not dropped`);
    }
  }
  // The danger case from the lead's review: the count's warning says it, so the note doesn't again.
  assert.deepEqual(warningParts('danger', { searchesDay: 248, now }, { daily: 500 }), [
    levelWarning('danger', { searchesDay: 248, now }),
    '500 a day can use up a free account\'s month in a day or two.',
  ]);
  // On its own the note says it whole.
  assert.match(limitNote({ daily: 500 }), /^A real account was restricted after 373 searches in 24 hours\. 500 a day/);
});

// ── estimate, scales, words ──────────────────────────────────────────────────

test('what\'s left is today\'s searches, about 9 people a search', () => {
  assert.equal(PEOPLE_PER_SEARCH, 9);
  assert.deepEqual(estimate({ leftDay: 20 }), { searches: 20, people: 180 });
  assert.deepEqual(estimate({ leftDay: 0 }), { searches: 0, people: 0 });
  assert.equal(estimate({ leftDay: null }), null, 'lifted for this session: nothing to count down');
  assert.equal(estimate({ leftDay: 20, paused: true }).searches, 0);
});

test('a bar reaches past its last mark and past what was used', () => {
  assert.equal(barMax(10, [50, 100, 373]), Math.ceil(373 * 1.08));
  assert.equal(barMax(500, [50, 100, 373]), 525);
  assert.equal(barMax(null, []), 1);
  assert.deepEqual(REPORTED_MONTH, [250, 350]);
});

test('times say how long until and how long ago, plainly', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  assert.equal(untilText(now - 1, now), 'now');
  assert.equal(untilText(now + 20 * 1000, now), 'in under a minute');
  assert.equal(untilText(now + 40 * 60 * 1000, now), 'in 40 min');
  assert.equal(untilText(now + (3 * 60 + 12) * 60 * 1000, now), 'in 3 h 12 min');
  assert.equal(untilText(now + 2 * H * 1000, now), 'in 2 h');
  assert.equal(untilText(now + 5 * DAY * 1000, now), 'in 5 days');
  assert.equal(agoText(now - 20 * 1000, now), 'just now');
  assert.equal(agoText(now - 3 * H * 1000, now), '3 h ago');
  assert.equal(agoText(now - 3 * DAY * 1000, now), '3 days ago');
  assert.equal(agoText(null, now), 'recently');
});

// ── the windows ──────────────────────────────────────────────────────────────

test('the last hour, 24 hours and 7 days each leave out a time exactly that old', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  const s = now / 1000;
  const times = [s - 30 * 60, s - (H - 1), s - H, s - 23 * H, s - DAY, s - (7 * DAY - 1), s - 7 * DAY, s - 8 * DAY];
  assert.equal(countWithin(times, now, H), 2);
  assert.equal(countWithin(times, now, DAY), 4);
  assert.equal(countWithin(times, now, 7 * DAY), 6);
  assert.equal(countWithin([s + 60], now, H), 1, 'a time ahead of this clock (another computer\'s) still counts, as usage() counts it');
});

test('the next search frees when the count drops under the budget; all clear when the newest turns 24 hours old', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  const s = now / 1000;
  const thirty = Array.from({ length: 30 }, (_, i) => s - (i + 1) * 600);   // every 10 min, back 5 hours
  assert.equal(freesAt(thirty, now, 50), null, 'under budget: one is free now');
  assert.equal(freesAt(thirty, now, 0), null, 'no cap');
  // 30 against 25: the five oldest must age out, then the sixth frees one.
  const sorted = [...thirty].sort((a, b) => a - b);
  assert.equal(freesAt(thirty, now, 25), (sorted[5] + DAY) * 1000);
  assert.equal(freesAt(thirty, now, 30), (sorted[0] + DAY) * 1000, 'exactly at the budget: the oldest frees it');
  // And at that moment it has: the window no longer holds it.
  assert.equal(countWithin(thirty, freesAt(thirty, now, 30), DAY), 29);
  assert.equal(clearAt(thirty, now), (s - 600 + DAY) * 1000);
  assert.equal(countWithin(thirty, clearAt(thirty, now), DAY), 0);
  assert.equal(clearAt([s - DAY - 1], now), null, 'nothing in the window');
});

test('the usage report counts the record, and says when things free up', () => {
  const dir = scratch();
  const now = Date.UTC(2026, 9, 3, 12);
  const s = now / 1000;
  const searches = [...Array.from({ length: 30 }, (_, i) => s - (i + 1) * 600), s - 2 * DAY, s - 6 * DAY, s - 9 * DAY];
  const profiles = Array.from({ length: 10 }, (_, i) => s - (i + 1) * 120);
  write(dir, 'linkedin-activity.json', { searches, profiles });
  writeLimits(dir, { daily: 10 });
  const u = linkedinUsage(dir, now);
  assert.equal(u.now, now);
  assert.deepEqual([u.searchesLastHour, u.searchesToday], [5, 30], 'the sixth is exactly an hour old');
  for (const gone of ['searchesMonth', 'leftMonth', 'monthResets', 'searchesWeek']) assert.equal(u[gone], undefined, `${gone}: no month or week any more`);
  assert.equal(u.leftToday, 0);
  assert.equal(u.dayFreesAt, freesAt(searches, now, 10));
  assert.equal(u.dayClearAt, (s - 600 + DAY) * 1000);
  assert.equal(u.profilesFreeAt, (s - 10 * 120 + DAY) * 1000, 'the same daily number: the oldest of the ten');
  assert.equal(u.lastPushback, null);
  assert.equal(u.searchesSincePushback, 0);
  // The Scan page's own numbers are the same ones.
  const st = linkedinState(dir, now);
  assert.deepEqual([st.searchesToday, st.profilesToday], [u.searchesToday, u.profilesToday]);
  rmSync(dir, { recursive: true, force: true });
});

test('a record that can\'t be read gives no counts, never zeros', () => {
  const dir = scratch();
  write(dir, 'linkedin-activity.json', '{"searches": [1, 2');
  const u = linkedinUsage(dir);
  for (const k of ['searchesToday', 'profilesToday', 'searchesLastHour', 'dayFreesAt', 'dayClearAt', 'profilesFreeAt', 'searchesSincePushback']) {
    assert.equal(u[k], null, k);
  }
  assert.equal(u.unreadable, true);
  assert.equal(usageLevel({ searchesDay: u.searchesToday }), 'unknown');
  assert.equal(JSON.parse(JSON.stringify(u)).leftToday, 0, 'the scanner counts the day as used');
  rmSync(dir, { recursive: true, force: true });
});

// ── pushback files: the time and the reason, nothing else ────────────────────

const local = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h, mi, s).getTime();
const PAGE_TEXT = 'Ilsa Quorrent · Lead Example · SECRET-PAGE-TEXT';
const ADDRESS = 'https://www.linkedin.com/checkpoint/challenge/AgF-invented-token';
const evidence = (reason) => `${reason === null ? '' : `reason: ${reason}\n`}url: ${ADDRESS}\n\n${PAGE_TEXT}\n`;

test('the newest pushback file gives its time and reason, never its address or page text', () => {
  const dir = scratch();
  const pb = path.join(dir, 'pushback');
  mkdirSync(pb);
  writeFileSync(path.join(pb, '2026-09-30_101500.txt'), evidence('the monthly search limit'));
  writeFileSync(path.join(pb, '2026-10-01_150405.txt'), evidence('a security check'));
  writeFileSync(path.join(pb, 'notes.txt'), 'reason: not the scanner\'s');
  // Not plain files, or not a time: none of these is the scanner's.
  writeFileSync(path.join(dir, 'elsewhere.txt'), 'reason: followed a link\n');
  symlinkSync(path.join(dir, 'elsewhere.txt'), path.join(pb, '2026-10-05_120000.txt'));
  mkdirSync(path.join(pb, '2026-10-06_120000.txt'));
  writeFileSync(path.join(pb, '2026-10-07_259999.txt'), evidence('a time that never was'));

  const got = newestPushback(dir);
  assert.deepEqual(got, { at: local(2026, 10, 1, 15, 4, 5), reason: 'a security check' });
  const last = lastPushback(dir, local(2026, 10, 1, 18, 0, 0));
  assert.deepEqual(last, { at: local(2026, 10, 1, 15, 4, 5), reason: 'LinkedIn pushed back: a security check', pausedUntil: null, liftedAt: null, active: false });
  const said = JSON.stringify([got, last, linkedinUsage(dir)]);
  for (const secret of ['checkpoint', 'linkedin.com', 'AgF-invented-token', 'SECRET-PAGE-TEXT', 'Ilsa', 'url']) {
    assert.ok(!said.includes(secret), `${secret} must stay in the file`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('a pushback file without a reason line, or with an address for one, gives only its time', () => {
  const dir = scratch();
  const pb = path.join(dir, 'pushback');
  mkdirSync(pb);
  writeFileSync(path.join(pb, '2026-10-01_090000.txt'), evidence(null));
  assert.deepEqual(newestPushback(dir), { at: local(2026, 10, 1, 9, 0, 0), reason: null });
  writeFileSync(path.join(pb, '2026-10-01_100000.txt'), evidence(ADDRESS));
  assert.equal(newestPushback(dir).reason, null);
  writeFileSync(path.join(pb, '2026-10-01_110000.txt'), evidence(`an unusual-activity warning ${'x'.repeat(400)}`));
  const long = newestPushback(dir).reason;
  assert.ok(long.startsWith('an unusual-activity warning') && long.length <= 120, 'one short line at most');
  writeFileSync(path.join(pb, '2026-10-01_120000.txt'), 'reason: a security check\r\nurl: x\r\n');
  assert.equal(newestPushback(dir).reason, 'a security check', 'Windows line endings');
  assert.equal(lastPushback(dir).reason, 'LinkedIn pushed back: a security check');
  const empty = scratch();
  assert.equal(newestPushback(empty), null, 'no pushback folder');
  for (const d of [dir, empty]) rmSync(d, { recursive: true, force: true });
});

test('the pause and the kept page are one pushback, and the pause says how it ended', () => {
  const dir = scratch();
  mkdirSync(path.join(dir, 'pushback'));
  const at = local(2026, 10, 2, 14, 0, 0);
  writeFileSync(path.join(dir, 'pushback', '2026-10-02_140000.txt'), evidence('a security check'));
  write(dir, 'linkedin-cooldown.json', { until: at / 1000 + DAY, reason: 'LinkedIn pushed back: a security check', set_at: at / 1000 + 40 });
  const now = at + 3 * H * 1000;
  assert.deepEqual(lastPushback(dir, now), {
    at, reason: 'LinkedIn pushed back: a security check', pausedUntil: at + DAY * 1000, liftedAt: null, active: true,
  });
  assert.equal(lastPushback(dir, at + 2 * DAY * 1000).active, false, 'ended by itself');

  // Lifted by hand (before 2026-10-05): still the last pushback, no longer a pause.
  write(dir, 'linkedin-cooldown.json', liftedByHand(read(dir, 'linkedin-cooldown.json'), now / 1000));
  const lifted = lastPushback(dir, now + 1000);
  assert.deepEqual(lifted, { at, reason: 'LinkedIn pushed back: a security check', pausedUntil: at + DAY * 1000, liftedAt: now, active: false });

  // Searching again within the day is too close; the search that met it isn't counted.
  const s = at / 1000;
  write(dir, 'linkedin-activity.json', { searches: [s - 300, s + 10, s + 3 * H + 60], profiles: [] });
  const u = linkedinUsage(dir, now + 2 * 60 * 1000);
  assert.equal(u.searchesSincePushback, 1);
  assert.equal(u.cooldown, null);
  assert.equal(usageLevel({ ...u, searchesDay: u.searchesToday, now: u.now }), 'danger');
  rmSync(dir, { recursive: true, force: true });
});

test('a pause with no kept page (two unclear in a row) is the last pushback too; a newer page wins over an old pause', () => {
  const dir = scratch();
  const at = Date.UTC(2026, 9, 2, 12);
  write(dir, 'linkedin-cooldown.json', { until: at / 1000 + 6 * H, reason: 'two people in a row with no clear answer', set_at: at / 1000 });
  assert.equal(lastPushback(dir, at + 1000).reason, 'two people in a row with no clear answer');
  assert.equal(lastPushback(dir, at + 1000).at, at);
  mkdirSync(path.join(dir, 'pushback'));
  const later = new Date(at + 3 * DAY * 1000);
  const name = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}_${String(later.getHours()).padStart(2, '0')}${String(later.getMinutes()).padStart(2, '0')}00.txt`;
  writeFileSync(path.join(dir, 'pushback', name), evidence('an unusual-activity warning'));
  const last = lastPushback(dir, at + 3 * DAY * 1000 + 1000);
  assert.equal(last.reason, 'LinkedIn pushed back: an unusual-activity warning');
  assert.equal(last.pausedUntil, null);
  const empty = scratch();
  assert.equal(lastPushback(empty), null, 'no sign of one');
  for (const d of [dir, empty]) rmSync(d, { recursive: true, force: true });
});

// ── a lifted pause ───────────────────────────────────────────────────────────

test('the scanner reads a lifted pause as none, and can pause again after it', (t) => {
  const dir = scratch();
  const now = Date.now();
  write(dir, 'linkedin-cooldown.json', liftedByHand({ until: now / 1000 + DAY, reason: 'LinkedIn pushed back: a security check', set_at: now / 1000 - 60 }, now / 1000));
  const lift = `
import ast, json, os, sys, time
from datetime import datetime
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
want = {'_home', '_write_json_atomic', 'read_cooldown', '_cooldown_on_file', 'limits_lifted', 'set_cooldown', '_when'}
body = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in want)
        or (isinstance(n, ast.Assign) and any(getattr(x, 'id', '') == 'LIMITS' for x in n.targets))]
ns = {'json': json, 'os': os, 'Path': Path, 'time': time, 'datetime': datetime}
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
before = ns['read_cooldown']()
ns['set_cooldown'](seconds=3600, reason='LinkedIn pushed back: an unusual-activity warning')
after = ns['read_cooldown']()
print(json.dumps({'before': before, 'after': after}))
`;
  const r = spawnSync(PYTHON, ['-c', lift, SCRAPER], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: dir } });
  if (noPython(t, r)) { rmSync(dir, { recursive: true, force: true }); return; }
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.before, null, 'lifted: the scanner may search');
  assert.ok(out.after && out.after.until > now / 1000 + 3000, 'a new pushback pauses again: a lifted record is never "longer" than it');
  assert.equal(out.after.lifted_at, undefined);
  assert.ok(readCooldown(dir), 'and the app sees the new pause');
  rmSync(dir, { recursive: true, force: true });
});

test('a lifted pause travels in an import as lifted', () => {
  const here = scratch();
  const from = scratch();
  const s = Date.UTC(2026, 9, 3, 12) / 1000;
  const lifted = { until: s, reason: 'LinkedIn pushed back: a security check', set_at: s - 60, lifted_at: s, was_until: s + DAY };
  assert.equal(budgetFileProblem('linkedin-cooldown.json', lifted), null);
  assert.match(budgetFileProblem('linkedin-cooldown.json', { ...lifted, lifted_at: 'yesterday' }), /lifted pause has a time that is not a time/);
  write(from, 'linkedin-cooldown.json', lifted);
  mergeBudgetFiles({ dir: here, from });
  assert.deepEqual(read(here, 'linkedin-cooldown.json'), lifted);
  assert.equal(readCooldown(here, s * 1000 - 1000), null);
  assert.equal(lastPushback(here, s * 1000).liftedAt, s * 1000);
  // A pause still on in the copy comes back over one lifted here.
  write(from, 'linkedin-cooldown.json', { until: s + 2 * DAY, reason: 'LinkedIn pushed back', set_at: s + 100 });
  mergeBudgetFiles({ dir: here, from });
  assert.ok(readCooldown(here, s * 1000 + 1000));
  for (const d of [here, from]) rmSync(d, { recursive: true, force: true });
});

// ── GET /api/scraper?usage ───────────────────────────────────────────────────

const routeDir = mkdtempSync(path.join(tmpdir(), 'sixdeg-usage-route-'));
let GET, POST;

before(async () => {
  process.env.SIX_DEGREES_HOME = path.join(routeDir, 'home');
  process.env.SIX_DEGREES_DB = path.join(routeDir, 'test.sqlite');
  mkdirSync(process.env.SIX_DEGREES_HOME);
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  process.on('exit', () => rmSync(routeDir, { recursive: true, force: true }));
});

test('GET ?usage reads the scanner\'s files and writes nothing', async () => {
  const home = process.env.SIX_DEGREES_HOME;
  const s = Date.now() / 1000;
  write(home, 'linkedin-activity.json', { searches: [s - 60, s - 120, s - 2 * DAY], profiles: [s - 300] });
  write(home, 'linkedin-cooldown.json', { until: s + H, reason: 'LinkedIn pushed back: a security check', set_at: s - 30 });
  mkdirSync(path.join(home, 'pushback'));
  const stamp = new Date((s - 40) * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const name = `${stamp.getFullYear()}-${p2(stamp.getMonth() + 1)}-${p2(stamp.getDate())}_${p2(stamp.getHours())}${p2(stamp.getMinutes())}${p2(stamp.getSeconds())}.txt`;
  writeFileSync(path.join(home, 'pushback', name), evidence('a security check'));
  const listing = () => readdirSync(home).sort().map((f) => [f, f === 'pushback' ? '' : readFileSync(path.join(home, f), 'utf8')]);
  const before = listing();

  const res = await GET(new Request('http://127.0.0.1/api/scraper?usage=1'));
  assert.equal(res.status, 200);
  const u = await res.json();
  assert.deepEqual([u.searchesLastHour, u.searchesToday, u.profilesToday], [2, 2, 1]);
  assert.ok(u.cooldown && u.lastPushback.active);
  assert.equal(u.lastPushback.reason, 'LinkedIn pushed back: a security check');
  assert.equal(usageLevel({ cooldown: u.cooldown, searchesDay: u.searchesToday }), 'paused');
  const said = JSON.stringify(u);
  for (const secret of ['checkpoint', 'linkedin.com', 'SECRET-PAGE-TEXT', 'Ilsa']) assert.ok(!said.includes(secret), secret);
  assert.deepEqual(listing(), before, 'nothing written');

  // Lifting the limits for this session lifts the pause too, in memory: the file stays as it was.
  const post = (action) => POST(new Request('http://127.0.0.1/api/scraper', { method: 'POST', body: JSON.stringify({ action }) }));
  assert.equal((await post('lift-limits')).status, 200);
  const after = await (await GET(new Request('http://127.0.0.1/api/scraper?usage=1'))).json();
  assert.equal(after.lifted, true);
  assert.equal(after.cooldown, null);
  assert.match(after.heldCooldown.reason, /security check/);
  assert.equal(after.lastPushback.active, true, 'still the pause on record, which comes back with the limits');
  assert.deepEqual(listing(), before, 'still nothing written');
  assert.equal((await post('put-limits-back')).status, 200);
  const back = await (await GET(new Request('http://127.0.0.1/api/scraper?usage=1'))).json();
  assert.equal(back.lifted, false);
  assert.ok(back.cooldown);
  assert.equal(back.liftEnded.why, 'by-hand');
  // The old "Lift it early" is gone: the session's lift is the one way.
  assert.equal((await post('lift-cooldown')).status, 400);
  putLimitsBack();
});
