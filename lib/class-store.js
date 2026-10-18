// What /api/class does (app/api/class/route.js): pick a class, name its
// target, run This or That, Never show me, the reveal, switch and retake.
// Every change is saved in the build of the class it's about
// (lib/class-goals.js), the weights refitted from the preset and every answer
// (lib/pairwise.js), and the class columns rescored (lib/rpc.js rescoreClass).
// Each step also lands in the learning log (lib/learning-log.js).
//
// The deck and the live feedback run on the network's facts kept in this
// server's memory (lib/rpc.js classFactsNow): one read of every headline per
// network, then a matrix product per answer.

import { createHash } from 'node:crypto';
import { getDb } from './db-client.js';
import { classFactsNow, rescoreClass } from './rpc.js';
import { readGoals, writeGoals, newBuild, cleanSetup, cleanAvoid, activeBuild, buildStatus, saveAbout } from './class-goals.js';
import { envFor, breachOf } from './class-rescore.js';
import {
  classPrior, D, P, U0, SIDE, FEATURES, MODES, STOP_SD, STOP_TAU, CLASSES, CLASS_KEYS, classByKey, FEATURE_SET_VERSION,
  ROLE_CHIPS, TARGET_QUESTIONS, AVOID_CHIPS, WARMTH_BANDS,
} from './class-presets.js';
import { scoreClass, buildBars, topWeights, classCounts, inPool, homeGuess, homePlace } from './class-fit.js';
import { fitPosterior, answerTerms, weighMirrors, calibration, topStability, shouldStop, seededRandom } from './pairwise.js';
import { deckContext, nextPair, roundPlan, cardFeatures, variedBlocks } from './duel-deck.js';
import { tryRecord, personKey } from './learning-log.js';
import { sendLogCounts } from './send-log.js';
import { readSettings, writeSettings } from './settings.js';
import { SECTOR_FOCUS_SETTING, FIELD_ASKED_SETTING, MAX_SECTORS } from './sector-focus.js';
import { INDUSTRIES } from './companies.js';
import { afterSettingsChange } from './settings-effects.js';

const DIMS = { D, P, U0, SIDE };
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const ok = (data) => ({ status: 200, body: data });
const bad = (error, status = 400) => ({ status, body: { error } });

/** A class error the page shows as is. */
export class ClassError extends Error {}

function focusOf(db) {
  try { return readSettings(db, { sectorFocus: SECTOR_FOCUS_SETTING }).sectorFocus; } catch { return null; }
}

/** An answer's two feature rows, from what it stored, or worked out again from its cards if the features changed since. */
function withX(answer, env) {
  if (answer.kind === 'pair') return answer;
  if (answer.fsv === FEATURE_SET_VERSION && Array.isArray(answer.a?.x) && Array.isArray(answer.b?.x)) return answer;
  return {
    ...answer,
    a: { ...answer.a, x: [...cardFeatures(answer.a.attrs, answer.a.show, env)] },
    b: { ...answer.b, x: [...cardFeatures(answer.b.attrs, answer.b.show, env)] },
  };
}

/** The posterior for a build: the class preset (with your sector and Less chips) and every answer. */
export function posteriorOf(build, { focus = null, env }) {
  const prior = classPrior(build.class, { focus, avoid: build.avoid });
  const { answers, disagreed } = weighMirrors((build.answers || []).map((a) => withX(a, env)));
  const terms = answers.flatMap((a) => answerTerms(a, DIMS));
  return { prior, post: fitPosterior(prior, terms), disagreed };
}

/** Keep the posterior's means as the build's weights: what it scores with, saved per class. */
function keepWeights(build, { post, disagreed }) {
  build.weights = Object.fromEntries(FEATURES.map((f) => [f.key, Math.round(post.mean[f.i] * 1e4) / 1e4]));
  build.sds = Object.fromEntries(FEATURES.map((f) => [f.key, Math.round(Math.sqrt(post.cov[f.i * P + f.i]) * 1e4) / 1e4]));
  build.u0 = Math.round(post.mean[U0] * 1e4) / 1e4;
  build.side = Math.round(post.mean[SIDE] * 1e4) / 1e4;
  build.disagreed = disagreed;
  build.updatedAt = new Date().toISOString();
  return build;
}

/** The facts, the env and the scores for a build, kept while nothing they rest on changes. */
const SCORED = Symbol.for('six-degrees.class-scored');
function scored(db, build) {
  const { facts, fingerprint } = classFactsNow(db);
  const key = `${fingerprint}|${hash([build.class, build.weights, build.u0, build.avoid, build.nevers, build.setup, build.dials, (build.answers || []).filter((a) => a.choice === 'neither' || a.choice === 'both').length])}|${hash(breachOf(db))}`;
  const kept = globalThis[SCORED];
  if (kept?.key === key) return kept;
  const env = envFor(db, facts, build);
  const s = scoreClass(facts, build, env);
  globalThis[SCORED] = { key, facts, env, s, fingerprint };
  return globalThis[SCORED];
}

/** Who is class S now (their profile keys). */
const classS = (facts, s) => new Set(facts.filter((f) => s.results.get(f.id)?.tier === 'S' && inPool(f)).map((f) => f.url || f.id));

/** How the build reads: the five bars, its strongest weights in words, the class tiers, the calibration. */
function summary(db, build) {
  if (!build) return null;
  const { facts, env, s } = scored(db, build);
  const w = new Float64Array(D);
  for (const f of FEATURES) w[f.i] = Number(build.weights?.[f.key] ?? 0);
  const { prior, post } = posteriorOf(build, { focus: focusOf(db), env });
  const meta = classByKey(build.class);
  const poolNet = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const seen = new Set();
  for (const f of facts) {
    if (!inPool(f)) continue;
    const k = f.url || f.id;
    if (seen.has(k)) continue;
    seen.add(k);
    if (poolNet[f.tier] != null) poolNet[f.tier] += 1;
  }
  return {
    class: build.class,
    name: meta?.name,
    color: meta?.color,
    setup: build.setup,
    setupDone: build.setupDone,
    ...buildStatus(build),
    avoid: build.avoid,
    nevers: build.nevers.length,
    dials: build.dials,
    bars: buildBars(s.xs, w, { offsets: s.offsets }),
    top: topWeights(s.xs, w, { count: 6 }),
    calibration: Math.round(calibration(post, prior, D) * 100) / 100,
    counts: s.counts,
    network: poolNet,
    floors: s.floors,
    disagreed: build.disagreed || 0,
    session: build.session,
    home: env.home ? titleCaseCity(env.home.city) : null,
  };
}

const titleCaseCity = (c) => String(c || '').replace(/\b[a-z]/g, (x) => x.toUpperCase());

/** A person for the class tab and the reveal (names are fine here, never on a card). */
function personOut(f, r) {
  return {
    id: f.id, name: f.name, headline: f.headline, photo: f.photo, profile_url: f.url, degree: f.degree, tier: f.tier,
    source_connection_id: f.bridge, classTier: r?.tier ?? null, u: r ? Math.round(r.u * 100) / 100 : null,
    v: r ? Math.round(r.v * 100) / 100 : null, why: r?.why || '', requested: f.requested,
  };
}

/** The ranked lists and the quadrant (class worth against network worth) for the class tab. */
function peopleOf(db, build, { limit = 60 } = {}) {
  const { facts, s } = scored(db, build);
  const seen = new Set();
  const pool = [];
  for (const f of facts) {
    if (!inPool(f)) continue;
    const k = f.url || f.id;
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(f);
  }
  const r = (f) => s.results.get(f.id);
  const ranked = pool.filter((f) => !r(f)?.never).sort((a, b) => r(b).u - r(a).u || (b.power - a.power) || String(a.name).localeCompare(String(b.name)));
  const reach = ranked.filter((f) => f.degree === 2).slice(0, limit).map((f) => personOut(f, r(f)));
  const yours = ranked.filter((f) => f.degree === 1).slice(0, limit).map((f) => personOut(f, r(f)));
  // The quadrant: each person's network worth (their power's percentile) against class worth (u's percentile).
  // Percentiles by mid-rank, so people tied on a value share a place, and a
  // small fixed jitter (from their id) so a crowd at one value shows as a crowd.
  const pctOf = (value) => {
    const sorted = pool.map(value).sort((a, b) => a - b);
    const out = new Map();
    const n = Math.max(1, sorted.length - 1);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j += 1;
      out.set(sorted[i], ((i + j) / 2) / n);
      i = j + 1;
    }
    return (f) => out.get(value(f)) ?? 0;
  };
  const jitter = (f, salt) => ((parseInt(hash([f.id, salt]).slice(0, 6), 16) / 0xffffff) - 0.5) * 0.03;
  const powerPct = pctOf((f) => f.power);
  const uPct = pctOf((f) => r(f)?.u ?? 0);
  const pctPower = new Map(pool.map((f) => [f, Math.max(0, Math.min(1, powerPct(f) + jitter(f, 'x')))]));
  const pctU = new Map(pool.map((f) => [f, Math.max(0, Math.min(1, uPct(f) + jitter(f, 'y')))]));
  const step = Math.max(1, Math.floor(pool.length / 1200));
  const points = [];
  const zones = { act: 0, destinations: 0, bridges: 0, background: 0 };
  pool.forEach((f, i) => {
    const x = pctPower.get(f);
    const y = pctU.get(f);
    const zone = y >= 0.5 && x >= 0.5 ? 'act' : y >= 0.5 ? 'destinations' : x >= 0.5 ? 'bridges' : 'background';
    zones[zone] += 1;
    if (i % step === 0) points.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, r(f)?.tier || 'D', f.tier || 'D']);
  });
  return { reach, yours, quadrant: { points, zones, total: pool.length }, nevers: build.nevers.length };
}

/** The live counts on each class card's back, from your own network. */
function backs(db) {
  const { facts } = classFactsNow(db);
  const breach = breachOf(db);
  const guess = breach.city || homeGuess(facts);
  let ties = 0;
  try { ties = db.prepare('SELECT count(*) AS n FROM connection_ties').get().n; } catch { /* none */ }
  const home = guess ? homePlace(guess, facts.filter((f) => f.degree === 1 && f.location).map((f) => f.location)) : null;
  return { counts: classCounts(facts, { home, breachTargets: breach.targets || [], ties }), guess };
}

/** Your 1st degree's most common industries: S2's prefilled sectors. */
function topIndustries(facts, n = 1) {
  const c = new Map();
  for (const f of facts) if (f.degree === 1 && f.industry) c.set(f.industry, (c.get(f.industry) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** The one-time offer to someone with a network and no class (Blake: offered once, and they can skip it). */
function offerOpen(db, goals) {
  if (goals.class || goals.offer) return false;
  try { return db.prepare('SELECT 1 FROM linkedin_connections WHERE degree = 1 LIMIT 1').get() != null; } catch { return false; }
}

/** The learning meters: what each prediction rests on, honestly. */
function meters(db, build) {
  const log = sendLogCounts(db);
  const duels = (build?.answers || []).filter((a) => a.choice !== 'skip' && a.kind !== 'pair').length;
  const warmth = log.timed > 0 ? WARMTH_BANDS.map((b) => ({ key: b.key, label: b.label, within: b.within, n: log.warmth[b.key] || 0 })) : null;
  return { duels, sends: log.sent, accepted: log.accepted, timed: log.timed, pending: log.pending, warmth };
}

/** GET /api/class: the class, the classes with their live backs, the build in words, and (with `people`) the lists. */
export function classState(db = getDb(), { people = false } = {}) {
  const goals = readGoals(db);
  const build = activeBuild(goals);
  const { counts, guess } = backs(db);
  return {
    class: goals.class,
    offer: goals.offer,
    offerOpen: offerOpen(db, goals),
    classes: CLASSES.map((c) => ({ ...c, back: counts[c.key], status: buildStatus(goals.builds[c.key]) })),
    build: summary(db, build),
    questions: { roles: ROLE_CHIPS, target: TARGET_QUESTIONS, avoid: AVOID_CHIPS, industries: INDUSTRIES.map((g) => ({ key: g.key, label: g.label })) },
    guess: { city: guess || '' },
    meters: meters(db, build),
    ...(people && build ? { people: peopleOf(db, build) } : {}),
  };
}

// ── Changes ──────────────────────────────────────────────────────────────────

function save(db, goals) {
  return writeGoals(db, goals);
}

function buildFor(db, goals, key) {
  if (!CLASS_KEYS.includes(key)) throw new ClassError('That isn’t one of the six classes.');
  if (!goals.builds[key]) {
    const { facts } = classFactsNow(db);
    const breach = breachOf(db);
    const guess = breach.city || homeGuess(facts);
    goals.builds[key] = newBuild(key, {
      sectors: key === 'cartographer' ? [] : topIndustries(facts, 1),
      city: ['poacher', 'grower', 'infiltrator'].includes(key) ? guess : '',
      targets: key === 'infiltrator' ? breach.targets || [] : [],
    });
    const env = envFor(db, facts, goals.builds[key]);
    keepWeights(goals.builds[key], posteriorOf(goals.builds[key], { focus: focusOf(db), env }));
  }
  return goals.builds[key];
}

function refit(db, build) {
  const { facts } = classFactsNow(db);
  const env = envFor(db, facts, build);
  return keepWeights(build, posteriorOf(build, { focus: focusOf(db), env }));
}

const log = (db, type, data, extra = {}) => tryRecord(db, { kind: 'onboarding', type, data, ...extra });

/** Pick a class (or switch to one): its saved build comes back exactly as it was. */
export function pickClass(db, key) {
  const goals = readGoals(db);
  const before = goals.class;
  const build = buildFor(db, goals, key);
  goals.class = key;
  goals.offer = goals.offer || { answer: 'picked', at: new Date().toISOString() };
  save(db, goals);
  rescoreClass(db);
  log(db, before && before !== key ? 'class-switch' : 'class-pick', { from: before, to: key, restored: Boolean(build.answers?.length) }, { lens: key });
  return { needsQuestions: !build.done && !build.skipped, needsTarget: !build.setupDone && key !== 'cartographer', restored: (build.answers || []).length > 0 };
}

/** S2: the target, and the optional "about you". The Infiltrator's companies are your Breach targets too. */
export function saveSetup(db, key, setup) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  build.setup = cleanSetup(key, setup);
  build.setupDone = true;
  if (key === 'infiltrator' && build.setup.targets.length) {
    const breach = breachOf(db);
    const merged = [...new Set([...(breach.targets || []), ...build.setup.targets])].slice(0, 25);
    try { writeSettings(db, { breach: { ...breach, targets: merged } }); } catch { /* kept in the build either way */ }
  }
  saveAbout(db, build.setup.about);
  refit(db, build);
  save(db, goals);
  if (goals.class === key) rescoreClass(db);
  log(db, 'target', { class: key, sectors: build.setup.sectors, roles: build.setup.roles, targets: build.setup.targets.length, city: Boolean(build.setup.city) }, { lens: key });
  return {};
}

export function skipOffer(db) {
  const goals = readGoals(db);
  goals.offer = { answer: 'skipped', at: new Date().toISOString() };
  save(db, goals);
  log(db, 'offer-skipped', {});
  return {};
}

const DECK = Symbol.for('six-degrees.class-deck');
function deckFor(db, build) {
  const { facts, fingerprint } = classFactsNow(db);
  const key = `${fingerprint}|${build.class}|${hash(build.setup)}|${hash(breachOf(db))}`;
  const kept = globalThis[DECK];
  if (kept?.key === key) return kept;
  const env = envFor(db, facts, build);
  const prior = classPrior(build.class, { focus: focusOf(db), avoid: build.avoid });
  const ctx = deckContext(facts, build, env, { weights: prior.mean });
  globalThis[DECK] = { key, ctx, env, facts };
  return globalThis[DECK];
}

const sessionOf = (build) => build.session || { mode: 'standard', start: (build.answers || []).length };
const sessionAnswers = (build) => (build.answers || []).slice(sessionOf(build).start);

/** Progress for the page: duel n of N, the round, the calibration meter, and whether to stop. */
function progress(db, build, { env }) {
  const session = sessionOf(build);
  const mode = MODES[session.mode] || MODES.standard;
  const plan = roundPlan(build.class, session.mode);
  const asked = sessionAnswers(build).filter((a) => a.choice !== 'skip').length;
  const { prior, post } = posteriorOf(build, { focus: focusOf(db), env });
  let stability = null;
  if (asked >= mode.min && asked < mode.max) {
    const s = scored(db, build).s;
    const rows = s.poolIdx.slice(0, 8000).map((k) => s.xs[k]);
    const offsets = new Float64Array(s.poolIdx.slice(0, 8000).map((k) => s.offsets[k]));
    stability = topStability(post, rows, D, { offsets, rand: seededRandom(11) });
  }
  const stop = shouldStop({ asked, mode, posterior: post, blocks: variedBlocks(build.answers || []), stability, stopSd: STOP_SD, stopTau: STOP_TAU });
  return { asked, min: mode.min, max: mode.max, mode: session.mode, plan: plan.map((r) => ({ key: r.key, label: r.label, n: r.n })), calibration: Math.round(calibration(post, prior, D) * 100) / 100, stop, stability, post };
}

/** The next duel for a class (starting a session in `mode` if none is running). */
export function nextDuel(db, key, { mode = null, seed = null, fresh = false } = {}) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  // Opening the duels in another mode (Tune or Retune after an unfinished
  // session) starts that mode's session; within a session, its own mode.
  if (fresh && build.session && mode && MODES[mode] && build.session.mode !== mode) build.session = null;
  mode = mode || build.session?.mode || 'standard';
  if (!build.session) {
    build.session = { mode: MODES[mode] ? mode : 'standard', start: (build.answers || []).length };
    if (mode === 'tune' || mode === 'retune') log(db, 'retune', { class: key, mode }, { lens: key });
    save(db, goals);
  }
  const { ctx, env } = deckFor(db, build);
  const prog = progress(db, build, { env });
  if (prog.stop.stop) return { done: true, reason: prog.stop.reason, progress: strip(prog) };
  const rand = seededRandom(seed ?? (hashNumber(`${key}|${(build.answers || []).length}|${Date.now()}`)));
  const plan = roundPlan(key, sessionOf(build).mode);
  const pair = nextPair({ ctx, env, posterior: prog.post, plan, sessionAnswers: sessionAnswers(build), allAnswers: build.answers || [], rand });
  if (!pair) return { done: true, reason: 'no-pair', progress: strip(prog) };
  return { done: false, pair: pairOut(pair), progress: strip(prog) };
}

const hashNumber = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const strip = ({ post: _post, ...rest }) => rest;

/** A pair as it goes to the page: the cards' words, and their attributes to send back with the answer. Never a person. */
function pairOut(p) {
  const side = (c) => ({ attrs: c.attrs, show: c.show, view: c.view });
  return {
    a: side(p.a), b: side(p.b), left: p.left, same: p.same, focus: p.focus, round: p.round, roundNo: p.roundNo, rounds: p.rounds,
    index: p.index, total: p.total, prompt: p.prompt, ...(p.mirrorOf != null ? { mirrorOf: p.mirrorOf } : {}), ...(p.low ? { low: true } : {}),
  };
}

const CHOICES = ['a', 'b', 'both', 'neither', 'skip'];

/** A card sent back with an answer, cleaned: only the attributes a card has. */
function cleanCard(c) {
  const a = c?.attrs || {};
  const co = a.company && typeof a.company === 'object' ? {
    name: String(a.company.name || '').slice(0, 80), score: Math.max(1, Math.min(10, Number(a.company.score) || 5)),
    source: ['yours', 'known', 'data', 'network', 'default', 'none', 'hidden'].includes(a.company.source) ? a.company.source : 'default',
    ...(a.company.label ? { label: String(a.company.label).slice(0, 60) } : {}), ...(a.company.band ? { band: String(a.company.band).slice(0, 12) } : {}),
  } : null;
  const attrs = {
    title: String(a.title || '').slice(0, 80), key: String(a.key || 'ic').slice(0, 24), func: a.func ? String(a.func).slice(0, 24) : null,
    company: co, industry: a.industry ? String(a.industry).slice(0, 24) : null, sectors: Array.isArray(a.sectors) ? a.sectors.slice(0, 6).map((x) => String(x).slice(0, 40)) : [],
    placeBand: ['local', 'region', 'country', 'abroad'].includes(a.placeBand) ? a.placeBand : null, placeCity: a.placeCity ? String(a.placeCity).slice(0, 60) : null,
    followers: Number.isFinite(a.followers) ? a.followers : null, recognition: a.recognition === true,
    target: ['current', 'alumni'].includes(a.target) ? a.target : null, real: a.real === true,
  };
  const show = { company: c?.show?.company === true, industry: c?.show?.industry === true, place: c?.show?.place === true, reach: c?.show?.reach === true };
  return { attrs, show };
}

/** An answer to the current duel: saved, the weights refitted, and the next duel with what moved. */
export function answerDuel(db, key, { pair, choice, ms = null, seed = null } = {}) {
  if (!CHOICES.includes(choice)) throw new ClassError('Pick a card, both, neither or skip.');
  if (!pair?.a || !pair?.b) throw new ClassError('That duel is missing its cards.');
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  if (!build.session) build.session = { mode: 'standard', start: (build.answers || []).length };
  const { env } = deckFor(db, build);
  const before = classS(...sOf(db, build));
  const a = cleanCard(pair.a);
  const b = cleanCard(pair.b);
  const answer = {
    a: { ...a, x: [...cardFeatures(a.attrs, a.show, env)] },
    b: { ...b, x: [...cardFeatures(b.attrs, b.show, env)] },
    choice, left: pair.left === 'b' ? 'b' : 'a', ms: Number.isFinite(ms) ? Math.max(0, Math.min(600000, Math.round(ms))) : null,
    round: pair.round?.key || null, focus: pair.focus || null, at: new Date().toISOString(), fsv: FEATURE_SET_VERSION,
    ...(Number.isInteger(pair.mirrorOf) ? { mirrorOf: pair.mirrorOf } : {}), ...(pair.low ? { low: true } : {}),
  };
  build.answers = [...(build.answers || []), answer];
  refit(db, build);
  save(db, goals);
  // The duel in the learning log: both cards (attributes, never people), the choice, the decision time.
  log(db, 'duel', { class: key, a: a.attrs, b: b.attrs, choice, left: answer.left, ms: answer.ms, round: answer.round, focus: answer.focus, mirrorOf: answer.mirrorOf ?? null }, { lens: key, dedupe: `duel:${key}:${answer.at}:${build.answers.length}` });
  const after = classS(...sOf(db, build));
  let moved = 0;
  for (const k of after) if (!before.has(k)) moved += 1;
  const next = nextDuel(db, key, { seed });
  return { ...next, feedback: { classS: after.size, moved, bars: summary(db, build).bars } };
}

function sOf(db, build) {
  const { facts, s } = scored(db, build);
  return [facts, s];
}

/** Take back the last answer of this session. */
export function undoDuel(db, key) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  const start = sessionOf(build).start;
  if ((build.answers || []).length <= start) return nextDuel(db, key);
  build.answers = build.answers.slice(0, -1);
  refit(db, build);
  save(db, goals);
  log(db, 'duel-undo', { class: key }, { lens: key });
  return nextDuel(db, key);
}

/**
 * This or That done (or "Done for now"): the session ends, the build is done,
 * and, where the old field question would have asked (no field picked yet),
 * the answers write Settings → Your field, as the field question did.
 */
export function finishDuels(db, key) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  build.session = null;
  build.done = true;
  refit(db, build);
  save(db, goals);
  let field = null;
  try {
    const settings = readSettings(db, { sectorFocus: SECTOR_FOCUS_SETTING, fieldAsked: FIELD_ASKED_SETTING });
    if (!settings.fieldAsked && !settings.sectorFocus?.sectors?.length) {
      const liked = FEATURES.filter((f) => f.key.startsWith('ind:') && (build.weights?.[f.key] ?? 0) >= 0.4)
        .sort((x, y) => build.weights[y.key] - build.weights[x.key]).map((f) => f.key.slice(4));
      const sectors = (liked.length ? liked : build.setup.sectors.filter((s) => INDUSTRIES.some((g) => g.key === s))).slice(0, MAX_SECTORS);
      const before = readSettings(db);
      const after = writeSettings(db, sectors.length ? { sectorFocus: { sectors, strength: 'lean' }, fieldAsked: true } : { fieldAsked: true });
      try { afterSettingsChange(db, before, after); } catch { /* rescored on the next load */ }
      field = sectors;
    }
  } catch { /* the field is optional */ }
  if (goals.class === key) rescoreClass(db);
  log(db, 'duels-done', { class: key, answers: (build.answers || []).length, field }, { lens: key });
  return { field };
}

/** Skip This or That: the class preset scores until it's taken. */
export function skipQuestions(db, key) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  build.session = null;
  build.skipped = true;
  build.done = true;
  save(db, goals);
  log(db, 'questions-skipped', { class: key }, { lens: key });
  return {};
}

/** Never show me: Less (a soft push down) or Never (class D, off every class list). */
export function saveAvoid(db, key, avoid) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  build.avoid = cleanAvoid(avoid);
  build.avoidDone = true;
  refit(db, build);
  save(db, goals);
  if (goals.class === key) rescoreClass(db);
  log(db, 'never-pick', { class: key, avoid: build.avoid }, { lens: key });
  return {};
}

/** Retake: this class's answers cleared (its target kept), back to the preset. Other classes untouched. */
export function retake(db, key) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  build.answers = [];
  build.done = false;
  build.skipped = false;
  build.session = null;
  build.nevers = [];
  refit(db, build);
  save(db, goals);
  if (goals.class === key) rescoreClass(db);
  log(db, 'retake', { class: key }, { lens: key });
  return {};
}

/** The reveal (S5): the bars, the strongest weights, your new top 5 and 2 near the S line, and the reshuffle. */
export function reveal(db, key) {
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  const { facts, s } = scored(db, build);
  const r = (f) => s.results.get(f.id);
  const seen = new Set();
  const pool = facts.filter((f) => {
    if (!inPool(f) || r(f)?.never) return false;
    const k = f.url || f.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => r(b).u - r(a).u);
  const top = pool.slice(0, 5).map((f) => personOut(f, r(f)));
  const sIdx = pool.findIndex((f) => r(f).tier !== 'S');
  const near = sIdx > 0 ? pool.slice(Math.max(5, sIdx - 1), Math.max(5, sIdx - 1) + 2).map((f) => personOut(f, r(f))) : [];
  const classSNow = pool.filter((f) => r(f).tier === 'S');
  const newToS = classSNow.filter((f) => f.tier !== 'S').length;
  return { summary: summary(db, build), top, near, reshuffle: { classS: classSNow.length, wasNotS: newToS }, disagreed: build.disagreed || 0 };
}

/**
 * "Yes, more like this" or "Not this one" at the reveal: a full-weight
 * comparison against the next person in the list, refitted and rescored.
 */
export function react(db, key, { personId, verdict }) {
  if (!['more', 'not'].includes(verdict)) throw new ClassError('Say more like this, or not this one.');
  const goals = readGoals(db);
  const build = buildFor(db, goals, key);
  const { facts, s } = scored(db, build);
  const r = (f) => s.results.get(f.id);
  const list = facts.filter((f) => inPool(f) && !r(f)?.never).sort((a, b) => r(b).u - r(a).u);
  const at = list.findIndex((f) => String(f.id) === String(personId));
  if (at < 0) throw new ClassError('That person isn’t in your class list.');
  const other = list[at + 1] || list[at - 1];
  if (!other) return reveal(db, key);
  const xOf = (f) => [...s.xs[facts.indexOf(f)]];
  build.answers = [...(build.answers || []), {
    kind: 'pair', a: { x: xOf(list[at]), who: personKey(list[at].url) }, b: { x: xOf(other), who: personKey(other.url) },
    choice: verdict === 'more' ? 'a' : 'b', at: new Date().toISOString(), fsv: FEATURE_SET_VERSION,
  }];
  refit(db, build);
  save(db, goals);
  if (goals.class === key) rescoreClass(db);
  tryRecord(db, { kind: 'interaction', type: verdict === 'more' ? 'more-like-this' : 'not-this-one', person: personKey(list[at].url), lens: key, data: { against: personKey(other.url), list: 'reveal' } });
  return reveal(db, key);
}

/** One request to /api/class, answered: { status, body }. */
export function classAction(db, body = {}) {
  const key = body.class;
  try {
    switch (body.action) {
      case 'pick': return ok({ ...pickClass(db, key), state: classState(db) });
      case 'setup': saveSetup(db, key, body.setup); return ok({ state: classState(db) });
      case 'skip-offer': skipOffer(db); return ok({ state: classState(db) });
      case 'duel': return ok(nextDuel(db, key, { mode: body.mode, seed: body.seed, fresh: true }));
      case 'answer': return ok(answerDuel(db, key, { pair: body.pair, choice: body.choice, ms: body.ms, seed: body.seed }));
      case 'undo': return ok(undoDuel(db, key));
      case 'finish': return ok({ ...finishDuels(db, key), state: classState(db) });
      case 'skip-questions': skipQuestions(db, key); return ok({ state: classState(db) });
      case 'avoid': saveAvoid(db, key, body.avoid); return ok({ state: classState(db) });
      case 'reveal': return ok(reveal(db, key));
      case 'react': return ok(react(db, key, { personId: body.personId, verdict: body.verdict }));
      case 'retake': retake(db, key); return ok({ state: classState(db) });
      default: return bad('Unknown action.');
    }
  } catch (err) {
    if (err instanceof ClassError) return bad(err.message);
    return bad(err.message || 'Something went wrong.', 500);
  }
}

