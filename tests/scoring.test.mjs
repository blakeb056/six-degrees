// The power score. Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTitle, cleanCompany, currentCompany, companyScore, reachBonus, scorePerson, scoreNetwork, bridgeBoost, tierFor,
  explainScore, companyIndustry, networkCompanies, knownIndustry, readNetwork, SECTOR_BONUS,
} from '../lib/scoring.js';

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

test('companies: a school is not the company its name starts like, and Bain Capital is not Bain', () => {
  // The list's aliases match from the start of a name, so these used to read
  // as Kellanova, Warner Bros., Campbell's and JPMorgan Chase.
  for (const school of ['Kellogg School of Management', 'Kellogg College', 'Warner University', 'Campbell University', 'Chase College of Law']) {
    assert.equal(cleanCompany(school), school);
    assert.equal(knownIndustry(school), null);
    assert.deepEqual(companyScore(cleanCompany(school)), { score: 4, source: 'default' });
  }
  // The companies themselves still match, and so do schools on the list.
  assert.equal(cleanCompany("Kellogg's"), 'Kellanova');
  assert.equal(cleanCompany('Chase'), 'JPMorgan Chase');
  assert.equal(cleanCompany('Warner Bros. Discovery'), 'Warner Bros. Discovery');
  assert.equal(cleanCompany('Harvard Business School'), 'Harvard University');
  assert.equal(cleanCompany('the University of Central Florida'), 'UCF');
  // A private equity firm, not the consultancy: its own industry, at the 9 it
  // had as an alias of Bain. "Bain Capital Ventures" was never on the list.
  assert.equal(cleanCompany('Bain Capital'), 'Bain Capital');
  assert.equal(cleanCompany('Bain & Company'), 'Bain');
  assert.equal(cleanCompany('Bain Capital Ventures'), 'Bain Capital Ventures');
  assert.deepEqual(companyScore('Bain Capital'), { score: 9, source: 'known' });
  assert.deepEqual([knownIndustry('Bain Capital'), knownIndustry('Bain & Company')], ['finance', 'consulting']);
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

// ── your sector (Settings) ───────────────────────────────────────────────────

const lean = (...sectors) => ({ sectors, strength: 'lean' });
const strong = (...sectors) => ({ sectors, strength: 'strong' });

test('your sector: +1 lean, +2 strong, never above 10, and it says what it added', () => {
  assert.deepEqual(SECTOR_BONUS, { lean: 1, strong: 2 });
  assert.deepEqual(companyScore('Adobe', { focus: lean('tech') }), { score: 9, source: 'known', base: 8, sector: 'tech', sectorBonus: 1 });
  assert.deepEqual(companyScore('Adobe', { focus: strong('tech') }), { score: 10, source: 'known', base: 8, sector: 'tech', sectorBonus: 2 });
  // Capped: Snap is 9, so strong adds only 1.
  assert.deepEqual(companyScore('Snap', { focus: strong('media') }), { score: 10, source: 'known', base: 9, sector: 'media', sectorBonus: 1 });
  // Unknown companies move too, by the company's one industry.
  assert.deepEqual(companyScore('Northwind', { industry: 'tech', focus: lean('tech') }), { score: 5, source: 'default', base: 4, sector: 'tech', sectorBonus: 1 });
  assert.deepEqual(companyScore('Northwind', { industry: 'tech', headcount: 6, focus: strong('tech') }), { score: 7, source: 'network', base: 5, sector: 'tech', sectorBonus: 2 });
});

test('your sector: nothing changes (not even the shape) outside it, at 10, or with no focus', () => {
  assert.deepEqual(companyScore('Google', { focus: strong('tech') }), { score: 10, source: 'known' });
  assert.deepEqual(companyScore('Adobe', { focus: strong('media', 'finance') }), { score: 8, source: 'known' });
  assert.deepEqual(companyScore('Adobe', { focus: lean() }), { score: 8, source: 'known' });
  assert.deepEqual(companyScore('Adobe', { focus: undefined }), { score: 8, source: 'known' });
  assert.deepEqual(companyScore('Northwind', { focus: lean('tech') }), { score: 4, source: 'default' });   // industry unclear
  assert.deepEqual(companyScore(null, { focus: strong('tech') }), { score: 3, source: 'none' });
});

test('your sector never touches a score you set', () => {
  const overrides = new Map([['Adobe', 6], ['Northwind', 3]]);
  assert.deepEqual(companyScore('Adobe', { overrides, focus: strong('tech') }), { score: 6, source: 'yours' });
  assert.deepEqual(companyScore('Northwind', { overrides, industry: 'tech', focus: strong('tech') }), { score: 3, source: 'yours' });
});

test('your sector shows in the working, and can lift a tier', () => {
  const plain = scorePerson({ headline: 'Director of Partnerships at Snap' });
  const leaned = scorePerson({ headline: 'Director of Partnerships at Snap' }, (n) => companyScore(n, { focus: lean('media') }));
  assert.equal(plain.power, 7.1);
  assert.equal(plain.tier, 'A');
  assert.equal(leaned.power, 7.5);
  assert.equal(leaned.tier, 'S');
  assert.equal(plain.companySector, undefined);
  assert.deepEqual(leaned.companySector, { key: 'media', base: 9, bonus: 1 });
  assert.equal(explainScore(plain), 'Director / Head (7.5) · Snap (9/10)');
  assert.equal(explainScore(leaned), 'Director / Head (7.5) · Snap (10/10: 9 + 1 your sector)');
  // A score you set still reads as yours.
  const yours = scorePerson({ headline: 'Director at Snap' }, (n) => companyScore(n, { overrides: new Map([['Snap', 8]]), focus: lean('media') }));
  assert.equal(explainScore(yours), 'Director / Head (7.5) · Snap (8/10, your score)');
});

test('your sector lifts the company, not the headline\'s claims: a reach bonus is halved by the score before the lean', () => {
  // A founder at an unknown company who says "Angel investor": the claim counts
  // half at a 4. Leaning toward tech makes the company a 5 or 6 for scoring,
  // but liking a sector says nothing about whether the claim is true, so it
  // stays halved: lean adds one company point (+0.55 for a founder), not the
  // +1.1 it gave when the lean also un-halved the bonus (7.2 → 8.3).
  const h = 'Founder at Quillon | Angel investor';
  const at = (focus, overrides) => scorePerson({ headline: h }, (n) => companyScore(n, { overrides, industry: 'tech', focus }));
  const [plain, leaned, hard] = [undefined, lean('tech'), strong('tech')].map((f) => at(f));
  assert.deepEqual([plain.power, plain.tier], [7.2, 'A']);
  assert.deepEqual([leaned.power, leaned.tier], [7.8, 'S']);
  assert.deepEqual([hard.power, hard.tier], [8.3, 'S']);
  for (const s of [plain, leaned, hard]) assert.deepEqual(s.bonus, { points: 0.5, reasons: ['investor', 'halved: unknown company'] });
  assert.equal(explainScore(leaned), 'C-Suite / Founder (10) · Quillon (5/10: 4 + 1 your sector) · +0.5 investor, halved: unknown company');
  // A score you set is your judgement of the company, so it decides.
  assert.deepEqual(at(lean('tech'), new Map([['Quillon', 5]])).bonus, { points: 1, reasons: ['investor'] });
  // The same in a whole network, where Quillon is tech by its people's headlines.
  const rows = [
    { id: 'f', profile_url: '/in/f', degree: 1, headline: h },
    { id: 'e1', profile_url: '/in/e1', degree: 1, headline: 'Engineer at Quillon' },
    { id: 'e2', profile_url: '/in/e2', degree: 1, headline: 'Developer at Quillon' },
  ];
  const techPeople = (company, headline) => (!company && /engineer|developer/i.test(headline || '') ? 'tech' : 'unknown');
  const f = scoreNetwork(rows, { industryOf: techPeople, focus: lean('tech') }).scores.get('f');
  assert.deepEqual([f.companyScore, f.bonus.points, f.power, f.tier], [5, 0.5, 7.8, 'S']);
});

// A stand-in for lib/companies.js's inference, so these cases pin the order of
// the rules rather than the regexes (tests/sector.test.mjs runs the real one).
const fakeIndustryOf = (company, headline) => {
  if (company) return /health/i.test(company) ? 'health' : 'unknown';
  if (/engineer|developer/i.test(headline || '')) return 'tech';
  if (/nurse/i.test(headline || '')) return 'health';
  return 'unknown';
};

test('one industry per company: the curated list, then the name, then most of its people', () => {
  // The curated list answers on its own, aliases included, and outranks everything.
  assert.equal(knownIndustry('Adobe'), 'tech');
  assert.equal(knownIndustry('BNY Mellon'), 'finance');                  // → BNY
  assert.equal(knownIndustry('Northwind'), null);
  assert.equal(companyIndustry('Adobe', { industryOf: () => 'health', headlines: ['Nurse', 'Nurse'] }), 'tech');
  // Then the name…
  assert.equal(companyIndustry('Meridian Health', { industryOf: fakeIndustryOf, headlines: ['Engineer', 'Engineer'] }), 'health');
  // …then what most of the people there say, "unclear" answers aside.
  assert.equal(companyIndustry('Quillon', { industryOf: fakeIndustryOf, headlines: ['Engineer', 'Developer', 'Nurse', 'Founder', 'Founder'] }), 'tech');
  // A tie stays unclear, so the answer doesn't depend on row order.
  assert.equal(companyIndustry('Quillon', { industryOf: fakeIndustryOf, headlines: ['Engineer', 'Nurse'] }), 'unknown');
  assert.equal(companyIndustry('Quillon', { industryOf: fakeIndustryOf, headlines: ['Nurse', 'Engineer'] }), 'unknown');
  // Without an inference only the curated list can answer.
  assert.equal(companyIndustry('Quillon', { headlines: ['Engineer'] }), 'unknown');
  assert.equal(companyIndustry(null), 'unknown');
});

test('a company\'s people: current roles, each person once, every company they list', () => {
  const rows = [
    { id: 'a', profile_url: '/in/a', headline: 'Engineer at Quillon | Advisor at Meridian Health' },
    { id: 'a2', profile_url: '/in/a', degree: 2, headline: 'Engineer at Quillon' },     // the same person again
    { id: 'b', profile_url: '/in/b', headline: 'Nurse at Quillon' },
    { id: 'c', profile_url: '/in/c', headline: 'Developer at Quillon' },
    { id: 'd', profile_url: '/in/d', headline: 'Founder | Ex-Engineer at Quillon' },   // former: not counted
  ];
  const { headcount, industries } = networkCompanies(rows, { industryOf: fakeIndustryOf });
  assert.equal(headcount.get('Quillon'), 3);
  assert.equal(headcount.get('Meridian Health'), 1);
  assert.equal(industries.get('Quillon'), 'tech');                       // 2 tech to 1 health
  assert.equal(industries.get('Meridian Health'), 'health');
});

test('in a network, everyone at a company gets the same industry, and the lean follows it', () => {
  // Quillon's name says nothing; its people are mostly engineers, so it is tech
  // for the nurse there too (before, each person's own headline decided).
  const rows = [
    { id: 'f', profile_url: '/in/f', degree: 1, headline: 'Founder at Quillon' },
    { id: 'e1', profile_url: '/in/e1', degree: 1, headline: 'Engineer at Quillon' },
    { id: 'e2', profile_url: '/in/e2', degree: 1, headline: 'Developer at Quillon' },
    { id: 'n', profile_url: '/in/n', degree: 1, headline: 'Nurse at Quillon' },
  ];
  const plain = scoreNetwork(rows, { industryOf: fakeIndustryOf });
  const leaned = scoreNetwork(rows, { industryOf: fakeIndustryOf, focus: lean('tech') });
  const hard = scoreNetwork(rows, { industryOf: fakeIndustryOf, focus: strong('tech') });
  assert.equal(plain.industries.get('Quillon'), 'tech');
  assert.deepEqual(['f', 'e1', 'n'].map((id) => leaned.scores.get(id).companyScore), [5, 5, 5]);
  // A founder at an unknown company: 6.7 (A), 7.3 lean (A), 7.8 strong (S).
  assert.deepEqual([plain, leaned, hard].map((x) => [x.scores.get('f').power, x.scores.get('f').tier]), [[6.7, 'A'], [7.3, 'A'], [7.8, 'S']]);
  // Recomputed from scratch each time: dropping the focus gives back the first answer exactly.
  const again = scoreNetwork(rows, { industryOf: fakeIndustryOf });
  for (const id of ['f', 'e1', 'e2', 'n']) assert.deepEqual(again.scores.get(id), plain.scores.get(id));
});

test('the company estimate skips schools by the company\'s industry, the same for everyone there', () => {
  // Five people at an unnamed school-like company where most headlines say
  // education: nobody there gets the "many of your people" estimate, even the
  // one whose own headline doesn't mention it.
  const edu = (c, h) => (c ? 'unknown' : /teacher|professor/i.test(h || '') ? 'education' : 'unknown');
  const rows = ['Teacher', 'Teacher', 'Professor', 'Teacher', 'Engineer'].map((t, i) => ({ id: `t${i}`, profile_url: `/in/t${i}`, headline: `${t} at Westbrook` }));
  const { scores } = scoreNetwork(rows, { industryOf: edu });
  assert.deepEqual(rows.map((r) => scores.get(r.id).companySource), ['default', 'default', 'default', 'default', 'default']);
});

test('a network read once scores exactly like one read afresh, however many ways it is scored', () => {
  // Settings' preview and save read every headline once and score the read
  // with two sector focuses. That must change nothing but the time it takes.
  const titles = ['Founder', 'VP Engineering', 'Director of Design', 'Engineer', 'Nurse', 'Marketing Intern', 'CS student'];
  const companies = ['Quillon', 'Adobe', 'Snap', 'Meridian Health', 'Harvard University'];
  const rows = Array.from({ length: 60 }, (_, i) => {
    let headline = `${titles[i % titles.length]} at ${companies[i % companies.length]}`;
    if (i % 4 === 0) headline += ` | Ex-Director at ${companies[(i + 2) % companies.length]}`;
    if (i % 9 === 0) headline += ' | Angel investor';
    return { id: `p${i}`, profile_url: `/in/p${i}`, degree: i < 2 ? 1 : 2, source_connection_id: i < 2 ? null : `p${i % 2}`, headline };
  });
  rows.push({ id: 'x', profile_url: '/in/x', degree: 1, headline: 'Consultant | Ex-VP at Discord' });
  const read = readNetwork(rows, { industryOf: fakeIndustryOf });
  // Every company anyone names, a former employer included, with its facts.
  assert.deepEqual(read.companies.get('Discord'), { headcount: 0, industry: 'tech' });
  assert.deepEqual(read.companies.get('Meridian Health'), { headcount: read.headcount.get('Meridian Health'), industry: 'health' });
  for (const focus of [undefined, lean('tech'), strong('tech', 'health'), lean('media')]) {
    const fresh = scoreNetwork(rows, { industryOf: fakeIndustryOf, focus });
    const reused = scoreNetwork(rows, { focus, read });
    assert.deepEqual(reused.scores, fresh.scores, focus?.sectors.join() || 'no focus');
    assert.deepEqual(reused.companyScores, fresh.companyScores);
  }
  assert.ok([...scoreNetwork(rows, { read }).scores.values()].some((s) => s.boost > 0), 'the circles are big enough to boost');
});
