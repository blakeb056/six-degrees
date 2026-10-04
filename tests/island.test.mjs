// The notch's buttons (lib/island.js): every page has its notch, even with
// one view, and a second row of choice is drawn after a thin line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNotchTabs, notchTabsNow, watchNotchTabs, isCurrentTab, notchGroups } from '../lib/island.js';

const pick = () => {};

test('one tab is a notch: a page with a single view still shows it, lit', () => {
  // Network Circle (before its layouts) and Separation had one view each, and the
  // notch dropped a list of one: no notch there until a scan put its status in it.
  const one = { items: [{ key: 'separation', label: 'Separation', icon: '🏆' }], current: 'separation', onPick: pick };
  setNotchTabs(one);
  assert.equal(notchTabsNow(), one);
  assert.equal(isCurrentTab(notchTabsNow(), 'separation'), true);

  const two = { items: [{ key: 'map', label: 'Map' }, { key: 'companies', label: 'Companies' }], current: 'map', onPick: pick };
  setNotchTabs(two);
  assert.equal(notchTabsNow(), two);
});

test('no tabs, an empty list or nothing at all clears the notch', () => {
  setNotchTabs({ items: [{ key: 'scan', label: 'Scan' }], current: 'scan', onPick: pick });
  setNotchTabs({ items: [], current: null, onPick: pick });
  assert.equal(notchTabsNow(), null);
  setNotchTabs({ items: [{ key: 'scan', label: 'Scan' }], current: 'scan', onPick: pick });
  setNotchTabs(null);
  assert.equal(notchTabsNow(), null);
  setNotchTabs({ current: 'scan' });
  assert.equal(notchTabsNow(), null);
});

test('every change is heard, so the notch never keeps a page that has gone', () => {
  let heard = 0;
  const stop = watchNotchTabs(() => { heard += 1; });
  setNotchTabs({ items: [{ key: 'a', label: 'A' }], current: 'a', onPick: pick });
  setNotchTabs(null);
  stop();
  setNotchTabs(null);
  assert.equal(heard, 2);
});

test('a second row of choice: Profile · ✦ Insights, then the board, each with its own lit tab', () => {
  const tabs = {
    items: [
      { key: 'profile', label: 'Profile' },
      { key: 'insights', label: 'Insights', icon: '✦' },
      { key: 'people', label: 'People', divided: true },
      { key: 'health', label: 'Health' },
    ],
    current: ['insights', 'people'],
    onPick: pick,
  };
  assert.deepEqual(notchGroups(tabs.items).map((g) => g.map((t) => t.key)), [['profile', 'insights'], ['people', 'health']]);
  assert.equal(isCurrentTab(tabs, 'insights'), true);
  assert.equal(isCurrentTab(tabs, 'people'), true);
  assert.equal(isCurrentTab(tabs, 'profile'), false);
  assert.equal(isCurrentTab(tabs, 'health'), false);
  // One row with nothing divided is one group; nothing lit when `current` is null (the Galaxy's sliders are your own).
  assert.deepEqual(notchGroups([{ key: 'rings' }, { key: 'clusters' }]).length, 1);
  assert.equal(isCurrentTab({ items: [{ key: 'rings' }], current: null }, 'rings'), false);
  assert.equal(isCurrentTab(null, 'rings'), false);
});
