// The Paths analyzer's data: companies, inferred industries, the links between
// companies, and the ways into one. Every name here is invented or a public
// company, never a person from a real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyOf, industryOf, buildCompanyIndex, companyLinks, waysInto, UNKNOWN_INDUSTRY } from '../lib/companies.js';

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
