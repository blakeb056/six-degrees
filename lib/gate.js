// Decides whether a request to one of the destructive routes is allowed.
//
// Split out from middleware.js so the rule can be tested directly: it is pure,
// takes everything it needs as arguments, and touches no framework types.

// Routes that must never be reachable from another machine. Four of them
// irreversibly destroy or rewrite data; /api/scraper spawns processes and
// /api/update changes the code that will run next, both of which are more power
// than any of the others, so they sit behind the same gate.
//
// The four under /api/data are Settings → Your data: export hands over the
// whole network in one file, import replaces it, restart stops the server, and
// reveal starts a process. Reading /api/data itself (sizes, the folder's path)
// changes nothing and stays open, like every other read.
export const DESTRUCTIVE_ROUTES = [
  '/api/admin-delete',
  '/api/admin-update',
  '/api/delete-cluster',
  '/api/setup-profile',
  '/api/scraper',
  '/api/update',
  '/api/data/export',
  '/api/data/import',
  '/api/data/restart',
  '/api/data/reveal',
];

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Is this a write driven by some other website?
 *
 * Binding to loopback keeps other machines out, but not the browser on this
 * one: a page on any site can POST to 127.0.0.1, and with a simple content
 * type it does so with no preflight. The response stays hidden from them, but
 * the write still lands — enough to plant data this app later renders.
 *
 * Sec-Fetch-Site is set by the browser and cannot be forged by script, so it is
 * the reliable signal. Origin is the fallback for browsers that omit it.
 * Non-browser callers (curl, scripts/scrape.py) send neither and are unaffected.
 *
 * 'same-site' is not enough on its own: a site ignores the port, so a page
 * served from any other port on 127.0.0.1 (another local app, a dev server, a
 * tool's web UI) is "same-site" with this one. Such a write has to show an
 * Origin that is exactly this host and port. The app's own pages are always
 * 'same-origin', so nothing legitimate is refused.
 */
export function isCrossSiteWrite({ method, secFetchSite, origin, host }) {
  if (!method || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;

  if (secFetchSite) {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return false;
    if (secFetchSite !== 'same-site') return true;
    if (!origin) return true;          // same-site but no Origin to pin the port: refuse
  }

  if (origin) {
    try {
      const from = new URL(origin).host;
      return !!host && from !== host;
    } catch {
      return true;   // unparseable Origin — treat as hostile
    }
  }
  return false;      // no browser headers at all: not a browser
}

/**
 * Was this request sent to this app under someone else's name?
 *
 * DNS rebinding: a page on any website can make its own domain resolve to
 * 127.0.0.1. The browser then treats the app as that page's own origin, so
 * Sec-Fetch-Site says 'same-origin', the write check above lets it through,
 * and CORS lets the page read every answer, the whole network included. What
 * gives it away is the Host header: it carries the attacker's name, because
 * that is the address the page used.
 *
 * When the server is bound to loopback, every real caller (this app's pages,
 * the Mac app's window, the scanner, curl) addresses it as 127.0.0.1,
 * localhost or [::1], so any other Host is refused. Bound anywhere else, the
 * operator chose that on purpose and ADMIN_TOKEN guards what matters.
 */
export function isRebound({ bind, host }) {
  if (!boundToLoopback(bind)) return false;
  if (!host) return false;          // a client that sends no Host names nothing to judge
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return true;                    // an unparseable Host is not a real caller
  }
  return !LOOPBACK_HOSTNAMES.has(hostname);
}

// How URL() writes the loopback names (it keeps IPv6 in brackets). 0.0.0.0 is
// here because the scanner's own allow-list accepts it for APP_URL; a rebinding
// page can only ever send its own domain, never this.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

export function isDestructive(pathname) {
  return DESTRUCTIVE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function boundToLoopback(bind) {
  return LOOPBACK.has(String(bind || '').toLowerCase());
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Everything middleware.js decides about a request, as one answer: null to let
 * it through, or { status, error } to refuse it. In order: a request addressed
 * to another name (421), a write from another site (403), then, for the routes
 * in DESTRUCTIVE_ROUTES, the gate (gateDecision).
 *
 * One function, so the one route middleware.js leaves alone (the import, whose
 * body must not be buffered first: see middleware.js) makes exactly the same
 * checks itself, before it reads anything.
 *
 * @param {{ method: string, pathname: string, headers: { get(name: string): string | null },
 *           env: { SIX_DEGREES_BIND?: string, HOSTNAME?: string, ADMIN_TOKEN?: string } }} request
 */
export function requestRefusal({ method, pathname, headers, env = {} }) {
  const header = (name) => headers?.get?.(name) ?? null;
  const bind = env.SIX_DEGREES_BIND || env.HOSTNAME;

  if (isRebound({ bind, host: header('host') })) {
    return { status: 421, error: 'This app only answers to 127.0.0.1 and localhost.' };
  }
  if (isCrossSiteWrite({
    method,
    secFetchSite: header('sec-fetch-site'),
    origin: header('origin'),
    host: header('host'),
  })) {
    return { status: 403, error: 'Cross-site requests are not accepted. This app only answers to pages it serves.' };
  }
  if (!isDestructive(pathname)) return null;

  const decision = gateDecision({
    bind,
    token: env.ADMIN_TOKEN,
    bearer: (header('authorization') || '').replace(/^Bearer\s+/i, ''),
  });
  return decision.allow ? null : { status: decision.status, error: decision.reason };
}

/**
 * @param {{ bind?: string, token?: string, bearer?: string }} ctx
 * @returns {{ allow: boolean, status?: number, reason: string }}
 *
 * Note what is absent: the Host and X-Forwarded-For headers. Both are supplied
 * by the caller and pass through untouched, so neither can prove a request is
 * local. Only the server's own bind address can.
 */
export function gateDecision({ bind, token, bearer }) {
  if (token && sameSecret(bearer, token)) {
    return { allow: true, reason: 'valid admin token' };
  }
  if (boundToLoopback(bind)) {
    return { allow: true, reason: 'server is bound to loopback; only this machine can connect' };
  }
  if (!token) {
    return {
      allow: false,
      status: 503,
      reason: 'server is not bound to loopback and no ADMIN_TOKEN is configured',
    };
  }
  return { allow: false, status: 401, reason: 'missing or incorrect admin token' };
}
