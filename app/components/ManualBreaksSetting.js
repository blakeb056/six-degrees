'use client';

// Scanner settings → Breaks by hand (Blake, 2026-10-15: "let's make them wait every
// 10 pages so that's like 1-10 and then 20 seconds with a ticking sound"). Two
// sliders in the volume slider's style (settings/SoundSection.js): how many pages
// between breaks, and how long each break is. Saved with the scanner's settings
// (scan-limits.json, lib/linkedin-limits.js) when a slider is let go; the scanner
// reads them at each break (scripts/scrape.py manual_break), so a change reaches a
// scan under way. The numbers and their ranges: lib/manual-breaks.js.

import { useId, useState } from 'react';
import {
  BREAK_DEFAULTS, BREAK_EVERY_RANGE, BREAK_SECONDS_RANGE, BREAK_WHY, breakText, validBreakEvery, validBreakSeconds,
} from '../../lib/manual-breaks';

const label = { fontSize: 12.5, fontWeight: 650, minWidth: 92 };
const value = { fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums', minWidth: 64 };
const slider = { width: 180, accentColor: '#00c870' };

/** `limits` is the saved settings (lib/linkedin-limits.js readLimits); `onSave` gets what changed. */
export default function ManualBreaksSetting({ limits, disabled, onSave }) {
  const id = useId();
  const saved = {
    breakEvery: validBreakEvery(limits?.breakEvery) ? limits.breakEvery : BREAK_DEFAULTS.breakEvery,
    breakSeconds: validBreakSeconds(limits?.breakSeconds) ? limits.breakSeconds : BREAK_DEFAULTS.breakSeconds,
  };
  // A slider being moved shows where it is; let go, it's saved and shows the saved number.
  const [drag, setDrag] = useState({});
  const s = { breakEvery: drag.breakEvery ?? saved.breakEvery, breakSeconds: drag.breakSeconds ?? saved.breakSeconds };

  const keep = (key, n) => {
    setDrag((cur) => ({ ...cur, [key]: undefined }));
    if (n !== saved[key]) onSave({ [key]: n });
  };
  const handlers = (key) => ({
    onChange: (e) => setDrag((cur) => ({ ...cur, [key]: Number(e.target.value) })),
    onMouseUp: (e) => keep(key, Number(e.currentTarget.value)),
    onKeyUp: (e) => keep(key, Number(e.currentTarget.value)),
    onTouchEnd: (e) => keep(key, Number(e.currentTarget.value)),
  });

  return (
    <div data-manual-breaks="">
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>Breaks by hand</div>
      <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
        {breakText(s.breakEvery, s.breakSeconds)}: the window holds the next page and ticks each second until the
        countdown ends, and the scan light counts it down.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        <label htmlFor={`${id}-every`} style={label}>Every</label>
        <input id={`${id}-every`} type="range" min={BREAK_EVERY_RANGE.min} max={BREAK_EVERY_RANGE.max} step={1}
          value={s.breakEvery} disabled={disabled} style={slider} {...handlers('breakEvery')} />
        <span style={value}>{s.breakEvery === 1 ? '1 page' : `${s.breakEvery} pages`}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <label htmlFor={`${id}-seconds`} style={label}>Break for</label>
        <input id={`${id}-seconds`} type="range" min={BREAK_SECONDS_RANGE.min} max={BREAK_SECONDS_RANGE.max} step={5}
          value={s.breakSeconds} disabled={disabled} style={slider} {...handlers('breakSeconds')} />
        <span style={value}>{s.breakSeconds} seconds</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--sd-fg-4, #778)', lineHeight: 1.6, marginTop: 8 }}>{BREAK_WHY}</div>
    </div>
  );
}
