// Two scoring fixes from the class spec (section 11, gaps 13 and 14), on
// invented rows: a company scan's finds (degree 3) no longer move everyone's
// tier cut-offs, and no longer count toward a company's headcount.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreNetwork, networkCompanies, readNetwork, companyScoreIn, SCORING_VERSION } from '../lib/scoring.js';

const person = (id, degree, headline, extra = {}) => ({ id, degree, headline, profile_url: `https://www.linkedin.com/in/${id}`, ...extra });

// Thirty of your connections, a spread of seats at companies nobody knows.
const SEATS = ['Analyst', 'Engineer', 'Manager', 'Director', 'VP of Sales', 'Founder'];
const yours = Array.from({ length: 30 }, (_, i) => person(`p${i}`, 1, `${SEATS[i % SEATS.length]} at Smallco ${i}`));

test('the curve’s cut-offs come from your 1st degree only: a company scan doesn’t move anyone’s S or A', () => {
  const scan = Array.from({ length: 160 }, (_, i) => person(`s${i}`, 3, 'Chief Executive Officer at Microsoft', { scanned_company: 'Microsoft' }));
  const without = scoreNetwork(yours, { tierScale: 'curve' });
  const withScan = scoreNetwork([...yours, ...scan], { tierScale: 'curve' });
  assert.deepEqual(withScan.cutoffs, without.cutoffs);
  for (const r of yours) assert.equal(withScan.scores.get(r.id).tier, without.scores.get(r.id).tier, r.id);
});

test('a company’s headcount is your 1st and 2nd degree: a company scan can’t lift an unknown company from 5 to 6', () => {
  const scanned = Array.from({ length: 20 }, (_, i) => person(`a${i}`, 3, 'Engineer at Acme Widgets', { scanned_company: 'Acme Widgets' }));
  const { headcount } = networkCompanies([...yours, ...scanned]);
  assert.equal(headcount.get('Acme Widgets') || 0, 0);
  const read = readNetwork([...yours, ...scanned]);
  assert.equal(companyScoreIn(read, 'Acme Widgets').score, 5);
  // Twenty of your own people there still count.
  const circle = Array.from({ length: 20 }, (_, i) => person(`c${i}`, 2, 'Engineer at Acme Widgets', { source_connection_id: 'p0' }));
  const read2 = readNetwork([...yours, ...circle]);
  assert.equal(companyScoreIn(read2, 'Acme Widgets').score, 6);
  // Someone seen at both degrees counts once, from the copy that counts.
  const both = [person('x', 3, 'Engineer at Betaworks Labs'), person('x', 2, 'Engineer at Betaworks Labs', { source_connection_id: 'p0' })];
  both[1].id = 'x2';
  assert.equal(networkCompanies(both).headcount.get('Betaworks Labs'), 1);
});

test('the fixes rescore stored scores once: a new scoring version', () => {
  assert.ok(SCORING_VERSION >= 7);
});
