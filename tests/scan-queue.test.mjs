// The scanner's queue (lib/scan-queue.js, app/api/scraper/route.js). Blake,
// 2026-10-05: "if someone auto connects but theres one already being added i
// want a queue thing to basically let the next person they want to add or
// bridge be queued in the scanner and have it shown in the notch."
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python, writes down each run's arguments, and
// sleeps as long as a file says. Nothing opens a browser or reaches LinkedIn.
// A temporary data folder, never the real one. Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  QUEUE_CAP, emptyQueue, enqueue, nextUp, removeItem, skipItem, clearQueue, queueView, placeOf, ordinal, cleanQueue,
} from '../lib/scan-queue.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scan-queue-'));
const HOME = path.join(dir, 'home');
const RUNS = path.join(dir, 'runs.txt');
const SLEEP = path.join(dir, 'sleep.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
// No breath between jobs here: the test waits for each end itself.
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do case "$a" in --connect=*|--bridge-url=*) printf '%s\\n' "$a" >> '${RUNS}';; esac; done`,
  `[ -f '${SLEEP}' ] && sleep "$(cat '${SLEEP}')"`,
  'echo "Saved."',
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

const QUEUE_KEY = Symbol.for('six-degrees.scan-queue');
let GET, POST, getDb, writeSettings;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (slug) => `https://www.linkedin.com/in/${slug}`;
const PEOPLE = ['oriel-vantasse', 'maren-holt', 'tobin-ashgrove', 'liesel-marchbank', 'cato-wrenfield', 'ines-farrow',
  'ruben-hallard', 'saskia-thorne', 'emrys-calder', 'odile-brask', 'piet-langmore', 'wren-dossel'];
const idOf = (slug) => `p-${slug.split('-')[0]}`;
const nameOf = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const post = (body) => POST(new Request('http://127.0.0.1:3498/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3498' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const runs = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean) : []);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `ok()` holds, or fail saying what was waited for. */
async function until(ok, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await pause(25);
  }
  assert.fail(`waited for ${what}`);
}
/** Nothing runs, and nothing waits to run unless paused. */
const settled = async () => {
  const j = await job();
  return !j.running && (j.queue.paused || j.queue.waiting === 0);
};

beforeEach(async () => {
  await until(settled, 'the last test’s jobs to end');
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  for (const f of [RUNS, SLEEP, path.join(HOME, 'linkedin-activity.json'), path.join(HOME, 'linkedin-cooldown.json'), path.join(HOME, 'scan-queue.json')]) rmSync(f, { force: true });
  delete globalThis[QUEUE_KEY];
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z', autoConnectAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url, source_connection_id, unlock_status, outreach_status)
                          VALUES (?, 'me', ?, ?, 'A', ?, ?, ?, ?)`);
  for (const slug of PEOPLE) add.run(idOf(slug), 1, nameOf(slug), url(slug), null, null, null);
  add.run('d2-ada@oriel', 2, 'Ada Quill', url('ada-quill'), 'p-oriel', 'locked', null);
  add.run('d2-bo@oriel', 2, 'Bo Lindqvist', url('bo-lindqvist'), 'p-oriel', 'locked', null);
});

/** Start a scan of Oriel's circle that lasts `seconds`. */
async function startLong(seconds = 1) {
  writeFileSync(SLEEP, String(seconds));
  const res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(!d.queued, 'nothing ran, so it started');
  await until(async () => (await job()).running, 'the scan to start');
}

// ---- the queue itself, without a scanner ----

test('ordinals, for "Queued · 2nd"', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 102].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '102nd']);
});

test('enqueue: places in order, the same request once, never what runs, and a cap', () => {
  const q = emptyQueue();
  const item = (action, id) => ({ id: `q-${action}-${id}`, action, target: { id, name: id }, request: { action, id }, at: 1 });
  const running = { action: 'bridge', target: { id: 'p-oriel' } };
  assert.deepEqual(enqueue(q, item('connect', 'd2-ada'), running), { queued: true, place: 1 });
  assert.deepEqual(enqueue(q, item('bridge', 'p-maren'), running), { queued: true, place: 2 });
  // The same person for the same thing: ignored, wherever it's pressed. A Resume is the same circle.
  assert.deepEqual(enqueue(q, item('connect', 'd2-ada'), running), { duplicate: true, place: 1 });
  assert.deepEqual(enqueue(q, item('resume', 'p-maren'), running), { duplicate: true, place: 2 });
  assert.deepEqual(enqueue(q, item('rescrape', 'p-oriel'), running), { duplicate: true, running: true });
  // Their circle and a request to them are two things.
  assert.deepEqual(enqueue(q, item('bridge', 'd2-ada'), running), { queued: true, place: 3 });
  // Only Auto and one person's circle queue.
  assert.deepEqual(enqueue(q, item('full', 'p-x'), running), { refused: true });
  for (let i = q.items.length; i < QUEUE_CAP; i++) assert.equal(enqueue(q, item('bridge', `p-${i}`), running).queued, true);
  assert.deepEqual(enqueue(q, item('bridge', 'p-one-more'), running), { full: true });
  assert.equal(placeOf(queueView(q), 'resume', 'p-maren'), 2);
  assert.equal(placeOf(queueView(q), 'connect', 'p-maren'), null);
});

test('next up, skipped, removed, cleared, and what the page sees', () => {
  const q = emptyQueue();
  for (const id of ['a', 'b', 'c']) enqueue(q, { id, action: 'connect', target: { id, name: id.toUpperCase() }, request: { action: 'connect', id, secret: 'kept here' }, at: 1 });
  assert.equal(nextUp(q).id, 'a');
  skipItem(q, 'a', 'Auto has sent 15 requests in the last 24 hours.');
  assert.equal(nextUp(q).id, 'b');
  const view = queueView(q);
  assert.deepEqual(view.items.map((i) => [i.id, i.status]), [['b', 'waiting'], ['c', 'waiting'], ['a', 'skipped']]);
  assert.equal(view.items[2].reason, 'Auto has sent 15 requests in the last 24 hours.');
  assert.equal(view.waiting, 2);
  assert.ok(!('request' in view.items[0]), 'what a start sends stays on the server');
  // A new press for a skipped one takes its place.
  assert.equal(enqueue(q, { id: 'a2', action: 'connect', target: { id: 'a' }, request: {}, at: 2 }).place, 3);
  assert.equal(q.items.filter((i) => i.target.id === 'a').length, 1);
  q.paused = 'stopped';
  assert.equal(nextUp(q), null, 'paused: nothing starts');
  assert.equal(removeItem(q, 'b'), true);
  assert.equal(removeItem(q, 'b'), false);
  clearQueue(q);
  assert.deepEqual(q, emptyQueue());
  // Read back from a file: only what this writes.
  assert.deepEqual(cleanQueue({ paused: 3, items: [{ id: 'x', action: 'full', target: { id: 'p' } }, { id: 'y', action: 'connect', target: { id: 'p', name: 'P' }, status: 'odd' }] }).items.map((i) => [i.id, i.status]), [['y', 'waiting']]);
});

// ---- through the app, with a stand-in scanner ----

test('pressed while a scan runs: Auto and a circle are queued, not refused, and say their place', async () => {
  await startLong(1);
  let res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 200);
  let d = await res.json();
  assert.equal(d.queued, true);
  assert.equal(d.place, 1);
  res = await post({ action: 'bridge', id: 'p-maren', name: 'Maren Holt' });
  d = await res.json();
  assert.equal(d.place, 2);
  // Duplicates are ignored: the same request again, and what is running now.
  d = await (await post({ action: 'connect', id: 'd2-ada@oriel' })).json();
  assert.deepEqual([d.queued, d.duplicate, d.place], [true, true, 1]);
  d = await (await post({ action: 'bridge', id: 'p-oriel' })).json();
  assert.deepEqual([d.duplicate, d.running], [true, true]);
  const q = (await job()).queue;
  assert.equal(q.waiting, 2);
  assert.deepEqual(q.items.map((i) => [i.kind, i.target.name]), [['add', 'Ada Quill'], ['circle', 'Maren Holt']]);
  // Anything else is still refused while one runs, and a name-only scan too.
  res = await post({ action: 'full' });
  assert.equal(res.status, 409);
  res = await post({ action: 'bridge', name: 'Tobin Ashgrove' });
  assert.equal(res.status, 409);

  // When it ends, the next starts by itself, and the one after.
  await until(async () => runs().length === 3 && (await settled()), 'the queue to run');
  assert.deepEqual(runs(), [`--bridge-url=${url('oriel-vantasse')}`, `--connect=${url('ada-quill')}`, `--bridge-url=${url('maren-holt')}`]);
  const done = await job();
  assert.equal(done.queue.items.length, 0, 'each one leaves the queue as it starts');
  assert.deepEqual(done.recent.slice(0, 3).map((j) => j.action), ['bridge', 'connect', 'bridge']);
});

test('the queue holds at most ten; the eleventh is refused, saying so', async () => {
  await startLong(1);
  const ids = PEOPLE.slice(1).map(idOf);   // eleven, not Oriel, whose scan runs
  for (const id of ids.slice(0, QUEUE_CAP)) assert.equal((await (await post({ action: 'bridge', id })).json()).queued, true);
  const res = await post({ action: 'bridge', id: ids[QUEUE_CAP] });
  assert.equal(res.status, 409);
  const d = await res.json();
  assert.equal(d.queueFull, true);
  assert.match(d.error, /queue is full: 10/);
  // Done with it: cleared, so the next test starts empty.
  await post({ action: 'queue-clear' });
  assert.equal((await job()).queue.items.length, 0);
});

test('each one meets every check at its own start: a refusal skips it with the reason, and the queue moves on', async () => {
  await startLong(1);
  await post({ action: 'connect', id: 'd2-ada@oriel' });
  await post({ action: 'connect', id: 'd2-bo@oriel' });
  await post({ action: 'bridge', id: 'p-maren' });
  // Auto's cap is reached while the scan runs: 15 requests in the last 24 hours.
  const now = Date.now() / 1000;
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({
    searches: [], profiles: [], invites: Array.from({ length: 15 }, (_, i) => now - 60 * (i + 1)),
  }));
  await until(async () => runs().length === 2 && (await settled()), 'the queue to run');
  assert.deepEqual(runs(), [`--bridge-url=${url('oriel-vantasse')}`, `--bridge-url=${url('maren-holt')}`], 'neither request went');
  const q = (await job()).queue;
  assert.deepEqual(q.items.map((i) => [i.target.name, i.status]), [['Ada Quill', 'skipped'], ['Bo Lindqvist', 'skipped']]);
  assert.match(q.items[0].reason, /15/);
  // Auto's one-time yes is checked again too.
  rmSync(RUNS, { force: true });
  rmSync(path.join(HOME, 'linkedin-activity.json'), { force: true });
  await post({ action: 'queue-clear' });
  await startLong(1);
  await post({ action: 'connect', id: 'd2-ada@oriel' });
  writeSettings(getDb(), { autoConnectAccepted: null });
  await until(async () => (await job()).queue.items[0]?.status === 'skipped', 'Ada to be skipped');
  assert.equal(runs().length, 1);
  await post({ action: 'queue-clear' });
});

test('Stop stops the running job and holds the queue; Resume queue carries on, Clear empties it', async () => {
  await startLong(2);
  await post({ action: 'bridge', id: 'p-maren' });
  await post({ action: 'bridge', id: 'p-tobin' });
  assert.equal((await (await post({ action: 'cancel' })).json()).cancelled, true);
  await until(async () => !(await job()).running, 'the stop');
  await pause(150);
  let j = await job();
  assert.equal(j.running, false, 'nothing started after Stop');
  assert.equal(j.queue.paused, 'stopped');
  assert.equal(j.queue.waiting, 2);
  assert.equal(runs().length, 1);

  // Removing one, then Resume queue: the other starts now.
  const tobin = j.queue.items.find((i) => i.target.id === 'p-tobin');
  assert.equal((await (await post({ action: 'queue-remove', item: tobin.id })).json()).removed, true);
  writeFileSync(SLEEP, '0');
  await post({ action: 'queue-resume' });
  await until(async () => runs().length === 2 && (await settled()), 'Maren’s scan');
  assert.equal(runs()[1], `--bridge-url=${url('maren-holt')}`);
  j = await job();
  assert.equal(j.queue.paused, null);
  assert.equal(j.queue.items.length, 0);
});

test('the queue is kept in the data folder; after a restart it waits for you, and never starts by itself', async () => {
  await startLong(1);
  await post({ action: 'connect', id: 'd2-ada@oriel' });
  await post({ action: 'bridge', id: 'p-maren' });
  const file = path.join(HOME, 'scan-queue.json');
  assert.ok(existsSync(file));
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(kept.items.map((i) => i.target.id), ['d2-ada@oriel', 'p-maren']);
  assert.ok(!JSON.stringify(kept).includes('linkedin.com'), 'no profile URL is kept: it is looked up again at the start');
  // Stop, and the app restarts: the queue is read back from the file.
  await post({ action: 'cancel' });
  await until(async () => !(await job()).running, 'the stop');
  delete globalThis[QUEUE_KEY];
  writeFileSync(file, JSON.stringify({ ...kept, paused: null }));
  const j = await job();
  assert.equal(j.queue.paused, 'restarted');
  assert.deepEqual(j.queue.items.map((i) => i.target.name), ['Ada Quill', 'Maren Holt']);
  await pause(150);
  assert.equal((await job()).running, false, 'nothing starts on launch');
  assert.equal(runs().length, 1);
  await post({ action: 'queue-clear' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { paused: null, items: [] });
});
