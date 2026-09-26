// The Paths analyzer's data: companies, inferred industries, the links between
// companies, and the ways into one. Every name here is invented or a public
// company, never a person from a real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyOf, industryOf, industryKeyOf, buildCompanyIndex, companyLinks, waysInto, INDUSTRIES, UNKNOWN_INDUSTRY } from '../lib/companies.js';
import { KNOWN_COMPANIES, networkCompanies } from '../lib/scoring.js';

const p = (id, degree, extra = {}) => ({ id, degree, profile_url: `/in/${id}`, tier: 'B', ...extra });

test('the company comes from a scan, the stored field, or the headline', () => {
  assert.equal(companyOf({ company: 'Snap Inc.' }), 'Snap');
  assert.equal(companyOf({ headline: 'Head of Growth at Northwind Labs | AI' }), 'Northwind Labs');
  assert.equal(companyOf({ headline: 'Designer @ Acme, remote' }), 'Acme');
  assert.equal(companyOf({ headline: 'Open to work' }), null);
  assert.equal(companyOf({ scanned_company: 'Stripe', company: 'Old Co' }), 'Stripe');
});

test('industry is inferred from the company first, then the headline, else unclear', () => {
  assert.equal(industryOf('Coinbase').key, 'finance');
  assert.equal(industryOf('BNY Mellon').key, 'finance');
  assert.equal(industryOf('Northwind', 'Nurse practitioner at Northwind').key, 'health');
  assert.equal(industryOf('Northwind', 'Doing great things'), UNKNOWN_INDUSTRY);
  assert.equal(industryOf(null, null), UNKNOWN_INDUSTRY);
});

test('the industry words are the same for everyone: no job title, and no one person\'s picks', () => {
  // "Growth" is a job title every kind of company has; "growth marketing" is a field.
  assert.equal(industryOf(null, 'Head of Growth at Acme Software').key, 'tech');
  assert.equal(industryOf('Summit Growth Equity', null).key, 'finance');
  assert.equal(industryOf(null, 'Growth Marketing Manager').key, 'media');
  const rows = [p('a', 1, { headline: 'Head of Growth at Quillon' }), p('b', 2, { headline: 'Backend Engineer at Quillon' })];
  assert.equal(buildCompanyIndex(rows).get('Quillon').industry.key, 'tech');     // was a tie with media: unclear
  // Retired picks from one person's world, one of them also a word.
  for (const name of ['Polymarket', 'Anduril Industries', 'Sandia National Laboratories', 'Whatnot']) {
    assert.equal(industryOf(name, null), UNKNOWN_INDUSTRY, name);
  }
  assert.equal(industryOf(null, 'Gifts, snacks and whatnot'), UNKNOWN_INDUSTRY);
});

test('each person counts once, at their closest degree', () => {
  const rows = [p('a', 2, { company: 'Acme' }), p('a', 1, { company: 'Acme' }), p('b', 2, { company: 'Acme', tier: 'S' })];
  const acme = buildCompanyIndex(rows).get('Acme');
  assert.equal(acme.people.length, 2);
  assert.deepEqual([acme.d1, acme.d2, acme.S], [1, 1, 1]);
});

test('a company\'s industry follows its name, else most of its people', () => {
  const rows = [
    p('a', 1, { company: 'Quillon', headline: 'Software engineer at Quillon' }),
    p('b', 2, { company: 'Quillon', headline: 'Backend developer at Quillon' }),
    p('c', 2, { company: 'Quillon', headline: 'Recruiter at Quillon' }),
  ];
  assert.equal(buildCompanyIndex(rows).get('Quillon').industry.key, 'tech');
});

test('companies are linked when your connection at one knows people at the other', () => {
  const d1 = [p('jane', 1, { company: 'Acme' }), p('omar', 1, { company: 'Globex' })];
  const d2 = [
    p('x', 2, { company: 'Globex', source_connection_id: 'jane' }),
    p('y', 2, { company: 'Globex', source_connection_id: 'jane' }),
    p('z', 2, { company: 'Acme', source_connection_id: 'jane' }),       // same company: no link
    p('w', 2, { company: 'Initech', source_connection_id: 'omar' }),
  ];
  const links = companyLinks(d1, d2).map((l) => [l.a, l.b, l.weight, l.via.size]).sort();
  assert.deepEqual(links, [['Acme', 'Globex', 2, 1], ['Globex', 'Initech', 1, 1]]);
});

test('ways in: people who work there, then connections who know the most people there', () => {
  const d1 = [p('jane', 1, { company: 'Globex' }), p('omar', 1, { company: 'Acme' }), p('li', 1, { company: 'Acme' })];
  const d2 = [
    p('x', 2, { company: 'Globex', source_connection_id: 'omar' }),
    p('y', 2, { company: 'Globex', source_connection_id: 'li' }),
    p('z', 2, { company: 'Globex', source_connection_id: 'li' }),
  ];
  const w = waysInto('Globex', d1, d2);
  assert.deepEqual(w.direct.map((c) => c.id), ['jane']);
  assert.deepEqual(w.bridges.map((b) => [b.bridge.id, b.n]), [['li', 2], ['omar', 1]]);
});

// ── one industry per company (lib/scoring.js companyIndustry) ─────────────────

test('every curated company has an industry the app knows, and agrees with its name', () => {
  const keys = new Set(INDUSTRIES.map((i) => i.key));
  for (const [name, , , industry] of KNOWN_COMPANIES) {
    assert.ok(keys.has(industry), `${name}: '${industry}' is not an industry key`);
    // Where the name already says something, the list says the same, so adding
    // the field changed no colour anyone had seen in Paths.
    const byName = industryOf(name, null).key;
    if (byName !== 'unknown') assert.equal(industry, byName, `${name}: list says ${industry}, name says ${byName}`);
  }
});

test('Paths colours a company with the industry scoring uses', () => {
  const rows = [
    p('a', 1, { headline: 'Engineer at Quillon' }),
    p('b', 2, { headline: 'Nurse at Quillon' }),
    p('c', 2, { headline: 'Backend developer at Quillon' }),
    p('d', 1, { headline: 'Analyst', company: 'BNY Mellon' }),
    p('e', 1, { headline: 'Designer at Adobe' }),
    p('f', 1, { headline: 'Restaurant manager at Tavola' }),
    p('g', 1, { headline: 'Nurse at Tavola' }),
  ];
  const { industries } = networkCompanies(rows, { industryOf: industryKeyOf });
  const index = buildCompanyIndex(rows);
  assert.equal(index.get('Quillon').industry.key, industries.get('Quillon'));
  assert.equal(index.get('Quillon').industry.key, 'tech');
  // Paths calls it "BNY Mellon", scoring "BNY"; both say finance.
  assert.equal(industries.get('BNY'), 'finance');
  assert.equal(index.get('BNY Mellon').industry.key, 'finance');
  // No industry word in "Adobe": the list says tech (it used to be its people's guess).
  assert.equal(index.get('Adobe').industry.key, 'tech');
  // One vote each way stays unclear, in both.
  assert.equal(industries.get('Tavola'), 'unknown');
  assert.equal(index.get('Tavola').industry, UNKNOWN_INDUSTRY);
});

test('Bain Capital and a business school keep their own industry, in scoring and in Paths', () => {
  const rows = [
    p('a', 1, { headline: 'Principal at Bain Capital' }),
    p('b', 1, { headline: 'Manager at Bain & Company' }),
    p('c', 1, { headline: 'MBA Candidate at Kellogg School of Management' }),
    p('d', 2, { headline: 'Brand Manager at Kellogg\'s' }),
  ];
  const { industries } = networkCompanies(rows, { industryOf: industryKeyOf });
  assert.deepEqual([...industries], [
    ['Bain Capital', 'finance'], ['Bain', 'consulting'], ['Kellogg School of Management', 'education'], ['Kellanova', 'consumer'],
  ]);
  // Paths groups by its own names (normalizeCompany) and colours the same way.
  const index = buildCompanyIndex(rows);
  assert.equal(index.get('Bain Capital').industry.key, 'finance');
  assert.equal(index.get('Bain & Company').industry.key, 'consulting');
  assert.equal(index.get('Kellogg School of Management').industry.key, 'education');
});
