// The mutual web in the page: every tie, loaded once (GET /api/ties) and shared
// by every view that reads it (app/components/useTies.js): the person card's
// "Known through", the focus, Show ties, Separation, Breach. Loaded again when
// the network is (app/page.js reload, forgetTies), so a scan's new ties show.
// No Node imports.

import { unpackTies, tieIndex } from './mutual-web.js';

const EMPTY = Object.freeze({ ready: false, ties: Object.freeze([]), index: new Map() });
let state = EMPTY;
let loading = null;
const listeners = new Set();

function publish(next) {
  state = next;
  for (const fn of listeners) fn();
}

/** Load the ties if they aren't yet (once at a time). Off for the sample and a CSV, which have none. */
export function loadTies({ off = false } = {}) {
  if (off || loading || state.ready) return loading;
  loading = fetch('/api/ties', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((payload) => {
      const ties = unpackTies(payload);
      publish({ ready: true, ties, index: tieIndex(ties) });
    })
    .catch(() => publish({ ready: true, ties: [], index: new Map() }))
    .finally(() => { loading = null; });
  return loading;
}

/** The network changed (a scan saved, the panel read a profile): the next look loads them again. */
export function forgetTies() {
  if (!state.ready) return;
  publish(EMPTY);
}

export const tiesNow = () => state;
export const TIES_NONE = EMPTY;
export function watchTies(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
