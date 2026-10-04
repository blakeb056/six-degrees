// The notch (app/components/ScanStatusBar.js): one small pill hanging under the
// header that shows what the app is doing. The scanner shows there on its own;
// anything else that runs for a while (a replay being recorded, an import) can
// show there too, through this list.
//
//   const done = showActivity({ id: 'replay', label: 'Recording the replay', detail: '12 s' });
//   … later: done();
//
// An activity is { id, label, detail?, progress? (0–1), tone? ('run' | 'idle' | 'warn') }.
// Showing the same id again replaces it. The list only changes when something
// in it does, as useSyncExternalStore needs.

const listeners = new Set();
let activities = [];

export const activitiesNow = () => activities;
const EMPTY = [];
export const noActivities = () => EMPTY;

export function watchActivities(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function showActivity(a) {
  if (!a?.id) return () => {};
  activities = [...activities.filter((x) => x.id !== a.id), a];
  listeners.forEach((f) => f());
  return () => clearActivity(a.id);
}

export function clearActivity(id) {
  if (!activities.some((x) => x.id === id)) return;
  activities = activities.filter((x) => x.id !== id);
  listeners.forEach((f) => f());
}

// The notch's buttons: the views of the page you're on (Bridge Chains,
// Separation…), or any page's own sub-tabs. A page sets them while it's on
// screen and clears them when it leaves; the notch draws them under the header's
// tabs (Blake, 2026-10-02: "the notch… under the ui buttons at top so then we
// can use that for button selection too"). Pages set them with
// app/components/useNotchTabs.js, which does both in the same frame as the page.
//
//   setNotchTabs({ items: [{ key, label, icon?, title?, divided? }], current, onPick })
//   setNotchTabs(null)
//
// One tab is a notch too: a page with a single view still shows it, lit, so
// every page has its notch under the tabs, not only the ones with a choice to
// make. A list of one used to be dropped, which left Network Circle and
// Separation with no notch until a scan put its status there (Blake,
// 2026-10-04: "the notch doesnt show in the network circle and another section
// unless i scan something and it forces it to pop up").
//
// `divided` starts a second row of choice after a thin line (Profile · ✦
// Insights, then Insights' boards), and `current` is then a list: the key lit
// in each.
const tabListeners = new Set();
let notchTabs = null;

export const notchTabsNow = () => notchTabs;
export const noNotchTabs = () => null;

export function watchNotchTabs(f) {
  tabListeners.add(f);
  return () => tabListeners.delete(f);
}

// Whether the notch is on screen at all (tabs, a scan, or another job), so a
// page with a heading at the top can leave room for it only when it's there.
const shownListeners = new Set();
let notchShown = false;
export const notchShownNow = () => notchShown;
export const noNotch = () => false;
export function watchNotchShown(f) {
  shownListeners.add(f);
  return () => shownListeners.delete(f);
}
export function setNotchShown(shown) {
  if (notchShown === Boolean(shown)) return;
  notchShown = Boolean(shown);
  shownListeners.forEach((f) => f());
}

export function setNotchTabs(tabs) {
  notchTabs = tabs && Array.isArray(tabs.items) && tabs.items.length > 0 ? tabs : null;
  tabListeners.forEach((f) => f());
}

/** Whether a tab is lit: `current` is one key, or a list of them (one per group). */
export function isCurrentTab(tabs, key) {
  const current = tabs?.current;
  return Array.isArray(current) ? current.includes(key) : current != null && current === key;
}

/** The tabs in their groups: a `divided` tab starts a new one, drawn after a thin line. */
export function notchGroups(items = []) {
  const groups = [];
  for (const item of items) {
    if (!groups.length || item.divided) groups.push([]);
    groups[groups.length - 1].push(item);
  }
  return groups;
}
