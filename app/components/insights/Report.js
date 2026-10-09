'use client';

// Insights → Report (mock-up C): the same numbers as the boards, as a page you
// scroll, one section each: a big number, one line that says what it means,
// a picture of it, and where it came from. Nothing here is computed apart
// from lib/insights-board.js.

import Link from 'next/link';
import Avatar from '../Avatar';
import { TIER_COLORS } from '../../../lib/themes';
import { shortName } from '../../../lib/separation';
import { RARITY } from '../../../lib/rarity';
import { DECIDES } from '../../../lib/insights-board';
import { fmt, one, pc, TierChip, Bars, NeedsCircles, LINE, CARD_BG, ELLIPSIS } from './parts';

const TIERS = ['S', 'A', 'B', 'C', 'D'];
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function Section({ id, no, big, bigStyle, head, lede, children, src, isMobile, last }) {
  return (
    <section id={id} style={{ padding: isMobile ? '34px 0 30px' : '44px 0 40px', borderBottom: last ? 'none' : `1px solid ${LINE}`, scrollMarginTop: 80 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--sd-fg-4, #6f7a88)', letterSpacing: 1.5, marginBottom: 8 }}>{String(no).padStart(2, '0')}</div>
      <div style={{ fontSize: isMobile ? 56 : 84, lineHeight: 0.95, fontWeight: 850, letterSpacing: isMobile ? -2 : -3, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', ...bigStyle }}>{big}</div>
      <h2 style={{ fontSize: isMobile ? 21 : 26, lineHeight: 1.2, margin: '12px 0 8px', fontWeight: 750, letterSpacing: -0.4, maxWidth: 720, color: 'var(--sd-fg-1, #fff)' }}>{head}</h2>
      {lede && <p style={{ fontSize: 15, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.55, margin: '0 0 20px', maxWidth: 700 }}>{lede}</p>}
      {children}
      {src && <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #6f7a88)', marginTop: 16, lineHeight: 1.5, maxWidth: 760 }}>{src}</div>}
    </section>
  );
}

const W = ({ children }) => <b style={{ color: 'var(--sd-fg-1, #fff)' }}>{children}</b>;
const Key = ({ color, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
    <i style={{ width: 9, height: 9, borderRadius: 3, background: color, display: 'inline-block' }} />{children}
  </span>
);

/** A row of a bar chart: label, bar, number. */
function BarRow({ label, parts, max, value, cols = '170px 1fr 64px', bold, isMobile }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '118px 1fr 54px' : cols, gap: 12, alignItems: 'center', margin: '7px 0' }}>
      <span style={{ fontSize: 13, color: bold ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)', fontWeight: bold ? 650 : 400, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, ...ELLIPSIS }}>{label}</span>
      <Bars parts={parts} max={max} />
      <b style={{ fontSize: 13.5, fontWeight: 750, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  );
}

const tierParts = (counts) => TIERS.map((t) => ({ value: counts[t] || 0, color: TIER_COLORS[t], ink: TIER_COLORS[t], label: t, title: `${fmt(counts[t])} ${t}` }));

export default function Report({ data, heavy, open, net, source, isMobile }) {
  const { reach, kings, gates, hidden, grid, cover, sure } = data;
  const circles = kings.scanned > 0;
  const own = source === 'own';
  const S = reach.tiers.d1.S + reach.tiers.d2.S;
  const A = reach.tiers.d1.A + reach.tiers.d2.A;
  const k0 = kings.list[0];
  const g0 = gates.list[0];
  const toc = [
    ['reach', 'Reach'], ['power', 'Power'], ['titles', 'Titles'],
    ...(circles ? [['kingmakers', 'Kingmakers'], ['gatekeepers', 'Gatekeepers'], ['hidden', 'Hidden giants'], ['untapped', 'Untapped']] : [['kingmakers', 'Circles']]),
    ['companies', 'Company power'], ['richest', 'Richest?'], ['sure', 'How sure'], ['left', 'What’s left'],
  ];
  const sec = { isMobile };
  // Sections are numbered as they're shown: with no circles, one section stands in for the four that read them.
  let count = 0;
  const no = () => ++count;
  return (
    <div>
      {/* ── Cover ── */}
      <div style={{ padding: isMobile ? '24px 0 24px' : '30px 0 30px', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--sd-fg-3, #8b9a9a)', fontWeight: 700 }}>Network report · {today()}</div>
        <h1 style={{ fontSize: isMobile ? 40 : 58, lineHeight: 1.02, margin: '12px 0', fontWeight: 850, letterSpacing: isMobile ? -1 : -1.5, color: 'var(--sd-fg-1, #fff)' }}>
          Your network,<br />
          <em style={{ fontStyle: 'normal', background: 'linear-gradient(135deg, var(--sd-gold, #FFD700), var(--sd-orange, #FF6B35) 55%, var(--sd-purple, #9B59B6))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>by power.</em>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--sd-fg-2, #b8c4c4)', margin: 0, lineHeight: 1.5, maxWidth: 620 }}>
          {source === 'csv'
            ? <>What your {fmt(reach.d1)} connections add up to: where the power is, and what a scan of their circles would open.</>
            : <>What your {fmt(reach.d1)} connections and the {fmt(reach.circles)} circle{reach.circles === 1 ? '' : 's'} you’ve scanned add up to: where the power is, who holds the doors, and what’s still closed.</>}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginTop: 28 }}>
          <CoverStat n={reach.total} label={circles ? 'people within two steps' : 'connections'} />
          <CoverStat n={S} label="S-tier in reach" color={TIER_COLORS.S} />
          {circles
            ? <CoverStat n={open?.total} label="S and A not asked" color="var(--sd-orange, #FF6B35)" />
            : <CoverStat n={heavy ? heavy.companies.count : null} label="companies they work at" />}
          <CoverStat n={reach.circles} label={`circle${reach.circles === 1 ? '' : 's'} scanned of ${fmt(reach.d1)}`} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 24 }}>
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ fontSize: 12, color: 'var(--sd-fg-2, #b8c4c4)', padding: '5px 10px', borderRadius: 16, border: `1px solid ${LINE}`, background: CARD_BG, textDecoration: 'none' }}>{label}</a>
          ))}
        </div>
      </div>

      {/* ── 01 Reach ── */}
      <Section id="reach" no={no()} {...sec} big={fmt(reach.total)} head={circles ? 'people within two steps of you.' : 'connections, and no circles yet.'}
        lede={circles
          ? <>Your {fmt(reach.d1)} connections, and everyone in the {fmt(reach.circles)} circle{reach.circles === 1 ? '' : 's'} you’ve scanned so far. Each circle added about <W>{fmt(cover.perCircle)}</W> people you didn’t already reach.</>
          : source === 'csv'
            ? 'A CSV import is your connections only: the export has no circles. A scan of their circles adds the people one step further out.'
            : <>Your {fmt(reach.d1)} connections. Their circles add the people one step further out, once they’re scanned.</>}
        src={`${reach.source}${reach.sharedRows ? ` ${fmt(reach.sharedRows)} times, someone turned up in another circle as well; they count once here.` : ''}`}>
        <div style={{ display: 'flex', gap: 2, height: 22, borderRadius: 6, overflow: 'hidden' }}>
          <span style={{ width: `${(100 * reach.d1) / Math.max(1, reach.total)}%`, background: 'var(--sd-green, #00ff88)' }} />
          <span style={{ width: `${(100 * reach.d2) / Math.max(1, reach.total)}%`, background: 'var(--sd-orange, #FF6B35)' }} />
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 10, fontSize: 13, color: 'var(--sd-fg-2, #b8c4c4)', flexWrap: 'wrap' }}>
          <Key color="var(--sd-green, #00ff88)"><W>{fmt(reach.d1)}</W> your connections</Key>
          {circles && <Key color="var(--sd-orange, #FF6B35)"><W>{fmt(reach.d2)}</W> in the circles you’ve scanned</Key>}
          {reach.d3 > 0 && <Key color="var(--sd-fg-5, #556)"><W>{fmt(reach.d3)}</W> more from company scans, not counted here</Key>}
        </div>
      </Section>

      {/* ── 02 Power ── */}
      <Section id="power" no={no()} {...sec} big={fmt(S)} bigStyle={{ color: TIER_COLORS.S }}
        head={reach.tiers.d2.S > reach.tiers.d1.S ? 'of them are S-tier, and most sit one step out.' : 'of them are S-tier.'}
        lede={circles
          ? <><W>{fmt(reach.tiers.d2.S)}</W> S-tier people are in your 2nd degree against <W>{fmt(reach.tiers.d1.S)}</W> among your own connections. Another {fmt(A)} are A.</>
          : <>That’s {pc((100 * reach.tiers.d1.S) / Math.max(1, reach.d1))} of your {fmt(reach.d1)} connections. Another {fmt(A)} are A.</>}
        src="Tiers as Scores → Tiers sets them: on your network’s curve unless you chose the fixed scale. A tier is a statement about network position, not human worth.">
        <BarRow {...sec} label="Your connections" parts={tierParts(reach.tiers.d1)} value={`${fmt(reach.tiers.d1.S)} S`} cols="150px 1fr 80px" />
        {circles && <BarRow {...sec} label="Your 2nd degree" parts={tierParts(reach.tiers.d2)} value={`${fmt(reach.tiers.d2.S)} S`} cols="150px 1fr 80px" />}
      </Section>

      {/* ── 03 Titles ── */}
      <Section id="titles" no={no()} {...sec} big={heavy ? fmt(heavy.ladder.decide) : '…'}
        head={heavy && heavy.ladder.rungs.find((r) => r.key === 'owner').total ? 'run something: C-suite, founders, owners and VPs.' : 'run something: C-suite, founders and VPs.'}
        lede={heavy ? (() => {
          const r = Object.fromEntries(heavy.ladder.rungs.map((x) => [x.key, x]));
          return <>{fmt(r.csuite.total)} C-suite and founders, {fmt(r.vp.total)} VPs, partners and GMs{r.owner.total ? `, ${fmt(r.owner.total)} owners` : ''}. {fmt(heavy.ladder.decideYours)} of them are already your connections.</>;
        })() : 'Reading every headline…'}
        src={heavy?.ladder.source}>
        {heavy && (() => {
          const rungs = heavy.ladder.rungs.filter((r) => r.total);
          const max = Math.max(1, ...rungs.map((r) => r.total));
          return rungs.map((r) => {
            const top = DECIDES.includes(r.key);
            return <BarRow key={r.key} {...sec} label={r.label} bold={top} max={max} value={fmt(r.total)}
              parts={[{ value: r.total, color: top ? 'var(--sd-fg-1, #e8ecf2)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.4)' }]} />;
          });
        })()}
      </Section>

      {/* ── Kingmakers, Gatekeepers, Hidden giants and Untapped read circles; with none, one section says so ── */}
      {!circles ? (
        <Section id="kingmakers" no={no()} {...sec} big="No circles" bigStyle={{ fontSize: isMobile ? 40 : 56, letterSpacing: -1.5, color: 'var(--sd-fg-3, #8b9a9a)' }}
          head="Kingmakers, Gatekeepers, Hidden giants and Untapped read your connections’ circles.">
          <NeedsCircles source={source} />
        </Section>
      ) : (<>
      {/* ── Kingmakers ── */}
      <Section id="kingmakers" no={no()} {...sec} big={fmt(k0.SA)} bigStyle={{ color: TIER_COLORS.S }}
        head={<>S and A people sit behind {k0.row.name}. Your biggest door is {k0.row.tier}-tier.</>}
        lede={<>{k0.row.name}’s circle holds {fmt(k0.S)} S and {fmt(k0.A)} A, of {fmt(k0.size)} people. A title says what someone holds; a circle says what they can open.</>}
        src={`${kings.source} A strong circle adds up to 2 to someone’s own score.`}>
          <>
            {kings.list.slice(0, 6).map((k) => (
              <BarRow key={k.row.id} {...sec} cols="230px 1fr 50px" max={k0.SA} value={fmt(k.SA)}
                label={<><Avatar person={k.row} size={22} tierColors={TIER_COLORS} /><span style={ELLIPSIS}>{k.row.name}</span><TierChip tier={k.row.tier} size={16} /></>}
                parts={[{ value: k.S, color: TIER_COLORS.S, ink: TIER_COLORS.S, label: 'S' }, { value: k.A, color: TIER_COLORS.A, ink: TIER_COLORS.A, label: 'A' }]} />
            ))}
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 10 }}>
              <Key color={TIER_COLORS.S}>S behind them</Key><Key color={TIER_COLORS.A}>A behind them</Key>
            </div>
          </>
      </Section>

      {/* ── Gatekeepers ── */}
      <Section id="gatekeepers" no={no()} {...sec} big={pc(gates.onlyShare)} bigStyle={{ color: 'var(--sd-green, #00ff88)' }}
        head="of the S and A people you can reach have one way in."
        lede={g0 ? <>Your reach hangs on a few people. Three connections carry <W>{pc(gates.top3Share)}</W> of it, and if {g0.row.name} disappeared from your network tomorrow, <W>{fmt(g0.onlySA)}</W> S and A people would drop off your map.</> : null}
        src={gates.source}>
          <>
            <div style={{ display: 'flex', gap: 2, height: 34, borderRadius: 8, overflow: 'hidden' }}>
              {gates.top3.map((g, i) => (
                <span key={g.row.id} style={{ width: `${g.share}%`, background: ['#00ff88', '#00c46a', '#00984f'][i], display: 'flex', alignItems: 'center', paddingLeft: 10, overflow: 'hidden' }}>
                  <em style={{ fontStyle: 'normal', fontSize: 12, fontWeight: 750, color: '#00170b', whiteSpace: 'nowrap' }}>{shortName(g.row.name)}</em>
                </span>
              ))}
              <span style={{ flex: 1, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
                <em style={{ fontStyle: 'normal', fontSize: 12, color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>{fmt(Math.max(0, gates.list.length - 3))} others</em>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
              {gates.list.slice(0, 3).map((g) => (
                <div key={g.row.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, background: CARD_BG, fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.35 }}>
                  <Avatar person={g.row} size={30} tierColors={TIER_COLORS} />
                  <span><b style={{ color: 'var(--sd-green, #00ff88)', fontSize: 16 }}>{fmt(g.onlySA)}</b> S and A only through <W>{g.row.name}</W></span>
                </div>
              ))}
            </div>
          </>
      </Section>

      {/* ── Hidden giants ── */}
      <Section id="hidden" no={no()} {...sec} big={fmt(hidden.count)} bigStyle={{ color: 'var(--sd-cyan, #00E5FF)' }}
        head="hidden giants: S-tier, one way in." lede="The connection who knows them is the only door you have."
        src={hidden.source}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            {hidden.list.slice(0, 6).map((h) => (
              <div key={h.key} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 12, background: CARD_BG, minWidth: 0 }}>
                <Avatar person={h.row} size={36} tierColors={TIER_COLORS} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 14, ...ELLIPSIS }}>{h.row.name}</b>
                  <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', ...ELLIPSIS }}>{h.row.company || h.row.headline}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--sd-fg-2, #b8c4c4)', ...ELLIPSIS }}>
                    only via {h.via ? h.via.name : 'a connection the app can’t name'} · {h.from === 'linkedin' ? '1 mutual connection (platform count)' : '1 way in (your scans)'}
                  </span>
                </div>
                <em style={{ fontStyle: 'normal', fontWeight: 800, fontSize: 17, color: TIER_COLORS.S }}>{one(h.score)}</em>
              </div>
            ))}
          </div>
      </Section>

      {/* ── Untapped ── */}
      <Section id="untapped" no={no()} {...sec} big={fmt(open?.total)} bigStyle={{ color: 'var(--sd-orange, #FF6B35)' }}
        head={open?.askedSA === 0 ? 'S and A people you haven’t asked. That’s all of them.' : 'S and A people you haven’t asked.'}
        lede={<><W>{fmt(grid.grid.S.warm)}</W> of the S-tier are warm, with 31 or more mutual connections: the easiest asks you have. <W>{fmt(grid.grid.S.only)}</W> are the hidden giants above.</>}
        src={`${open?.source} ${grid.source}`}>
        <RarityGrid grid={grid.grid} isMobile={isMobile} />
      </Section>
      </>)}

      {/* ── 08 Company power ── */}
      <Section id="companies" no={no()} {...sec} big={heavy?.companies.list[0]?.name || '…'} bigStyle={{ fontSize: isMobile ? 38 : 56, letterSpacing: -1.5, color: 'var(--sd-fg-1, #fff)' }}
        head="holds the most power you can reach."
        lede={heavy?.companies.list[0] ? (() => {
          const c = heavy.companies.list[0];
          const ind = heavy.industries.list[0];
          return <>{fmt(c.people)} people work there, {fmt(c.S)} of them S-tier, with <W>{fmt(c.waysIn)}</W> way{c.waysIn === 1 ? '' : 's'} in.{ind ? <> By industry, <W>{ind.label}</W> holds {pc(ind.share)} of your S and A.</> : null}</>;
        })() : null}
        src={heavy ? `${heavy.companies.source} ${heavy.industries.source}` : null}>
        {heavy && (() => {
          const cos = heavy.companies.list.slice(0, 5);
          const max = cos[0]?.total || 1;
          return (
            <>
              {cos.map((c) => (
                <BarRow key={c.name} {...sec} cols="190px 1fr 64px" max={max} value={fmt(Math.round(c.total))} label={c.name}
                  parts={[{ value: c.total, color: 'var(--sd-gold, #FFD700)', title: `${fmt(c.S)} S, ${fmt(c.people)} people` }]} />
              ))}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14, fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)' }}>
                {heavy.industries.list.slice(0, 4).map((e) => <Key key={e.key} color={e.color}>{e.label} <W>{pc(e.share)}</W></Key>)}
              </div>
            </>
          );
        })()}
      </Section>

      {/* ── 09 Richest? ── */}
      <Section id="richest" no={no()} {...sec} big="Richest?" bigStyle={{ fontSize: isMobile ? 40 : 56, letterSpacing: -1.5, color: 'var(--sd-gold, #FFD700)' }}
        head="The app can’t know, and won’t guess."
        lede="Sixgree doesn’t know anyone’s money. Profiles show titles and companies, not wealth. The closest honest measure is power: who runs the biggest companies you can reach."
        src={heavy?.companies.bigSource}>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['Net worth', 'Pay', 'Company revenue', 'Funding raised'].map((x) => (
            <li key={x} style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', padding: '5px 10px', borderRadius: 16, border: '1px solid rgba(255,80,80,0.3)', background: 'rgba(255,80,80,0.05)', textDecoration: 'line-through' }}>{x}</li>
          ))}
        </ul>
        {heavy && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
            <Dashed n={heavy.companies.big.people} text="people whose score rests on a company scored 8 or more, Fortune 500 scale" />
            <Dashed n={heavy.ladder.rungs.find((r) => r.key === 'csuite').total} text="C-suite and founders within two steps, by their headline" />
            <Dashed n={data.index.people.filter((p) => p.score >= 8).length} text="people at 8 power or more" />
          </div>
        )}
      </Section>

      {/* ── 10 How sure ── */}
      <Section id="sure" no={no()} {...sec} big={pc(sure.share)} bigStyle={{ color: sure.share >= 50 ? 'var(--sd-orange, #FF6B35)' : 'var(--sd-fg-1, #fff)' }}
        head="of these scores lean on an estimate."
        lede={heavy ? <>{fmt(heavy.companies.estimated)} of {fmt(heavy.companies.count)} companies here are ones no list knows and you haven’t scored, so they score from how many of your people work there.{sure.tie ? <> {sure.share >= 50 ? 'That’s why' : 'At the top,'} <W>{fmt(sure.tie.count)}</W> people tie at {one(sure.tie.score)}.</> : null} Score the companies you know on the Scores tab and the top of every list separates.</> : null}
        src={sure.source}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
          <Plain n={heavy ? heavy.companies.estimated : null} text={`compan${heavy?.companies.estimated === 1 ? 'y' : 'ies'} estimated`} />
          <Plain n={sure.title + sure.both} text="titles the app couldn’t read" />
          <Plain n={sure.tie?.count ?? 0} text={sure.tie ? `people tied at ${one(sure.tie.score)}, the top tie` : 'no big tie at the top'} />
        </div>
      </Section>

      {/* ── 11 What's left ── */}
      <Section id="left" no={no()} {...sec} last big={fmt(cover.todoS)} bigStyle={{ color: TIER_COLORS.S }}
        head={`S-tier circle${cover.todoS === 1 ? ' is' : 's are'} still closed.`}
        lede={source === 'csv'
          ? 'A CSV import is your connections only. Scanning your own network opens their circles.'
          : <>You’ve scanned {fmt(cover.scanned)} of {fmt(cover.total)} circles, {fmt(cover.byTier.S.scanned)} of them S-tier{cover.hidden ? `, and ${fmt(cover.hidden)} keep their list hidden` : ''}. {cover.strongest.length ? <>The next {cover.strongest.length === 1 ? 'strongest is' : `${cover.strongest.length} strongest are`} below: up to {fmt(cover.nextSearches)} searches, about {fmt(cover.nextDays)} day{cover.nextDays === 1 ? '' : 's'} at {fmt(cover.daily)} a day.</> : null}</>}
        src={source === 'csv' ? null : <>{cover.source} Lists read to the end: {fmt(cover.lists.full)}; stopped partway: {fmt(cover.lists.partial)}; not recorded: {fmt(cover.lists.unknown)}.</>}>
        {TIERS.map((t) => {
          const c = cover.byTier[t];
          return (
            <div key={t} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 90px', gap: 12, alignItems: 'center', margin: '5px 0' }}>
              <TierChip tier={t} />
              <Bars max={c.total || 1} height={12} parts={[{ value: c.scanned, color: TIER_COLORS[t] }, { value: c.hidden, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.25)' }]} />
              <span style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><W>{fmt(c.scanned)}</W> of {fmt(c.total)}</span>
            </div>
          );
        })}
        {cover.strongest.length > 0 && source !== 'csv' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {cover.strongest.map((p) => {
              const chip = <><Avatar person={p} size={22} tierColors={TIER_COLORS} />{p.name}<span style={{ color: 'var(--sd-fg-4, #6f7a88)' }}>{one(p.power_score)}</span></>;
              const style = { display: 'inline-flex', gap: 7, alignItems: 'center', fontSize: 12.5, padding: '5px 11px 5px 5px', borderRadius: 18, border: `1px solid ${LINE}`, background: CARD_BG, color: 'var(--sd-fg-1, #fff)', textDecoration: 'none' };
              return own
                ? <Link key={p.id} href={`/setup?scan=${encodeURIComponent(p.id)}`} title={`Scan ${p.name}’s circle: opens the Scan page with them picked`} style={style}>{chip}</Link>
                : <span key={p.id} style={style}>{chip}</span>;
            })}
          </div>
        )}
        {own && (
          <Link href="/setup" style={{ display: 'inline-flex', fontSize: 13, fontWeight: 750, color: '#000', background: 'linear-gradient(135deg, #00ff88, #1abc9c)', padding: '8px 14px', borderRadius: 8, marginTop: 16, textDecoration: 'none' }}>
            Open Scan →
          </Link>
        )}
      </Section>
    </div>
  );
}

function CoverStat({ n, label, color }) {
  return (
    <div style={{ borderLeft: `2px solid ${LINE}`, padding: '2px 0 2px 14px' }}>
      <b style={{ display: 'block', fontSize: 30, fontWeight: 800, color: color || 'var(--sd-fg-1, #fff)', fontVariantNumeric: 'tabular-nums' }}>{n == null ? 'None' : fmt(n)}</b>
      <span style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)' }}>{label}</span>
    </div>
  );
}

function Dashed({ n, text }) {
  return (
    <div style={{ padding: 14, border: '1px dashed rgba(255,215,0,0.35)', borderRadius: 12, background: 'rgba(255,215,0,0.035)' }}>
      <b style={{ fontSize: 28, fontWeight: 800, display: 'block', fontVariantNumeric: 'tabular-nums' }}>{fmt(n)}</b>
      <span style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.4, display: 'block', marginTop: 2 }}>{text}</span>
    </div>
  );
}

function Plain({ n, text }) {
  return (
    <div style={{ padding: 14, border: `1px solid ${LINE}`, borderRadius: 12, background: CARD_BG }}>
      <b style={{ fontSize: 26, fontWeight: 800, display: 'block', fontVariantNumeric: 'tabular-nums' }}>{n == null ? '…' : fmt(n)}</b>
      <span style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

/** S and A by rarity: the cells shaded by how many, the hidden giants and the warm S marked. */
function RarityGrid({ grid, isMobile }) {
  const max = Math.max(1, ...['S', 'A'].flatMap((t) => RARITY.map((r) => grid[t][r.key])));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(5, minmax(0, 1fr))`, gap: 4 }}>
      <div />
      {RARITY.map((r) => (
        <div key={r.key} style={{ fontSize: isMobile ? 10 : 11.5, color: 'var(--sd-fg-3, #8b9a9a)', textAlign: 'center', paddingBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <i className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />{isMobile ? r.range : r.label}
        </div>
      ))}
      {['S', 'A'].map((t) => (
        <div key={t} style={{ display: 'contents' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TierChip tier={t} /></div>
          {RARITY.map((r) => {
            const v = grid[t][r.key];
            const hot = t === 'S' && r.key === 'only';
            const warm = t === 'S' && r.key === 'warm';
            return (
              <div key={r.key} title={`${fmt(v)} ${t}-tier, ${r.label.toLowerCase()} (${r.range} mutual)`} style={{
                height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                background: `rgba(0, 229, 255, ${(0.06 + 0.45 * Math.sqrt(v / max)).toFixed(3)})`, color: 'var(--sd-fg-1, #eaf6f8)',
                // An outline, not a shadow: these mark the hidden giants and the warm S.
                outline: hot ? `2px solid ${TIER_COLORS.S}` : warm ? '2px solid #FF7043' : 'none', outlineOffset: -2,
              }}>{fmt(v)}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

