// Settings → Your sector: the setting around the model's sector lean
// (lib/sector-focus.js), and the database paths that apply it (lib/rpc.js,
// lib/settings-effects.js). The lean itself is pinned in scoring.test.mjs,
// the one-industry-per-company rule in companies.test.mjs.
// Invented people; public companies.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scoreNetwork } from '../lib/scoring.js';
import { industryKeyOf } from '../lib/companies.js';
import {
  parseSectorFocus, focusFingerprint, sameFocus, previewSectorFocus, tierMoves, NO_FOCUS, MAX_SECTORS,
} from '../lib/sector-focus.js';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-sector-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, readSettings, writeSettings, SETTINGS, SettingsError, rescoreAll, rescoreIfStale, companyOverrides, scoringRows, sectorFocusOf, afterSettingsChange;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings, SETTINGS, SettingsError } = await import('../lib/settings.js'));
  ({ rescoreAll, rescoreIfStale, companyOverrides, scoringRows, sectorFocusOf } = await import('../lib/rpc.js'));
  ({ afterSettingsChange } = await import('../lib/settings-effects.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'company_scores', 'app_meta']) getDb().exec(`DELETE FROM ${t}`);
});

const lean = (...sectors) => ({ sectors, strength: 'lean' });
const strong = (...sectors) => ({ sectors, strength: 'strong' });

// ── the setting ─────────────────────────────────────────────────────────────

test('a sector focus is validated, deduplicated and stored in one order', () => {
  assert.deepEqual(parseSectorFocus({ sectors: ['tech', 'media', 'tech'], strength: 'strong' }), { sectors: ['media', 'tech'], strength: 'strong' });
  assert.deepEqual(parseSectorFocus({ sectors: ['finance'] }), { sectors: ['finance'], strength: 'lean' });
  assert.deepEqual(parseSectorFocus(null), { sectors: [], strength: 'lean' });
  assert.deepEqual(parseSectorFocus({}), { sectors: [], strength: 'lean' });
  assert.equal(MAX_SECTORS, 3);
  const refused = [
    [{ sectors: ['tech', 'media', 'finance', 'health'] }, /up to 3 sectors/],
    [{ sectors: ['unknown'] }, /no sector called 'unknown'/],
    [{ sectors: ['Tech, Software & AI'] }, /no sector called/],
    [{ sectors: [{ key: 'tech' }] }, /no sector called/],
    [{ sectors: 'tech' }, /must be a list/],
    [{ sectors: ['tech'], strength: 'max' }, /lean or strong/],
    ['tech', /choice of sectors and a strength/],
    [['tech'], /choice of sectors and a strength/],
  ];
  for (const [value, message] of refused) assert.throws(() => parseSectorFocus(value), message, JSON.stringify(value));
});

test('Settings declares it, with nothing chosen by default', () => {
  assert.ok(SETTINGS.sectorFocus);
  assert.deepEqual(readSettings(getDb()).sectorFocus, { sectors: [], strength: 'lean' });
  assert.deepEqual(writeSettings(getDb(), { sectorFocus: { sectors: ['tech', 'media'] } }).sectorFocus, { sectors: ['media', 'tech'], strength: 'lean' });
  assert.throws(() => writeSettings(getDb(), { sectorFocus: { sectors: ['crypto'] } }),
    (err) => err instanceof SettingsError && /no sector called 'crypto'/.test(err.message));
  assert.deepEqual(readSettings(getDb()).sectorFocus, { sectors: ['media', 'tech'], strength: 'lean' });
  assert.ok(Object.isFrozen(NO_FOCUS) && Object.isFrozen(NO_FOCUS.sectors), 'the shared default cannot be changed by a reader');
});

test('the fingerprint is the same for the same choice, whatever order it was sent in', () => {
  assert.equal(focusFingerprint(NO_FOCUS), 'none');
  assert.equal(focusFingerprint(strong()), 'none');                     // no sectors: strength is moot
  assert.equal(focusFingerprint(lean('tech', 'media')), 'lean:media,tech');
  assert.equal(focusFingerprint(lean('media', 'tech')), 'lean:media,tech');
  assert.notEqual(focusFingerprint(lean('tech')), focusFingerprint(strong('tech')));
  assert.equal(focusFingerprint({ sectors: ['nope'] }), 'none');       // unreadable counts as nothing chosen
  assert.ok(sameFocus(lean(), strong()));
  assert.ok(!sameFocus(lean('tech'), lean('media')));
});

// ── the dry run ─────────────────────────────────────────────────────────────

// A small invented network: an unknown startup whose people are engineers
// (Quillon, so tech), a media company from the curated list (Snap, 9), a tech
// one (Adobe, 8), and Google (10, which has nowhere to go).
//   founder at Quillon       4 → 6 at strong tech:  6.7 (A) → 7.8 (S)
//   director at Adobe        8 → 10 at strong tech: 6.7 (A) → 7.5 (S)
//   director at Snap         9 → 10 at lean media:  7.1 (A) → 7.5 (S)
//   engineers at Quillon     2.7 → 3.1, C either way
function network() {
  const p = (id, degree, name, headline, extra = {}) => ({ id, degree, name, headline, profile_url: `/in/${id}`, source_connection_id: null, ...extra });
  return [
    p('f', 1, 'Ada Farrow', 'Founder at Quillon'),
    p('e1', 1, 'Bo Nyberg', 'Engineer at Quillon'),
    p('e2', 2, 'Cleo Varga', 'Backend developer at Quillon', { source_connection_id: 'f' }),
    p('s', 1, 'Dev Moreau', 'Director of Partnerships at Snap'),
    p('a', 1, 'Esme Ibarra', 'Director of Design at Adobe'),
    // The same person again, in Ada's circle: one person, counted at 1st degree.
    p('a2', 2, 'Esme Ibarra', 'Director of Design at Adobe', { source_connection_id: 'f', profile_url: '/in/a' }),
    p('g', 1, 'Finn Dumont', 'VP Engineering at Google'),
  ];
}

test('the preview counts companies and people that would move, against what is saved', () => {
  const rows = network();
  const p = previewSectorFocus(rows, { industryOf: industryKeyOf, from: NO_FOCUS, to: strong('tech') });
  assert.equal(p.scored, 7);
  // Quillon 4 → 6 and Adobe 8 → 10; Google is already 10, Snap is media.
  assert.equal(p.companies, 2);
  assert.deepEqual([p.companiesUp, p.companiesDown], [2, 0]);
  assert.deepEqual(p.companyExamples.map((c) => [c.name, c.from, c.to, c.sector]).sort(), [['Adobe', 8, 10, 'tech'], ['Quillon', 4, 6, 'tech']]);
  assert.deepEqual([p.up, p.down], [2, 0]);
  assert.deepEqual(p.examples.map((e) => [e.name, e.degree, e.company, e.from, e.to]), [
    ['Ada Farrow', 1, 'Quillon', 'A', 'S'],
    ['Esme Ibarra', 1, 'Adobe', 'A', 'S'],
  ]);
  // Back again: the same people move down.
  const back = previewSectorFocus(rows, { industryOf: industryKeyOf, from: strong('tech'), to: NO_FOCUS });
  assert.deepEqual([back.up, back.down, back.companiesUp, back.companiesDown], [0, 2, 0, 2]);
  // Nothing to change: nothing moves.
  const same = previewSectorFocus(rows, { industryOf: industryKeyOf, from: lean('tech'), to: lean('tech') });
  assert.deepEqual([same.companies, same.up, same.down, same.examples.length], [0, 0, 0, 0]);
});

test('the preview agrees with scoring the network for real', () => {
  const rows = network();
  const p = previewSectorFocus(rows, { industryOf: industryKeyOf, from: NO_FOCUS, to: lean('media') });
  const before = scoreNetwork(rows, { industryOf: industryKeyOf }).scores;
  const after = scoreNetwork(rows, { industryOf: industryKeyOf, focus: lean('media') }).scores;
  // Snap 9 → 10 lifts its director from 7.1 (A) to 7.5 (S), and nobody else.
  assert.deepEqual([before.get('s').tier, after.get('s').tier, after.get('s').power], ['A', 'S', 7.5]);
  assert.deepEqual([p.companies, p.up, p.down], [1, 1, 0]);
  assert.deepEqual(p.examples.map((e) => [e.name, e.from, e.to]), [['Dev Moreau', 'A', 'S']]);
});

test('people are counted once, at the closest degree, and both directions show', () => {
  const rows = [
    { id: '1', degree: 2, profile_url: '/in/x', name: 'X far' },
    { id: '2', degree: 1, profile_url: '/in/x', name: 'X near' },
    { id: '3', degree: 1, profile_url: '/in/y', name: 'Y' },
    { id: '4', degree: 1, profile_url: '/in/z', name: 'Z' },
  ];
  const before = { 1: 'D', 2: 'B', 3: 'A', 4: 'C' };
  const after = { 1: 'S', 2: 'A', 3: 'B', 4: 'C' };
  const m = tierMoves(rows, (r) => before[r.id], (r) => after[r.id]);
  assert.deepEqual([m.up, m.down], [1, 1]);                              // X near B → A (not X far), Y A → B
  assert.deepEqual(m.examples.map((e) => [e.name, e.from, e.to]), [['X near', 'B', 'A'], ['Y', 'A', 'B']]);
  assert.deepEqual(tierMoves(rows, (r) => before[r.id], (r) => after[r.id], { examples: 0 }).examples, []);
});

// ── the database paths ──────────────────────────────────────────────────────

function insert(rows) {
  const st = getDb().prepare('INSERT INTO linkedin_connections (id, degree, name, headline, company, profile_url, source_connection_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) st.run(r.id, r.degree, r.name, r.headline, r.company || null, r.profile_url, r.source_connection_id || null);
}
const row = (id) => getDb().prepare('SELECT * FROM linkedin_connections WHERE id = ?').get(id);
const meta = (key) => getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;

test('rescoring applies the saved sector focus, reading it itself', () => {
  insert(network());
  rescoreAll();
  assert.deepEqual([row('s').company_prestige_score, row('s').tier], [9, 'A']);
  writeSettings(getDb(), { sectorFocus: lean('media') });
  // The import path (score_new_connections) is rescoreAll too: nothing passes the focus in.
  rescoreAll();
  assert.deepEqual([row('s').company_prestige_score, row('s').power_score, row('s').tier], [10, 7.5, 'S']);
  assert.match(row('s').score_why, /Snap \(10\/10: 9 \+ 1 your sector\)/);
  assert.equal(meta('scoring_version'), '3');
  assert.equal(meta('scoring_focus'), 'lean:media');
});

test('turning it off gives back exactly the scores from before: nothing ratchets', () => {
  insert(network());
  rescoreAll();
  const plain = scoringRows(getDb(), { withPeople: true }).map((r) => ({ ...row(r.id), updated_at: null }));
  writeSettings(getDb(), { sectorFocus: strong('tech', 'media') });
  rescoreAll();
  assert.notDeepEqual(row('f').power_score, plain.find((r) => r.id === 'f').power_score);
  writeSettings(getDb(), { sectorFocus: NO_FOCUS });
  rescoreAll();
  for (const r of plain) assert.deepEqual({ ...row(r.id), updated_at: null }, r, r.id);
});

test('a company score you set wins over your sector, in the database too', () => {
  insert(network());
  getDb().prepare("INSERT INTO company_scores (id, name, score) VALUES ('x', 'Quillon', 5)").run();
  writeSettings(getDb(), { sectorFocus: strong('tech') });
  rescoreAll();
  assert.equal(row('f').company_prestige_score, 5);
  assert.match(row('f').score_why, /Quillon \(5\/10, your score\)/);
  assert.equal(row('a').company_prestige_score, 10);                     // Adobe 8 + 2
});

test('stored scores from another sector focus are stale, and are redone once', () => {
  insert(network());
  rescoreAll();
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  // A focus saved without a rescore: a database restored or brought from another
  // computer, or a save whose rescore never finished.
  writeSettings(getDb(), { sectorFocus: lean('media') });
  assert.equal(row('s').tier, 'A');
  assert.deepEqual(rescoreIfStale(), { scored: 7 });
  assert.equal(row('s').tier, 'S');
  assert.equal(meta('scoring_focus'), 'lean:media');
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  // Scores from the previous model are stale too, whatever the focus.
  getDb().prepare("UPDATE app_meta SET value = '2' WHERE key = 'scoring_version'").run();
  assert.deepEqual(rescoreIfStale(), { scored: 7 });
  // And so is a database that has never been stamped with a focus.
  getDb().prepare("DELETE FROM app_meta WHERE key = 'scoring_focus'").run();
  assert.deepEqual(rescoreIfStale(), { scored: 7 });
});

test('saving a new focus rescores everyone and says who moved; the preview said the same', () => {
  insert(network());
  rescoreAll();
  const db = getDb();
  const preview = previewSectorFocus(scoringRows(db, { withPeople: true }), {
    overrides: companyOverrides(db), industryOf: industryKeyOf, from: sectorFocusOf(db), to: strong('tech'),
  });
  const beforeSave = readSettings(db);
  const saved = writeSettings(db, { sectorFocus: strong('tech') });
  const effects = afterSettingsChange(db, beforeSave, saved);
  assert.deepEqual(effects, { sectorFocus: { scored: 7, moved: preview.up + preview.down, up: preview.up, down: preview.down } });
  assert.deepEqual([effects.sectorFocus.up, effects.sectorFocus.down], [2, 0]);
  assert.equal(row('f').tier, 'S');
  // The same choice again sets nothing in motion.
  assert.equal(afterSettingsChange(db, saved, writeSettings(db, { sectorFocus: strong('tech') })), null);
});

test('the preview writes nothing', () => {
  insert(network());
  rescoreAll();
  const db = getDb();
  const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM linkedin_connections ORDER BY id').all(), db.prepare('SELECT * FROM app_meta ORDER BY key').all()]);
  const was = snapshot();
  previewSectorFocus(scoringRows(db, { withPeople: true }), { overrides: companyOverrides(db), industryOf: industryKeyOf, from: sectorFocusOf(db), to: strong('tech', 'media', 'finance') });
  assert.equal(snapshot(), was);
});
