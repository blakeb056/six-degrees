// Importing a network file into your own network (lib/network-import.js).
//
// Imports always merge: they add and update, never remove (Blake, 2026-10-12).
// Each case pins a promise about someone's real network: an export's link
// finds the person a scan saved, a scan's reading survives an export, an
// origin survives a promotion, nobody else's rows move, a failure changes
// nothing, a backup comes first, and no other request can run in the middle.
// Every person here is invented, on example.com.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(tmpdir(), 'sixgree-network-import-'));
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(home, 'six-degrees.sqlite');
// Windows can't delete the folder while the database in it is open; the system's temp cleanup gets it there.
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* see above */ } });

const { getDb, applySchema } = await import('../lib/db-client.js');
const { SCHEMA_SQL } = await import('../db/schema.js');
const { readNetworkFolder, writeNetworkFolder, NetworkFileError } = await import('../lib/network-file.js');
const {
  planNetworkImport, applyNetworkImport, networkImportPreflight, notYetImportable, exportOwned, builtHeadline, changesFor,
} = await import('../lib/network-import.js');
const { rescoreAll, rescoreIfStale, setCompanyScores } = await import('../lib/rpc.js');
const { checkBackup } = await import('../lib/backups.js');

const db = getDb();
const backupsDir = path.join(home, 'backups');
const NOW = new Date('2026-10-12T21:00:00.000Z');
let seq = 0;

const url = (slug) => `https://example.com/in/${slug}/`;           // as Sixgree stores links
const exportLink = (slug) => `https://example.com/in/${slug}`;      // as a Connections export writes them

function user(tag, link = null) {
  const id = `user-${tag}`;
  db.prepare('INSERT INTO users (id, name, linkedin_url) VALUES (?, ?, ?)').run(id, 'You', link);
  return id;
}

function row(userId, fields) {
  const r = {
    id: `row-${++seq}`, degree: 1, name: 'Invented Person', headline: null, role: null, company: null,
    connected_date: null, source_connection_id: null, user_id: userId, ...fields,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO linkedin_connections (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]));
  return r.id;
}

/** A network file, written and read back through the format's own writer and reader. */
function fileOf({ people, connections, ...rest }, opts = {}) {
  const dir = path.join(home, `file-${++seq}`);
  writeNetworkFolder(dir, { people, connections, ...rest }, { producer: { name: 'Test producer' }, now: NOW, ...opts });
  const model = readNetworkFolder(dir);
  rmSync(dir, { recursive: true, force: true });
  return model;
}

/** One person from an export: no headline, a role and a company, a link with no "/". */
const exported = (slug, name, role, company, date = '2026-09-28') => ({
  person: { key: exportLink(slug), name, role, company },
  connection: { person: exportLink(slug), connected_date: date, source: 'export' },
});
const fileFrom = (entries, opts) => fileOf({ people: entries.map((e) => e.person), connections: entries.map((e) => e.connection) }, opts);

const apply = (model, opts = {}) => applyNetworkImport(db, model, {
  dataDir: home, backupsDir, scanRunning: null, pending: null, now: new Date(NOW.getTime() + (++seq) * 1000), ...opts,
});
const rowsAt = (u) => db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ? ORDER BY id').all(u);
const mine = (userId, u) => db.prepare('SELECT * FROM linkedin_connections WHERE profile_url = ? AND user_id = ?').all(u, userId);
const everything = () => ({
  rows: db.prepare('SELECT * FROM linkedin_connections ORDER BY id').all(),
  ties: db.prepare('SELECT * FROM connection_ties ORDER BY a_url, b_url').all(),
  meta: db.prepare("SELECT * FROM app_meta WHERE key <> 'settings' ORDER BY key").all(),
  scores: db.prepare('SELECT name, score FROM company_scores ORDER BY name').all(),
  queue: db.prepare('SELECT * FROM queue_items ORDER BY id').all(),
});

// ── the rules, on their own ──────────────────────────────────────────────────

test('an export owns a row only when it could have written it: no headline, or exactly "Role at Company"', () => {
  assert.equal(builtHeadline('Engineer', 'Analytical Engines'), 'Engineer at Analytical Engines');
  assert.equal(builtHeadline('Engineer', ''), 'Engineer');
  assert.equal(builtHeadline('', ''), '');
  assert.equal(exportOwned({ headline: '', role: 'Engineer', company: 'X' }), true);
  assert.equal(exportOwned({ headline: 'Engineer at X', role: 'Engineer', company: 'X' }), true);
  assert.equal(exportOwned({ headline: 'Engineer at X | Builder', role: 'Engineer', company: 'X' }), false);
  // A one-phrase headline a scan read as all role: equal to the built one, and still the scan's.
  assert.equal(exportOwned({ headline: 'Mathematician', role: 'Mathematician', company: '' }), false);
  // A scan overwrites, an export fills blanks, and a file never blanks a field.
  const scanned = { name: 'A', headline: 'Founder at X | Builder', role: 'Founder', company: 'X', connected_date: null };
  const inc = { name: 'A', headline: 'CEO at Y', role: 'CEO', company: 'Y', connected_date: '2026-09-28' };
  assert.deepEqual(changesFor(scanned, inc, 'export'), { connected_date: '2026-09-28' });
  assert.deepEqual(changesFor(scanned, inc, 'scan'), { headline: 'CEO at Y', role: 'CEO', company: 'Y', connected_date: '2026-09-28' });
  assert.deepEqual(changesFor(scanned, { ...inc, headline: '', role: '', company: '' }, 'scan'), { connected_date: '2026-09-28' });
});

test('preflight: not while the scanner runs, not with an import waiting, not with parts this copy can\'t import yet', () => {
  assert.equal(networkImportPreflight({}), null);
  const scan = networkImportPreflight({ scanRunning: 'full' });
  assert.equal(scan.status, 409);
  assert.match(scan.message, /^A scan is running\. Let it finish/);
  assert.match(networkImportPreflight({ scanRunning: 'read-profiles' }).message, /^Profiles are being read/);
  assert.match(networkImportPreflight({ pending: { people: 3 } }).message, /already waiting to finish/);
  const later = networkImportPreflight({ notYet: ['circles', 'photos'] });
  assert.equal(later.status, 422);
  assert.match(later.message, /can't import circles and photos yet\. Nothing was imported/);
});

// ── matching ─────────────────────────────────────────────────────────────────

test('REGRESSION: an export\'s link finds the person a scan saved; nobody is added twice', () => {
  const me = user('match');
  row(me, { profile_url: url('ada-match'), name: 'Ada Match', headline: 'Engineer at Analytical Engines', role: 'Engineer', company: 'Analytical Engines' });
  const model = fileFrom([exported('ada-match', 'Ada Match', 'Engineer', 'Analytical Engines'), exported('new-match', 'New Match', 'Analyst', 'Difference Co')]);
  const plan = planNetworkImport(db, model, { userId: me });
  assert.deepEqual(plan.counts, { add: 1, update: 1, promote: 0, unchanged: 0 });
  assert.deepEqual(plan.people.map((p) => [p.key, p.action]), [[url('ada-match'), 'update'], [url('new-match'), 'add']]);
  assert.deepEqual(plan.people[0].fields, ['connected_date']);
  return apply(model, { userId: me }).then((done) => {
    assert.deepEqual(done.counts, { add: 1, update: 1, promote: 0, unchanged: 0 });
    assert.equal(mine(me, url('ada-match')).length, 1, 'still one Ada');
    assert.equal(mine(me, exportLink('ada-match')).length, 0, 'no copy under the export\'s spelling');
    const added = mine(me, url('new-match'));
    assert.equal(added.length, 1);
    assert.deepEqual([added[0].degree, added[0].headline, added[0].role, added[0].company, added[0].connected_date],
      [1, 'Analyst at Difference Co', 'Analyst', 'Difference Co', '2026-09-28'], 'stored in canonical form, headline built');
  });
});

test('the plan only reads', () => {
  const me = user('plan');
  row(me, { profile_url: url('ada-plan'), name: 'Ada Plan', headline: 'Engineer at X', role: 'Engineer', company: 'X' });
  const before = everything();
  const plan = planNetworkImport(db, fileFrom([exported('ada-plan', 'Ada Plan', 'Lead', 'Y'), exported('bo-plan', 'Bo Plan', 'Analyst', 'Z')]), { userId: me });
  assert.deepEqual(plan.counts, { add: 1, update: 1, promote: 0, unchanged: 0 });
  assert.deepEqual(everything(), before);
  assert.throws(() => planNetworkImport(db, fileFrom([exported('x-plan', 'X', 'A', 'B')]), {}), /no profile to import into/);
  assert.throws(() => planNetworkImport(db, fileFrom([exported('x-plan', 'X', 'A', 'B')]), { userId: 'nobody' }), /no profile to import into/);
});

// ── precedence ───────────────────────────────────────────────────────────────

test('a scanned headline survives an export; an export fills only what is blank', async () => {
  const me = user('prec');
  row(me, { profile_url: url('ada-prec'), name: 'Ada Prec', headline: 'Founder at Analytical Engines | Building the future', role: 'Founder', company: 'Analytical Engines', connected_date: '2025-01-02' });
  row(me, { profile_url: url('alan-prec'), name: 'Alan Prec', headline: 'Mathematician', role: 'Mathematician', company: '', connected_date: null });
  const done = await apply(fileFrom([
    exported('ada-prec', 'Ada Prec', 'Engineer', 'Other Co', '2026-09-28'),
    exported('alan-prec', 'Alan Prec', 'Cryptanalyst', 'Bletchley', '2026-09-28'),
  ]), { userId: me });
  assert.deepEqual(done.counts, { add: 0, update: 1, promote: 0, unchanged: 1 });
  const [ada] = mine(me, url('ada-prec'));
  assert.deepEqual([ada.headline, ada.role, ada.company, ada.connected_date],
    ['Founder at Analytical Engines | Building the future', 'Founder', 'Analytical Engines', '2025-01-02'], 'the scan\'s reading stands');
  const [alan] = mine(me, url('alan-prec'));
  assert.deepEqual([alan.headline, alan.role, alan.company, alan.connected_date],
    ['Mathematician', 'Mathematician', 'Bletchley', '2026-09-28'], 'blanks filled, the headline kept');
});

test('a row only an export described picks up a job change from the next export', async () => {
  const me = user('owned');
  row(me, { profile_url: url('grace-owned'), name: 'Grace Owned', headline: 'Engineer at Analytical Engines', role: 'Engineer', company: 'Analytical Engines' });
  await apply(fileFrom([exported('grace-owned', 'Grace Owned', 'Senior Engineer', 'Difference Co')]), { userId: me });
  const [grace] = mine(me, url('grace-owned'));
  assert.deepEqual([grace.headline, grace.role, grace.company], ['Senior Engineer at Difference Co', 'Senior Engineer', 'Difference Co']);
});

test('a scan or a hand edit overwrites, and a missing role or company is read from the headline', async () => {
  const me = user('scan');
  row(me, { profile_url: url('ada-scan'), name: 'Ada Scan', headline: 'Founder at X | Builder', role: 'Founder', company: 'X' });
  const model = fileOf({
    people: [{ key: exportLink('ada-scan'), name: 'Ada Scan', headline: 'Director at Analytical Engines | Mentor' }],
    connections: [{ person: exportLink('ada-scan'), source: 'scan' }],
  });
  await apply(model, { userId: me });
  const [ada] = mine(me, url('ada-scan'));
  assert.deepEqual([ada.headline, ada.role, ada.company], ['Director at Analytical Engines | Mentor', 'Director', 'Analytical Engines']);
});

test('where someone is comes in from a file that says it, and a file without it (a Connections export) never blanks it', async () => {
  const me = user('where');
  row(me, { profile_url: url('ada-where'), name: 'Ada Where', headline: 'Founder at X', role: 'Founder', company: 'X', location: 'Lisbon, Portugal' });
  // A Connections export carries no location: the one a scan read stays, and a new person has none.
  await apply(fileFrom([exported('ada-where', 'Ada Where', 'Founder', 'X'), exported('bo-where', 'Bo Where', 'Engineer', 'Y')]), { userId: me });
  assert.equal(mine(me, url('ada-where'))[0].location, 'Lisbon, Portugal');
  assert.equal(mine(me, url('bo-where'))[0].location, null);
  // A scan's file that says where they are writes it, on an add and an update alike.
  await apply(fileOf({
    people: [{ key: exportLink('ada-where'), name: 'Ada Where', location: 'Porto, Portugal' }, { key: exportLink('cy-where'), name: 'Cy Where', location: 'Madrid, Spain' }],
    connections: [{ person: exportLink('ada-where'), source: 'scan' }, { person: exportLink('cy-where'), source: 'scan' }],
  }), { userId: me });
  assert.equal(mine(me, url('ada-where'))[0].location, 'Porto, Portugal');
  assert.equal(mine(me, url('cy-where'))[0].location, 'Madrid, Spain');
});

// ── promotion ────────────────────────────────────────────────────────────────

test('someone met through a bridge who is now a connection is promoted, keeping who introduced them', async () => {
  const me = user('promo');
  const bridge = row(me, { profile_url: url('jane-promo'), name: 'Jane Bridge', headline: 'Partner at Northwind', role: 'Partner', company: 'Northwind' });
  row(me, { profile_url: url('pat-promo'), degree: 2, source_connection_id: bridge, name: 'Pat Prospect', headline: 'Director at Contoso | Speaker', role: 'Director', company: 'Contoso' });
  row(me, { profile_url: url('cal-promo'), degree: 3, scanned_company: 'Contoso', name: 'Cal Company', headline: 'Engineer at Contoso', role: 'Engineer', company: 'Contoso' });
  const model = fileFrom([exported('pat-promo', 'Pat Prospect', 'Director', 'Contoso'), exported('cal-promo', 'Cal Company', 'Engineer', 'Contoso')]);
  assert.deepEqual(planNetworkImport(db, model, { userId: me }).counts, { add: 0, update: 0, promote: 2, unchanged: 0 });
  const done = await apply(model, { userId: me });
  assert.deepEqual(done.counts, { add: 0, update: 0, promote: 2, unchanged: 0 });
  const pat = mine(me, url('pat-promo'));
  assert.equal(pat.length, 1, 'promoted, not duplicated');
  assert.equal(pat[0].degree, 1);
  assert.equal(pat[0].source_connection_id, null, 'a direct connection sits in nobody\'s circle');
  assert.equal(pat[0].unlocked_from_bridge_id, bridge, 'the origin is kept (TRAPS §19)');
  assert.equal(pat[0].unlocked_from_name, 'Jane Bridge');
  assert.equal(pat[0].headline, 'Director at Contoso | Speaker', 'the scan\'s headline stands against an export');
  assert.equal(pat[0].connected_date, '2026-09-28');
  // From a company scan too, which /api/ingest leaves at 3rd degree.
  const cal = mine(me, url('cal-promo'));
  assert.deepEqual([cal.length, cal[0].degree], [1, 1]);
});

test('someone in a circle and found at a company keeps who introduced them when promoted', async () => {
  // A company scan's row is "deeper" (degree 3) but introduces nobody: the
  // circle's row carries the origin, so it's the one promoted.
  const me = user('promo3');
  const bridge = row(me, { profile_url: url('jane-promo3'), name: 'Jane Three' });
  row(me, { profile_url: url('lee-promo3'), degree: 3, scanned_company: 'Contoso', name: 'Lee Both' });
  row(me, { profile_url: url('lee-promo3'), degree: 2, source_connection_id: bridge, name: 'Lee Both' });
  await apply(fileFrom([exported('lee-promo3', 'Lee Both', 'Engineer', 'Contoso')]), { userId: me });
  const lee = mine(me, url('lee-promo3'));
  assert.deepEqual(lee.map((r) => [r.degree, r.unlocked_from_bridge_id, r.unlocked_from_name]), [[1, bridge, 'Jane Three']]);
});

test('a connection\'s stale copy in someone\'s circle is folded into them, as a scan does (TRAPS §36)', async () => {
  const me = user('fold');
  const bridge = row(me, { profile_url: url('jane-fold'), name: 'Jane Fold' });
  const ada = row(me, { profile_url: url('ada-fold'), name: 'Ada Fold', headline: 'Engineer at X', role: 'Engineer', company: 'X' });
  row(me, { profile_url: url('ada-fold'), degree: 2, source_connection_id: bridge, name: 'Ada Fold' });
  row(me, { profile_url: url('kim-fold'), degree: 2, source_connection_id: ada, name: 'Kim In Ada\'s Circle' });
  const model = fileFrom([exported('ada-fold', 'Ada Fold', 'Engineer', 'X')]);
  const plan = planNetworkImport(db, model, { userId: me });
  assert.deepEqual([plan.people[0].action, plan.folded], ['update', 1]);
  await apply(model, { userId: me });
  const left = mine(me, url('ada-fold'));
  assert.deepEqual(left.map((r) => [r.id, r.degree]), [[ada, 1]], 'her own row kept, the copy folded in');
  assert.equal(mine(me, url('kim-fold'))[0].source_connection_id, ada, 'her circle still points at her');
});

// ── whose rows ───────────────────────────────────────────────────────────────

test('other profiles\' rows and rows with no user_id are never touched (TRAPS §9, §25)', async () => {
  const me = user('mine');
  const other = user('other');
  row(null, { profile_url: url('ada-owner'), name: 'Ada Orphan', headline: 'Old at Old', role: 'Old', company: 'Old' });
  row(other, { profile_url: url('ada-owner'), name: 'Ada Theirs', headline: 'Theirs at Theirs', role: 'Theirs', company: 'Theirs' });
  row(other, { profile_url: url('bo-owner'), degree: 2, name: 'Bo Theirs' });
  const before = rowsAt(url('ada-owner')).concat(rowsAt(url('bo-owner')));
  const done = await apply(fileFrom([exported('ada-owner', 'Ada Owner', 'Engineer', 'X'), exported('bo-owner', 'Bo Owner', 'Analyst', 'Y')]), { userId: me });
  assert.deepEqual(done.counts, { add: 2, update: 0, promote: 0, unchanged: 0 }, 'someone else\'s copy is no reason to update or promote');
  const after = rowsAt(url('ada-owner')).concat(rowsAt(url('bo-owner')));
  const untouched = (rows) => rows.filter((r) => r.user_id !== me).map(({ power_score, seniority_score, company_prestige_score, tier, score_why, circle_power, circle_s_count, circle_a_count, circle_elite_pct, is_catalyst, catalyst_score, updated_at, ...rest }) => rest);
  assert.deepEqual(untouched(after), untouched(before), 'only the rescore, which scores everyone, wrote to them');
  assert.equal(mine(me, url('ada-owner')).length, 1);
  assert.equal(mine(me, url('bo-owner')).length, 1);
});

test('a file that names its owner can\'t be imported into someone else\'s profile', async () => {
  const me = user('owner-check', exportLink('me-owner'));
  const model = fileFrom([exported('ada-oc', 'Ada', 'Engineer', 'X')], { owner: { key: exportLink('someone-else'), name: 'Someone' } });
  assert.equal(planNetworkImport(db, model, { userId: me }).owner.same, false);
  const before = everything();
  await assert.rejects(apply(model, { userId: me }), /belongs to someone else/);
  assert.deepEqual(everything(), before);
  // Its own file, or one that doesn't say whose it is, is fine.
  const ok = fileFrom([exported('ada-oc', 'Ada', 'Engineer', 'X')], { owner: { key: url('me-owner') } });
  assert.equal(planNetworkImport(db, ok, { userId: me }).owner.same, true);
});

// ── what this copy can't import yet ──────────────────────────────────────────

test('a file with more than connections is refused whole, naming what this copy can\'t import yet', async () => {
  const me = user('later');
  const people = [
    { key: exportLink('ada-later'), name: 'Ada Later', mutual_count: 4 },
    { key: exportLink('bo-later'), name: 'Bo Later' },
  ];
  const model = fileOf({
    people,
    connections: [{ person: exportLink('ada-later'), source: 'scan' }],
    edges: [{ via: exportLink('ada-later'), person: exportLink('bo-later'), source: 'scan' }],
    circles: [{ person: exportLink('ada-later'), status: 'read', pages: 1, read_at: '2026-10-12T20:00:00Z' }],
  });
  assert.deepEqual(notYetImportable(model), ['2nd-degree connections', 'circles', 'mutual counts']);
  assert.deepEqual(planNetworkImport(db, model, { userId: me }).notYet, ['2nd-degree connections', 'circles', 'mutual counts']);
  const before = everything();
  await assert.rejects(apply(model, { userId: me }), (err) => {
    assert.ok(err instanceof NetworkFileError);
    assert.equal(err.status, 422);
    assert.match(err.message, /can't import 2nd-degree connections, circles and mutual counts yet\. Nothing was imported/);
    return true;
  });
  assert.deepEqual(everything(), before);
  assert.equal(mine(me, url('ada-later')).length, 0);
});

test('nothing is imported while the scanner runs or another import waits', async () => {
  const me = user('busy');
  const model = fileFrom([exported('ada-busy', 'Ada Busy', 'Engineer', 'X')]);
  await assert.rejects(apply(model, { userId: me, scanRunning: 'full' }), /A scan is running/);
  await assert.rejects(apply(model, { userId: me, pending: { people: 9 } }), /already waiting to finish/);
  assert.equal(mine(me, url('ada-busy')).length, 0);
  await assert.rejects(applyNetworkImport({}, model, { userId: me }), /own database handle/);
});

// ── order: back up, one transaction, rescore ─────────────────────────────────

test('a backup of the whole network comes first, and an import that changes nothing makes none', async () => {
  const me = user('backup');
  row(me, { profile_url: url('ada-backup'), name: 'Ada Backup', headline: 'Engineer at X', role: 'Engineer', company: 'X' });
  const people = db.prepare('SELECT count(DISTINCT profile_url) AS n FROM linkedin_connections').get().n;
  const listed = () => (readdirSync(backupsDir, { withFileTypes: true }).map((d) => d.name).filter((n) => n.startsWith('before-import-')));
  let had = [];
  try { had = listed(); } catch { /* no backups yet */ }
  const model = fileFrom([exported('bo-backup', 'Bo Backup', 'Analyst', 'Y')]);
  const done = await apply(model, { userId: me, appVersion: '9.8.7' });
  assert.match(done.backup.name, /^before-import-9\.8\.7-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sixdegrees$/);
  assert.deepEqual(listed().filter((n) => !had.includes(n)), [done.backup.name]);
  const check = checkBackup(done.backup.file, { applySchema, schemaSql: SCHEMA_SQL, appVersion: '9.8.7' });
  assert.equal(check.ok, true);
  assert.equal(check.people, people, 'the network as it was before the import');
  // The same file again: nothing changes, so no backup and no transaction.
  const again = await apply(model, { userId: me });
  assert.deepEqual(again.counts, { add: 0, update: 0, promote: 0, unchanged: 1 });
  assert.equal(again.backup, null);
  assert.equal(again.rescored, null);
});

test('REGRESSION: a failure part-way changes nothing at all', async () => {
  const me = user('rollback');
  const bridge = row(me, { profile_url: url('jane-rb'), name: 'Jane Rb' });
  row(me, { profile_url: url('pat-rb'), degree: 2, source_connection_id: bridge, name: 'Pat Rb' });
  row(me, { profile_url: url('alan-rb'), name: 'Alan Rb', headline: 'Mathematician', role: 'Mathematician', company: '' });
  rescoreAll();
  const before = everything();
  assert.ok(before.meta.some((m) => m.key === 'scoring_version'));
  // A failure the importer can't see coming: the last insert is refused. A
  // TEMP trigger lives outside the database file, so the backup's own check passes.
  db.exec(`CREATE TEMP TRIGGER refuse_boom BEFORE INSERT ON main.linkedin_connections WHEN NEW.name = 'Boom'
    BEGIN SELECT RAISE(ABORT, 'the disk said no'); END`);
  try {
    const model = fileFrom([
      exported('alan-rb', 'Alan Rb', 'Cryptanalyst', 'Bletchley'),   // an update
      exported('pat-rb', 'Pat Rb', 'Director', 'Contoso'),            // a promotion, through lib/promote.js
      exported('new-rb', 'New Rb', 'Analyst', 'Y'),                   // an add
      exported('boom-rb', 'Boom', 'Analyst', 'Y'),                    // and then the failure
    ]);
    await assert.rejects(apply(model, { userId: me }), (err) => {
      assert.ok(err instanceof NetworkFileError);
      assert.match(err.message, /^Nothing was imported: the disk said no/);
      assert.match(err.extra.backup.name, /^before-import-/, 'the backup made first is named');
      return true;
    });
  } finally {
    db.exec('DROP TRIGGER temp.refuse_boom');
  }
  assert.equal(db.isTransaction, false);
  assert.deepEqual(everything(), before, 'every row, tie, score and fact as it was, scoring_version too');
});

test('scores come after: your company scores apply, and a rescore that fails is redone on the next read', async () => {
  const me = user('score');
  row(me, { profile_url: url('ada-score'), name: 'Ada Score', headline: 'Engineer at Elsewhere', role: 'Engineer', company: 'Elsewhere' });
  setCompanyScores(db, [['Northwind', 10]]);
  const done = await apply(fileFrom([exported('dee-score', 'Dee Score', 'Director', 'Northwind')]), { userId: me });
  assert.equal(done.rescored.ok, true);
  assert.ok(done.rescored.scored > 0);
  const [dee] = mine(me, url('dee-score'));
  assert.equal(dee.company_prestige_score, 10, 'your score for the company, applied by the rescore');
  assert.match(dee.score_why, /your score/);
  assert.deepEqual(db.prepare('SELECT name, score FROM company_scores').all().map((r) => ({ ...r })), [{ name: 'Northwind', score: 10 }], 'never written');

  // The rescore fails after the import commits: the import stands, and
  // scoring_version is gone, so the next read of the network rescores.
  db.exec(`CREATE TEMP TRIGGER refuse_rescore BEFORE UPDATE OF tier ON main.linkedin_connections
    BEGIN SELECT RAISE(ABORT, 'scoring broke'); END`);
  let failed;
  try {
    failed = await apply(fileFrom([exported('eve-score', 'Eve Score', 'Analyst', 'Northwind')]), { userId: me });
  } finally {
    db.exec('DROP TRIGGER temp.refuse_rescore');
  }
  assert.deepEqual(failed.rescored, { ok: false, error: 'scoring broke' });
  assert.equal(mine(me, url('eve-score')).length, 1, 'the import itself stands');
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'scoring_version'").get(), undefined);
  assert.ok(rescoreIfStale().scored > 0, 'the next read rescores');
  assert.equal(mine(me, url('eve-score'))[0].company_prestige_score, 10);
});

test('REGRESSION: no other request can run between BEGIN and COMMIT, however many promotions await inside', async () => {
  // lib/promote.js is async, and the import awaits it inside its transaction.
  // That's safe only while every await there resolves as a microtask
  // (lib/db.js runs a query the moment it's awaited): a request is a
  // macrotask, like this setImmediate, and must find the import either not
  // begun or committed. Anything that truly waits (a file, the network, a
  // dynamic import such as db.rpc) would let one in mid-transaction.
  const me = user('atomic');
  const bridge = row(me, { profile_url: url('jane-atomic'), name: 'Jane Atomic' });
  const entries = [];
  for (let i = 0; i < 20; i++) {
    row(me, { profile_url: url(`pat-atomic-${i}`), degree: 2, source_connection_id: bridge, name: `Pat Atomic ${i}` });
    entries.push(exported(`pat-atomic-${i}`, `Pat Atomic ${i}`, 'Director', 'Contoso'));
    entries.push(exported(`new-atomic-${i}`, `New Atomic ${i}`, 'Analyst', 'Y'));
  }
  const model = fileFrom(entries);
  const order = [];
  const exec = db.exec;
  db.exec = function spied(sql) {
    const word = /^\s*(BEGIN|COMMIT|ROLLBACK)/i.exec(sql)?.[1]?.toUpperCase();
    if (word) order.push(word);
    return exec.call(this, sql);
  };
  const firstDegree = () => db.prepare('SELECT count(*) AS n FROM linkedin_connections WHERE user_id = ? AND degree = 1').get(me).n;
  let seen;
  setImmediate(() => {
    order.push('request');
    seen = { inTransaction: db.isTransaction, firstDegree: firstDegree() };
  });
  try {
    const done = await apply(model, { userId: me });
    assert.deepEqual(done.counts, { add: 20, update: 0, promote: 20, unchanged: 0 });
  } finally {
    delete db.exec;
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(seen, 'the queued request ran');
  assert.equal(seen.inTransaction, false);
  assert.equal(seen.firstDegree, 41, 'it saw the import whole: the bridge, 20 promoted and 20 added');
  assert.ok(order.indexOf('request') > order.indexOf('COMMIT'), `it ran after COMMIT: ${order.join(', ')}`);
  assert.equal(order[0], 'BEGIN');
});
