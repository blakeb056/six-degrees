// lib/settings.js: what the user chose on the Settings page, stored as one JSON
// object in app_meta so it travels with the data. Each case pins a promise the
// page and the features built on it rely on.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-settings-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, readSettings, writeSettings, SettingsError;

// A stand-in schema: the real one is filled in by the features that add settings.
const SCHEMA = {
  colour: {
    default: 'gold',
    parse(v) {
      if (!['gold', 'purple'].includes(v)) throw new Error('Pick gold or purple.');
      return v;
    },
  },
  size: {
    default: 3,
    parse(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('Size is 1 to 5.');
      return n;
    },
  },
};

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings, SettingsError } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  getDb().exec("DELETE FROM app_meta WHERE key = 'settings'");
});

test('nothing chosen yet reads as the defaults', () => {
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 3 });
});

test('a change is validated, saved, and read back with the rest at their defaults', () => {
  const after = writeSettings(getDb(), { size: '4' }, SCHEMA);
  assert.deepEqual(after, { colour: 'gold', size: 4 });
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 4 });
});

test('a later change keeps the earlier one', () => {
  writeSettings(getDb(), { size: 5 }, SCHEMA);
  writeSettings(getDb(), { colour: 'purple' }, SCHEMA);
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'purple', size: 5 });
});

test('a bad value is refused with its own message, and nothing is written', () => {
  writeSettings(getDb(), { size: 2 }, SCHEMA);
  assert.throws(() => writeSettings(getDb(), { size: 2, colour: 'teal' }, SCHEMA),
    (err) => err instanceof SettingsError && err.message === 'Pick gold or purple.');
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 2 });
});

test('a setting nothing declares is refused, so nothing can plant values', () => {
  assert.throws(() => writeSettings(getDb(), { admin: true }, SCHEMA),
    (err) => err instanceof SettingsError && /no setting called 'admin'/.test(err.message));
});

test('a patch that is not an object is refused', () => {
  for (const bad of [null, 'size=3', [1, 2]]) {
    assert.throws(() => writeSettings(getDb(), bad, SCHEMA), SettingsError);
  }
});

test('a damaged stored value reads as the defaults instead of breaking the page', () => {
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('settings', '{not json')").run();
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 3 });
  // …and the next save repairs it.
  writeSettings(getDb(), { colour: 'purple' }, SCHEMA);
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'purple', size: 3 });
});

test('one stored value that no longer parses falls back to its default alone', () => {
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('settings', ?)").run(JSON.stringify({ colour: 'teal', size: 5 }));
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 5 });
});

test('stored keys a newer version wrote are ignored by an older schema, not crashed on', () => {
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('settings', ?)").run(JSON.stringify({ size: 1, futureThing: 'x' }));
  assert.deepEqual(readSettings(getDb(), SCHEMA), { colour: 'gold', size: 1 });
});

const stored = () => JSON.parse(getDb().prepare("SELECT value FROM app_meta WHERE key = 'settings'").get().value);

test('saving keeps what a newer version wrote, so an older copy cannot erase it', () => {
  // A beta sharing the data folder saved a setting this version doesn't know,
  // and a value for 'colour' this version can't read.
  getDb().prepare("INSERT INTO app_meta (key, value) VALUES ('settings', ?)")
    .run(JSON.stringify({ size: 1, colour: 'teal', futureThing: { on: true } }));
  const after = writeSettings(getDb(), { size: 4 }, SCHEMA);
  assert.deepEqual(after, { colour: 'gold', size: 4 }, 'this version still reads what it knows');
  assert.deepEqual(stored(), { size: 4, colour: 'teal', futureThing: { on: true } },
    'only the changed setting was rewritten');
});

test('a name every object inherits is not a setting', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const patch = JSON.parse(`{"${name}": 1}`);
    assert.throws(() => writeSettings(getDb(), patch, SCHEMA),
      (err) => err instanceof SettingsError && err.message === `There is no setting called '${name}'.`);
  }
});
