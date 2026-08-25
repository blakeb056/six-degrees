import { NextResponse } from 'next/server';
import { isDestructive, gateDecision, isCrossSiteWrite } from './lib/gate';

// Two separate protections.
//
// 1. Cross-site writes, on EVERY mutating request. Binding to 127.0.0.1 stops
//    other machines but not the browser on this one — a page on any website can
//    POST to this app, and with a simple content type it does so without a
//    preflight. The response is hidden from that page, but the write lands, and
//    data written this way is later rendered by the app. Sec-Fetch-Site is set
//    by the browser and cannot be forged from script; curl and the scraper send
//    no such header and are unaffected.
//
// 2. The four routes that irreversibly destroy or rewrite data. Allowed when the
//    server is bound to loopback, since the operator can open the SQLite file
//    directly anyway; otherwise ADMIN_TOKEN is required and they fail closed.
//    The rule lives in lib/gate.js and is covered by tests/gate.test.mjs.

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (isCrossSiteWrite({
    method: request.method,
    secFetchSite: request.headers.get('sec-fetch-site'),
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
  })) {
    return Response.json(
      { error: 'Cross-site requests are not accepted. This app only answers to pages it serves.' },
      { status: 403 }
    );
  }

  if (!isDestructive(pathname)) return NextResponse.next();

  const decision = gateDecision({
    bind: process.env.SIX_DEGREES_BIND || process.env.HOSTNAME,
    token: process.env.ADMIN_TOKEN,
    bearer: (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
  });

  if (decision.allow) return NextResponse.next();
  return Response.json({ error: decision.reason }, { status: decision.status });
}

export const config = {
  matcher: ['/api/:path*'],
};
