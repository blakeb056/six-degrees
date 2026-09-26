// Neutral built-in company scores: the curated list follows one written rule
// (lib/scoring.js KNOWN_COMPANIES), its old scores live apart from the model
// (lib/legacy-scores.js), and a database scored with them is offered, once, to
// keep them as its own (lib/legacy-offer.js). Invented people; public companies.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_COMPANIES, cleanCompany, companyScore, knownIndustry, scorePerson, explainScore } from '../lib/scoring.js';
import { LEGACY_SCORES } from '../lib/legacy-scores.js';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-legacy-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let getDb, rescoreAll, rescoreIfStale, KNOWN_LIST_STAMP;
let legacyOffer, legacyOfferState, answerLegacyOffer, parseLegacyAnswer, legacyEntryFor;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ rescoreAll, rescoreIfStale, KNOWN_LIST_STAMP } = await import('../lib/rpc.js'));
  ({ legacyOffer, legacyOfferState, answerLegacyOffer, parseLegacyAnswer, legacyEntryFor } = await import('../lib/legacy-offer.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'company_scores', 'app_meta']) getDb().exec(`DELETE FROM ${t}`);
});

const known = new Map(KNOWN_COMPANIES.map(([name, score, alias, industry]) => [name, { score, alias, industry }]));

// ── the rule ────────────────────────────────────────────────────────────────

test('Snap is scored like its peers, and nothing on the list is below 7', () => {
  for (const name of ['Snap', 'Pinterest', 'Reddit', 'X']) assert.deepEqual(companyScore(name), { score: 8, source: 'known' }, name);
  for (const [name, score] of KNOWN_COMPANIES) assert.ok(score >= 7 && score <= 10, `${name} is ${score}`);
  // The aliases still read as Snap, and the working says what it is now.
  assert.equal(cleanCompany('Snapchat 👻'), 'Snap');
  const s = scorePerson({ headline: 'Director of Partnerships at Snap' });
  assert.deepEqual([s.companyScore, s.power, s.tier], [8, 6.7, 'A']);
  assert.equal(explainScore(s), 'Director / Head (7.5) · Snap (8/10)');
});

test('no comment in the curated list speaks for one person', () => {
  // "your home turf", "your local institutions": the list is everyone's default.
  const src = readFileSync(path.join(ROOT, 'lib/scoring.js'), 'utf8');
  const start = src.indexOf('// ── company ──');
  const end = src.indexOf('\n];\n', src.indexOf('export const KNOWN_COMPANIES = ['));
  assert.ok(start > 0 && end > start, 'found the list');
  const comments = src.slice(start, end).split('\n').map((line) => line.split('//')[1]).filter(Boolean);
  assert.ok(comments.length > 20, 'read its comments');
  for (const c of comments) assert.doesNotMatch(c, /\byou(r|rs|'re)?\b/i, c.trim());
});

test('a removed company is estimated from the network like any other', () => {
  const removed = LEGACY_SCORES.filter(([name]) => !known.has(name));
  assert.ok(removed.length > 20);
  for (const [name, , , industry] of removed) {
    assert.equal(knownIndustry(name), null, name);
    assert.deepEqual(companyScore(name), { score: 4, source: 'default' }, name);
    // Many of your people there lift it, as for any company but a school.
    assert.deepEqual(companyScore(name, { headcount: 15, industry }),
      industry === 'education' ? { score: 4, source: 'default' } : { score: 6, source: 'network' }, name);
  }
  // Someone at a company the list used to call elite is scored as at any other.
  const pm = scorePerson({ headline: 'Head of Growth at Polymarket' });
  assert.deepEqual([pm.company, pm.companyScore, pm.companySource], ['Polymarket', 4, 'default']);
  // A removed entry's aliases no longer fold names together.
  assert.equal(cleanCompany('University of Central Florida'), 'University of Central Florida');
  assert.equal(cleanCompany('UCF'), 'UCF');
  assert.equal(cleanCompany('Hard Rock Hotel & Casino'), 'Hard Rock Hotel & Casino');
});

test('the old scores live apart from the model, one row per entry removed or rescored', () => {
  const names = LEGACY_SCORES.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
  // Offered only for the entry's own company's names, which end there, except
  // where every company starting so is the entry's (UCF's colleges,
  // AdventHealth's hospitals, Havas's agencies).
  const open = new Set(['UCF', 'AdventHealth', 'Havas']);
  for (const [name, score, own, industry] of LEGACY_SCORES) {
    assert.ok(Number.isInteger(score) && score >= 1 && score <= 10, name);
    assert.ok(own instanceof RegExp && !own.flags.includes('g'), name);
    assert.equal(own.source.endsWith('$'), !open.has(name), `${name}: ${own}`);
    const now = known.get(name);
    if (!now) continue;                                     // removed
    assert.notEqual(now.score, score, `${name} is on both lists at one score`);
    assert.equal(String(now.alias), String(own), `${name} is offered for the names the list reads as it`);
    assert.equal(now.industry, industry, `${name}'s industry changed`);
  }
  assert.deepEqual(LEGACY_SCORES.find(([n]) => n === 'Snap').slice(0, 2), ['Snap', 9]);
  assert.deepEqual(LEGACY_SCORES.find(([n]) => n === 'UCF').slice(0, 2), ['UCF', 5]);
  // The model imports nothing, so it can't read them.
  const src = readFileSync(path.join(ROOT, 'lib/scoring.js'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m);
});

test('an old entry is found by the name scoring gives the company now', () => {
  const entry = (n) => legacyEntryFor(n)?.name ?? null;
  assert.equal(entry('Snap'), 'Snap');                       // rescored, still listed
  assert.equal(entry('Google'), null);                       // unchanged
  assert.equal(entry('Acme'), null);
  for (const n of ['UCF', 'University of Central Florida', 'the University of Central Florida', 'UCF College of Business']) assert.equal(entry(n), 'UCF', n);
  for (const n of ['UF', 'University of Florida']) assert.equal(entry(n), 'University of Florida', n);
  for (const n of ['Hard Rock Digital', 'VaynerMedia', 'Vayner Media', 'The Athletic', 'Later', 'Anduril Industries', 'Notion Labs', 'Hims & Hers Health']) {
    assert.ok(entry(n), n);
  }
  // Other companies the old aliases also caught: the old list scored them by
  // mistake, and keeping must not give them its score.
  for (const n of ['Hard Rock Hotel & Casino', 'Hard Rock Cafe', 'VaynerX', 'The Athletic Club', 'Later Media', 'Notion Wellness',
    'Plaid Pantry', 'Whatnot Antiques', 'Snap-on', 'Snap Finance', 'Specs', 'Specs Optical', 'Beast Industries Foundation']) {
    assert.equal(entry(n), null, n);
  }
  // As the old list read them: a school only matched a school.
  assert.equal(entry('Havas University'), null);
  assert.equal(entry(null), null);
});

// ── the offer ───────────────────────────────────────────────────────────────

function insert(rows, { tier = null } = {}) {
  const st = getDb().prepare(`INSERT INTO linkedin_connections (id, degree, name, headline, company, profile_url, source_connection_id, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) st.run(r.id, r.degree ?? 1, r.name, r.headline, r.company ?? null, r.profile_url ?? `/in/${r.id}`, r.source_connection_id ?? null, r.tier ?? tier);
}
const meta = (key) => getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;
const row = (id) => getDb().prepare('SELECT * FROM linkedin_connections WHERE id = ?').get(id);
const yours = () => Object.fromEntries(getDb().prepare('SELECT name, score FROM company_scores ORDER BY name').all().map((r) => [r.name, r.score]));

// Invented people at companies the old list scored, and one it still scores the same.
function network() {
  return [
    { id: 'dev', name: 'Dev Moreau', headline: 'Director of Partnerships at Snap' },
    { id: 'uma', name: 'Uma Castell', headline: 'Research Assistant at University of Central Florida' },
    { id: 'ubo', name: 'Ubo Lind', headline: 'Lecturer at UCF' },
    { id: 'pia', name: 'Pia Okoro', headline: 'Product Manager at Polymarket' },
    { id: 'gus', name: 'Gus Adair', headline: 'Engineer at Google' },
    // Only a former employer: nobody works there now, so Paths → Scores doesn't
    // list it, and a score kept for it would be one you couldn't see or undo.
    { id: 'rex', name: 'Rex Halden', headline: 'Consultant | Ex-Director at Hard Rock Hotel' },
  ];
}

// A database a copy from before the neutral list scored: tiers stored, the
// model stamped, and no list stamp, since those copies had none.
function oldDatabase(rows = network()) {
  insert(rows, { tier: 'B' });
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('scoring_version', '2')").run();
}

const counting = () => {
  const r = { calls: 0 };
  r.rescore = () => { r.calls++; return rescoreAll(); };
  return r;
};

test('a fresh database is never offered, however it is scored', () => {
  rescoreIfStale();                                          // the first load, nothing scanned yet
  insert(network());                                         // a first scan: no tiers yet
  rescoreAll();
  assert.equal(meta('scoring_list'), KNOWN_LIST_STAMP);
  assert.equal(legacyOfferState(), null);
  assert.equal(legacyOffer(), null);
  rescoreAll();
  assert.equal(legacyOffer(), null);
  assert.deepEqual(answerLegacyOffer(['Snap']), { kept: [], scored: 0 });
  assert.deepEqual(yours(), {});
});

test('a database scored with the old list is offered what changed in it, once it is rescored', () => {
  oldDatabase();
  assert.equal(legacyOffer(), null, 'nothing is offered before the old scores are replaced');
  assert.deepEqual(rescoreIfStale(), { scored: 6 });         // the first load after updating
  assert.equal(legacyOfferState(), 'open');
  assert.deepEqual(legacyOffer(), { companies: [
    { name: 'UCF', was: 5, now: 4, estimated: true, people: 2, names: ['UCF', 'University of Central Florida'] },
    { name: 'Polymarket', was: 9, now: 4, estimated: true, people: 1, names: ['Polymarket'] },
    { name: 'Snap', was: 9, now: 8, estimated: false, people: 1, names: ['Snap'] },
  ] });
  // The old alias read Hard Rock Hotel as Hard Rock Digital (6), which it isn't
  // (and it is only Rex's former employer).
  assert.equal(legacyEntryFor('Hard Rock Hotel'), null);
  // The stored scores are the new ones meanwhile.
  assert.deepEqual([row('dev').company_prestige_score, row('pia').company_prestige_score], [8, 4]);
});

test('a company you scored yourself is not offered, nor one whose estimate lands on its old score', () => {
  const later = Array.from({ length: 15 }, (_, i) => ({ id: `l${i}`, name: `Lee Varga ${i}`, headline: 'Marketer at Later' }));
  oldDatabase([...network(), ...later]);
  getDb().prepare("INSERT INTO company_scores (id, name, score) VALUES ('a', 'Snap', 9), ('b', 'UCF', 7)").run();
  rescoreAll();
  const offer = legacyOffer();
  const byName = Object.fromEntries(offer.companies.map((c) => [c.name, c]));
  assert.equal(byName.Snap, undefined);                      // yours
  assert.deepEqual(byName.UCF.names, ['University of Central Florida']);   // the name you haven't scored
  assert.equal(byName.Later, undefined);                     // 15 people: estimated at 6, as it was
  assert.ok(byName.Polymarket);
});

test('an old database whose network the change didn\'t touch shows nothing, and the offer closes on that first look', () => {
  oldDatabase([{ id: 'gus', name: 'Gus Adair', headline: 'Engineer at Google' }]);
  rescoreIfStale();
  assert.equal(legacyOfferState(), 'open');
  assert.equal(legacyOffer(), null);
  // Closed, so Paths → Scores stops reading the whole network for it on every
  // visit, and a card can't turn up months later.
  assert.equal(legacyOfferState(), 'none');
  insert([{ id: 'pia', name: 'Pia Okoro', headline: 'Product Manager at Polymarket' }]);
  rescoreAll();
  assert.equal(legacyOfferState(), 'none');
  assert.equal(legacyOffer(), null);
  assert.deepEqual(answerLegacyOffer(['Polymarket']), { kept: [], scored: 0 });
  assert.deepEqual(yours(), {});
  // A database that is empty when first looked at closes it too.
  getDb().exec('DELETE FROM linkedin_connections');
  getDb().prepare("UPDATE app_meta SET value = 'open' WHERE key = 'legacy_scores_offer'").run();
  assert.equal(legacyOffer(), null);
  assert.equal(legacyOfferState(), 'none');
});

test('a company that only shares a name with an old entry is not offered its score', () => {
  // The old list read Snap-on, Specs Optical and Hard Rock Hotel as Snap and
  // Hard Rock Digital. Keeping Snap must not give Snap-on 9.
  oldDatabase([
    ...network(),
    { id: 'sol', name: 'Sol Ortega', headline: 'Territory Manager at Snap-on' },
    { id: 'spe', name: 'Spe Varga', headline: 'Optician at Specs Optical' },
    { id: 'hal', name: 'Hal Brandt', headline: 'Director at Hard Rock Hotel' },
  ]);
  rescoreIfStale();
  const offer = legacyOffer();
  const snap = offer.companies.find((c) => c.name === 'Snap');
  assert.deepEqual([snap.people, snap.names], [1, ['Snap']]);
  assert.equal(offer.companies.find((c) => c.name === 'Hard Rock Digital'), undefined);
  answerLegacyOffer(offer.companies.map((c) => c.name));
  assert.deepEqual(yours(), { Polymarket: 9, Snap: 9, UCF: 5, 'University of Central Florida': 5 });
  assert.equal(row('dev').company_prestige_score, 9);
  for (const id of ['sol', 'spe', 'hal']) assert.equal(row(id).company_prestige_score, 4, id);
});

test('keeping writes the old scores under every name scoring uses, then rescores once', () => {
  oldDatabase();
  rescoreIfStale();
  const r = counting();
  const answer = answerLegacyOffer(['Snap', 'UCF', 'Not offered'], { rescore: r.rescore });
  assert.equal(r.calls, 1, 'one rescore for the whole batch');
  assert.deepEqual(answer, { scored: 6, kept: [
    { name: 'UCF', score: 5, names: ['UCF', 'University of Central Florida'] },
    { name: 'Snap', score: 9, names: ['Snap'] },
  ] });
  assert.deepEqual(yours(), { Snap: 9, UCF: 5, 'University of Central Florida': 5 });
  // Rows exactly like Paths → Scores writes: an id and a time on each.
  for (const c of getDb().prepare('SELECT * FROM company_scores').all()) assert.ok(c.id && c.updated_at, c.name);
  // Everyone there carries the kept score, as their own.
  assert.equal(row('dev').company_prestige_score, 9);
  assert.match(row('dev').score_why, /Snap \(9\/10, your score\)/);
  assert.deepEqual([row('uma').company_prestige_score, row('ubo').company_prestige_score], [5, 5]);
  assert.equal(row('pia').company_prestige_score, 4);         // not kept: estimated
  // Answered: never offered again, whatever rescores next.
  assert.equal(legacyOfferState(), 'kept');
  assert.equal(legacyOffer(), null);
  rescoreAll();
  assert.equal(legacyOffer(), null);
  assert.deepEqual(answerLegacyOffer(['Polymarket'], { rescore: r.rescore }), { kept: [], scored: 0 });
  assert.equal(r.calls, 1);
  assert.deepEqual(yours(), { Snap: 9, UCF: 5, 'University of Central Florida': 5 });
});

test('No thanks keeps nothing, rescores nothing, and never asks again', () => {
  oldDatabase();
  rescoreIfStale();
  const r = counting();
  assert.deepEqual(answerLegacyOffer([], { rescore: r.rescore }), { kept: [], scored: 0 });
  assert.equal(r.calls, 0);
  assert.equal(legacyOfferState(), 'declined');
  assert.deepEqual(yours(), {});
  assert.equal(legacyOffer(), null);
  // Even if the stored scores look old again, the answer stands.
  getDb().exec("DELETE FROM app_meta WHERE key = 'scoring_list'");
  rescoreIfStale();
  assert.equal(legacyOfferState(), 'declined');
  assert.equal(legacyOffer(), null);
});

test('stored scores from another curated list are stale, whatever the model version says', () => {
  insert(network());
  rescoreAll();
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  // The unreleased build before this one: model 3, the old list, no list stamp.
  getDb().exec("DELETE FROM app_meta WHERE key = 'scoring_list'");
  assert.deepEqual(rescoreIfStale(), { scored: 6 });
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  getDb().exec("UPDATE app_meta SET value = 'another list' WHERE key = 'scoring_list'");
  assert.deepEqual(rescoreIfStale(), { scored: 6 });
});

test('a failed rescore after keeping still answers, says so, and the next load redoes it', () => {
  oldDatabase();
  rescoreIfStale();
  let error;
  try {
    answerLegacyOffer(['Snap'], { rescore: () => { throw new Error('disk full (simulated)'); } });
  } catch (err) { error = err; }
  assert.equal(error?.message, 'Kept, but rescoring your network failed (disk full (simulated)). It will try again the next time the map loads.');
  assert.deepEqual(error.kept, [{ name: 'Snap', score: 9, names: ['Snap'] }]);
  assert.equal(legacyOfferState(), 'kept');
  assert.deepEqual(yours(), { Snap: 9 });
  assert.equal(row('dev').company_prestige_score, 8);        // not rescored yet
  assert.deepEqual(rescoreIfStale(), { scored: 6 });
  assert.equal(row('dev').company_prestige_score, 9);
  assert.equal(legacyOffer(), null);
});

test('an answer is a list of names, and nothing else', () => {
  assert.deepEqual(parseLegacyAnswer({ keep: [] }), []);
  assert.deepEqual(parseLegacyAnswer({ keep: ['Snap', 'UCF'] }), ['Snap', 'UCF']);
  for (const bad of [null, {}, { keep: 'Snap' }, { keep: [1] }, { keep: [{ name: 'Snap' }] }, { keep: ['x'.repeat(201)] }, { keep: Array(101).fill('Snap') }]) {
    assert.throws(() => parseLegacyAnswer(bad), /list of names/, JSON.stringify(bad)?.slice(0, 40));
  }
});
