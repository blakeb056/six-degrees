// The notch's buttons (lib/island.js): every page has its notch, even with
// one view, and a second row of choice is drawn after a thin line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setNotchTabs, notchTabsNow, watchNotchTabs, isCurrentTab, notchGroups,
  readTucked, notchTuckedNow, setNotchTucked, watchNotchTucked, isTuckKey, comesBackDown, NOTCH_TUCKED_KEY,
} from '../lib/island.js';

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

// Tucked up (Blake, 2026-10-05: "a small minimal arrow in it to put it up").
const memory = (start = {}) => {
  const kept = { ...start };
  return { kept, getItem: (k) => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = String(v); } };
};

test('tucked is remembered: only a kept "true" is up, and storage that fails reads as down', () => {
  assert.equal(readTucked(memory({ [NOTCH_TUCKED_KEY]: 'true' })), true);
  assert.equal(readTucked(memory({ [NOTCH_TUCKED_KEY]: 'false' })), false);
  assert.equal(readTucked(memory()), false);
  assert.equal(readTucked(null), false);
  assert.equal(readTucked({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('tucking is kept, heard once per change, and survives storage that refuses it', () => {
  const store = memory();
  let heard = 0;
  const stop = watchNotchTucked(() => { heard += 1; });
  setNotchTucked(true, store);
  assert.equal(notchTuckedNow(), true);
  assert.equal(store.kept[NOTCH_TUCKED_KEY], 'true');
  setNotchTucked(true, store); // already up: nothing to hear
  setNotchTucked(false, { setItem: () => { throw new Error('full'); } });
  assert.equal(notchTuckedNow(), false, 'down for this visit even when it cannot be kept');
  stop();
  assert.equal(heard, 2);
});

test('⌘. or Ctrl+. is the shortcut, and nothing else is', () => {
  assert.equal(isTuckKey({ key: '.', metaKey: true }), true);
  assert.equal(isTuckKey({ key: '.', ctrlKey: true }), true);
  assert.equal(isTuckKey({ key: '.' }), false, 'a full stop typed in a box');
  assert.equal(isTuckKey({ key: '.', metaKey: true, shiftKey: true }), false);
  assert.equal(isTuckKey({ key: '.', ctrlKey: true, altKey: true }), false);
  assert.equal(isTuckKey({ key: '/', metaKey: true }), false);
  assert.equal(isTuckKey(null), false);
});

test('only LinkedIn starting to need you brings a tucked notch down, once', () => {
  assert.equal(comesBackDown(null, 'Sign in to LinkedIn in the window that opened.'), true);
  // Still needing you after you tucked it again: it stays up.
  assert.equal(comesBackDown('Sign in', 'Sign in'), false);
  assert.equal(comesBackDown('Sign in', null), false);
  assert.equal(comesBackDown(null, null), false);
});
