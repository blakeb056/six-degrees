'use client';

// The Scan page's view of what LinkedIn allows: the one daily limit (searches a
// day, and its number control), "Lift limits for this session", the cooldown
// lock, and everyone whose list was only partly read, with a way back into
// each. TRAPS §16, §35. The numbers come from /api/scraper
// (lib/linkedin-limits.js, lib/paused.js), which reads the same files the
// scanner writes.
//
// Blake, 2026-10-05: "we need to simplify this and allow more usage as it's
// constrained too much. Just a simple default limit for the day and a button
// to lift restrictions for this session." The budget box's three pickers
// (a day, a month, profile views) and the cooldown's own "Lift it early" are
// gone: one number, one button, no pop-up.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';
import { inProgressSummary } from '../../lib/in-progress';
import { LIFT_LINE } from '../../lib/limits-lift';

const LINE = '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)';
const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
// lib/linkedin-limits.js DAILY_RANGE; that module reads files, so it can't load here.
export const DAILY_MIN = 1;
export const DAILY_MAX = 1000;
const GOLD = 'var(--sd-gold, #FFD700)';

const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** What a typed daily number saves as: a whole number from 1 to 1000, or null for one it can't be. */
export function dailyFrom(text) {
  const n = Number(String(text).trim());
  return Number.isInteger(n) && n >= DAILY_MIN && n <= DAILY_MAX ? n : null;
}

/**
 * Searches a day: a number box with a step down and up. Saved once you stop
 * typing (or press Enter, or leave the box); a number it can't take goes back
 * to the saved one. `small` for the notch.
 */
export function DailyLimitInput({ value, onSave, disabled, small = false, id }) {
  // What's typed, while the box has the focus; null otherwise.
  const [draft, setDraft] = useState(null);
  // A number just saved, and the saved one it replaced: shown until the saved one changes.
  const [pending, setPending] = useState(null);
  const text = draft ?? String(pending && pending.from === value ? pending.n : value ?? '');
  const save = (t = text) => {
    const n = dailyFrom(t);
    if (n == null || n === value || (pending?.n === n && pending.from === value)) return;
    setPending({ n, from: value });
    onSave(n);
  };
  // A pause in typing saves it, as leaving the box does.
  useEffect(() => {
    if (draft == null) return undefined;
    const timer = setTimeout(() => save(draft), 900);
    return () => clearTimeout(timer);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (by) => {
    const n = Math.max(DAILY_MIN, Math.min(DAILY_MAX, (dailyFrom(text) ?? value ?? 50) + by));
    if (draft != null) setDraft(String(n));
    save(String(n));
  };
  const h = small ? 22 : 30;
  const btn = {
    width: h, height: h, padding: 0, borderRadius: 6, border: LINE, cursor: disabled ? 'not-allowed' : 'pointer',
    background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-1, #fff)', fontSize: small ? 13 : 15, lineHeight: 1,
  };
  return (
    <span data-daily-limit="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button type="button" aria-label="Fewer searches a day" disabled={disabled || value <= DAILY_MIN} onClick={() => step(-10)} style={btn}>−</button>
      <input
        id={id} type="number" inputMode="numeric" min={DAILY_MIN} max={DAILY_MAX} step={1} value={text} disabled={disabled}
        aria-label="Searches a day"
        onFocus={() => setDraft(text)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { save(); setDraft(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
        style={{
          width: small ? 52 : 70, height: h, boxSizing: 'border-box', padding: '0 6px', borderRadius: 6, border: LINE, textAlign: 'center',
          background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)',
          fontSize: small ? 12 : 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', MozAppearance: 'textfield',
        }}
      />
      <button type="button" aria-label="More searches a day" disabled={disabled || value >= DAILY_MAX} onClick={() => step(10)} style={btn}>+</button>
    </span>
  );
}

/**
 * "Lift limits for this session": one click, no pop-up, with the line that
 * says what it does beside it. Lifted, a small "Limits lifted" and "Put limits
 * back". Held in the server's memory only (lib/limits-lift.js): quitting
 * Sixgree puts them back.
 */
export function LiftLimits({ lifted, onLift, onPutBack, disabled, small = false }) {
  const size = small ? 11.5 : 12.5;
  if (lifted) {
    return (
      <div data-limits-lifted="" style={{
        display: 'flex', alignItems: small ? 'flex-start' : 'center', flexDirection: small ? 'column' : 'row', gap: 8, flexWrap: 'wrap', fontSize: size, lineHeight: 1.5,
      }}>
        {/* The notch already says "Limits lifted" in its own line. */}
        {!small && <LiftedTag />}
        <span style={{ color: 'var(--sd-fg-3, #8b9a9a)', flex: small ? undefined : '1 1 260px' }}>{LIFT_LINE}</span>
        <button type="button" onClick={onPutBack} disabled={disabled} style={{ ...pill(small), color: 'var(--sd-fg-1, #fff)' }}>Put limits back</button>
      </div>
    );
  }
  return (
    <div data-lift-limits="" style={{ display: 'flex', alignItems: small ? 'flex-start' : 'center', flexDirection: small ? 'column' : 'row', gap: small ? 6 : 10, flexWrap: 'wrap', fontSize: size, lineHeight: 1.5 }}>
      <button type="button" onClick={onLift} disabled={disabled} style={{
        ...pill(small), color: GOLD, borderColor: 'rgba(255,215,0,0.45)', background: 'rgba(255,215,0,0.08)',
      }}>Lift limits for this session</button>
      <span style={{ color: 'var(--sd-fg-3, #8b9a9a)', flex: small ? undefined : '1 1 260px' }}>{LIFT_LINE}</span>
    </div>
  );
}

/** The small gold "Limits lifted" the notch and the Scan page show while they are. */
export function LiftedTag({ small = false }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: small ? '0 7px' : '2px 9px', borderRadius: 999,
      fontSize: small ? 10.5 : 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      color: GOLD, background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: GOLD }} />
      Limits lifted
    </span>
  );
}

const pill = (small) => ({
  padding: small ? '2px 9px' : '6px 12px', borderRadius: 7, fontSize: small ? 11.5 : 12.5, fontWeight: 650, cursor: 'pointer',
  whiteSpace: 'nowrap', fontFamily: 'inherit',
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.16)',
});

/**
 * Scanning is paused after LinkedIn pushed back. Lifting the limits for this
 * session lifts it too (it comes back when Sixgree restarts), from right here.
 */
export function CooldownBanner({ cooldown, onLift, disabled }) {
  if (!cooldown) return null;
  return (
    <div role="status" style={{
      padding: '12px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
      background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.35)', color: 'var(--sd-fg-2, #f3c9c9)',
    }}>
      <b style={{ color: '#ff8080' }}>Scanning is paused until {when(cooldown.until)}.</b>{' '}
      {cooldown.reason}. Nothing that searches LinkedIn will run until then, so the account can recover.
      {onLift && (
        <div style={{ marginTop: 8 }}>
          <LiftLimits lifted={false} onLift={onLift} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

/**
 * Everyone whose list was only partly read: the Scan page's In progress card,
 * with Resume for each and Resume all. Blake, 2026-10-03: "we need to have some
 * sort of in progress ones in the scanner as well to see all the ones they
 * stopped and would like to resume". It used to be folded away in Fine-tune the
 * scanner, where nobody who had just stopped a scan would look; now it stands
 * on its own right after step 4, and only while someone is stopped partway.
 * Each name opens their circle on the map (/?chain=<id>, the link Watch it fill
 * in uses), to see how far it got.
 */
export function PausedList({ paused = [], onResume, onResumeAll, disabled }) {
  const [showAll, setShowAll] = useState(false);
  if (!paused.length) return null;
  const shown = showAll ? paused : paused.slice(0, 8);
  return (
    <section aria-labelledby="in-progress-title" style={{
      margin: '20px 0 4px', borderRadius: 14, overflow: 'hidden',
      border: '1px solid rgba(255,215,0,0.3)', background: 'rgba(255,215,0,0.035)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px 14px', borderBottom: LINE, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 id="in-progress-title" style={{ fontSize: 17, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* The pause sign the person card shows by a name that stopped partway (Sidebar.js StoppedPartway). */}
            <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
              <span style={{ width: 3, height: 12, borderRadius: 1, background: 'var(--sd-gold, #FFD700)' }} />
              <span style={{ width: 3, height: 12, borderRadius: 1, background: 'var(--sd-gold, #FFD700)' }} />
            </span>
            In progress
          </h2>
          <div style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4, lineHeight: 1.5 }}>
            {inProgressSummary(paused)}
          </div>
        </div>
        <button onClick={onResumeAll} disabled={disabled} style={{ ...btn, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' : 'linear-gradient(135deg, #3498DB, #9B59B6)', ...(disabled ? {} : { color: '#fff' }) }}>
          Resume all
        </button>
      </div>
      <div>
        {shown.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[p.tier] || '#667', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Link href={`/?chain=${encodeURIComponent(p.id)}`} title={`See ${p.name}’s circle on the map`} style={{
                  color: 'var(--sd-fg-1, #fff)', textDecoration: 'underline', textDecorationColor: 'rgba(var(--sd-ink, 255, 255, 255), 0.35)', textUnderlineOffset: 3,
                }}>{p.name}</Link>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)' }}>
                Read to page {p.pagesRead} · carries on at {p.nextPage}
                {/* Kept whole: on a phone "Oct" and "3" landed on two lines. */}
                {p.at ? <> <span style={{ whiteSpace: 'nowrap' }}>· {day(p.at)}</span></> : ''}
                {p.unclear >= 2 ? ' · came back unclear twice, so it waits at the back of Resume all' : ''}
              </div>
            </div>
            <button onClick={() => onResume(p)} disabled={disabled} style={{ ...btn, padding: '6px 12px', fontSize: 12, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
              Resume
            </button>
          </div>
        ))}
      </div>
      {paused.length > 8 && (
        <button onClick={() => setShowAll(!showAll)} style={{ ...linkBtn, padding: '10px 18px' }}>
          {showAll ? 'Show fewer' : `Show all ${paused.length}`}
        </button>
      )}
    </section>
  );
}

const btn = {
  padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)',
};
const linkBtn = { background: 'none', border: 'none', color: '#8fb8d6', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 };
const sel = {
  padding: '6px 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)', border: LINE,
};
