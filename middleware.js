import { NextResponse } from 'next/server';

// The deployed app is intentionally public: it is a research artifact and the
// network data is Blake's to publish. Reads, and every user-facing write, need
// no auth.
//
// The four routes below are different in kind — they IRREVERSIBLY destroy or
// rewrite data, and they run through a service-role Supabase client with no
// per-user scoping. Left open, a single anonymous request could erase the whole
// dataset (the Supabase project is shared with other apps). They are therefore
// fenced behind ADMIN_TOKEN, which only the scraper sends. Nothing in the UI
// calls them, so this is invisible in normal use.
//
// Fails CLOSED: if ADMIN_TOKEN is unset, the destructive routes refuse.

const DESTRUCTIVE = [
  '/api/admin-delete',   // deletes connections by profile_url
  '/api/admin-update',   // arbitrary column writes, no allowlist
  '/api/delete-cluster', // deletes a bridge's entire 2nd-degree cluster
  '/api/setup-profile',  // executes DDL
];

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

  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return Response.json(
      { error: 'ADMIN_TOKEN is not configured; destructive routes are disabled' },
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
