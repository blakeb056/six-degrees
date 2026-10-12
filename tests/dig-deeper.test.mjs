// Dig deeper and the profile's top card (Blake, 2026-10-12: "when people auto scan
// or manual will have the option to dig deeper", built on Read profiles; their
// connection count for the ring, their followers for their score). The top card
// reader runs against stand-in pages; the scanner's wiring against stand-in pages
// and a stand-in clock (tests/helpers/scanner_harness.py). Invented people only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { cleanCard, cleanExperience, experienceCard, readProfileQueue } from '../lib/experience.js';
import { reachIndex, scanFill } from '../lib/reach.js';
import { readLimits, writeLimits } from '../lib/linkedin-limits.js';
import { PYTHON, noPython } from './python.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER = path.join(here, '..', 'scripts', 'scrape.py');
const HARNESS = path.join(here, 'helpers', 'scanner_harness.py');
const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-dig-'));

function scanner(t, home, script) {
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
  if (noPython(t, r)) return null;
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
}

// ── what's kept ─────────────────────────────────────────────────────────────

test('a top card is kept with their experience, read or not, and only when it says something', () => {
  const at = '2026-10-12T15:00:00Z';
  const roles = [{ title: 'Founder', company: 'Invented Sports Media', start: '2019', current: true }];
  const read = cleanExperience({ status: 'read', roles, card: { followers: 27000, connections: 500, connectionsPlus: true } }, at);
  assert.deepEqual(read.card, { followers: 27000, connections: 500, connectionsPlus: true });
  const unreadable = cleanExperience({ status: 'unreadable', why: 'no Experience section', card: { followers: 1204, connections: null } }, at);
  assert.equal(unreadable.status, 'unreadable');
  assert.deepEqual(unreadable.card, { followers: 1204, connections: null, connectionsPlus: false });
  assert.equal(cleanExperience({ status: 'read', roles, card: { followers: null, connections: null } }, at).card, undefined);
  assert.equal(cleanCard({ followers: -3, connections: 'lots' }), null, 'nothing that isn’t a count');
  assert.deepEqual(cleanCard({ connections: 312, connectionsPlus: 'yes' }), { followers: null, connections: 312, connectionsPlus: false });
  assert.deepEqual(experienceCard({ experience: JSON.stringify(read) }), read.card);
  assert.equal(experienceCard({ experience: null }), null);
});

test('Dig deeper is off unless turned on, and only "on" is written', () => {
  const dir = scratch();
  try {
    assert.equal(readLimits(dir).digDeeper, false);
    writeLimits(dir, { digDeeper: true });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8')).digDeeper, true);
    assert.equal(readLimits(dir).digDeeper, true);
    writeLimits(dir, { digDeeper: false });
    assert.equal('digDeeper' in JSON.parse(readFileSync(path.join(dir, 'scan-limits.json'), 'utf8')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a card on its own is kept as status "card", never replaces a read, and keeps them waiting for one', () => {
  const at = '2026-10-12T15:00:00Z';
  const only = cleanExperience({ status: 'card', card: { followers: 64944, connections: 500, connectionsPlus: true } }, at);
  assert.deepEqual(only, { v: 1, status: 'card', at, card: { followers: 64944, connections: 500, connectionsPlus: true } });
  assert.equal(cleanExperience({ status: 'card', card: { followers: null } }, at).status, 'unreadable', 'a card that says nothing is no card');
  assert.deepEqual(experienceCard({ experience: JSON.stringify(only) }), only.card);
  const queue = readProfileQueue([{ degree: 1, profile_url: 'https://www.linkedin.com/in/invented-a/', power_score: 9, experience: JSON.stringify(only) }]);
  assert.equal(queue.length, 1, 'still waiting for their experience');
});

test('the ring takes their connection count from their card when their list has none', () => {
  const person = { id: 'b1', degree: 1, profile_url: 'https://www.linkedin.com/in/invented-bridge/',
    experience: JSON.stringify({ v: 1, status: 'card', at: '2026-10-12T15:00:00Z', card: { followers: 900, connections: 312, connectionsPlus: false } }) };
  const reach = reachIndex([person], [], { lists: { 'https://www.linkedin.com/in/invented-bridge/': { pages: 10, more: true } } });
  const fill = scanFill(person, reach);
  assert.equal(fill.size, 312, 'an exact count under 500 is their list size');
  assert.ok(Math.abs(fill.read - 100 / 312) < 1e-9);
});

test('an Experience entry with no company line takes its company from its logo', (t) => {
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, `
items = [
  {'lines': ['Account Manager', 'Oct 2018 - Mar 2021 · 2 yrs 6 mos', 'Invented staffing company description.'], 'subs': [], 'logo': 'Invented Staffing'},
  {'lines': ['Technical Recruiter', 'Invented Search Partners · Full-time', 'Mar 2017 - Oct 2018 · 1 yr 8 mos'], 'subs': [], 'logo': 'Something Else'},
  {'lines': ['Invented Robotics', 'Full-time · 4 yrs'], 'subs': [['Senior Recruiter', 'Mar 2021 - Present · 4 yrs']], 'logo': 'Invented Robotics'},
]
out['roles'] = [[x['title'], x['company'], x['current']] for x in ns['roles_from_items'](items)]`], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: scratch() } });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trimEnd().split('\n').pop().replace(/^RESULT /, ''));
  assert.equal(out.roles.length, 3);
  const by = Object.fromEntries(out.roles.map(([title, company]) => [title, company]));
  assert.equal(by['Account Manager'], 'Invented Staffing', 'no company line: the logo names it');
  assert.equal(by['Technical Recruiter'], 'Invented Search Partners', 'a company line still wins over the logo');
  assert.equal(by['Senior Recruiter'], 'Invented Robotics');
});

// ── the top card reader ─────────────────────────────────────────────────────

function topCardJs() {
  const src = readFileSync(SCRAPER, 'utf8');
  const start = src.indexOf('TOP_CARD_JS = r"""') + 'TOP_CARD_JS = r"""'.length;
  return src.slice(start, src.indexOf('"""', start));
}

/** A profile as far as the reader looks: the section with their name, the connections link, the page's sections. */
function profile({ card = '', link = null, sections = [] }) {
  const cardSection = { innerText: card };
  const h1 = { closest: () => cardSection, parentElement: cardSection };
  return {
    querySelector: (q) => (q === 'main h1' ? h1 : null),
    querySelectorAll: (q) => {
      if (q.includes('connectionOf')) return link ? [{ innerText: link }] : [];
      if (q === 'main section') return [cardSection, ...sections.map((innerText) => ({ innerText }))];
      return [];
    },
  };
}
// As plain data: an object made inside the sandbox isn't deep-equal to one made here.
const readCard = (doc) => JSON.parse(JSON.stringify(vm.runInNewContext(`(${topCardJs()})()`, { document: doc })));

test('the top card: "500+ connections", followers in K and M, and an exact count under 500', () => {
  assert.deepEqual(readCard(profile({ card: 'Jamie Invented\nFounder at Invented Sports Media\nNew York · Contact info\n27K followers · 500+ connections' })),
    { followers: 27000, connections: 500, connectionsPlus: true });
  assert.deepEqual(readCard(profile({ card: 'Riley Invented\nProfessor\n1.2M followers\n312 connections' })),
    { followers: 1200000, connections: 312, connectionsPlus: false });
  assert.deepEqual(readCard(profile({ card: 'Sam Invented\nAnalyst', link: '500+ connections' })),
    { followers: null, connections: 500, connectionsPlus: true }, 'the link the search id comes from says it too');
});

test('the top card: followers from their own Activity heading, never from Interests or anyone else', () => {
  const doc = profile({
    card: 'Avery Invented\nChief People Officer\n500+ connections',
    sections: ['Activity\n12,480 followers\nPosts', 'Interests\nTop Voices\nInvented Retail Co\n1,234,567 followers'],
  });
  assert.deepEqual(readCard(doc), { followers: 12480, connections: 500, connectionsPlus: true });
  const noActivity = profile({ card: 'Avery Invented\nChief People Officer', sections: ['Interests\nInvented Retail Co\n1,234,567 followers'] });
  assert.deepEqual(readCard(noActivity), { followers: null, connections: null, connectionsPlus: false });
});

// ── the scanner's wiring ────────────────────────────────────────────────────

// One window: their profile, then their list. `card` is what the top card says,
// `roles_at` when (seconds) their Experience section shows (manual mode scrolls to it).
const WINDOW = `
URN = 'ACoAAInventedUrn'
PROFILE = 'https://www.linkedin.com/in/invented-bridge/'
ITEMS = [{'lines': ['Founder', 'Invented Sports Media · Full-time', 'Jan 2019 - Present · 5 yrs'], 'subs': []}]
class Window:
    def __init__(self, card=None, roles_at=0):
        self.card, self.roles_at, self.opened, self.listeners = card, roles_at, [], {}
        self.at = None
    def on(self, event, fn): self.listeners.setdefault(event, []).append(fn)
    def remove_listener(self, event, fn): self.listeners.get(event, []).remove(fn)
    def goto(self, url, **_):
        self.at = url
        self.opened.append(url.split('?')[0])
        return types.SimpleNamespace(status=200)
    @property
    def url(self): return self.at or ''
    def is_closed(self): return False
    def wait_for_selector(self, *a, **k): pass
    def evaluate(self, js, *a):
        profile = self.at == PROFILE
        if js == ns['TOP_CARD_JS']: return self.card if profile else {}
        if js == ns['PROFILE_SHOWN_JS']: return profile
        if js == ns['EXPERIENCE_JS']:
            return {'found': True, 'how': 'heading', 'items': ITEMS} if profile and clock.t - NOW >= self.roles_at else {'found': False}
        if js == ns['EMBEDDED_DATA_JS']: return []
        if js == ns['BRIDGE_RESULTS_JS']: return [] if profile else [person(i) for i in range(10)]
        if js == ns['RESULT_COUNT_JS']: return None
        return None
pushed = []
ns['push_experience'] = lambda person, result: pushed.append({'url': person['profile_url'], **result})
ns['_wait_for_profile_view'] = lambda page: None
ns['_find_connection_urn'] = lambda page: URN if page.at == PROFILE else None
ns['read_experience'] = lambda page, responses: ({'status': 'read', 'roles': [{'title': 'Founder', 'company': 'Invented Sports Media', 'current': True}], 'source': 'page', 'shown': 1}, '  Experience: 1 role (1 current), from the page.')
def scan(window, urn=None, dig=False, manual=False):
    out = ns['_scrape_one_bridge'](window, 'Invented Bridge', 'b1', PROFILE, max_pages=1, urn=urn, dig=dig, manual=manual)
    return {'status': out[1], 'opened': window.opened, 'pushed': pushed, 'cards': ns['_LIST_CARDS']}
`;

test('a first scan reads the top card on the profile it opens anyway, for the ring and their card, with Dig deeper off', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
out.update(scan(Window(card={'followers': 27000, 'connections': 500, 'connectionsPlus': True})))`);
    if (!r) return;
    assert.equal(r.out.opened[0], 'https://www.linkedin.com/in/invented-bridge/');
    assert.deepEqual(r.out.cards['https://www.linkedin.com/in/invented-bridge/'], { followers: 27000, connections: 500, connectionsPlus: true });
    // The card on its own goes to their row (status "card"), for their card and their score;
    // their experience isn't read without Dig deeper.
    assert.deepEqual(r.out.pushed, [{ url: 'https://www.linkedin.com/in/invented-bridge/', status: 'card',
      card: { followers: 27000, connections: 500, connectionsPlus: true } }]);
    assert.match(r.log, /Their profile: 500\+ connections, 27,000 followers\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Dig deeper on a first scan: their experience and card go to their row, on the same profile view', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
out.update(scan(Window(card={'followers': 1204, 'connections': 312, 'connectionsPlus': False}), dig=True))`);
    if (!r) return;
    assert.equal(r.out.opened.filter((u) => u.includes('/in/')).length, 1, 'one profile view, the one a first scan makes anyway');
    assert.equal(r.out.pushed.length, 1);
    const p = r.out.pushed[0];
    assert.equal(p.url, 'https://www.linkedin.com/in/invented-bridge/');
    assert.equal(p.status, 'read');
    assert.deepEqual(p.card, { followers: 1204, connections: 312, connectionsPlus: false });
    assert.match(r.log, /Dig deeper: reading Invented Bridge's profile while it's open\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('carrying on with their search id known: straight to their list, unless Dig deeper opens their profile once', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
w = Window(card={'followers': 50, 'connections': 500, 'connectionsPlus': True})
out['plain'] = scan(w, urn=URN)['opened'][:]
pushed.clear()
w2 = Window(card={'followers': 50, 'connections': 500, 'connectionsPlus': True})
out['dig'] = scan(w2, urn=URN, dig=True)`);
    if (!r) return;
    assert.ok(r.out.plain.every((u) => !u.includes('/in/')), 'no profile opened');
    assert.equal(r.out.dig.opened[0], 'https://www.linkedin.com/in/invented-bridge/', 'opened once to dig deeper');
    assert.ok(r.out.dig.opened.slice(1).every((u) => u.includes('/search/')), 'then their list');
    assert.equal(r.out.dig.pushed.length, 1);
    assert.match(r.log, /Dig deeper: opening Invented Bridge's profile once to read it \(a profile view\), then their list\./);
    assert.match(r.log, /Going straight to Invented Bridge's connections/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manual mode digs by hand: it waits for you to reach their Experience, then reads it; never scrolls itself', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
chimes = []
ns['_chime'] = lambda name: chimes.append(name)
w = Window(card={'followers': 900, 'connections': 500, 'connectionsPlus': True}, roles_at=20)
w.goto(PROFILE)
result, note = ns['_read_experience_by_hand'](w, [], 'Invented Bridge')
out['result'] = result
out['waited'] = clock.t - NOW
out['chimes'] = chimes
w2 = Window(roles_at=10 ** 6)
w2.goto(PROFILE)
out['timeout'] = ns['_read_experience_by_hand'](w2, [], 'Invented Bridge')`);
    if (!r) return;
    assert.equal(r.out.result.status, 'read');
    assert.equal(r.out.result.roles[0].title, 'Founder');
    assert.ok(r.out.waited >= 20, 'read once you scrolled to it');
    assert.deepEqual(r.out.chimes, ['read-1']);
    assert.equal(r.out.timeout[0], null, 'not reached: nothing is noted, so the next scan tries again');
    assert.match(r.log, /LinkedIn needs you: scroll down Invented Bridge's profile to their Experience/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('their connection count is kept with where their list got to, and a later read without one keeps it', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
URL = 'https://www.linkedin.com/in/invented-bridge/'
ns['_LIST_CARDS'][URL] = {'followers': 10, 'connections': 500, 'connectionsPlus': True}
ns['record_bridge_progress'](URL, 'Invented Bridge', 3, True, 'ACoAAInventedUrn')
first = dict(ns['load_bridge_progress']().get(URL) or {})
ns['_LIST_CARDS'].clear()
ns['record_bridge_progress'](URL, 'Invented Bridge', 5, True, 'ACoAAInventedUrn')
second = dict(ns['load_bridge_progress']().get(URL) or {})
out['first'] = {k: first.get(k) for k in ('pages', 'connections', 'connectionsPlus')}
out['second'] = {k: second.get(k) for k in ('pages', 'connections', 'connectionsPlus')}`);
    if (!r) return;
    assert.deepEqual(r.out.first, { pages: 3, connections: 500, connectionsPlus: true });
    assert.deepEqual(r.out.second, { pages: 5, connections: 500, connectionsPlus: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
