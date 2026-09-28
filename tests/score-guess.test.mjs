// When a score is a guess (lib/score-guess.js): the card says so and points at
// scanning the person's circle. Invented people; public companies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreGuess } from '../lib/score-guess.js';

const scored = (headline, extra = {}) => ({ headline, power_score: 5, tier: 'B', ...extra });

test('a score that rests on a title and a company the app can read is no guess', () => {
  for (const h of ['VP Engineering at Google', 'Senior Director, Product at Snap', 'Professor of Economics at Duke University']) {
    assert.equal(scoreGuess(scored(h)), null, h);
  }
  // An audience of their own is a title, and needs no company.
  assert.equal(scoreGuess(scored('Creator | 2.5M+ followers')), null);
});

test('no title the rules read, no company the app knows: a guess, and why', () => {
  const both = scoreGuess(scored('Studio / Show'));
  assert.deepEqual([both.title, both.company, both.never], [true, true, false]);
  assert.equal(both.reason, 'Their headline names no title or company the app can read.');

  const company = scoreGuess(scored('Senior Engineer at Northwind Labs'));
  assert.deepEqual([company.title, company.company, company.companyName], [false, true, 'Northwind Labs']);
  assert.match(company.reason, /doesn’t know Northwind Labs/);

  const title = scoreGuess(scored('Google'));
  assert.deepEqual([title.title, title.company], [true, false]);
  assert.equal(title.reason, 'Their headline doesn’t say their title.');

  const nowhere = scoreGuess(scored('Head of Growth'));
  assert.deepEqual([nowhere.title, nowhere.company], [false, true]);
  assert.equal(nowhere.reason, 'The app couldn’t find where they work.');
});

test('a company someone scored is no guess, but a sector lean on an unknown one still is', () => {
  assert.equal(scoreGuess(scored('Director at Northwind Labs', { score_why: 'Director / Head (7.5) · Northwind Labs (7/10, your score)' })), null);
  assert.equal(scoreGuess(scored('Director at Northwind Labs', { score_why: 'Director / Head (7.5) · Northwind Labs (9/10, sample score)' })), null);
  assert.equal(scoreGuess(scored('Director at Northwind Labs', { score_why: 'Director / Head (7.5) · Northwind Labs (6/10: 5 + 1 your sector: Dental)' })).company, true);
});

test('never scored, and no row at all', () => {
  assert.equal(scoreGuess({ headline: 'VP at Google' }).never, true);
  assert.equal(scoreGuess({ headline: 'VP at Google', power_score: 9, tier: null }).never, true);
  assert.equal(scoreGuess(null), null);
});

test('in the invented sample network, only the three people with no company are guesses', async () => {
  const { readFileSync } = await import('node:fs');
  const demo = JSON.parse(readFileSync(new URL('../public/demo-data.json', import.meta.url), 'utf8'));
  const guesses = demo.degree1.filter((r) => scoreGuess(r));
  assert.deepEqual(guesses.map((r) => r.id), demo.degree1.filter((r) => !r.company).map((r) => r.id));
  for (const g of guesses) assert.equal(scoreGuess(g).reason, 'The app couldn’t find where they work.');
});
