'use client';

// Settings → Sound (Blake, 2026-10-12: "add that into settings for audio"):
// manual mode's chimes (lib/chimes.js), on or off, how loud, and a button for
// each to hear it here. Saved with the scanner's settings (scan-limits.json,
// lib/linkedin-limits.js), because the scanner is what plays them, on this
// computer's speakers, while you page through a list (scripts/scrape.py _chime).
// The preview plays the same bytes in the page.

import { useEffect, useId, useRef, useState } from 'react';
import { Section } from '../ui';
import { CHIME_DEFAULTS, READ_STEPS, chimeWav, readChime } from '../../../lib/chimes';

const SMALL = {
  padding: '5px 11px', borderRadius: 7, fontSize: 12.5, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
  color: 'var(--sd-fg-1, #fff)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.16)',
};

export default function SoundSection() {
  const id = useId();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const urls = useRef(new Map());
  const timers = useRef([]);

  useEffect(() => {
    let gone = false;
    fetch('/api/scraper?usage=1').then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (gone) return;
        const l = u?.limits || {};
        setS({ chimes: l.chimes !== false, chimeVolume: typeof l.chimeVolume === 'number' ? l.chimeVolume : CHIME_DEFAULTS.chimeVolume });
      })
      .catch(() => { if (!gone) setS({ ...CHIME_DEFAULTS }); });
    const made = urls.current;
    const pending = timers.current;
    return () => {
      gone = true;
      pending.forEach(clearTimeout);
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const save = async (next) => {
    setS((cur) => ({ ...cur, ...next }));
    setError(null);
    try {
      const res = await fetch('/api/scraper', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-limits', ...next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Not saved.');
    } catch (e) {
      setError(e.message || 'Not saved.');
    }
  };

  const play = (name) => {
    try {
      let url = urls.current.get(name);
      if (!url) {
        url = URL.createObjectURL(new Blob([chimeWav(name)], { type: 'audio/wav' }));
        urls.current.set(name, url);
      }
      const a = new Audio(url);
      a.volume = s?.chimeVolume ?? CHIME_DEFAULTS.chimeVolume;
      a.play().catch(() => {});
    } catch { /* no sound here */ }
  };

  // A run of pages, as manual mode plays it: a tap for each Next, a chime a step higher for each page, the flourish at the end.
  const playRun = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      timers.current.push(setTimeout(() => play('next'), i * 700));
      timers.current.push(setTimeout(() => play(i === steps - 1 ? 'done' : readChime(i + 1)), i * 700 + 280));
    }
  };

  const on = s?.chimes !== false;
  const volume = Math.round((s?.chimeVolume ?? CHIME_DEFAULTS.chimeVolume) * 100);

  return (
    <Section id="sound" title="Sound">
      <div data-chimes-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
        <input id={id} type="checkbox" checked={on} disabled={!s} onChange={(e) => save({ chimes: e.target.checked })}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Chimes in manual mode
          </label>
          <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
            A tap the moment you click Next, and a chime when each page is read and it&rsquo;s your turn again. Each page in a
            row chimes a step higher, up {READ_STEPS} steps, and a list you finish gets a flourish. Through a break
            (Scanner settings &rarr; Breaks by hand), a quiet tick each second.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10, opacity: on ? 1 : 0.5 }}>
            <label htmlFor={`${id}-vol`} style={{ fontSize: 12.5, fontWeight: 650 }}>Volume</label>
            <input id={`${id}-vol`} type="range" min={0} max={100} step={5} value={volume} disabled={!s || !on}
              onChange={(e) => setS((cur) => ({ ...cur, chimeVolume: Number(e.target.value) / 100 }))}
              onMouseUp={(e) => save({ chimeVolume: Number(e.currentTarget.value) / 100 })}
              onKeyUp={(e) => save({ chimeVolume: Number(e.currentTarget.value) / 100 })}
              onTouchEnd={(e) => save({ chimeVolume: Number(e.currentTarget.value) / 100 })}
              style={{ width: 180, accentColor: '#00c870' }} />
            <span style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>{volume}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" style={SMALL} onClick={() => play('next')}>Next tap</button>
            <button type="button" style={SMALL} onClick={() => play(readChime(1))}>Page read</button>
            <button type="button" style={SMALL} onClick={() => play('done')}>List done</button>
            <button type="button" style={SMALL} onClick={() => play('tick')}>Break tick</button>
            <button type="button" style={{ ...SMALL, color: 'var(--sd-gold, #FFD700)', borderColor: 'rgba(255,215,0,0.4)' }} onClick={playRun}>Play a run</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--sd-fg-4, #778)', lineHeight: 1.6, marginTop: 8 }}>
            The scanner plays them on this computer&rsquo;s speakers while you page through a list, so they sound even when
            Sixgree is behind the Chrome window. Nothing else in Sixgree makes a sound.
          </div>
          {error && <div style={{ fontSize: 12.5, color: 'var(--sd-red, #ff7676)', marginTop: 6 }}>{error}</div>}
        </div>
      </div>
    </Section>
  );
}
