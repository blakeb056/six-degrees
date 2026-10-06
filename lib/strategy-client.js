// The strategy engine's switch and its answer, as the pages see them
// (lib/strategy-engine.js does the work, on the server: GET /api/strategy).
//
// Off by default. The switch is Settings → Experimental, kept in this browser
// like Auto scan's (lib/experimental-client.js): JSON under
// six-degrees-experimental-strategy, a change announced with the same
// 'six-degrees:experimental' event. While it's off nothing asks for anything
// and no page shows a thing.

const KEY = 'six-degrees-experimental-strategy';

export function watchStrategy(change) {
  window.addEventListener('storage', change);
  window.addEventListener('six-degrees:experimental', change);
  return () => {
    window.removeEventListener('storage', change);
    window.removeEventListener('six-degrees:experimental', change);
  };
}

export function strategyOnNow() {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export const strategyOnServer = () => false;

export function setStrategyOn(on) {
  try { localStorage.setItem(KEY, JSON.stringify(Boolean(on))); } catch { /* not remembered */ }
  window.dispatchEvent(new Event('six-degrees:experimental'));
}

// One answer for every page that shows it, asked for again after a minute
// (the server answers from memory unless the network changed).
const FRESH_MS = 60_000;
let kept = null;   // { userId, at, promise }

/** The engine's answer: { people: { key: entry }, measured, nodes, ms }, or throws with why. */
export function loadStrategy(userId) {
  const id = userId || '';
  if (kept && kept.userId === id && Date.now() - kept.at < FRESH_MS) return kept.promise;
  const promise = fetch(`/api/strategy${id ? `?userId=${encodeURIComponent(id)}` : ''}`)
    .then((r) => r.json().catch(() => ({})).then((d) => {
      if (!r.ok) throw new Error(d.error || 'The strategy engine could not read the network.');
      return d;
    }));
  kept = { userId: id, at: Date.now(), promise };
  promise.catch(() => { if (kept?.promise === promise) kept = null; });
  return promise;
}
