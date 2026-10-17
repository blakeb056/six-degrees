// "Invitation sent" puts Sixgree's own browser away (Blake, 2026-10-16: "when they click
// connect on the person we will detect in the bottom left corner where it says connection
// has been sent, to close out so they can continue in the Outlink or Separation or
// bridge"). The watcher in the panel's page (desktop/lib.mjs INVITE_WATCH_JS), what the
// shell passes on (inviteSentFor), and what the page does with it (lib/linkedin-panel.js
// inviteSentAction). No Electron, no LinkedIn: a stand-in page. Every name is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  inviteSentText, inviteSentFor, INVITE_SENT_MARK, INVITE_WATCH_JS, INVITE_WATCH_WORLD,
} from '../desktop/lib.mjs';
import { inviteSentAction, profileSlugOf, INVITE_NOTE_MS } from '../lib/linkedin-panel.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const TEST_ORIGIN = 'http://127.0.0.1:7811';

test('LinkedIn\'s words for an invitation that went, and only those', () => {
  assert.deepEqual(inviteSentText('Invitation sent'), { name: null });
  assert.deepEqual(inviteSentText('Invitation sent.'), { name: null });
  assert.deepEqual(inviteSentText('Invitation sent to Ada Stone'), { name: 'Ada Stone' });
  assert.deepEqual(inviteSentText('  Your invitation to\n Ada Stone was sent. '), { name: 'Ada Stone' });
  assert.deepEqual(inviteSentText('Your invitation to Ada Stone has been sent'), { name: 'Ada Stone' });
  for (const no of [
    'Pending, click to withdraw invitation sent to Ada Stone',   // the Pending button's label
    'Withdraw invitation',
    'Invitations',
    'Sent',
    'Invitation sent to Ada Stone and 3 others were seen'.repeat(10),
    '',
    null,
  ]) assert.equal(inviteSentText(no), null, String(no));
});

// A stand-in page for the watcher: a document a MutationObserver watches, and a console.
function standIn(pathname) {
  const logged = [];
  let observer = null;
  const el = (text, kids = []) => ({ nodeType: 1, textContent: text, querySelectorAll: () => kids });
  const ctx = {
    window: {},
    document: {},
    location: { pathname, href: `https://www.linkedin.com${pathname}` },
    console: { log: (line) => logged.push(line) },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observer = this; }
      observe(target, opts) { this.target = target; this.opts = opts; }
    },
  };
  vm.runInNewContext(INVITE_WATCH_JS, ctx);
  const add = (node) => observer.fn([{ type: 'childList', addedNodes: [node] }]);
  return { ctx, logged, observer: () => observer, el, add };
}

test('the watcher: a notice added to a profile page is said once, with the page it was on', () => {
  const page = standIn('/in/ada-stone/');
  assert.equal(page.observer().target, page.ctx.document);
  assert.deepEqual({ ...page.observer().opts }, { childList: true, subtree: true, characterData: true });
  // The notice as a toast: its words in a child, a Dismiss button beside them, whose
  // text runs on from the name in the toast's own ("Ada Stonex"): the words alone are said.
  const words = page.el('Invitation sent to Ada Stone');
  page.add(page.el('Invitation sent to Ada Stonex', [page.el('Invitation sent to Ada Stone', [words]), words, page.el('x')]));
  assert.equal(page.logged.length, 1);
  assert.ok(page.logged[0].startsWith(INVITE_SENT_MARK));
  assert.deepEqual(JSON.parse(page.logged[0].slice(INVITE_SENT_MARK.length)),
    { text: 'Invitation sent to Ada Stone', href: 'https://www.linkedin.com/in/ada-stone/' });
  page.add(page.el('Invitation sent'));
  assert.equal(page.logged.length, 1, 'once a page');
  // Running it again on the same page adds no second watcher.
  vm.runInNewContext(INVITE_WATCH_JS, page.ctx);
  assert.equal(page.logged.length, 1);
});

test('the watcher says nothing on any other page, nor for words that only look like it', () => {
  const feed = standIn('/feed/');
  feed.add(feed.el('Invitation sent'));
  assert.equal(feed.logged.length, 0, 'not a profile');
  const profile = standIn('/in/ada-stone/');
  profile.add(profile.el('Pending, click to withdraw invitation sent to Ada Stone'));
  profile.add(profile.el('Connect'));
  profile.add({ nodeType: 3, parentElement: null });
  assert.equal(profile.logged.length, 0);
  // Words that arrive by a change of text, not a new node.
  profile.observer().fn([{ type: 'characterData', target: { parentElement: profile.el('Invitation sent to Ada Stone') } }]);
  assert.equal(profile.logged.length, 1);
});

const line = (text, href) => INVITE_SENT_MARK + JSON.stringify({ text, href });

test('the shell passes it on only for the profile a link opened, still showing it, the notice seen there, once', () => {
  const at = 'https://www.linkedin.com/in/ada-stone/';
  const opened = { url: at, mode: 'profile', visible: true };
  assert.deepEqual(inviteSentFor(line('Invitation sent to Ada Stone', at), opened), { slug: 'ada-stone', name: 'Ada Stone' });
  assert.deepEqual(inviteSentFor(line('Invitation sent', 'https://www.linkedin.com/in/Ada-Stone/details/'), opened), { slug: 'ada-stone', name: null });
  // Not the watcher's line, or words that don't say it.
  assert.equal(inviteSentFor('Invitation sent', opened), null);
  assert.equal(inviteSentFor(line('Withdraw invitation', at), opened), null);
  assert.equal(inviteSentFor(`${INVITE_SENT_MARK}{not json`, opened), null);
  // Not shown, or shown for a scan or the LinkedIn tab.
  assert.equal(inviteSentFor(line('Invitation sent', at), { ...opened, visible: false }), null);
  assert.equal(inviteSentFor(line('Invitation sent', at), { ...opened, mode: 'scan' }), null);
  assert.equal(inviteSentFor(line('Invitation sent', at), { ...opened, mode: 'section' }), null);
  // Seen on another profile than the one showing now, or the panel not on a profile.
  assert.equal(inviteSentFor(line('Invitation sent', 'https://www.linkedin.com/in/ben-ortiz/'), opened), null);
  assert.equal(inviteSentFor(line('Invitation sent', at), { ...opened, url: 'https://www.linkedin.com/feed/' }), null);
  // Once a profile.
  assert.equal(inviteSentFor(line('Invitation sent', at), { ...opened, seen: new Set(['ada-stone']) }), null);
  // The local check's stand-in counts only when named.
  const local = `${TEST_ORIGIN}/in/ada-stone/`;
  assert.equal(inviteSentFor(line('Invitation sent', local), { ...opened, url: local }), null);
  assert.deepEqual(inviteSentFor(line('Invitation sent', local), { ...opened, url: local, testOrigin: TEST_ORIGIN }), { slug: 'ada-stone', name: null });
});

test('the page: the person the link opened is marked through the connection it came by, then "Request sent to X"', () => {
  const person = { id: 'r1', name: 'Ada Stone', profile_url: 'https://www.linkedin.com/in/ada-stone/', source_connection_id: 'c7' };
  assert.deepEqual(inviteSentAction({ slug: 'ada-stone', name: 'Ada S.' }, { person }), { mark: person, bridgeId: 'c7', note: 'Request sent to Ada Stone' });
  // A profile reached inside the panel: marked by its link, named as LinkedIn named them.
  assert.deepEqual(inviteSentAction({ slug: 'ben-ortiz', name: 'Ben Ortiz' }, { person }), {
    mark: { profile_url: 'https://www.linkedin.com/in/ben-ortiz/', name: 'Ben Ortiz' }, bridgeId: null, note: 'Request sent to Ben Ortiz',
  });
  assert.equal(inviteSentAction({ slug: 'ben-ortiz', name: null }).note, 'Request sent to ben-ortiz');
  // A scan driving the panel: Auto's requests are its own to mark.
  const scan = { job: { running: true, action: 'connect' }, panel: { scanner: true } };
  assert.equal(inviteSentAction({ slug: 'ada-stone' }, { ...scan, person }), null);
  assert.ok(inviteSentAction({ slug: 'ada-stone' }, { job: { running: true, action: 'connect' }, panel: { scanner: false }, person }));
  assert.equal(inviteSentAction({}), null);
  assert.equal(INVITE_NOTE_MS, 3500);
});

test('a profile link\'s slug, as the shell names it', () => {
  assert.equal(profileSlugOf('https://www.linkedin.com/in/Ada-Stone/'), 'ada-stone');
  assert.equal(profileSlugOf('linkedin.com/in/ada-stone?trk=x'), 'ada-stone');
  assert.equal(profileSlugOf('https://www.linkedin.com/in/j%C3%B6rg-b/details/experience/'), 'jörg-b');
  for (const no of ['https://www.linkedin.com/feed/', 'https://example.com/in/ada', '', null]) assert.equal(profileSlugOf(no), null, String(no));
});

test('wired through: the shell watches each page in a world of its own and tells the app\'s page; the page marks, puts the panel away, and says so', () => {
  const main = read('../desktop/main.mjs');
  assert.match(main, /contents\.on\('dom-ready', \(\) => watchInvites\(contents\)\);/);
  // The same console line feeds the mutual web's watcher too (tests/mutual-web.test.mjs).
  assert.match(main, /contents\.on\('console-message', \(event\) => \{ inviteSent\(event\?\.message\); mutualsSeen\(event\?\.message\); \}\);/);
  assert.match(main, /executeJavaScriptInIsolatedWorld\(INVITE_WATCH_WORLD, \[\{ code: INVITE_WATCH_JS \}\]\)/);
  assert.match(main, /url: panel\.webContents\.getURL\(\), mode: panelMode, visible: panelVisible, seen: invitesSeen, testOrigin: PANEL_TEST_ORIGIN/);
  assert.match(main, /invitesSeen\.add\(sent\.slug\);\s*win\.webContents\.send\('linkedin-panel:invite-sent', sent\);/);
  assert.ok(![0, 999].includes(INVITE_WATCH_WORLD), 'never the page\'s world nor Electron\'s');
  const preload = read('../desktop/preload.cjs');
  assert.match(preload, /ipcRenderer\.on\('linkedin-panel:invite-sent', listener\)/);
  const open = read('../app/components/OpenProfile.js');
  assert.match(open, /await showProfileInPanel\(url\)\) \{\s*\/\/[^\n]*\n\s*rememberPanelPerson\(person\);/);
  const bar = read('../app/components/LinkedInPanel.js');
  assert.match(bar, /inviteSentAction\(info, \{ job: scannerNow\(\), panel: panelNow\(\), person: panelPersonFor\(info\?\.slug\) \}\)/);
  assert.match(bar, /if \(!hasRequest\(act\.mark\)\) markRequested\(act\.mark, \{ bridgeId: act\.bridgeId \}\)\.catch\(\(\) => \{\}\);/);
  assert.match(bar, /endProfileSteps\(\);\s*b\.hide\(\);/);
  assert.match(bar, /role="status" aria-live="polite" data-invite-sent=""/);
  for (const src of [read('../desktop/lib.mjs'), bar, read('../lib/linkedin-panel.js')]) assert.doesNotMatch(src, /—/);
});
