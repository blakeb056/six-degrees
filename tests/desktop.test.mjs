// The desktop app's decisions (desktop/lib.mjs). No Electron needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {
  routeFor, isAppUrl, findFreePort, waitForServer, scanRunning, stopScan, stopProcess, dataDirArg,
  RESTART_EXIT_CODE, UPDATE_HANDOFF_EXIT_CODE, serverExitAction,
} from '../desktop/lib.mjs';

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

test('a relative --data-dir is made absolute against the folder the app was started from', () => {
  // The server runs from its own folder inside the app, so a relative path
  // handed over as typed named a different, empty folder.
  const home = '/Users/someone';
  assert.equal(dataDirArg(['x', '--data-dir', 'copy'], { cwd: '/Users/someone/work', home }), '/Users/someone/work/copy');
  assert.equal(dataDirArg(['x', '--data-dir=../copy'], { cwd: '/Users/someone/work', home }), '/Users/someone/copy');
  assert.equal(dataDirArg(['x', '--data-dir', '/tmp/copy'], { cwd: '/Users/someone/work', home }), '/tmp/copy');
  assert.equal(dataDirArg(['x', '--data-dir='], { cwd: '/Users/someone/work', home }), null);
});

test('opened with `open` (which starts apps in /), a relative --data-dir is taken from the home folder', () => {
  const home = '/Users/someone';
  assert.equal(dataDirArg(['x', '--data-dir', 'copy'], { cwd: '/', home }), '/Users/someone/copy');
  assert.equal(dataDirArg(['x', '--data-dir', '/Volumes/Backup/copy'], { cwd: '/', home }), '/Volumes/Backup/copy');
});

test('a leading ~ in --data-dir is the home folder, even after = where the shell leaves it alone', () => {
  const home = '/Users/someone';
  assert.equal(dataDirArg(['x', '--data-dir=~/copy'], { cwd: '/Users/someone/work', home }), '/Users/someone/copy');
  assert.equal(dataDirArg(['x', '--data-dir', '~'], { cwd: '/', home }), '/Users/someone');
  // Only "~" and "~/": "~other" is somebody else's home, left as a plain name.
  assert.equal(dataDirArg(['x', '--data-dir=~other'], { cwd: '/Users/someone/work', home }), '/Users/someone/work/~other');
});

// When the server ends, the app says nothing (it is quitting anyway), quits
// quietly, starts the server again, or reports a crash. The codes are shared
// with the in-app updater (settings-updater), which reads them the same way.
test('the server ending while the app quits is expected, whatever the code: nothing to do', () => {
  for (const code of [RESTART_EXIT_CODE, UPDATE_HANDOFF_EXIT_CODE, 143, 130, 1, 0, null]) {
    assert.equal(serverExitAction({ code, signal: null, quitting: true }), 'ignore', String(code));
  }
  assert.equal(serverExitAction({ code: null, signal: 'SIGKILL', quitting: true }), 'ignore');
});

test('75 starts the server again, to finish an import', () => {
  assert.equal(RESTART_EXIT_CODE, 75);
  assert.equal(serverExitAction({ code: 75, signal: null, quitting: false, answered: true }), 'restart');
});

test('REGRESSION: Restart now again soon after a restart is a restart, not "Six Degrees stopped"', () => {
  // An import that stopped (another copy had the network open, say) says why on
  // the page, and the person fixes it and clicks Restart now again at once. The
  // first guard counted any restart within 15 s of the last as a crash.
  // lastRestartAt and now are what the first guard was given: 2 s after the last restart.
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) {
    const exit = { code: 75, signal: null, quitting: false, answered: true, lastRestartAt: now - 2000, now };
    assert.equal(serverExitAction(exit), 'restart', `restart ${i + 1}`);
  }
});

test('a server that asks to be restarted before it ever answered is reported: it can\'t stay up', () => {
  // Restart now is a click on a page that server served. Asking without having
  // answered once can only be the server failing as it starts: restarting it
  // would loop forever.
  assert.equal(serverExitAction({ code: 75, signal: null, quitting: false, answered: false }), 'report');
});

test('76 (the updater has taken over), 143 and 130 (Next stopped from outside) and a signal quit quietly', () => {
  assert.equal(UPDATE_HANDOFF_EXIT_CODE, 76);
  for (const code of [76, 143, 130]) {
    assert.equal(serverExitAction({ code, signal: null, quitting: false }), 'quit', String(code));
    assert.equal(serverExitAction({ code, signal: null, quitting: false, answered: false }), 'quit', `${code}, never answered`);
  }
  for (const signal of ['SIGKILL', 'SIGTERM']) assert.equal(serverExitAction({ code: null, signal, quitting: false }), 'quit', signal);
});

test('any other exit is a crash, said out loud', () => {
  for (const code of [1, 0, 2, 74, 77, 124, 137, 255]) {
    assert.equal(serverExitAction({ code, signal: null, quitting: false }), 'report', String(code));
  }
});

test('the restart code the shell hands its server is one the server accepts', async () => {
  // main.mjs passes RESTART_EXIT_CODE as SIX_DEGREES_RESTART_CODE; the server
  // (lib/data-import.js) exits with it. The two can't share a module (the server
  // never imports desktop/), so this keeps them agreeing.
  const { restartCodeFrom } = await import('../lib/data-import.js');
  assert.equal(RESTART_EXIT_CODE, 75);
  assert.equal(restartCodeFrom({ SIX_DEGREES_RESTART_CODE: String(RESTART_EXIT_CODE) }), RESTART_EXIT_CODE);
});
