// Sixgree Classes (lib/class-presets.js, lib/class-fit.js, lib/class-store.js):
// the six presets, class worth V and the class tiers, Never vetoes, the pool
// that cut-offs come from, the network tier left exactly as it is, and the
// saved build per class that switching back restores. On the synthetic sample
// network (public/demo-data.json) and invented rows, in a temporary database.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-classes-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

const presets = await import('../lib/class-presets.js');
const fit = await import('../lib/class-fit.js');
const scoring = await import('../lib/scoring.js');
const { demoRows, seedDemo } = await import('./helpers/demo-network.mjs');
const { CLASSES, CLASS_KEYS, PRESETS, FEATURE_INDEX, classPrior, PRESET_SD, OPEN_SD, INDUSTRY_SD, D, U0, warmthBand, WARMTH_BANDS } = presets;

let getDb, store, rpc;
before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  store = await import('../lib/class-store.js');
  rpc = await import('../lib/rpc.js');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

/** Facts for some rows, the way rescoring reads them. */
function factsOf(rows) {
  const read = scoring.readNetwork(rows);
  const { scores } = scoring.scoreNetwork(rows, { read, tierScale: 'curve' });
  return fit.addStructure(rows.map((r) => fit.personFacts(r, { person: read.people.get(r), scored: scores.get(r.id), companies: read.companies })));
}

const person = (id, headline, extra = {}) => ({ id, degree: 2, source_connection_id: 'b1', name: `Person ${id}`, headline, profile_url: `https://www.linkedin.com/in/${id}`, ...extra });

// ── The presets ──────────────────────────────────────────────────────────────

test('six classes, each with a preset over known features, its reach weight and its moonshot dial', () => {
  assert.deepEqual([...CLASS_KEYS], ['poacher', 'founder', 'seeker', 'grower', 'cartographer', 'infiltrator']);
  for (const c of CLASSES) {
    assert.ok(PRESETS[c.key], c.key);
    for (const k of Object.keys(PRESETS[c.key])) assert.ok(FEATURE_INDEX[k] != null, `${c.key}: ${k} is a feature`);
    assert.ok(c.gamma > 0 && c.rho > 0);
  }
  // The spec's table, spot-checked.
  assert.equal(PRESETS.founder.founder, 2.0);
  assert.equal(PRESETS.founder.startup, 0.8);
  assert.equal(PRESETS.seeker.investor, 2.5);
  assert.equal(PRESETS.infiltrator.recruiter, 2.0);
  assert.equal(PRESETS.infiltrator.targetCurrent, 2.5);
  assert.equal(PRESETS.cartographer.brokerage, 2.0);
  assert.equal(PRESETS.grower.sameMetro, 1.5);
  assert.equal(PRESETS.poacher.owner, 1.0);
  assert.equal(PRESETS.poacher.founder, 0.5);
  // Students are pushed down for everyone.
  for (const key of CLASS_KEYS) assert.ok(PRESETS[key].student < 0, key);
});

test('the prior: preset entries sd 0.5, open weights sd 1.0, industries 0.5; your sector and Less chips carry over', () => {
  const p = classPrior('founder');
  assert.equal(p.mean[FEATURE_INDEX.founder], 2.0);
  assert.equal(p.sd[FEATURE_INDEX.founder], PRESET_SD);
  assert.equal(p.sd[FEATURE_INDEX.recognised], OPEN_SD);
  assert.equal(p.sd[FEATURE_INDEX['ind:tech']], INDUSTRY_SD);
  const leaned = classPrior('founder', { focus: { sectors: ['health'], strength: 'strong' }, avoid: [{ key: 'recruiter', strength: 'less' }] });
  assert.equal(leaned.mean[FEATURE_INDEX['ind:health']], 1.0);
  assert.equal(leaned.mean[FEATURE_INDEX.recruiter], -1.0);
  assert.equal(leaned.mean.length, D + 2);
  assert.equal(leaned.mean[U0], presets.U0_PRIOR.mean);
});

test('warmth bands are Blake’s: 1 day very warm, 3 warm, 14 cool, later or never cold', () => {
  assert.deepEqual(WARMTH_BANDS.map((b) => [b.key, b.within]), [['very-warm', 1], ['warm', 3], ['cool', 14], ['cold', null]]);
  assert.equal(warmthBand(0), 'very-warm');
  assert.equal(warmthBand(1), 'very-warm');
  assert.equal(warmthBand(2), 'warm');
  assert.equal(warmthBand(3), 'warm');
  assert.equal(warmthBand(14), 'cool');
  assert.equal(warmthBand(15), 'cold');
  assert.equal(warmthBand(null), 'cold');
});

// ── Features ─────────────────────────────────────────────────────────────────

test('features read the headline for a class: founders, investors, recruiters, students, and never a name', () => {
  const rows = [
    person('f1', 'Co-founder & CEO at Quillon Labs'),
    person('v1', 'General Partner at Brightfold Ventures'),
    person('r1', 'Technical Recruiter at Northwind'),
    person('s1', 'Computer Science Student at State University'),
    person('h1', 'Head of Growth | We’re hiring!'),
  ];
  const env = fit.classEnv(factsOf(rows), { class: 'founder', setup: {} });
  const x = Object.fromEntries(factsOf(rows).map((f) => [f.id, fit.featuresOf(f, env)]));
  assert.equal(x.f1[FEATURE_INDEX.founder], 1);
  assert.equal(x.f1[FEATURE_INDEX.startup], 1, 'a founder at a company Sixgree doesn’t know is a startup founder');
  assert.equal(x.v1[FEATURE_INDEX.investor], 1);
  assert.equal(x.r1[FEATURE_INDEX.recruiter], 1);
  assert.equal(x.s1[FEATURE_INDEX.student], 1);
  assert.equal(x.h1[FEATURE_INDEX.hiring], 1);
  // The seat is a soft maximum over roles: two equal hats add about tau ln 2.
  const one = fit.softSeat([{ title: scoring.LEVELS.vp }]);
  const two = fit.softSeat([{ title: scoring.LEVELS.vp }, { title: scoring.LEVELS.vp }]);
  assert.ok(Math.abs(two - one - 0.5 * Math.log(2)) < 1e-9);
  const weak = fit.softSeat([{ title: scoring.LEVELS.ic }, { title: scoring.LEVELS.ic }, { title: scoring.LEVELS.ic }, { title: scoring.LEVELS.ic }, { title: scoring.LEVELS.ic }]);
  assert.ok(weak < one, 'five weak hats never beat one strong one');
});

test('places count only when a card read them: no location is no place, never a guess', () => {
  const home = fit.homePlace('Denver, Colorado, United States');
  assert.equal(fit.placeBand('Denver, Colorado, United States', home), 'local');
  assert.equal(fit.placeBand('Boulder, Colorado, United States', home), 'region');
  assert.equal(fit.placeBand('Austin, Texas, United States', home), 'country');
  assert.equal(fit.placeBand('London, England, United Kingdom', home), 'abroad');
  assert.equal(fit.placeBand(null, home), null);
  assert.equal(fit.placeBand('Denver, Colorado, United States', null), null, 'no home named: no place feature');
});

// ── V and the class tiers ────────────────────────────────────────────────────

test('class tiers come by share of the pool (3% S, 12% A, 25% B, 30% C), V is 1 at the S line and capped at 4', () => {
  const facts = factsOf(demoRows());
  const build = { class: 'founder', setup: { sectors: ['tech'], roles: ['cofounder'] } };
  const { results, counts, uS } = fit.scoreClass(facts, build);
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(n > 500, 'the pool is the sample’s people');
  assert.ok(Math.abs(counts.S / n - 0.03) < 0.02, `S share ${counts.S / n}`);
  assert.ok(Math.abs((counts.S + counts.A) / n - 0.15) < 0.04);
  for (const r of results.values()) {
    assert.ok(r.v > 0 && r.v <= presets.V_MAX);
    if (Math.abs(r.u - uS) < 1e-9) assert.ok(Math.abs(r.v - 1) < 1e-9);
  }
  // Network tiers are never touched: the facts' tiers are the stored ones.
  assert.deepEqual(facts.map((f) => f.tier), demoRows().map((r) => r.tier));
});

test('the Founder lens frees founders at companies nobody knows, who the network axis keeps out of S', () => {
  const rows = [
    ...Array.from({ length: 60 }, (_, i) => person(`vp${i}`, `VP of Sales at Google`)),
    ...Array.from({ length: 6 }, (_, i) => person(`f${i}`, `Co-founder & CEO at Tinyco ${i} Labs`)),
    ...Array.from({ length: 60 }, (_, i) => person(`ic${i}`, `Analyst at Acme Widgets ${i}`)),
  ];
  const facts = factsOf(rows);
  const { results } = fit.scoreClass(facts, { class: 'founder', setup: {} });
  const founderTiers = facts.filter((f) => f.id.startsWith('f')).map((f) => results.get(f.id).tier);
  assert.ok(founderTiers.every((t) => t === 'S' || t === 'A'), `founders rank high: ${founderTiers}`);
  assert.ok(results.get('f0').u > results.get('vp0').u, 'a founder outranks a Big Tech VP under the Founder lens');
  // Scored on the network axis, the Google VPs win (power score), and that axis is unchanged.
  const powers = scoring.scoreNetwork(rows, { tierScale: 'fixed' }).scores;
  assert.ok(powers.get('vp0').power > powers.get('f0').power);
});

test('Never vetoes force class D and drop out of the cut-offs; Less only pushes down', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => person(`s${i}`, 'Founder | Student at State University')),
    ...Array.from({ length: 80 }, (_, i) => person(`o${i}`, `Operations Manager at Acme ${i}`)),
  ];
  const facts = factsOf(rows);
  const never = fit.scoreClass(facts, { class: 'founder', setup: {}, avoid: [{ key: 'student', strength: 'never' }] });
  for (const f of facts.filter((x) => x.id.startsWith('s'))) {
    assert.equal(never.results.get(f.id).tier, 'D');
    assert.equal(never.results.get(f.id).never, true);
  }
  assert.equal(never.poolIdx.length, 80, 'vetoed people don’t move the cut-offs');
  const less = fit.scoreClass(facts, { class: 'founder', setup: {}, avoid: [{ key: 'student', strength: 'less' }] });
  assert.ok(facts.filter((x) => x.id.startsWith('s')).every((f) => !less.results.get(f.id).never));
  // A company Never.
  const co = fit.scoreClass(factsOf([person('a', 'CEO at Acme 1'), person('b', 'CEO at Other')]), { class: 'founder', setup: {}, avoid: [{ key: 'co:Acme 1', strength: 'never' }] });
  assert.equal(co.results.get('a').tier, 'D');
});

test('company scans (degree 3) and people known only through ties never move the class cut-offs', () => {
  const base = demoRows();
  const flood = Array.from({ length: 300 }, (_, i) => ({ ...person(`c${i}`, 'Co-founder at Unknownco'), degree: 3, source_connection_id: null }));
  const ties = Array.from({ length: 50 }, (_, i) => ({ ...person(`t${i}`, 'Co-founder at Unknownco'), seen_via: 'ties' }));
  const a = fit.scoreClass(factsOf(base), { class: 'founder', setup: {} });
  const b = fit.scoreClass(factsOf([...base, ...flood, ...ties]), { class: 'founder', setup: {} });
  assert.deepEqual(b.cutoffs, a.cutoffs);
  assert.deepEqual(b.counts, a.counts);
});

test('floors from the outside option: once you’ve said neither often, S needs to beat nobody by ln 9', () => {
  const facts = factsOf(demoRows());
  const plain = fit.scoreClass(facts, { class: 'founder', setup: {} });
  const answers = Array.from({ length: 3 }, () => ({ choice: 'neither', a: {}, b: {} }));
  const strict = fit.scoreClass(facts, { class: 'founder', setup: {}, answers, u0: 2.5 });
  assert.equal(strict.floors, true);
  assert.ok(strict.counts.S < plain.counts.S, `${strict.counts.S} < ${plain.counts.S}`);
  const two = fit.scoreClass(facts, { class: 'founder', setup: {}, answers: answers.slice(0, 2), u0: 2.5 });
  assert.equal(two.floors, false, 'not before 3 such answers');
});

test('the build in words: five bars that sum to 1, and the strongest weights', () => {
  const facts = factsOf(demoRows());
  const build = { class: 'seeker', setup: {} };
  const s = fit.scoreClass(facts, build);
  const w = fit.weightsOf(build);
  const bars = fit.buildBars(s.xs, w, { offsets: s.offsets });
  assert.deepEqual(bars.map((b) => b.key), ['sector', 'role', 'place', 'company', 'reach']);
  assert.ok(Math.abs(bars.reduce((t, b) => t + b.share, 0) - 1) < 1e-9);
  const top = fit.topWeights(s.xs, w);
  assert.ok(top.length > 0 && top.every((t) => Math.abs(t.weight) >= 0.2));
});

// ── Saved builds per class, through the store ────────────────────────────────

/** Answer a duel the same way each time: the left card, or both / neither on a schedule. */
function answerSome(db, key, n, choices = ['a', 'b', 'a', 'neither', 'both']) {
  let r = store.classAction(db, { action: 'duel', class: key, seed: 7 }).body;
  for (let i = 0; i < n && !r.done; i++) {
    r = store.classAction(db, { action: 'answer', class: key, pair: r.pair, choice: choices[i % choices.length], ms: 900, seed: 7 + i }).body;
    assert.ok(!r.error, r.error);
  }
  return r;
}

test('each class keeps its own answers and weights; switching back restores that class’s scoring exactly', async () => {
  const db = getDb();
  seedDemo(db);
  // Your field already answered: This or That then leaves Settings alone (the next test is the other case).
  const { writeSettings } = await import('../lib/settings.js');
  writeSettings(db, { fieldAsked: true });
  rpc.rescoreAll();
  const network = () => db.prepare('SELECT id, tier, power_score FROM linkedin_connections ORDER BY id').all();
  const before = network();
  assert.equal(store.classState(db).offerOpen, true, 'an existing network is offered the class pick once');

  assert.equal(store.classAction(db, { action: 'pick', class: 'founder' }).body.needsQuestions, true);
  answerSome(db, 'founder', 6);
  store.classAction(db, { action: 'finish', class: 'founder' });
  const founderWeights = store.classState(db).build;
  const founderTiers = db.prepare('SELECT id, class_tier, class_u FROM linkedin_connections ORDER BY id').all();
  assert.ok(founderTiers.some((r) => r.class_tier === 'S'));

  // Switch to the Grower: it has no answers yet, so it needs its questions.
  const g = store.classAction(db, { action: 'pick', class: 'grower' }).body;
  assert.equal(g.needsQuestions, true);
  answerSome(db, 'grower', 4, ['b', 'b', 'a']);
  const growerTiers = db.prepare('SELECT id, class_tier, class_u FROM linkedin_connections ORDER BY id').all();
  assert.notDeepEqual(growerTiers, founderTiers);

  // Back to the Founder: no questions, the same weights, the same class tiers.
  const back = store.classAction(db, { action: 'pick', class: 'founder' }).body;
  assert.equal(back.needsQuestions, false);
  assert.equal(back.restored, true);
  assert.deepEqual(db.prepare('SELECT id, class_tier, class_u FROM linkedin_connections ORDER BY id').all(), founderTiers);
  assert.deepEqual(store.classState(db).build.top, founderWeights.top);
  const goals = JSON.parse(db.prepare('SELECT goals FROM user_profile').get().goals);
  assert.ok(goals.builds.founder.answers.length >= 6);
  assert.ok(goals.builds.grower.answers.length >= 4);
  assert.equal(store.classState(db).offerOpen, false, 'offered once');

  // Network tiers stay exactly as they were through all of it.
  assert.deepEqual(network(), before);
});

test('This or That replaces the field question: where it would have asked, the answers write your field', async () => {
  const db = getDb();
  const { readSettings, writeSettings } = await import('../lib/settings.js');
  const settings = () => readSettings(db);
  writeSettings(db, { fieldAsked: false, sectorFocus: { sectors: [], strength: 'lean' } });
  store.classAction(db, { action: 'setup', class: 'founder', setup: { sectors: ['tech'], roles: ['cofounder'] } });
  const r = store.classAction(db, { action: 'finish', class: 'founder' }).body;
  assert.ok(Array.isArray(r.field) && r.field.length > 0, 'a field was written');
  assert.equal(settings().fieldAsked, true);
  assert.deepEqual(settings().sectorFocus.sectors, r.field);
  // Asked once: finishing again changes nothing.
  writeSettings(db, { sectorFocus: { sectors: ['health'], strength: 'lean' } });
  store.classAction(db, { action: 'finish', class: 'founder' });
  assert.deepEqual(settings().sectorFocus.sectors, ['health'], 'a field you set is never overwritten');
});

test('retake clears one class’s answers and keeps its target; the other class is untouched', () => {
  const db = getDb();
  const goals = () => JSON.parse(db.prepare('SELECT goals FROM user_profile').get().goals);
  store.classAction(db, { action: 'setup', class: 'founder', setup: { sectors: ['tech'], roles: ['technical'], about: { role: 'Founder' } } });
  const growerAnswers = goals().builds.grower.answers.length;
  store.classAction(db, { action: 'retake', class: 'founder' });
  assert.equal(goals().builds.founder.answers.length, 0);
  assert.deepEqual(goals().builds.founder.setup.sectors, ['tech']);
  assert.equal(goals().builds.grower.answers.length, growerAnswers);
});

test('the class stamp: a respec rescores once (rescoreIfStale), no class means empty class columns', () => {
  const db = getDb();
  const stamp = () => db.prepare("SELECT value FROM app_meta WHERE key = 'scoring_class'").get()?.value;
  store.classAction(db, { action: 'pick', class: 'seeker' });
  const s1 = stamp();
  assert.ok(s1 && s1 !== 'none');
  // A stale stamp is noticed and redone.
  db.prepare("UPDATE app_meta SET value = 'old' WHERE key = 'scoring_class'").run();
  rpc.rescoreIfStale();
  assert.equal(stamp(), s1);
  // No class: the class columns empty, stamp none.
  const g = JSON.parse(db.prepare('SELECT goals FROM user_profile').get().goals);
  g.class = null;
  db.prepare('UPDATE user_profile SET goals = ?').run(JSON.stringify(g));
  rpc.rescoreIfStale();
  assert.equal(stamp(), 'none');
  assert.equal(db.prepare('SELECT count(*) AS n FROM linkedin_connections WHERE class_tier IS NOT NULL').get().n, 0);
});

test('the Infiltrator’s target companies become your Breach targets too', () => {
  const db = getDb();
  store.classAction(db, { action: 'pick', class: 'infiltrator' });
  store.classAction(db, { action: 'setup', class: 'infiltrator', setup: { targets: ['Northwind Labs'], roles: ['engineering'] } });
  const settings = JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key = 'settings'").get().value);
  assert.ok(settings.breach.targets.includes('Northwind Labs'));
  const people = store.classState(db, { people: true }).people;
  assert.ok(people.reach.length > 0 && people.quadrant.points.length > 0);
  // The people at the target rank first among those you could add.
  assert.match(people.reach[0].headline, /Northwind Labs/);
});

test('Never show me, from the store: a Never chip forces class D in the database', () => {
  const db = getDb();
  store.classAction(db, { action: 'pick', class: 'founder' });
  store.classAction(db, { action: 'avoid', class: 'founder', avoid: [{ key: 'ind:health', strength: 'never' }] });
  const rows = db.prepare("SELECT class_tier FROM linkedin_connections WHERE headline LIKE '%Meridian Health%'").all();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.class_tier === 'D'), 'Meridian Health is in health care: all vetoed');
});
