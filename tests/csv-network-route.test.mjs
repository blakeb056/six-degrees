// A Connections.csv import through its two routes (app/api/data/network:
// the preview, and /apply: Import), as the guided setup and the Import page
// call them (lib/csv.js previewCsvImport, applyCsvImport). The routes load as
// Next loads them (tests/helpers/extensionless.mjs).
//
// What they promise: the preview changes nothing and says what would happen,
// with the people who had no profile link counted; Import merges and never
// removes anyone; both refuse with a plain reason while a scan runs or an
// import waits; and once imported, it's your own network, with the same header
// as a scanned one (Blake, 2026-10-13: "the csv they import is to build off of").
// Every person here is invented, on made-up profile links.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const home = mkdtempSync(path.join(tmpdir(), 'sixgree-csv-network-route-'));
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(home, 'six-degrees.sqlite');

let stageRoute, applyRoute, csvRoute, ingestRoute, csv, getDb, gate;
const SCAN_STATE = Symbol.for('six-degrees.scan-state');

// What the page has: fetch to the app's own routes.
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push(`${method} ${url}`);
  const route = { '/api/data/network': stageRoute, '/api/data/network/apply': applyRoute, '/api/data/csv': csvRoute }[url];
  assert.ok(route, `the page asks only its own routes, not ${url}`);
  return route[method](new Request(`http://127.0.0.1${url}`, init));
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

before(async () => {
  stageRoute = await import('../app/api/data/network/route.js');
  applyRoute = await import('../app/api/data/network/apply/route.js');
  csvRoute = await import('../app/api/data/csv/route.js');
  ingestRoute = await import('../app/api/ingest/route.js');
  csv = await import('../lib/csv.js');
  ({ getDb } = await import('../lib/db-client.js'));
  gate = await import('../lib/gate.js');
  getDb();
  process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* the system's temp cleanup */ } });
});

beforeEach(() => {
  getDb().exec("DELETE FROM linkedin_connections; DELETE FROM users; DELETE FROM notifications; DELETE FROM app_meta WHERE key <> 'settings';");
  rmSync(path.join(home, 'import-pending'), { recursive: true, force: true });
  rmSync(path.join(home, 'backups'), { recursive: true, force: true });
  for (const n of readdirSync(home)) if (n.startsWith('.network-stage-')) rmSync(path.join(home, n), { recursive: true, force: true });
  delete globalThis[SCAN_STATE];
  calls.length = 0;
});

const link = (slug) => `https://www.linkedin.com/in/${slug}`;
const stored = (slug) => `${link(slug)}/`;

function csvText(rows) {
  const lines = ['Notes:', '"When exporting your connection data, you may notice that some of the email addresses are missing."', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (const [first, last, slug, company, position] of rows) {
    lines.push([first, last, slug ? link(slug) : '', '', company, position, '28 Sep 2026'].join(','));
  }
  return lines.join('\n');
}
const parsed = (rows) => csv.parseConnectionsCsv(csvText(rows)).connections;

const FIRST = [
  ['Ava', 'Quill', 'invented-ava-quill', 'Northwind Labs', 'Chief Executive Officer'],
  ['Ben', 'Marsh', 'invented-ben-marsh', 'Halcyon', 'Founder'],
  ['Cleo', 'Dune', 'invented-cleo-dune', 'Meridian Health', 'Designer'],
  ['Nolan', 'Nolink', '', 'Halcyon', 'Recruiter'],
  ['Nadia', 'Nolink', '', 'Cobalt Studio', 'Analyst'],
];

const post = (route, url, body, method = 'POST') => route[method](new Request(`http://127.0.0.1${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const people = () => getDb().prepare('SELECT * FROM linkedin_connections ORDER BY profile_url').all();
const stagesLeft = () => readdirSync(home).filter((n) => n.startsWith('.network-stage-'));
const scanning = (action = 'full') => { globalThis[SCAN_STATE] = { running: true, action }; };

// ── preview, then Import ─────────────────────────────────────────────────────

test('the preview says what importing would do, counts who had no profile link, and changes nothing', async () => {
  const preview = await csv.previewCsvImport(parsed(FIRST));
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.counts, { add: 3, update: 0, promote: 0, unchanged: 0 });
  assert.deepEqual(preview.leftOut, { no_profile_link: 2 });
  assert.equal(preview.received, 5);
  assert.equal(preview.repeated, 0);
  assert.equal(preview.network, 0);
  assert.match(preview.stage, /^[A-Za-z0-9]{6}$/);
  assert.deepEqual(people(), [], 'nothing imported yet');
  assert.deepEqual(stagesLeft(), [`.network-stage-${preview.stage}`]);
  // In words, the way both doors show it.
  assert.deepEqual(csv.importLines(preview).map((l) => l.text), [
    '3 new connections',
    '2 people had no profile link, so were left out',
  ]);
});

test('Import puts them in your network: canonical links, scored, tiers before and after, and the preview gone', async () => {
  const preview = await csv.previewCsvImport(parsed(FIRST));
  const done = await csv.applyCsvImport(preview.stage);
  assert.equal(done.ok, true, done.error);
  assert.deepEqual(done.counts, { add: 3, update: 0, promote: 0, unchanged: 0 });
  assert.deepEqual(done.leftOut, { no_profile_link: 2 });
  assert.equal(done.network, 3);
  assert.equal(done.backup, null, 'an empty network has nothing to lose, so nothing to back up');
  assert.deepEqual(done.rescored, { ok: true });
  assert.deepEqual(done.tiers.before, { S: 0, A: 0, B: 0, C: 0, D: 0 });
  assert.equal(Object.values(done.tiers.after).reduce((a, b) => a + b, 0), 3);
  const rows = people();
  assert.deepEqual(rows.map((r) => [r.profile_url, r.degree, r.headline]), [
    [stored('invented-ava-quill'), 1, 'Chief Executive Officer at Northwind Labs'],
    [stored('invented-ben-marsh'), 1, 'Founder at Halcyon'],
    [stored('invented-cleo-dune'), 1, 'Designer at Meridian Health'],
  ]);
  const me = getDb().prepare('SELECT id FROM users').all();
  assert.equal(me.length, 1, 'into the one profile that is you');
  assert.ok(rows.every((r) => r.user_id === me[0].id && r.tier));
  assert.deepEqual(stagesLeft(), []);
  assert.deepEqual(csv.importLines(done, { done: true }).map((l) => l.key), ['add', 'noLink']);
  // The same preview can't be imported twice.
  const again = await csv.applyCsvImport(preview.stage);
  assert.equal(again.ok, false);
  assert.equal(again.status, 410);
  assert.match(again.error, /That preview has expired, so nothing was imported/);
  // No CSV is kept beside the database any more, and no stand-in identity: it's your own network.
  assert.equal(existsSync(path.join(home, 'csv-network.json')), false);
  assert.ok(calls.every((c) => !c.startsWith('POST /api/data/csv')));
});

test('a second import merges: a new person added, a changed job brought up to date, nobody removed, a backup first', async () => {
  await csv.applyCsvImport((await csv.previewCsvImport(parsed(FIRST))).stage);
  const before = people();
  const next = [
    ['Ava', 'Quill', 'invented-ava-quill', 'Northwind Labs', 'Chief Executive Officer'],
    ['Ben', 'Marsh', 'invented-ben-marsh', 'Ironwood Capital', 'Partner'],   // a new job
    ['Dara', 'Vale', 'invented-dara-vale', 'Cobalt Studio', 'Director of Design'],   // new
    // Cleo isn't in this export at all: she stays.
  ];
  const preview = await csv.previewCsvImport(parsed(next));
  assert.deepEqual(preview.counts, { add: 1, update: 1, promote: 0, unchanged: 1 });
  assert.equal(preview.network, 3);
  const done = await csv.applyCsvImport(preview.stage);
  assert.deepEqual(done.counts, { add: 1, update: 1, promote: 0, unchanged: 1 });
  assert.match(done.backup.name, /^before-import-/);
  assert.equal(done.network, 4);
  const after = people();
  assert.equal(after.length, 4);
  for (const r of before) assert.ok(after.some((a) => a.id === r.id), `${r.name} is still there, same id`);
  assert.equal(after.find((r) => r.name === 'Ben Marsh').headline, 'Partner at Ironwood Capital', 'an export\'s own row takes the new job');
  assert.deepEqual(csv.importLines(done, { done: true }).map((l) => l.text), [
    '1 new connection', '1 already here, brought up to date', '1 already here and up to date',
  ]);
});

test('Choose another file drops the preview at once', async () => {
  const preview = await csv.previewCsvImport(parsed(FIRST));
  assert.equal(stagesLeft().length, 1);
  await csv.dropCsvPreview(preview.stage);
  assert.deepEqual(stagesLeft(), []);
  // A name that isn't a stage is never a path.
  const res = await post(stageRoute, '/api/data/network', { stage: '../../etc' }, 'DELETE');
  assert.deepEqual(await res.json(), { ok: true, removed: false });
});

// ── refusals ─────────────────────────────────────────────────────────────────

test('409 with a plain reason while a scan runs or an import waits: nothing staged, nothing imported', async () => {
  const preview = await csv.previewCsvImport(parsed(FIRST));
  scanning('full');
  const staged = await post(stageRoute, '/api/data/network', { connections: csv.packConnections(parsed(FIRST)) });
  assert.equal(staged.status, 409);
  assert.match((await staged.json()).error, /^A scan is running\. Let it finish/);
  const applied = await csv.applyCsvImport(preview.stage);
  assert.equal(applied.status, 409);
  assert.match(applied.error, /^A scan is running/);
  scanning('login');
  assert.match((await (await post(stageRoute, '/api/data/network', { connections: [] })).json()).error, /^The LinkedIn sign-in window is open/);
  delete globalThis[SCAN_STATE];

  mkdirSync(path.join(home, 'import-pending'));
  writeFileSync(path.join(home, 'import-pending', 'READY'), JSON.stringify({ people: 9 }));
  const waiting = await post(stageRoute, '/api/data/network', { connections: csv.packConnections(parsed(FIRST)) });
  assert.equal(waiting.status, 409);
  assert.match((await waiting.json()).error, /already waiting to finish/);
  const late = await csv.applyCsvImport(preview.stage);
  assert.equal(late.status, 409);
  assert.deepEqual(people(), []);
  assert.deepEqual(stagesLeft(), [`.network-stage-${preview.stage}`], 'the preview stays, for when it\'s done');
});

test('a body that isn\'t an import is a 400; a file with nobody linkable a 422; a stage that isn\'t one a 400', async () => {
  const cut = await post(stageRoute, '/api/data/network', '{"connections": [["a",');
  assert.equal(cut.status, 400);
  assert.match((await cut.json()).error, /didn't arrive whole/);
  for (const connections of [undefined, [], 'text', [['only', 'three', 'cells']]]) {
    const r = await post(stageRoute, '/api/data/network', { connections });
    assert.equal(r.status, 400, JSON.stringify(connections));
    assert.match((await r.json()).error, /^This file can't be imported \(.+\), so nothing was read\.$/);
  }
  const nobody = await csv.previewCsvImport(parsed([['Nolan', 'Nolink', '', 'Halcyon', 'Recruiter']]));
  assert.equal(nobody.status, 422);
  assert.match(nobody.error, /Nobody in this file has a profile link/);
  for (const stage of [undefined, '', '../x', 'abc', '.network-stage-abcdef', 'abcdef/..']) {
    const r = await post(applyRoute, '/api/data/network/apply', { stage });
    assert.equal(r.status, 400, String(stage));
  }
  assert.equal((await post(applyRoute, '/api/data/network/apply', { stage: 'Zz9Zz9' })).status, 410);
  assert.deepEqual(people(), []);
  assert.deepEqual(stagesLeft(), []);
});

test('both routes answer only on this computer, and refuse another site\'s writes', () => {
  const { requestRefusal, isDestructive } = gate;
  const req = (method, pathname, headers, env = { SIX_DEGREES_BIND: '127.0.0.1' }) => ({ method, pathname, headers: new Headers(headers), env });
  for (const p of ['/api/data/network', '/api/data/network/apply']) {
    assert.equal(isDestructive(p), true, p);
    assert.equal(requestRefusal(req('POST', p, { host: '127.0.0.1:6363', 'sec-fetch-site': 'same-origin' })), null, p);
    assert.equal(requestRefusal(req('POST', p, { host: '127.0.0.1:6363', 'sec-fetch-site': 'cross-site' })).status, 403, p);
    assert.equal(requestRefusal(req('POST', p, { host: 'evil.example', 'sec-fetch-site': 'same-origin' })).status, 421, p);
    // Bound anywhere else, a header can't buy access (TRAPS §2).
    assert.equal(requestRefusal(req('POST', p, { host: 'localhost:6363', 'x-forwarded-for': '127.0.0.1' }, { SIX_DEGREES_BIND: '0.0.0.0' })).status, 503, p);
  }
});

// ── once it's in, it's your own network ──────────────────────────────────────

const ingest = (connections, type = 'degree1') => post(ingestRoute, '/api/ingest', { connections, type, userId: getDb().prepare('SELECT id FROM users').get()?.id });

test('a network from a CSV is your own network: every page opens on it, with the same header as a scanned one', async () => {
  await csv.applyCsvImport((await csv.previewCsvImport(parsed(FIRST))).stage);
  // What every page asks first (lib/csv.js): no kept CSV, and your connections in the database.
  const opening = await (await csvRoute.GET()).json();
  assert.deepEqual(opening, { csv: null, scanned: 3, problem: null });
  assert.equal(csv.openNetworkSource({ csvKept: Boolean(opening.csv), scannedFirstDegree: opening.scanned }), 'own');
  assert.equal(await csv.csvNetworkSource(), null, 'no CSV mode: your own profile, your own header');
  // The header keys what scans on your own network alone (not the demo, not the
  // sample or a kept CSV), never on where the network came from; and, since the
  // scanner became plugins, on which scanner is installed
  // (lib/scanner-capabilities.js), which says nothing of where it came from either.
  const header = readFileSync(new URL('../app/components/AppHeader.js', import.meta.url), 'utf8');
  assert.match(header, /const own = !IS_DEMO && !csvMode;/);
  // Auto scan also only while circle scans run Automatic, never By hand (tests/circle-mode.test.mjs): on purpose.
  assert.match(header, /const autoScan = auto && mode !== 'manual';/);
  assert.match(header, /after=\{own && autoScan \? <AutoScanButton/);
  assert.match(header, /\{own && auto && <RefreshButton/);
  assert.doesNotMatch(header, /fromExport|network-origin/);
  const tabs = readFileSync(new URL('../app/components/AppTabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /p\.own \? !csvMode && \(scanner \|\| !p\.scanner\) && \(browser \|\| !p\.browser\) : true/);
  // And the scanner reading it later finds the people the CSV put there: nobody twice.
  const res = await ingest([{ name: 'Ava Quill', headline: 'Chief Executive Officer at Northwind Labs', profileUrl: stored('invented-ava-quill') }]);
  assert.equal((await res.json()).alreadyKnown, 1);
  assert.equal(people().length, 3);
});

test('a CSV imported into a scanned network fills only what\'s blank, and adds who\'s missing', async () => {
  getDb().prepare("INSERT INTO users (id, name) VALUES ('me-scanned', 'You')").run();
  await ingest([{ name: 'Ava Quill', headline: 'Builds engines', profileUrl: stored('invented-ava-quill') }]);
  const done = await csv.applyCsvImport((await csv.previewCsvImport(parsed(FIRST))).stage);
  assert.deepEqual(done.counts, { add: 2, update: 1, promote: 0, unchanged: 0 });
  assert.equal(people().find((r) => r.name === 'Ava Quill').headline, 'Builds engines', 'what the scan read stays');
  assert.equal(people().length, 3);
});
