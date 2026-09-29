'use client';

// The sector picks, wherever you choose your field: Scores → Your sector
// (SectorSection.js) and the Scan page's question before the first scan
// (app/components/FieldStep.js). Your picks so far, then a search box, or the
// twelve broad industries, each opening to its narrower sectors from the
// directory (lib/sector-directory.js). Up to three picks. It only picks:
// saving is the page's (lib/settings-client.js).

import { useMemo, useState } from 'react';
import { Body, Btn, LINE } from '../ui';
import { INDUSTRIES } from '../../../lib/companies';
import { MAX_SECTORS } from '../../../lib/sector-focus';
import { DIRECTORY, SECTOR_KEYS, sectorByKey } from '../../../lib/sector-directory';

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Each industry's narrower sectors, in the directory's order.
const SECTORS_OF = new Map(INDUSTRIES.map((g) => [g.key, DIRECTORY.filter((s) => s.group === g.key)]));
const GROUP_OF = new Map(DIRECTORY.map((s) => [s.key, s.group]));
// What the search box looks through: each sector's name, its words, jobs and
// companies, as they read (without the list's "(s)" and "$" marks), so
// "recruiter" finds HR & Recruiting.
const SEARCHABLE = DIRECTORY.map((s) => ({
  sector: s,
  label: s.label.toLowerCase(),
  words: [...s.words, ...(s.roles || []), ...(s.names || []), ...s.companies].map((w) => ` ${w.replace(/\(s\)$|\$$/, '').toLowerCase()}`),
}));
// A sector of work every company has (HR & Recruiting, Legal…) counts firms in
// that line, not every company that employs someone doing it.
const FUNCTION_TITLE = 'Counts firms in this line of work, not every company with someone in the job';

/** Sectors (and whole industries) whose name has the query, or a word or company that starts with it. */
function searchSectors(query) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  return {
    industries: INDUSTRIES.filter((g) => g.label.toLowerCase().includes(q)),
    sectors: SEARCHABLE.filter((s) => s.label.includes(q) || s.words.some((w) => w.includes(` ${q}`))).map((s) => s.sector),
  };
}

/**
 * `sectors` are the picks (keys), `onChange(sectors)` gets the new list.
 * `suggest` is "Suggested from your network" as Scores loads it
 * (/api/settings/sector-suggestions); left out, there are none to show.
 */
export default function SectorPicker({ sectors, onChange, disabled, suggest }) {
  const [query, setQuery] = useState('');
  // Industries shown open; those holding a pick start open.
  const [open, setOpen] = useState(() => new Set(sectors.map((k) => GROUP_OF.get(k) || k)));

  const results = useMemo(() => searchSectors(query), [query]);

  function toggle(key) {
    const on = sectors.includes(key);
    if (!on && sectors.length >= MAX_SECTORS) return;
    const next = on ? sectors.filter((k) => k !== key) : SECTOR_KEYS.filter((k) => k === key || sectors.includes(k));
    // A sector picked from the suggestions or a search shows up in its industry too.
    if (!on && GROUP_OF.has(key)) setOpen((was) => new Set(was).add(GROUP_OF.get(key)));
    onChange(next);
  }

  function flip(group) {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  const full = sectors.length >= MAX_SECTORS;
  // One chip for any pick: an industry or a sector, wherever it's shown.
  const chip = (key, label, { note, title } = {}) => {
    const on = sectors.includes(key);
    return (
      <Chip key={key} color={sectorByKey(key).color} on={on} blocked={!on && full} disabled={disabled} title={title}
        onClick={() => toggle(key)}>
        {label}{note && <span style={{ fontWeight: 400, color: on ? '#dfe7e7' : '#8b9a9a' }}>{note}</span>}
      </Chip>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#8b9a9a' }}>Your picks ({sectors.length} of {MAX_SECTORS}):</span>
        {!sectors.length && <span style={{ fontSize: 13, color: '#667' }}>none yet</span>}
        {sectors.map((k) => {
          const s = sectorByKey(k);
          return (
            <button key={k} type="button" disabled={disabled} onClick={() => toggle(k)} aria-label={`Remove ${s.label}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12.5,
                fontWeight: 600, color: '#fff', background: `${s.color}33`, border: `1px solid ${s.color}`, cursor: 'pointer',
              }}>
              {s.label} <span aria-hidden="true" style={{ color: '#cfd8d8' }}>×</span>
            </button>
          );
        })}
      </div>

      {suggest && <Suggestions state={suggest} chip={chip} />}

      <label htmlFor="sector-search" style={{ display: 'block', fontSize: 13, color: '#8b9a9a', margin: '16px 0 6px' }}>
        Find a sector
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="sector-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Try dentist, bakery or Stripe"
          autoComplete="off" spellCheck={false}
          style={{
            flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 7, fontSize: 14, color: '#fff',
            background: 'rgba(255,255,255,0.05)', border: LINE, outline: 'none',
          }} />
        {query && <Btn onClick={() => setQuery('')}>Clear</Btn>}
      </div>

      {results ? (
        <div style={{ marginTop: 10 }} aria-live="polite">
          {results.industries.length + results.sectors.length === 0 ? (
            <Body style={{ fontSize: 12.5 }}>
              Nothing in the list matches &ldquo;{query.trim()}&rdquo;. Try a job title, a kind of business or a company, or clear
              the search and pick one of the twelve broad industries.
            </Body>
          ) : (
            <div role="group" aria-label="Sectors that match your search" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {results.industries.map((g) => chip(g.key, g.label, { note: ' · the whole industry' }))}
              {results.sectors.map((s) => chip(s.key, s.label, { title: s.kind === 'function' ? FUNCTION_TITLE : `In ${sectorByKey(s.group).label}` }))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {INDUSTRIES.map((g) => {
            const inIndustry = SECTORS_OF.get(g.key);
            const isOpen = open.has(g.key);
            const inside = inIndustry.filter((s) => sectors.includes(s.key)).length;
            return (
              <div key={g.key} style={{ borderTop: LINE, padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  {chip(g.key, g.label, { title: 'The whole industry: companies its sectors place, or whose name or the well-known list says so' })}
                  <button type="button" aria-expanded={isOpen} aria-controls={`sectors-${g.key}`} onClick={() => flip(g.key)}
                    style={{
                      padding: '4px 6px', fontSize: 12.5, color: inside ? '#9fd3ff' : '#8b9a9a', background: 'none', border: 'none',
                      cursor: 'pointer',
                    }}>
                    {isOpen ? '▾' : '▸'} {plural(inIndustry.length, 'sector')}{inside ? ` · ${inside} picked` : ''}
                  </button>
                </div>
                {isOpen && (
                  <div id={`sectors-${g.key}`} role="group" aria-label={`Sectors in ${g.label}`}
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 2px 14px' }}>
                    {inIndustry.map((s) => chip(s.key, s.label, s.kind === 'function' ? { title: FUNCTION_TITLE } : undefined))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** A pick you can turn on and off: an industry or a sector, with its industry's colour. */
function Chip({ color, on, blocked, disabled, title, onClick, children }) {
  return (
    <button type="button" aria-pressed={on} disabled={blocked || disabled} onClick={onClick}
      title={blocked ? `Up to ${MAX_SECTORS} sectors. Turn one off first.` : title}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, maxWidth: '100%',
        fontSize: 12.5, fontWeight: 600, textAlign: 'left', cursor: blocked ? 'not-allowed' : 'pointer',
        color: on ? '#fff' : blocked ? '#556' : '#b8c4c4',
        background: on ? `${color}33` : 'rgba(255,255,255,0.04)',
        border: on ? `1px solid ${color}` : LINE,
      }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: blocked ? 0.4 : 1, flexShrink: 0 }} />
      <span>{children}</span>
    </button>
  );
}

/** "Suggested from your network": the directory's sectors most of your scanned people work in. */
function Suggestions({ state, chip }) {
  const note = { fontSize: 12.5, marginTop: 10 };
  if (state.loading) return <Body style={note}>Looking through your network for suggestions…</Body>;
  if (state.error) return <Body style={note}>Couldn&rsquo;t load suggestions ({state.error}). You can still pick below.</Body>;
  if (!state.scored) return <Body style={note}>Suggestions appear here once you&rsquo;ve scanned your network.</Body>;
  if (!state.list.length) return <Body style={note}>None of the list&rsquo;s sectors stands out among the people you&rsquo;ve scanned yet.</Body>;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 13, color: '#8b9a9a', marginBottom: 6 }}>Suggested from your network</div>
      <div role="group" aria-label="Suggested from your network" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {state.list.map((s) => chip(s.key, s.label, {
          note: `: ${plural(s.people, 'person', 'people')} at ${plural(s.companies, 'company', 'companies')}`,
          title: `In ${sectorByKey(s.group).label}`,
        }))}
      </div>
    </div>
  );
}
