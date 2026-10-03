// A backup of the data before each new version touches it (lib/db-client.js
// backupOnNewVersion): the whole network as a .sixdegrees file, through
// lib/backups.js, with the old database-only copy when that can't be made.
// Every person here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupOnNewVersion, applySchema, AUTO_BACKUP_PREFIX } from '../lib/db-client.js';
import { backupFailure } from '../lib/backups.js';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-backup-'));
  const db = new DatabaseSync(path.join(dir, 'six-degrees.sqlite'));
  return { dir, db, done: () => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ } } };
}

/** A network of invented people as the app writes it, with a saved photo each. */
function withPeople(db, dir, n = 3) {
  applySchema(db);
  db.prepare("INSERT INTO users (id, name) VALUES ('me', 'You')").run();
  mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  const add = db.prepare(`INSERT INTO linkedin_connections (id, degree, name, profile_url, profile_image_url, user_id)
    VALUES (?, 1, ?, ?, ?, 'me')`);
  for (let i = 0; i < n; i++) {
    add.run(`p${i}`, `Invented Person ${i}`, `https://www.linkedin.com/in/invented-${i}`, `/avatars/inv${i}.webp`);
    writeFileSync(path.join(dir, 'avatars', `inv${i}.webp`), `RIFF-invented-${i}`);
  }
}

const inBackups = (dir) => readdirSync(path.join(dir, 'backups')).sort();
const manifestOf = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare('SELECT key, value FROM sd_export_manifest').all().map((r) => [r.key, r.value]));
  } finally {
    db.close();
  }
};

test('a brand-new database has nothing to back up; the version is remembered', () => {
  const { dir, db, done } = fresh();
  assert.equal(backupOnNewVersion(db, { dir, version: '0.2.0' }), null);
  assert.equal(readFileSync(path.join(dir, 'app-version'), 'utf8').trim(), '0.2.0');
  done();
});

test('a new version backs up the whole network first, photos too, and only once', () => {
  const { dir, db, done } = fresh();
  withPeople(db, dir, 3);
  writeFileSync(path.join(dir, 'app-version'), '0.1.10\n');
  const saved = backupOnNewVersion(db, { dir, version: '0.2.0', now: new Date('2026-10-03T10:00:00Z') });
  assert.equal(path.basename(saved), 'before-update-0.2.0-2026-10-03T10-00-00-000Z.sixdegrees');
  const m = manifestOf(saved);
  assert.equal(m.people, '3');
  assert.equal(m.photos, '3');
  // The data is 0.1.10's, so 0.1.10 can restore it if 0.2.0 has to be put back.
  assert.equal(m.app_version, '0.1.10');
  assert.equal(backupOnNewVersion(db, { dir, version: '0.2.0' }), null, 'same version again: no second copy');
  assert.deepEqual(inBackups(dir), [path.basename(saved)], 'nothing half-written left beside it');
  done();
});

test('data from before this existed (no marker) is backed up too, labelled with this version', () => {
  const { dir, db, done } = fresh();
  withPeople(db, dir);
  const saved = backupOnNewVersion(db, { dir, version: '0.2.0' });
  assert.equal(manifestOf(saved).app_version, '0.2.0');
  done();
});

test('three copies from before new versions are kept, counting the database-only ones older versions made; nothing put there by hand is touched', () => {
  const { dir, db, done } = fresh();
  withPeople(db, dir);
  mkdirSync(path.join(dir, 'backups'));
  writeFileSync(path.join(dir, 'backups', `${AUTO_BACKUP_PREFIX}0.0.9-2026-09-01T12-00-00-000Z.sqlite`), 'an old copy');
  writeFileSync(path.join(dir, 'backups', 'pre-dedupe-by-hand.sqlite'), 'mine');
  for (let i = 1; i <= 4; i++) {
    backupOnNewVersion(db, { dir, version: `0.${i}.0`, now: new Date(Date.UTC(2026, 9, 1, 12, i)) });
  }
  assert.deepEqual(inBackups(dir), [
    'before-update-0.2.0-2026-10-01T12-02-00-000Z.sixdegrees',
    'before-update-0.3.0-2026-10-01T12-03-00-000Z.sixdegrees',
    'before-update-0.4.0-2026-10-01T12-04-00-000Z.sixdegrees',
    'pre-dedupe-by-hand.sqlite',
  ]);
  done();
});

test("a database a backup can't hold is still copied, database only, as before; the page is told the backup didn't work", () => {
  const { dir, db, done } = fresh();
  withPeople(db, dir);
  // Something an export never holds: the importer refuses it, so the backup fails its check.
  db.exec('CREATE TABLE made_by_hand (x)');
  const saved = backupOnNewVersion(db, { dir, version: '0.2.0', now: new Date('2026-10-03T11:00:00Z') });
  assert.equal(path.basename(saved), `${AUTO_BACKUP_PREFIX}0.2.0-2026-10-03T11-00-00-000Z.sqlite`);
  const copy = new DatabaseSync(saved, { readOnly: true });
  assert.equal(copy.prepare('SELECT count(*) AS n FROM linkedin_connections').get().n, 3);
  copy.close();
  assert.deepEqual(inBackups(dir), [path.basename(saved)], 'no half-made backup left under any name');
  assert.equal(backupFailure().kind, 'before-update');
  assert.match(backupFailure().message, /made_by_hand/);
  assert.equal(readFileSync(path.join(dir, 'app-version'), 'utf8').trim(), '0.2.0');
  done();
});

test('if no copy can be made, the version is not marked, so the next start tries again', () => {
  const { dir, db, done } = fresh();
  withPeople(db, dir);
  writeFileSync(path.join(dir, 'backups'), 'a file where the folder should be');
  assert.throws(() => backupOnNewVersion(db, { dir, version: '0.2.0' }));
  assert.throws(() => readFileSync(path.join(dir, 'app-version'), 'utf8'));
  done();
});
