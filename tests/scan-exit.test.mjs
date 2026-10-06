// How a scanner run ended, by its exit code (Blake, 2026-10-05: structured exit
// codes). scripts/scrape.py EXIT_CODES and lib/scan-exit.js are one table; the
// route (app/api/scraper/route.js finish) goes by the code: a limit or a
// cooldown is a calm end, the rest a stop with its reason. Also Read profiles'
// own refusals at the route. The scanner is a stand-in shell script that exits
// with the code a file says; nothing opens a browser or reaches LinkedIn.
// A temporary data folder. Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { EXIT_CODES, exitOutcome } from '../lib/scan-exit.js';

register('./helpers/extensionless.mjs', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const HARNESS = path.join(here, 'helpers', 'scanner_harness.py');

test('the scanner\'s exit codes are the app\'s, and each way a run ends has its own', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'six-degrees-exit-'));
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, `
out['codes'] = ns['EXIT_CODES']
kinds = {}
for name, exc in (('LinkedInPushedBack', ns['LinkedInPushedBack'](0, 'a security check')),
                  ('BudgetReached', ns['BudgetReached'](0, 'daily')),
                  ('CoolingDown', ns['CoolingDown']({'until': NOW + 60, 'reason': 'x'})),
                  ('NotSignedIn', ns['NotSignedIn']()),
                  ('SaveFailed', ns['SaveFailed']('500')),
                  ('PageUnreadable', ns['PageUnreadable']('3 profiles in a row')),
                  ('SearchLimitReached', ns['SearchLimitReached'](0)),
                  ('TryLater', ns['TryLater']('offline')),
                  ('ValueError', ValueError('a bug'))):
    kinds[name] = ns['EXIT_CODES'][ns['exit_kind'](exc)]
out['kinds'] = kinds`], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trimEnd().split('\n').pop().replace(/^RESULT /, ''));
  assert.deepEqual(out.codes, EXIT_CODES, 'one table, in both');
  assert.deepEqual(out.kinds, {
    LinkedInPushedBack: 10, BudgetReached: 11, CoolingDown: 12, NotSignedIn: 13, SaveFailed: 14,
    PageUnreadable: 15, SearchLimitReached: 16, TryLater: 17, ValueError: 1,
  });
  assert.equal(new Set(Object.values(EXIT_CODES)).size, Object.keys(EXIT_CODES).length, 'no two share a code');
  assert.equal(EXIT_CODES.usage, 2, 'argparse keeps 2 for a bad command line');
});

test('each code means one thing to the app: a calm end, or a stop with its reason', () => {
  const calm = [['ok', 0, 'Finished.'], ['limit', 11, 'Stopped at today’s limit.'], ['cooldown', 12, 'Stopped: scanning is paused for now.']];
  for (const [kind, code, line] of calm) {
    const o = exitOutcome(code);
    assert.deepEqual([o.kind, o.failure, o.effective, o.line], [kind, false, 0, line], kind);
  }
  assert.equal(exitOutcome(11).limit, true, 'the notch offers the lift');
  for (const [kind, code] of [['pushback', 10], ['signed-out', 13], ['save-failed', 14], ['unread', 15], ['search-limit', 16], ['try-later', 17]]) {
    const o = exitOutcome(code);
    assert.deepEqual([o.kind, o.failure, o.effective], [kind, true, code], kind);
    assert.match(o.line, /^Stopped: /);
  }
  assert.deepEqual([exitOutcome(1).kind, exitOutcome(1).line], ['error', 'Stopped (exit 1).']);
  assert.deepEqual([exitOutcome(99).kind, exitOutcome(99).failure], ['error', true], 'an unknown code is an unexpected error');
  assert.equal(exitOutcome(11, { scanner: false }).kind, 'error', 'pip\'s codes are its own');
  // An older scanner ended a limit with 0 and said so: still found by its words.
  assert.equal(exitOutcome(0, { log: ["  Today's limit of 50 searches is used — it counts the last 24 hours."] }).limit, true);
  assert.equal(exitOutcome(0).limit, false);
});

// ── the route, with a stand-in scanner ──────────────────────────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scan-exit-'));
const HOME = path.join(dir, 'home');
const CODE = path.join(dir, 'code.txt');
const RUNS = path.join(dir, 'runs.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do case "$a" in --*) printf '%s\\n' "$a" >> '${RUNS}';; esac; done`,
  'echo "Reading…"',
  `code=$(cat '${CODE}' 2>/dev/null || echo 0)`,
  '[ "$code" != 0 ] && echo "  The plain reason, on stderr." >&2',
  'exit "$code"',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb, writeSettings;
before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const post = (body) => POST(new Request('http://127.0.0.1:3499/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3499' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function ended() {
  for (let i = 0; i < 400; i += 1) {
    const j = await job();
    if (!j.running) return j;
    await pause(20);
  }
  throw new Error('the job never ended');
}
const runs = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean) : []);

beforeEach(async () => {
  await ended();
  const db = getDb();
  for (const tb of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${tb}`);
  for (const f of [CODE, RUNS, path.join(HOME, 'scan-limits.json'), path.join(HOME, 'linkedin-activity.json')]) rmSync(f, { force: true });
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES ('p1', 'me', 1, 'Oriel Vantasse', 'A', 'https://www.linkedin.com/in/oriel-vantasse')`).run();
});

for (const [code, kind, exitCode, failed, line] of [
  [0, 'ok', 0, false, 'Finished.'],
  [11, 'limit', 0, false, 'Stopped at today’s limit.'],
  [12, 'cooldown', 0, false, 'Stopped: scanning is paused for now.'],
  [10, 'pushback', 10, true, 'Stopped: LinkedIn pushed back.'],
  [15, 'unread', 15, true, 'Stopped: a page couldn’t be read.'],
  [1, 'error', 1, true, 'Stopped (exit 1).'],
]) {
  test(`a run that exits ${code} is "${kind}" to the app`, async () => {
    writeFileSync(CODE, String(code));
    const res = await post({ action: 'refresh' });
    assert.equal(res.status, 200);
    const j = await ended();
    assert.equal(j.exitCode, exitCode, 'what the rest of the app reads: 0 for a calm end');
    assert.equal(j.exitKind, kind);
    assert.equal(j.recent[0].exitKind, kind);
    assert.ok(j.log.includes(line), j.log.join(' | '));
    if (failed) assert.deepEqual(j.failure, ['  The plain reason, on stderr.'], 'the reason, for the red box');
    else assert.equal(j.failure, null, 'no red box for a calm end');
    if (code === 11) assert.equal(j.limits.reached, false, 'the limit only shows once it holds a press back');
  });
}

test('Read profiles: refused until it is turned on, then one round of 5, 10 or 25', async () => {
  let res = await post({ action: 'read-profiles', batch: 5 });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Turn on “Read full profiles \(experience\)” in Scanner settings first/);
  assert.deepEqual(runs(), [], 'nothing started');
  res = await post({ action: 'set-limits', profileReads: true });
  assert.equal((await res.json()).limits.profileReads, true);
  res = await post({ action: 'read-profiles', batch: 25 });
  assert.equal(res.status, 200);
  await ended();
  assert.ok(runs().includes('--read-profiles=25'), runs().join(' '));
  res = await post({ action: 'read-profiles', batch: 500 });
  assert.equal(res.status, 200);
  await ended();
  assert.ok(runs().includes('--read-profiles=10'), 'anything else is 10');
  // With the day's profile views used, nothing starts.
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ daily: 2, pace: 'fast', profileReads: true }));
  const now = Date.now() / 1000;
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({ searches: [], profiles: [now - 100, now - 50] }));
  res = await post({ action: 'read-profiles', batch: 5 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).limitReached, true);
});
