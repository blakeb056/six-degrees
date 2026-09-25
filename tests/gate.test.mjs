// The destructive-route gate. These cases exist because an earlier version
// decided locality from the Host header, which a caller sets freely — a
// request from another machine could claim `Host: localhost` and be let
// through. The rule now keys off the server's own bind address only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDecision, isDestructive, boundToLoopback, DESTRUCTIVE_ROUTES } from '../lib/gate.js';

test('exactly these routes are gated; everything else, reads included, is not', () => {
  const gated = [
    '/api/admin-delete', '/api/admin-update', '/api/delete-cluster', '/api/setup-profile', '/api/scraper', '/api/update',
    '/api/data/export', '/api/data/import', '/api/data/restart', '/api/data/reveal',
  ];
  for (const p of gated) assert.equal(isDestructive(p), true, p);
  // A route added to the list is a decision: SECURITY.md, README and ENDPOINTS.md name them all.
  assert.deepEqual([...DESTRUCTIVE_ROUTES].sort(), [...gated].sort());
  for (const p of ['/api/network', '/api/users', '/api/ingest', '/api/queue', '/', '/import', '/api/settings', '/api/data']) {
    assert.equal(isDestructive(p), false, p);
  }
});

test('loopback bind addresses are recognised', () => {
  for (const b of ['127.0.0.1', '::1', 'localhost', 'LOCALHOST']) assert.equal(boundToLoopback(b), true, b);
  for (const b of ['0.0.0.0', '192.168.1.109', 'six-degrees.example.com', '', undefined]) {
    assert.equal(boundToLoopback(b), false, String(b));
  }
});

test('bound to loopback: allowed with no token', () => {
  const d = gateDecision({ bind: '127.0.0.1' });
  assert.equal(d.allow, true);
});

test('exposed bind, no token: fails closed with 503', () => {
  const d = gateDecision({ bind: '0.0.0.0' });
  assert.equal(d.allow, false);
  assert.equal(d.status, 503);
});

test('exposed bind, wrong token: 401', () => {
  const d = gateDecision({ bind: '0.0.0.0', token: 'correct-token', bearer: 'wrong-token!!' });
  assert.equal(d.allow, false);
  assert.equal(d.status, 401);
});

test('exposed bind, correct token: allowed', () => {
  const d = gateDecision({ bind: '0.0.0.0', token: 'correct-token', bearer: 'correct-token' });
  assert.equal(d.allow, true);
});

test('a token of a different length is rejected without leaking timing', () => {
  const d = gateDecision({ bind: '0.0.0.0', token: 'correct-token', bearer: 'short' });
  assert.equal(d.allow, false);
});

// The regression this whole design exists to prevent.
test('REGRESSION: request headers cannot buy access on an exposed server', () => {
  // Whatever a caller claims about Host or X-Forwarded-For is irrelevant —
  // gateDecision is never given them, so they cannot influence the outcome.
  const d = gateDecision({ bind: '0.0.0.0', token: undefined, bearer: '' });
  assert.equal(d.allow, false, 'an exposed server must not be open just because a header says localhost');
});

// ── Cross-site writes ──────────────────────────────────────────────────────
// Binding to loopback does not keep out the browser on this machine. A page on
// any website can POST to 127.0.0.1; with a simple content type it does so with
// no preflight, and although the response is hidden from that page, the write
// still lands. An audit reproduced exactly that: a hostile page silently
// rewrote a row through /api/admin-update, and a stored payload later executed
// when the node was hovered.

import { isCrossSiteWrite } from '../lib/gate.js';

test('a write from another site is refused', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', secFetchSite: 'cross-site', host: 'localhost:3000' }), true);
});

test('a write from the app itself is allowed', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', secFetchSite: 'same-origin', host: 'localhost:3000' }), false);
});

test('a typed address or bookmark (Sec-Fetch-Site: none) is allowed', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', secFetchSite: 'none', host: 'localhost:3000' }), false);
});

test('curl and the scraper send no browser headers and are unaffected', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', host: 'localhost:3000' }), false);
  assert.equal(isCrossSiteWrite({ method: 'DELETE', host: 'localhost:3000' }), false);
});

test('Origin is the fallback when Sec-Fetch-Site is absent', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', origin: 'https://evil.example', host: 'localhost:3000' }), true);
  assert.equal(isCrossSiteWrite({ method: 'POST', origin: 'http://localhost:3000', host: 'localhost:3000' }), false);
});

test('an unparseable Origin is treated as hostile', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', origin: 'not a url', host: 'localhost:3000' }), true);
});

test('REGRESSION: a page on another port of this machine is refused', () => {
  // A site ignores the port, so the browser calls a page at 127.0.0.1:4000
  // 'same-site' with the app at 127.0.0.1:3000. Its Origin gives the port away.
  assert.equal(
    isCrossSiteWrite({ method: 'POST', secFetchSite: 'same-site', origin: 'http://127.0.0.1:4000', host: '127.0.0.1:3000' }),
    true,
  );
});

test('same-site with no Origin to check is refused', () => {
  assert.equal(isCrossSiteWrite({ method: 'POST', secFetchSite: 'same-site', host: '127.0.0.1:3000' }), true);
});

test('same-site whose Origin is exactly this host and port is allowed', () => {
  assert.equal(
    isCrossSiteWrite({ method: 'POST', secFetchSite: 'same-site', origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' }),
    false,
  );
});

test('reads are never blocked by the cross-site check', () => {
  assert.equal(isCrossSiteWrite({ method: 'GET', secFetchSite: 'cross-site', host: 'localhost:3000' }), false);
});

test('REGRESSION: the no-preflight simple-content-type POST the audit used', () => {
  // text/plain avoids a preflight, so the browser sends the request outright.
  assert.equal(
    isCrossSiteWrite({ method: 'POST', secFetchSite: 'cross-site', origin: 'https://evil.example', host: '127.0.0.1:3000' }),
    true,
  );
});

test('the scraper route is gated like the destructive ones', () => {
  // It spawns processes, which is more power than deleting a row. If this ever
  // stops being gated, a page on the LAN could start a browser on this machine.
  assert.equal(isDestructive('/api/scraper'), true);
  assert.equal(gateDecision({ bind: '127.0.0.1' }).allow, true);
  assert.equal(gateDecision({ bind: '0.0.0.0', token: undefined }).status, 503);
});

// ── DNS rebinding ────────────────────────────────────────────────────────────
// A website can point its own domain at 127.0.0.1. The browser then calls the
// app that site's own origin, so only the Host header gives it away.

import { isRebound } from '../lib/gate.js';

test('REGRESSION: a rebound name is refused when the server is bound to loopback', () => {
  assert.equal(isRebound({ bind: '127.0.0.1', host: 'evil.example:3000' }), true);
  assert.equal(isRebound({ bind: '127.0.0.1', host: 'rebind.attacker.test' }), true);
  // services that resolve any name to 127.0.0.1 are the classic rebinding tool
  assert.equal(isRebound({ bind: '127.0.0.1', host: '127.0.0.1.nip.io:3000' }), true);
});

test('the loopback names every real caller uses are allowed, with any port', () => {
  for (const host of ['127.0.0.1:3000', '127.0.0.1:6363', 'localhost:3000', 'LOCALHOST:6363', '[::1]:3000', '127.0.0.1', '0.0.0.0:3000']) {
    assert.equal(isRebound({ bind: '127.0.0.1', host }), false, host);
  }
});

test('an unparseable Host is refused', () => {
  assert.equal(isRebound({ bind: '127.0.0.1', host: 'a b:c' }), true);
});

test('a server bound elsewhere is left to its ADMIN_TOKEN', () => {
  assert.equal(isRebound({ bind: '0.0.0.0', host: 'my-server.lan:3000' }), false);
});

test('a client that sends no Host is not judged', () => {
  assert.equal(isRebound({ bind: '127.0.0.1', host: null }), false);
});

test('Settings → Your data: export, import, restart and reveal are gated; reading the folder’s sizes is not', () => {
  // Export hands over the whole network in one file, import replaces it,
  // restart stops the server, and reveal starts a process. None of them may be
  // reachable from another machine. GET /api/data changes nothing.
  for (const p of ['/api/data/export', '/api/data/import', '/api/data/restart', '/api/data/reveal']) {
    assert.equal(isDestructive(p), true, p);
  }
  assert.equal(isDestructive('/api/data'), false);
  assert.equal(isDestructive('/api/database'), false);
  // A cancelled import is a DELETE from the page: a write, so the cross-site rule applies.
  assert.equal(isCrossSiteWrite({ method: 'DELETE', secFetchSite: 'cross-site', host: '127.0.0.1:6363' }), true);
});
