// Evidence the headline parser missed (Blake, 2026-10-12): an audit of a real
// network found four shapes of headline whose company or recognition went
// unread, and asked that a follower count read from the profile's top card
// count like an audience the headline states. Each fix has a control beside
// it that must not change. Invented people and invented wording; public
// companies. docs/brain/SCORING.md, "Evidence the parser missed".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readRoles, scorePerson, scoreNetwork, cleanCompany, followersOf, explainScore,
  KNOWN_COMPANIES, COMPANY_DATA, RULE_TABLES,
} from '../lib/scoring.js';

const person = (headline, row = {}) => scorePerson({ headline, ...row });
const companyOf = (headline) => person(headline).company;
const listed = (name) => [...KNOWN_COMPANIES, ...COMPANY_DATA].some(([n]) => n === name);
const recognised = (headline) => person(headline).bonus.reasons.includes('recognition');

test('a company at the end of a part that goes on with the title, after a dash', () => {
  // The comma written with its space before it, and the title split by a dash.
  const before = person('President - Global Brands ,The Coca-Cola Company');
  const after = person('Global Brands President | The Coca-Cola Company');
  assert.equal(before.company, 'Coca-Cola');
  assert.equal(before.power, after.power);
  assert.equal(before.power, 9.5);
  for (const [h, company] of [
    ['President - North America, The Coca-Cola Company', 'Coca-Cola'],
    ['President – Global Brands, The Coca-Cola Company', 'Coca-Cola'],
    ['Chief Engineer - Satellite Programs, General Dynamics Mission Systems', 'General Dynamics'],
    ['Program Analyst - Southeast Region, Wage and Hour Division, U.S. Department of Labor', 'U.S. Department of Labor'],
  ]) {
    assert.equal(companyOf(h), company, h);
  }
  // The same pieces after a comma in a titled part read as they always have.
  assert.equal(companyOf('Corporate VP, Samsung'), 'Samsung');
  assert.equal(companyOf('Corporate VP ,Samsung'), 'Samsung');
});

test('control: a list after a title is not where the title is held', () => {
  for (const h of [
    // A bar starts something new: skills, press, clients, past employers.
    'Data Engineer | Python, Kafka, dbt, GCP, AWS',
    'Board Member, Northwind Hockey Club | Featured in Forbes, The New York Times, & More',
    'Head of Growth | Channel Strategy (Amazon, Shopify)',
    'Marketing Leader | Northwind Foods, The Coca-Cola Company, Quillon Bank',
    'President | Global Brands, The Coca-Cola Company',
    // A dash, but a list's last item, or an earlier piece already a company.
    'Broadcast Producer - ESPN, Apple TV, NBC Sports & Telemundo',
    'Broadcast Producer - ESPN, Paramount, Fox Sports',
    // An affiliation.
    'President - Council Member, The Coca-Cola Company',
  ]) {
    const roles = readRoles(h).filter((r) => !r.audience);
    assert.ok(roles.every((r) => !r.inferred), `${h}: ${JSON.stringify(roles.map((r) => r.company))}`);
  }
});

test("a company's unit after one of its names is the company", () => {
  assert.equal(cleanCompany('FOX Sports Digital'), 'Fox');
  assert.equal(cleanCompany('Fox News Digital'), 'Fox');
  assert.equal(cleanCompany('Fox Sports Digital Media'), 'Fox');
  const unit = person('Vice President, Fox Sports Digital');
  const at = person('Vice President at Fox Sports');
  assert.equal(unit.company, 'Fox');
  assert.equal(unit.power, at.power);
  assert.equal(unit.power, 7.5);
});

test('control: a unit word after one word, or after another company, reads nothing new', () => {
  // One word is the start of other companies' names: that is why the alias ends there.
  for (const name of ['Fox Digital', 'Fox Rothschild Digital', 'Snap Fitness Digital', 'Delta Dental Media', 'Apollo Hospitals Online']) {
    assert.ok(!listed(cleanCompany(name)), `${name} read as ${cleanCompany(name)}`);
  }
  assert.equal(companyOf('Vice President, Fox Digital'), null);
  assert.equal(companyOf('Associate, Fox Rothschild'), null);
});

test('a company the lists know, opening a title, is where it is held', () => {
  const opening = person('WWE Creative Writer & Live Events Scout');
  const at = person('Creative Writer & Live Events Scout at WWE');
  assert.equal(opening.company, 'WWE');
  assert.equal(opening.power, at.power);
  assert.equal(opening.power, 3.3);
  for (const [h, company] of [
    ['The Coca-Cola Company Senior Brand Manager', 'Coca-Cola'],
    ['Harvard Professor', 'Harvard University'],
    ['Brand Strategy | NYU Adjunct Professor', 'New York University'],
  ]) {
    assert.equal(companyOf(h), company, h);
  }
});

test('control: a name before a title that is a platform, a credential, an everyday word or another company', () => {
  for (const h of [
    'Fox Rothschild Associate',              // another company starts with the name
    'Freelancer | Google Ads Specialist',     // the platform they work with
    'Freelancer | Salesforce Practice Director',
    'Visa Specialist', 'Nationwide Recruiter', 'Target Account Executive',   // everyday words
    'DoD Contractor', 'NFL Agent',            // work for a company, not at it
    'Coca-Cola Foundation Program Officer', 'Coca-Cola Scholar',   // a program, a scholarship
    'Harvard Product Manager',                // a school, not an academic title
    'YC Founder',                             // a founder's own venture
  ]) {
    assert.equal(companyOf(h), null, h);
  }
});

test('a list of awards with a top honour in it, ending in the claim, is recognition', () => {
  for (const h of [
    'Newsroom Executive | Emmy, Peabody, and Webby Award Winner',
    'Documentary Producer | Emmy & duPont Award-winning',
    'Composer | Grammy and Latin Grammy winner',
    'Journalist | Pulitzer and Polk Award recipient',
  ]) {
    assert.ok(recognised(h), h);
  }
  const s = person('Newsroom Executive | Emmy, Peabody, and Webby Award Winner');
  assert.equal(s.power, 5.7);   // 7.5 × 0.725 + 0.5 halved (no company)
});

test('control: award names in a list with no claim are only names', () => {
  for (const h of [
    'Fan of the Emmy, Tony and Oscar',
    'Investor in Oscar Health, Peabody Energy and Clio',
    'Producer | Peabody Awards',
    'Tony, Emmy and Oscar',
  ]) {
    assert.ok(!recognised(h), h);
  }
});

test('control: a bracketed name after an aspiration is not read as a company', () => {
  // Most brackets there are asides, sector lists or past employers, and an
  // unknown company scores the same 5 as none (docs/brain/SCORING.md).
  for (const h of ['Building the boldest things in sports (Northwind Sports)', 'Building the future of fintech (ex-Northwind, ex-Quillon)']) {
    assert.equal(companyOf(h), null, h);
  }
});

// ── followers from the profile's top card ────────────────────────────────────

const card = (followers, status = 'unreadable') => JSON.stringify({
  v: 1, status, at: '2026-10-12T00:00:00.000Z',
  ...(status === 'read' ? { source: 'page', roles: [{ title: 'Storyteller', company: null, start: null, end: null, current: true }] } : { why: 'it couldn’t be read' }),
  card: { followers, connections: 500, connectionsPlus: true },
});
const withCard = (headline, followers, status) => person(headline, { experience: card(followers, status) });

test('followers: none, or a card with no follower count, changes nothing', () => {
  const plain = person('Storyteller');
  assert.equal(followersOf({ headline: 'Storyteller' }), null);
  assert.deepEqual(person('Storyteller', { experience: null }), plain);
  // Connections never count, however many.
  const connectionsOnly = JSON.stringify({ v: 1, status: 'unreadable', at: 'x', why: 'x', card: { followers: null, connections: 30000, connectionsPlus: false } });
  assert.deepEqual(person('Storyteller', { experience: connectionsOnly }), plain);
  // A count that isn't a whole number from 0 to a billion is no count.
  for (const bad of ['2000000', -5, 2.5e6 + 0.5, 5e9]) {
    const e = JSON.stringify({ v: 1, status: 'unreadable', at: 'x', why: 'x', card: { followers: bad } });
    assert.equal(followersOf({ experience: e }), null, String(bad));
  }
});

test('followers: a small count adds nothing', () => {
  assert.deepEqual(withCard('Storyteller', 5000), person('Storyteller'));
  assert.deepEqual(withCard('Storyteller', 99999), person('Storyteller'));
});

test('followers: a large count counts like a stated audience', () => {
  assert.equal(followersOf({ experience: card(250000) }), 250000);
  const k = withCard('Storyteller', 250000);
  assert.equal(k.title.key, 'audience100k');
  assert.equal(k.power, 4.7);
  // 2.5 million on the card is the headline saying "2.5M+ followers": the role and the reach bonus.
  const m = withCard('Storyteller', 2500000);
  const stated = person('Storyteller | 2.5M+ followers');
  assert.equal(m.power, stated.power);
  assert.equal(m.power, 5.8);
  assert.deepEqual(m.bonus, stated.bonus);
  assert.match(explainScore(m), /Audience of 1M\+ \(7\.5\).*reach in the millions/);
  // On a read profile's experience too.
  assert.equal(withCard('Storyteller', 300000, 'read').title.key, 'audience100k');
  // A strong title still wins; the count only adds its reach.
  const vp = withCard('VP at Google', 12000000);
  assert.equal(vp.title.key, 'vp');
  assert.equal(vp.power, round1(9 + 0.75));
});

test('followers: a headline already stating a larger audience is not counted twice', () => {
  const stated = person('Creator | 12M followers');
  assert.deepEqual(withCard('Creator | 12M followers', 2000000), stated);
  assert.deepEqual(withCard('Creator | 12M followers', 12000000), stated);
  // A smaller one in the headline: the larger, the card's, counts, once.
  const larger = withCard('Creator | 150K followers', 2000000);
  assert.equal(larger.title.key, 'audience1m');
  assert.equal(larger.bonus.reasons.filter((r) => r === 'reach in the millions').length, 1);
  assert.equal(larger.power, person('Creator | 2M followers').power);
  // Views already earn the millions bonus: the card adds its role, not the bonus again.
  const views = withCard('Creator | 40M views', 2000000);
  assert.equal(views.bonus.reasons.filter((r) => r === 'reach in the millions').length, 1);
});

test('followers: never lower a score', () => {
  // The audience role (9 × 0.725) edges out a manager at Google (6.5 × 1.0) by
  // a hair and, with no company, would halve the reach bonus: 7.3 instead of
  // 7.5. The read without the role, keeping the count's reach, scores 8.0.
  const before = person('Manager at Google | Angel Investor');
  const after = withCard('Manager at Google | Angel Investor', 12000000);
  assert.equal(before.power, 7.5);
  assert.equal(after.power, 8);
  assert.ok(after.power >= before.power);
  const headlines = ['Storyteller', 'Founder', 'VP at Google', 'Intern at Google', 'Economics student at University of Utah',
    'Manager at Google | Angel Investor | TEDx speaker', 'Creator | 3M followers', 'Director, Samsung', 'Former VP at Adobe'];
  for (const h of headlines) {
    for (const n of [0, 5000, 100000, 999999, 1000000, 9999999, 10000000, 500000000]) {
      assert.ok(withCard(h, n).power >= person(h).power, `${h} with ${n} followers`);
    }
  }
});

test('followers: a network scores with them, and only ever up', () => {
  const rows = [
    { id: 1, degree: 1, headline: 'Storyteller', experience: card(3000000) },
    { id: 2, degree: 1, headline: 'Storyteller' },
    { id: 3, degree: 1, headline: 'VP at Google' },
    { id: 4, degree: 1, headline: 'Manager at Google | Angel Investor', experience: card(12000000) },
  ];
  const on = scoreNetwork(rows).scores;
  const off = scoreNetwork(rows.map(({ experience, ...r }) => r)).scores;
  for (const r of rows) assert.ok(on.get(r.id).power >= off.get(r.id).power, `row ${r.id}`);
  assert.ok(on.get(1).power > off.get(1).power);
  assert.equal(on.get(2).power, off.get(2).power);
});

test('the reading code is in the stamp, so stored scores refresh after a change to it', () => {
  const code = RULE_TABLES.readers.join('\n');
  for (const name of ['readRolesOf', 'heldAtEnd', 'heldBefore', 'readCompanyName', 'readFollowers', 'cardAudience']) {
    assert.ok(code.includes(`function ${name}(`), name);
  }
  assert.ok(RULE_TABLES.unitSuffix instanceof RegExp);
  assert.ok(RULE_TABLES.everydayNames.has('visa'));
});

function round1(n) { return Math.round(n * 10) / 10; }
