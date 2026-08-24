import { NextResponse } from 'next/server';
import { isDestructive, gateDecision } from './lib/gate';

// Four routes can irreversibly destroy or rewrite the whole network.
//
// What actually protects them is the listening socket: `npm run dev` and
// `npm start` bind to 127.0.0.1 and export SIX_DEGREES_BIND so this file can
// tell. If the server is bound anywhere else — a tunnel, -H 0.0.0.0, a
// container — ADMIN_TOKEN becomes required and these routes fail closed
// without one.
//
// The rule itself lives in lib/gate.js and is covered by tests/gate.test.mjs.

export function middleware(request) {
  if (!isDestructive(request.nextUrl.pathname)) return NextResponse.next();

  const decision = gateDecision({
    bind: process.env.SIX_DEGREES_BIND || process.env.HOSTNAME,
    token: process.env.ADMIN_TOKEN,
    bearer: (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
  });

  if (decision.allow) return NextResponse.next();
  return Response.json({ error: decision.reason }, { status: decision.status });
}

export const config = {
  matcher: ['/api/admin-delete', '/api/admin-update', '/api/delete-cluster', '/api/setup-profile'],
};
