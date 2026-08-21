import { NextResponse } from 'next/server';

// Four routes can irreversibly destroy or rewrite the whole network. They run
// through a client with full write access and no per-user scoping, so they are
// worth fencing — but the fence should not get in the way of the person whose
// machine this is.
//
// On localhost they are allowed: this is a local-first app, the database is a
// file in the user's home directory, and anyone who can reach 127.0.0.1 can
// already open that file directly. A token there would only break `--rescrape`
// for no gain in safety.
//
// From any other host — a tunnel, a LAN address, a deployment — they require
// ADMIN_TOKEN as a bearer, and fail closed if it is unset. That way exposing
// the app never silently exposes a way to wipe it.

const DESTRUCTIVE = [
  '/api/admin-delete',   // deletes connections by profile_url
  '/api/admin-update',   // arbitrary column writes, no allowlist
  '/api/delete-cluster', // deletes a bridge's entire 2nd-degree cluster
  '/api/setup-profile',  // overwrites the stored profile
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (!DESTRUCTIVE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (LOCAL_HOSTS.has(host)) return NextResponse.next();

  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return Response.json(
      {
        error:
          'This route is disabled when the app is reachable from another host. Set ADMIN_TOKEN to enable it.',
      },
      { status: 503 }
    );
  }

  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (sameSecret(bearer, token)) return NextResponse.next();

  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: ['/api/admin-delete', '/api/admin-update', '/api/delete-cluster', '/api/setup-profile'],
};
