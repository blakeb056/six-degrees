// What the page has open over Sixgree's own browser (the LinkedIn panel,
// desktop/main.mjs). The panel is a view of its own, drawn over the page, so
// a menu, the notch opened or a note under a header button would be hidden
// under it. Each of them says here while it is open (app/components/
// usePanelCover.js), and the panel's part of the page (LinkedInPanel.js)
// tells the shell, which swaps the panel for a still picture of itself until
// nothing is (desktop/lib.mjs createPanelCover). No Node imports: the pages read it.

const open = new Set();
const listeners = new Set();

function changed() {
  for (const l of listeners) l();
}

/** `id` is open over the panel now; the function returned says it has closed. Saying it twice counts once. */
export function coverPanel(id) {
  const key = String(id ?? '');
  if (!key) return () => {};
  if (!open.has(key)) {
    open.add(key);
    changed();
  }
  return () => {
    if (open.delete(key)) changed();
  };
}

/** Is anything open over the panel? */
export const panelCoveredNow = () => open.size > 0;
export const notCovered = () => false;

/** Called whenever that changes; returns a function that stops it. */
export function watchPanelCover(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
