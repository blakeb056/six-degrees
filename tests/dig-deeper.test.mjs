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

test('Dig deeper is done with someone for good only once it has their roles with a company and their card', (t) => {
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, `
import json as j
CARD = {'followers': 10, 'connections': 500, 'connectionsPlus': True}
none = {'experience': j.dumps({'status': 'read', 'roles': [{'title': 'Account Manager', 'company': None}], 'card': CARD})}
nocard = {'experience': j.dumps({'status': 'read', 'roles': [{'title': 'Account Manager', 'company': 'Invented Staffing'}]})}
full = {'experience': j.dumps({'status': 'read', 'roles': [{'title': 'Account Manager', 'company': 'Invented Staffing'}], 'card': CARD})}
card = {'experience': j.dumps({'status': 'card', 'card': CARD})}
bad = {'experience': j.dumps({'status': 'unreadable', 'why': 'x', 'card': CARD})}
out['none'] = ns['_experience_on_file'](none)
out['nocard'] = ns['_experience_on_file'](nocard)
out['full'] = ns['_experience_on_file'](full)
out['card'] = ns['_experience_on_file'](card)
out['bad'] = ns['_experience_on_file'](bad)
out['empty'] = ns['_experience_on_file']({})`], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: scratch() } });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trimEnd().split('\n').pop().replace(/^RESULT /, ''));
  // Done for good only with everything: roles with a company, and the card (Blake, 2026-10-12).
  assert.deepEqual(out, { none: false, nocard: false, full: true, card: false, bad: false, empty: false });
});

test('a company page address names the company when the entry shows no name', (t) => {
  const r = spawnSync(PYTHON, [HARNESS, SCRAPER, `
out['names'] = [ns['company_from_slug'](x) for x in ('invented-staffing', 'aerotek', 'ibm', '12345', '', None, 'invented_robotics-inc')]
items = [{'lines': ['Account Manager', 'Oct 2018 - Mar 2021 · 2 yrs 6 mos'], 'subs': [], 'slug': 'invented-staffing'},
         {'lines': ['Recruiter', 'Mar 2017 - Oct 2018 · 1 yr 8 mos'], 'subs': [], 'slug': '98765'}]
out['roles'] = [[x['title'], x['company']] for x in ns['roles_from_items'](items)]`], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: scratch() } });
  if (noPython(t, r)) return;
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trimEnd().split('\n').pop().replace(/^RESULT /, ''));
  assert.deepEqual(out.names, ['Invented Staffing', 'Aerotek', 'IBM', null, null, null, 'Invented Robotics Inc']);
  assert.deepEqual(out.roles, [['Account Manager', 'Invented Staffing'], ['Recruiter', null]], 'a number names nothing');
});

test('manual Dig deeper: a profile still loading is never "the foot" until you have scrolled, and it moves on in time', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
class Short(Window):
    # A profile that hasn't loaded: short, so the window reads as at its foot, and you haven't moved.
    def evaluate(self, js, *a):
        if js == ns['PAGE_FOOT_JS']: return {'foot': True, 'scrolled': 0, 'height': 900}
        if js == ns['EXPERIENCE_JS']: return {'found': False}
        return super().evaluate(js, *a)
w = Short()
w.goto(PROFILE)
result, note = ns['_read_experience_by_hand'](w, [], 'Invented Bridge')
out['result'] = result
out['waited'] = round(clock.t - NOW)
out['note'] = note`);
    if (!r) return;
    assert.equal(r.out.result, null, 'nothing concluded: you never scrolled');
    assert.ok(r.out.waited >= 45 && r.out.waited < 50, `moves on after the wait (${r.out.waited}s)`);
    assert.match(r.log, /Not scrolling: it moves on to their list in 45 seconds/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Stop pressed while their profile is open never goes on to their list', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
def dig_then_stop(*a, **k):
    ns['_stop_requested'] = True
    return None, None
ns['_dig_into_profile'] = dig_then_stop
ns['stop_requested'] = lambda: bool(ns.get('_stop_requested'))
w = Window(card={'followers': 1, 'connections': 500, 'connectionsPlus': True})
out.update(scan(w, urn=URN, dig=True))`);
    if (!r) return;
    assert.equal(r.out.status, 'stopped');
    assert.ok(r.out.opened.every((u) => !u.includes('/search/')), 'their list never opened');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a company named only by its number takes its name from a description, or from any top card that named that number', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
f = ns['company_from_description']
out['described'] = [f(x) for x in (
  ['Invented Staffing is your leading provider of staffing services.'],
  ['Invented Carter* (An Invented Staffing Company) specializes in recruitment.'],
  ['The Invented Bottling Company is the largest bottler in the region.'],
  ['Administer over call center operations and device software.'],
  ['I specialize in placing long term staff.'],
  ['Account Manager is a role I loved.'],
)]
out['title'] = f(['Account Manager is a role I loved.'], 'Account Manager')
items = [
  {'lines': ['Account Manager', 'Oct 2018 - Mar 2021 · 2 yrs 6 mos', 'Invented Staffing is your leading provider.'], 'subs': [], 'companyId': '2889'},
  {'lines': ['Technical Recruiter', 'Mar 2017 - Oct 2018 · 1 yr 8 mos', 'Placed accountants.'], 'subs': [], 'companyId': '2889'},
  {'lines': ['Team Lead', 'Feb 2011 - Aug 2014 · 3 yrs 7 mos', 'Ran a team.'], 'subs': [], 'companyId': '2377059'},
]
out['first'] = [[x['title'], x['company'], x.get('companyId')] for x in ns['roles_from_items'](items)]
ns['remember_company']('2377059', 'Invented Wireless', 'card')
ns['remember_company']('2889', 'Wrong From A Description', 'description')
out['again'] = [[x['title'], x['company']] for x in ns['roles_from_items'](items)]
out['file'] = json.loads((ns['_home']() / 'company-names.json').read_text())`);
    if (!r) return;
    assert.deepEqual(r.out.described, ['Invented Staffing', 'Invented Carter', 'The Invented Bottling Company', null, null, 'Account Manager']);
    assert.equal(r.out.title, null, 'never the title itself');
    // The second role at 2889 has no description naming it: it takes the number's remembered name.
    assert.deepEqual(r.out.first, [['Account Manager', 'Invented Staffing', '2889'], ['Technical Recruiter', 'Invented Staffing', '2889'], ['Team Lead', null, '2377059']]);
    assert.deepEqual(r.out.again, [['Account Manager', 'Invented Staffing'], ['Technical Recruiter', 'Invented Staffing'], ['Team Lead', 'Invented Wireless']],
      'a top card names a number everywhere; a later description never replaces a name already there');
    assert.deepEqual(r.out.file['2377059'], { name: 'Invented Wireless', from: 'card' });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('each role gets its company logo, saved once a company, and the link it came from goes no further', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
fetched = []
ns['store_avatar'] = lambda src, key, overwrite=True: fetched.append(key) or '/avatars/' + key.replace('company:', 'c') + '.webp'
roles = [{'title': 'A', 'companyId': '2889', 'logoSrc': 'https://media.licdn.com/x/company-logo_100_100/1'},
         {'title': 'B', 'companyId': '2889', 'logoSrc': 'https://media.licdn.com/x/company-logo_100_100/1'},
         {'title': 'C', 'companyId': '77', 'logoSrc': None},
         {'title': 'D', 'logoSrc': 'https://media.licdn.com/x/company-logo_100_100/2'}]
ns['_company_logos'](roles)
out['roles'] = roles
out['fetched'] = fetched`);
    if (!r) return;
    assert.deepEqual(r.out.fetched, ['company:2889'], 'one download for both roles at the company');
    assert.equal(r.out.roles[0].logo, '/avatars/c2889.webp');
    assert.equal(r.out.roles[1].logo, '/avatars/c2889.webp');
    assert.ok(r.out.roles.every((x) => !('logoSrc' in x)), 'the link never reaches the app');
    assert.equal(r.out.roles[2].logo, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const kept = cleanExperience({ status: 'read', roles: [{ title: 'Account Manager', company: 'Invented Staffing', start: '2018', companyId: '2889', logo: '/avatars/c2889.webp' },
    { title: 'Recruiter', start: '2017', companyId: 'x9', logo: 'https://media.licdn.com/evil.png' }] }, '2026-10-12T00:00:00Z');
  assert.equal(kept.roles[0].companyId, '2889');
  assert.equal(kept.roles[0].logo, '/avatars/c2889.webp');
  assert.equal(kept.roles[1].companyId, undefined, 'only a number');
  assert.equal(kept.roles[1].logo, undefined, 'only a logo saved on this computer');
});

test('manual Dig deeper reads on as you scroll through Experience, and moves on once you are past it', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `${WINDOW}
MORE = ITEMS + [{'lines': ['Recruiter', 'Invented Search · Full-time', 'Mar 2015 - Oct 2016 · 1 yr 8 mos'], 'subs': []},
                {'lines': ['Analyst', 'Invented Bank · Full-time', 'Jan 2012 - Feb 2015 · 3 yrs'], 'subs': []}]
class Scrolling(Window):
    # Experience shows at 5 s with its first entry; you scroll, two more show at 12 s; you're past it at 20 s.
    def evaluate(self, js, *a):
        t = clock.t - NOW
        if js == ns['EXPERIENCE_JS']:
            if t < 5: return {'found': False}
            items = ITEMS if t < 12 else MORE
            bottom = 900 if t < 20 else 40
            return {'found': True, 'how': 'heading', 'items': items, 'rect': {'top': bottom - 600, 'bottom': bottom, 'vh': 720}}
        if js == ns['PAGE_FOOT_JS']: return {'foot': False, 'scrolled': 1200, 'height': 5000}
        return super().evaluate(js, *a)
w = Scrolling()
w.goto(PROFILE)
result, note = ns['_read_experience_by_hand'](w, [], 'Invented Bridge')
out['roles'] = [x['title'] for x in result['roles']]
out['at'] = round(clock.t - NOW)`);
    if (!r) return;
    assert.deepEqual(r.out.roles, ['Founder', 'Recruiter', 'Analyst'], 'everything you scrolled through, not just the first');
    assert.ok(r.out.at >= 20 && r.out.at < 25, `on once you were past it (${r.out.at}s)`);
    assert.match(r.log, /their Experience is being read: scroll through it to the end/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A profile's Experience section as its company links read in order, the shape of a real
// one on 2026-10-12 (invented people and companies): three roles on their own, then two
// companies with two roles each, under a heading with the company's name and how long.
const RUNS = [
  ['1001', 'Senior Recruiter'], ['1001', 'Invented Robotics'], ['1001', 'Aug 2025 - Present · 1 yr 3 mos'], ['1001', 'Costa Mesa, California, United States'],
  ['1002', 'Senior Recruiter'], ['1002', 'Invented Labels · Part-time'], ['1002', 'Jul 2025 - Aug 2025 · 2 mos'], ['1002', 'San Francisco Bay Area · Remote'],
  ['1003', 'Senior Technical Recruiter'], ['1003', 'Invented Streams'], ['1003', 'Mar 2021 - Jul 2025 · 4 yrs 5 mos'], ['1003', 'Palo Alto, California, United States'],
  ['2889', 'Invented Staffing'], ['2889', '4 yrs 1 mo'], ['2889', 'Greater Sacramento'],
  ['2889', 'Account Manager'], ['2889', 'Oct 2018 - Mar 2021 · 2 yrs 6 mos'],
  ['2889', 'Technical Recruiter'], ['2889', 'Mar 2017 - Oct 2018 · 1 yr 8 mos'],
  ['2377059', 'Invented Source Technologies®'], ['2377059', '6 yrs 1 mo'],
  ['2377059', 'Project Manager / Sales Support Representative'], ['2377059', 'Sep 2014 - Feb 2017 · 2 yrs 6 mos'],
  ['2377059', 'Mobility Team Lead'], ['2377059', 'Full-time'], ['2377059', 'Feb 2011 - Aug 2014 · 3 yrs 7 mos'],
].map(([c, t]) => ({ c, t }));

test('Experience read by its company links: every role, on its own or under its company, with its company and logo', (t) => {
  const home = scratch();
  try {
    const r = scanner(t, home, `
rows = ${JSON.stringify(RUNS)}
logos = {'2889': 'https://media.licdn.com/dms/image/x/company-logo_100_100/staffing', '1001': 'https://media.licdn.com/dms/image/y/company-logo_100_100/robotics'}
roles = ns['roles_from_runs'](rows, logos)
out['roles'] = [[x['title'], x['company'], x.get('companyId'), x['current'], x['start'], x['end'], bool(x.get('logoSrc'))] for x in roles]
# The list items alone saw only the four roles inside the two companies, with no company.
items = [{'lines': [x['t'] for x in rows[15:17]], 'subs': []}]
out['chosen'] = len(ns['page_roles']({'runs': rows, 'logos': logos, 'items': items}))
out['names'] = json.loads((ns['_home']() / 'company-names.json').read_text())`);
    if (!r) return;
    assert.deepEqual(r.out.roles, [
      ['Senior Recruiter', 'Invented Robotics', '1001', true, '2025-08', null, true],
      ['Senior Recruiter', 'Invented Labels', '1002', false, '2025-07', '2025-08', false],
      ['Senior Technical Recruiter', 'Invented Streams', '1003', false, '2021-03', '2025-07', false],
      ['Account Manager', 'Invented Staffing', '2889', false, '2018-10', '2021-03', true],
      ['Technical Recruiter', 'Invented Staffing', '2889', false, '2017-03', '2018-10', true],
      ['Project Manager / Sales Support Representative', 'Invented Source Technologies®', '2377059', false, '2014-09', '2017-02', false],
      ['Mobility Team Lead', 'Invented Source Technologies®', '2377059', false, '2011-02', '2014-08', false],
    ]);
    assert.equal(r.out.chosen, 7, 'the company links win over the list items');
    assert.deepEqual(r.out.names['2889'], { name: 'Invented Staffing', from: 'page' }, 'the page’s own name, remembered by number');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── the top card reader ─────────────────────────────────────────────────────

function topCardJs() {
  const src = readFileSync(SCRAPER, 'utf8');
  const start = src.indexOf('TOP_CARD_JS = r"""') + 'TOP_CARD_JS = r"""'.length;
  return src.slice(start, src.indexOf('"""', start));
}

/** A profile as far as the reader looks: the section with their name, the connections link, the page's sections. */
function profile({ card = '', link = null, sections = [], companies = [] }) {
  // The top card's links to company pages: [href, text].
  const cardSection = {
    innerText: card,
    querySelectorAll: (q) => (q.includes('/company/') ? companies.map(([href, text]) => ({ getAttribute: (k) => (k === 'href' ? href : null), innerText: text })) : []),
  };
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
    { followers: 27000, connections: 500, connectionsPlus: true, companies: [] });
  assert.deepEqual(readCard(profile({ card: 'Riley Invented\nProfessor\n1.2M followers\n312 connections' })),
    { followers: 1200000, connections: 312, connectionsPlus: false, companies: [] });
  assert.deepEqual(readCard(profile({ card: 'Sam Invented\nAnalyst', link: '500+ connections' })),
    { followers: null, connections: 500, connectionsPlus: true, companies: [] }, 'the link the search id comes from says it too');
});

test('the top card names their current company with its number, for the roles that only point at it', () => {
  const got = readCard(profile({ card: 'Jamie Invented\nRecruiter\nInvented Robotics\n500+ connections',
    companies: [['https://www.linkedin.com/company/2889/', 'Invented Robotics'], ['/company/12/', '1,204 followers']] }));
  assert.deepEqual(got.companies, [{ id: '2889', name: 'Invented Robotics' }], 'a follower count is never a company');
});

test('the top card: followers from their own Activity heading, never from Interests or anyone else', () => {
  const doc = profile({
    card: 'Avery Invented\nChief People Officer\n500+ connections',
    sections: ['Activity\n12,480 followers\nPosts', 'Interests\nTop Voices\nInvented Retail Co\n1,234,567 followers'],
  });
  assert.deepEqual(readCard(doc), { followers: 12480, connections: 500, connectionsPlus: true, companies: [] });
  const noActivity = profile({ card: 'Avery Invented\nChief People Officer', sections: ['Interests\nInvented Retail Co\n1,234,567 followers'] });
  assert.deepEqual(readCard(noActivity), { followers: null, connections: null, connectionsPlus: false, companies: [] });
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
            return ({'found': True, 'how': 'heading', 'items': ITEMS, 'rect': {'top': 100, 'bottom': 500, 'vh': 720}}
                    if profile and clock.t - NOW >= self.roles_at else {'found': False})
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
