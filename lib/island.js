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
