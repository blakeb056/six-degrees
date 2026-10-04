'use client';

// Insights → People: the Power Index. Everyone within two steps of you, each
// once, ranked by power, with the filters above it and the rail of boards
// beside it (mock-up B). The table shows a hundred rows at a time (25 on a
// phone), so a network of thousands stays quick; ranks are the whole list's,
// so a filter never renumbers anyone.

import { memo, useDeferredValue, useMemo, useState } from 'react';
import { filterIndex, bandText } from '../../../lib/insights-board';
import { hasRequest } from '../../../lib/requests-client';
import { shortName, TIERS } from '../../../lib/separation';
import { RARITY, toggle } from '../../../lib/rarity';
import Avatar from '../Avatar';
import { TIER_COLORS } from '../../../lib/themes';
import {
  fmt, one, TierChip, DegreeChip, RarityTag, PersonCell, Src, Hero, OpenCircle, ScanCircle, AskButton,
  LINE, SOFT_LINE, CARD_BG, ELLIPSIS,
} from './parts';
import Rail from './Rail';

export const PAGE = 100;
const COLS = '58px minmax(0,1.55fr) 148px minmax(0,1.45fr) 118px 100px';

export default function PeopleView({ data, heavy, open, net, source, isMobile, onView, requests }) {
  const { index } = data;
  const [degree, setDegree] = useState('all');
  const [tiers, setTiers] = useState(() => new Set());
  const [rarities, setRarities] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  // A hundred rows at a time on a computer, twenty-five on a phone, where the boards sit under the table.
  const step = isMobile ? 25 : PAGE;
  const [pages, setPages] = useState(1);
  const shown = pages * step;
  const filtering = degree !== 'all' || tiers.size > 0 || rarities.size > 0 || q.trim() !== '';
  const list = useMemo(() => (filtering ? filterIndex(index, { degree, tiers, rarities, query: q }) : index.people),
    [index, filtering, degree, tiers, rarities, q]);
  const bandAt = useMemo(() => new Map(index.bands.map((b) => [b.start, b])), [index]);
  // A new filter starts from the top again.
  const filterKey = `${degree}|${[...tiers].join()}|${[...rarities].join()}|${q}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) { setLastKey(filterKey); setPages(1); }

  const rows = list.slice(0, shown);
  const left = list.length - rows.length;
  const next = list[rows.length];
  const sameTieLeft = next && rows.length && rows[rows.length - 1].score === next.score
    ? list.slice(rows.length).filter((p) => p.score === next.score).length : 0;
  const scoped = source === 'own';
  // No 2nd degree (a CSV import, or nothing scanned yet): no degree or rarity to filter by.
  const second = index.counts.degree[2] > 0;

  // "All →" on Hidden giants: the table, narrowed to them.
  const showHidden = () => { setDegree(2); setTiers(new Set(['S'])); setRarities(new Set(['only'])); setQuery(''); window.scrollTo(0, 0); };

  const filters = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, flexWrap: 'wrap', padding: isMobile ? '8px 10px' : '10px 12px',
      border: `1px solid ${LINE}`, borderRadius: 12, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.025)', marginBottom: 14,
    }}>
      {second && (
        <Group label="Degree" isMobile={isMobile}>
          {[['all', 'All', index.total], [1, '1st', index.counts.degree[1]], [2, '2nd', index.counts.degree[2]]].map(([k, label, n]) => (
            <Chip key={k} on={degree === k} onClick={() => setDegree(k)} count={n}>{label}</Chip>
          ))}
        </Group>
      )}
      <Group label="Tier" isMobile={isMobile}>
        {TIERS.map((t) => (
          <Chip key={t} on={tiers.has(t)} onClick={() => setTiers((s) => toggle(s, t))} count={index.counts.tiers[t]} title={`${t} tier`}>
            <TierChip tier={t} size={16} />
          </Chip>
        ))}
      </Group>
      {second && (
        <Group label="Rarity" isMobile={isMobile}>
          {RARITY.map((r) => (
            <Chip key={r.key} on={rarities.has(r.key)} onClick={() => setRarities((s) => toggle(s, r.key))} count={index.counts.rarity[r.key]}
              title={`${r.label}: ${r.range} mutual connection${r.range === '1' ? '' : 's'}`}>
              <i className="sd-dot-html" style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, display: 'inline-block' }} />{r.label}
            </Chip>
          ))}
        </Group>
      )}
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search a name, company, or who knows them"
        placeholder="Search a name or company" style={{
          marginLeft: isMobile ? 0 : 'auto', width: isMobile ? '100%' : 240, height: isMobile ? 40 : 32, padding: '0 12px', borderRadius: 8, outline: 'none',
          fontSize: isMobile ? 16 : 12.5, color: 'var(--sd-fg-1, #fff)', border: `1px solid ${LINE}`, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)',
        }} />
    </div>
  );

  return (
    <>
      <Hero title="The Power Index" isMobile={isMobile}>
        {second
          ? <>Everyone within two steps of you, ranked by power: <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{fmt(index.total)}</b> people, each once.</>
          : <>Your connections, ranked by power: <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{fmt(index.total)}</b> people.{' '}
            {source === 'csv' ? 'A CSV import has no circles, so the people one step further out aren’t here.' : 'Scan their circles to add the people one step further out.'}</>}
      </Hero>
      {filters}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 370px', gap: 16, alignItems: 'start' }}>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: CARD_BG, overflow: 'hidden', minWidth: 0 }}>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '0 16px', alignItems: 'center', height: 36, borderBottom: `1px solid ${LINE}`, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.02)', fontSize: 10.5, color: 'var(--sd-fg-4, #6f7a88)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
              <span>Rank</span><span>Person</span><span>Power</span><span>Way in</span><span>Rarity</span><span />
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ padding: '28px 16px', fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>Nobody matches these filters.</div>
          )}
          {rows.map((p, i) => {
            const band = !filtering ? bandAt.get(i) : null;
            return (
              <div key={p.key}>
                {band && <Band band={band} isMobile={isMobile} />}
                <Row p={p} isMobile={isMobile} scoped={scoped} csv={source === 'csv'} asked={p.degree === 2 && hasRequest(p.row, requests)} />
              </div>
            );
          })}
          {left > 0 && (
            <button type="button" onClick={() => setPages((n) => n + 1)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: `1px solid ${LINE}`,
              background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--sd-blue, #3498DB)',
            }}>
              Show {fmt(Math.min(step, left))} more →
              <span style={{ color: 'var(--sd-fg-4, #6f7a88)', fontWeight: 400, marginLeft: 8 }}>
                {sameTieLeft ? `${fmt(sameTieLeft)} more at ${one(next.score)}, ${fmt(left)} in all` : `${fmt(left)} to go`}
              </span>
            </button>
          )}
          <Src style={{ padding: '10px 16px 14px', marginTop: 0 }}>{index.source}</Src>
        </div>
        <Rail data={data} heavy={heavy} open={open} source={source} onView={onView} onHidden={showHidden} isMobile={isMobile} net={net} />
      </div>
    </>
  );
}

function Group({ label, children, isMobile }) {
  // On a phone each group is one row that scrolls sideways, rather than four rows of chips.
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: isMobile ? 'nowrap' : 'wrap', minWidth: 0, ...(isMobile ? { overflowX: 'auto', width: '100%', scrollbarWidth: 'none' } : null) }}>
      <span style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #6f7a88)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginRight: 3 }}>{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, count, children, title }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title} style={{
      fontSize: 12, padding: '4px 9px', borderRadius: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      border: `1px solid ${on ? 'rgba(var(--sd-ink, 255, 255, 255), 0.55)' : LINE}`,
      background: on ? 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
      color: on ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)', fontWeight: on ? 700 : 500,
    }}>
      {children}
      {count != null && <small style={{ color: 'var(--sd-fg-4, #6f7a88)', fontSize: 11 }}>{fmt(count)}</small>}
    </button>
  );
}

/** A tie of many: how many share the score, and the working most of them share. */
function Band({ band, isMobile }) {
  const t = bandText(band);
  const mixed = band.yours > 0 && band.yours < band.count;
  return (
    <div style={{
      display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12, padding: isMobile ? '10px 12px' : '10px 16px',
      background: 'linear-gradient(90deg, rgba(255,215,0,0.1), rgba(255,215,0,0.02))',
      borderTop: '1px solid rgba(255,215,0,0.22)', borderBottom: '1px solid rgba(255,215,0,0.22)',
    }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--sd-gold, #FFD700)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>#{fmt(band.rank)}=</span>
      <span style={{ fontSize: 12.5, color: 'var(--sd-fg-1, #e9edf3)', lineHeight: 1.45 }}>
        <b>{t.head}</b> {t.rest}{' '}
        <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>{mixed ? 'Yours first, then most ways in.' : band.yours ? 'All yours.' : 'Most ways in first.'}</span>
      </span>
    </div>
  );
}

/** One person: rank, who, power, way in, rarity and what to do. */
const Row = memo(function Row({ p, isMobile, scoped, csv, asked }) {
  const rank = `#${fmt(p.rank)}${p.tied ? '=' : ''}`;
  const podium = p.rank <= 5;
  const power = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
      <b style={{ fontSize: isMobile ? 16 : 17, fontWeight: 800, minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--sd-fg-1, #fff)' }}>{one(p.score)}</b>
      <TierChip tier={p.tier} />
      {!isMobile && p.boost > 0 && (
        <span title="Added for a strong circle: their scanned circle holds many S and A people (lib/scoring.js bridge boost, up to +2)" style={{
          fontSize: 10, fontWeight: 700, color: 'var(--sd-green, #00ff88)', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.28)',
          padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap',
        }}>+{p.boost} circle</span>
      )}
    </span>
  );
  const way = <Way p={p} max={isMobile ? 1 : 2} csv={csv} />;
  const rarity = p.degree === 1
    ? <span style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #6f7a88)', whiteSpace: 'nowrap' }}>Your connection</span>
    : <RarityTag rarity={p.rarity} count={!isMobile} small={isMobile} />;
  const action = <Action p={p} scoped={scoped} asked={asked} compact={isMobile} />;

  if (isMobile) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) 66px', columnGap: 8, rowGap: 6, padding: '10px 12px', borderBottom: `1px solid ${SOFT_LINE}` }}>
        <span style={{ gridRow: '1 / span 2', paddingTop: 9, fontSize: 11.5, fontWeight: 700, color: podium ? 'var(--sd-gold, #FFD700)' : 'var(--sd-fg-3, #8b9a9a)', whiteSpace: 'nowrap' }}>{rank}</span>
        <PersonCell row={p.row} size={32} chip={false} />
        <span style={{ justifySelf: 'end' }}>{power}</span>
        <div style={{ gridColumn: '2 / span 2', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1, overflow: 'hidden', fontSize: 12, color: 'var(--sd-fg-2, #b8c4c4)' }}>{way}</span>
          {p.degree === 2 && rarity}
          {action}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '0 16px', alignItems: 'center', minHeight: 56, borderBottom: `1px solid ${SOFT_LINE}` }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: podium ? 'var(--sd-gold, #FFD700)' : 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums' }}>{rank}</span>
      <PersonCell row={p.row} chip={false} />
      {power}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12, color: 'var(--sd-fg-2, #b8c4c4)' }}>{way}</span>
      <span style={{ minWidth: 0 }}>{rarity}</span>
      <span style={{ justifySelf: 'end' }}>{action}</span>
    </div>
  );
});

/** Yours: their circle. 2nd degree: who of yours knows them, best first. */
function Way({ p, max = 2, csv }) {
  if (p.degree === 1) {
    const c = p.circle;
    // A CSV import has no circles to scan: the chip says enough.
    if (csv) return <DegreeChip degree={1} />;
    const text = c.state === 'scanned'
      ? <span style={{ whiteSpace: 'nowrap' }}>Circle {fmt(c.size)} · <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{fmt(c.S + c.A)}</b> S+A</span>
      : <span style={{ color: 'var(--sd-fg-4, #6f7a88)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{c.state === 'hidden' ? 'Their list is hidden' : 'Circle not scanned'}</span>;
    return <><DegreeChip degree={1} />{text}</>;
  }
  const named = p.routes.filter((r) => r.bridge);
  const extra = p.routes.length - Math.min(max, named.length);
  return (
    <>
      <DegreeChip degree={2} />
      <span style={{ display: 'flex', gap: 8, minWidth: 0, overflow: 'hidden' }} title={p.routes.map((r) => (r.bridge ? r.bridge.name : 'a connection the app can’t name')).join('\n')}>
        {named.slice(0, max).map((r) => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>
            <Avatar person={r.bridge} size={18} tierColors={TIER_COLORS} />{shortName(r.bridge.name)}
          </span>
        ))}
        {!named.length && <span style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #6f7a88)', ...ELLIPSIS }}>a connection the app can’t name</span>}
        {extra > 0 && <span style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #6f7a88)', whiteSpace: 'nowrap' }}>+{fmt(extra)}</span>}
      </span>
    </>
  );
}

function Action({ p, scoped, asked, compact }) {
  if (p.degree === 2) return <AskButton row={p.row} bridgeId={p.routes[0]?.id ?? p.row.source_connection_id} asked={asked} compact={compact} />;
  if (p.circle.state === 'scanned') return <OpenCircle id={p.row.id} compact={compact} />;
  if (p.circle.state === 'todo' && scoped) return <ScanCircle id={p.row.id} compact={compact} />;
  return null;
}
