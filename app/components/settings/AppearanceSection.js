'use client';

// Settings → Appearance: how the app looks (lib/themes.js). Two ways, as Blake
// asked (2026-10-03): pick one of our looks, or make it yours, colour by colour,
// "like battle field 4 does": the background and what's drawn on it, the
// panels and how much glass, each tier's dot and yours, the lines, the accent
// and the font. Every change shows at once, everywhere, and is kept in this
// browser. A theme code copies the whole look to share; pasting one is checked
// first (lib/themes.js cleanTheme), so it can only ever set colours and choices.

import { useState, useSyncExternalStore } from 'react';
import { Section, Body } from '../ui';
import { THEMES, BACKDROPS, FONTS, TIER_KEYS, resolveTheme, presetOf, encodeTheme, decodeTheme } from '../../../lib/themes';
import { themeNow, serverTheme, setTheme, watchTheme } from '../../../lib/theme-store';

const BACKDROP_LABEL = { none: 'Plain', stars: 'Stars', grid: 'Grid', glow: 'Glow', horizon: 'Horizon' };
const FONT_LABEL = { system: 'System', rounded: 'Rounded', mono: 'Mono', serif: 'Serif' };
const TIER_NAME = { S: 'S tier', A: 'A tier', B: 'B tier', C: 'C tier', D: 'D tier' };

const label = { fontSize: 11, fontWeight: 700, color: '#778', letterSpacing: 0.6, textTransform: 'uppercase', margin: '16px 0 8px' };

/** A small map in a theme's colours: you, a ring of tiers, their circles, the backdrop behind. */
export function ThemePreview({ theme, width = 168, height = 96 }) {
  const t = theme;
  const cx = width * 0.58;
  const cy = height / 2;
  const id = `p-${t.id}-${t.customised ? 'c' : 'p'}`;
  const glass = Math.min(1, Math.max(0, t.glass));
  const ring = TIER_KEYS.map((k, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / TIER_KEYS.length;
    const r = 22 + i * 3;
    return { k, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a };
  });
  const line = (k) => (t.lines === 'one' ? t.line : t.tiers[k]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', borderRadius: 8 }}>
      <defs>
        <radialGradient id={`${id}-glow`}><stop offset="0" stopColor={t.bg2} stopOpacity="0.8" /><stop offset="1" stopColor={t.bg2} stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-glow2`}><stop offset="0" stopColor={t.accent} stopOpacity="0.55" /><stop offset="1" stopColor={t.accent} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stopColor={t.bg2} stopOpacity="0" /><stop offset="1" stopColor={t.bg2} stopOpacity="0.45" /></linearGradient>
      </defs>
      <rect width={width} height={height} fill={t.bg} />
      {t.backdrop === 'stars' && (
        <g fill="#fff">
          <circle cx={width * 0.8} cy={height * 0.2} r={28} fill={`url(#${id}-glow)`} />
          {[[12, 10], [40, 70], [150, 14], [128, 80], [24, 44], [96, 8], [70, 88], [158, 52]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={0.8} opacity={0.85} />)}
        </g>
      )}
      {t.backdrop === 'grid' && (
        <g stroke={t.bg2} strokeWidth={1} opacity={0.9}>
          {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={i * 20} y1={0} x2={i * 20} y2={height} />)}
          {Array.from({ length: 5 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * 20} x2={width} y2={i * 20} />)}
        </g>
      )}
      {t.backdrop === 'glow' && (
        <g>
          <circle cx={width * 0.2} cy={height * 0.25} r={40} fill={`url(#${id}-glow)`} />
          <circle cx={width * 0.85} cy={height * 0.4} r={36} fill={`url(#${id}-glow2)`} />
        </g>
      )}
      {t.backdrop === 'horizon' && (
        <g>
          <rect width={width} height={height} fill={`url(#${id}-sun)`} />
          {Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 21} y1={height * 0.62} x2={(i - 4) * 40 + width / 2} y2={height} stroke={t.bg2} strokeOpacity={0.35} />)}
          <line x1={0} y1={height * 0.62} x2={width} y2={height * 0.62} stroke={t.bg2} strokeOpacity={0.5} />
        </g>
      )}
      {/* The filter panel, as see-through as the theme's glass */}
      <rect x={0} y={0} width={width * 0.24} height={height} fill={t.panel} fillOpacity={0.92 - 0.82 * glass} />
      <rect x={width * 0.24} y={0} width={0.75} height={height} fill="#fff" fillOpacity={0.12} />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={6} y={12 + i * 14} width={width * 0.24 - 12} height={6} rx={3} fill={t.tiers[TIER_KEYS[i]]} fillOpacity={0.55} />)}
      {/* The map */}
      {ring.map((p) => <line key={`l${p.k}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={line(p.k)} strokeOpacity={0.55} strokeWidth={0.8} />)}
      {ring.map((p) => [0, 1, 2].map((j) => {
        const a = p.a + (j - 1) * 0.5;
        const x = p.x + Math.cos(a) * 9;
        const y = p.y + Math.sin(a) * 9;
        return (
          <g key={`k${p.k}${j}`}>
            <line x1={p.x} y1={p.y} x2={x} y2={y} stroke={line(p.k)} strokeOpacity={0.4} strokeWidth={0.6} />
            <circle cx={x} cy={y} r={1.6} fill={t.tiers[TIER_KEYS[(TIER_KEYS.indexOf(p.k) + j + 1) % 5]]} fillOpacity={0.8} />
          </g>
        );
      }))}
      {ring.map((p) => <circle key={`d${p.k}`} cx={p.x} cy={p.y} r={p.k === 'S' ? 4.5 : 3.6} fill={t.tiers[p.k]} />)}
      <circle cx={cx} cy={cy} r={5.5} fill={t.you} stroke={t.accent} strokeWidth={1.2} />
    </svg>
  );
}

function Swatch({ name, value, onChange, title }) {
  return (
    <label title={title || name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 28, height: 28, padding: 0, border: 'none', borderRadius: 6, background: 'none', cursor: 'pointer' }} />
      <span style={{ fontSize: 12.5, color: '#cdd' }}>{name}</span>
    </label>
  );
}

function Pick({ options, value, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onPick(v)} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          border: value === v ? '1px solid var(--sd-accent)' : '1px solid rgba(255,255,255,0.1)',
          background: value === v ? 'color-mix(in srgb, var(--sd-accent) 18%, transparent)' : 'rgba(255,255,255,0.03)',
          color: value === v ? '#fff' : '#99a',
        }}>{text}</button>
      ))}
    </div>
  );
}

export default function AppearanceSection() {
  const choice = useSyncExternalStore(watchTheme, themeNow, serverTheme);
  const theme = resolveTheme(choice);
  const [code, setCode] = useState('');
  const [note, setNote] = useState(null);
  const change = (patch) => setTheme({ base: choice.base, custom: { ...choice.custom, ...patch } });
  const changeTier = (k, v) => change({ tiers: { ...(choice.custom.tiers || {}), [k]: v } });
  const copy = async () => {
    const text = encodeTheme(choice);
    try { await navigator.clipboard.writeText(text); setNote('Copied. Paste it into anyone’s Settings → Appearance.'); }
    catch { setCode(text); setNote('Select the code below and copy it.'); }
  };
  const paste = () => {
    const found = decodeTheme(code);
    if (!found) { setNote('That isn’t a theme code: it starts with sd-theme:'); return; }
    setTheme(found);
    setCode('');
    setNote(`Using it: ${presetOf(found.base).name}${Object.keys(found.custom).length ? ', made someone’s own' : ''}.`);
  };

  return (
    <Section id="appearance" title="Appearance" intro="How the whole app looks: pick one of ours, then make it yours. It changes as you go, and stays in this browser.">
      <div style={label}>Looks</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {THEMES.map((p) => {
          const on = choice.base === p.id;
          const shown = on ? theme : resolveTheme({ base: p.id });
          return (
            <button key={p.id} type="button" aria-pressed={on} onClick={() => setTheme({ base: p.id, custom: {} })}
              title={on && theme.customised ? `${p.name}, with your changes. Click to go back to plain ${p.name}.` : p.blurb}
              style={{
                textAlign: 'left', padding: 8, borderRadius: 12, cursor: 'pointer', color: '#fff',
                border: on ? '2px solid var(--sd-accent)' : '1px solid rgba(255,255,255,0.1)',
                background: on ? 'color-mix(in srgb, var(--sd-accent) 10%, transparent)' : 'rgba(255,255,255,0.03)',
              }}>
              <ThemePreview theme={shown} width={172} height={96} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '8px 2px 2px' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{p.name}</span>
                {on && theme.customised && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--sd-accent)' }}>yours</span>}
              </div>
              <div style={{ fontSize: 11.5, color: '#889', lineHeight: 1.4, margin: '0 2px' }}>{p.blurb}</div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 22, padding: '4px 16px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...label, flex: 1 }}>Make it yours{theme.customised ? '' : `: starting from ${presetOf(choice.base).name}`}</div>
          {theme.customised && (
            <button type="button" onClick={() => setTheme({ base: choice.base, custom: {} })} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: 'none', color: '#aab',
            }}>Back to plain {presetOf(choice.base).name}</button>
          )}
        </div>

        <div style={label}>Background</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <Swatch name="Colour" value={theme.bg} onChange={(v) => change({ bg: v })} title="Behind everything" />
          <Swatch name="Second colour" value={theme.bg2} onChange={(v) => change({ bg2: v })} title="The backdrop's: the nebula, the grid, the glow or the sunset" />
          <Swatch name="Accent" value={theme.accent} onChange={(v) => change({ accent: v })} title="What's picked, and the backdrop's glow" />
        </div>
        <Pick value={theme.backdrop} options={BACKDROPS.map((b) => [b, BACKDROP_LABEL[b]])} onPick={(v) => change({ backdrop: v })} />

        <div style={label}>Dots</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TIER_KEYS.map((k) => <Swatch key={k} name={TIER_NAME[k]} value={theme.tiers[k]} onChange={(v) => changeTier(k, v)} />)}
          <Swatch name="You" value={theme.you} onChange={(v) => change({ you: v })} title="Your own dot, in the middle of the map" />
        </div>

        <div style={label}>Lines</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Pick value={theme.lines} options={[['tier', 'As the person they lead to'], ['one', 'One colour']]} onPick={(v) => change({ lines: v })} />
          {theme.lines === 'one' && <Swatch name="Line colour" value={theme.line} onChange={(v) => change({ line: v })} />}
        </div>

        <div style={label}>Panels</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <Swatch name="Tint" value={theme.panel} onChange={(v) => change({ panel: v })} title="The side panels' colour" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: '#cdd' }}>
            Glass
            <input type="range" min={0} max={100} value={Math.round(theme.glass * 100)} onChange={(e) => change({ glass: Number(e.target.value) / 100 })}
              style={{ width: 160, accentColor: 'var(--sd-accent)' }} />
            <span style={{ color: '#889', fontVariantNumeric: 'tabular-nums', width: 34 }}>{Math.round(theme.glass * 100)}%</span>
          </label>
        </div>

        <div style={label}>Font</div>
        <Pick value={theme.font} options={Object.keys(FONTS).map((f) => [f, FONT_LABEL[f]])} onPick={(v) => change({ font: v })} />

        <div style={label}>Share it</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={copy} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid var(--sd-accent)', background: 'color-mix(in srgb, var(--sd-accent) 16%, transparent)', color: '#fff',
          }}>Copy theme code</button>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a theme code (sd-theme:…)" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') paste(); }}
            style={{ flex: '1 1 220px', minWidth: 0, padding: '7px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.25)', color: '#dde' }} />
          <button type="button" onClick={paste} disabled={!code.trim()} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: code.trim() ? 'pointer' : 'default',
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: code.trim() ? '#dde' : '#667',
          }}>Use it</button>
        </div>
        {note && <Body style={{ fontSize: 12, marginTop: 8 }}>{note}</Body>}
        <Body style={{ fontSize: 11.5, color: '#667', marginTop: 8 }}>
          A code holds colours and choices only, nothing about your network.
        </Body>
      </div>
    </Section>
  );
}
