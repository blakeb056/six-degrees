// The daily update check (lib/update-notice.js, lib/update-check.js): once a
// day, while the app runs, one GET for the newest release's version number,
// and one notification per newer version. On by default; Settings → Updates
// turns it off. Every request here goes to a pretend release server on
// 127.0.0.1 (scripts/test-release-server.mjs), never to GitHub.
//
// What it promises: it asks at most once in 24 hours, also when the asking
// failed; it asks nothing while the setting is off, during tests, or with
// SIX_DEGREES_NO_UPDATE_CHECK=1; a failure is quiet; a version gets one
// notification, never a second; and the button and the daily check are one
// request, not two that could drift apart.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestReleaseServer } from '../scripts/test-release-server.mjs';
import {
  UPDATE_CHECK_SETTING, CHECK_EVERY_MS, LAST_CHECK_KEY, NOTIFIED_KEY, UPDATE_NOTE_TYPE,
  autoCheckOff, checkDue, announcedVersion, updateNotification,
} from '../lib/update-notice.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-update-check-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

const SLUG = 'blakeb056/six-degrees';   // package.json's repository: what the real check asks for
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-10-14T09:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
const SCHEDULER = Symbol.for('six-degrees.update-check');

let getDb, readSettings, writeSettings, SettingsError;
let runUpdateCheck, latestRelease, settleUpdateNotes, checkForUpdateNow, startUpdateChecks;
let server;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings, SettingsError } = await import('../lib/settings.js'));
  ({ runUpdateCheck, latestRelease, settleUpdateNotes, checkForUpdateNow, startUpdateChecks } = await import('../lib/update-check.js'));
  server = await startTestReleaseServer({ slug: SLUG, release: { version: '9.9.9', assets: [] } });
});

after(async () => {
  if (server) await server.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.exec(`DELETE FROM app_meta WHERE key IN ('settings', '${LAST_CHECK_KEY}', '${NOTIFIED_KEY}')`);
  db.exec('DELETE FROM notifications');
  server.requests.length = 0;
  server.setRelease({ version: '9.9.9', assets: [] });
  delete globalThis[SCHEDULER];
});

const notes = () => getDb().prepare('SELECT * FROM notifications WHERE type = ?').all(UPDATE_NOTE_TYPE);
const meta = (key) => getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value ?? null;

/** A stand-in for GitHub's answer that counts how often it was asked. */
function answers(...versions) {
  const fake = async () => {
    fake.calls += 1;
    const v = versions[Math.min(fake.calls - 1, versions.length - 1)];
    if (v instanceof Error) throw v;
    return v === null ? null : { version: v, url: null, release: { tag_name: `v${v}` } };
  };
  fake.calls = 0;
  return fake;
}

const run = (fetchLatest, now = T0, more = {}) => runUpdateCheck({
  db: getDb(), now, currentVersion: '2.0.0', kind: 'mac-app', userId: 'me', fetchLatest, ...more,
});

// ── the setting ──

test('the daily check is on until it is turned off, and is an ordinary setting', () => {
  assert.equal(UPDATE_CHECK_SETTING.default, true);
  assert.equal(readSettings(getDb()).updateCheck, true, 'nothing chosen yet: on');
  assert.equal(writeSettings(getDb(), { updateCheck: false }).updateCheck, false);
  assert.equal(readSettings(getDb()).updateCheck, false);
  assert.throws(() => writeSettings(getDb(), { updateCheck: 'yes' }), SettingsError);
  assert.equal(writeSettings(getDb(), { updateCheck: true }).updateCheck, true);
});

// ── when it runs ──

test('a day: due with no check yet, not again within 24 hours, due again after', () => {
  assert.equal(checkDue(null, T0), true);
  assert.equal(checkDue('not a date', T0), true);
  assert.equal(checkDue(T0.toISOString(), at(23 * HOUR)), false);
  assert.equal(checkDue(T0.toISOString(), at(CHECK_EVERY_MS)), true);
  assert.equal(CHECK_EVERY_MS, 24 * HOUR);
  // The clock moved back: a check stamped in the future doesn't hold the next one off.
  assert.equal(checkDue(at(5 * HOUR).toISOString(), T0), true);
});

test('it asks once, not again within 24 hours, and again once they have passed', async () => {
  const github = answers('2.0.0');
  assert.equal((await run(github, T0)).ran, true);
  assert.equal(github.calls, 1);
  assert.equal(meta(LAST_CHECK_KEY), T0.toISOString());

  for (const later of [HOUR, 12 * HOUR, 24 * HOUR - 1]) {
    const r = await run(github, at(later));
    assert.deepEqual(r, { ran: false, reason: 'not-due' });
  }
  assert.equal(github.calls, 1, 'nothing asked within the day');

  assert.equal((await run(github, at(24 * HOUR))).ran, true);
  assert.equal(github.calls, 2, 'asked again once a day had passed');
});

test('turned off, it asks nothing and keeps nothing', async () => {
  writeSettings(getDb(), { updateCheck: false });
  const github = answers('9.0.0');
  assert.deepEqual(await run(github), { ran: false, reason: 'off' });
  assert.equal(github.calls, 0);
  assert.equal(meta(LAST_CHECK_KEY), null);
  assert.equal(notes().length, 0);
});

test('offline or rate-limited: quiet, nothing left behind, and the next try is a day later', async () => {
  const github = answers(new Error('GitHub answered 403'), '9.0.0');
  const r = await run(github, T0);
  assert.equal(r.ran, true);
  assert.equal(r.error, 'GitHub answered 403');
  assert.equal(notes().length, 0, 'no notification about a failure');
  assert.equal(meta(LAST_CHECK_KEY), T0.toISOString(), 'the attempt counts as the day\'s check');
  assert.equal((await run(github, at(2 * HOUR))).reason, 'not-due', 'no retry within the day: never nags GitHub');
  assert.equal(github.calls, 1);
  const next = await run(github, at(25 * HOUR));
  assert.equal(next.notified, true);
});

test('never in a test, a smoke test, or with SIX_DEGREES_NO_UPDATE_CHECK=1', () => {
  assert.equal(autoCheckOff({}), null);
  assert.equal(autoCheckOff({ SIX_DEGREES_NO_UPDATE_CHECK: '0' }), null);
  assert.match(autoCheckOff({ SIX_DEGREES_NO_UPDATE_CHECK: '1' }), /SIX_DEGREES_NO_UPDATE_CHECK/);
  assert.match(autoCheckOff({ NODE_TEST_CONTEXT: 'child-v8' }), /node --test/);
  assert.match(autoCheckOff({ NODE_ENV: 'test' }), /test/);
  assert.match(autoCheckOff({ SIX_DEGREES_SMOKE: '1' }), /smoke/);
  // This process is one: node --test set NODE_TEST_CONTEXT for it.
  assert.ok(autoCheckOff(process.env));
});

test('the scheduler: off in tests and in a git checkout, and its tick is the daily check', async () => {
  const inTest = startUpdateChecks();
  assert.match(inTest.off, /node --test/);
  assert.equal(inTest.tick, undefined, 'no timer started');
  delete globalThis[SCHEDULER];

  assert.match(startUpdateChecks({ env: {}, gitCheckout: () => true }).off, /git/);
  delete globalThis[SCHEDULER];

  // As an installed copy outside a test, pointed at the pretend server.
  const env = { SIX_DEGREES_TEST_RELEASES: server.origin };
  const started = startUpdateChecks({ env, gitCheckout: () => false });
  try {
    assert.equal(started.off, null);
    assert.equal(startUpdateChecks({ env, gitCheckout: () => false }), started, 'once per process');
    const r = await started.tick();
    assert.equal(r.notified, true);
    assert.deepEqual(server.requests, [`GET /repos/${SLUG}/releases/latest`], 'one GET, to the test server');
    assert.equal((await started.tick()).reason, 'not-due');
    assert.equal(server.requests.length, 1);
  } finally {
    started.stop();
  }
  assert.equal(globalThis[SCHEDULER], undefined);
});

// ── the notification ──

test('a newer version leaves one notification, and never a second for the same version', async () => {
  const github = answers('2.1.0');
  const first = await run(github, T0);
  assert.equal(first.notified, true);
  assert.equal(meta(NOTIFIED_KEY), '2.1.0');
  const [note] = notes();
  assert.equal(note.title, 'Sixgree 2.1.0 is out');
  assert.equal(note.message, 'Install it from Settings → Updates.');
  assert.equal(note.user_id, 'me');
  assert.equal(note.seen, 0);
  assert.deepEqual(JSON.parse(note.data), { version: '2.1.0' });

  // The next days, the same version: still one.
  assert.equal((await run(github, at(24 * HOUR))).notified, false);
  assert.equal((await run(github, at(48 * HOUR))).notified, false);
  assert.equal(notes().length, 1);

  // A release after it: one more.
  assert.equal((await run(answers('2.2.0'), at(72 * HOUR))).notified, true);
  // And an older one coming back (a release taken down): nothing.
  assert.equal((await run(answers('2.1.0'), at(96 * HOUR))).notified, false);
  assert.deepEqual(notes().map((n) => JSON.parse(n.data).version).sort(), ['2.1.0', '2.2.0']);
});

test('nothing to say: the same or an older version, nothing published, a pre-release or a draft', async () => {
  for (const [i, v] of ['2.0.0', '1.9.9', null].entries()) {
    const r = await run(answers(v), at(i * 24 * HOUR));
    assert.equal(r.newer, false, String(v));
  }
  assert.equal(announcedVersion({ version: '2.1.0-beta.1', release: {} }), null);
  assert.equal(announcedVersion({ version: '2.1.0', release: { prerelease: true } }), null);
  assert.equal(announcedVersion({ version: '2.1.0', release: { draft: true } }), null);
  assert.equal(announcedVersion({ version: 'latest', release: {} }), null);
  assert.equal(announcedVersion({ version: 'v2.1.0', release: {} }), '2.1.0');
  assert.equal(notes().length, 0);
});

test('what it says depends on how this copy updates; it never names the platform', () => {
  assert.equal(updateNotification({ version: '2.1.0', kind: 'mac-app' }).message, 'Install it from Settings → Updates.');
  assert.equal(updateNotification({ version: '2.1.0', kind: 'windows-app' }).message, 'Settings → Updates links to its installer.');
  assert.equal(updateNotification({ version: '2.1.0', kind: 'npm' }).message, 'Settings → Updates shows how to update.');
  const note = updateNotification({ version: '2.1.0' });
  assert.equal(note.type, UPDATE_NOTE_TYPE);
  assert.equal(note.user_id, null);
  assert.doesNotMatch(JSON.stringify(note), /linkedin/i);
});

test('a notification is read once its version is installed, or once someone checks by hand', async () => {
  await run(answers('2.1.0'), T0);
  await run(answers('2.2.0'), at(24 * HOUR));
  // Now running 2.1.0: its notification is old news, 2.2.0's isn't.
  assert.equal(settleUpdateNotes(getDb(), { currentVersion: '2.1.0' }), 1);
  assert.deepEqual(notes().map((n) => [JSON.parse(n.data).version, n.seen]).sort(), [['2.1.0', 1], ['2.2.0', 0]]);
  // Check for updates, pressed: everything read.
  assert.equal(settleUpdateNotes(getDb(), { currentVersion: '2.1.0', all: true }), 1);
  assert.ok(notes().every((n) => n.seen === 1));
});

test('the gear asks the notifications route for update notifications only, any network\'s', async () => {
  const { GET } = await import('../app/api/notifications/route.js');
  await run(answers('9.0.0'), T0);
  getDb().prepare("INSERT INTO notifications (id, user_id, type, title) VALUES ('n1', 'me', 'scan_done', 'Scan done')").run();
  const d = await (await GET(new Request(`http://127.0.0.1/api/notifications?type=${UPDATE_NOTE_TYPE}`))).json();
  assert.deepEqual(d.notifications.map((n) => n.title), ['Sixgree 9.0.0 is out']);
  assert.equal(d.notifications[0].seen, false);
  assert.equal(d.notifications[0].data.version, '9.0.0');
  // The bell's list is unchanged: every type, for one network.
  const bell = await (await GET(new Request('http://127.0.0.1/api/notifications?userId=me'))).json();
  assert.equal(bell.notifications.length, 2);
});

// ── one request for the button and the daily check ──

test('the real check asks the release source it is given: the test server, never GitHub', async () => {
  const r = await checkForUpdateNow({ env: { SIX_DEGREES_TEST_RELEASES: server.origin }, now: T0 });
  assert.equal(r.version, '9.9.9');
  assert.equal(r.notified, true);
  assert.deepEqual(server.requests, [`GET /repos/${SLUG}/releases/latest`]);

  const latest = await latestRelease(SLUG, server.origin);
  assert.equal(latest.version, '9.9.9');
  assert.match(latest.url, /releases\/tag\/v9\.9\.9$/);

  // Nothing published: null, not an error.
  server.setRelease(null);
  assert.equal(await latestRelease(SLUG, server.origin), null);
});

test('Check for updates and the daily check are the same request', () => {
  const route = readFileSync(new URL('../app/api/update/route.js', import.meta.url), 'utf8');
  assert.match(route, /import \{ latestRelease, settleUpdateNotes \} from '..\/..\/..\/lib\/update-check'/);
  assert.doesNotMatch(route, /function latestRelease/, 'no second copy of the request in the route');
  assert.match(route, /settleUpdateNotes\(getDb\(\), \{ all: true \}\)/, 'a check by hand reads the notification');
});

// ── what the app and its pages say about it ──

// Before this, every page promised that nothing checks for updates by itself
// (spec invariant 2). It does now, once a day, on until turned off, so each of
// those sentences had to change: these pin that none of the old promise is
// left, and that each place says what is asked, how often, and how to turn it off.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('no page still says nothing checks for updates by itself', () => {
  const files = ['README.md', 'SECURITY.md', 'docs/SIX-DEGREES-SPEC.md', 'site/index.html', 'site/_pages/docs.html',
    'site/_pages/download.html', 'site/_posts/local-first.md', 'app/components/UpdatePanel.js', 'lib/updater.js'];
  for (const f of files) {
    const text = read(f);
    for (const old of [/Nothing checks by itself/i, /nothing checks on its own/i, /never checks for updates on its own/i,
      /Nothing is checked automatically\. The button/i, /No automatic update check\. Ever/i, /Nothing goes online by itself/i]) {
      assert.ok(!old.test(text), `${f} still says "${old.source}"`);
    }
  }
});

test('each page says what the daily check asks, and how to turn it off', () => {
  for (const f of ['README.md', 'SECURITY.md', 'site/_pages/docs.html', 'site/_pages/download.html', 'site/_posts/local-first.md']) {
    const text = read(f);
    assert.ok(/once a day/i.test(text), `${f}: how often`);
    assert.ok(/newest (release's )?version number/i.test(text), `${f}: what is asked`);
    assert.ok(/Settings → Updates/.test(text), `${f}: where to turn it off`);
  }
  assert.ok(/once a day/.test(read('docs/SIX-DEGREES-SPEC.md')), 'the spec names the exception');
  assert.ok(/Check for updates once a day/.test(read('app/components/UpdatePanel.js')), 'the switch');
});
