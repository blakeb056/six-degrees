// Read profiles (Blake, 2026-10-05: optional full profile reads, off by
// default): the scanner reads a connection's current and past roles from
// LinkedIn's own data or the page's Experience section, never a CSS class
// (TRAPS §5), and says when it couldn't, never "none" (TRAPS §7). These run the
// scanner's parsers on invented fixtures (tests/fixtures/linkedin/), its round
// against stand-in pages (tests/helpers/scanner_harness.py), and the app's side:
// lib/experience.js, scoring with the roles read, and /api/ingest's
// "experience". Never LinkedIn: the live page is unverified until someone runs it.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs, { mkdtempSync, rmSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, noPython } from './python.mjs';
import { cleanExperience, readProfileQueue, experienceCounts, experienceRoles, RETRY_UNREADABLE_DAYS } from '../lib/experience.js';
import { scorePerson, rolesWithCompanies } from '../lib/scoring.js';

register('./helpers/extensionless.mjs', import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const HARNESS = path.join(here, 'helpers', 'scanner_harness.py');
const FIXTURES = path.join(here, 'fixtures', 'linkedin');

function run(t, script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-experience-'));
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, `FIXTURES = ${JSON.stringify(FIXTURES)}\n${script}`],
    { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  fs.rmSync(home, { recursive: true, force: true });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

// What EXPERIENCE_JS gives for tests/fixtures/linkedin/profile-experience.html
// (tests/scanner-browser.test.mjs checks that against a real Chrome when it can).
const ADA_ITEMS = [
  { lines: ['Vice President, Engineering', 'Quillon Labs · Full-time', 'Mar 2022 - Present · 3 yrs 8 mos', 'Mar 2022 to Present · 3 yrs 8 mos',
    'Orlando, Florida · Hybrid', 'Leads an invented team that builds invented things.'], subs: [] },
  { lines: ['Brightwater Analytics', 'Full-time · 4 yrs 9 mos'], subs: [
    ['Director of Platform', 'Jan 2020 - Feb 2022 · 2 yrs 2 mos'],
    ['Senior Engineering Manager', 'Full-time', 'Jun 2017 - Dec 2019 · 2 yrs 7 mos']] },
  { lines: ['Software Engineer', 'Hollowfield Systems', '2012 - 2017 · 5 yrs'], subs: [] },
];

test('dates: month and year, a year alone, Present, and anything else is not a date range', (t) => {
  const r = run(t, `
out['got'] = [ns['parse_date_range'](x) for x in ('Mar 2022 - Present · 3 yrs 8 mos', 'Jan 2020 – Feb 2022', '2012 - 2017 · 5 yrs',
  'Sept 2019 - Now', 'Mar 2022 to Present', 'Full-time · 4 yrs', 'Quillon Labs', '2019')]`);
  if (!r) return;
  assert.deepEqual(r.out.got, [['2022-03', null, true], ['2020-01', '2022-02', false], ['2012', '2017', false],
    ['2019-09', null, true], ['2022-03', null, true], null, null, null]);
});

test('the page\'s Experience section: one role an item, or a company with its roles inside it', (t) => {
  const r = run(t, `out['roles'] = ns['roles_from_items'](${JSON.stringify(ADA_ITEMS)})`);
  if (!r) return;
  assert.deepEqual(r.out.roles, [
    { title: 'Vice President, Engineering', company: 'Quillon Labs', start: '2022-03', end: null, current: true },
    { title: 'Director of Platform', company: 'Brightwater Analytics', start: '2020-01', end: '2022-02', current: false },
    { title: 'Senior Engineering Manager', company: 'Brightwater Analytics', start: '2017-06', end: '2019-12', current: false },
    { title: 'Software Engineer', company: 'Hollowfield Systems', start: '2012', end: '2017', current: false },
  ]);
});

test('LinkedIn\'s own data: position entities, and the Experience section\'s components, and nothing from Education', (t) => {
  const r = run(t, `
out['positions'] = ns['voyager_positions'](json.load(open(FIXTURES + '/profile-positions.json')))
out['components'] = ns['voyager_positions'](json.load(open(FIXTURES + '/profile-components.json')))`);
  if (!r) return;
  assert.deepEqual(r.out.positions, [
    { title: 'Vice President, Engineering', company: 'Quillon Labs', start: '2022-03', end: null, current: true },
    { title: 'Director of Platform', company: 'Brightwater Analytics', start: '2017-06', end: '2022-02', current: false },
    { title: 'Software Engineer', company: 'Hollowfield Systems', start: '2012', end: '2017', current: false },
  ]);
  assert.deepEqual(r.out.components, [
    { title: 'Chief Operating Officer', company: 'Marrowgate Freight', start: '2021-01', end: null, current: true },
    { title: 'VP Operations', company: 'Larkspur Shipping', start: '2017-03', end: '2020-12', current: false },
    { title: 'Operations Manager', company: 'Larkspur Shipping', start: '2013', end: '2017', current: false },
  ]);
});

test('a page that changed reads as nothing, never as roles it made up', (t) => {
  const r = run(t, `
out['nodates'] = ns['roles_from_items']([{'lines': ['Operations Lead, Larkspur Shipping'], 'subs': []}])
out['empty'] = ns['roles_from_items']([])
out['education'] = ns['voyager_positions']({'included': [{'$type': 'x.Education', 'title': 'A school', 'dateRange': {'start': {'year': 2001}}}]})
out['other'] = ns['voyager_positions']({'data': {'unrelated': [1, 2, {'text': 'Experience'}]}})`);
  if (!r) return;
  assert.deepEqual([r.out.nodates, r.out.empty, r.out.education, r.out.other], [[], [], [], []]);
});

// ── the round ───────────────────────────────────────────────────────────────

const PEOPLE = `
A, B, C, D = (f'https://www.linkedin.com/in/invented-{x}/' for x in 'abcd')
ROWS = [
    {'id': 'a', 'degree': 1, 'name': 'Ada Quill', 'tier': 'A', 'power_score': 7.1, 'profile_url': A},
    {'id': 'b', 'degree': 1, 'name': 'Ben Ostrander', 'tier': 'B', 'power_score': 4.4, 'profile_url': B},
    {'id': 'c', 'degree': 1, 'name': 'Cass Wren', 'tier': 'C', 'power_score': 3.0, 'profile_url': C},
    {'id': 'd', 'degree': 1, 'name': 'Dov Pell', 'tier': 'D', 'power_score': 9.9, 'profile_url': D,
     'experience': json.dumps({'v': 1, 'status': 'read', 'at': '2026-10-01T00:00:00Z', 'roles': [{'title': 'CEO'}]})},
]
ns['read_connections'] = lambda endpoint='', params=None: ROWS
POSITIONS = json.load(open(FIXTURES + '/profile-positions.json'))
ITEMS = ${JSON.stringify(ADA_ITEMS)}
`;

test('a round opens the highest power first, skips anyone read already, a profile view each, a minute apart', (t) => {
  const r = run(t, `${PEOPLE}
page = ProfilePage({A: {'data': [POSITIONS]}, B: {'dom': {'found': True, 'how': 'heading', 'items': ITEMS, 'showAll': 6}}, C: {'data': [POSITIONS]}})
install_browser(page)
counts = ns['read_profiles'](batch=10)
views = json.loads((home / 'linkedin-activity.json').read_text())['profiles']
out.update(counts=counts, opened=[u for u, _ in page.opened], at=[a for _, a in page.opened], views=views,
           sent=[(p['json']['people'][0]['profileUrl'], p['json']['people'][0]['status'], p['json']['people'][0].get('source'),
                  len(p['json']['people'][0].get('roles') or [])) for p in posted])`);
  if (!r) return;
  assert.deepEqual(r.out.counts, { read: 3, unreadable: 0, unclear: 0 });
  assert.deepEqual(r.out.opened, ['https://www.linkedin.com/in/invented-a/', 'https://www.linkedin.com/in/invented-b/', 'https://www.linkedin.com/in/invented-c/'],
    'highest power first; Dov, read already, is never opened');
  assert.equal(r.out.views.length, 3, 'one profile view each');
  const [a, b, c] = r.out.at;
  assert.ok(b - a >= 60 && c - b >= 60, `${b - a}s, then ${c - b}s apart`);
  assert.deepEqual(r.out.sent, [
    ['https://www.linkedin.com/in/invented-a/', 'read', 'data', 3],
    ['https://www.linkedin.com/in/invented-b/', 'read', 'page', 4],
    ['https://www.linkedin.com/in/invented-c/', 'read', 'data', 3],
  ]);
  assert.match(r.log, /Experience: 3 roles \(1 current\), from LinkedIn's own data\. LinkedIn's own data had 3; the page had no Experience section\./);
  assert.match(r.log, /Experience: 4 roles \(1 current\), from the page\. LinkedIn's own data had 0; the page's Experience section, found by its heading, had 4 \(LinkedIn says 6 in all/);
});

test('a profile it can\'t read is sent as "couldn\'t read", never as no experience, and three in a row end the round', (t) => {
  const r = run(t, `${PEOPLE}
ROWS[3].pop('experience')
page = ProfilePage({})       # every profile renders, and nothing in it can be read
install_browser(page)
try:
    ns['read_profiles'](batch=10)
    out['raised'] = None
except ns['PageUnreadable'] as e:
    out['raised'] = str(e)
out['sent'] = [p['json']['people'][0] for p in posted]
out['opened'] = len(page.opened)`);
  if (!r) return;
  assert.equal(r.out.raised, '3 profiles in a row couldn\'t be read');
  assert.equal(r.out.opened, 3, 'the fourth is never opened');
  for (const p of r.out.sent) {
    assert.equal(p.status, 'unreadable');
    assert.equal(p.why, 'no Experience section on their profile');
    assert.equal(p.roles, undefined, 'never an empty list');
  }
  assert.match(r.log, /Couldn't read their experience: LinkedIn's own data had 0; the page had no Experience section\. Marked "couldn't read", not empty\./);
  assert.match(r.log, /Their experience slow to load, trying again in 2 s \(attempt 1 of 4\)\./, 'looked at again on the curve first');
  assert.doesNotMatch(r.log, /reloading it/, 'never by reopening the profile');
});

test('a security check ends the round at once: no retry, nothing sent for them, and a pause', (t) => {
  const r = run(t, `${PEOPLE}
page = ProfilePage({A: {'data': [POSITIONS]}, B: {'pushback': 'a security check'}})
install_browser(page)
try:
    ns['read_profiles'](batch=10)
    out['raised'] = None
except ns['LinkedInPushedBack'] as e:
    out['raised'] = [e.reason, e.found]
out['sent'] = [p['json']['people'][0]['profileUrl'] for p in posted]
out['opened'] = len(page.opened)
out['cooldown'] = json.loads((home / 'linkedin-cooldown.json').read_text())['reason']`);
  if (!r) return;
  assert.deepEqual(r.out.raised, ['a security check', 1]);
  assert.deepEqual(r.out.sent, ['https://www.linkedin.com/in/invented-a/'], 'only the one read before it');
  assert.equal(r.out.opened, 2);
  assert.equal(r.out.cooldown, 'LinkedIn pushed back: a security check');
  assert.doesNotMatch(r.log, /slow to load/);
});

test('with no profile view left today nothing opens; lifted, the gap still holds', (t) => {
  const r = run(t, `${PEOPLE}
(home / 'scan-limits.json').write_text(json.dumps({'daily': 2}))
(home / 'linkedin-activity.json').write_text(json.dumps({'searches': [], 'profiles': [NOW - 100, NOW - 50]}))
page = ProfilePage({A: {'data': [POSITIONS]}})
install_browser(page)
try:
    ns['read_profiles'](batch=5)
except ns['BudgetReached'] as e:
    out['kind'] = e.kind
out['opened'] = len(page.opened)
ns['LIMITS']['lifted'] = True
page2 = ProfilePage({A: {'data': [POSITIONS]}, B: {'data': [POSITIONS]}})
install_browser(page2)
ns['read_profiles'](batch=2)
out['lifted'] = [a for _, a in page2.opened]`);
  if (!r) return;
  assert.equal(r.out.kind, 'profiles');
  assert.equal(r.out.opened, 0);
  const [a, b] = r.out.lifted;
  assert.ok(a - (1790000000 - 50) >= 60 && b - a >= 60, 'lifted: no daily cap, the minute between views stays');
});

test('who a round opens is the same in the scanner and the app (lib/experience.js readProfileQueue)', (t) => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const old = new Date(now - (RETRY_UNREADABLE_DAYS + 1) * 86400000).toISOString();
  const recent = new Date(now - 86400000).toISOString();
  const rows = [
    { id: 'a', degree: 1, power_score: 3, profile_url: 'u-a' },
    { id: 'b', degree: 1, power_score: 8, profile_url: 'u-b' },
    { id: 'c', degree: 1, power_score: 9, profile_url: 'u-c', experience: JSON.stringify({ v: 1, status: 'unreadable', at: old, why: 'x' }) },
    { id: 'd', degree: 1, power_score: 9.5, profile_url: 'u-d', experience: JSON.stringify({ v: 1, status: 'unreadable', at: recent, why: 'x' }) },
    { id: 'e', degree: 1, power_score: 10, profile_url: 'u-e', experience: JSON.stringify({ v: 1, status: 'read', at: recent, roles: [{ title: 'CEO' }] }) },
    { id: 'f', degree: 2, power_score: 10, profile_url: 'u-f' },
    { id: 'g', degree: 1, power_score: 10, profile_url: null },
  ];
  const js = readProfileQueue(rows, now).map((r) => r.id);
  assert.deepEqual(js, ['b', 'a', 'c'], 'new ones by power, then one that failed long enough ago; never one read');
  assert.deepEqual(experienceCounts(rows, now), { read: 1, unreadable: 2, waiting: 3 });
  const r = run(t, `out['ids'] = [x['id'] for x in ns['profile_read_targets'](${JSON.stringify(rows).replace(/null/g, 'None')}, now=${now / 1000})]`);
  if (!r) return;
  assert.deepEqual(r.out.ids, js);
});

// ── the app's side ──────────────────────────────────────────────────────────

test('stored as read only with a role in it; anything else is "couldn\'t read", with why', () => {
  const at = '2026-10-05T12:00:00.000Z';
  assert.deepEqual(cleanExperience({ status: 'read', roles: [{ title: ' CEO ', company: 'Quillon Labs', start: '2022-03', end: null, current: true }, { title: '' }], source: 'data', shown: 4, at }), {
    v: 1, status: 'read', at, source: 'data', shown: 4,
    roles: [{ title: 'CEO', company: 'Quillon Labs', start: '2022-03', end: null, current: true }],
  });
  assert.deepEqual(cleanExperience({ status: 'read', roles: [], at }), { v: 1, status: 'unreadable', at, why: 'no role in it could be read' });
  assert.deepEqual(cleanExperience({ status: 'unreadable', why: 'no Experience section on their profile', at }),
    { v: 1, status: 'unreadable', at, why: 'no Experience section on their profile' });
  assert.equal(cleanExperience({ status: 'read', roles: [{ title: 'x', start: 'March 2020' }], at }).roles[0].start, null, 'only dates it wrote');
  assert.equal(cleanExperience({ status: 'read', roles: Array.from({ length: 50 }, (_, i) => ({ title: `Role ${i}` })), at }).roles.length, 30);
});

test('scoring counts the roles read: a current one like the headline\'s, a past one as former, never lower', () => {
  const row = { degree: 1, headline: 'Advisor and mentor', company: null };
  const before = scorePerson(row);
  const exp = (roles) => JSON.stringify({ v: 1, status: 'read', at: '2026-10-05T00:00:00Z', source: 'page', roles });
  const withCurrent = { ...row, experience: exp([{ title: 'Vice President, Engineering', company: 'Quillon Labs', current: true }]) };
  const withPast = { ...row, experience: exp([{ title: 'Vice President, Engineering', company: 'Quillon Labs', end: '2020-01', current: false }]) };
  const now = scorePerson(withCurrent);
  const then = scorePerson(withPast);
  assert.ok(now.power > before.power, `${now.power} > ${before.power}`);
  assert.ok(then.power > before.power && then.power < now.power, 'a past role counts, at 70%');
  assert.equal(then.title.former, true);
  assert.ok(rolesWithCompanies(withCurrent).some((r) => r.fromProfile && r.company === 'Quillon Labs' && !r.former));
  const unreadable = { ...row, experience: JSON.stringify({ v: 1, status: 'unreadable', at: '2026-10-05T00:00:00Z', why: 'x' }) };
  assert.deepEqual(scorePerson(unreadable), before, '"couldn\'t read" changes nothing');
  // The headline's own role isn't counted twice.
  const vp = { degree: 1, headline: 'Vice President, Engineering at Quillon Labs', experience: exp([{ title: 'VP Engineering', company: 'Quillon Labs', current: true }]) };
  assert.equal(rolesWithCompanies(vp).length, 1);
  assert.deepEqual(experienceRoles({ experience: 'not json' }), []);
});

// ── /api/ingest, type "experience" ──────────────────────────────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-experience-ingest-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
let POST, getDb;
before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});
beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM linkedin_connections');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, headline, profile_url) VALUES ('a', 'me', 1, 'Ada Quill', 'Advisor and mentor', 'https://www.linkedin.com/in/invented-a/')`).run();
});
const send = async (people) => (await POST(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'experience', userId: 'me', people }),
}))).json();

test('the scanner\'s answer is kept on their row, and they are rescored with it', async () => {
  const before = getDb().prepare("SELECT power_score FROM linkedin_connections WHERE id = 'a'").get();
  const res = await send([
    { profileUrl: 'https://www.linkedin.com/in/invented-a/', status: 'read', source: 'data', roles: [{ title: 'Chief Executive Officer', company: 'Quillon Labs', start: '2020-01', current: true }] },
    { profileUrl: 'https://www.linkedin.com/in/nobody-invented/', status: 'unreadable', why: 'x' },
  ]);
  assert.deepEqual(res, { ok: true, saved: 1, unreadable: 0, notFound: 1 });
  const row = getDb().prepare("SELECT experience, power_score FROM linkedin_connections WHERE id = 'a'").get();
  const e = JSON.parse(row.experience);
  assert.equal(e.status, 'read');
  assert.equal(e.roles[0].company, 'Quillon Labs');
  assert.ok(row.power_score > (before.power_score || 0), 'rescored with the role read');
});

test('a read with nothing in it is stored as "couldn\'t read"', async () => {
  const res = await send([{ profileUrl: 'https://www.linkedin.com/in/invented-a/', status: 'read', roles: [] }]);
  assert.deepEqual(res, { ok: true, saved: 0, unreadable: 1, notFound: 0 });
  const e = JSON.parse(getDb().prepare("SELECT experience FROM linkedin_connections WHERE id = 'a'").get().experience);
  assert.equal(e.status, 'unreadable');
  assert.equal(e.roles, undefined);
  const bad = await POST(new Request('http://127.0.0.1/api/ingest', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'experience', people: [] }),
  }));
  assert.equal(bad.status, 400);
});
