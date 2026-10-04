'use client';

// Insights → Kingmakers, Gatekeepers, Companies and Industries: each board in
// full, a hundred rows at a time. The numbers are lib/insights-board.js's,
// with where they came from under each.

import { useState } from 'react';
import Avatar from '../Avatar';
import { TIER_COLORS } from '../../../lib/themes';
import { shortName } from '../../../lib/separation';
import {
  fmt, one, pc, Hero, PersonCell, Src, NeedsCircles, OpenCircle, Bars, Card, LINE, SOFT_LINE, CARD_BG, ELLIPSIS,
} from './parts';
import { Logo } from './Rail';
import { PAGE } from './PeopleView';

/** A board's table: the header row on a computer, the rows, and Show more. */
function Table({ cols, head, right = [], rows, render, isMobile, source }) {
  const step = isMobile ? 25 : PAGE;
  const [pages, setPages] = useState(1);
  const shown = pages * step;
  const list = rows.slice(0, shown);
  const left = rows.length - list.length;
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: CARD_BG, overflow: 'hidden' }}>
      {!isMobile && (
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '0 16px', alignItems: 'center', height: 36, borderBottom: `1px solid ${LINE}`, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.02)', fontSize: 10.5, color: 'var(--sd-fg-4, #6f7a88)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
          {head.map((h, i) => <span key={i} style={{ textAlign: right.includes(i) ? 'right' : undefined }}>{h}</span>)}
        </div>
      )}
      {list.map((r, i) => (
        <div key={r.key ?? i} style={isMobile
          ? { padding: '10px 12px', borderBottom: `1px solid ${SOFT_LINE}` }
          : { display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '0 16px', alignItems: 'center', minHeight: 54, borderBottom: `1px solid ${SOFT_LINE}` }}>
          {render(r, i)}
        </div>
      ))}
      {left > 0 && (
        <button type="button" onClick={() => setPages((n) => n + 1)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: `1px solid ${LINE}`, background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--sd-blue, #3498DB)' }}>
          Show {fmt(Math.min(step, left))} more → <span style={{ color: 'var(--sd-fg-4, #6f7a88)', fontWeight: 400, marginLeft: 6 }}>{fmt(left)} to go</span>
        </button>
      )}
      <Src style={{ padding: '10px 16px 14px', marginTop: 0 }}>{source}</Src>
    </div>
  );
}

const Rank = ({ n, isMobile }) => <span style={{ fontSize: isMobile ? 11.5 : 13, fontWeight: 700, color: n <= 3 ? 'var(--sd-gold, #FFD700)' : 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums' }}>#{fmt(n)}</span>;
const Num = ({ children, color, big }) => <b style={{ fontSize: big ? 16 : 13.5, fontWeight: big ? 800 : 700, color: color || 'var(--sd-fg-1, #fff)', fontVariantNumeric: 'tabular-nums', display: 'block', textAlign: 'right' }}>{children}</b>;
const Mute = ({ children, right }) => <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums', ...(right ? { display: 'block', textAlign: 'right' } : null) }}>{children}</span>;

/** S and A behind someone, as one bar with the letters on it. */
function SABar({ S, A, max }) {
  return <Bars max={max} parts={[
    { value: S, color: TIER_COLORS.S, label: 'S', ink: TIER_COLORS.S, title: `${fmt(S)} S` },
    { value: A, color: TIER_COLORS.A, label: 'A', ink: TIER_COLORS.A, title: `${fmt(A)} A` },
  ]} />;
}

// ── Kingmakers ──────────────────────────────────────────────────────────────

export function KingmakersBoard({ data, source, isMobile }) {
  const { kings } = data;
  const cols = '52px minmax(0,1.5fr) 80px 56px 56px minmax(0,1.3fr) 70px 100px';
  const max = kings.list[0]?.SA || 1;
  return (
    <>
      <Hero title="Kingmakers" isMobile={isMobile}>
        Your connections by the S and A people in their circle: the doors with the most power behind them. A title says what someone holds; a circle says what they can open.
      </Hero>
      {kings.scanned === 0 ? <Card><NeedsCircles source={source} /></Card> : (
        <Table isMobile={isMobile} cols={cols} rows={kings.list.map((k) => ({ ...k, key: k.row.id }))} source={kings.source}
          head={['Rank', 'Connection', 'Circle', 'S', 'A', 'Behind them', 'S+A', '']} right={[2, 3, 4, 6]}
          render={(k, i) => (isMobile ? (
            <div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', gap: 8, alignItems: 'center' }}>
              <Rank n={i + 1} isMobile />
              <PersonCell row={k.row} size={30} />
              <Num big>{fmt(k.SA)}</Num>
              <span />
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SABar S={k.S} A={k.A} max={max} /><Mute>of {fmt(k.size)}</Mute></span>
              <OpenCircle id={k.row.id} compact />
            </div>
          ) : (
            <>
              <Rank n={i + 1} />
              <PersonCell row={k.row} />
              <Mute right>{fmt(k.size)}</Mute>
              <Num color={TIER_COLORS.S}>{fmt(k.S)}</Num>
              <Num color={TIER_COLORS.A}>{fmt(k.A)}</Num>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SABar S={k.S} A={k.A} max={max} /><Mute>{pc(100 * k.share)}</Mute></span>
              <Num big>{fmt(k.SA)}</Num>
              <span style={{ justifySelf: 'end' }}><OpenCircle id={k.row.id} /></span>
            </>
          ))} />
      )}
    </>
  );
}

// ── Gatekeepers ─────────────────────────────────────────────────────────────

export function GatekeepersBoard({ data, source, isMobile }) {
  const { gates, kings } = data;
  const cols = '52px minmax(0,1.6fr) 70px 110px 76px minmax(0,1fr) 100px';
  const others = Math.max(0, 100 - gates.top3Share);
  return (
    <>
      <Hero title="Gatekeepers" isMobile={isMobile}>
        {kings.scanned === 0 ? 'Who your S and A reach hangs on: the people who reach you through one connection only.'
          : <><b style={{ color: 'var(--sd-fg-1, #fff)' }}>{pc(gates.onlyShare)}</b> of the S and A people you can reach have one way in. Three connections carry <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{pc(gates.top3Share)}</b> of your S and A reach.</>}
      </Hero>
      {kings.scanned === 0 ? <Card><NeedsCircles source={source} /></Card> : (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 2, height: 30, borderRadius: 8, overflow: 'hidden' }}>
              {gates.top3.map((g, i) => (
                <span key={g.row.id} title={`${g.row.name}: ${pc(g.share)} of your S and A reach`} style={{ width: `${g.share}%`, background: ['#00ff88', '#00c46a', '#00984f'][i], display: 'flex', alignItems: 'center', paddingLeft: 10, overflow: 'hidden' }}>
                  <em style={{ fontStyle: 'normal', fontSize: 12, fontWeight: 750, color: '#00170b', whiteSpace: 'nowrap' }}>{shortName(g.row.name)} {pc(g.share)}</em>
                </span>
              ))}
              <span style={{ width: `${others}%`, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', display: 'flex', alignItems: 'center', paddingLeft: 10, overflow: 'hidden' }}>
                <em style={{ fontStyle: 'normal', fontSize: 12, fontWeight: 600, color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>{fmt(Math.max(0, gates.list.length - 3))} others {pc(others)}</em>
              </span>
            </div>
          </div>
          <Table isMobile={isMobile} cols={cols} rows={gates.list.map((g) => ({ ...g, key: g.row.id }))} source={gates.source}
            head={['Rank', 'Connection', 'Circle', 'Only via them', 'Of them S', 'Share of your S and A reach', '']} right={[2, 3, 4]}
            render={(g, i) => (isMobile ? (
              <div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', gap: 8, alignItems: 'center' }}>
                <Rank n={i + 1} isMobile />
                <PersonCell row={g.row} size={30} />
                <span style={{ textAlign: 'right' }}><Num big color="var(--sd-green, #00ff88)">{fmt(g.onlySA)}</Num><div style={{ fontSize: 10, color: 'var(--sd-fg-4, #6f7a88)' }}>only via them</div></span>
                <span />
                <Mute>{fmt(g.onlyS)} S · circle of {fmt(g.size)} · {pc((100 * g.credit) / Math.max(1, gates.totalSA))} of your reach</Mute>
                <OpenCircle id={g.row.id} compact />
              </div>
            ) : (
              <>
                <Rank n={i + 1} />
                <PersonCell row={g.row} />
                <Mute right>{fmt(g.size)}</Mute>
                <Num big color="var(--sd-green, #00ff88)">{fmt(g.onlySA)}</Num>
                <Num color={TIER_COLORS.S}>{fmt(g.onlyS)}</Num>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bars max={gates.top3[0]?.credit || 1} parts={[{ value: g.credit, color: 'var(--sd-green, #00ff88)' }]} height={8} />
                  <Mute>{pc((100 * g.credit) / Math.max(1, gates.totalSA))}</Mute>
                </span>
                <span style={{ justifySelf: 'end' }}><OpenCircle id={g.row.id} /></span>
              </>
            ))} />
        </>
      )}
    </>
  );
}

// ── Companies ───────────────────────────────────────────────────────────────

const SCORE_FROM = { yours: 'your score', known: 'curated list', data: 'public dataset', estimate: 'estimated' };

export function CompaniesBoard({ heavy, isMobile }) {
  const cols = '52px minmax(0,1.6fr) 96px 56px 56px 96px minmax(0,1.2fr) 92px';
  if (!heavy) return <><Hero title="Company power" isMobile={isMobile}>Every company within two steps of you, with everyone’s power added up.</Hero><Card><div style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>Counting…</div></Card></>;
  const { companies } = heavy;
  return (
    <>
      <Hero title="Company power" isMobile={isMobile}>
        <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{fmt(companies.count)}</b> companies someone within two steps of you works at now, with everyone’s power added up: where the power you can reach sits.
      </Hero>
      <Table isMobile={isMobile} cols={cols} rows={companies.list.map((c) => ({ ...c, key: c.name }))} source={`${companies.source} ${companies.bigSource}`}
        head={['Rank', 'Company', 'People', 'S', 'A', 'Total power', 'Ways in', 'Score']} right={[2, 3, 4, 5, 7]}
        render={(c, i) => {
          const ways = (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }} title={c.bridges.map((b) => `${b.bridge.name}: ${fmt(b.people)} there`).join('\n')}>
              <Mute>{fmt(c.waysIn)}</Mute>
              {c.bridges.slice(0, 2).map((b) => (
                <span key={b.bridge.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>
                  <Avatar person={b.bridge} size={16} tierColors={TIER_COLORS} />{shortName(b.bridge.name)}
                </span>
              ))}
              {c.d1 > 0 && <span style={{ fontSize: 11, color: 'var(--sd-green, #7dffc0)', whiteSpace: 'nowrap' }}>{fmt(c.d1)} yours</span>}
            </span>
          );
          const name = (
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Logo name={c.name} size={30} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <b style={{ fontSize: 13.5, fontWeight: 650, ...ELLIPSIS }}>{c.name}</b>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', minWidth: 0 }}>
                  <i className="sd-dot-html" style={{ width: 7, height: 7, borderRadius: '50%', background: c.industry.color, flexShrink: 0 }} />
                  <span style={ELLIPSIS}>{c.industry.label}</span>
                </span>
              </span>
            </span>
          );
          return isMobile ? (
            <div style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', gap: 8, alignItems: 'center' }}>
              <Rank n={i + 1} isMobile />
              {name}
              <span style={{ textAlign: 'right' }}><Num big>{fmt(Math.round(c.total))}</Num><div style={{ fontSize: 10, color: 'var(--sd-fg-4, #6f7a88)' }}>total power</div></span>
              <span />
              <Mute><span style={{ color: TIER_COLORS.S }}>{fmt(c.S)} S</span> · <span style={{ color: TIER_COLORS.A }}>{fmt(c.A)} A</span> · {fmt(c.people)} people · {fmt(c.waysIn)} ways in</Mute>
              <Mute>{one(c.score).replace(/\.0$/, '')}/10</Mute>
            </div>
          ) : (
            <>
              <Rank n={i + 1} />
              {name}
              <Mute right>{fmt(c.people)}</Mute>
              <Num color={TIER_COLORS.S}>{fmt(c.S)}</Num>
              <Num color={TIER_COLORS.A}>{fmt(c.A)}</Num>
              <Num big>{fmt(Math.round(c.total))}</Num>
              {ways}
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Num>{one(c.score).replace(/\.0$/, '')}/10</Num>
                <span style={{ fontSize: 10, color: 'var(--sd-fg-4, #6f7a88)', whiteSpace: 'nowrap' }}>{SCORE_FROM[c.scoreSource]}</span>
              </span>
            </>
          );
        }} />
    </>
  );
}

// ── Industries ──────────────────────────────────────────────────────────────

export function IndustriesBoard({ heavy, isMobile }) {
  const cols = 'minmax(0,1.5fr) 90px 90px 64px 64px minmax(0,1.4fr) 100px';
  if (!heavy) return <><Hero title="Industries" isMobile={isMobile}>Where the power you can reach sits, by industry.</Hero><Card><div style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>Counting…</div></Card></>;
  const { industries } = heavy;
  const top = industries.list[0];
  const max = Math.max(1, ...industries.list.map((e) => e.share));
  return (
    <>
      <Hero title="Industries" isMobile={isMobile}>
        Where the power you can reach sits.{top ? <> <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{top.label}</b> holds {pc(top.share)} of your S and A.</> : null}
      </Hero>
      <Table isMobile={isMobile} cols={cols} rows={industries.list} source={industries.source}
        head={['Industry', 'Companies', 'People', 'S', 'A', 'Share of your S and A', 'Total power']} right={[1, 2, 3, 4, 6]}
        render={(e) => {
          const label = (
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <i className="sd-dot-html" style={{ width: 11, height: 11, borderRadius: 3, background: e.color, flexShrink: 0 }} />
              <b style={{ fontSize: 13.5, fontWeight: 650, ...ELLIPSIS }}>{e.label}</b>
            </span>
          );
          const bar = (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bars max={max} parts={[{ value: e.share, color: e.color, ink: e.color }]} height={10} />
              <Mute>{pc(e.share)}</Mute>
            </span>
          );
          return isMobile ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 6, alignItems: 'center' }}>
              {label}
              <Num big>{pc(e.share)}</Num>
              <Mute>{fmt(e.companies)} companies · {fmt(e.people)} people · <span style={{ color: TIER_COLORS.S }}>{fmt(e.S)} S</span> · <span style={{ color: TIER_COLORS.A }}>{fmt(e.A)} A</span></Mute>
              <span />
            </div>
          ) : (
            <>
              {label}
              <Mute right>{fmt(e.companies)}</Mute>
              <Mute right>{fmt(e.people)}</Mute>
              <Num color={TIER_COLORS.S}>{fmt(e.S)}</Num>
              <Num color={TIER_COLORS.A}>{fmt(e.A)}</Num>
              {bar}
              <Num big>{fmt(e.total)}</Num>
            </>
          );
        }} />
    </>
  );
}

