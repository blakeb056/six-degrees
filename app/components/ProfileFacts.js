'use client';

// What a scan read on someone's profile, on their card (Blake, 2026-10-12: "make
// sure that data is showing in the profile card for their insights"): their
// followers and connection count from the top card, the roles their profile
// lists (Dig deeper, lib/experience.js), and how much of their circle is read,
// in the same words as the ring round their dot (lib/reach.js scanFill). Nothing
// when no scan has read any of it.

import { experienceCard, readExperience } from '../../lib/experience';
import { scanFill, scanFillWords } from '../../lib/reach';

const LABEL = {
  fontSize: 11, color: 'var(--sd-fg-3, #888)', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
};
const count = (v) => Number(v).toLocaleString('en-US');
const year = (d) => (d ? String(d).slice(0, 4) : null);

/** "2018 to 2021", "2021 to now", "" with no dates. */
function span(role) {
  const from = year(role.start);
  if (!from) return '';
  return `${from} to ${role.current ? 'now' : year(role.end) || '?'}`;
}

export default function ProfileFacts({ person, reach }) {
  const exp = readExperience(person);
  const card = experienceCard(person);
  const fill = person?.degree === 1 && reach ? scanFill(person, reach) : null;
  // Current roles first, then the rest as their profile lists them.
  const roles = exp?.status === 'read' && Array.isArray(exp.roles)
    ? [...exp.roles].sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)))
    : [];
  const reachLine = card && [
    card.followers != null && `${count(card.followers)} followers`,
    card.connections != null && `${count(card.connections)}${card.connectionsPlus ? '+' : ''} connections`,
  ].filter(Boolean).join(' · ');
  if (!reachLine && !roles.length && exp?.status !== 'unreadable' && !fill) return null;

  return (
    <div data-profile-facts="" style={{ background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={LABEL}>From their profile</div>
      {reachLine && <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--sd-fg-1, #fff)' }}>{reachLine}</div>}
      {fill && (
        <div style={{ fontSize: 11.5, color: 'var(--sd-fg-2, #aab7b7)', marginTop: 4 }}>
          Their circle: {scanFillWords(fill)}.
        </div>
      )}
      {roles.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roles.slice(0, 6).map((r, i) => (
            <li key={`${r.title}-${r.start}-${i}`} style={{ fontSize: 12, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 650, color: r.current ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)' }}>{r.title}</span>
              {r.company && <span style={{ color: 'var(--sd-fg-2, #b8c4c4)' }}> · {r.company}</span>}
              {span(r) && <span style={{ color: 'var(--sd-fg-4, #778)', marginLeft: 6, fontSize: 11 }}>{span(r)}</span>}
            </li>
          ))}
          {roles.length > 6 && <li style={{ fontSize: 11, color: 'var(--sd-fg-4, #778)' }}>and {roles.length - 6} more</li>}
        </ul>
      )}
      {exp?.status === 'unreadable' && (
        <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 8 }}>
          Their experience couldn&rsquo;t be read ({exp.why}). Their score uses their headline.
        </div>
      )}
      {exp?.status === 'read' && (
        <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', marginTop: 8 }}>
          Read {new Date(exp.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Every role counts in their score.
        </div>
      )}
    </div>
  );
}
