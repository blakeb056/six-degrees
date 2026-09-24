// A copy of the data before each new version touches it (lib/db-client.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupOnNewVersion, AUTO_BACKUP_PREFIX } from '../lib/db-client.js';

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-backup-'));
  const db = new DatabaseSync(path.join(dir, 'six-degrees.sqlite'));
  return { dir, db, done: () => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ } } };
}
const withPeople = (db, n = 3) => {
  db.exec('CREATE TABLE linkedin_connections (id TEXT, name TEXT)');
  for (let i = 0; i < n; i++) db.prepare('INSERT INTO linkedin_connections VALUES (?, ?)').run(String(i), `Person ${i}`);
};
const autos = (dir) => readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith(AUTO_BACKUP_PREFIX));

test('a brand-new database has nothing to back up; the version is remembered', () => {
  const { dir, db, done } = fresh();
  assert.equal(backupOnNewVersion(db, { dir, version: '0.2.0' }), null);
  assert.equal(readFileSync(path.join(dir, 'app-version'), 'utf8').trim(), '0.2.0');
  done();
});

test('a new version copies the data first, as it was, and only once', () => {
  const { dir, db, done } = fresh();
  withPeople(db, 3);
  writeFileSync(path.join(dir, 'app-version'), '0.1.10\n');
  const saved = backupOnNewVersion(db, { dir, version: '0.2.0' });
  assert.ok(saved && saved.includes(`${AUTO_BACKUP_PREFIX}0.2.0-`));
  const copy = new DatabaseSync(saved);
  assert.equal(copy.prepare('SELECT count(*) AS n FROM linkedin_connections').get().n, 3);
  copy.close();
  assert.equal(backupOnNewVersion(db, { dir, version: '0.2.0' }), null, 'same version again: no second copy');
  done();
});

test('data from before this existed (no marker) is backed up too', () => {
  const { dir, db, done } = fresh();
  withPeople(db);
  assert.ok(backupOnNewVersion(db, { dir, version: '0.2.0' }));
  done();
});

test('only the newest five automatic copies are kept; copies made by hand are never touched', () => {
  const { dir, db, done } = fresh();
  withPeople(db);
  const first = backupOnNewVersion(db, { dir, version: 'v0' });
  const early = new Date(Date.UTC(2026, 8, 24, 11, 0));
  utimesSync(first, early, early);
  writeFileSync(path.join(dir, 'backups', 'pre-dedupe-by-hand.sqlite'), 'mine');
  for (let i = 1; i <= 7; i++) {
    const saved = backupOnNewVersion(db, { dir, version: `v${i}`, now: new Date(Date.UTC(2026, 8, 24, 12, i)) });
    const t = new Date(Date.UTC(2026, 8, 24, 12, i));
    utimesSync(saved, t, t);
  }
  const left = autos(dir).sort();
  assert.equal(left.length, 5);
  assert.ok(left.every((f) => /before-v[3-7]-/.test(f)), left.join(', '));
  assert.ok(readdirSync(path.join(dir, 'backups')).includes('pre-dedupe-by-hand.sqlite'));
  done();
});

test('if the copy fails, the version is not marked, so the next start tries again', () => {
  const { dir, db, done } = fresh();
  withPeople(db);
  writeFileSync(path.join(dir, 'backups'), 'a file where the folder should be');
  assert.throws(() => backupOnNewVersion(db, { dir, version: '0.2.0' }));
  assert.throws(() => readFileSync(path.join(dir, 'app-version'), 'utf8'));
  done();
});
