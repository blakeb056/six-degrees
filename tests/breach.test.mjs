// Breach (Blake, 2026-10-15): get into a company with no mutuals, doors first,
// then climb (app/breach, lib/breach.js). The score and its seat weights, the
// milestones, the bands, who works there now, the scanner's keyword search and
// its arguments, the comparison of companies, and acceptances from saved data.
//
// The scanner's side runs its own code against stand-in pages and a stand-in
// clock (tests/helpers/scanner_harness.py), on a scratch data folder. Nothing
// opens a browser or reaches LinkedIn. Invented people and companies only.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';
import {
  employment, seatOf, bandOf, breachPeople, breachScore, meterLine, weeklyPlan, acceptances, compareCompanies,
  breachRoundArgs, breachKey, breachDegrees, companySearchUrl, breachNotes, mapSpread, homeCity, companyName,
  SEAT_WEIGHTS, BREACH_WEEKLY, BREACH_SETTING, LIFT,
} from '../lib/breach.js';
import { capabilityRefusal, capabilities, PLUGIN_SINCE, AUTO_ACTIONS, pluginTooOld } from '../lib/scanner-capabilities.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';
import { scanDoneNotification } from '../lib/notifications.js';
import { SETTINGS } from '../lib/settings.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-breach-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let POST, getDb;
before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* the temp cleanup gets it */ } });
});
beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta', 'connection_ties']) getDb().exec(`DELETE FROM ${t}`);
});

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const url = (slug) => `https://www.linkedin.com/in/${slug}/`;
let n = 0;
const row = (headline, extra = {}) => ({ id: `r${++n}`, name: `Invented ${n}`, headline, profile_url: url(`invented-${n}`), degree: 2, ...extra });

// ── who works there ──────────────────────────────────────────────────────────

test('a keyword search finds three kinds of people: who works there now, alumni, and mentions', () => {
  const at = (h, extra) => employment({ headline: h, ...extra }, 'Northwind Labs');
  assert.equal(at('VP Sales at Northwind Labs'), 'current');
  assert.equal(at('Engineer @ Northwind Labs | Builder'), 'current');
  assert.equal(at('Co-founder & CEO, Northwind Labs'), 'current');
  assert.equal(at('Recruiter at Northwind Labs in Austin'), 'current');
  assert.equal(at('Ex-Northwind Labs | Founder at Quillon'), 'alumni');
  assert.equal(at('Former PM at Northwind Labs'), 'alumni');
  assert.equal(at('Northwind Labs alum, now at Quillon'), 'alumni');
  assert.equal(at('Customer of Northwind Labs and Quillon'), 'mention');
  assert.equal(at('Director at Quillon'), 'mention');
  // The company the search was for, or the one ingest guessed from it, says nothing: only the headline does.
  assert.equal(at('Former PM at Northwind Labs', { scanned_company: 'Northwind Labs', company: 'Northwind Labs' }), 'alumni');
  assert.equal(at('Writer', { scanned_company: 'Northwind Labs', company: 'Northwind Labs' }), 'mention');
  // Roles Read profiles read count too.
  const exp = JSON.stringify({ status: 'read', roles: [{ title: 'Head of Design', company: 'Northwind Labs', current: true }] });
  assert.equal(at('Designer and speaker', { experience: exp }), 'current');
});

test('the seat is the role there when the headline names it, else the first title', () => {
  assert.deepEqual(seatOf({ headline: 'Advisor at Quillon | VP Sales at Northwind Labs' }, 'Northwind Labs'),
    { level: 5, key: 'vp', label: 'VP / Partner / GM', title: 'VP Sales' });
  assert.equal(seatOf({ headline: 'Chief Revenue Officer @Northwind Labs' }, 'Northwind Labs').level, 6);
  assert.equal(seatOf({ headline: 'Senior Software Engineer at Northwind Labs' }, 'Northwind Labs').level, 2);
});

// ── the score ────────────────────────────────────────────────────────────────

const person = (level, extra = {}) => ({
  id: `p${++n}`, name: `Invented ${n}`, employment: 'current', inside: false, power: 0,
  seat: { level, title: `Seat ${level}` }, ...extra,
});

test('the score: mapping counts a little, each person inside by seat, the top seats weighing most', () => {
  assert.deepEqual(SEAT_WEIGHTS, { 0: 1, 1: 3, 2: 4, 3: 6, 4: 10, 5: 22, 6: 34 });
  assert.ok(SEAT_WEIGHTS[5] >= 2 * SEAT_WEIGHTS[4], 'a VP is a big jump');
  assert.ok(SEAT_WEIGHTS[6] > SEAT_WEIGHTS[5], 'C-suite or a founder the biggest');

  assert.equal(breachScore([]).score, 0, 'nothing known');
  const mapped = Array.from({ length: 30 }, () => person(1));
  assert.equal(breachScore(mapped).mapped, 5, 'known there: 4, and one more per 25');
  assert.equal(breachScore(Array.from({ length: 400 }, () => person(1))).mapped, 10, 'never more than 10');

  const ic = breachScore([...mapped, person(1, { inside: true })]);
  assert.equal(ic.score, 5 + 3);
  const vp = breachScore([...mapped, person(5, { inside: true })]);
  assert.equal(vp.score, 5 + 22);
  const ceo = breachScore([...mapped, person(6, { inside: true })]);
  assert.equal(ceo.score, 5 + 34);

  // A second at the same seat half as much, a third a third: ten ICs never outweigh one VP.
  const tenIcs = breachScore(Array.from({ length: 10 }, () => person(1, { inside: true })));
  assert.equal(tenIcs.score, Math.round(3 * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5 + 1 / 6 + 1 / 7 + 1 / 8 + 1 / 9 + 1 / 10)));
  assert.ok(tenIcs.score < 22);
  // Alumni and mentions are never inside, and never counted.
  assert.equal(breachScore([person(6, { inside: true, employment: 'alumni' })]).score, 0);
  // Capped at 100.
  assert.equal(breachScore([...mapped, ...Array.from({ length: 6 }, () => person(6, { inside: true })), person(5, { inside: true }), person(5, { inside: true })]).score, 100);
});

test('the meter says the score and the highest seat reached; milestones light with who reached them', () => {
  const s = breachScore([
    person(1, { inside: true, name: 'Invented Ada', when: '2026-09-01' }),
    person(4, { inside: true, name: 'Invented Ben', when: '2026-10-01', seat: { level: 4, title: 'Director of Sales' } }),
    person(5, { inside: true, name: 'Invented Cy', when: '2026-10-10', seat: { level: 5, title: 'VP Sales' } }),
    person(3),
  ]);
  assert.equal(s.score, 4 + 22 + 10 + 3);
  assert.equal(meterLine(s), 'Breach 39 · highest seat VP Sales');
  assert.equal(meterLine(breachScore([person(2)])), 'Breach 4 · no one inside yet');
  assert.deepEqual(s.milestones.map((m) => [m.label, m.reached, m.who?.name ?? null]), [
    ['First door', true, 'Invented Ada'],
    ['First director', true, 'Invented Ben'],
    ['First VP', true, 'Invented Cy'],
    ['First C-suite', false, null],
  ]);
});

// ── bands ────────────────────────────────────────────────────────────────────

test('bands: by seat, a recruiter always a door, and mutuals, your city or school lift a band', () => {
  const band = (level, extra = {}, you = {}) => bandOf({ seat: { level, label: 'IC / Entry' }, headline: 'Invented headline', ...extra }, you).band;
  assert.equal(band(1), 'doors');
  assert.equal(band(2), 'doors');
  assert.equal(band(3), 'climb');
  assert.equal(band(4), 'climb');
  assert.equal(band(5), 'summit');
  assert.equal(band(6), 'summit');
  assert.equal(band(4, { headline: 'Head of Talent Acquisition at Northwind Labs' }), 'doors', 'a recruiter is a door');
  // People move up a band as their mutual counts rise on rescans.
  assert.equal(band(3, { mutuals: 1 }), 'doors');
  assert.equal(band(5, { mutuals: 1 }), 'climb');
  assert.equal(band(5, { mutuals: LIFT.two - 1 }), 'climb');
  assert.equal(band(5, { mutuals: LIFT.two }), 'doors');
  assert.equal(band(5, { location: 'Orlando, Florida, United States' }, { city: 'Orlando' }), 'climb', 'your city');
  assert.equal(band(3, { location: 'Greater Orlando Area' }, { city: 'Orlando, Florida' }), 'doors');
  assert.equal(band(3, { headline: 'Product Lead at Northwind Labs | UCF alum' }, { school: 'UCF' }), 'doors', 'your school');
  assert.equal(band(3, { headline: 'Product Lead at Northwind Labs' }, { school: 'UCF' }), 'climb');
  const why = bandOf({ seat: { level: 3 }, headline: 'Talent Partner at Northwind Labs', mutuals: 3, location: 'Orlando, Florida' }, { city: 'Orlando' });
  assert.deepEqual(why, { band: 'doors', why: ['Recruiter', '3 mutuals', 'Your city'], lifted: false });
});

test('your city is a guess from where most of your connections are, and only once three agree', () => {
  const at = (location) => ({ location });
  assert.equal(homeCity([at('Orlando, Florida, United States'), at('Greater Orlando Area'), at('Orlando, Florida'), at('Austin, Texas')]), 'Orlando');
  assert.equal(homeCity([at('Orlando, Florida'), at('Austin, Texas')]), '');
});

// ── a company's people, the plan, acceptances ────────────────────────────────

function company() {
  n = 0;
  return {
    degree1: [
      row('VP Sales at Northwind Labs', { degree: 1, outreach_status: 'sent', scanned_company: 'Northwind Labs', connected_date: '2026-10-12' }),
      row('Engineer at Northwind Labs', { degree: 1, connected_date: '2025-03-01' }),
      row('Former Designer at Northwind Labs', { degree: 1 }),
      row('Director at Quillon', { degree: 1 }),
    ],
    degree2: [
      row('Analyst at Northwind Labs', { mutual_count: 4, source_connection_id: 'r2' }),
      row('Senior Recruiter at Northwind Labs', { mutual_count: 0 }),
      row('Engineering Manager at Northwind Labs', { mutual_count: 2 }),
      row('CEO at Northwind Labs', { mutual_count: 0 }),
      row('Engineer at Northwind Labs', { mutual_count: 1, outreach_status: 'sent' }),
    ],
    degree3: [
      row('Director of Product at Northwind Labs', { degree: 3, scanned_company: 'Northwind Labs', mutual_count: 0 }),
      row('Customer of Northwind Labs', { degree: 3, scanned_company: 'Northwind Labs' }),
      row('Pastry chef at Quillon', { degree: 3, scanned_company: 'Quillon' }),
      // The same person as a circle copy above: once, with the higher mutual count.
      { ...row('Analyst at Northwind Labs', { degree: 3, scanned_company: 'Northwind Labs', mutual_count: 6 }), profile_url: url('invented-5') },
    ],
  };
}

test('everyone at the company once, closest degree, inside, requested and accepted read from saved data', () => {
  const people = breachPeople(company(), 'Northwind Labs');
  const by = (h) => people.find((p) => p.headline === h);
  assert.equal(people.filter((p) => p.headline === 'Analyst at Northwind Labs').length, 1, 'one per person');
  assert.equal(by('Analyst at Northwind Labs').degree, 2);
  assert.equal(by('Analyst at Northwind Labs').mutuals, 6, 'the newest, highest count of any copy');
  assert.equal(by('VP Sales at Northwind Labs').inside, true);
  assert.equal(by('VP Sales at Northwind Labs').accepted, true, 'inside, after a request you sent');
  assert.equal(by('Engineer at Northwind Labs' ).inside, true);
  assert.equal(by('Former Designer at Northwind Labs').inside, false, 'alumni are never inside');
  assert.equal(by('Former Designer at Northwind Labs').employment, 'alumni');
  assert.equal(by('Customer of Northwind Labs').employment, 'mention', 'kept: the search found them');
  assert.equal(by('Director at Quillon'), undefined);
  assert.equal(by('Pastry chef at Quillon'), undefined);
  assert.equal(people[0].seat.level, 6, 'top seats first');

  const { accepted, pending } = acceptances(people);
  assert.deepEqual(accepted.map((p) => p.headline), ['VP Sales at Northwind Labs']);
  assert.deepEqual(pending.map((p) => p.headline), ['Engineer at Northwind Labs']);
  // The page's shared list of requests wins over the rows' own marks.
  const shared = breachPeople(company(), 'Northwind Labs', { hasRequest: (r) => r.headline === 'CEO at Northwind Labs' });
  assert.deepEqual(acceptances(shared).pending.map((p) => p.headline), ['CEO at Northwind Labs']);
});

test('this week\'s doors: up to 10, doors first and likeliest first, never inside, asked, the summit or a mention', () => {
  const people = breachPeople(company(), 'Northwind Labs');
  const plan = weeklyPlan(people);
  assert.equal(BREACH_WEEKLY, 10);
  assert.deepEqual(plan.map((p) => p.headline), [
    'Analyst at Northwind Labs',
    'Senior Recruiter at Northwind Labs',
    'Engineering Manager at Northwind Labs',
    'Director of Product at Northwind Labs',
  ]);
  assert.deepEqual(plan.map((p) => p.band), ['doors', 'doors', 'doors', 'climb']);
  assert.equal(weeklyPlan(people, { weekly: 2 }).length, 2);
});

test('companies side by side: targets first, then the most breached, open or cold, and doors waiting', () => {
  const net = company();
  net.degree2.push(row('Barista at Quillon', { mutual_count: 3 }), row('Baker at Quillon', { mutual_count: 0 }));
  const list = compareCompanies(net, { targets: ['Halcyon Freight'] });
  assert.equal(list[0].name, 'Halcyon Freight');
  assert.deepEqual(list[0], { name: 'Halcyon Freight', target: true, status: 'cold', score: 0, inside: 0, known: 0, doors: 0, highestSeat: null });
  const nw = list.find((c) => c.name === 'Northwind Labs');
  assert.equal(nw.status, 'open');
  assert.equal(nw.inside, 2);
  assert.equal(nw.highestSeat, 'VP Sales');
  assert.equal(nw.score, breachScore(breachPeople(net, 'Northwind Labs')).score, 'the same score the company view shows');
  assert.equal(nw.doors, 3);
  const q = list.find((c) => c.name === 'Quillon');
  assert.equal(q.status, 'open', 'a director there is one of yours');
  assert.ok(list.indexOf(nw) < list.indexOf(q), 'more breached first');
});

// ── the scanner: the keyword search and its arguments ────────────────────────

test('the keyword search: the company name with the People filter, 2nd and 3rd+ unless asked', () => {
  assert.equal(companySearchUrl('Northwind Labs'),
    'https://www.linkedin.com/search/results/people/?keywords=Northwind%20Labs&network=%5B%22S%22%2C%22O%22%5D&origin=FACETED_SEARCH');
  assert.equal(companySearchUrl('  Northwind   Labs ', ['3', '1', '2']),
    'https://www.linkedin.com/search/results/people/?keywords=Northwind%20Labs&network=%5B%22F%22%2C%22S%22%2C%22O%22%5D&origin=FACETED_SEARCH');
  assert.deepEqual(breachDegrees('3, 2'), ['2', '3']);
  assert.deepEqual(breachDegrees(['9']), ['2', '3'], 'nothing it knows: the default');
  assert.equal(breachKey(' Northwind  Labs', ['2', '3']), 'breach:northwind labs:23');
  assert.deepEqual(breachRoundArgs({}), ['--round=5', '--degrees=2,3']);
  assert.deepEqual(breachRoundArgs({ pages: 10, degrees: ['1', '2', '3'] }), ['--round=10', '--degrees=1,2,3']);
  assert.deepEqual(breachRoundArgs({ pages: 100, degrees: '1; rm -rf' }), ['--round=5', '--degrees=2,3'], 'a fixed set reaches the command line');
  assert.equal(companyName('  Northwind\nLabs  '), 'Northwind Labs');
  assert.equal(companyName('x'), '');
});

test('the scanner builds the same address and key, and takes --breach, --round and --degrees', (t) => {
  const r = scanner(t, `
out['url'] = ns['company_search_url']('Northwind Labs')
out['all'] = ns['company_search_url']('  Northwind   Labs ', '3,1,2')
out['key'] = ns['breach_key'](' Northwind  Labs', '3,2')
out['degrees'] = [ns['breach_degrees'](x) for x in ['3, 2', '1,2,3', 'x', '']]`);
  if (!r) return;
  assert.equal(r.out.url, companySearchUrl('Northwind Labs'));
  assert.equal(r.out.all, companySearchUrl('Northwind Labs', ['1', '2', '3']));
  assert.equal(r.out.key, breachKey('Northwind Labs', ['2', '3']), 'the scanner\'s note and the app\'s key agree');
  assert.deepEqual(r.out.degrees, ['2,3', '1,2,3', '2,3', '2,3']);
  const scrape = src('scripts/scrape.py');
  assert.match(scrape, /parser\.add_argument\("--breach", type=str,/);
  assert.match(scrape, /parser\.add_argument\("--round", type=int, default=BREACH_ROUND,/);
  assert.match(scrape, /parser\.add_argument\("--degrees", type=str, default=BREACH_DEGREES,/);
  assert.match(scrape, /elif args\.breach:\n\s+scan_company_search\(args\.breach, degrees=args\.degrees, pages=args\.round, headless=args\.headless\)/);
});

test('the app runs a round as its own action, with either plugin, counted against the daily limit', () => {
  const route = src('app/api/scraper/route.js');
  assert.match(route, /breach: +\{ flag: '--breach', +needsName: true, label: '[^']+', searches: true \}/);
  assert.match(route, /const readsLists = [^\n]*'breach'/);
  assert.match(route, /\.\.\.\(action === 'breach' \? breachRoundArgs\(\{ pages: body\.pages, degrees: body\.degrees \}\) : \[\]\)/);
  assert.match(route, /breach: me \? breachNotes\(readProgress\(dataDir\(\), me\.id\)\) : \{\}/);
  assert.ok(!AUTO_ACTIONS.includes('breach'), 'by hand runs it too');
  for (const caps of [capabilities({ auto: true, from: 'plugin' }), capabilities({ manual: true, from: 'plugin' }), null]) {
    assert.equal(capabilityRefusal(caps, 'breach'), null);
  }
  assert.equal(PLUGIN_SINCE.breach, '1.0.9');
  assert.equal(SHIPPED_PLUGIN_VERSION, '1.0.9');
  const plugin = (version) => ({ from: 'plugin', plugin: { id: 'manual-scan', name: 'Manual scan', version } });
  assert.match(pluginTooOld(plugin('1.0.8'), 'breach'), /version 1\.0\.9 or newer of the Manual scan plugin/);
  assert.equal(pluginTooOld(plugin('1.0.9'), 'breach'), null);
  assert.equal(scanDoneNotification({ action: 'breach', target: { name: 'Northwind Labs' }, exitCode: 0 }).title, 'Breach round done: Northwind Labs');
});

test('the tab is beside the others, for your own network, and asks LinkedIn nothing itself', () => {
  assert.match(src('app/components/AppTabs.js'), /\{ key: 'breach', href: '\/breach', label: 'Breach', own: true \}/);
  const page = src('app/breach/page.js');
  assert.match(page, /<AppHeader active="breach"/);
  assert.doesNotMatch(page, /scraping|ConnectChoice|'connect'/i, 'no automated invites, and "scanning" only');
  assert.match(page, /runScrape\('breach', \{ name: company, pages: round, degrees, onLog: setLog \}\)/);
  assert.match(page, /spread over days/);
});

test('its note is no one\'s circle, and the tab reads how far each search got', () => {
  const progress = {
    'breach:northwind labs:23': { name: 'Northwind Labs', pages: 12, more: true, total: 640, at: '2026-10-16T09:00:00' },
    'breach:quillon:123': { name: 'Quillon', pages: 100, more: true, total: 4200 },
    'https://www.linkedin.com/in/invented-ada/': { pages: 3, more: true },
  };
  assert.deepEqual(breachNotes(progress), {
    'breach:northwind labs:23': { company: 'Northwind Labs', pages: 12, more: true, total: 640, at: '2026-10-16T09:00:00' },
    'breach:quillon:123': { company: 'Quillon', pages: 100, more: false, total: 4200, at: null },
  });
  assert.deepEqual(mapSpread(breachNotes(progress)['breach:northwind labs:23'], 5), { pages: 64, left: 52, days: 11 });
  assert.deepEqual(mapSpread(breachNotes(progress)['breach:quillon:123'], 5), { pages: 100, left: 0, days: 0 });
  assert.equal(mapSpread({ pages: 1, more: true, total: null }), null, 'LinkedIn\'s count not read yet');
});

test('the breach list is kept with the network, tidied', () => {
  assert.equal(SETTINGS.breach, BREACH_SETTING);
  assert.deepEqual(BREACH_SETTING.parse({ targets: ['Northwind Labs', ' northwind labs ', 'x', 'Quillon'], city: ' Orlando ', school: 'UCF\n' }),
    { targets: ['Northwind Labs', 'Quillon'], city: 'Orlando', school: 'UCF' });
  assert.throws(() => BREACH_SETTING.parse('Northwind'), /Breach settings/);
});

// ── the scanner reading a company, by itself and by hand ─────────────────────

function scanner(t, script) {
  if (noScanner(t)) return null;
  const home = mkdtempSync(path.join(tmpdir(), 'sixgree-breach-scan-'));
  try {
    const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
    if (noPython(t, r)) return null;
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// A company's keyword search as a window: each page has cards and, as LinkedIn draws them, the
// names in their mutual lines (your own connections), which must not be kept as its people.
const COMPANY_PAGE = `
import types
def card(i):
    return {'name': f'Invented Person {i}', 'headline': f'Analyst at Northwind Labs',
            'profileUrl': f'https://www.linkedin.com/in/invented-{i:04d}/', 'imageUrl': '', 'mutualCount': i % 4}
class CompanyPage:
    def __init__(self, pages, plan=(), start=1):
        self.pages, self.plan = pages, sorted(plan, key=lambda x: x[0])
        self.pg, self.foot, self.closed, self.away, self.read_at, self.opened = start, False, False, False, [], []
    def _act(self):
        while self.plan and NOW + self.plan[0][0] <= clock.t:
            _, what = self.plan.pop(0)
            if what == 'foot': self.foot = True
            elif what == 'close': self.closed = True
            elif what == 'away': self.away = True
            elif what == 'back': self.away = False
            elif what == 'next': self.pg, self.foot = self.pg + 1, False
    def people(self):
        mutual = {'name': 'Invented Friend', 'headline': 'Chef at Quillon', 'profileUrl': 'https://www.linkedin.com/in/invented-friend/',
                  'imageUrl': '', 'mutualOnly': True}
        return [card((self.pg - 1) * 10 + i) for i in range(10)] + [mutual]
    @property
    def url(self):
        self._act()
        if self.away:
            return 'https://www.linkedin.com/search/results/people/?keywords=Quillon&page=2'
        return ns['company_search_url']('Northwind Labs') + '&page=' + str(self.pg)
    def goto(self, url, **_):
        self.opened.append(url)
        self.pg = ns['_url_page'](url)
        return types.SimpleNamespace(status=200)
    def wait_for_selector(self, *a, **k):
        pass
    def is_closed(self):
        self._act()
        return self.closed
    def evaluate(self, js, *a):
        self._act()
        if js == ns['AT_FOOT_JS']: return self.foot
        if js == ns['NEXT_STATE_JS']: return 'on' if self.pg < self.pages else 'off'
        if js == ns['CURRENT_PAGE_JS']: return self.pg
        if js == ns['RESULT_COUNT_JS']: return self.pages * 10
        if js == ns['RESULT_LINKS_JS']: return sorted(p['profileUrl'] for p in self.people())
        if js == ns['BRIDGE_RESULTS_JS']:
            self.read_at.append(self.pg)
            return self.people()
        return None
`;

test('the window is on the company\'s search whatever its filters, never a circle or another word', (t) => {
  const r = scanner(t, `
on = lambda u: ns['_company_search'](u, 'Northwind Labs')
out['search'] = on(ns['company_search_url']('Northwind Labs'))
out['paged'] = on(ns['company_search_url']('Northwind Labs', '1,2,3') + '&page=7')
out['plus'] = on('https://www.linkedin.com/search/results/people/?keywords=northwind+labs&page=2')
out['other'] = on('https://www.linkedin.com/search/results/people/?keywords=Quillon')
out['circle'] = on('https://www.linkedin.com/search/results/people/?keywords=Northwind%20Labs&connectionOf=%5B%22ACoAAInvented%22%5D')
out['all'] = on('https://www.linkedin.com/search/results/all/?keywords=Northwind%20Labs')`);
  if (!r) return;
  assert.deepEqual(r.out, { search: true, paged: true, plus: true, other: false, circle: false, all: false });
});

test('by itself: straight to the search, a round of pages, the cards kept with their mutuals, the mutual names not', (t) => {
  const r = scanner(t, `${COMPANY_PAGE}
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
ns['_find_next'] = lambda page, label='Next': object() if page.pg < page.pages else None
def advance(page, pg, back=False):
    if page.pg >= page.pages: return 'end'
    page.pg += 1
    return 'moved'
ns['_advance'] = advance
ns['_read_results_page'] = lambda page: page.evaluate(ns['BRIDGE_RESULTS_JS'])
page = CompanyPage(8)
key = ns['breach_key']('Northwind Labs')
people, status, reach = ns['_scrape_one_bridge'](page, 'Northwind Labs', None, key, max_pages=3, company='Northwind Labs',
                                                company_url=ns['company_search_url']('Northwind Labs'))
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'], 'opened': page.opened,
            'friend': any('friend' in p['profileUrl'] for p in people), 'first': people[0]})`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.equal(r.out.people, 30, 'three pages of ten');
  assert.equal(r.out.friend, false, 'the names in mutual lines are your own connections, not its people');
  assert.equal(r.out.last, 3);
  assert.equal(r.out.more, true, 'LinkedIn has more: the next round carries on');
  assert.deepEqual(r.out.opened, [companySearchUrl('Northwind Labs')], 'no profile opened');
  assert.equal(r.out.first.mutualCount, 0);
  assert.match(r.log, /Going straight to LinkedIn's people search for Northwind Labs\./);
  assert.match(r.log, /^ {2}Opening the people search for Northwind Labs\.\.\.$/m);
  assert.match(r.log, /About 80 results in the search for Northwind Labs: 8 pages\./);
});

test('by hand: each page read at its foot, said as the company\'s people, waiting when the window wanders off', (t) => {
  const r = scanner(t, `${COMPANY_PAGE}
page = CompanyPage(5, [[100, 'foot'], [110, 'next'], [120, 'away'], [150, 'back'], [160, 'foot'], [180, 'close']], start=3)
people, status, reach = ns['_scrape_one_bridge'](page, 'Northwind Labs', None, ns['breach_key']('Northwind Labs'), start_page=3,
                                                max_pages=7, manual=True, company='Northwind Labs',
                                                company_url=ns['company_search_url']('Northwind Labs'))
out.update({'people': len(people), 'status': status, 'last': reach['last'], 'more': reach['more'], 'read': page.read_at})`);
  if (!r) return;
  assert.equal(r.out.status, 'success');
  assert.deepEqual(r.out.read, [3, 4]);
  assert.equal(r.out.people, 20, 'no mutual names');
  assert.equal(r.out.last, 4);
  assert.equal(r.out.more, true);
  assert.match(r.log, /^ {2}Opening the people search for Northwind Labs at page 3\.\.\.$/m);
  assert.match(r.log, /Manual mode: you page through Northwind Labs's list/);
  assert.match(r.log, /LinkedIn needs you: scroll to the bottom of each page of Northwind Labs's people in the Chrome window, then click Next\. Close the window when you're done\.$/m);
  assert.match(r.log, /\(waiting: the window isn't on Northwind Labs's list\. Go back to it to carry on\.\)/);
});

test('a round carries on from its note, reads again from page 1 once done, and saves as the company\'s people', (t) => {
  const r = scanner(t, `
install_browser(types.SimpleNamespace(set_default_timeout=lambda ms: None, set_default_navigation_timeout=lambda ms: None))
calls = []
def one(page, name, bridge_id, key, **kw):
    calls.append({'name': name, 'key': key, 'start': kw.get('start_page'), 'max': kw.get('max_pages'),
                  'company': kw.get('company'), 'url': kw.get('company_url'), 'manual': kw.get('manual')})
    return ([{'name': 'Invented Ada', 'headline': 'Analyst at Northwind Labs', 'profileUrl': 'https://www.linkedin.com/in/invented-ada/', 'mutualCount': 3}],
            'success', {'last': kw.get('max_pages'), 'more': True, 'urn': None, 'found': 1, 'limited': False})
ns['_scrape_one_bridge'] = one
ns['read_cooldown'] = lambda now=None: None
ns['manual_reads'] = lambda: False
ns['localize_images'] = lambda images: images
key = ns['breach_key']('Northwind Labs', '2,3')
note = lambda: ns['load_bridge_progress']().get(key)
ns['scan_company_search']('Northwind  Labs', degrees='3,2', pages=5)
out['first'] = note()
ns['scan_company_search']('Northwind Labs', degrees='2,3', pages=10)
ns['record_bridge_progress'](key, 'Northwind Labs', 64, False)
ns['scan_company_search']('Northwind Labs', pages=99)
out['calls'], out['after'] = calls, note()
out['posted'] = [p['json'] for p in posted if p['url'].endswith('/api/ingest')]`);
  if (!r) return;
  assert.deepEqual(r.out.calls.map((c) => [c.start, c.max]), [[1, 5], [6, 15], [1, 10]], 'a round of pages from where the last stopped; 10 at most');
  for (const c of r.out.calls) {
    assert.equal(c.key, 'breach:northwind labs:23');
    assert.equal(c.company, 'Northwind Labs');
    assert.equal(c.url, companySearchUrl('Northwind Labs'));
    assert.equal(c.manual, false);
  }
  assert.deepEqual([r.out.first.pages, r.out.first.more, r.out.first.name], [5, true, 'Northwind Labs']);
  assert.equal(r.out.posted.length, 3);
  assert.deepEqual(r.out.posted[0], {
    connections: [{ name: 'Invented Ada', headline: 'Analyst at Northwind Labs', profileUrl: 'https://www.linkedin.com/in/invented-ada/', imageUrl: '', mutualCount: 3 }],
    type: 'company', companyName: 'Northwind Labs', userId: null,
  });
  assert.match(r.log, /Breach: mapping Northwind Labs, pages 1 to 5 \(LinkedIn's people search for the name, 2nd, 3rd\+\)/);
  assert.match(r.log, /A round is 5 pages, each a search counted in your daily limit, so a company is mapped over days\./);
  assert.match(r.log, /Every page of the search for Northwind Labs was read before: reading it again from page 1/);
  assert.match(r.log, /The next round carries on from page 6\./);
});

// ── what the app keeps, and acceptances ──────────────────────────────────────

const ingest = async (body) => (await POST(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'me', ...body }),
}))).json();
const rows = (slug) => getDb().prepare(
  'SELECT degree, mutual_count AS mutuals, scanned_company AS scanned, outreach_status AS sent FROM linkedin_connections WHERE profile_url = ? ORDER BY degree',
).all(url(slug)).map((r) => ({ ...r }));
const card = (slug, extra = {}) => ({ name: `Invented ${slug}`, headline: 'Analyst at Northwind Labs', profileUrl: url(slug), ...extra });

test('a company search keeps the mutuals, and a rescan brings them up to date on every copy', async () => {
  await ingest({ connections: [card('ada', { mutualCount: 1 })], type: 'degree2', bridgeId: 'bridge-maya' });
  await ingest({ connections: [card('ada', { mutualCount: 2 }), card('ben', { mutualCount: 0 })], type: 'company', companyName: 'Northwind Labs' });
  assert.deepEqual(rows('ada'), [{ degree: 2, mutuals: 2, scanned: null, sent: null }], 'in a circle already: that copy is brought up to date');
  assert.deepEqual(rows('ben'), [{ degree: 3, mutuals: null, scanned: 'Northwind Labs', sent: null }], 'no mutual line, no count');
  await ingest({ connections: [card('ben', { mutualCount: 3 })], type: 'company', companyName: 'Northwind Labs' });
  assert.deepEqual(rows('ben'), [{ degree: 3, mutuals: 3, scanned: 'Northwind Labs', sent: null }], 'a rescan: the door moves up');
  await ingest({ connections: [card('ben')], type: 'company', companyName: 'Northwind Labs' });
  assert.equal(rows('ben')[0].mutuals, 3, 'a card without a count leaves it');
});

test('acceptances come from saved data: Check for new brings a company\'s person in, keeping the company and the request', async () => {
  await ingest({ connections: [card('cy', { headline: 'VP Sales at Northwind Labs', mutualCount: 1 })], type: 'company', companyName: 'Northwind Labs' });
  getDb().prepare("UPDATE linkedin_connections SET outreach_status = 'sent' WHERE profile_url = ?").run(url('cy'));
  // Check for new: your newest connections, as degree 1.
  const got = await ingest({ connections: [card('cy', { headline: 'VP Sales at Northwind Labs' })], type: 'degree1' });
  assert.equal(got.promoted, 1);
  assert.deepEqual(rows('cy'), [{ degree: 1, mutuals: 1, scanned: 'Northwind Labs', sent: 'accepted' }], 'one row, now yours, the request accepted');
  const network = { degree1: getDb().prepare('SELECT * FROM linkedin_connections WHERE degree = 1').all().map((r) => ({ ...r })) };
  const people = breachPeople(network, 'Northwind Labs');
  assert.deepEqual(acceptances(people).accepted.map((p) => p.name), ['Invented cy']);
  assert.equal(meterLine(breachScore(people)), 'Breach 22 · highest seat VP Sales');
});
