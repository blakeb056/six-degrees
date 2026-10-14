// Connections.csv as a network file (lib/csv-network-file.js), and the quiet
// move of a CSV import an older version kept beside the database.
//
// The file: every person by their canonical profile link, source 'export',
// people with no link left out and counted (Blake, 2026-10-12), and what it
// writes always passes the format's own reader. The move: a backup first, the
// import, and only then the file goes; it can run again and change nothing;
// it waits while a scan runs or an import waits; a failure keeps the file.
// Every person here is invented, on made-up profile links.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = mkdtempSync(path.join(tmpdir(), 'sixgree-csv-network-file-'));
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(home, 'six-degrees.sqlite');
// Windows can't delete the folder while the database in it is open; the system's temp cleanup gets it there.
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* see above */ } });

const { getDb, keptCsvMoved } = await import('../lib/db-client.js');
const { parseConnectionsCsv, packConnections } = await import('../lib/csv.js');
const { writeCsvNetwork, readCsvNetwork, CsvStoreError } = await import('../lib/csv-store.js');
const { readNetworkFolder, NetworkFileError } = await import('../lib/network-file.js');
const {
  csvNetworkParts, stageCsvNetwork, moveKeptCsv, CSV_PRODUCER,
} = await import('../lib/csv-network-file.js');
const { stagedNetwork } = await import('../lib/network-stage.js');
const { NETWORK_STAGE_PREFIX } = await import('../lib/data-folder.js');

const db = getDb();
const backupsDir = path.join(home, 'backups');
const NOW = new Date('2026-10-12T21:00:00.000Z');
let seq = 0;

const link = (slug) => `https://www.linkedin.com/in/${slug}`;   // as the export writes it
const stored = (slug) => `${link(slug)}/`;                         // as Sixgree stores it

/** An invented Connections.csv: the export's Notes preamble, then the columns. Rows are [first, last, slug|'', company, position, date]. */
function csvText(rows) {
  const lines = ['Notes:', '"When exporting your connection data, you may notice that some of the email addresses are missing."', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (const [first, last, slug, company, position, date = '28 Sep 2026'] of rows) {
    lines.push([first, last, slug ? link(slug) : '', `${first.toLowerCase()}@example.com`, company, position, date].join(','));
  }
  return lines.join('\n');
}
const parsed = (rows) => parseConnectionsCsv(csvText(rows)).connections;

const TEAM = [
  ['Ava', 'Quill', 'invented-ava-quill', 'Northwind Labs', 'Software Engineer'],
  ['Ben', 'Marsh', 'invented-ben-marsh', 'Halcyon', 'Founder', '01 Jan 2026'],
  ['Cleo', 'Dune', 'invented-cleo-dune', 'Meridian Health', 'VP of Sales'],
];

const stages = () => readdirSync(home).filter((n) => n.startsWith(NETWORK_STAGE_PREFIX));
const rowsOf = (userId) => db.prepare('SELECT * FROM linkedin_connections WHERE user_id = ? ORDER BY profile_url').all(userId);
const me = () => db.prepare('SELECT id FROM users ORDER BY rowid LIMIT 1').get()?.id;
const backups = () => (existsSync(backupsDir) ? readdirSync(backupsDir).filter((n) => n.startsWith('before-import-')) : []);
const keep = (rows) => writeCsvNetwork(home, packConnections(parsed(rows)), { now: NOW });
const keptFile = () => path.join(home, 'csv-network.json');
const at = () => new Date(NOW.getTime() + (++seq) * 1000);

beforeEach(() => {
  db.exec("DELETE FROM linkedin_connections; DELETE FROM users; DELETE FROM app_meta WHERE key <> 'settings';");
  rmSync(keptFile(), { force: true });
  rmSync(backupsDir, { recursive: true, force: true });
  rmSync(path.join(home, 'import-pending'), { recursive: true, force: true });
});

// ── the file ─────────────────────────────────────────────────────────────────

test('an export\'s rows become a network file: canonical links, source export, no headline, a date only when it is one', () => {
  const { parts, leftOut, repeated, received } = csvNetworkParts(packConnections(parsed(TEAM)));
  assert.equal(received, 3);
  assert.deepEqual(leftOut, { no_profile_link: 0 });
  assert.equal(repeated, 0);
  const ava = parts.people.find((p) => p.name === 'Ava Quill');
  assert.deepEqual(ava, { key: stored('invented-ava-quill'), name: 'Ava Quill', role: 'Software Engineer', company: 'Northwind Labs' },
    'the link in the form Sixgree stores, and no headline: the importer builds "Role at Company"');
  const ben = parts.connections.find((c) => c.person === stored('invented-ben-marsh'));
  assert.deepEqual(ben, { person: stored('invented-ben-marsh'), connected_date: '2026-01-01', source: 'export' });
  assert.ok(parts.connections.every((c) => c.source === 'export'));
  // A date that isn't one is left out, never guessed at or refused.
  const odd = csvNetworkParts([['csv-x', 'Dara Vale', 'Designer', 'Halcyon', link('invented-dara-vale'), '2026-02-30']]);
  assert.deepEqual(odd.parts.connections[0], { person: stored('invented-dara-vale'), source: 'export' });
});

test('people with no profile link, or a link that isn\'t one, are left out and counted; one person listed twice is kept once', () => {
  const rows = [
    ['csv-1', 'Ava Quill', 'Engineer', 'Northwind Labs', link('invented-ava-quill'), '2026-09-28'],
    ['csv-2', 'Nolan Nolink', 'Founder', 'Halcyon', null, '2026-09-28'],
    ['csv-3', 'Nadia Nolink', 'Designer', 'Halcyon', '', null],
    ['csv-4', 'Gil Garble', 'Analyst', 'Meridian Health', 'not a link at all', null],
    // The same person as csv-1: the link written with its "/" (and a query), as the browser keeps both.
    ['csv-5', 'Ava Quill', 'Engineer', 'Northwind Labs', `${link('invented-ava-quill')}/?trk=export`, null],
  ];
  const { parts, leftOut, repeated, received } = csvNetworkParts(rows);
  assert.equal(received, 5);
  assert.deepEqual(leftOut, { no_profile_link: 3 });
  assert.equal(repeated, 1);
  assert.deepEqual(parts.people.map((p) => p.key), [stored('invented-ava-quill')]);
  assert.equal(parts.people[0].role, 'Engineer', 'the first of the two is the one kept');
});

test('the packed rows the page sends and the connections it parsed make the same file', () => {
  const connections = parsed(TEAM);
  assert.deepEqual(csvNetworkParts(connections), csvNetworkParts(packConnections(connections)));
});

test('rows the page doesn\'t make are refused before anything is read', () => {
  for (const rows of [undefined, [], 'text', [['only', 'three', 'cells']], [['id', '', 'Role', 'Co', link('x'), null]]]) {
    assert.throws(() => csvNetworkParts(rows), CsvStoreError, JSON.stringify(rows));
  }
  assert.deepEqual(stages(), []);
});

test('staged, it is a network file that passes the format\'s own reader, says who made it, and counts who it left out', () => {
  const rows = [...packConnections(parsed(TEAM)), ['csv-n', 'Nolan Nolink', 'Founder', 'Halcyon', null, null]];
  const staged = stageCsvNetwork(home, rows, { now: NOW });
  assert.match(staged.id, /^[A-Za-z0-9]{6}$/);
  assert.deepEqual(stages(), [`${NETWORK_STAGE_PREFIX}${staged.id}`], 'in a private working folder in the data folder');
  const again = stagedNetwork(home, staged.id);
  assert.deepEqual(again.connections, staged.model.connections, 'read again, checks and all, it is the same file');
  assert.equal(again.manifest.producer.name, CSV_PRODUCER.name);
  assert.deepEqual(again.manifest.left_out, { no_profile_link: 1 });
  assert.equal(again.connections.length, 3);
  assert.ok(again.people.every((p) => !p.headline));
  rmSync(path.join(home, `${NETWORK_STAGE_PREFIX}${staged.id}`), { recursive: true, force: true });

  // Nobody with a link: nothing to import, said, and nothing left behind.
  assert.throws(() => stageCsvNetwork(home, [['csv-n', 'Nolan Nolink', 'Founder', 'Halcyon', null, null]]), (err) => {
    assert.ok(err instanceof NetworkFileError);
    assert.equal(err.status, 422);
    assert.match(err.message, /^Nobody in this file has a profile link, so there's nothing to import \(1 person had none\)\./);
    return true;
  });
  assert.deepEqual(stages(), []);
});

// ── the quiet move ───────────────────────────────────────────────────────────

/** A .sixdegrees backup's files (lib/data-export.js): the kept CSV rides in it. */
function filesInBackup(name) {
  const x = new DatabaseSync(path.join(backupsDir, name), { readOnly: true });
  try { return x.prepare('SELECT path FROM sd_export_files ORDER BY path').all().map((r) => r.path); } finally { x.close(); }
}

test('the quiet move: a backup first, then the import, and only then does the kept file go', async () => {
  keep([...TEAM, ['Nolan', 'Nolink', '', 'Halcyon', 'Founder']]);
  assert.equal(readCsvNetwork(home).csv.people, 4);
  const done = await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() });
  assert.equal(done.moved, true, done.reason);
  assert.deepEqual(done.counts, { add: 3, update: 0, promote: 0, unchanged: 0 });
  assert.deepEqual(done.leftOut, { no_profile_link: 1 });
  assert.equal(done.removed, true);
  // The backup came first, of an empty network: it carries the kept file itself.
  assert.match(done.backup, /^before-import-/);
  assert.deepEqual(backups(), [done.backup]);
  assert.ok(filesInBackup(done.backup).includes('csv-network.json'), 'the way back has the kept CSV in it');
  // In your network, as Sixgree stores people, and the file is gone.
  const rows = rowsOf(me());
  assert.deepEqual(rows.map((r) => [r.profile_url, r.degree, r.headline]), [
    [stored('invented-ava-quill'), 1, 'Software Engineer at Northwind Labs'],
    [stored('invented-ben-marsh'), 1, 'Founder at Halcyon'],
    [stored('invented-cleo-dune'), 1, 'VP of Sales at Meridian Health'],
  ]);
  assert.ok(rows.every((r) => r.tier), 'scored, with your settings');
  assert.equal(existsSync(keptFile()), false);
  assert.deepEqual(stages(), [], 'its working folder is gone');
});

test('it can run again and change nothing: no file is nothing to do; the same file back adds nobody twice and makes no backup', async () => {
  keep(TEAM);
  assert.equal((await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() })).moved, true);
  const before = rowsOf(me());
  assert.deepEqual(await moveKeptCsv({ scanRunning: null, pending: null, backupsDir }), { moved: false, reason: 'there is no kept CSV import' });
  // As if the file couldn't be removed last time: it's all in, so this only removes it.
  keep(TEAM);
  const again = await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() });
  assert.equal(again.moved, true);
  assert.deepEqual(again.counts, { add: 0, update: 0, promote: 0, unchanged: 3 });
  assert.equal(again.backup, null);
  assert.equal(backups().length, 1, 'still the one backup');
  assert.deepEqual(rowsOf(me()).map((r) => [r.id, r.profile_url]), before.map((r) => [r.id, r.profile_url]), 'nobody twice, no id changed');
  assert.equal(existsSync(keptFile()), false);
});

test('skipped while a scan runs or an import waits: the file stays, nothing is imported, no backup', async () => {
  keep(TEAM);
  const scanning = await moveKeptCsv({ scanRunning: 'full', pending: null, backupsDir });
  assert.equal(scanning.moved, false);
  assert.match(scanning.reason, /^A scan is running/);
  // An import from another computer, waiting for the next start.
  mkdirSync(path.join(home, 'import-pending'));
  writeFileSync(path.join(home, 'import-pending', 'READY'), JSON.stringify({ people: 3 }));
  const waiting = await moveKeptCsv({ scanRunning: null, backupsDir });
  assert.equal(waiting.moved, false);
  assert.match(waiting.reason, /already waiting to finish/);
  assert.ok(existsSync(keptFile()));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM linkedin_connections').get().n, 0);
  assert.deepEqual(backups(), []);
  assert.deepEqual(stages(), []);
});

test('a failure part-way keeps the file: the backup was made, and the import rolled back whole', async () => {
  keep([...TEAM, ['Boom', 'Fail', 'invented-boom-fail', 'Halcyon', 'Analyst']]);
  db.exec(`CREATE TEMP TRIGGER refuse_boom BEFORE INSERT ON main.linkedin_connections WHEN NEW.name = 'Boom Fail'
    BEGIN SELECT RAISE(ABORT, 'the disk said no'); END`);
  let done;
  try {
    done = await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() });
  } finally {
    db.exec('DROP TRIGGER temp.refuse_boom');
  }
  assert.equal(done.moved, false);
  assert.match(done.reason, /^Nothing was imported: the disk said no/);
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM linkedin_connections').get().n, 0, 'nobody, not even the first three');
  assert.equal(backups().length, 1, 'the backup came first');
  assert.ok(existsSync(keptFile()), 'kept, to be tried at the next start');
  assert.deepEqual(stages(), []);
  // The next start: it goes in.
  assert.equal((await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() })).moved, true);
  assert.equal(rowsOf(me()).length, 4);
});

test('a kept file it can\'t read, or with nobody linkable in it, stays as it is, and nothing is made', async () => {
  writeFileSync(keptFile(), '{"format": 1, "connections": [');
  const unreadable = await moveKeptCsv({ scanRunning: null, pending: null, backupsDir });
  assert.equal(unreadable.moved, false);
  assert.match(unreadable.reason, /^it can't be read: it isn't readable JSON/);
  keep([['Nolan', 'Nolink', '', 'Halcyon', 'Founder']]);
  assert.deepEqual(await moveKeptCsv({ scanRunning: null, pending: null, backupsDir }), { moved: false, reason: 'nobody in it has a profile link' });
  assert.ok(existsSync(keptFile()), 'a window still shows it, as before');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0, 'no profile made for nothing');
  assert.deepEqual(backups(), []);
});

test('a CSV kept behind a scanned network merges into it: it fills only what\'s blank and adds who\'s missing', async () => {
  db.prepare("INSERT INTO users (id, name) VALUES ('me-scanned', 'You')").run();
  const add = db.prepare(`INSERT INTO linkedin_connections (id, degree, name, headline, role, company, profile_url, user_id)
    VALUES (?, 1, ?, ?, ?, ?, ?, 'me-scanned')`);
  add.run('scan-ava', 'Ava Quill', 'Builds engines | Northwind Labs', 'Builds engines', 'Northwind Labs', stored('invented-ava-quill'));
  keep(TEAM);
  const done = await moveKeptCsv({ scanRunning: null, pending: null, backupsDir, now: at() });
  assert.equal(done.moved, true);
  assert.deepEqual(done.counts, { add: 2, update: 1, promote: 0, unchanged: 0 });
  const ava = rowsOf('me-scanned').find((r) => r.id === 'scan-ava');
  assert.equal(ava.headline, 'Builds engines | Northwind Labs', 'what the scan read stays');
  assert.equal(ava.connected_date, '2026-09-28', 'and a blank is filled');
  assert.equal(rowsOf('me-scanned').length, 3);
  assert.equal(backups().length, 1);
});

// ── at the start ─────────────────────────────────────────────────────────────

test('at the start: the server\'s first getDb moves a kept file in, and the first page\'s question waits for it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-csv-move-start-'));
  try {
    writeCsvNetwork(dir, packConnections(parsed([...TEAM, ['Nolan', 'Nolink', '', 'Halcyon', 'Founder']])), { now: NOW });
    const url = (p) => new URL(p, import.meta.url).href;
    const src = `
      import { register } from 'node:module';
      register(${JSON.stringify(url('./helpers/extensionless.mjs'))});
      const { getDb, keptCsvMoved } = await import(${JSON.stringify(url('../lib/db-client.js'))});
      const route = await import(${JSON.stringify(url('../app/api/data/csv/route.js'))});
      // The first page asks before anything else has opened the database.
      const answer = await (await route.GET()).json();
      const moved = await keptCsvMoved();
      const rows = getDb().prepare('SELECT COUNT(*) AS n FROM linkedin_connections WHERE degree = 1').get().n;
      console.log(JSON.stringify({ answer, moved, rows }));`;
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', src], {
      encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: dir, SIX_DEGREES_DB: path.join(dir, 'six-degrees.sqlite') },
    });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.equal(out.rows, 3);
    assert.equal(out.moved.moved, true);
    assert.deepEqual(out.answer, { csv: null, scanned: 3, problem: null },
      'the page opens on your network, never on the kept file a moment before it goes');
    assert.match(run.stdout, /moved your kept CSV import into your network \(3 people; 1 with no profile link left out\)/);
    assert.equal(existsSync(path.join(dir, 'csv-network.json')), false);
    assert.equal(readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('before-import-')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no kept file, the start loads nothing more and the question doesn\'t wait', async () => {
  assert.equal(await keptCsvMoved(), null);
});
