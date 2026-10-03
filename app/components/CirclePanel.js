'use client';

// The right panel while a circle is open in Bridge Chains (Blake, 2026-10-03:
// "when im in a d2 cluster in the bridges and i open up the people panel it
// should show the cluster of whoever im in"). Who is in their circle, strongest
// first, with the people you added from it at the top: the ones whose own
// circle is the next link in the chain.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
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
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
  color: '#fff', cursor: 'pointer', textAlign: 'left', font: 'inherit', textDecoration: 'none',
};

/** One person: opens their card, or (with `href`) goes there instead. */
function Row({ person, tierColors, note, noteColor, onSelect, href, label }) {
  const body = (
    <>
      <Avatar person={person} size={26} tierColors={tierColors} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.name}
          <span style={{ fontSize: 10, color: tierColors[person.tier] || '#888', fontWeight: 800, marginLeft: 6 }}>{person.tier}</span>
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[person.title, person.company].filter(Boolean).join(' · ') || ' '}
        </span>
      </span>
      {note && <span style={{ fontSize: 10, fontWeight: 700, color: noteColor || '#888', whiteSpace: 'nowrap' }}>{note}</span>}
    </>
  );
  return href
    ? <Link href={href} aria-label={label} style={{ ...rowStyle, borderColor: 'rgba(0,255,136,0.2)' }}>{body}</Link>
    : <button type="button" onClick={() => onSelect?.(person)} style={rowStyle}>{body}</button>;
}

export default function CirclePanel({ person, connections = [], degree2 = [], scanNotes, tierColors, onSelect, onToggle, canScan = true }) {
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
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        color: '#888', fontSize: 12, cursor: 'pointer', padding: '0 0 10px', fontWeight: 600,
      }}>
        <span style={{ fontSize: 16 }}>&larr;</span> Close
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Avatar person={person} size={38} tierColors={tierColors} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>You&rsquo;re in</div>
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color }}>{first(person.name)}&rsquo;s circle</h3>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: '#999', marginBottom: 12 }}>
        {[person.title, person.company].filter(Boolean).join(' · ')}
        <button type="button" onClick={() => onSelect?.(person)} style={{
          display: 'block', marginTop: 6, padding: 0, background: 'none', border: 'none', color: '#74B9FF',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}>Open {first(person.name)}&rsquo;s card →</button>
      </div>

      {/* The same count as the map: the people you added from here were in it too. */}
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{(members.length + added.length).toLocaleString('en-US')}</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
        {members.length + added.length === 1 ? 'person' : 'people'} in their circle{added.length ? ` · you added ${added.length} of them` : ''}
      </div>

      {/* Tier chips: tap one to see just them. */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {TIER_ORDER.map((t) => (
          <button key={t} type="button" aria-pressed={tier === t} disabled={!counts[t]}
            onClick={() => { setTier(tier === t ? null : t); setShown(PAGE); }}
            style={{
              padding: '4px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: counts[t] ? 'pointer' : 'default',
              border: `1px solid ${tier === t ? tierColors[t] : 'rgba(255,255,255,0.1)'}`,
              background: tier === t ? `${tierColors[t]}26` : 'rgba(255,255,255,0.03)',
              color: counts[t] ? tierColors[t] : '#444',
            }}>
            {t} <span style={{ color: '#aaa', fontWeight: 600 }}>{counts[t]}</span>
          </button>
        ))}
      </div>

      <input type="search" value={query} placeholder={`Search ${first(person.name)}’s circle`}
        onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 14, boxSizing: 'border-box',
          border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none',
        }} />

      {added.length > 0 && !tier && q.length < 2 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#00ff88', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
            You added from here ({added.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {added.map((p) => {
              const [note, noteColor] = stateNote(p);
              return note === 'ready to scan' && canScan
                ? <Row key={p.id} person={p} tierColors={tierColors} note="Scan… →" noteColor="#00ff88"
                    href={`/setup?scan=${encodeURIComponent(p.id)}`} label={`Scan ${p.name}’s circle: opens the Scan page to confirm`} />
                : <Row key={p.id} person={p} tierColors={tierColors} note={note} noteColor={noteColor} onSelect={onSelect} />;
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
        {tier ? `${tier} tier in their circle` : added.length ? 'Everyone else in their circle' : 'Everyone in their circle'} ({list.length.toLocaleString('en-US')})
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#888', lineHeight: 1.5 }}>
          {members.length === 0 ? 'Their circle isn’t scanned yet.' : 'No one here matches.'}
        </div>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {list.slice(0, shown).map((m) => <Row key={m.id} person={m} tierColors={tierColors} onSelect={onSelect} />)}
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE * 3)} style={{
              background: 'none', border: 'none', color: '#888', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '6px 0', textAlign: 'left',
            }}>Show more ({(list.length - shown).toLocaleString('en-US')} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
