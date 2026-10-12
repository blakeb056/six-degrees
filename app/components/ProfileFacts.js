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
  // Their roles in their profile's order (newest first), each company's in a row
  // gathered under it once (Blake, 2026-10-12: two Aerotek roles read as two
  // separate places); at most eight shown.
  const roles = exp?.status === 'read' && Array.isArray(exp.roles) ? exp.roles : [];
  const groups = [];
  for (const r of roles.slice(0, 8)) {
    const key = r.companyId || (r.company ? r.company.toLowerCase() : null);
    const last = groups[groups.length - 1];
    if (key && last && last.key === key) last.roles.push(r);
    else groups.push({ key: key || `role-${groups.length}`, company: r.company, logo: r.logo, roles: [r] });
    if (!groups[groups.length - 1].logo && r.logo) groups[groups.length - 1].logo = r.logo;
  }
  const hidden = Math.max(0, roles.length - 8);
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
      {groups.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g, i) => (
            <li key={`${g.key}-${i}`} style={{ fontSize: 12, lineHeight: 1.4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {/* The company's logo, saved on this computer (scrape.py _company_logos); a blank tile without one. */}
              {g.logo
                ? <img src={g.logo} alt="" width={22} height={22} style={{ borderRadius: 4, flexShrink: 0, marginTop: 1, objectFit: 'cover' }} />
                : <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0, marginTop: 1, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' }} />}
              {g.roles.length === 1 ? (
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 650, color: g.roles[0].current ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)' }}>{g.roles[0].title}</span>
                  {g.company && <span style={{ color: 'var(--sd-fg-2, #b8c4c4)' }}> · {g.company}</span>}
                  {span(g.roles[0]) && <span style={{ color: 'var(--sd-fg-4, #778)', fontSize: 11 }}> · {span(g.roles[0])}</span>}
                </span>
              ) : (
                // Several roles at one company: its name once, its roles under it, as LinkedIn shows them.
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>{g.company || 'Company not named'}</span>
                  {g.roles.map((r, j) => (
                    <span key={`${r.title}-${r.start}-${j}`} style={{ paddingLeft: 8, borderLeft: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)' }}>
                      <span style={{ fontWeight: 600, color: r.current ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)' }}>{r.title}</span>
                      {span(r) && <span style={{ color: 'var(--sd-fg-4, #778)', fontSize: 11 }}> · {span(r)}</span>}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
          {hidden > 0 && <li style={{ fontSize: 11, color: 'var(--sd-fg-4, #778)' }}>and {hidden} more</li>}
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
