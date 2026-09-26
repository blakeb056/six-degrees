// Preparing a scraped batch for the database. The failure these pin: one repeated
// profile made the whole insert fail, so a bridge's people were read and not saved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueByProfile, splitAlreadyConnected, refreshNotifications } from '../lib/ingest.js';

const rec = (url, name = 'Someone') => ({ profile_url: url, name });

test('a repeated profile is kept once, first occurrence wins', () => {
  const out = uniqueByProfile([rec('/in/a/', 'A1'), rec('/in/b/'), rec('/in/a/', 'A2'), rec('/in/c/'), rec('/in/b/')]);
  assert.deepEqual(out.map((r) => r.profile_url), ['/in/a/', '/in/b/', '/in/c/']);
  assert.equal(out[0].name, 'A1');
});

test('records without a profile are dropped rather than inserted', () => {
  assert.deepEqual(uniqueByProfile([rec(''), rec(null), rec('/in/x/')]).map((r) => r.profile_url), ['/in/x/']);
});

test('your own connections are set aside from someone else\'s circle', () => {
  const { keep, alreadyConnected } = splitAlreadyConnected(
    [rec('/in/mutual/'), rec('/in/stranger/'), rec('/in/also-mine/')],
    new Set(['/in/mutual/', '/in/also-mine/']),
  );
  assert.deepEqual(keep.map((r) => r.profile_url), ['/in/stranger/']);
  assert.equal(alreadyConnected, 2);
});

test('nothing is set aside when nobody is already connected', () => {
  const { keep, alreadyConnected } = splitAlreadyConnected([rec('/in/a/'), rec('/in/b/')], new Set());
  assert.equal(keep.length, 2);
  assert.equal(alreadyConnected, 0);
});

import { toIsoDate } from '../lib/ingest.js';

test('LinkedIn\'s "Connected on" dates become ISO dates, without a timezone shift', () => {
  assert.equal(toIsoDate('September 22, 2026'), '2026-09-22');
  assert.equal(toIsoDate('Sep 2, 2026'), '2026-09-02');
  assert.equal(toIsoDate('January 1, 2025'), '2025-01-01');
  assert.equal(toIsoDate('2026-09-22'), '2026-09-22');
});

test('text that is not a date gives null rather than throwing', () => {
  assert.equal(toIsoDate(''), null);
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate('yesterday'), null);
  assert.equal(toIsoDate('Smarch 3, 2026'), null);
});

test('a refresh says how many are new, and names each new person the model scored S or A', () => {
  const added = [
    { name: 'Ada', profile_url: '/in/a', headline: 'VP Sales at Hooli' },
    { name: 'Bo', profile_url: '/in/b', headline: 'Metadata Engineer at Initech' },
    { name: 'Cy', profile_url: '/in/c', headline: 'CEO at Northwind' },
    { name: 'Di', profile_url: '/in/d', headline: 'Engineer at Applewood Bakery' },
  ];
  const tiers = { '/in/a': 'A', '/in/b': 'C', '/in/c': 'S', '/in/d': 'C' };
  const out = refreshNotifications({ added, checked: 10, tierOf: (url) => tiers[url], userId: 'me' });
  assert.deepEqual(out.map((n) => [n.type, n.title, n.message]), [
    ['refresh_summary', '4 new connections found!', 'Ada, Bo, Cy +1 more'],
    ['new_elite_connection', 'High-value connection: Ada', 'VP Sales at Hooli'],
    ['new_elite_connection', 'High-value connection: Cy', 'CEO at Northwind'],
  ]);
  assert.ok(out.every((n) => n.user_id === 'me'));
  // Titles and famous names in a headline don't decide it; the tier does.
  assert.deepEqual(refreshNotifications({ added: [added[1]], tierOf: () => 'C' }).map((n) => n.type), ['refresh_summary']);
  // At most five of those.
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, profile_url: `/in/${i}`, headline: 'Founder' }));
  assert.equal(refreshNotifications({ added: many, tierOf: () => 'S' }).length, 6);
});

test('a refresh that added nobody says the network is up to date', () => {
  assert.deepEqual(refreshNotifications({ added: [], checked: 110 }).map((n) => [n.title, n.message]),
    [['Network up to date', 'Checked 110 connections — no new additions']]);
});
