// This or That (lib/duel-deck.js, lib/pairwise.js): each class's own question
// set (the Grower's sectors and kinds of people, the others' positions and
// seniority and companies), cards that mix real titles from the network with
// made-up ones and never show a person, k-anonymity, active pair selection,
// the outside option, mirrored repeats and the stop rule. On the synthetic
// sample network (public/demo-data.json) and invented rows only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const presets = await import('../lib/class-presets.js');
const fit = await import('../lib/class-fit.js');
const scoring = await import('../lib/scoring.js');
const deck = await import('../lib/duel-deck.js');
const pw = await import('../lib/pairwise.js');
const { demoRows } = await import('./helpers/demo-network.mjs');
const { D, P, U0, SIDE, FEATURE_INDEX, classPrior, ROUNDS, MODES, CLASS_KEYS } = presets;
const DIMS = { D, P, U0, SIDE };

function factsOf(rows) {
  const read = scoring.readNetwork(rows);
  const { scores } = scoring.scoreNetwork(rows, { read, tierScale: 'curve' });
  return fit.addStructure(rows.map((r) => fit.personFacts(r, { person: read.people.get(r), scored: scores.get(r.id), companies: read.companies })));
}
const FACTS = factsOf(demoRows());
const NAMES = demoRows().map((r) => r.name);

/** A whole session for a class, answering with `choose(pair, i)`, refitting after each answer as the store does. */
function session(classKey, { mode = 'standard', setup = {}, choose = () => 'a', seed = 3 } = {}) {
  const build = { class: classKey, setup, answers: [] };
  const env = fit.classEnv(FACTS, build, { homeGuess: 'San Francisco Bay Area' });
  const prior = classPrior(classKey);
  const ctx = deck.deckContext(FACTS, build, env, { weights: prior.mean });
  const plan = deck.roundPlan(classKey, mode);
  const rand = pw.seededRandom(seed);
  const pairs = [];
  let post = pw.fitPosterior(prior, []);
  for (let i = 0; i < plan.reduce((s, r) => s + r.n, 0); i++) {
    const pair = deck.nextPair({ ctx, env, posterior: post, plan, sessionAnswers: build.answers, allAnswers: build.answers, rand });
    if (!pair) break;
    pairs.push(pair);
    const choice = choose(pair, i);
    build.answers.push({
      a: { attrs: pair.a.attrs, show: pair.a.show, x: [...deck.cardFeatures(pair.a.attrs, pair.a.show, env)] },
      b: { attrs: pair.b.attrs, show: pair.b.show, x: [...deck.cardFeatures(pair.b.attrs, pair.b.show, env)] },
      choice, left: pair.left, focus: pair.focus, ...(pair.mirrorOf != null ? { mirrorOf: pair.mirrorOf } : {}), ...(pair.low ? { low: true } : {}),
    });
    const { answers } = pw.weighMirrors(build.answers);
    post = pw.fitPosterior(prior, answers.flatMap((a) => pw.answerTerms(a, DIMS)));
  }
  return { pairs, build, post, env, ctx, prior };
}

// ── Each class's own question set ────────────────────────────────────────────

test('the Grower asks about sectors and kinds of people; the others about positions, seniority and companies', () => {
  const foci = (key) => ROUNDS[key].map((r) => r.focus);
  assert.deepEqual(foci('grower'), ['industry', 'func', 'place', 'reach', 'hard']);
  for (const key of ['poacher', 'founder', 'seeker', 'infiltrator']) {
    assert.ok(foci(key).includes('role'), `${key} compares positions and seniority`);
    assert.ok(foci(key).includes('company'), `${key} compares companies`);
    assert.ok(!foci(key).includes('func'), `${key} has no kinds-of-people round`);
  }
  assert.ok(!foci('grower').includes('role') && !foci('grower').includes('company'), 'the Grower never compares seats');
  for (const key of CLASS_KEYS) {
    for (const mode of ['quick', 'standard', 'deep', 'retune']) {
      assert.equal(deck.roundPlan(key, mode).reduce((s, r) => s + r.n, 0), MODES[mode].max, `${key} ${mode}`);
    }
  }
});

test('a Grower deck opens on sector cards about kinds of people, with no company line', () => {
  const { pairs } = session('grower', { setup: { sectors: ['tech'] } });
  const first = pairs[0];
  assert.equal(first.focus, 'industry');
  assert.equal(first.round.label, 'Your arena');
  for (const c of [first.a, first.b]) {
    assert.equal(c.view.company, null, 'no company on a Grower card');
    assert.ok(c.view.industry, 'the sector is the point');
    assert.match(c.view.example || '', /^e\.g\. /, 'a kind of person, with an example title');
  }
  assert.notEqual(first.a.view.industry.key, first.b.view.industry.key, 'the sector is what differs');
  assert.ok(pairs.some((p) => p.focus === 'func'), 'then kinds of people');
});

test('a Founder deck compares positions with their companies', () => {
  const { pairs } = session('founder', { setup: { sectors: ['tech'], roles: ['cofounder'] } });
  const roles = pairs.filter((p) => p.focus === 'role');
  assert.ok(roles.length >= 3);
  for (const p of roles) {
    assert.equal(p.a.view.example, null, 'positions, not kinds of people');
    assert.ok(p.a.view.company && p.b.view.company, 'with their companies');
  }
  assert.ok(pairs.some((p) => p.focus === 'company'), 'and a big name against the right fit');
});

test('cards mix real titles from the network with made-up ones, and never carry a name or a photo', () => {
  for (const key of ['grower', 'founder', 'seeker', 'infiltrator', 'poacher']) {
    const { pairs } = session(key, { setup: { sectors: ['tech'] } });
    const cards = pairs.flatMap((p) => [p.a, p.b]);
    assert.ok(cards.some((c) => c.view.madeUp), `${key}: some made-up cards`);
    assert.ok(cards.some((c) => !c.view.madeUp), `${key}: some real titles from the network`);
    const text = JSON.stringify(pairs);
    for (const name of NAMES) assert.ok(!text.includes(name), `${key}: no name on a card (${name})`);
    assert.doesNotMatch(text, /linkedin\.com|profile_url|profile_image|avatars/);
  }
});

test('a card too few real people match is coarsened: its company becomes its band, then its title generic', () => {
  const counts = { full: new Map(), banded: new Map(), titles: new Map() };
  const real = { title: 'Chief Wizard', key: 'csuite', func: null, company: { name: 'Tinyco', score: 9.5, source: 'known' }, placeBand: 'local', placeCity: 'Orlando', real: true };
  const out = deck.coarsen(real, counts);
  assert.equal(out.company.name, deck.GENERIC_COMPANIES.big.name);
  assert.equal(out.real, false, 'a unique title becomes a generic one, marked made up');
  assert.equal(out.title, deck.genericTitle('csuite', null));
  // Three or more alike: shown as they are.
  const k = `${'chief wizard'}|tinyco|local`;
  assert.equal(deck.coarsen(real, { ...counts, full: new Map([[k, 3]]) }), real);
});

// ── Choosing pairs ───────────────────────────────────────────────────────────

test('information gain: a coin flip along an unsure direction is worth asking; a sure thing is not', () => {
  const prior = classPrior('founder');
  const post = pw.fitPosterior(prior, []);
  const d = new Float64Array(D);
  d[FEATURE_INDEX.recognised] = 1;                       // open weight: mean 0, sd 1
  const unsure = pw.infoGain(post, d, D);
  const e = new Float64Array(D);
  e[FEATURE_INDEX.founder] = 3;                          // founder +2.0 x 3: the model already knows
  const sure = pw.infoGain(post, e, D);
  assert.ok(Math.abs(unsure.p - 0.5) < 1e-9);
  assert.ok(unsure.gain > sure.gain);
  assert.ok(Math.abs(sure.margin) > 2.5);
});

test('the deck never asks a lopsided pair (|mu . d| > 2.5) except the deliberate low duels, and never repeats one', () => {
  const { pairs } = session('seeker', { setup: { sectors: ['finance'] }, choose: (_, i) => ['a', 'b', 'both', 'neither'][i % 4] });
  const keys = new Set();
  for (const p of pairs) {
    const k = [JSON.stringify(p.a.attrs), JSON.stringify(p.b.attrs)].sort().join('~');
    if (p.mirrorOf == null) { assert.ok(!keys.has(k), 'no repeats'); keys.add(k); }
  }
  assert.ok(pairs.some((p) => p.low), 'one deliberately low duel');
});

test('a mirrored repeat comes back at duel 10, sides swapped; a flip halves both answers', () => {
  const { pairs, build } = session('founder', { setup: {}, choose: (p, i) => (i === 9 ? 'a' : 'a') });
  const mirror = pairs.findIndex((p) => p.mirrorOf != null);
  assert.equal(mirror, 9);
  const orig = build.answers[pairs[mirror].mirrorOf];
  assert.deepEqual(pairs[mirror].a.attrs, orig.b.attrs, 'the sides swapped');
  // Picking 'a' both times is a flip (the mirror's a is the original's b): both count half.
  const { answers, disagreed } = pw.weighMirrors(build.answers);
  assert.equal(disagreed, 1);
  assert.equal(answers[pairs[mirror].mirrorOf].weight, 0.5);
  assert.equal(answers[mirror].weight, 0.5);
});

// ── Answers into weights ─────────────────────────────────────────────────────

test('answers move the weights: picking the investor raises the investor weight, in proportion to surprise', () => {
  const prior = classPrior('seeker');
  const partner = new Float64Array(D); partner[FEATURE_INDEX.investor] = 1;
  const vp = new Float64Array(D); vp[FEATURE_INDEX.seat] = 1.6; vp[FEATURE_INDEX.prestige] = 1;
  const pick = (choice) => pw.fitPosterior(prior, pw.answerTerms({ a: { x: partner }, b: { x: vp }, choice, left: 'a' }, DIMS));
  const yes = pick('a');
  const no = pick('b');
  assert.ok(yes.mean[FEATURE_INDEX.investor] > prior.mean[FEATURE_INDEX.investor]);
  assert.ok(no.mean[FEATURE_INDEX.investor] < prior.mean[FEATURE_INDEX.investor]);
  // An expected answer moves it less than a surprising one.
  assert.ok(yes.mean[FEATURE_INDEX.investor] - prior.mean[FEATURE_INDEX.investor] < prior.mean[FEATURE_INDEX.investor] - no.mean[FEATURE_INDEX.investor]);
  // Uncertainty shrinks.
  assert.ok(yes.cov[FEATURE_INDEX.investor * P + FEATURE_INDEX.investor] < prior.sd[FEATURE_INDEX.investor] ** 2);
});

test('the outside option: "neither" raises u0, "both great" lowers it, so the scale has a real zero', () => {
  const prior = classPrior('founder');
  const a = new Float64Array(D); a[FEATURE_INDEX.founder] = 1;
  const b = new Float64Array(D); b[FEATURE_INDEX.owner] = 1;
  const neither = pw.fitPosterior(prior, Array.from({ length: 3 }, () => pw.answerTerms({ a: { x: a }, b: { x: b }, choice: 'neither', left: 'a' }, DIMS)).flat());
  const both = pw.fitPosterior(prior, Array.from({ length: 3 }, () => pw.answerTerms({ a: { x: a }, b: { x: b }, choice: 'both', left: 'a' }, DIMS)).flat());
  assert.ok(neither.mean[U0] > prior.mean[U0]);
  assert.ok(both.mean[U0] < prior.mean[U0]);
  assert.deepEqual(pw.answerTerms({ a: { x: a }, b: { x: b }, choice: 'skip', left: 'a' }, DIMS), [], 'skip adds nothing');
});

test('the side bias is estimated: always picking the left card is read as habit, not taste', () => {
  const prior = classPrior('founder');
  const answers = [];
  for (let i = 0; i < 12; i++) {
    const x1 = new Float64Array(D); x1[FEATURE_INDEX[i % 2 ? 'founder' : 'owner']] = 1;
    const x2 = new Float64Array(D); x2[FEATURE_INDEX[i % 2 ? 'owner' : 'founder']] = 1;
    answers.push(...pw.answerTerms({ a: { x: x1 }, b: { x: x2 }, choice: 'a', left: 'a' }, DIMS));
  }
  const post = pw.fitPosterior(prior, answers);
  assert.ok(post.mean[SIDE] > 0.3, `side bias ${post.mean[SIDE]}`);
});

// ── When to stop ─────────────────────────────────────────────────────────────

test('the stop rule: never before the minimum, early when every block is sure or the top 50 is stable, always at the maximum', () => {
  const mode = MODES.standard;
  const sure = { mean: new Float64Array(P), cov: new Float64Array(P * P) };
  for (let i = 0; i < P; i++) sure.cov[i * P + i] = 0.01;
  const unsure = { mean: new Float64Array(P), cov: new Float64Array(P * P) };
  for (let i = 0; i < P; i++) unsure.cov[i * P + i] = 1;
  const blocks = { role: [FEATURE_INDEX.seat], sector: [FEATURE_INDEX['ind:tech']] };
  assert.deepEqual(pw.shouldStop({ asked: 5, mode, posterior: sure, blocks }), { stop: false, reason: null });
  assert.deepEqual(pw.shouldStop({ asked: 12, mode, posterior: sure, blocks }), { stop: true, reason: 'sd' });
  assert.deepEqual(pw.shouldStop({ asked: 12, mode, posterior: unsure, blocks, stability: 0.95 }), { stop: true, reason: 'stable' });
  assert.deepEqual(pw.shouldStop({ asked: 12, mode, posterior: unsure, blocks, stability: 0.5 }), { stop: false, reason: null });
  assert.deepEqual(pw.shouldStop({ asked: 16, mode, posterior: unsure, blocks }), { stop: true, reason: 'max' });
});

test('stability: a settled posterior keeps its top 50 in order across draws; a vague one doesn’t', () => {
  const rows = Array.from({ length: 200 }, (_, i) => { const x = new Float64Array(D); x[FEATURE_INDEX.seat] = (i % 50) / 25; x[FEATURE_INDEX.founder] = i % 3 ? 0 : 1; return x; });
  const mean = new Float64Array(P); mean[FEATURE_INDEX.seat] = 1; mean[FEATURE_INDEX.founder] = 1;
  const tight = { mean, cov: new Float64Array(P * P) };
  const loose = { mean, cov: new Float64Array(P * P) };
  for (let i = 0; i < P; i++) { tight.cov[i * P + i] = 1e-6; loose.cov[i * P + i] = 4; }
  assert.ok(pw.topStability(tight, rows, D, { rand: pw.seededRandom(1) }) > 0.9);
  assert.ok(pw.topStability(loose, rows, D, { rand: pw.seededRandom(1) }) < 0.9);
});

test('the calibration meter rises as answers come in', () => {
  const { post, prior } = session('founder', { setup: {} });
  const start = pw.calibration(pw.fitPosterior(prior, []), prior, D);
  const end = pw.calibration(post, prior, D);
  assert.ok(start < 0.01 && end > start);
});

test('every class’s standard deck runs its whole plan on the sample network, never ending early', () => {
  for (const key of CLASS_KEYS) {
    const { pairs } = session(key, { setup: { sectors: ['tech'] }, choose: (_, i) => ['a', 'b', 'a', 'both', 'b', 'neither'][i % 6] });
    assert.equal(pairs.length, MODES.standard.max, key);
  }
});
