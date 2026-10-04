'use client';

// The cards beside the Power Index: Untapped, Kingmakers, Gatekeepers,
// Hidden giants, Company power, How sure, and Richest?, the honest answer to
// a question the app can't answer (it never sees money). Each card's top five,
// and a link to its board.

import { shortName } from '../../../lib/separation';
import Avatar from '../Avatar';
import { TIER_COLORS } from '../../../lib/themes';
import { fmt, one, pc, Card, CardHead, MiniRow, TierChip, Src, NeedsCircles, ELLIPSIS } from './parts';

export default function Rail({ data, heavy, open, source, onView, onHidden }) {
  const { kings, gates, hidden, sure } = data;
  const circles = kings.scanned > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* The four boards that read circles; with none scanned, one card says so once. */}
      {!circles ? (
        <Card>
          <CardHead title="Kingmakers, Gatekeepers, Hidden giants, Untapped" sub="Who stands behind your connections, read from their circles" />
          <NeedsCircles source={source} compact />
        </Card>
      ) : (
        <>
          <Untapped open={open} />

          <Card>
            <CardHead title="Kingmakers" sub="Most S and A people behind them" more="Board →" onMore={() => onView('kingmakers')} />
            {kings.list.slice(0, 5).map((k, i) => (
              <MiniRow key={k.row.id} first={i === 0} rank={i + 1} value={fmt(k.SA)} label="S+A behind"
                left={<Who row={k.row} sub={<><TierChip tier={k.row.tier} size={15} /><span style={ELLIPSIS}>circle of {fmt(k.size)}</span></>} />} />
            ))}
          </Card>

          <Card>
            <CardHead title="Gatekeepers" sub={`S and A who reach you through one connection only. Top three: ${pc(gates.top3Share)} of your S and A reach.`}
              more="Board →" onMore={() => onView('gatekeepers')} />
            {gates.list.slice(0, 5).map((g, i) => (
              <MiniRow key={g.row.id} first={i === 0} rank={i + 1} value={fmt(g.onlySA)} valueColor="var(--sd-green, #00ff88)" label="S+A only via them"
                left={<Who row={g.row} sub={<><TierChip tier={g.row.tier} size={15} /><span style={ELLIPSIS}>circle of {fmt(g.size)}</span></>} />} />
            ))}
          </Card>

          <Card>
            <CardHead title={`Hidden giants · ${fmt(hidden.count)}`} sub="S-tier with one way in: the connection who knows them is the only door you have."
              more={hidden.count ? 'All →' : null} onMore={onHidden} />
            {hidden.count === 0 ? <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', padding: '2px 0 6px' }}>None yet: every S-tier person you can reach has two or more ways in.</div>
              : hidden.list.slice(0, 4).map((h, i) => (
                <MiniRow key={h.key} first={i === 0} value={one(h.score)} label={h.from === 'linkedin' ? '1 mutual (LinkedIn)' : '1 way in (scans)'}
                  left={<Who row={h.row} sub={<span style={ELLIPSIS}>{[h.row.company, h.via ? `only via ${shortName(h.via.name)}` : 'only via a connection the app can’t name'].filter(Boolean).join(' · ')}</span>} />} />
              ))}
            {hidden.count > 0 && <Src>{fmt(hidden.fromLinkedIn)} from LinkedIn’s own mutual count, {fmt(hidden.fromScans)} from the ways in your scans saw, which can only go up.</Src>}
          </Card>
        </>
      )}

      <Card>
        <CardHead title="Company power" sub="Everyone there now, power added up" more={heavy ? 'Board →' : null} onMore={() => onView('companies')} />
        {!heavy ? <Counting /> : heavy.companies.list.slice(0, 5).map((c, i) => (
          <MiniRow key={c.name} first={i === 0} rank={i + 1} value={fmt(Math.round(c.total))} label="total power"
            left={<span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <Logo name={c.name} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <b style={{ fontSize: 12.5, fontWeight: 650, ...ELLIPSIS }}>{c.name}</b>
                <span style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', ...ELLIPSIS }}>
                  <span style={{ color: TIER_COLORS.S }}>{fmt(c.S)} S</span> · <span style={{ color: TIER_COLORS.A }}>{fmt(c.A)} A</span> · {fmt(c.people)} people
                </span>
              </span>
            </span>} />
        ))}
      </Card>

      <Card>
        <CardHead title="How sure" sub="How much of this ranking rests on a guess" />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <b style={{ fontSize: 26, fontWeight: 850, color: sure.share >= 50 ? 'var(--sd-orange, #FF6B35)' : 'var(--sd-fg-1, #fff)' }}>{pc(sure.share)}</b>
          <span style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.4 }}>
            of these scores lean on an estimate{sure.tie ? <>{sure.share >= 50 ? ', which is why' : '. At the top,'} <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{fmt(sure.tie.count)}</b> people share {one(sure.tie.score)}</> : null}.
          </span>
        </div>
        <Src>{fmt(sure.company + sure.both)} with a company no list knows, {fmt(sure.title + sure.both)} with a title the app couldn’t read. Score the companies you know on the Scores tab and the top of the list separates.</Src>
      </Card>

      <Richest heavy={heavy} />
    </div>
  );
}

function Untapped({ open }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <b style={{ fontSize: 30, fontWeight: 850, color: 'var(--sd-orange, #FF6B35)', fontVariantNumeric: 'tabular-nums' }}>{fmt(open?.total)}</b>
        <span style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.45 }}>
          <b style={{ color: 'var(--sd-fg-1, #fff)' }}>Untapped:</b> S and A people in your 2nd degree with no request out. {fmt(open?.S)} of them S. Requests marked sent so far: {fmt(open?.asked)}.
        </span>
      </div>
    </Card>
  );
}

/** "Richest?": the app never sees money, and says so; power at big companies is what it can count. */
function Richest({ heavy }) {
  return (
    <Card dashed>
      <CardHead title="Richest?" />
      <p style={{ fontSize: 12.5, color: 'var(--sd-fg-1, #e9edf3)', margin: '6px 0 8px', lineHeight: 1.5 }}>
        Six Degrees doesn’t know anyone’s money. LinkedIn shows titles and companies, not wealth. The closest honest measure is
        power: who runs the biggest companies you can reach.
      </p>
      {!heavy ? <Counting /> : (
        <div style={{ display: 'flex', gap: 10 }}>
          <Stat n={heavy.companies.big.people} text={`people whose score rests on a company scored 8 or more (Fortune 500 scale)${heavy.companies.big.people ? `, at ${fmt(heavy.companies.big.companies)} compan${heavy.companies.big.companies === 1 ? 'y' : 'ies'}` : ''}`} />
          <Stat n={heavy.ladder.rungs.find((r) => r.key === 'csuite').total} text="C-suite and founders within two steps, by their headline" />
        </div>
      )}
      <Src>{heavy ? heavy.companies.bigSource : null}</Src>
    </Card>
  );
}

function Stat({ n, text }) {
  return (
    <div style={{ flex: 1, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', borderRadius: 9, padding: '8px 10px', minWidth: 0 }}>
      <b style={{ fontSize: 20, fontWeight: 800, display: 'block', fontVariantNumeric: 'tabular-nums' }}>{fmt(n)}</b>
      <span style={{ fontSize: 11, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.35, display: 'block' }}>{text}</span>
    </div>
  );
}

function Who({ row, sub }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
      <Avatar person={row} size={26} tierColors={TIER_COLORS} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <b style={{ fontSize: 12.5, fontWeight: 650, ...ELLIPSIS }}>{row.name}</b>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', minWidth: 0 }}>{sub}</span>
      </span>
    </span>
  );
}

export function Logo({ name, size = 26 }) {
  const letters = String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: 7, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'var(--sd-fg-2, #b8c4c4)',
    }}>{letters}</span>
  );
}

function Counting() {
  return <div style={{ fontSize: 12, color: 'var(--sd-fg-4, #6f7a88)', padding: '4px 0 6px' }}>Counting…</div>;
}
