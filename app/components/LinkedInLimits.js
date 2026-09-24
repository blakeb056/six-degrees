'use client';

// The Scan page's view of what LinkedIn allows: the search budget, the cooldown
// lock, and everyone whose list was only partly read, with a way back into each.
// TRAPS §35. The numbers come from /api/scraper (lib/linkedin-limits.js,
// lib/paused.js), which reads the same files the scanner writes.

import { useState } from 'react';

const LINE = '1px solid rgba(255,255,255,0.1)';
const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const DAILY = [25, 50, 100, 200, 500];
const MONTHLY = [100, 250, 500, 1000, 0];

const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function CooldownBanner({ cooldown, onLift, disabled }) {
  const [asking, setAsking] = useState(false);
  if (!cooldown) return null;
  return (
    <div role="status" style={{
      padding: '12px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
      background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.35)', color: '#f3c9c9',
    }}>
      <b style={{ color: '#ff8080' }}>Scanning is paused until {when(cooldown.until)}.</b>{' '}
      {cooldown.reason}. Nothing that searches LinkedIn will run until then, so the account can recover.
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!asking ? (
          <button onClick={() => setAsking(true)} disabled={disabled} style={linkBtn}>Lift it early…</button>
        ) : (
          <>
            <span style={{ fontSize: 12.5 }}>Only if people search works normally for you on linkedin.com right now.</span>
            <button onClick={() => { setAsking(false); onLift(); }} style={{ ...linkBtn, color: '#ff8080' }}>Yes, lift it</button>
            <button onClick={() => setAsking(false)} style={linkBtn}>Keep it</button>
          </>
        )}
      </div>
    </div>
  );
}

const pct = (used, cap) => (cap ? Math.min(100, Math.round((used / cap) * 100)) : 0);

function Bar({ used, cap }) {
  const p = pct(used, cap);
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${p}%`, background: p >= 100 ? '#ff6b6b' : p >= 75 ? '#FFD700' : '#3498DB' }} />
    </div>
  );
}

export function BudgetBox({ li, onSetLimits, disabled }) {
  if (!li) return null;
  const { limits } = li;
  const today = li.unreadable ? '?' : li.searchesToday;
  return (
    <div style={{ padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(255,255,255,0.03)', fontSize: 12.5, color: '#b8c4c4' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <div>
          <div><b style={{ color: '#fff' }}>{today}</b> of {limits.daily || 'no limit'} searches in the last 24 hours</div>
          <Bar used={li.searchesToday || 0} cap={limits.daily} />
        </div>
        <div>
          <div><b style={{ color: '#fff' }}>{li.searchesMonth}</b> of {limits.monthly || 'no limit'} this month · resets {day(li.monthResets)}</div>
          <Bar used={li.searchesMonth} cap={limits.monthly} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <span>Budget:</span>
        <select value={limits.daily} disabled={disabled} onChange={(e) => onSetLimits({ daily: Number(e.target.value), monthly: limits.monthly })} style={sel}>
          {DAILY.map((n) => <option key={n} value={n}>{n} a day</option>)}
        </select>
        <select value={limits.monthly} disabled={disabled} onChange={(e) => onSetLimits({ daily: limits.daily, monthly: Number(e.target.value) })} style={sel}>
          {MONTHLY.map((n) => <option key={n} value={n}>{n ? `${n} a month` : 'no monthly cap (Premium)'}</option>)}
        </select>
        <span style={{ color: '#778' }}>{li.profilesToday} profile views today</span>
      </div>
      <div style={{ marginTop: 8, color: '#778', lineHeight: 1.6 }}>
        Every page of someone&rsquo;s connections is one search. LinkedIn limits a free account&rsquo;s people
        searches by the month (it doesn&rsquo;t say how many; reports put it around 250–350), resetting on the 1st.
        When a budget is used, a scan saves what it read and stops; the next one carries on from the same page.
        {limits.daily > 100 && <b style={{ color: '#FFD700' }}> {limits.daily} a day can use up a free account&rsquo;s month in a day or two.</b>}
      </div>
    </div>
  );
}

export function PausedList({ paused = [], onResume, onResumeAll, disabled }) {
  const [showAll, setShowAll] = useState(false);
  if (!paused.length) return null;
  const legacy = paused.filter((p) => p.legacy).length;
  const shown = showAll ? paused : paused.slice(0, 8);
  return (
    <div style={{ borderRadius: 8, border: LINE, background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: LINE, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <b style={{ fontSize: 13.5 }}>Paused — {paused.length} {paused.length === 1 ? 'list' : 'lists'} with more to read</b>
          <div style={{ fontSize: 12, color: '#8b9a9a', marginTop: 2 }}>
            Each carries on from the page it stopped at{legacy ? `; ${legacy} were read to page 10 before whole lists were read` : ''}.
          </div>
        </div>
        <button onClick={onResumeAll} disabled={disabled} style={{ ...btn, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #3498DB, #9B59B6)' }}>
          Resume all
        </button>
      </div>
      <div>
        {shown.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[p.tier] || '#667', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: '#8b9a9a' }}>
                Read to page {p.pagesRead} · carries on at {p.nextPage}
                {p.at ? ` · ${day(p.at)}` : ''}
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
        <button onClick={() => setShowAll(!showAll)} style={{ ...linkBtn, padding: '10px 14px' }}>
          {showAll ? 'Show fewer' : `Show all ${paused.length}`}
        </button>
      )}
    </div>
  );
}

const btn = {
  padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: LINE, background: 'rgba(255,255,255,0.08)', color: '#fff',
};
const linkBtn = { background: 'none', border: 'none', color: '#8fb8d6', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 };
const sel = {
  padding: '6px 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
  background: 'rgba(255,255,255,0.08)', color: '#fff', border: LINE,
};
