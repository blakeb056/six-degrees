import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES, STANDARD, BACKDROPS, FONTS, BUTTONS, DOTS, TIER_KEYS, cleanTheme, resolveTheme, themeVars, themeAttrs, encodeTheme, decodeTheme, presetOf, isLight,
} from '../lib/themes.js';

const HEX = /^#[0-9a-f]{6}$/;

test('every look is complete: its colours, dots, backdrop and font are real', () => {
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  for (const t of THEMES) {
    for (const k of ['bg', 'bg2', 'panel', 'accent', 'you', 'line']) assert.match(t[k], HEX, `${t.id}.${k}`);
    for (const k of TIER_KEYS) assert.match(t.tiers[k], HEX, `${t.id}.tiers.${k}`);
    assert.ok(BACKDROPS.includes(t.backdrop), t.id);
    assert.ok(Object.hasOwn(FONTS, t.font), t.id);
    assert.ok(t.glass >= 0 && t.glass <= 1, t.id);
    assert.ok(BUTTONS.includes(t.buttons), t.id);
    assert.ok(DOTS.includes(t.dots), t.id);
  }
  assert.equal(presetOf('no such look'), STANDARD);
});

test('a saved or pasted theme keeps only colours, the listed choices and numbers in range', () => {
  const dirty = {
    base: 'space',
    custom: {
      bg: '#123', bg2: 'red', accent: '#ABCDEF', panel: 'url(javascript:alert(1))', you: '#fff;}body{display:none',
      tiers: { S: '#00ff00', A: 'expression(1)', Z: '#111111' },
      backdrop: 'stars;} html{', font: 'Comic Sans', lines: 'one', glass: 7, extra: 'kept?',
    },
  };
  assert.deepEqual(cleanTheme(dirty), {
    base: 'space',
    custom: { bg: '#112233', accent: '#abcdef', tiers: { S: '#00ff00' }, lines: 'one', glass: 1 },
  });
  assert.deepEqual(cleanTheme(null), { base: 'standard', custom: {} });
  assert.deepEqual(cleanTheme({ base: 'evil' }), { base: 'standard', custom: {} });
});

test('the page\'s variables are built from clean values: nothing in them can end a rule', () => {
  for (const choice of [...THEMES.map((t) => ({ base: t.id })), { base: 'glass', custom: { bg: '#010203', glass: 0 } }]) {
    const vars = themeVars(choice);
    for (const [k, v] of Object.entries(vars)) {
      assert.match(k, /^--sd-[a-z0-9-]+$/);
      assert.doesNotMatch(String(v), /[;{}<>]/, `${k}: ${v}`);
    }
  }
  assert.equal(themeVars({ base: 'standard', custom: { bg: '#010203' } })['--sd-bg'], '#010203');
  assert.deepEqual(themeAttrs({ base: 'space' }), { theme: 'space', backdrop: 'stars', mode: 'dark', buttons: 'soft', dots: 'glow' });
  assert.deepEqual(themeAttrs({ base: 'space', custom: { backdrop: 'none' } }), { theme: 'space', backdrop: 'none', mode: 'dark', buttons: 'soft', dots: 'glow' });
});

test('your changes sit on top of the look they started from', () => {
  const t = resolveTheme({ base: 'obsidian', custom: { tiers: { S: '#ff0000' }, font: 'mono' } });
  assert.equal(t.tiers.S, '#ff0000');
  assert.equal(t.tiers.A, presetOf('obsidian').tiers.A);
  assert.equal(t.font, 'mono');
  assert.equal(t.bg, presetOf('obsidian').bg);
  assert.equal(t.customised, true);
  assert.equal(resolveTheme({ base: 'obsidian' }).customised, false);
});

test('a theme code carries the look and nothing else, and a bad one is refused', () => {
  const choice = { base: 'synthwave', custom: { bg: '#101010', tiers: { B: '#00ffff' }, backdrop: 'grid' } };
  const code = encodeTheme(choice);
  assert.match(code, /^sd-theme:/);
  assert.deepEqual(decodeTheme(code), cleanTheme(choice));
  assert.equal(decodeTheme('sd-theme:not base64 json'), null);
  assert.equal(decodeTheme('something else'), null);
  assert.equal(decodeTheme(`sd-theme:${'A'.repeat(3000)}`), null);
  // A hand-made code is cleaned like anything else.
  const crafted = `sd-theme:${Buffer.from(JSON.stringify({ base: 'space', custom: { bg: 'red;}' } })).toString('base64')}`;
  assert.deepEqual(decodeTheme(crafted), { base: 'space', custom: {} });
});

test('light is the background\'s own: a light look turns words and borders dark, a dark one sets none of that', () => {
  assert.deepEqual(THEMES.filter(isLight).map((t) => t.id), ['daylight', 'paper', 'analyst']);
  const dark = themeVars({ base: 'standard' });
  for (const k of ['--sd-ink', '--sd-fg-1', '--sd-gold']) assert.equal(dark[k], undefined, `${k} stays the dark default`);
  const light = themeVars({ base: 'daylight' });
  assert.equal(light['--sd-ink'], '18, 22, 40');
  assert.match(light['--sd-fg-1'], /^#[0-9a-f]{6}$/);
  // Any light background you pick makes it a light look; a dark one takes it back.
  assert.equal(themeAttrs({ base: 'standard', custom: { bg: '#fafafa' } }).mode, 'light');
  assert.equal(themeVars({ base: 'daylight', custom: { bg: '#101010' } })['--sd-fg-1'], undefined);
});

test('buttons and dots are a look\'s own, and only the listed ways', () => {
  assert.deepEqual(cleanTheme({ base: 'standard', custom: { buttons: 'neon', dots: 'droplet' } }).custom, { buttons: 'neon', dots: 'droplet' });
  assert.deepEqual(cleanTheme({ base: 'standard', custom: { buttons: 'url(x)', dots: 'evil' } }).custom, {});
  assert.equal(resolveTheme({ base: 'glass' }).dots, 'droplet');
  assert.equal(resolveTheme({ base: 'obsidian' }).dots, 'flat');
});
