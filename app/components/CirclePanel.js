'use client';

// The right panel while a circle is open in Bridge Chains (Blake, 2026-10-02:
// "when im in a d2 cluster in the bridges and i open up the people panel it
// should show the cluster of whoever im in"). Who is in their circle, strongest
// first, with the people you added from it at the top: the ones whose own
// circle is the next link in the chain.

import { useMemo, useState, useSyncExternalStore } from 'react';
import Avatar from './Avatar';
import InlineNote, { useFadingNote } from './InlineNote';
import { startHere, busyReason, scansCircleOf, watchScanner, scannerNow } from '../../lib/scraper-client';
import { circleIndex } from '../../lib/circle';
import { reachIndex, reachState } from '../../lib/reach';
import { score1 } from '../../lib/separation';
import { TIER_ORDER } from '../../lib/tiers';

const PAGE = 60;
const rank = (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
  || score1(b) - score1(a)
  || String(a.name || '').localeCompare(String(b.name || ''));
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'Their';

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 8px', borderRadius: 8, boxSizing: 'border-box',
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.06)',
  color: 'var(--sd-fg-1, #fff)', cursor: 'pointer', textAlign: 'left', font: 'inherit', textDecoration: 'none',
};

/** One person: opens their card, or (with `onPress`) does that instead. */
function Row({ person, tierColors, note, noteColor, onSelect, onPress, label, disabled = false }) {
  const body = (
    <>
      <Avatar person={person} size={26} tierColors={tierColors} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.name}
          <span style={{ fontSize: 10, color: tierColors[person.tier] || '#888', fontWeight: 800, marginLeft: 6 }}>{person.tier}</span>
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--sd-fg-3, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[person.title, person.company].filter(Boolean).join(' · ') || ' '}
        </span>
      </span>
      {note && <span style={{ fontSize: 10, fontWeight: 700, color: noteColor || '#888', whiteSpace: 'nowrap' }}>{note}</span>}
    </>
  );
  return onPress
    ? (
      <button type="button" onClick={onPress} disabled={disabled} aria-label={label} title={label}
        style={{ ...rowStyle, borderColor: 'rgba(0,255,136,0.2)', ...(disabled ? { cursor: 'not-allowed', opacity: 0.55 } : null) }}>
        {body}
      </button>
    )
    : <button type="button" onClick={() => onSelect?.(person)} style={rowStyle}>{body}</button>;
}

export default function CirclePanel({ person, connections = [], degree2 = [], scanNotes, tierColors, onSelect, canScan = true }) {
  // Only what the Scan rows need from the scanner (what runs, and whose), so a
  // running scan's log doesn't redraw the whole list every second.
  const running = useSyncExternalStore(watchScanner, () => {
    const s = scannerNow();
    return s.running ? JSON.stringify([s.action, s.target?.id ?? null, s.target?.name ?? null]) : '';
  }, () => '');
  const scan = useMemo(() => {
    if (!running) return { running: false };
    const [action, id, name] = JSON.parse(running);
    return { running: true, action, target: id || name ? { id, name } : null };
  }, [running]);
  const [scanNote, say] = useFadingNote(9000);
  const [asking, setAsking] = useState(null);   // whose start is being checked
  const [tier, setTier] = useState(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const index = useMemo(() => circleIndex(connections, degree2), [connections, degree2]);
  const reach = useMemo(() => reachIndex(connections, degree2, scanNotes), [connections, degree2, scanNotes]);
  const members = useMemo(() => [...(index.circles.get(person.id) || [])].sort(rank), [index, person.id]);
  const added = useMemo(() => [...(index.introduced.get(person.id) || [])].sort(rank), [index, person.id]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(TIER_ORDER.map((t) => [t, 0]));
    for (const m of members) if (c[m.tier] != null) c[m.tier] += 1;
    return c;
  }, [members]);
  const q = query.trim().toLowerCase();
  const list = members.filter((m) => (!tier || m.tier === tier)
    && (q.length < 2 || [m.name, m.title, m.company].some((v) => String(v || '').toLowerCase().includes(q))));
  const color = tierColors[person.tier] || '#888';
  const stateNote = (p) => {
    const s = reachState(p, reach);
    return s === 'ready' ? ['ready to scan', '#00ff88'] : s === 'scanned' ? ['circle scanned', '#74B9FF'] : s === 'hidden' ? ['list hidden', '#888'] : [null];
  };

  return (
    <div>
      {/* No Close row: the Details button docked on the panel's edge closes it (EdgeToggle). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Avatar person={person} size={38} tierColors={tierColors} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--sd-fg-3, #888)', textTransform: 'uppercase' }}>You&rsquo;re in</div>
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color }}>{first(person.name)}&rsquo;s circle</h3>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #999)', marginBottom: 12 }}>
        {[person.title, person.company].filter(Boolean).join(' · ')}
        <button type="button" onClick={() => onSelect?.(person)} style={{
          display: 'block', marginTop: 6, padding: 0, background: 'none', border: 'none', color: '#74B9FF',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>Open {first(person.name)}&rsquo;s card →</button>
      </div>

      {/* The same count as the map: the people you added from here were in it too. */}
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{(members.length + added.length).toLocaleString('en-US')}</div>
      <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)', marginBottom: 10 }}>
        {members.length + added.length === 1 ? 'person' : 'people'} in their circle{added.length ? ` · you added ${added.length} of them` : ''}
      </div>

      {/* Tier chips: tap one to see just them. */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {TIER_ORDER.map((t) => (
          <button key={t} type="button" aria-pressed={tier === t} disabled={!counts[t]}
            onClick={() => { setTier(tier === t ? null : t); setShown(PAGE); }}
            style={{
              padding: '4px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: counts[t] ? 'pointer' : 'default',
              border: `1px solid ${tier === t ? tierColors[t] : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`,
              background: tier === t ? `${tierColors[t]}26` : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
              color: counts[t] ? tierColors[t] : 'var(--sd-fg-5, #444)',
            }}>
            {t} <span style={{ color: 'var(--sd-fg-3, #aaa)', fontWeight: 600 }}>{counts[t]}</span>
          </button>
        ))}
      </div>

      <input type="search" value={query} placeholder={`Search ${first(person.name)}’s circle`}
        onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 14, boxSizing: 'border-box',
          border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: 'var(--sd-fg-1, #fff)', outline: 'none',
        }} />

      {added.length > 0 && !tier && q.length < 2 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sd-green, #00ff88)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
            You added from here ({added.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {added.map((p) => {
              const [note, noteColor] = stateNote(p);
              if (note !== 'ready to scan' || !canScan) {
                return <Row key={p.id} person={p} tierColors={tierColors} note={note} noteColor={noteColor} onSelect={onSelect} />;
              }
              // Starts their scan right here, as their card's Scan does (startHere);
              // it used to open the Scan page to confirm it (Blake, 2026-10-04:
              // "we want seamlessness"). Why it didn't start is a line above.
              const now = scan.running && scansCircleOf(scan, p);
              return (
                <Row key={p.id} person={p} tierColors={tierColors} noteColor="#00ff88"
                  note={now ? 'Scanning…' : asking === p.id ? 'Starting…' : 'Scan →'}
                  disabled={now || scan.running || Boolean(asking)}
                  label={now ? `Scanning ${p.name}’s circle` : scan.running ? `${busyReason(scan)}. One scan at a time.` : `Scan ${p.name}’s circle: it starts here, in the background`}
                  onPress={async () => {
                    say(null);
                    setAsking(p.id);
                    const why = await startHere('bridge', { name: p.name, id: p.id });
                    setAsking(null);
                    say(why ? `${first(p.name)}’s scan didn’t start: ${why}` : null);
                  }} />
              );
            })}
          </div>
          <InlineNote note={scanNote} />
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sd-fg-3, #888)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
        {tier ? `${tier} tier in their circle` : added.length ? 'Everyone else in their circle' : 'Everyone in their circle'} ({list.length.toLocaleString('en-US')})
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #888)', lineHeight: 1.5 }}>
          {members.length === 0 ? 'Their circle isn’t scanned yet.' : 'No one here matches.'}
        </div>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {list.slice(0, shown).map((m) => <Row key={m.id} person={m} tierColors={tierColors} onSelect={onSelect} />)}
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE * 3)} style={{
              background: 'none', border: 'none', color: 'var(--sd-fg-3, #888)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '6px 0', textAlign: 'left',
            }}>Show more ({(list.length - shown).toLocaleString('en-US')} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
