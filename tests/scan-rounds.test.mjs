// Circle scans in rounds (Blake, 2026-10-16: "scanning 25 pages per round so
// there's like 4 unfilled bars around the dot showing how scanned it is, unless
// they pick 50 per scan which is max"). A scan of one person's circle reads one
// round of their list, 25 pages or 50 (Scanner settings), from where the last
// stopped (lib/scan-rounds.js, scrape.py scrape_bridge's round_pages), and
// Network Circle draws an arc round their dot for each round (lib/dot-rings.js
// roundSegments). Breach's company rounds are their own (tests/breach.test.mjs).
// Invented people only; nothing opens a browser or reaches LinkedIn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, noScanner } from './helpers/scanner.mjs';
import {
  ROUND_CHOICES, DEFAULT_ROUND, MAX_PAGES, validRound, roundOf, segmentsFor, pageTotal, knownCount, roundState,
  personRounds, roundWords, circleRoundArgs,
} from '../lib/scan-rounds.js';
import { roundSegments, RING } from '../lib/dot-rings.js';
import { reachIndex } from '../lib/reach.js';
import { DEFAULT_LIMITS, readLimits, writeLimits } from '../lib/linkedin-limits.js';
import { pluginHas, PLUGIN_FLAGS_SINCE } from '../lib/scanner-capabilities.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const near = (a, b) => Math.abs(a - b) < 1e-9;
const u = (slug) => `https://www.linkedin.com/in/${slug}`;
const person = (slug, extra = {}) => ({ id: slug, name: slug, degree: 1, profile_url: u(slug), ...extra });

// ── the rounds ───────────────────────────────────────────────────────────────

test('a round is 25 pages, or 50, the most: 4 arcs round a dot, or 2', () => {
  assert.deepEqual(ROUND_CHOICES, [25, 50]);
  assert.equal(DEFAULT_ROUND, 25);
  assert.equal(MAX_PAGES, 100);
  for (const n of [25, 50]) assert.equal(validRound(n), true);
  for (const n of [10, 100, '25', null, 0, 75]) assert.equal(validRound(n), false, String(n));
  assert.deepEqual([roundOf(25), roundOf(50), roundOf(100), roundOf(undefined)], [25, 50, 25, 25]);
  assert.deepEqual([segmentsFor(25), segmentsFor(50), segmentsFor(7)], [4, 2, 4]);
});

test('their page total: min(100, ceil(connections / 10)) when known, else 100', () => {
  assert.deepEqual([pageTotal(300), pageTotal(301), pageTotal(5), pageTotal(1000), pageTotal(5000)], [30, 31, 1, 100, 100]);
  for (const n of [null, undefined, 0, -3, 'x', NaN]) assert.equal(pageTotal(n), 100, String(n));
  // The count: the search's own, else an exact count from the note, else their top card; "500+" isn't known.
  assert.equal(knownCount({ total: 312, connections: 290 }, { connections: 280 }), 312);
  assert.equal(knownCount({ connections: 290, connectionsPlus: false }, { connections: 280 }), 290);
  assert.equal(knownCount({ connections: 500, connectionsPlus: true }, { connections: 280 }), null);
  assert.equal(knownCount({}, { connections: 280, connectionsPlus: false }), 280);
  assert.equal(knownCount(null, { connections: 500, connectionsPlus: true }), null);
  assert.equal(knownCount(null, null), null);
});

test('never scanned: round 1 of 4, nothing filled', () => {
  const s = roundState(null);
  assert.deepEqual(s, { round: 25, segments: 4, pages: 0, total: 100, filled: 0, done: false, next: 1, of: 4 });
  assert.equal(roundWords(s), 'Round 1 of 4');
  // Rounds of 50: two of them.
  assert.equal(roundWords(roundState(null, { round: 50 })), 'Round 1 of 2');
});

test('each round read fills its arc: "Round 2 of 4" after the first, all four after the last', () => {
  const after = (pages, more = true, extra = {}) => roundState({ pages, more, ...extra });
  const one = after(25);
  assert.deepEqual([one.next, one.of, one.filled], [2, 4, 0.25]);
  assert.equal(roundWords(one), 'Round 2 of 4');
  assert.deepEqual([after(50).next, after(75).next], [3, 4]);
  // A round cut short partway: the same round again, part of its arc filled.
  const cut = after(37);
  assert.deepEqual([cut.next, cut.of], [2, 4]);
  assert.ok(near(cut.filled, 0.37));
  // Page 100: as far as LinkedIn's search goes, so done.
  const all = after(100);
  assert.deepEqual([all.done, all.next, all.filled, all.of], [true, null, 1, 4]);
  assert.equal(roundWords(all), 'All 4 rounds done');
  // A list that ended early: done, whatever round it was in.
  const ended = after(31, false);
  assert.deepEqual([ended.done, ended.next, ended.filled, ended.of], [true, null, 1, 2]);
  assert.equal(roundWords(after(8, false)), 'Their whole list is read');
});

test('their page total sets how far each round fills: 300 connections are 30 pages, two rounds of 25', () => {
  const s = roundState({ pages: 25, more: true }, { count: 300 });
  assert.equal(s.total, 30);
  assert.ok(near(s.filled, 25 / 30));
  assert.equal(roundWords(s), 'Round 2 of 2');
  // 50 a round: one round reads all of it, if the list ends where the count says.
  assert.equal(roundWords(roundState(null, { round: 50, count: 300 })), 'Round 1 of 1');
  // More read than the count said, and LinkedIn still has more: full, with a round still to go.
  const over = roundState({ pages: 40, more: true }, { count: 300 });
  assert.deepEqual([over.filled, over.done, over.next, over.of], [1, false, 2, 2]);
});

test('every page read counts, past a gap too (readPages), and a circle scanned before notes were kept is at page 10', () => {
  const gap = roundState({ pages: 0, more: true, readPages: [[2, 26]] });
  assert.equal(gap.pages, 25);
  assert.equal(gap.next, 2);
  const legacy = roundState(null, { legacy: true });
  assert.deepEqual([legacy.pages, legacy.next, legacy.filled], [10, 1, 0.1]);
  // A list hidden after it was read: what was read stays, and no round is next.
  const hidden = roundState({ pages: 30, more: true, hidden: true });
  assert.deepEqual([hidden.next, hidden.done, hidden.pages], [null, false, 30]);
  assert.match(roundWords(hidden), /hidden now/);
});

test('who has rounds: your connections with a circle, or who could have one scanned; never a hidden list', () => {
  const ada = person('ada-quill');
  const bo = person('bo-larsen', { experience: JSON.stringify({ v: 1, status: 'card', at: '2026-10-12T16:00:00Z', card: { connections: 120, connectionsPlus: false } }) });
  const cy = person('cy-moreno');
  const reach = reachIndex([ada, bo, cy], [], {
    read: [ada.profile_url, bo.profile_url],
    lists: { [ada.profile_url]: { pages: 25, more: true, total: 640 }, [bo.profile_url]: { pages: 10, more: true } },
    skips: [{ profileUrl: u('di-lang') }],
  });
  const a = personRounds(ada, reach);
  assert.deepEqual([a.next, a.of, a.total], [2, 3, 64]);
  // Their connection count from their top card when the note has none.
  const b = personRounds(bo, reach);
  assert.deepEqual([b.total, b.next, b.of], [12, 1, 1]);
  assert.ok(near(b.filled, 10 / 12));
  // Never scanned, with a profile a scan can go by: empty arcs, while a scanner is there.
  assert.deepEqual(personRounds(cy, reach).filled, 0);
  assert.equal(personRounds(cy, reach, { canScan: false }), null, 'no scanner: only people with a circle');
  assert.notEqual(personRounds(ada, reach, { canScan: false }), null);
  // Hidden, a 2nd-degree person, no profile to scan by: nothing round the dot.
  assert.equal(personRounds(person('di-lang'), reach), null);
  assert.equal(personRounds({ ...person('ed-ruiz'), degree: 2 }, reach), null);
  assert.equal(personRounds({ id: 'x', name: 'X', degree: 1 }, reach), null);
  // Rounds of 50.
  // Rounds of 50: two arcs, and 25 pages read is half the first round.
  assert.deepEqual([personRounds(ada, reach, { round: 50 }).segments, personRounds(ada, reach, { round: 50 }).next], [2, 1]);
  // Scanned with no note (before notes were kept): read to page 10.
  const old = reachIndex([cy], [{ id: 'd2', degree: 2, source_connection_id: 'cy-moreno', profile_url: u('d2') }], {});
  assert.equal(personRounds(cy, old, { canScan: false }).pages, 10);
});

// ── the arcs ─────────────────────────────────────────────────────────────────

test('the arcs: 4 (or 2) faint ones clockwise from the top with gaps, and the read part over them', () => {
  const arcs = (n) => (n || '').match(/M/g)?.length || 0;
  const none = roundSegments(10, roundState(null));
  assert.equal(arcs(none.track), 4);
  assert.equal(none.fill, null, 'nothing read, nothing filled');
  const half = roundSegments(10, roundState({ pages: 50, more: true }));
  assert.equal(arcs(half.fill), 2, 'two rounds read, two arcs filled');
  const part = roundSegments(10, roundState({ pages: 30, more: true }));
  assert.equal(arcs(part.fill), 2, 'a round and a bit: the second arc part filled');
  const whole = roundSegments(10, roundState({ pages: 12, more: false }));
  assert.equal(arcs(whole.fill), 4);
  assert.equal(whole.fill, whole.track, 'a list read to the end fills every arc exactly');
  assert.equal(arcs(roundSegments(10, roundState(null, { round: 50 })).track), 2);
  // The first arc starts just past the top, clockwise: its start is right of 12 o'clock, above the middle.
  const [, x, y] = none.track.match(/^M(-?[\d.]+) (-?[\d.]+)/).map(Number);
  assert.ok(x > 0 && y < -9, `${x} ${y}`);
  for (const d of [none.track, half.fill, part.fill]) assert.match(d, /^(M-?[\d.]+ -?[\d.]+ A10 10 0 0 1 -?[\d.]+ -?[\d.]+ ?)+$/);
  assert.deepEqual(roundSegments(10, null), { track: null, fill: null });
  // In the look's own colours: its accent, and its ink, faint.
  assert.match(RING.round, /var\(--sd-accent/);
  assert.match(RING.roundTrack, /var\(--sd-ink/);
});

test('Network Circle draws the rounds round a bridge\'s dot, not Bridge Chains\' continuous ring', () => {
  const graph = src('app/components/ForceGraph.js');
  assert.match(graph, /personRounds\(c, reach, \{ round: scanNotes\?\.round, canScan \}\)/);
  assert.match(graph, /roundSegments\(r, rounds\)/);
  assert.doesNotMatch(graph, /scanFill|fillArcs/);
  // The pages a round is comes with the scanner's notes (GET /api/scraper?reach=1).
  const route = src('app/api/scraper/route.js');
  assert.match(route, /return \{ skips: bridgeSkips\(\), read, lists, round \};/);
  assert.match(src('lib/scraper-client.js'), /const round = validRound\(d\.round\) \? d\.round : DEFAULT_ROUND;/);
});

// ── the setting ──────────────────────────────────────────────────────────────

test('Pages a round is saved with the scanner\'s settings: 25 unless changed, only a change written', () => {
  assert.equal(DEFAULT_LIMITS.roundPages, 25);
  const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-rounds-'));
  try {
    const file = () => JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8'));
    assert.equal(readLimits(dir).roundPages, 25);
    writeLimits(dir, { daily: 30 });
    assert.equal('roundPages' in file(), false);
    writeLimits(dir, { roundPages: 50 });
    assert.equal(file().roundPages, 50);
    for (const bad of [100, 10, '25', null]) {
      writeLimits(dir, { roundPages: bad });
      assert.equal(readLimits(dir).roundPages, 50, String(bad));
    }
    writeLimits(dir, { ...readLimits(dir), pace: 'slow' });
    assert.equal(file().roundPages, 50, 'another setting saved keeps it');
    writeLimits(dir, { roundPages: 25 });
    assert.equal('roundPages' in file(), false, 'back to the default, nothing written');
    writeFileSync(path.join(dir, 'scan-limits.json'), JSON.stringify({ roundPages: 75 }));
    assert.equal(readLimits(dir).roundPages, 25, 'a hand-edited file reads as the default');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const route = src('app/api/scraper/route.js');
  assert.match(route, /roundPages: body\.roundPages,/);
  const page = src('app/setup/page.js');
  assert.match(page, /data-round-pages=""/);
  assert.match(page, /run\('set-limits', \{ roundPages: Number\(e\.target\.value\) \}\)/);
});

// ── what a round asks of the scanner ─────────────────────────────────────────

test('a Scan button: page 1 for someone never scanned, the next round for someone part read', () => {
  assert.deepEqual(circleRoundArgs({ action: 'bridge' }), {
    fromStart: true, start: 1, last: 25, pages: 25, args: ['--from-start', '--max-pages=25', '--round=25'],
  });
  const note = { pages: 25, more: true };
  assert.deepEqual(circleRoundArgs({ action: 'bridge', note, nextPage: 26 }).args, ['--max-pages=50', '--round=25']);
  // Rescan from the start: page 1 whatever was read.
  assert.deepEqual(circleRoundArgs({ action: 'bridge', note, nextPage: 26, fromStart: true }).args, ['--from-start', '--max-pages=25', '--round=25']);
  // Read to the end (no next page): a rescan from page 1.
  assert.deepEqual(circleRoundArgs({ action: 'bridge', note: { pages: 40, more: false }, nextPage: null }).args, ['--from-start', '--max-pages=25', '--round=25']);
  // Scan next round (Resume): always carries on.
  assert.deepEqual(circleRoundArgs({ action: 'resume', note, nextPage: 26, round: 50 }), {
    fromStart: false, start: 26, last: 75, pages: 50, args: ['--max-pages=75', '--round=50'],
  });
  // Never past page 100.
  assert.deepEqual(circleRoundArgs({ action: 'resume', note: { pages: 80, more: true }, nextPage: 81, round: 50 }).last, 100);
  // Fewer pages asked for: the guided setup's first scan reads three.
  assert.deepEqual(circleRoundArgs({ action: 'bridge', maxPages: 3 }).args, ['--from-start', '--max-pages=3', '--round=3']);
  assert.deepEqual(circleRoundArgs({ action: 'bridge', maxPages: 100 }).pages, 25, 'more than a round is a round');
  // A scanner plugin from before 1.0.10 doesn't know --round on a circle: the last page alone says it.
  assert.deepEqual(circleRoundArgs({ action: 'resume', note, nextPage: 26, roundFlag: false }).args, ['--max-pages=50']);
});

test('--round goes only to a scanner that knows it on a circle: plugins 1.0.10 on, and the built-in one', () => {
  assert.equal(PLUGIN_FLAGS_SINCE['circle-round'], '1.0.10');
  assert.equal(SHIPPED_PLUGIN_VERSION, '1.0.11');
  const plugin = (version) => ({ from: 'plugin', plugin: { id: 'auto-scan', name: 'Auto scan', version } });
  assert.equal(pluginHas(plugin('1.0.9'), 'circle-round'), false);
  assert.equal(pluginHas(plugin('1.0.10'), 'circle-round'), true);
  assert.equal(pluginHas(plugin('1.1.0'), 'circle-round'), true);
  assert.equal(pluginHas({ from: 'built-in' }, 'circle-round'), true);
  assert.equal(pluginHas(plugin('1.0.0'), 'something-else'), true, 'nothing to know');
  // The route: one person's circle by id, a round from their note, with --round when it's known.
  const route = src('app/api/scraper/route.js');
  assert.match(route, /const circleRound = profileUrl && \(action === 'bridge' \|\| action === 'resume'\)/);
  assert.match(route, /roundFlag: pluginHas\(scanner, 'circle-round'\)/);
  assert.match(route, /fromStart: body\.fromStart === true,/);
  assert.match(route, /\.\.\.\(circleRound \? circleRound\.args : \[\]\),/);
  assert.match(route, /\.\.\.\(readsCircles && !circleRound \? \[`--max-pages=/);
  // A queued Rescan stays a rescan when its turn comes.
  assert.match(route, /\.\.\.\(body\.fromStart === true \? \{ fromStart: true \} : \{\}\),/);
});

test('the person card and the Scan page say "Round 2 of 4" and "Scan next round"', () => {
  const card = src('app/components/Sidebar.js');
  assert.match(card, /\{roundWords\(round\)\}\{round\.next != null \? ` · \$\{round\.round\} pages a round` : ''\}/);
  assert.match(card, /'Scan next round'/);
  assert.match(card, /start\('bridge', \{ fromStart: read \}\)/);
  const page = src('app/setup/page.js');
  assert.match(page, /\{roundWords\(rounds\)\}/);
  assert.match(page, /'Scan next round'/);
  assert.match(src('app/components/LinkedInLimits.js'), /Scan next round/);
  // Said as Sixgree says it: scanning, and no long dashes.
  const words = [src('lib/scan-rounds.js'), ...[roundState(null), roundState({ pages: 25, more: true }), roundState({ pages: 100, more: true }),
    roundState({ pages: 9, more: false }), roundState({ pages: 30, more: true, hidden: true })].map(roundWords)].join('\n');
  assert.doesNotMatch(words, /scraping|\u2014/i);
});

// ── the scanner's side ───────────────────────────────────────────────────────

// scrape_bridge lifted out of scrape.py without its imports, with the browser and
// the read stubbed: what it hands the reader is what this checks.
const LIFT = `
import ast, json, os, sys, types
from datetime import datetime
from pathlib import Path
tree = ast.parse(open(sys.argv[1]).read())
names = {'scrape_bridge', 'circle_round', '_read', 'next_page_to_read'}
classes = {'BridgeRead'}
consts = {'LINKEDIN_MAX_PAGES', 'LEGACY_PAGES_READ', 'CIRCLE_ROUND_MAX', 'BREACH_ROUND', 'BREACH_ROUND_MAX'}
body = [n for n in tree.body
        if (isinstance(n, ast.FunctionDef) and n.name in names)
        or (isinstance(n, ast.ClassDef) and n.name in classes)
        or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in consts for t in n.targets))]
case = json.loads(sys.argv[2])
calls = []
class Page:
    def set_default_timeout(self, ms): pass
    def set_default_navigation_timeout(self, ms): pass
class Browser:
    pages = [Page()]
    def close(self): pass
class Playwright:
    def __init__(self): self.chromium = self
    def __enter__(self): return self
    def __exit__(self, *a): return False
api = types.ModuleType('playwright.sync_api')
api.sync_playwright = Playwright
sys.modules['playwright'] = types.ModuleType('playwright')
sys.modules['playwright.sync_api'] = api
class Quit(Exception):
    pass
ns = {'json': json, 'os': os, 'Path': Path, 'datetime': datetime, '_active_user_id': 'me'}
for exc in ('SaveFailed', 'NotSignedIn', 'LinkedInPushedBack', 'CoolingDown', 'BudgetReached', 'SearchLimitReached'):
    ns[exc] = type(exc, (Quit,), {})
URL = 'https://www.linkedin.com/in/ada-quill'
ns.update({
    'read_cooldown': lambda: None, 'searches_left': lambda: (50, 'daily'), 'profiles_left': lambda: 5,
    'budget_message': lambda kind: kind,
    'read_connections': lambda params=None: [{'id': 'c1', 'name': 'Ada Quill', 'profile_url': URL}],
    'forget_bridge_progress': lambda url: None,
    'load_bridge_progress': lambda: case.get('progress', {}),
    'record_bridge_progress': lambda *a: None, 'mark_bridge_hidden': lambda *a: None, 'record_bridge_skip': lambda *a: None,
    'push_connections': lambda *a, **kw: None,
    'launch_chrome': lambda p, headless=False, sign_in=False: Browser(),
    'ensure_logged_in': lambda page, **kw: True, 'manual_reads': lambda: False, 'dig_deeper': lambda: False,
    '_experience_on_file': lambda row: False, 'stop_requested': lambda: False, 'set_cooldown': lambda **kw: None,
    '_scrape_one_bridge': lambda *a, **kw: calls.append([kw.get('start_page'), kw.get('max_pages'), kw.get('round_end'), kw.get('from_start')]) or (
        [], 'success', {'last': 0, 'more': True, 'urn': None, 'found': 0, 'limited': False}),
})
exec(compile(ast.Module(body=body, type_ignores=[]), 'scrape.py', 'exec'), ns)
out = {'max': ns['CIRCLE_ROUND_MAX'], 'breach': [ns['BREACH_ROUND'], ns['BREACH_ROUND_MAX']],
       'rounds': [ns['circle_round'](1, 25), ns['circle_round'](26, 25), ns['circle_round'](90, 25), ns['circle_round'](1, 50),
                  ns['circle_round'](1, 80), ns['circle_round'](1, 3), ns['circle_round'](12, 0)]}
for c in case['scans']:
    calls.clear()
    ns['scrape_bridge'](None, max_pages=c.get('max', 100), deeper=c.get('deeper', False), profile_url=URL, round_pages=c.get('round'))
    out.setdefault('reads', []).append(calls[0] if calls else None)
print(json.dumps(out))
`;

test('the scanner reads one round: the pages after where it starts, at most 50, never past page 100', (t) => {
  if (noScanner(t)) return;
  const URL = 'https://www.linkedin.com/in/ada-quill';
  const r = spawnSync(PYTHON, ['-c', LIFT, SCRAPER, JSON.stringify({
    progress: { [URL]: { pages: 25, more: true } },
    scans: [
      { round: 25 },                              // never scanned, from page 1 (--from-start)
      { round: 25, deeper: true },                // the next round: pages 26 to 50
      { round: 50, deeper: true, max: 30 },       // --round wins over --max-pages
      { deeper: true, max: 100 },                 // no round (the command line, Resume all): to --max-pages as before
    ],
  })], { encoding: 'utf8' });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.max, Math.max(...ROUND_CHOICES), 'the most a round takes is the most the app offers');
  assert.deepEqual(out.breach, [5, 10], 'Breach\'s rounds are left alone');
  assert.deepEqual(out.rounds, [25, 50, 100, 50, 50, 3, 12]);
  assert.deepEqual(out.reads, [
    [1, 25, true, true],
    [26, 50, true, false],
    [26, 75, true, false],
    [26, 100, false, false],
  ]);
  // --round's default is none, so a Breach round without it is 5, and a circle without it reads to --max-pages.
  const scraper = readFileSync(SCRAPER, 'utf8');
  assert.match(scraper, /parser\.add_argument\("--round", type=int, default=None,/);
  assert.match(scraper, /pages=BREACH_ROUND if args\.round is None else args\.round/);
  assert.match(scraper, /profile_url=args\.bridge_url, round_pages=args\.round\)/);
  // A round that ends says so, by itself and by hand, not "Stopped at the N-page limit".
  assert.match(scraper, /That's page \{max_pages\}, the end of this round, and LinkedIn has more: /);
  assert.match(scraper, /That's page \{max_pages\}, as far as this scan reads: the next one carries on from page /);
});
