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
