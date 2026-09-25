// The import finishes as the app starts: the first getDb() swaps in a staged
// import before it opens the database, and remembers it for the Settings page.
// Its own file, because getDb() keeps one handle per process and this has to
// be the first open. Every person here is invented.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../db/schema.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'six-degrees-apply-'));
const home = path.join(scratch, 'home');
mkdirSync(home);
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(home, 'six-degrees.sqlite');

let getDb, lastImport, pendingImport, rows, stageAnother;

function network(db, tag, people) {
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(`${tag}-me`, 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id)
    VALUES (?, 1, ?, ?, ?)`);
  for (let i = 0; i < people; i++) add.run(`${tag}-${i}`, `Invented ${tag}${i}`, `https://www.linkedin.com/in/invented-${tag}-${i}`, `${tag}-me`);
}

before(async () => {
  // getDb() is not called until the tests: the fixtures are built without it.
  let applySchema;
  ({ applySchema, getDb } = await import('../lib/db-client.js'));
  const { buildExport } = await import('../lib/data-export.js');
  const data = await import('../lib/data-import.js');
  ({ lastImport, pendingImport } = data);
  const { UPLOAD_WORK_PREFIX } = await import('../lib/data-folder.js');

  // The other computer.
  const src = path.join(scratch, 'src');
  mkdirSync(path.join(src, 'avatars'), { recursive: true });
  writeFileSync(path.join(src, 'avatars', 'p0.webp'), 'webp');
  const other = new DatabaseSync(path.join(src, 'six-degrees.sqlite'));
  applySchema(other);
  network(other, 'new', 4);
  const file = path.join(scratch, 'Six Degrees backup.sixdegrees');
  buildExport(other, { dir: src, outFile: file, appVersion: '0.2.1', schemaSql: SCHEMA_SQL });
  other.close();

  // This computer, with a network of its own, and the import staged.
  const mine = new DatabaseSync(process.env.SIX_DEGREES_DB);
  applySchema(mine);
  network(mine, 'old', 2);
  mine.close();
  const work = mkdtempSync(path.join(home, UPLOAD_WORK_PREFIX));
  copyFileSync(file, path.join(work, 'upload.sixdegrees'));
  data.stageImport(path.join(work, 'upload.sixdegrees'), {
    dir: home, applySchema, schemaSql: SCHEMA_SQL, appVersion: '0.2.1', replacedPeople: 2,
  });
  assert.ok(pendingImport(home));

  rows = (db) => db.prepare('SELECT id FROM linkedin_connections ORDER BY id').all().map((r) => r.id);

  // A second computer's network, staged here while this process runs.
  stageAnother = () => {
    const src2 = path.join(scratch, 'src2');
    mkdirSync(src2, { recursive: true });
    const third = new DatabaseSync(path.join(src2, 'six-degrees.sqlite'));
    applySchema(third);
    network(third, 'later', 1);
    const file2 = path.join(scratch, 'later.sixdegrees');
    buildExport(third, { dir: src2, outFile: file2, appVersion: '0.2.1', schemaSql: SCHEMA_SQL });
    third.close();
    const work2 = mkdtempSync(path.join(home, UPLOAD_WORK_PREFIX));
    copyFileSync(file2, path.join(work2, 'upload.sixdegrees'));
    data.stageImport(path.join(work2, 'upload.sixdegrees'), {
      dir: home, applySchema, schemaSql: SCHEMA_SQL, appVersion: '0.2.1', replacedPeople: 4,
    });
  };
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
});

test('the first open finishes the import, then opens the imported network', () => {
  const db = getDb();
  assert.deepEqual(rows(db), ['new-0', 'new-1', 'new-2', 'new-3']);
  assert.equal(pendingImport(home), null);
  assert.ok(existsSync(path.join(home, 'avatars', 'p0.webp')));
});

test('an import staged while the app runs waits for the next start, even for a second copy of the database module', async () => {
  // Next can give a route its own copy of lib/db-client.js, with its own
  // handle. One that opens for the first time now must not swap the database
  // under the handle this process already has open.
  stageAnother();
  const second = await import('../lib/db-client.js?as-another-route-bundle');
  const again = second.getDb();
  assert.notEqual(again, getDb(), 'a separate module copy, with a handle of its own');
  assert.deepEqual(rows(again), ['new-0', 'new-1', 'new-2', 'new-3'], 'still the network this process started with');
  assert.equal(pendingImport(home).people, 1, 'still waiting, for the next start');
});

test('the import is remembered, with where the old network was kept', () => {
  const last = lastImport(getDb());
  assert.equal(last.people, 4);
  assert.equal(last.replacedPeople, 2);
  assert.match(last.keptDatabase, /^backups\/before-import-.*\.sqlite$/);
  const kept = new DatabaseSync(path.join(home, last.keptDatabase), { readOnly: true });
  assert.deepEqual(rows(kept), ['old-0', 'old-1']);
  kept.close();
});
