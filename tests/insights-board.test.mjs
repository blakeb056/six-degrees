// The Insights tab's numbers (lib/insights-board.js), on a small invented
// network. Every person, company and circle here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardBase, powerIndex, filterIndex, bandText, BAND_MIN, readWorking, roleLine, kingmakers, gatekeepers,
  hiddenGiants, tierByRarity, untapped, titleLadder, companyPower, industries, coverage, howSure, reachSummary, circleOf,
} from '../lib/insights-board.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;
const why = (title, points, company, score, extra = '') => `${title} (${points}) · ${company} (${score}/10)${extra}`;

// Your connections. Maya's title is entry level, but her circle is strong.
const maya = { id: 'maya', degree: 1, name: 'Maya Ostrova', tier: 'B', power_score: 6.4, profile_url: url('maya'), headline: 'Analyst at Quillon Labs', score_why: why('IC / Entry', 4, 'Quillon Labs', 6, ' · +2 strong circle') };
const tom = { id: 'tom', degree: 1, name: 'Tom Vale', tier: 'S', power_score: 9.1, profile_url: url('tom'), headline: 'CEO at Halcyon Foods', score_why: why('C-Suite / Founder', 10, 'Halcyon Foods', 8, ' · +0.3 strong circle'), company_prestige_score: 8 };
const lee = { id: 'lee', degree: 1, name: 'Lee Brandt', tier: 'A', power_score: 7.8, profile_url: url('lee'), headline: 'Founder at Pinecrest Media', score_why: why('C-Suite / Founder', 10, 'Pinecrest Media', 6) };
const hid = { id: 'hid', degree: 1, name: 'Hana Ide', tier: 'C', power_score: 3.1, profile_url: url('hid'), headline: 'Engineer at Quillon Labs', score_why: why('IC / Entry', 4, 'Quillon Labs', 6) };
const D1 = [maya, tom, lee, hid, { ...tom, id: 'tom-again' }];   // Tom saved twice: one person

const d2 = (bridge, who, extra = {}) => ({
  id: `${bridge}-${who}`, degree: 2, source_connection_id: bridge, profile_url: url(who), name: extra.name || who,
  tier: 'C', power_score: 3, headline: `Engineer at Quillon Labs`, score_why: why('IC / Entry', 4, 'Quillon Labs', 6), ...extra,
});
const S = (name, extra = {}) => ({ name, tier: 'S', power_score: 7.8, headline: 'CEO at Northwind Foods', score_why: why('C-Suite / Founder', 10, 'Northwind Foods', 6), ...extra });
const A = (name, extra = {}) => ({ name, tier: 'A', power_score: 6, headline: 'Director at Northwind Foods', score_why: why('Director / Head', 7.5, 'Northwind Foods', 6), ...extra });
const D2 = [
  d2('maya', 'ann', S('Ann Kell')),                                  // S, only Maya, no LinkedIn count: 1 way in (scans)
  d2('maya', 'bo', S('Bo Rask', { mutual_count: 12 })),               // S, Maya and Tom
  d2('tom', 'bo', S('Bo Rask', { mutual_count: 12 })),
  d2('maya', 'cy', A('Cy Moreau', { mutual_count: 1 })),              // A, only Maya, LinkedIn says 1
  d2('maya', 'di', { name: 'Di Park', tier: 'B', power_score: 5 }),
  d2('maya', 'lee', { name: 'Lee Brandt' }),                          // your own connection, in Maya's circle
  d2('tom', 'ed', A('Ed Sato', { mutual_count: 40 })),                // A, only Tom, but LinkedIn says 40: warm
  d2('tom', 'fay', { name: 'Fay Lund' }),
  d2('gone', 'gus', S('Gus Hale')),                                   // S through a connection the app can't name
];
const NOTES = { skips: [{ profileUrl: url('hid') }], read: [], lists: { [url('maya')]: { pages: 10, more: false, total: 60 }, [url('tom')]: { pages: 3, more: true, total: 400 } } };
const base = () => boardBase({ degree1: D1, degree2: D2, degree3: [{ id: 'x', degree: 3, profile_url: url('xan'), tier: 'B' }, { ...D2[0], degree: 3 }], notes: NOTES });

test('the base counts everyone once: your connections, then their circles, then company scans', () => {
  const b = base();
  assert.deepEqual(b.d1.map((r) => r.id), ['maya', 'tom', 'lee', 'hid']);
  assert.deepEqual(b.second.map((p) => p.person.name).sort(), ['Ann Kell', 'Bo Rask', 'Cy Moreau', 'Di Park', 'Ed Sato', 'Fay Lund', 'Gus Hale']);
  assert.deepEqual(b.d3.map((r) => r.id), ['x'], 'someone already in a circle is not 3rd degree too');
  assert.equal(b.circles.get('maya').length, 4, 'Lee is yours, so not in the circle count');
  assert.equal(b.hasCircles, true);
  assert.deepEqual(reachSummary(b), {
    d1: 4, d2: 7, d3: 1, total: 11, circles: 3, sharedRows: 1,
    tiers: { d1: { S: 1, A: 1, B: 1, C: 1, D: 0 }, d2: { S: 3, A: 2, B: 1, C: 1, D: 0 } },
    source: reachSummary(b).source,
  });
  assert.deepEqual(circleOf(b, maya), { state: 'scanned', size: 4, S: 2, A: 1, tiers: { S: 2, A: 1, B: 1, C: 0, D: 0 } });
  assert.equal(circleOf(b, hid).state, 'hidden');
  assert.equal(circleOf(b, lee).state, 'todo');
});

test('the Power Index ranks everyone by power, shares ranks in a tie, and puts yours first in it', () => {
  const idx = powerIndex(base());
  assert.equal(idx.total, 11);
  const order = idx.people.map((p) => [p.row.name, p.rank, p.tied, p.degree]);
  assert.deepEqual(order.slice(0, 5), [
    ['Tom Vale', 1, false, 1],
    ['Lee Brandt', 2, true, 1],          // 7.8, yours first
    ['Bo Rask', 2, true, 2],             // then most ways in
    ['Ann Kell', 2, true, 2],
    ['Gus Hale', 2, true, 2],
  ]);
  assert.equal(idx.people.find((p) => p.row.name === 'Maya Ostrova').boost, 2, 'the circle bonus is read from the working');
  assert.deepEqual(idx.counts, {
    degree: { 1: 4, 2: 7 }, tiers: { S: 4, A: 3, B: 2, C: 2, D: 0 },
    rarity: { only: 5, rare: 0, uncommon: 0, common: 1, warm: 1 },
  });
  assert.equal(idx.bands.length, 0, `a tie of 4 is under ${BAND_MIN}: no band`);
  const bo = idx.people.find((p) => p.row.name === 'Bo Rask');
  assert.deepEqual([bo.waysIn, bo.rarity.key, bo.rarity.from, bo.routes[0].id], [2, 'common', 'linkedin', 'tom'], 'the S-tier connection is the best way in');
});

test('filters keep the whole list\'s ranks; rarity keeps the 2nd degree only; search finds who knows them', () => {
  const idx = powerIndex(base());
  const names = (list) => list.map((p) => `${p.row.name}#${p.rank}`);
  assert.deepEqual(names(filterIndex(idx, { degree: 2, tiers: new Set(['S']) })), ['Bo Rask#2', 'Ann Kell#2', 'Gus Hale#2']);
  assert.deepEqual(names(filterIndex(idx, { rarities: new Set(['only']) })).sort(), ['Ann Kell#2', 'Cy Moreau#7', 'Di Park#9', 'Fay Lund#11', 'Gus Hale#2']);
  assert.deepEqual(names(filterIndex(idx, { query: 'tom vale' })), ['Tom Vale#1', 'Bo Rask#2', 'Ed Sato#7', 'Fay Lund#11']);
  assert.equal(filterIndex(idx, { degree: 1 }).length, 4);
});

test('a big tie gets a band that says how many share the score, and the working most of them share', () => {
  const many = Array.from({ length: BAND_MIN + 2 }, (_, i) => d2('maya', `p${i}`, S(`Person ${String(i).padStart(2, '0')}`)));
  many[0].score_why = why('VP / Partner / GM', 9, 'Quillon Labs', 7);
  const idx = powerIndex(boardBase({ degree1: [maya, lee], degree2: many }));
  assert.equal(idx.bands.length, 1);
  const band = idx.bands[0];
  assert.deepEqual([band.score, band.rank, band.start, band.count, band.yours], [7.8, 1, 0, BAND_MIN + 3, 1]);
  assert.deepEqual(band.common, { title: 'C-Suite / Founder', companyScore: 6, count: BAND_MIN + 2 });
  assert.deepEqual(bandText(band), { head: '13 people share 7.8.', rest: 'Most are C-Suite / Founder at a company scored 6 (12 of them).' });
  assert.equal(bandText({ ...band, common: { ...band.common, count: band.count } }).rest, 'Every one is C-Suite / Founder at a company scored 6.');
  assert.equal(bandText({ ...band, common: { ...band.common, count: 3 } }).rest, 'The most common is C-Suite / Founder at a company scored 6 (3 of them).');
  assert.deepEqual(bandText({ ...band, common: null }), { head: '13 people share 7.8.', rest: '' });
});

test('the stored working is read in all its forms', () => {
  assert.deepEqual(readWorking({ score_why: 'VP / Partner / GM (9) · Adobe (8/10) · +0.7 strong circle' }),
    { title: 'VP / Partner / GM', company: 'Adobe', companyScore: 8, yours: false, sector: false, boost: 0.7 });
  assert.deepEqual(readWorking({ score_why: 'Owner / Entrepreneur (8) · Smith Family Practice (6/10: 5 + 1 your sector: Dental)' }),
    { title: 'Owner / Entrepreneur', company: 'Smith Family Practice', companyScore: 6, yours: false, sector: true, boost: 0 });
  assert.deepEqual(readWorking({ score_why: 'Former Director / Head (5.3) · Quillon (7/10, your score)' }),
    { title: 'Director / Head', company: 'Quillon', companyScore: 7, yours: true, sector: false, boost: 0 });
  assert.deepEqual(readWorking({ score_why: 'Account Executive (10, your ranking) · no company found (5/10)' }),
    { title: 'Account Executive', company: null, companyScore: 5, yours: false, sector: false, boost: 0 });
  assert.equal(readWorking({}).title, null);
  // No working (a CSV import): the headline and the stored company say it.
  assert.deepEqual(roleLine({ headline: 'VP Sales', company: 'Halcyon Foods' }), { title: 'VP / Partner / GM', company: 'Halcyon Foods' });
});

test('kingmakers: who has the most S and A behind them, whatever their own tier', () => {
  const k = kingmakers(base());
  assert.deepEqual(k.list.map((x) => [x.row.id, x.S, x.A, x.SA, x.size]), [['maya', 2, 1, 3, 4], ['tom', 1, 1, 2, 3]]);
  assert.equal(k.scanned, 2, 'a circle the app can\'t name isn\'t a kingmaker');
  assert.match(k.source, /^From the 2 circles you’ve scanned/);
});

test('gatekeepers: S and A with one way in, credited to that way; the top three\'s share counts no one twice', () => {
  const g = gatekeepers(base());
  assert.deepEqual(g.list.map((x) => [x.row.id, x.onlySA, x.onlyS]), [['maya', 2, 1], ['tom', 1, 0]]);
  assert.equal(g.totalSA, 5);
  assert.equal(g.onlySA, 4, 'Gus counts: his only way in is a connection the app can\'t name');
  assert.equal(Math.round(g.onlyShare), 80);
  // Maya: Ann, Cy, half of Bo. Tom: Ed, half of Bo. 2.5 + 1.5 of 5.
  assert.deepEqual(g.top3.map((x) => [x.row.id, x.credit, x.share]), [['maya', 2.5, 50], ['tom', 1.5, 30]]);
  assert.equal(g.top3Share, 80);
});

test('hidden giants: S-tier with one way in, saying whether LinkedIn or your scans counted it', () => {
  const h = hiddenGiants(base());
  assert.deepEqual(h.list.map((x) => [x.row.name, x.from, x.via?.id ?? null]), [['Ann Kell', 'scans', 'maya'], ['Gus Hale', 'scans', null]]);
  assert.deepEqual([h.count, h.ofS, h.fromLinkedIn, h.fromScans], [2, 3, 0, 2]);
  // LinkedIn's own count wins over one way in drawn.
  const h2 = hiddenGiants(boardBase({ degree1: [maya], degree2: [d2('maya', 'ann', S('Ann Kell', { mutual_count: 1 })), d2('maya', 'zo', S('Zo Ek', { mutual_count: 5 }))] }));
  assert.deepEqual(h2.list.map((x) => [x.row.name, x.from]), [['Ann Kell', 'linkedin']]);
  assert.equal(h2.fromLinkedIn, 1);
});

test('tier by rarity counts the 2nd degree, and where each count came from', () => {
  const t = tierByRarity(base());
  assert.deepEqual(t.grid.S, { only: 2, rare: 0, uncommon: 0, common: 1, warm: 0 });
  assert.deepEqual(t.grid.A, { only: 1, rare: 0, uncommon: 0, common: 0, warm: 1 });
  assert.deepEqual(t.from, { linkedin: 3, scans: 4 });
});

test('untapped: S and A with no request out, from the one list of requests', () => {
  const asked = new Set([url('bo'), url('fay')]);
  const u = untapped(base(), (row) => asked.has(row.profile_url));
  assert.deepEqual([u.S, u.A, u.total, u.asked, u.askedSA], [2, 2, 4, 2, 1]);
  assert.match(u.source, /2 to people in your 2nd degree/);
  assert.equal(untapped(base()).total, 5, 'nobody asked: every S and A');
});

test('the title ladder reads each person\'s current title once', () => {
  const rows = [
    { id: 'a', degree: 1, profile_url: url('a'), headline: 'CEO at Quillon Labs' },
    { id: 'b', degree: 1, profile_url: url('b'), headline: 'VP Sales at Halcyon Foods' },
    { id: 'c', degree: 1, profile_url: url('c'), headline: 'Storyteller' },
  ];
  const two = [
    { id: 'd', degree: 2, source_connection_id: 'a', profile_url: url('d'), headline: 'Director of Operations at Pinecrest Media' },
    { id: 'e', degree: 2, source_connection_id: 'a', profile_url: url('e'), headline: 'Student at Northwind University' },
  ];
  const l = titleLadder(boardBase({ degree1: rows, degree2: two }));
  const by = Object.fromEntries(l.rungs.map((r) => [r.key, [r.d1, r.d2]]));
  assert.deepEqual(by, { csuite: [1, 0], owner: [0, 0], vp: [1, 0], director: [0, 1], manager: [0, 0], senior: [0, 0], ic: [0, 0], unknown: [1, 0], early: [0, 1] });
  assert.deepEqual([l.decide, l.decideYours], [2, 2]);
});

test('company power adds up everyone there, with ways in, its score and where that came from', () => {
  const c = companyPower(base());
  const foods = c.list.find((x) => x.name === 'Northwind Foods');
  // Ann 7.8 + Bo 7.8 + Gus 7.8 + Cy 6 + Ed 6
  assert.deepEqual([foods.people, foods.S, foods.A, foods.total, foods.d1, foods.d2], [5, 3, 2, 35.4, 0, 5]);
  assert.equal(foods.waysIn, 2, 'Maya and Tom; the way in nobody can name is no way in');
  assert.deepEqual(foods.bridges.map((b) => [b.bridge.id, b.people]), [['maya', 3], ['tom', 2]]);
  assert.deepEqual([foods.score, foods.scoreSource], [6, 'estimate']);
  assert.equal(foods.industry.key, 'consumer', '"Foods" reads as retail');
  assert.equal(c.list[0].name, 'Northwind Foods', 'the most power first');
  // Richest? Only Tom's score rests on a company scored 8 or more.
  assert.deepEqual(c.big, { people: 1, companies: 1 });
  assert.equal(c.estimated, c.count);
  const ind = industries(c);
  const consumer = ind.list.find((e) => e.key === 'consumer');
  assert.deepEqual([consumer.companies, consumer.S, consumer.A], [2, 4, 2]);
  assert.equal(ind.list[0].key, 'consumer');
  assert.equal(Math.round(ind.list.reduce((t, e) => t + e.share, 0)), 100);
});

test('a company you scored says so', () => {
  const rows = [{ ...maya, score_why: 'IC / Entry (4) · Quillon Labs (7/10, your score)' }];
  const c = companyPower(boardBase({ degree1: rows }));
  assert.deepEqual([c.list[0].name, c.list[0].score, c.list[0].scoreSource], ['Quillon Labs', 7, 'yours']);
});

test('coverage: scanned, hidden and not yet by tier, how far lists were read, and what the next five cost', () => {
  const c = coverage(base(), { daily: 25 });
  assert.deepEqual([c.scanned, c.hidden, c.todo, c.total], [2, 1, 1, 4]);
  assert.deepEqual(c.byTier.S, { scanned: 1, hidden: 0, todo: 0, total: 1 });
  assert.deepEqual(c.lists, { full: 1, partial: 1, unknown: 0 });
  assert.deepEqual(c.strongest.map((r) => r.id), ['lee']);
  assert.deepEqual([c.each.searches, c.nextSearches, c.nextDays, c.daily], [100, 100, 4, 25]);
  assert.equal(c.todoSA, 1);
  assert.equal(coverage(base()).daily, 50, 'the default budget when yours isn\'t known');
});

test('how sure: the share of scores that rest on a guess, and the top tie', () => {
  const rows = [
    { ...tom, score_why: why('C-Suite / Founder', 10, 'Google', 10), company_prestige_score: 10, headline: 'CEO at Google' },
    { ...lee },
    { ...hid, headline: 'Storyteller', score_why: why('Title unclear', 4, 'Quillon Labs', 6) },
  ];
  const s = howSure(powerIndex(boardBase({ degree1: rows })));
  assert.deepEqual([s.guessed, s.company, s.both, s.title, s.total], [2, 1, 1, 0, 3]);
  assert.equal(Math.round(s.share), 67);
  assert.equal(s.tie, null);
});

test('a CSV import (your connections only) and an empty network give zeros, never a made-up number', () => {
  const csv = boardBase({ degree1: [maya, tom] });
  assert.equal(csv.hasCircles, false);
  assert.deepEqual(kingmakers(csv).list, []);
  assert.deepEqual([gatekeepers(csv).totalSA, gatekeepers(csv).top3Share, gatekeepers(csv).onlyShare], [0, 0, 0]);
  assert.equal(hiddenGiants(csv).count, 0);
  assert.equal(untapped(csv).total, 0);
  assert.equal(coverage(csv).todo, 2);
  assert.equal(powerIndex(csv).total, 2);
  const none = boardBase();
  assert.equal(powerIndex(none).total, 0);
  assert.equal(companyPower(none).count, 0);
  assert.equal(howSure(powerIndex(none)).share, 0);
  assert.equal(coverage(none).perCircle, 0);
  assert.equal(titleLadder(none).decide, 0);
  assert.equal(industries(companyPower(none)).list.length, 0);
});
