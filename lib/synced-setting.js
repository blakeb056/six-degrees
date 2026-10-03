// A choice kept with the network (lib/settings.js), so it travels with a
// backup, an export and a restore, while the browser keeps a copy of it to
// read before the page paints (the look) or before the server answers. The
// look and the Galaxy's saved layouts work this way (lib/theme-store.js,
// lib/galaxy-lab.js). No imports: pure, so the tests can pin it.

/**
 * What to use once the server has answered, and whether to save the browser's
 * copy to it.
 *
 * - The server has one (`saved`): it wins. A restore or an import brings its
 *   own look, and another window of the app (the Mac app and a browser tab
 *   keep separate copies) may have changed it.
 * - The server has none (null: never saved on this network, as for everyone
 *   before this was kept there): the browser's copy stands, and is saved once,
 *   unless it is only the default.
 *
 * @returns {{ use, save: boolean, changed: boolean }}
 */
export function reconcileSaved({ saved, cached, isDefault, same }) {
  if (saved === null || saved === undefined) return { use: cached, save: !isDefault(cached), changed: false };
  return { use: saved, save: false, changed: !same(saved, cached) };
}

/**
 * Save at most once per `wait` ms, the last value winning: a colour picker
 * changes the look many times a second while it's dragged. `flush()` sends a
 * waiting save now (the page is going away: otherwise the network's older
 * value would win when it opens again). `save(value, { now })` is told which.
 */
export function laterSaver(save, wait = 400) {
  let timer = null;
  let next;
  const send = (now) => {
    clearTimeout(timer);
    timer = null;
    Promise.resolve(save(next, { now })).catch(() => { /* kept in this browser; saved with the next change */ });
  };
  const later = (value) => {
    next = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => send(false), wait);
  };
  later.flush = () => { if (timer) send(true); };
  return later;
}
