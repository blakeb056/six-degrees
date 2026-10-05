import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES, STANDARD, BACKDROPS, FONTS, BUTTONS, DOTS, TIER_KEYS, THEME_SETTING, cleanTheme, resolveTheme, themeVars, themeAttrs, encodeTheme, decodeTheme, presetOf, isLight, luminance,
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
  assert.deepEqual(themeAttrs({ base: 'space' }), { theme: 'space', backdrop: 'stars', mode: 'dark', buttons: 'frosted', dots: 'glow' });
  assert.deepEqual(themeAttrs({ base: 'space', custom: { backdrop: 'none' } }), { theme: 'space', backdrop: 'none', mode: 'dark', buttons: 'frosted', dots: 'glow' });
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
  const choice = { base: 'space', custom: { bg: '#101010', tiers: { B: '#00ffff' }, backdrop: 'grid' } };
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
  assert.deepEqual(THEMES.filter(isLight).map((t) => t.id), ['daylight']);
  const dark = themeVars({ base: 'standard' });
  for (const k of ['--sd-ink', '--sd-fg-1', '--sd-gold']) assert.equal(dark[k], undefined, `${k} stays the dark default`);
  const light = themeVars({ base: 'daylight' });
  assert.equal(light['--sd-ink'], '28, 28, 34');
  assert.match(light['--sd-fg-1'], /^#[0-9a-f]{6}$/);
  // Any light background you pick makes it a light look; a dark one takes it back.
  assert.equal(themeAttrs({ base: 'standard', custom: { bg: '#fafafa' } }).mode, 'light');
  assert.equal(themeVars({ base: 'daylight', custom: { bg: '#101010' } })['--sd-fg-1'], undefined);
});

test('buttons and dots are a look\'s own, and only the listed ways', () => {
  assert.deepEqual(cleanTheme({ base: 'standard', custom: { buttons: 'soft', dots: 'droplet' } }).custom, { buttons: 'soft', dots: 'droplet' });
  assert.deepEqual(cleanTheme({ base: 'standard', custom: { buttons: 'url(x)', dots: 'evil' } }).custom, {});
  assert.equal(resolveTheme({ base: 'glass' }).dots, 'droplet');
  assert.equal(resolveTheme({ base: 'obsidian' }).dots, 'flat');
});

test('Paper is gone, and a look saved or pasted with it becomes Daylight, the other light one, not Standard', () => {
  assert.equal(THEMES.some((t) => t.id === 'paper'), false);
  assert.deepEqual(cleanTheme({ base: 'paper' }), { base: 'daylight', custom: {} });
  // Your own changes on top of it are kept.
  assert.deepEqual(cleanTheme({ base: 'paper', custom: { accent: '#B4532A', font: 'serif' } }), { base: 'daylight', custom: { accent: '#b4532a', font: 'serif' } });
  assert.equal(themeAttrs({ base: 'paper' }).theme, 'daylight');
  assert.equal(themeAttrs({ base: 'paper' }).mode, 'light');
  // A theme code shared while Paper was a look still opens.
  const old = `sd-theme:${Buffer.from(JSON.stringify({ base: 'paper', custom: {} })).toString('base64')}`;
  assert.deepEqual(decodeTheme(old), { base: 'daylight', custom: {} });
  // Only a retired look's name maps: anything else unknown is Standard, as before.
  assert.equal(cleanTheme({ base: 'constructor' }).base, 'standard');
  assert.equal(cleanTheme({ base: { toString: () => 'paper' } }).base, 'standard');
});

test('frosted glass is every look\'s buttons, and soft the only other way', () => {
  assert.deepEqual(BUTTONS, ['frosted', 'soft']);
  for (const t of THEMES) assert.equal(t.buttons, 'frosted', t.id);
  assert.equal(resolveTheme({ base: 'daylight', custom: { buttons: 'soft' } }).buttons, 'soft');
  // A button style that has gone, saved or pasted, or none at all, is frosted: never blank, never a throw.
  for (const gone of ['flat', 'square', 'neon', 'bold', '', null, undefined, 7, { x: 1 }]) {
    const choice = { base: 'obsidian', custom: { buttons: gone, font: 'mono' } };
    assert.deepEqual(cleanTheme(choice), { base: 'obsidian', custom: { font: 'mono' } }, String(gone));
    assert.equal(themeAttrs(choice).buttons, 'frosted', String(gone));
  }
  assert.equal(themeAttrs(null).buttons, 'frosted');
});

test('Analyst and Synthwave are gone: Analyst becomes Daylight, Synthwave Standard, with your changes kept', () => {
  for (const id of ['analyst', 'synthwave']) assert.equal(THEMES.some((t) => t.id === id), false, id);
  assert.deepEqual(cleanTheme({ base: 'analyst' }), { base: 'daylight', custom: {} });
  assert.deepEqual(cleanTheme({ base: 'synthwave' }), { base: 'standard', custom: {} });
  // Your own colours, your own tier colours included, and choices stay; a button style that has gone doesn't.
  const mine = { accent: '#FF2A6D', tiers: { S: '#d55e00', A: '#0072b2' }, font: 'rounded', backdrop: 'horizon', dots: 'plain', glass: 0.4 };
  assert.deepEqual(cleanTheme({ base: 'analyst', custom: { ...mine, buttons: 'square' } }),
    { base: 'daylight', custom: { accent: '#ff2a6d', tiers: { S: '#d55e00', A: '#0072b2' }, font: 'rounded', backdrop: 'horizon', dots: 'plain', glass: 0.4 } });
  assert.deepEqual(cleanTheme({ base: 'synthwave', custom: { ...mine, buttons: 'neon' } }),
    { base: 'standard', custom: { accent: '#ff2a6d', tiers: { S: '#d55e00', A: '#0072b2' }, font: 'rounded', backdrop: 'horizon', dots: 'plain', glass: 0.4 } });
  assert.equal(resolveTheme({ base: 'analyst', custom: mine }).tiers.S, '#d55e00');
  assert.deepEqual(themeAttrs({ base: 'analyst' }), { theme: 'daylight', backdrop: 'none', mode: 'light', buttons: 'frosted', dots: 'solid' });
  assert.deepEqual(themeAttrs({ base: 'synthwave' }), { theme: 'standard', backdrop: 'none', mode: 'dark', buttons: 'frosted', dots: 'solid' });
  // As the network's saved setting, and in a theme code shared before they went.
  assert.deepEqual(THEME_SETTING.parse({ base: 'synthwave', custom: { bg: '#1a0b2e' } }), { base: 'standard', custom: { bg: '#1a0b2e' } });
  const old = `sd-theme:${Buffer.from(JSON.stringify({ base: 'analyst', custom: { tiers: { D: '#8c8c8c' } } })).toString('base64')}`;
  assert.deepEqual(decodeTheme(old), { base: 'daylight', custom: { tiers: { D: '#8c8c8c' } } });
});

test('Daylight\'s words pass WCAG AA on its white glass, and its panels are frosted', () => {
  const vars = themeVars({ base: 'daylight' });
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const k of ['--sd-fg-1', '--sd-fg-2', '--sd-fg-3', '--sd-fg-4', '--sd-fg-5', '--sd-gold', '--sd-blue', '--sd-green']) {
    for (const on of ['#ffffff', '#f4f6fb']) assert.ok(ratio(vars[k], on) >= 4.5, `${k} ${vars[k]} on ${on}: ${ratio(vars[k], on).toFixed(2)}`);
  }
  assert.equal(vars['--sd-fg-1'], '#1d1d1f');
  const alpha = Number(/rgba\(255, 255, 255, ([\d.]+)\)/.exec(vars['--sd-panel'])[1]);
  assert.ok(alpha >= 0.6 && alpha <= 0.8, vars['--sd-panel']);
  assert.match(vars['--sd-panel-blur'], /^blur\((2[4-9]|30)px\) saturate\(1\.8\)$/);
});
