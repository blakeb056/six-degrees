// Where someone is and their follower count, read off their card in every list
// the scanner reads (Blake, 2026-10-14: "it will collect the location on each
// connection as it shows in the lists"), and where their profile's top card says
// they are (Dig deeper). These run the real page readers (scrape.py's *_JS, as
// Python sends them) against small stand-in pages, and the scanner's own code
// against stand-in windows (tests/helpers/scanner_harness.py). Nothing here
// opens LinkedIn; the wording is LinkedIn's, the people invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';

const READERS = ['BRIDGE_RESULTS_JS', 'CONNECTIONS_EXTRACT_JS', 'SEARCH_RESULTS_JS', 'TOP_CARD_JS'];

/** Each reader as Python delivers it (a raw string, read through the AST). */
function readers(t) {
  if (noScanner(t)) return null;
  const run = spawnSync(PYTHON, ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
out = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in ${JSON.stringify(READERS)}:
                out[t.id] = node.value.value
print(json.dumps(out))
`, SCRAPER], { encoding: 'utf8' });
  if (noPython(t, run)) return null;
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

/** The card-lines helpers (placeOf, followersOf), cut out between their markers. */
function block(js) {
  const start = js.indexOf('// card lines: begin');
  const end = js.indexOf('// card lines: end');
  assert.ok(start > 0 && end > start, 'the markers are there');
  return js.slice(start, end).split('\n').map((l) => l.trim()).join('\n');
}
const helpers = (js) => vm.runInNewContext(`(() => { ${block(js)}; return { placeOf, followersOf }; })()`);

const scratch = () => mkdtempSync(path.join(tmpdir(), 'sixgree-location-'));
function scanner(t, script) {
  const home = scratch();
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

// Lines a card holds, each with the place it is (or '' when it is none).
const PLACES = [
  ['Seattle, Washington, United States', 'Seattle, Washington, United States'],
  ['Greater London', 'Greater London'],
  ['San Francisco Bay Area', 'San Francisco Bay Area'],
  ['Rio de Janeiro, Brazil', 'Rio de Janeiro, Brazil'],
  ['Frankfurt am Main, Hesse, Germany', 'Frankfurt am Main, Hesse, Germany'],
  ['Washington DC-Baltimore Area', 'Washington DC-Baltimore Area'],
  ['São Paulo, São Paulo, Brazil', 'São Paulo, São Paulo, Brazil'],
  ['Greater St. Louis', 'Greater St. Louis'],
  ['Abidjan, Côte d’Ivoire', 'Abidjan, Côte d’Ivoire'],
  ['  Lisbon,   Portugal ', 'Lisbon, Portugal'],
  // What else a card says, never a place.
  ['Founder at ThriftyFox Labs', ''],
  ['VP Sales | Speaker | Advisor', ''],
  ['Maya Chen is a mutual connection', ''],
  ['Maya Chen and 23 other mutual connections', ''],
  ['· 3,766 followers', ''],
  ['3K followers', ''],
  ['500+ connections', ''],
  ['Follow', ''],
  ['Connect', ''],
  ['Message', ''],
  ['Contact info', ''],
  ['LinkedIn Member', ''],
  ['Current: Founder at Northwind Labs', ''],
  ['Provides services - Web Design, Marketing', ''],
  ['Engineer @ Initech', ''],
  ['Connected on March 3, 2026', ''],
  ['• 2nd', ''],
  ['A, B, C, D, E', ''],
  ['', ''],
];
const FOLLOWERS = [
  ['3,766 followers', 3766],
  ['· 3,766 followers', 3766],
  ['Jeff Invented is a mutual connection · 3,766 followers', 3766],
  ['3K followers', 3000],
  ['3.5K followers', 3500],
  ['1.2M followers', 1200000],
  ['1 follower', 1],
  ['12 followers', 12],
  ['500+ connections', null],
  ['3.766 followers', null],
  ['followers', null],
  ['Seattle, Washington, United States', null],
];

test('every reader carries the same card-lines helpers', (t) => {
  const js = readers(t);
  if (!js) return;
  assert.deepEqual(Object.keys(js).sort(), [...READERS].sort());
  const first = block(js.BRIDGE_RESULTS_JS);
  for (const name of READERS) assert.equal(block(js[name]), first, `${name}'s copy is the same`);
});

test('a place is a place, and nothing else on a card is one; follower counts in every form', (t) => {
  const js = readers(t);
  if (!js) return;
  const { placeOf, followersOf } = helpers(js.BRIDGE_RESULTS_JS);
  for (const [line, place] of PLACES) assert.equal(placeOf(line), place, line);
  for (const [line, n] of FOLLOWERS) assert.equal(followersOf(line), n, line);
});

test('the Python copies (LinkedIn\'s own data) read every line the same way', (t) => {
  const r = scanner(t, `
out['places'] = [ns['place_text'](l) for l in ${JSON.stringify(PLACES.map(([l]) => l))}]
out['followers'] = [ns['followers_text'](l) for l in ${JSON.stringify(FOLLOWERS.map(([l]) => l))}]`);
  if (!r) return;
  assert.deepEqual(r.out.places, PLACES.map(([, p]) => p));
  assert.deepEqual(r.out.followers, FOLLOWERS.map(([, n]) => n));
});

// ── a circle's list (auto and manual read it with BRIDGE_RESULTS_JS) ─────────

/** A results page: each card's lines, a profile link per person, and the page's text in reading order. */
function resultsPage(cards) {
  const anchors = [];
  const text = [];
  for (const c of cards) {
    const card = { innerText: c.lines.join('\n') };
    card.parentElement = { innerText: card.innerText, parentElement: null };
    anchors.push({ getAttribute: () => `/in/${c.slug}?miniProfileUrn=x`, closest: () => null, querySelector: () => null, innerText: c.name, parentElement: card });
    for (const v of c.via || []) {
      anchors.push({ getAttribute: () => `/in/${v.slug}`, closest: () => null, querySelector: () => null, innerText: v.name, parentElement: card });
    }
    text.push(...c.lines);
  }
  const root = { innerText: text.join('\n'), querySelectorAll: () => anchors };
  return { querySelector: () => root, body: root };
}
const bySlug = (results) => Object.fromEntries(results.map((r) => [r.profileUrl.replace('https://www.linkedin.com/in/', '').replace(/\/$/, ''), r]));

test('a circle\'s list: each card\'s place and followers, the headline, mutual and followers lines never taken for a place', (t) => {
  const js = readers(t);
  if (!js) return;
  const results = vm.runInNewContext(`(${js.BRIDGE_RESULTS_JS})()`, { document: resultsPage([
    // As Blake pasted one (2026-10-14), the name and its degree on one line; people invented.
    { slug: 'ada-stone', name: 'Ada Stone', via: [{ slug: 'jeff-invented', name: 'Jeff Invented' }], lines: [
      'Ada Stone  • 2nd', 'Founder at ThriftyFox Labs', 'Seattle, Washington, United States', 'Follow', 'Jeff Invented is a mutual connection', ' · 3,766 followers'] },
    // The other layout: the name alone, a screen-reader line, the degree on its own.
    { slug: 'ben-ortiz', name: 'Ben Ortiz', lines: [
      'Ben Ortiz', 'View Ben Ortiz’s profile', '• 2nd', 'Designer at Halcyon', 'Lisbon, Portugal', 'Maya Chen and 23 other mutual connections', 'Connect', '3K followers'] },
    // No place on the card: the mutual line and the button after the headline are never one.
    { slug: 'cy-moreno', name: 'Cy Moreno', lines: ['Cy Moreno', '• 2nd', 'Founder at Ironwood', 'Maya Chen is a mutual connection', 'Connect'] },
    // A title-cased headline with no place after it, and a "Current:" line where a place would be.
    { slug: 'dee-park', name: 'Dee Park', lines: ['Dee Park', '• 3rd', 'Chief Executive Officer', 'Message'] },
    { slug: 'eli-ward', name: 'Eli Ward', lines: ['Eli Ward', '• 2nd', 'Engineer at Initech', 'Current: Staff Engineer at Initech', 'Connect'] },
    // A name two results share: no place or count, never someone else's.
    { slug: 'member-1', name: 'LinkedIn Member', lines: ['LinkedIn Member', 'Engineer', 'Austin, Texas, United States', '1.2M followers'] },
    { slug: 'member-2', name: 'LinkedIn Member', lines: ['LinkedIn Member', 'Analyst', 'Denver, Colorado, United States', 'Connect'] },
  ]) });
  const by = bySlug(results);
  assert.equal(by['ada-stone'].headline, 'Founder at ThriftyFox Labs', 'the name with its degree beside it is still found');
  assert.equal(by['ada-stone'].location, 'Seattle, Washington, United States');
  assert.equal(by['ada-stone'].followers, 3766);
  assert.equal(by['ada-stone'].mutualCount, 1);
  assert.equal(by['ben-ortiz'].location, 'Lisbon, Portugal');
  assert.equal(by['ben-ortiz'].followers, 3000);
  assert.equal(by['ben-ortiz'].mutualCount, 24);
  assert.equal(by['cy-moreno'].location, undefined);
  assert.equal(by['cy-moreno'].followers, undefined);
  assert.equal(by['dee-park'].headline, 'Chief Executive Officer');
  assert.equal(by['dee-park'].location, undefined);
  assert.equal(by['eli-ward'].location, undefined);
  for (const m of ['member-1', 'member-2']) {
    assert.equal(by[m].location, undefined, m);
    assert.equal(by[m].followers, undefined, m);
  }
});

// ── your own connections (--full / --refresh, CONNECTIONS_EXTRACT_JS) ─────────

test('your connections page: a place under the headline if the card shows one, and never "Connected on" or a button', (t) => {
  const js = readers(t);
  if (!js) return;
  const person = (slug, name, headline, after) => {
    const card = { innerText: [name, headline, ...after].join('\n'), parentElement: null };
    const block = { innerText: card.innerText, parentElement: card };
    return { getAttribute: () => `/in/${slug}/`, closest: () => null, querySelector: () => null, innerText: `${name}\n${headline}`, parentElement: block };
  };
  const anchors = [
    person('fay-lund', 'Fay Lund', 'Engineer at Initech', ['Toronto, Ontario, Canada', 'Connected on March 3, 2026', 'Message']),
    person('gus-hale', 'Gus Hale', 'Recruiter', ['Connected on March 4, 2026', 'Message']),
    person('hal-ames', 'Hal Ames', 'Analyst at Globex', ['Connected on March 5, 2026', '2,400 followers', 'Message']),
  ];
  const root = { querySelectorAll: () => anchors };
  const by = bySlug(vm.runInNewContext(`(${js.CONNECTIONS_EXTRACT_JS})()`, { document: { querySelector: () => root, body: root } }));
  assert.equal(by['fay-lund'].location, 'Toronto, Ontario, Canada');
  assert.equal(by['fay-lund'].connectedDate, 'March 3, 2026');
  assert.equal(by['gus-hale'].location, undefined);
  assert.equal(by['hal-ames'].location, undefined);
  assert.equal(by['hal-ames'].followers, 2400);
  assert.ok(!('_card' in by['fay-lund']), 'nothing of the page itself comes back');
});

// ── a company's people and --search (SEARCH_RESULTS_JS) ─────────────────────

test('a company scan\'s list: each card\'s place and followers, and the headline as before', (t) => {
  const js = readers(t);
  if (!js) return;
  const cards = [
    ['Ivy Chen', 'ivy-chen', ['Ivy Chen', '• 3rd', 'Recruiter at Invented Robotics', 'Austin, Texas, United States', 'Connect', '12K followers']],
    ['Jo Marsh', 'jo-marsh', ['Jo Marsh', '• 2nd', 'Engineer at Invented Robotics', 'Maya Chen is a mutual connection', 'Connect']],
    ['Kai Rowe', 'kai-rowe', ['Kai Rowe', '• 3rd', 'Head of People', 'Follow']],
  ];
  const anchors = cards.map(([name, slug]) => ({ getAttribute: () => `/in/${slug}`, querySelector: () => null, textContent: name }));
  const main = { innerText: cards.flatMap(([, , lines]) => lines).join('\n') };
  const doc = { querySelectorAll: (q) => (q === 'a' ? anchors : []), querySelector: () => main };
  const by = bySlug(vm.runInNewContext(`(${js.SEARCH_RESULTS_JS})()`, { document: doc }));
  assert.deepEqual([by['ivy-chen'].headline, by['ivy-chen'].location, by['ivy-chen'].followers],
    ['Recruiter at Invented Robotics', 'Austin, Texas, United States', 12000]);
  assert.deepEqual([by['jo-marsh'].headline, by['jo-marsh'].location, by['jo-marsh'].followers], ['Engineer at Invented Robotics', undefined, undefined]);
  assert.deepEqual([by['kai-rowe'].headline, by['kai-rowe'].location], ['Head of People', undefined]);
});

test('a company scan sends where they are and their followers to the app', (t) => {
  const r = scanner(t, `
ns['localize_images'] = lambda images: []
ns['_active_user_id'] = 'me'
ns['push_company']([
  {'name': 'Ivy Chen', 'headline': 'Recruiter at Invented Robotics', 'profileUrl': 'https://www.linkedin.com/in/ivy-chen', 'imageUrl': '', 'location': 'Austin, Texas, United States', 'followers': 12000},
  {'name': 'Jo Marsh', 'headline': 'Engineer at Invented Robotics', 'profileUrl': 'https://www.linkedin.com/in/jo-marsh', 'imageUrl': ''},
], 'Invented Robotics')
out['sent'] = posted[0]['json']['connections']`);
  if (!r) return;
  assert.deepEqual(r.out.sent[0], { name: 'Ivy Chen', headline: 'Recruiter at Invented Robotics', profileUrl: 'https://www.linkedin.com/in/ivy-chen',
    imageUrl: '', location: 'Austin, Texas, United States', followers: 12000 });
  assert.ok(!('location' in r.out.sent[1]) && !('followers' in r.out.sent[1]), 'nothing sent for a card that showed none');
});

// ── LinkedIn's own data, beside the page text ───────────────────────────────

test('LinkedIn\'s own search data: the line under the headline is where they are, and it fills a blank the page left', (t) => {
  const r = scanner(t, `
payload = {'included': [
  {'navigationUrl': 'https://www.linkedin.com/in/lee-voss?mini=1', 'title': {'text': 'Lee Voss'}, 'primarySubtitle': {'text': 'Founder at Ironwood'},
   'secondarySubtitle': {'text': 'Oslo, Norway'}, 'insightsResolutionResults': [{'simpleInsight': {'title': {'text': '4,100 followers'}}}]},
  {'navigationUrl': 'https://www.linkedin.com/in/mo-reyes', 'title': {'text': 'Mo Reyes'}, 'primarySubtitle': {'text': 'Analyst'},
   'secondarySubtitle': {'text': 'Analyst at Globex'}},
]}
out['people'] = [{k: p[k] for k in ('profileUrl', 'location', 'followers') if k in p} for p in ns['voyager_people'](payload)]
class R:
    url = 'https://www.linkedin.com/voyager/api/graphql?search'
    def json(self): return payload
ns['_WIRE']['responses'] = [R()]
ns['_wire_sample'] = lambda data, prefix='search': None
page = [{'name': 'Lee Voss', 'headline': 'Founder at Ironwood', 'profileUrl': 'https://www.linkedin.com/in/lee-voss/', 'imageUrl': ''}]
out['merged'] = ns['_wire_merge'](None, 'https://www.linkedin.com/in/invented-bridge/', page)`);
  if (!r) return;
  assert.deepEqual(r.out.people, [
    { profileUrl: 'https://www.linkedin.com/in/lee-voss/', location: 'Oslo, Norway', followers: 4100 },
    { profileUrl: 'https://www.linkedin.com/in/mo-reyes/' },
  ]);
  assert.equal(r.out.merged[0].location, 'Oslo, Norway');
  assert.equal(r.out.merged[0].followers, 4100);
});

// ── the profile's top card (Dig deeper) ─────────────────────────────────────

/** A profile as far as the top card reader looks: the section with their name. */
function profile(card) {
  const section = { innerText: card, querySelectorAll: () => [] };
  const h1 = { closest: () => section, parentElement: section };
  return {
    querySelector: (q) => (q === 'main h1' ? h1 : null),
    querySelectorAll: (q) => (q === 'main section' ? [section] : []),
  };
}

test('the top card: where they are is the line their Contact info sits on or under, and only that', (t) => {
  const js = readers(t);
  if (!js) return;
  const read = (card) => JSON.parse(JSON.stringify(vm.runInNewContext(`(${js.TOP_CARD_JS})()`, { document: profile(card) })));
  assert.equal(read('Jamie Invented\nFounder at Invented Sports Media\nInvented Sports Media\nSeattle, Washington, United States\nContact info\n500+ connections').location,
    'Seattle, Washington, United States');
  assert.equal(read('Jamie Invented\nFounder\nGreater London · Contact info\n1,204 followers').location, 'Greater London');
  // No Contact info: the company and school lines read like places, so nothing is taken.
  assert.equal(read('Jamie Invented\nFounder\nInvented Sports Media\nNorthwind University\n500+ connections').location, undefined);
  // Something that isn't a place where the place would be: none.
  assert.equal(read('Jamie Invented\nFounder\n500+ connections\nContact info').location, undefined);
});

const WINDOW = `
PROFILE = 'https://www.linkedin.com/in/invented-bridge/'
class Window:
    def __init__(self, card=None):
        self.card, self.opened, self.listeners, self.at = card, [], {}, None
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
        if js == ns['EMBEDDED_DATA_JS']: return []
        if js == ns['BRIDGE_RESULTS_JS']: return [] if profile else [person(i) for i in range(10)]
        return None
pushed = []
ns['push_experience'] = lambda person, result: pushed.append({'url': person['profile_url'], **result})
ns['_wait_for_profile_view'] = lambda page: None
ns['_find_connection_urn'] = lambda page: 'ACoAAInventedUrn' if page.at == PROFILE else None
def scan(window):
    ns['_scrape_one_bridge'](window, 'Invented Bridge', 'b1', PROFILE, max_pages=1)
    return pushed
`;

test('a scan that opens their profile sends where its top card says they are, with the card or on its own', (t) => {
  const r = scanner(t, `${WINDOW}
out['with'] = scan(Window(card={'followers': 27000, 'connections': 500, 'connectionsPlus': True, 'location': 'Seattle, Washington, United States'}))[:]
pushed.clear()
out['alone'] = scan(Window(card={'followers': None, 'connections': None, 'location': 'Greater London'}))[:]
pushed.clear()
out['misread'] = scan(Window(card={'followers': 40, 'connections': None, 'location': '3,766 followers'}))[:]`);
  if (!r) return;
  assert.deepEqual(r.out.with, [{ url: 'https://www.linkedin.com/in/invented-bridge/', status: 'card',
    card: { followers: 27000, connections: 500, connectionsPlus: true }, location: 'Seattle, Washington, United States' }]);
  assert.deepEqual(r.out.alone, [{ url: 'https://www.linkedin.com/in/invented-bridge/', status: 'card', location: 'Greater London' }],
    'a place with no numbers goes alone, with no card');
  assert.deepEqual(r.out.misread, [{ url: 'https://www.linkedin.com/in/invented-bridge/', status: 'card',
    card: { followers: 40, connections: null, connectionsPlus: false } }], 'a misread place is never sent');
  assert.match(r.log, /Their profile: 500\+ connections, 27,000 followers, Seattle, Washington, United States\./);
});
