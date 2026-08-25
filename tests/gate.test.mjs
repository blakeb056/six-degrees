// The destructive-route gate. These cases exist because an earlier version
// decided locality from the Host header, which a caller sets freely — a
// request from another machine could claim `Host: localhost` and be let
// through. The rule now keys off the server's own bind address only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateDecision, isDestructive, boundToLoopback } from '../lib/gate.js';

test('only the four destructive routes are gated', () => {
  for (const p of ['/api/admin-delete', '/api/admin-update', '/api/delete-cluster', '/api/setup-profile']) {
    assert.equal(isDestructive(p), true, p);
  }
  for (const p of ['/api/network', '/api/users', '/api/ingest', '/api/queue', '/', '/import']) {
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
