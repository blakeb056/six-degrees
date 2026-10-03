// A CSV import kept in the data folder (csv-network.json, lib/csv-store.js):
// it's still there after the window closes and the app restarts, it travels in
// a copy of the network and comes back with an import, × removes it, and a
// file that can't be read is said to be unreadable, never shown as a network
// or passed off as no import (TRAPS §7). The page's own calls (lib/csv.js) go
// through the real route (app/api/data/csv/route.js), loaded as Next loads it
// (tests/helpers/extensionless.mjs). Every person here is invented.

import { test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync, copyFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../db/schema.js';

register('./helpers/extensionless.mjs', import.meta.url);

// Nothing here touches the real data folder, whatever the environment says.
const scratch = mkdtempSync(path.join(tmpdir(), 'six-degrees-csv-kept-'));
const home = path.join(scratch, 'home');
mkdirSync(home);
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(home, 'six-degrees.sqlite');

let route, csv, store, durable, applySchema;
let buildExport, validateImport, stageImport, applyPendingImport, UPLOAD_WORK_PREFIX, PENDING_DIR, CSV_NETWORK_FILE;

// What the page has: its own sessionStorage, and fetch to the app's routes.
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => { session.set(k, String(v)); },
  removeItem: (k) => { session.delete(k); },
};
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push(`${method} ${url}`);
  assert.equal(url, '/api/data/csv', 'the page asks only this route');
  return route[method](new Request(`http://127.0.0.1${url}`, init));
};

before(async () => {
  route = await import('../app/api/data/csv/route.js');
  csv = await import('../lib/csv.js');
  store = await import('../lib/csv-store.js');
  ({ durable } = await import('../lib/durable.js'));
  ({ applySchema } = await import('../lib/db-client.js'));
  ({ buildExport } = await import('../lib/data-export.js'));
  ({ validateImport, stageImport, applyPendingImport } = await import('../lib/data-import.js'));
  ({ UPLOAD_WORK_PREFIX, PENDING_DIR, CSV_NETWORK_FILE } = await import('../lib/data-folder.js'));
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
});

beforeEach(() => {
  session.clear();
  calls.length = 0;
  rmSync(path.join(home, 'csv-network.json'), { recursive: true, force: true });
  rmSync(path.join(home, 'import-pending'), { recursive: true, force: true });
});

const VERSION = '0.6.0';
const folder = (tag) => mkdtempSync(path.join(scratch, `${tag}-`));
const keptFile = (dir = home) => path.join(dir, 'csv-network.json');

/** An invented export in LinkedIn's format: a Notes preamble, then the columns. */
function exportCsv(n, tag = 'a') {
  const first = ['Ava', 'Ben', 'Cleo', 'Dara', 'Eli', 'Fiona'];
  const roles = ['Software Engineer', 'Founder', 'VP of Sales', 'Designer'];
  const cos = ['Northwind Labs', 'Halcyon', 'Meridian Health'];
  const lines = ['Notes:', '"When exporting your connection data, you may notice that some of the email addresses are missing."', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (let i = 0; i < n; i++) {
    lines.push([first[i % 6], `Invented-${tag}${i}`, `https://www.linkedin.com/in/invented-${tag}-${i}`, `invented-${tag}${i}@example.com`,
      cos[i % 3], roles[i % 4], '28 Sep 2026'].join(','));
  }
  return lines.join('\n');
}

const parsed = (n, tag) => csv.parseConnectionsCsv(exportCsv(n, tag)).connections;

// ── kept, and still there after the window closes and the app restarts ──────

test('an import is kept in the data folder and opens again as it was parsed', async () => {
  const connections = parsed(12, 'a');
  const saved = await csv.saveCsvNetwork(connections);
  assert.deepEqual(saved, { ok: true, people: 12 });
  assert.ok(existsSync(keptFile()), 'csv-network.json is in the data folder');

  // A new window: nothing in sessionStorage, and the module's own memory of it gone.
  session.clear();
  const fresh = await import(`../lib/csv.js?window=${Date.now()}`);
  assert.equal(await fresh.csvNetworkSource(), 'csv');
  const open = await fresh.loadCsvNetwork();
  assert.equal(open.source, 'csv');
  assert.deepEqual(open.degree1, connections, 'scored and graded the same as on the import page');
  assert.deepEqual(open.degree2, []);
  assert.equal(await fresh.keptCsvProblem(), null);
});

test('the kept import survives the app restarting: another process reads it from the disk', async () => {
  const connections = parsed(5, 'r');
  assert.equal((await csv.saveCsvNetwork(connections)).ok, true);
  const storeUrl = new URL('../lib/csv-store.js', import.meta.url).href;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { readCsvNetwork } = await import(${JSON.stringify(storeUrl)});
     process.stdout.write(JSON.stringify(readCsvNetwork(${JSON.stringify(home)})));`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { csv: kept, problem } = JSON.parse(run.stdout);
  assert.equal(problem, null);
  assert.equal(kept.people, 5);
  assert.deepEqual(kept.connections, csv.packConnections(connections));
});

test('only what the map needs is kept: never the Email Address column', async () => {
  await csv.saveCsvNetwork(parsed(4, 'e'));
  const text = readFileSync(keptFile(), 'utf8');
  assert.equal(text.includes('@example.com'), false);
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc).sort(), ['columns', 'connections', 'format', 'importedAt', 'source']);
  assert.deepEqual(doc.columns, ['id', 'name', 'role', 'company', 'profile_url', 'connected_date']);
  assert.equal(doc.format, 1);
  const ava = doc.connections.find((r) => r[1] === 'Ava Invented-e0');
  assert.deepEqual(ava.slice(1), ['Ava Invented-e0', 'Software Engineer', 'Northwind Labs', 'https://www.linkedin.com/in/invented-e-0', '2026-09-28']);
  assert.match(ava[0], /^csv-/);
});

test('a new import replaces the one kept before it', async () => {
  await csv.saveCsvNetwork(parsed(6, 'old'));
  await csv.saveCsvNetwork(parsed(3, 'new'));
  const open = await csv.loadCsvNetwork();
  assert.equal(open.degree1.length, 3);
  assert.ok(open.degree1.every((c) => c.name.includes('Invented-new')));
});

test('it is written whole or not at all: a temporary file, synced, renamed over the old one', async () => {
  await csv.saveCsvNetwork(parsed(3, 'w'));
  const before = readFileSync(keptFile(), 'utf8');
  const spy = mock.method(durable, 'writeFileDurably');
  try {
    // A body that isn't an import: refused before anything is written.
    for (const connections of [undefined, [], [['only', 'three', 'cells']], 'text']) {
      const r = await route.POST(new Request('http://127.0.0.1/api/data/csv', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connections }),
      }));
      assert.equal(r.status, 400, JSON.stringify(connections));
      assert.match((await r.json()).error, /can't be kept .*, so nothing was saved\./);
    }
    // A body cut short (Next stops reading at 10 MB): refused too.
    const cut = await route.POST(new Request('http://127.0.0.1/api/data/csv', { method: 'POST', body: '{"connections": [["a",' }));
    assert.equal(cut.status, 400);
    assert.match((await cut.json()).error, /didn't arrive whole/);
    assert.equal(spy.mock.callCount(), 0);
    assert.equal(readFileSync(keptFile(), 'utf8'), before, 'the kept import is untouched');

    await csv.saveCsvNetwork(parsed(2, 'w2'));
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(spy.mock.calls[0].arguments[0], keptFile(), 'through lib/durable.js, which syncs and renames');
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(readdirSync(home).filter((n) => n.includes('.tmp')), [], 'no temporary file left behind');
});

test('nothing is kept while an import from another computer waits for the next start', async () => {
  mkdirSync(path.join(home, 'import-pending'));
  writeFileSync(path.join(home, 'import-pending', 'READY'), JSON.stringify({ people: 3 }));
  const saved = await csv.saveCsvNetwork(parsed(3, 'p'));
  assert.equal(saved.ok, false);
  assert.match(saved.error, /waiting to finish importing/);
  assert.equal(existsSync(keptFile()), false);
});

// ── removed by × ─────────────────────────────────────────────────────────────

test('× removes the kept import from the data folder, and the welcome screen is next', async () => {
  await csv.saveCsvNetwork(parsed(4, 'x'));
  assert.equal(await csv.csvNetworkSource(), 'csv');
  assert.deepEqual(await csv.closeCsvNetwork('csv'), { ok: true });
  assert.equal(existsSync(keptFile()), false);
  assert.equal(await csv.csvNetworkSource(), null);
  assert.equal(await csv.loadCsvNetwork(), null);
  // Removing one that's already gone is fine, and says so.
  const again = await route.DELETE();
  assert.deepEqual(await again.json(), { ok: true, removed: false });
});

test('leaving the sample never removes a kept CSV import', async () => {
  await csv.saveCsvNetwork(parsed(4, 's'));
  csv.saveSampleNetwork({ degree1: [{ id: 'invented-sample-1', name: 'Invented Sample' }], degree2: [] });
  assert.equal(await csv.csvNetworkSource(), 'sample', 'the sample opened in this window is on screen');
  calls.length = 0;
  assert.deepEqual(await csv.closeCsvNetwork('sample'), { ok: true });
  assert.equal(calls.some((c) => c.startsWith('DELETE')), false);
  assert.ok(existsSync(keptFile()));
  assert.equal(await csv.csvNetworkSource(), 'csv');
});

test('importing a CSV closes a sample open in this window, so the map opens on the import', async () => {
  csv.saveSampleNetwork({ degree1: [{ id: 'invented-sample-1', name: 'Invented Sample' }], degree2: [] });
  await csv.saveCsvNetwork(parsed(3, 'i'));
  const open = await csv.loadCsvNetwork();
  assert.equal(open.source, 'csv');
  assert.equal(open.degree1.length, 3);
});

test('the sample stays in this window only: never in the data folder', async () => {
  csv.saveSampleNetwork({ degree1: [{ id: 'invented-sample-1', name: 'Invented Sample' }], degree2: [] });
  assert.equal((await csv.loadCsvNetwork()).source, 'sample');
  assert.equal(existsSync(keptFile()), false);
  assert.equal(calls.some((c) => c.startsWith('POST')), false);
});

// ── a file that can't be read ────────────────────────────────────────────────

test('no file is no import, with nothing to say', async () => {
  assert.deepEqual(store.readCsvNetwork(home), { csv: null, problem: null });
  assert.deepEqual(await (await route.GET()).json(), { csv: null, problem: null });
  assert.equal(await csv.keptCsvProblem(), null);
});

test('a damaged or strange file is never shown as a network, and the welcome screen says why', async () => {
  const good = (connections) => JSON.stringify({ format: 1, source: 'csv', importedAt: '2026-10-03T12:00:00.000Z', columns: [], connections });
  const row = (id, extra = {}) => {
    const r = [id, `Invented ${id}`, 'Designer', 'Halcyon', `https://www.linkedin.com/in/${id}`, '2026-09-28'];
    for (const [i, v] of Object.entries(extra)) r[i] = v;
    return r;
  };
  const cases = {
    'not JSON at all': ['{"format": 1, "connections": [', /isn't readable JSON/],
    'a list, not an object': ['[1, 2, 3]', /isn't what Six Degrees writes/],
    'no format': [JSON.stringify({ connections: [row('a')] }), /isn't what Six Degrees writes/],
    'from a newer version': [JSON.stringify({ format: 2, importedAt: '2026-10-03T12:00:00.000Z', connections: [row('a')] }), /written by a newer Six Degrees/],
    'no date it was imported': [JSON.stringify({ format: 1, connections: [row('a')] }), /doesn't say when/],
    'nobody in it': [good([]), /nobody in it/],
    'a row cut short': [good([row('a'), ['b', 'Invented b']]), /person 2 isn't laid out/],
    'a person with no name': [good([row('a', { 1: '  ' })]), /person 1 has a name or id that is missing/],
    'a company that is a number': [good([row('a', { 3: 7 })]), /person 1 has a position or company/],
    'a date that is not one': [good([row('a', { 5: 'yesterday' })]), /person 1 has a date that isn't one/],
    'two people with one id': [good([row('a'), row('a')]), /two people share the id/],
  };
  for (const [name, [text, why]] of Object.entries(cases)) {
    writeFileSync(keptFile(), text);
    const read = store.readCsvNetwork(home);
    assert.equal(read.csv, null, name);
    assert.match(read.problem, why, name);
    const answer = await route.GET();
    assert.equal(answer.status, 200, name);
    const body = await answer.json();
    assert.equal(body.csv, null, name);
    assert.match(body.problem, /^Your kept CSV import couldn't be read: .+\. Import Connections\.csv again to replace it\.$/, name);
    // A new window: the map shows no import, and the CSV card says why.
    const fresh = await import(`../lib/csv.js?case=${encodeURIComponent(name)}`);
    assert.equal(await fresh.loadCsvNetwork(), null, name);
    assert.equal(await fresh.csvNetworkSource(), null, name);
    assert.match(await fresh.keptCsvProblem(), why, name);
  }
  // A folder, or a link to a file somewhere else, is never read as one.
  rmSync(keptFile(), { force: true });
  mkdirSync(keptFile());
  assert.match(store.readCsvNetwork(home).problem, /isn't a plain file/);
  rmSync(keptFile(), { recursive: true });
  const elsewhere = path.join(folder('elsewhere'), 'net.json');
  writeFileSync(elsewhere, good([row('a')]));
  symlinkSync(elsewhere, keptFile());
  assert.match(store.readCsvNetwork(home).problem, /isn't a plain file/);
  // A new import replaces a file that couldn't be read.
  rmSync(keptFile());
  writeFileSync(keptFile(), 'not JSON');
  assert.equal((await csv.saveCsvNetwork(parsed(2, 'fix'))).ok, true);
  assert.equal(store.readCsvNetwork(home).csv.people, 2);
});

test('an answer the app couldn\'t give is said too, and never taken for no import', async () => {
  const fresh = await import(`../lib/csv.js?refused=${Date.now()}`);
  const real = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'server is not bound to loopback and no ADMIN_TOKEN is configured' }, { status: 503 });
  try {
    assert.equal(await fresh.loadCsvNetwork(), null);
    assert.match(await fresh.keptCsvProblem(), /couldn't be loaded \(server is not bound to loopback/);
  } finally {
    globalThis.fetch = real;
  }
});

// ── it travels in a copy of the network, and an import brings it back ───────

const checks = { applySchema: (db) => applySchema(db), schemaSql: SCHEMA_SQL, appVersion: VERSION };
const dbIn = (dir) => path.join(dir, 'six-degrees.sqlite');

/** A data folder with an empty network (as when someone has only imported a CSV), and that CSV kept. */
function folderWithCsv(tag, people) {
  const dir = folder(`net-${tag}`);
  const db = new DatabaseSync(dbIn(dir));
  applySchema(db);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(`${tag}-me`, 'You');
  if (people) store.writeCsvNetwork(dir, csv.packConnections(parsed(people, tag)), { now: new Date('2026-10-03T12:00:00Z') });
  return { dir, db };
}

function exportFrom(dir, db) {
  const out = path.join(folder('out'), 'copy.sixdegrees');
  buildExport(db, { dir, outFile: out, appVersion: VERSION, schemaSql: SCHEMA_SQL, now: new Date('2026-10-03T13:00:00Z') });
  db.close();
  return out;
}

const filesIn = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT path FROM sd_export_files ORDER BY path').all().map((r) => r.path); } finally { db.close(); }
};

function importInto(dir, file) {
  const work = mkdtempSync(path.join(dir, UPLOAD_WORK_PREFIX));
  const upload = path.join(work, 'upload.sixdegrees');
  copyFileSync(file, upload);
  stageImport(upload, { dir, ...checks, now: new Date('2026-10-03T14:00:00Z') });
  return applyPendingImport({ dir, dbFile: dbIn(dir), now: new Date('2026-10-03T15:00:00Z') });
}

test('a copy of the network carries the kept CSV import, and the import checks pass it', () => {
  assert.equal(CSV_NETWORK_FILE, 'csv-network.json');
  const { dir, db } = folderWithCsv('b', 7);
  const out = exportFrom(dir, db);
  assert.deepEqual(filesIn(out), ['csv-network.json']);
  const info = validateImport(out, checks);
  assert.equal(info.files, 1);
});

test('an import brings the CSV back exactly, and what was kept here goes to backups/ first', () => {
  const from = folderWithCsv('c', 9);
  const copy = exportFrom(from.dir, from.db);
  const here = folderWithCsv('d', 4);
  here.db.close();

  const done = importInto(here.dir, copy);
  assert.equal(readFileSync(keptFile(here.dir), 'utf8'), readFileSync(keptFile(from.dir), 'utf8'), 'byte for byte');
  const back = store.readCsvNetwork(here.dir);
  assert.equal(back.problem, null);
  assert.equal(back.csv.people, 9);
  assert.ok(back.csv.connections.every((r) => r[1].includes('Invented-c')));
  // This computer's import is kept beside the network it belonged to.
  const kept = JSON.parse(readFileSync(path.join(here.dir, done.keptFiles, 'csv-network.json'), 'utf8'));
  assert.equal(kept.connections.length, 4);
  assert.equal(existsSync(path.join(here.dir, PENDING_DIR)), false);
});

test('a copy made without a CSV import replaces this computer\'s with none, keeping it in backups/', () => {
  const from = folderWithCsv('e', 0);
  const copy = exportFrom(from.dir, from.db);
  assert.deepEqual(filesIn(copy), []);
  const here = folderWithCsv('f', 3);
  here.db.close();

  const done = importInto(here.dir, copy);
  assert.equal(existsSync(keptFile(here.dir)), false, 'replace, never merge: the copy had no CSV');
  assert.ok(existsSync(path.join(here.dir, done.keptFiles, 'csv-network.json')));
});

test('an import whose CSV file was changed after it was made is refused by its checksum', async () => {
  const { sha256 } = await import('../lib/data-export.js');
  const { dir, db } = folderWithCsv('g', 3);
  const out = exportFrom(dir, db);
  const x = new DatabaseSync(out);
  x.prepare("UPDATE sd_export_files SET bytes = ? WHERE path = 'csv-network.json'").run(Buffer.from('{"format":1}'));
  x.close();
  assert.throws(() => validateImport(out, checks), /“csv-network\.json” inside this file is damaged/);
  // With the checksum forged to match, it is still only ever read through the
  // same checks as the file here: a copy that isn't a JSON object is refused.
  const y = new DatabaseSync(out);
  const list = Buffer.from('[1, 2]');
  y.prepare("UPDATE sd_export_files SET bytes = ?, sha256 = ? WHERE path = 'csv-network.json'").run(list, sha256(list));
  y.close();
  assert.throws(() => validateImport(out, checks), /“csv-network\.json” inside this file can't be read/);
});

// ── only on this computer ────────────────────────────────────────────────────

test('the route answers only on this computer, and refuses another site\'s writes', async () => {
  const { requestRefusal, isDestructive } = await import('../lib/gate.js');
  assert.equal(isDestructive('/api/data/csv'), true);
  const req = (method, headers, env) => ({ method, pathname: '/api/data/csv', headers: new Headers(headers), env });
  const local = { SIX_DEGREES_BIND: '127.0.0.1' };
  assert.equal(requestRefusal(req('POST', { host: '127.0.0.1:6363', 'sec-fetch-site': 'same-origin' }, local)), null);
  assert.equal(requestRefusal(req('GET', { host: 'localhost:6363' }, local)), null);
  for (const method of ['POST', 'DELETE']) {
    assert.equal(requestRefusal(req(method, { host: '127.0.0.1:6363', 'sec-fetch-site': 'cross-site' }, local)).status, 403, method);
  }
  assert.equal(requestRefusal(req('GET', { host: 'evil.example' }, local)).status, 421, 'a rebound read');
  // Bound anywhere else, a header can't buy access (TRAPS §2): reads included.
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal(requestRefusal(req(method, { host: 'localhost:6363', 'x-forwarded-for': '127.0.0.1' }, { SIX_DEGREES_BIND: '0.0.0.0' })).status, 503, method);
  }
});
