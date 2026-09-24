// The power score. Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTitle, cleanCompany, currentCompany, companyScore, reachBonus, scorePerson, scoreNetwork, bridgeBoost, tierFor } from '../lib/scoring.js';

const key = (h) => readTitle(h).key;

test('titles: the traps the old rules fell into', () => {
  assert.equal(key('Vice President, Sales at Acme'), 'vp');            // not "President"
  assert.equal(key('Chief of Staff to the CEO at Acme'), 'director');  // not a chief
  assert.equal(key('Product Owner at Acme'), 'ic');                    // not an owner
  assert.equal(key('International Business Development at Acme'), 'ic');  // works there; not an intern
  assert.equal(key('CS @ UCF | Zeta Beta Tau Treasury Chair'), 'student');  // a club chair is not a chairman
  assert.equal(key('Head of EMEA Partner Ecosystems @ Snap'), 'director');  // not a partner
  assert.equal(key('Chief Technologist & Technical Fellow at Raytheon'), 'vp');
  assert.equal(key('Client Partner at Meta'), 'senior');               // not a partner
  assert.equal(key('Lead Generation Specialist'), 'senior');           // not a lead
});

test('titles: the current role decides, not a former one or a student club', () => {
  assert.equal(key('Ex-Google | Designer at Acme'), 'ic');
  assert.equal(key('Former CEO at Acme | Consultant'), 'ic');
  assert.equal(key('Budget Analyst Intern | Director of Fundraising at Delta Fraternity'), 'intern');
  assert.equal(key('President of the Marketing Club at UCF'), 'student');
  assert.equal(key('Founder & Managing Director at Acme'), 'csuite');
  assert.equal(key('Senior Director of Product'), 'director');
  assert.equal(key('Building cool things'), 'unknown');
});

test('companies: one clean name per company, junk dropped', () => {
  assert.equal(cleanCompany('Snap Inc.'), 'Snap');
  assert.equal(cleanCompany('Snapchat 👻'), 'Snap');
  assert.equal(cleanCompany('Meta'), 'Meta');                          // the old rule missed plain "Meta"
  assert.equal(cleanCompany('Meta (Facebook)'), 'Meta');
  assert.equal(cleanCompany('AWS'), 'Amazon');
  assert.equal(cleanCompany('the University of Central Florida'), 'UCF');
  assert.equal(cleanCompany('Northwind Labs, LLC'), 'Northwind Labs');
  assert.equal(cleanCompany('Online Society! $3.4M+ in client results'), 'Online Society');
  assert.equal(cleanCompany('intersection of media, tech & consumer trends. Proven in leading teams'), null);
  assert.equal(cleanCompany('Self-employed'), null);
  assert.equal(cleanCompany('scale'), null);                           // "…brands at scale"
  assert.equal(cleanCompany('Scale AI'), 'Scale AI');
});

test('the company is where they work now', () => {
  assert.equal(currentCompany({ headline: 'Founder @MindWorks | Ex-Google' }), 'MindWorks');
  assert.equal(currentCompany({ headline: 'Founder | Former VP at Google', company: 'Google' }), null);
  assert.equal(currentCompany({ headline: 'Engineer', scanned_company: 'Stripe' }), 'Stripe');
});

test('company scores: yours, then the known list, then your network', () => {
  assert.deepEqual(companyScore('Google'), { score: 10, source: 'known' });
  assert.deepEqual(companyScore('Google', { overrides: new Map([['Google', 7]]) }), { score: 7, source: 'yours' });
  assert.deepEqual(companyScore('Northwind', { headcount: 6 }), { score: 5, source: 'network' });
  assert.deepEqual(companyScore('Northwind', { headcount: 20, industry: 'education' }), { score: 4, source: 'default' });
  assert.deepEqual(companyScore(null), { score: 3, source: 'none' });
});

test('bonus: whole words only, capped', () => {
  assert.equal(reachBonus('Behavioral Psychology | Summit organizer | Adventure travel').points, 0); // not YC, MIT, venture
  assert.deepEqual(reachBonus('Investor | YC W24 | 2M+ followers').points, 1.5);
  assert.deepEqual(reachBonus('Investor | YC W24 | 2M+ followers', 4).points, 0.8);   // unknown company: half
  assert.equal(reachBonus('$3.4M+ in client results | helped a Forbes entrepreneur').points, 0);
  assert.equal(reachBonus('Raised $12M').points, 0.8);
  assert.deepEqual(reachBonus('Investor Relations Manager').points, 0);
  assert.deepEqual(reachBonus('Creator, 747M+ views').reasons, ['reach in the millions']);
});

test('seniority and company multiply: level × platform', () => {
  const s = (headline) => scorePerson({ headline }).power;
  const vpGoogle = s('VP Engineering at Google');
  const founderUnknown = s('Founder at Northwind');
  const directorUnknown = s('Director at Northwind');
  const internGoogle = s('Software Engineering Intern at Google');
  const engGoogle = s('Software Engineer at Google');
  assert.ok(vpGoogle > founderUnknown && founderUnknown > directorUnknown && directorUnknown > engGoogle && engGoogle > internGoogle);
  assert.equal(tierFor(vpGoogle), 'S');
  assert.equal(tierFor(internGoogle), 'D');
});

test('a strong mapped circle boosts its bridge by at most 1, and only if big enough', () => {
  const strong = Array.from({ length: 40 }, (_, i) => ({ tier: i < 16 ? 'A' : 'C' }));
  assert.equal(bridgeBoost(strong).boost, 1);
  assert.equal(bridgeBoost(strong.slice(0, 10)).boost, 0);
  const rows = [
    { id: 'b', degree: 1, headline: 'Designer at Northwind', profile_url: '/in/b' },
    ...strong.map((_, i) => ({ id: `p${i}`, degree: 2, source_connection_id: 'b', profile_url: `/in/p${i}`, headline: i < 16 ? 'VP at Google' : 'Analyst at Acme' })),
  ];
  const { scores } = scoreNetwork(rows);
  const b = scores.get('b');
  assert.equal(b.boost, 1);
  assert.equal(b.power, Math.round((4 * (0.45 + 0.055 * 4) + 1) * 10) / 10);
});

test('a person scores as their strongest role; former roles count at 70%', () => {
  const brand = scorePerson({ headline: 'Brand Builder | CMO at Northwind | Advisor' });
  assert.equal(brand.title.key, 'csuite');
  const retired = scorePerson({ headline: 'Executive | Former Global SVP at Coca-Cola' });
  assert.equal(retired.title.label, 'Former VP / Partner / GM');
  assert.equal(retired.company, 'Coca-Cola');
  assert.ok(retired.power > scorePerson({ headline: 'Executive' }).power);
  assert.equal(scorePerson({ headline: 'GTM @ Whatnot' }).company, 'Whatnot');
});

test('a current student is capped, whatever else they list', () => {
  const s = scorePerson({ headline: 'SWE @ KnightHacks | Co-Founder of Krystal Jewels | CS student' });
  assert.equal(s.title.student, true);
  assert.ok(s.power < 2.5);
});
