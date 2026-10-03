'use client';

// A notification, opened in the right panel (Blake, 2026-10-02: "if it is
// [clicked] then it should take over the right panel and show a more detailed
// version of the notifications telling you what person added back from who and
// that they are a value person if the score is s"). Who it's about comes from
// lib/notifications.js noteSubject; everything shown is on file already.

import Avatar from './Avatar';
import { noteSubject } from '../../lib/notifications';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';

const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
const VALUE = {
  S: 'S-tier: one of the most valuable people in your network to know.',
  A: 'A-tier: a strong person to know.',
};
const ago = (when) => {
  const t = new Date(String(when || '').replace(' ', 'T') + (String(when || '').includes('Z') ? '' : 'Z')).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
};
const btn = {
  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
  border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#ddd',
};

export default function NoteDetail({ note, connections = [], degree2 = [], onBack, onSelect, onOpenCircle, onShowInSeparation }) {
  const { person, via, people } = noteSubject(note, connections, degree2);
  const tier = person?.tier;
  const score = Number.parseFloat(person?.power_score);
  const prestige = Number(person?.company_prestige_score);
  const addedBack = ['added_back', 'request_accepted', 'connection_accepted'].includes(note?.type);
  const hasCircle = person && degree2.some((r) => r.source_connection_id === person.id);

  return (
    <div>
      <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 12 }}>
        ← Back
      </button>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22 }}>{note?.icon || '📌'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.35 }}>{note?.title}</div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>{ago(note?.created_at)}</div>
        </div>
      </div>

      {person && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: `1px solid ${(TIER[tier] || '#555')}55`, background: `${TIER[tier] || '#555'}10` }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar person={person} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{person.name}</div>
              <div style={{ fontSize: 11.5, color: '#aab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.headline || person.company || ''}</div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: TIER[tier] || '#aaa', marginTop: 2 }}>
                {tier ? `${tier}-tier` : 'Not scored yet'}{Number.isFinite(score) ? ` · ${score.toFixed(1)}` : ''}
              </div>
            </div>
          </div>
          {addedBack && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: '#ddd', lineHeight: 1.5 }}>
              <b>{person.name.split(' ')[0]}</b> added you back
              {via ? <>. You met through <b style={{ color: TIER[via.tier] || '#fff' }}>{via.name}</b>.</> : '.'}
            </div>
          )}
          {!addedBack && via && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: '#ddd' }}>
              {person.degree === 2 ? 'In the circle of ' : 'You met through '}<b>{via.name}</b>.
            </div>
          )}
          {VALUE[tier] && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: TIER[tier] }}>{VALUE[tier]}</div>}
          {prestige >= 8 && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#cfd3e6' }}>Works at a top company{person.company ? `, ${person.company}` : ''} (its score: {prestige}).</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
            <button type="button" style={btn} onClick={() => onSelect?.(person)}>Open {person.name.split(' ')[0]}’s card →</button>
            {(hasCircle || person.degree === 1) && onOpenCircle && (
              <button type="button" style={btn} onClick={() => onOpenCircle(person.id)}>
                {hasCircle ? `Open ${person.name.split(' ')[0]}’s circle in Bridge Chains →` : `${person.name.split(' ')[0]}’s circle: not scanned yet`}
              </button>
            )}
            {person.degree === 2 && onShowInSeparation && (
              <button type="button" style={btn} onClick={() => onShowInSeparation({ query: person.name })}>Show in Separation →</button>
            )}
          </div>
        </div>
      )}

      {people.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#6b7090', textTransform: 'uppercase', marginBottom: 8 }}>Who</div>
          {people.slice(0, 12).map((p) => (
            <button key={p.id} type="button" onClick={() => onSelect?.(p)} style={{ ...btn, display: 'flex', gap: 10, alignItems: 'center', width: '100%', marginBottom: 6, fontWeight: 600 }}>
              <Avatar person={p} size={26} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', color: '#fff' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: '#8a8fa8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company || p.headline || ''}</span>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: TIER[p.tier] || '#aaa' }}>{p.tier}</span>
            </button>
          ))}
        </div>
      )}

      {note?.message && (
        <div style={{ marginTop: 14, fontSize: 12, color: '#999', lineHeight: 1.55 }}>{note.message}</div>
      )}
      {!person && !people.length && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#667' }}>Nothing more on file about this one.</div>
      )}
    </div>
  );
}
