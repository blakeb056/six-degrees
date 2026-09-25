import { NextResponse } from 'next/server';
import { requestRefusal } from './lib/gate';

// Two separate protections, decided in lib/gate.js requestRefusal (covered by
// tests/gate.test.mjs).
//
// 1. Cross-site writes, on EVERY mutating request. Binding to 127.0.0.1 stops
//    other machines but not the browser on this one — a page on any website can
//    POST to this app, and with a simple content type it does so without a
//    preflight. The response is hidden from that page, but the write lands, and
//    data written this way is later rendered by the app. Sec-Fetch-Site is set
//    by the browser and cannot be forged from script; curl and the scraper send
//    no such header and are unaffected. Before that, a request addressed to some
//    other name (DNS rebinding) is refused, reads included: lib/gate.js isRebound.
//
// 2. The routes that destroy, replace or hand over data, start processes, or
//    change the code (DESTRUCTIVE_ROUTES in lib/gate.js). Allowed when the
//    server is bound to loopback, since the operator can open the SQLite file
//    directly anyway; otherwise ADMIN_TOKEN is required and they fail closed.

export function middleware(request) {
  const refused = requestRefusal({
    method: request.method,
    pathname: request.nextUrl.pathname,
    headers: request.headers,
    env: process.env,
  });
  if (refused) return Response.json({ error: refused.error }, { status: refused.status });
  return NextResponse.next();
}

export const config = {
  // /avatars serves the photos of the people in the network, so it gets the
  // same rebinding check as the API.
  //
  // Every /api route but one: POST /api/data/import (Settings → Your data). Next
  // copies a request's body into memory before it runs middleware, the whole of
  // it up to experimental.proxyClientMaxBodySize, even when middleware then
  // refuses it, and an import is one file of up to 256 MB. So that route is left
  // out here, keeps Next's 10 MB default for everyone else, and makes the same
  // checks itself (requestRefusal) before it reads a byte, then writes the body
  // to disk as it arrives. The pattern leaves out that exact path and nothing
  // else; tests/gate.test.mjs pins it with Next's own matcher.
  matcher: ['/api', '/api/((?!data/import$).*)', '/avatars/:path*'],
};
