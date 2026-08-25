// Decides whether a request to one of the destructive routes is allowed.
//
// Split out from middleware.js so the rule can be tested directly: it is pure,
// takes everything it needs as arguments, and touches no framework types.

export const DESTRUCTIVE_ROUTES = [
  '/api/admin-delete',
  '/api/admin-update',
  '/api/delete-cluster',
  '/api/setup-profile',
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
 */
export function isCrossSiteWrite({ method, secFetchSite, origin, host }) {
  if (!method || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;

  if (secFetchSite) return !['same-origin', 'same-site', 'none'].includes(secFetchSite);

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
