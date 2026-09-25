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
import { DIRECTORY_VERSION, suggestSectors } from '../lib/sector-directory.js';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-sector-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, readSettings, writeSettings, SETTINGS, SettingsError, rescoreAll, rescoreIfStale, companyOverrides, scoringRows, sectorFocusOf, readForScoring, afterSettingsChange;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings, SETTINGS, SettingsError } = await import('../lib/settings.js'));
  ({ rescoreAll, rescoreIfStale, companyOverrides, scoringRows, sectorFocusOf, readForScoring } = await import('../lib/rpc.js'));
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
  assert.throws(() => writeSettings(getDb(), { sectorFocus: { sectors: ['astrology'] } }),
    (err) => err instanceof SettingsError && /no sector called 'astrology'/.test(err.message));
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
// (Quillon, so tech), a media company from the curated list (YouTube, 9), a tech
// one (Adobe, 8), and Google (10, which has nowhere to go).
//   founder at Quillon       4 → 6 at strong tech:  6.7 (A) → 7.8 (S)
//   director at Adobe        8 → 10 at strong tech: 6.7 (A) → 7.5 (S)
//   director at YouTube      9 → 10 at lean media:  7.1 (A) → 7.5 (S)
//   engineers at Quillon     2.7 → 3.1, C either way
function network() {
  const p = (id, degree, name, headline, extra = {}) => ({ id, degree, name, headline, profile_url: `/in/${id}`, source_connection_id: null, ...extra });
  return [
    p('f', 1, 'Ada Farrow', 'Founder at Quillon'),
    p('e1', 1, 'Bo Nyberg', 'Engineer at Quillon'),
    p('e2', 2, 'Cleo Varga', 'Backend developer at Quillon', { source_connection_id: 'f' }),
    p('s', 1, 'Dev Moreau', 'Director of Partnerships at YouTube'),
    p('a', 1, 'Esme Ibarra', 'Director of Design at Adobe'),
    // The same person again, in Ada's circle: one person, counted at 1st degree.
    p('a2', 2, 'Esme Ibarra', 'Director of Design at Adobe', { source_connection_id: 'f', profile_url: '/in/a' }),
    p('g', 1, 'Finn Dumont', 'VP Engineering at Google'),
  ];
}

test('the preview counts companies and people that would move, against what is saved', () => {
  const rows = network();
  const p = previewSectorFocus(rows, { industryOf: industryKeyOf, from: NO_FOCUS, to: strong('tech') });
  assert.equal(p.scored, 7);                                             // rows…
  assert.equal(p.people, 6);                                             // …and people: Esme is two rows
  // Quillon 4 → 6 and Adobe 8 → 10; Google is already 10, YouTube is media.
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
  // YouTube 9 → 10 lifts its director from 7.1 (A) to 7.5 (S), and nobody else.
  assert.deepEqual([before.get('s').tier, after.get('s').tier, after.get('s').power], ['A', 'S', 7.5]);
  assert.deepEqual([p.companies, p.up, p.down], [1, 1, 0]);
  assert.deepEqual(p.examples.map((e) => [e.name, e.from, e.to]), [['Dev Moreau', 'A', 'S']]);
});

test('a company only in someone\'s former roles counts among the companies that move', () => {
  // Discord is nobody's employer now, but its score moves with the lean like
  // any other, and it is Ari's strongest role. The preview used to say "No
  // company changes score. 1 person moves up a tier."
  const rows = [{ id: 'x', degree: 1, name: 'Ari Lund', profile_url: '/in/x', headline: 'Consultant | Ex-Manager at Discord' }];
  const p = previewSectorFocus(rows, { industryOf: industryKeyOf, to: lean('tech') });
  assert.deepEqual([p.companies, p.companiesUp, p.companiesDown], [1, 1, 0]);
  assert.deepEqual(p.companyExamples, [{ name: 'Discord', from: 7, to: 8, sector: 'tech' }]);
  assert.deepEqual(p.examples.map((e) => [e.name, e.company, e.from, e.to]), [['Ari Lund', 'Discord', 'C', 'B']]);
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
  assert.equal(m.people, 3);                                             // four rows, three people
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
  assert.match(row('s').score_why, /YouTube \(10\/10: 9 \+ 1 your sector: Marketing, Media & Creator\)/);
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

// What the page does: the preview route's call, then a save through the settings route's path.
const previewAsRoute = (db, to) => {
  const rows = scoringRows(db, { withPeople: true });
  return previewSectorFocus(rows, { overrides: companyOverrides(db), read: readForScoring(rows), from: sectorFocusOf(db), to });
};
const save = (db, focus) => {
  const before = readSettings(db);
  return afterSettingsChange(db, before, writeSettings(db, { sectorFocus: focus }));
};

test('saving a new focus rescores everyone and says who moved; the preview said the same', () => {
  insert(network());
  rescoreAll();
  const db = getDb();
  const preview = previewAsRoute(db, strong('tech'));
  const beforeSave = readSettings(db);
  const saved = writeSettings(db, { sectorFocus: strong('tech') });
  const effects = afterSettingsChange(db, beforeSave, saved);
  assert.deepEqual(effects, { sectorFocus: { scored: 7, people: 6, moved: preview.up + preview.down, up: preview.up, down: preview.down } });
  assert.deepEqual([effects.sectorFocus.up, effects.sectorFocus.down], [2, 0]);
  assert.equal(effects.sectorFocus.people, preview.people);
  assert.equal(row('f').tier, 'S');
  // The same choice again sets nothing in motion.
  assert.equal(afterSettingsChange(db, saved, writeSettings(db, { sectorFocus: strong('tech') })), null);
});

test('the preview and the save agree when the stored scores are stale', () => {
  // Stored scores from one focus, a different focus saved: a save whose rescore
  // failed, or a database brought from another computer. The save used to
  // count from the stored tiers (1 up, 0 down) while the preview counted from
  // the saved focus (1 up, 2 down).
  insert(network());
  rescoreAll();                                                          // stamped 'none'
  const db = getDb();
  writeSettings(db, { sectorFocus: strong('tech') });                   // saved, never rescored
  assert.deepEqual([row('f').tier, row('a').tier], ['A', 'A']);
  const preview = previewAsRoute(db, lean('media'));
  // Strong tech had Ada (Quillon) and Esme (Adobe) at S; lean media lifts Dev (YouTube) instead.
  assert.deepEqual([preview.up, preview.down], [1, 2]);
  const effects = save(db, lean('media'));
  assert.deepEqual(effects.sectorFocus, { scored: 7, people: 6, moved: 3, up: preview.up, down: preview.down });
  assert.deepEqual([row('s').tier, row('f').tier, row('a').tier], ['S', 'A', 'A']);
  assert.equal(meta('scoring_focus'), 'lean:media');
});

test('a save whose rescore fails is still saved, says so, and is redone on a later load', () => {
  insert(network());
  rescoreAll();
  const db = getDb();
  db.exec("CREATE TRIGGER fail_rescore BEFORE UPDATE OF tier ON linkedin_connections BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END");
  try {
    let error;
    try { save(db, lean('media')); } catch (err) { error = err; }
    assert.equal(error?.message, 'Saved, but rescoring your network failed (disk full (simulated)). It will try again the next time the map loads.');
    assert.equal(error.effects, null);
    // The choice is saved; the scores and their stamp are the old ones, all or nothing.
    assert.deepEqual(sectorFocusOf(db), lean('media'));
    assert.equal(meta('scoring_focus'), 'none');
    assert.deepEqual([row('s').company_prestige_score, row('s').tier], [9, 'A']);
    // While the fault lasts, the map's retry fails too (and it serves what's stored).
    assert.throws(() => rescoreIfStale(), /disk full/);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_rescore');
  }
  // Once it clears, the next load redoes it with the saved choice.
  assert.deepEqual(rescoreIfStale(), { scored: 7 });
  assert.deepEqual([row('s').company_prestige_score, row('s').tier], [10, 'S']);
  assert.equal(meta('scoring_focus'), 'lean:media');
});

test('a strength with no sectors picked scores like nothing picked, so it saves without a rescore', () => {
  insert(network());
  rescoreAll();
  const db = getDb();
  // A rescore would put this back to A.
  db.prepare("UPDATE linkedin_connections SET tier = 'D' WHERE id = 's'").run();
  const before = readSettings(db);
  const saved = writeSettings(db, { sectorFocus: strong() });
  assert.deepEqual(saved.sectorFocus, { sectors: [], strength: 'strong' });
  assert.equal(afterSettingsChange(db, before, saved), null);
  assert.equal(row('s').tier, 'D');
  assert.deepEqual(rescoreIfStale(), { scored: 0 });                     // 'none' either way
});

test('every changed setting\'s work runs, even after another\'s fails, and every failure is named', () => {
  const ran = [];
  const effects = {
    first: { run: () => { ran.push('first'); throw new Error('First failed.'); } },
    second: { run: (db, after, before) => { ran.push('second'); return { from: before, to: after }; } },
    third: { run: () => { ran.push('third'); throw new Error('Third failed.'); } },
    unchanged: { run: () => { ran.push('unchanged'); } },
    judged: { changed: () => false, run: () => { ran.push('judged'); } },
  };
  const before = { first: 1, second: 1, third: 1, unchanged: 1, judged: 1 };
  const after = { first: 2, second: 2, third: 2, unchanged: 1, judged: 2 };
  let error;
  try { afterSettingsChange(getDb(), before, after, effects); } catch (err) { error = err; }
  assert.deepEqual(ran, ['first', 'second', 'third']);
  assert.equal(error?.message, 'First failed. Third failed.');
  assert.deepEqual(error.effects, { second: { from: 1, to: 2 } });
  // With nothing failing, the results come back as before.
  assert.deepEqual(afterSettingsChange(getDb(), before, after, { second: effects.second }), { second: { from: 1, to: 2 } });
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

// ── picks from the sector directory ─────────────────────────────────────────

test('a pick can be a broad industry or a sector from the directory, stored in one order, at most three', () => {
  // Each industry, then its sectors: health, dental, …, tech, software.
  assert.deepEqual(parseSectorFocus({ sectors: ['software', 'dental', 'health'] }), { sectors: ['health', 'dental', 'software'], strength: 'lean' });
  assert.throws(() => parseSectorFocus({ sectors: ['dental', 'software', 'legal', 'tech'] }), /up to 3 sectors/);
  assert.throws(() => parseSectorFocus({ sectors: ['Dental'] }), /no sector called 'Dental'/);   // keys, not labels
  assert.deepEqual(writeSettings(getDb(), { sectorFocus: { sectors: ['real-estate'], strength: 'strong' } }).sectorFocus,
    { sectors: ['real-estate'], strength: 'strong' });
});

test('a choice saved before the directory, of the twelve industries, reads and stamps exactly as before', () => {
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('settings', ?)").run(JSON.stringify({ sectorFocus: { sectors: ['tech', 'media'], strength: 'strong' } }));
  assert.deepEqual(readSettings(getDb()).sectorFocus, { sectors: ['media', 'tech'], strength: 'strong' });
  assert.equal(focusFingerprint(readSettings(getDb()).sectorFocus), 'strong:media,tech');
});

test('the fingerprint carries the directory\'s version when a pick comes from it', () => {
  assert.equal(focusFingerprint(lean('dental')), `lean:dental@${DIRECTORY_VERSION}`);
  assert.equal(focusFingerprint(lean('dental', 'health')), `lean:health,dental@${DIRECTORY_VERSION}`);
  // Another version of the word lists is another fingerprint…
  assert.notEqual(focusFingerprint(lean('dental'), { version: 'aaaa0000' }), focusFingerprint(lean('dental'), { version: 'bbbb1111' }));
  // …but industries alone don't use the directory, so theirs never changes with it.
  assert.equal(focusFingerprint(lean('media', 'tech'), { version: 'aaaa0000' }), 'lean:media,tech');
  assert.ok(!sameFocus(lean('dental'), lean('health')));
});

// An invented network around dental practices (industry by the regexes, sectors by the directory):
//   Nia    Owner at Smith Family Practice   its one person says "Dentist": dental. Industry unclear.
//   Omar   Orthodontist at Bright Smiles    with Pia, half of Bright Smiles says dental.
//   Pia    Office Manager at Bright Smiles
//   Quinn  Founder at Smith Family Dental   its name says dental (and so health).
//   Rae    Engineer at Quillon              not dental.
//   Nia    5.4 (B) → 5.8 (A) at lean, 6.2 at strong; Quinn 6.7 (A) → 7.3 (A) at lean, 7.8 (S) at strong.
function dentalNetwork() {
  const p = (id, degree, name, headline, extra = {}) => ({ id, degree, name, headline, profile_url: `/in/${id}`, source_connection_id: null, ...extra });
  return [
    p('nia', 1, 'Nia Okafor', 'Dentist | Owner at Smith Family Practice'),
    p('omar', 1, 'Omar Reyes', 'Orthodontist at Bright Smiles Co'),
    p('pia', 2, 'Pia Lund', 'Office Manager at Bright Smiles Co', { source_connection_id: 'nia' }),
    p('quinn', 1, 'Quinn Tate', 'Founder at Smith Family Dental'),
    p('rae', 1, 'Rae Ito', 'Engineer at Quillon'),
  ];
}

test('a sector from the directory leans the companies it places, and the working names it', () => {
  insert(dentalNetwork());
  writeSettings(getDb(), { sectorFocus: lean('dental') });
  rescoreAll();
  assert.deepEqual(['nia', 'omar', 'pia', 'quinn', 'rae'].map((id) => row(id).company_prestige_score), [5, 5, 5, 5, 4]);
  assert.deepEqual([row('nia').power_score, row('nia').tier], [5.8, 'A']);
  assert.match(row('nia').score_why, /Smith Family Practice \(5\/10: 4 \+ 1 your sector: Dental\)/);
  assert.match(row('rae').score_why, /Quillon \(4\/10\)/);
  assert.equal(meta('scoring_focus'), `lean:dental@${DIRECTORY_VERSION}`);
  // The broad industry still goes by each company's one industry, as it always did:
  // only Smith Family Dental says health.
  writeSettings(getDb(), { sectorFocus: lean('health') });
  rescoreAll();
  assert.deepEqual(['nia', 'omar', 'quinn'].map((id) => row(id).company_prestige_score), [4, 4, 5]);
  assert.match(row('quinn').score_why, /Smith Family Dental \(5\/10: 4 \+ 1 your sector: Healthcare & Biotech\)/);
});

test('several picks that match one company lean it once', () => {
  insert(dentalNetwork());
  // Smith Family Dental is health by its industry and dental by the directory.
  writeSettings(getDb(), { sectorFocus: strong('health', 'hospitals', 'dental') });
  rescoreAll();
  assert.equal(row('quinn').company_prestige_score, 6);                  // 4 + 2, once
  assert.match(row('quinn').score_why, /\(6\/10: 4 \+ 2 your sector: Dental\)/);
  assert.equal(row('nia').company_prestige_score, 6);
});

test('the preview and the save agree for a pick from the directory', () => {
  insert(dentalNetwork());
  rescoreAll();
  const db = getDb();
  const preview = previewAsRoute(db, lean('dental'));
  assert.deepEqual([preview.companies, preview.companiesUp, preview.up, preview.down], [3, 3, 1, 0]);
  assert.deepEqual(preview.companyExamples.map((c) => [c.name, c.from, c.to, c.sector]),
    [['Bright Smiles', 4, 5, 'dental'], ['Smith Family Dental', 4, 5, 'dental'], ['Smith Family Practice', 4, 5, 'dental']]);
  assert.deepEqual(preview.examples.map((e) => [e.name, e.from, e.to]), [['Nia Okafor', 'B', 'A']]);
  const effects = save(db, lean('dental'));
  assert.deepEqual(effects.sectorFocus, { scored: 5, people: 5, moved: 1, up: preview.up, down: preview.down });
  // From lean on to strong: Nia is already A, and Quinn reaches S.
  const harder = previewAsRoute(db, strong('dental'));
  assert.deepEqual([harder.up, harder.down], [1, 0]);
  assert.deepEqual(harder.examples.map((e) => [e.name, e.from, e.to]), [['Quinn Tate', 'A', 'S']]);
  assert.deepEqual(save(db, strong('dental')).sectorFocus, { scored: 5, people: 5, moved: 1, up: 1, down: 0 });
  assert.deepEqual([row('nia').tier, row('quinn').tier], ['A', 'S']);
});

test('an edited word list makes stored scores stale, and they are redone once', () => {
  insert(dentalNetwork());
  writeSettings(getDb(), { sectorFocus: lean('dental') });
  rescoreAll();
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  // Scores stamped by an older directory: an update that changed its words.
  getDb().prepare("UPDATE app_meta SET value = 'lean:dental@00000000' WHERE key = 'scoring_focus'").run();
  assert.deepEqual(rescoreIfStale(), { scored: 5 });
  assert.equal(meta('scoring_focus'), `lean:dental@${DIRECTORY_VERSION}`);
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  // Industries alone don't depend on the directory, so their old stamp stays fresh.
  writeSettings(getDb(), { sectorFocus: lean('media') });
  rescoreAll();
  assert.equal(meta('scoring_focus'), 'lean:media');
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
});

test('suggestions count your scanned people by the sector their company is in', () => {
  insert(dentalNetwork());
  const rows = scoringRows(getDb());
  // Nia, Omar, Pia and Quinn work at the three dental companies; Rae's "Engineer" says nothing.
  assert.deepEqual(suggestSectors(rows, readForScoring(rows)), [{ key: 'dental', label: 'Dental', group: 'health', people: 4, companies: 3 }]);
  assert.deepEqual(suggestSectors([], readForScoring([])), []);
});
