// The look and the Galaxy's saved layouts, kept with the network so they
// travel with a backup or a restore, while the browser keeps a copy to paint
// with first (lib/synced-setting.js, lib/galaxy-layouts.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSaved, laterSaver } from '../lib/synced-setting.js';
import { cleanLayouts, GALAXY_LAYOUTS_SETTING, LAYOUT_KEYS, MAX_LAYOUTS } from '../lib/galaxy-layouts.js';
import { THEME_SETTING } from '../lib/themes.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isDefault = (t) => t.base === 'standard';

test('what the network has saved wins over this browser’s copy (a restore brings its own look)', () => {
  const r = reconcileSaved({ saved: { base: 'glass' }, cached: { base: 'obsidian' }, isDefault, same });
  assert.deepEqual(r, { use: { base: 'glass' }, save: false, changed: true });
  assert.equal(reconcileSaved({ saved: { base: 'glass' }, cached: { base: 'glass' }, isDefault, same }).changed, false);
});

test('a network with nothing saved yet takes this browser’s look once, unless it is only the default', () => {
  assert.deepEqual(reconcileSaved({ saved: null, cached: { base: 'obsidian' }, isDefault, same }), { use: { base: 'obsidian' }, save: true, changed: false });
  assert.equal(reconcileSaved({ saved: undefined, cached: { base: 'standard' }, isDefault, same }).save, false);
});

test('a look changed many times a second is saved once, the last one, and at once if the page goes away', async () => {
  const sent = [];
  const later = laterSaver((value, { now }) => { sent.push([value, now]); }, 20);
  later('a'); later('b'); later('c');
  assert.deepEqual(sent, []);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent, [['c', false]]);
  later('d');
  later.flush();
  later.flush();
  assert.deepEqual(sent, [['c', false], ['d', true]], 'flushed once, nothing left waiting');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 2);
});

test('saved layouts are names and slider values only', () => {
  const long = 'x'.repeat(60);
  assert.deepEqual(cleanLayouts([
    { name: ' Wide ', settings: { push: 30, names: 'all', loop: true, gravity: Infinity, on: false, colourBy: 'a b' } },
    { name: '', settings: { push: 1 } },
    { name: 'No settings' },
    { name: long, settings: { pull: 2 } },
    { name: 'Wide', settings: { push: 31 } },
    'junk',
  ]), [
    { name: 'Wide', settings: { push: 31 } },
    { name: 'x'.repeat(40), settings: { pull: 2 } },
  ]);
  assert.deepEqual(cleanLayouts('nope'), []);
  assert.equal(cleanLayouts(Array.from({ length: 80 }, (_, i) => ({ name: `L${i}`, settings: {} }))).length, MAX_LAYOUTS);
  assert.ok(LAYOUT_KEYS.includes('sizeBy') && !LAYOUT_KEYS.includes('on'));
});

test('both settings start as never saved, and refuse what isn’t theirs', () => {
  assert.equal(THEME_SETTING.default, null);
  assert.equal(GALAXY_LAYOUTS_SETTING.default, null);
  assert.equal(THEME_SETTING.parse(null), null);
  assert.deepEqual(THEME_SETTING.parse({ base: 'nonsense', custom: { accent: 'red' } }), { base: 'standard', custom: {} });
  assert.throws(() => THEME_SETTING.parse([]));
  assert.throws(() => GALAXY_LAYOUTS_SETTING.parse('x'));
});
