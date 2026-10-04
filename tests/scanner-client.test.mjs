// lib/scraper-client.js: one scan at a time, and every Scan button knows it.
//
// The scanner refuses a second job, but the buttons used to keep their own idea
// of whether one ran: a scan started on one profile card left every other
// card's button live, and pressing it said "Scan failed — connections may be
// private" about a scan that never started. These pin the shared answer the
// buttons now read: asked once for the page, greyed at the press rather than a
// poll later, and able to tell each job's end from the next one's.
// A fake scanner stands in for /api/scraper. Invented names.

import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let fresh = 0;
const client = () => import(`../lib/scraper-client.js?test=${++fresh}`);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
const response = (status, body) => ({ ok: status < 400, status, json: async () => body });
const idle = () => ({ running: false, action: null, target: null, startedAt: null, exitCode: null, failure: null, progress: null, log: [], recent: [] });

function fakeScanner() {
  const server = { job: idle(), gets: 0, post: null };
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      const { status, body } = await server.post(JSON.parse(opts.body));
      return response(status, body);
    }
    server.gets++;
    if (String(url) === '/api/scraper?job=1') return response(200, structuredClone(server.job));
    throw new Error(`unexpected request ${url}`);
  };
  return server;
}

const ada = { id: 'p-ada', name: 'Ada Park' };
const running = (over) => ({ ...idle(), running: true, action: 'bridge', target: ada, startedAt: 1000, log: ['Mapping the circle behind Ada Park…'], ...over });

afterEach(() => {
  mock.timers.reset();
  delete globalThis.fetch;
});

test('a scan started elsewhere greys every button out, says whose it is, and is seen to end', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  server.job = running();
  const { watchScanner, scannerNow, busyReason, scansCircleOf } = await client();

  const stop = watchScanner(() => {});
  await flush();
  const now = scannerNow();
  assert.equal(now.running, true);
  assert.equal(busyReason(now), 'Ada Park’s circle is being scanned');
  assert.equal(scansCircleOf(now, ada), true);
  // Two connections can share a name: the id decides.
  assert.equal(scansCircleOf(now, { id: 'p-other', name: 'Ada Park' }), false);

  server.job = { ...idle(), action: 'bridge', target: ada, startedAt: 1000, exitCode: 0, log: ['Finished.'],
    recent: [{ action: 'bridge', target: ada, startedAt: 1000, exitCode: 0, failure: null }] };
  mock.timers.tick(1500);
  await flush();
  assert.equal(scannerNow().running, false);
  assert.equal(busyReason(scannerNow()), null);
  assert.deepEqual(scannerNow().finished.map((j) => [j.target.name, j.exitCode, j.log]), [['Ada Park', 0, ['Finished.']]]);
  stop();
});

test('a scan that ended before the page opened is not reported as finished', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  server.job = { ...idle(), recent: [{ action: 'bridge', target: ada, startedAt: 5, exitCode: 0, failure: null }] };
  const { watchScanner, scannerNow } = await client();
  const stop = watchScanner(() => {});
  await flush();
  assert.equal(scannerNow().known, true);
  assert.deepEqual(scannerNow().finished, []);
  stop();
});

test('pressing Scan greys every button at once, and an answer from before the press cannot undo it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  const { watchScanner, scannerNow, beginScrape } = await client();
  const stop = watchScanner(() => {});
  await flush();
  assert.equal(scannerNow().running, false);

  let land;
  server.post = (body) => new Promise((resolve) => { land = () => resolve({ status: 200, body: { ok: true, action: body.action, startedAt: 2000 } }); });
  const begun = beginScrape('bridge', { name: ada.name, id: ada.id });
  // Before the scanner has answered at all.
  assert.equal(scannerNow().running, true);
  assert.equal(scannerNow().pending, true);
  assert.deepEqual(scannerNow().target, ada);

  // The server hasn't started it yet, so the next look says nothing runs.
  const asked = server.gets;
  mock.timers.tick(5000);
  await flush();
  assert.equal(server.gets, asked + 1, 'it did look');
  assert.equal(scannerNow().running, true, 'still greyed out');

  server.job = running({ startedAt: 2000 });
  land();
  const { startedAt, ended } = await begun;
  assert.equal(startedAt, 2000);
  await flush();
  assert.equal(scannerNow().pending, false);
  assert.equal(scannerNow().startedAt, 2000);

  server.job = { ...idle(), action: 'bridge', target: ada, startedAt: 2000, exitCode: 0, log: ['Finished.'],
    recent: [{ action: 'bridge', target: ada, startedAt: 2000, exitCode: 0, failure: null }] };
  mock.timers.tick(1500);
  await flush();
  const end = await ended;
  assert.equal(end.exitCode, 0);
  stop();
});

test('a refused start says why, and the buttons then show what really runs', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  const { watchScanner, scannerNow, beginScrape, busyReason } = await client();
  const stop = watchScanner(() => {});
  await flush();

  // Started on the Scan page after this page last looked.
  server.job = running({ action: 'full', target: null, startedAt: 3000 });
  server.post = async () => ({ status: 409, body: { error: 'Something is already running.', action: 'full' } });
  await assert.rejects(beginScrape('bridge', { name: ada.name, id: ada.id }), /Something is already running\./);
  await flush();
  assert.equal(scannerNow().running, true);
  assert.equal(scannerNow().pending, false);
  assert.equal(busyReason(scannerNow()), 'Your own connections are being scanned');
  stop();
});

test('a job\'s end reaches the page that started it even when the next job began before it looked', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  const { runScrape } = await client();
  server.post = async () => {
    server.job = running({ startedAt: 4000 });
    return { status: 200, body: { ok: true, action: 'bridge', startedAt: 4000 } };
  };
  const logs = [];
  const done = runScrape('bridge', { name: ada.name, id: ada.id, onLog: (l) => logs.push(l) });
  await flush();
  assert.deepEqual(logs, [['Mapping the circle behind Ada Park…']], 'its log, as it runs');

  // Ours failed, and someone started a company scan, all between two looks.
  server.job = running({ action: 'company', target: { id: null, name: 'Initech' }, startedAt: 5000,
    recent: [{ action: 'bridge', target: ada, startedAt: 4000, exitCode: 1, failure: ['LinkedIn would not open page 3.'] }] });
  mock.timers.tick(1500);
  await flush();
  const end = await done;
  assert.equal(end.exitCode, 1);
  assert.deepEqual(end.failure, ['LinkedIn would not open page 3.']);
});

test('nobody watching, nothing asked', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  const { watchScanner } = await client();
  const stop = watchScanner(() => {});
  await flush();
  mock.timers.tick(5000);
  await flush();
  const asked = server.gets;
  assert.equal(asked, 2, 'once on opening, then every 5 s while idle');
  stop();
  mock.timers.tick(60_000);
  await flush();
  assert.equal(server.gets, asked);
});

test('why the buttons are grey, for each kind of job', async () => {
  const { busyReason } = await client();
  const job = (action, target = null) => ({ running: true, action, target });
  assert.equal(busyReason(job('resume', { id: 'x', name: 'Ada Park' })), 'Ada Park’s circle is being scanned');
  assert.equal(busyReason(job('company', { id: null, name: 'Initech' })), 'Initech is being scanned');
  assert.equal(busyReason(job('auto-bridge')), 'Your bridges are being mapped, one by one');
  assert.equal(busyReason(job('install')), 'The scanner\'s packages are being installed');
  assert.equal(busyReason(job('login')), 'The LinkedIn sign-in window is open');
  assert.equal(busyReason({ running: false, action: 'full' }), null);
});

test('"Show the scanner\'s Chrome window" goes with every scan start; the old "Hide the Chrome window" is no longer read', async () => {
  const { scanRequest, showChromeOn, SHOW_CHROME_KEY } = await client();
  const store = (v, key = SHOW_CHROME_KEY) => ({ getItem: (k) => (k === key ? v : null) });
  assert.equal(SHOW_CHROME_KEY, 'six-degrees-show-chrome');
  assert.equal(showChromeOn(store('true')), true);
  assert.equal(showChromeOn(store('false')), false);
  assert.equal(showChromeOn(store(null)), false);
  assert.equal(showChromeOn(store('not json')), false);
  assert.equal(showChromeOn(null), false);
  // Someone who had ticked the old switch (headless Chrome) gets the window out of sight, as every scan now does.
  assert.equal(showChromeOn(store('true', 'six-degrees-hide-chrome')), false);
  assert.deepEqual(scanRequest('auto-bridge', { maxPages: 10 }, true), { action: 'auto-bridge', maxPages: 10, showWindow: true });
  assert.deepEqual(scanRequest('refresh', {}, false), { action: 'refresh' });
  // A caller can't switch it off by passing showWindow: false while the switch is on.
  assert.equal(scanRequest('refresh', { showWindow: false }, true).showWindow, true);
});

// Blake, 2026-10-04: "we need to make it so theres no pop up or nothing". Every
// Scan button outside the card started by sending you to the Scan page, or by
// asking; now they start where they are, and a refusal comes back as words.
test('starting where the button is: one press starts it; not ready, or refused, comes back as a line to show', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  const statusOf = { ready: true, checks: { scriptsFound: true, dependencies: true, chrome: true } };
  const fetchJob = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url) === '/api/scraper' && opts.method !== 'POST') return response(200, statusOf);
    if (opts.method === 'POST') posts++;
    return fetchJob(url, opts);
  };
  server.post = async (body) => {
    server.job = running({ action: body.action, target: { id: body.id ?? null, name: body.name ?? null }, startedAt: 2000 });
    return { status: 200, body: { ok: true, startedAt: 2000 } };
  };
  const { startHere, scannerNow } = await client();

  // Ready: it starts, and every button greys out at once.
  assert.equal(await startHere('bridge', { name: 'Ada Park', id: 'p-ada' }), null);
  assert.equal(posts, 1);
  assert.equal(scannerNow().running, true);

  // Refused (a cooldown, say): the server's own words, and nothing runs.
  server.job = idle();
  server.post = async () => ({ status: 409, body: { error: 'Scanning is paused until tomorrow: LinkedIn pushed back.' } });
  assert.equal(await startHere('refresh'), 'Scanning is paused until tomorrow: LinkedIn pushed back.');

  // Not set up: said without asking the scanner to start anything.
  statusOf.checks = { scriptsFound: true, dependencies: false, python: true };
  const before = posts;
  assert.match(await startHere('refresh'), /not set up yet/);
  assert.equal(posts, before);

  // The app not answering at all: still words, never a throw.
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await startHere('refresh'), 'Could not reach the app.');
});

test('what LinkedIn needs you to do at the scanner\'s window travels with the job, and only while it runs', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeScanner();
  server.job = running({ action: 'refresh', target: null, needsYou: 'sign in to LinkedIn in the Chrome window in front.' });
  const { watchScanner, scannerNow, SCANNER_UNKNOWN } = await client();
  assert.equal(SCANNER_UNKNOWN.needsYou, null);
  const stop = watchScanner(() => {});
  await flush();
  assert.equal(scannerNow().needsYou, 'sign in to LinkedIn in the Chrome window in front.');
  server.job = { ...idle(), needsYou: 'left over' };
  mock.timers.tick(1500);
  await flush();
  assert.equal(scannerNow().needsYou, null);
  stop();
});

test('the map keeps looking while circles fill in: one person\'s scan, or a batch of them', async () => {
  const { fillsCircles } = await client();
  assert.equal(fillsCircles(running()), true);
  for (const action of ['auto-bridge', 'auto-bridge-retry', 'resume-all']) {
    assert.equal(fillsCircles({ ...idle(), running: true, action }), true, action);
  }
  // Your own list, setting up, signing in: no circle fills in.
  for (const action of ['full', 'refresh', 'install', 'login', 'company', 'photos', null]) {
    assert.equal(fillsCircles({ ...idle(), running: true, action }), false, String(action));
  }
  assert.equal(fillsCircles(null), false);
});
