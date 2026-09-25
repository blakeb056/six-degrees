// The desktop app's decisions (desktop/lib.mjs). No Electron needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { routeFor, isAppUrl, findFreePort, waitForServer, scanRunning, stopScan, stopProcess, dataDirArg } from '../desktop/lib.mjs';

const ORIGIN = 'http://127.0.0.1:6364';
const noSleep = async () => {};

test('links: the app stays in the app, LinkedIn goes to your browser, the rest is blocked', () => {
  assert.equal(routeFor(`${ORIGIN}/paths`, ORIGIN), 'app');
  assert.equal(routeFor(`blob:${ORIGIN}/0f3a-uuid`, ORIGIN), 'app');           // the app's own pop-up pages
  assert.equal(routeFor('https://www.linkedin.com/in/someone', ORIGIN), 'browser');
  assert.equal(routeFor('http://127.0.0.1:6363/', ORIGIN), 'browser');       // another port is not the app
  assert.equal(routeFor('file:///etc/passwd', ORIGIN), 'block');
  assert.equal(routeFor('javascript:alert(1)', ORIGIN), 'block');
  assert.equal(routeFor('not a url', ORIGIN), 'block');
  assert.equal(isAppUrl(`${ORIGIN}/`, null), false, 'before the server has a port, nothing is the app');
});

test('a free port is found past one that is taken', async () => {
  const busy = net.createServer();
  await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve));
  const taken = busy.address().port;
  const port = await findFreePort(taken, taken + 20);
  assert.ok(port > taken && port <= taken + 20);
  await new Promise((resolve) => busy.close(resolve));
});

test('waiting for the server: ready when it answers, an error at once if it died', async () => {
  let calls = 0;
  const upOnThird = async () => { calls++; if (calls < 3) throw new Error('refused'); return { ok: true }; };
  await waitForServer(ORIGIN, { fetchImpl: upOnThird, sleep: noSleep });
  assert.equal(calls, 3);
  await assert.rejects(
    waitForServer(ORIGIN, { fetchImpl: async () => { throw new Error('refused'); }, isAlive: () => false, sleep: noSleep }),
    /stopped while it was starting/,
  );
});

test('stopping a scan: asks the way the Stop button does, then waits until it has stopped', async () => {
  const seen = [];
  let running = true;
  let polls = 0;
  const server = async (url, opts = {}) => {
    seen.push(`${opts.method || 'GET'} ${url.replace(ORIGIN, '')}${opts.body ? ` ${opts.body}` : ''}`);
    if (opts.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
    if (!running) return { ok: true, json: async () => ({ running: false }) };
    polls++;
    if (polls > 2) running = false;               // the scanner takes a moment to close Chrome
    return { ok: true, json: async () => ({ running: true }) };
  };
  assert.equal(await stopScan(ORIGIN, { fetchImpl: server, sleep: noSleep }), 'stopped');
  assert.ok(seen.includes('POST /api/scraper {"action":"cancel"}'), seen.join('\n'));
});

test('stopping a scan: nothing to do when nothing runs, or when the server is already gone', async () => {
  const idle = async () => ({ ok: true, json: async () => ({ running: false }) });
  assert.equal(await stopScan(ORIGIN, { fetchImpl: idle, sleep: noSleep }), 'none');
  const gone = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await scanRunning(ORIGIN, { fetchImpl: gone }), null);
  assert.equal(await stopScan(ORIGIN, { fetchImpl: gone, sleep: noSleep }), 'none');
});

test('stopping a process: SIGTERM, and SIGKILL if it will not go', async () => {
  const polite = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await stopProcess(polite, { graceMs: 5000 });
  assert.equal(polite.signalCode, 'SIGTERM');
  const stubborn = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"]);
  await new Promise((resolve) => setTimeout(resolve, 300)); // let it install its handler
  await stopProcess(stubborn, { graceMs: 300 });
  assert.equal(stubborn.signalCode, 'SIGKILL');
  await stopProcess(null);                                   // nothing to stop is fine
});

test('--data-dir lets a beta run against a copy of the data', () => {
  assert.equal(dataDirArg(['/Applications/Six Degrees.app/Contents/MacOS/Six Degrees', '--data-dir', '/tmp/copy']), '/tmp/copy');
  assert.equal(dataDirArg(['x', '--data-dir=/tmp/copy']), '/tmp/copy');
  assert.equal(dataDirArg(['x', '-psn_0_12345']), null);
});
