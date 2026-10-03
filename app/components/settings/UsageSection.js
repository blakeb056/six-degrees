'use client';

// Settings → LinkedIn usage: how close this LinkedIn account is to the line,
// in one look, the way Claude's usage page shows a plan's limits (neo's
// handoff, 2026-10-03; Blake's 1.0 list, item 3). Until now the only view of
// it was the budget box folded away in the Scan page's "Fine-tune the
// scanner", and an account was restricted once after 373 searches in 24 hours
// (TRAPS §16). The notch and that box link here.
//
// Every number is counted from the scanner's own record on this computer
// (GET /api/scraper?usage, lib/linkedin-limits.js linkedinUsage) or is a rule
// that says where it came from (lib/usage.js). LinkedIn publishes no limits and
// shows no count of its own, so nothing here claims to be LinkedIn's number.
// The page only reads; its one button is the Scan page's own "Back to 50 a
// day, 250 a month".

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Section, Body, LINE } from '../ui';
import {
  AUTO, PEOPLE_PER_SEARCH, DANGER_AT, REPORTED_MONTH, LEVELS, usageLevel, warningParts, estimate,
  barMax, pacificText, whenText, untilText, agoText, hoursText,
} from '../../../lib/usage';
import { RESTRICTED_AT, RISKY_DAILY, SAFE_LIMITS } from '../../../lib/search-risk';
import { paceOf, searchesPerHour } from '../../../lib/scan-pace';

// Looked at again while the page is open, as the Scan page's own checks are.
const REFRESH_MS = 30 * 1000;

const count = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '?');
const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const link = { color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 };
const small = { fontSize: 12, color: 'var(--sd-fg-4, #778)', lineHeight: 1.6, marginTop: 4 };

function Pill({ level }) {
  const l = LEVELS[level] || LEVELS.unknown;
  return (
    <span role="status" style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999,
      fontSize: 12.5, fontWeight: 700, color: l.color, background: `${l.color}1f`, border: `1px solid ${l.color}55`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />
      {l.label}
    </span>
  );
}

/** Where on the bar a number sits, as a percentage. */
const at = (n, max) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;

/**
 * One meter: a heading with the count, a bar with its marks (and a shaded
 * range), the marks' numbers under it, then what they mean.
 */
function Meter({ title, used, of, max, color, ticks = [], band, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--sd-fg-1, #e8e8ee)' }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ fontSize: 17, color: 'var(--sd-fg-1, #fff)' }}>{count(used)}</b>{of ? ` ${of}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 5, marginTop: 7, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)' }}>
        {band && (
          <div title={band.title} style={{
            position: 'absolute', top: 0, bottom: 0, left: at(band.from, max), width: `calc(${at(band.to, max)} - ${at(band.from, max)})`,
            background: 'repeating-linear-gradient(135deg, rgba(255,215,0,0.28) 0 4px, rgba(255,215,0,0.08) 4px 8px)',
          }} />
        )}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: Number.isFinite(used) ? at(used, max) : 0,
          borderRadius: 5, background: color, transition: 'width 0.4s ease',
        }} />
        {ticks.map((t) => (
          <div key={t.at} title={t.title} style={{
            position: 'absolute', top: -3, bottom: -3, left: at(t.at, max), width: 2, marginLeft: -1, borderRadius: 1,
            background: t.color || 'rgba(var(--sd-ink, 255, 255, 255), 0.55)',
          }} />
        ))}
      </div>
      {(ticks.length > 0 || band) && (
        <div aria-hidden="true" style={{ position: 'relative', height: 16, marginTop: 3, fontSize: 10.5, color: 'var(--sd-fg-4, #778)', fontVariantNumeric: 'tabular-nums' }}>
          {/* The shaded range's ends, where no mark already says the number */}
          {(band ? [band.from, band.to] : []).filter((n) => !ticks.some((t) => t.at === n))
            .map((n) => ({ at: n, label: String(n), color: 'rgba(255,215,0,0.75)' }))
            .concat(ticks).map((t) => {
            const p = (t.at / max) * 100;
            return (
              <span key={t.at} style={{
                position: 'absolute', left: `${Math.min(100, p)}%`, whiteSpace: 'nowrap', color: t.color || undefined,
                transform: p > 94 ? 'translateX(-100%)' : p < 4 ? 'none' : 'translateX(-50%)',
              }}>{t.label}</span>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, marginTop: 2 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', padding: '10px 0', borderTop: LINE, fontSize: 13 }}>
      <span style={{ flex: '0 0 150px', color: 'var(--sd-fg-1, #e8e8ee)', fontWeight: 600 }}>{label}</span>
      <span style={{ flex: '1 1 280px', color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6 }}>{children}</span>
    </div>
  );
}

/** "in 2 h 5 min (Sat, Oct 3, 5:20 PM)" */
const whenAndUntil = (ms, now) => `${untilText(ms, now)} (${whenText(ms)})`;

export default function UsageSection() {
  const [u, setU] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => fetch('/api/scraper?usage=1', { cache: 'no-store' })
    .then((r) => r.json().then((d) => (r.ok && !d.error ? d : Promise.reject(new Error(d.error || 'The usage could not be read.')))))
    .then((d) => { setU(d); setError(null); })
    .catch((e) => setError(e.message)), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const backToSafe = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/scraper', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-limits', ...SAFE_LIMITS }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The budget could not be saved.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!u) {
    return (
      <Section id="usage" title="LinkedIn usage">
        <Body>{error ? `${error}` : 'Counting…'}</Body>
      </Section>
    );
  }

  // The server's clock, the one the windows were counted on.
  const now = u.now;
  const { limits = {} } = u;
  const day = u.searchesToday;
  const level = usageLevel({ cooldown: u.cooldown, searchesDay: day, lastPushback: u.lastPushback, searchesSincePushback: u.searchesSincePushback, now });
  // The level's warning, then the budget's own when it invites trouble whatever has been
  // used; the 373 said once between them (lib/usage.js warningParts).
  const warnings = warningParts(level, { searchesDay: day, cooldown: u.cooldown, lastPushback: u.lastPushback, now }, limits);
  const aboveSafe = limits.daily > SAFE_LIMITS.daily || limits.monthly === 0 || limits.monthly > SAFE_LIMITS.monthly;
  const left = estimate({ leftDay: u.leftToday, leftMonth: u.leftMonth, paused: Boolean(u.cooldown) });
  const pace = paceOf(limits.pace);
  const push = u.lastPushback;

  // The 24-hour bar's colour is its count's own level, so a pause elsewhere doesn't redden it.
  const dayLevel = usageLevel({ searchesDay: day });
  const dayTicks = [
    { at: SAFE_LIMITS.daily, label: String(SAFE_LIMITS.daily), title: 'The default budget' },
    { at: RISKY_DAILY, label: String(RISKY_DAILY), title: 'Above this is risky', color: '#FF8C42' },
    { at: RESTRICTED_AT, label: String(RESTRICTED_AT), title: 'A real account was restricted here', color: '#ff6b6b' },
  ];
  if (limits.daily && !dayTicks.some((t) => t.at === limits.daily)) {
    dayTicks.push({ at: limits.daily, label: `${limits.daily} yours`, title: 'Your daily budget', color: 'var(--sd-blue, #3498DB)' });
  }
  const dayMax = barMax(day, dayTicks.map((t) => t.at));

  const month = u.searchesMonth;
  const monthTicks = limits.monthly ? [{ at: limits.monthly, label: `${limits.monthly} yours`, title: 'Your monthly budget', color: 'var(--sd-blue, #3498DB)' }] : [];
  const monthMax = barMax(month, [REPORTED_MONTH[1], limits.monthly || 0]);
  const monthColor = limits.monthly && month >= limits.monthly ? '#ff6b6b' : month >= REPORTED_MONTH[0] ? '#FFD700' : '#3498DB';

  const week = u.searchesWeek;
  const weekMax = barMax(week, [AUTO.week]);

  const views = u.profilesToday;
  const viewsMax = Math.max(limits.profiles || 1, Number(views) || 0);

  return (
    <Section id="usage" title="LinkedIn usage">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Pill level={level} />
        <span style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', flex: '1 1 260px', lineHeight: 1.5 }}>
          What Six Degrees has asked of your LinkedIn account from this computer, and how close that is to the line.
        </span>
      </div>

      {warnings.length > 0 && (
        <div style={{
          marginTop: 14, padding: '11px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
          color: 'var(--sd-fg-2, #e3d9c4)', background: `${(LEVELS[level] || LEVELS.unknown).color}14`,
          border: `1px solid ${(LEVELS[level] || LEVELS.unknown).color}55`,
        }}>
          {warnings.map((text, i) => <div key={i} style={{ marginTop: i ? 6 : 0 }}>{text}</div>)}
          {aboveSafe && (
            <button onClick={backToSafe} disabled={saving} style={{
              marginTop: 9, padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 650,
              cursor: saving ? 'not-allowed' : 'pointer', background: 'rgba(255,215,0,0.08)',
              color: 'var(--sd-gold, #FFD700)', border: '1px solid rgba(255,215,0,0.4)',
            }}>{saving ? 'Saving…' : `Back to ${SAFE_LIMITS.daily} a day, ${SAFE_LIMITS.monthly} a month`}</button>
          )}
        </div>
      )}
      {error && <Body style={{ color: 'var(--sd-red, #ff7676)' }}>{error}</Body>}

      <Meter title="Searches in the last 24 hours" used={day} of={limits.daily ? `of ${limits.daily} a day` : 'no daily cap'}
        max={dayMax} color={(LEVELS[dayLevel] || LEVELS.unknown).color} ticks={dayTicks}>
        {u.unreadable ? null : limits.daily
          ? (u.dayFreesAt
            ? <>Your {limits.daily} a day are used. The next one frees {whenAndUntil(u.dayFreesAt, now)}.</>
            : <>{plural(u.leftToday, 'search', 'searches')} left under your budget{u.cooldown ? ', once the pause ends' : ''}.</>)
          : <>No daily cap is set, so only the monthly one stops a scan.</>}
        {u.dayClearAt && <> All clear {whenAndUntil(u.dayClearAt, now)}, when the newest of these turns 24 hours old.</>}
        <div style={small}>
          {SAFE_LIMITS.daily} is the default budget. Over {RISKY_DAILY} is risky: the budget picker asks first.
          {' '}{RESTRICTED_AT} is where a real account was restricted, on Sep 28, 2026, with searches run back to back.
          {' '}{DANGER_AT} (60% of that) or more shows as too close.
        </div>
      </Meter>

      <Meter title="Searches this month" used={month} of={limits.monthly ? `of ${limits.monthly} a month` : 'no monthly cap'}
        max={monthMax} color={monthColor} ticks={monthTicks}
        band={{ from: REPORTED_MONTH[0], to: REPORTED_MONTH[1], title: 'The range people report for a free account' }}>
        LinkedIn&rsquo;s month resets {pacificText(u.monthResets)} ({whenText(u.monthResets)} here).
        {!limits.monthly ? <> No monthly cap is set (Premium).</>
          : Number.isFinite(u.leftMonth) && <> {plural(u.leftMonth, 'search', 'searches')} left under your budget.</>}
        <div style={small}>
          The shaded {REPORTED_MONTH[0]} to {REPORTED_MONTH[1]} is the range people report for a free account&rsquo;s
          monthly search limit. LinkedIn doesn&rsquo;t publish one, so it&rsquo;s a guide, not a fact.
          Every page of someone&rsquo;s connections is one search.
        </div>
      </Meter>

      <Meter title="Searches in the last 7 days" used={week} of={`against Auto scan's ${AUTO.week}`}
        max={weekMax} color={week >= AUTO.week ? '#FFD700' : '#3498DB'}
        ticks={[{ at: AUTO.week, label: String(AUTO.week), title: 'Auto scan stops here' }]}>
        Auto scan stops at {AUTO.week} in any 7 days. A scan you start yourself stops only at your daily and monthly budget.
      </Meter>

      <Meter title="Profile views in the last 24 hours" used={views} of={`of ${limits.profiles} a day`}
        max={viewsMax} color={views >= limits.profiles ? '#ff6b6b' : '#9B59B6'}>
        {u.profilesFreeAt
          ? <>Your {limits.profiles} a day are used. The next one frees {whenAndUntil(u.profilesFreeAt, now)}.</>
          : Number.isFinite(views) && <>{plural(u.profilesLeftToday, 'view', 'views')} left.</>}
        <div style={small}>
          Each circle scan opens the person&rsquo;s profile once. Profile views are what got an account restricted on
          Sep 9, 2026, after about 20 to 25 in an hour; at {pace.label} the scanner opens at most one every {pace.profileGap} seconds.
        </div>
      </Meter>

      <div style={{ marginTop: 22 }}>
        <Row label="Speed">
          {pace.label}: about {searchesPerHour(limits.pace)} searches an hour at most while a scan runs.
          {Number.isFinite(u.searchesLastHour) && <> In the last hour: {plural(u.searchesLastHour, 'search', 'searches')}.</>}
          {' '}<Link href="/setup" style={link}>Change it on the Scan page</Link>
        </Row>
        <Row label="Can still map">
          {u.unreadable
            ? <>Can&rsquo;t tell until the record of searches can be read.</>
            : !left
            ? <>No cap is set, so there&rsquo;s no count of what&rsquo;s left.</>
            : u.cooldown
            ? <>No one until the pause ends.</>
            : left.searches === 0
            ? <>No one for now: your {left.by === 'day' ? 'daily' : 'monthly'} budget is used.</>
            : <>
              About {count(left.people)} people: {plural(left.searches, 'search', 'searches')} left under your
              {' '}{left.by === 'day' ? 'daily' : 'monthly'} budget, at about {PEOPLE_PER_SEARCH} people a search.
              <span style={{ color: 'var(--sd-fg-4, #778)' }}> An estimate: a page of results shows up to 10 people, and the last page of a list is usually short.</span>
            </>}
        </Row>
        <Row label="Last pushback">
          {!push
            ? <>None on record on this computer.</>
            : <>
              {push.at ? <>{whenText(push.at)} ({agoText(push.at, now)}): </> : null}{push.reason}.
              {push.active && <> Scanning is paused until {whenText(push.pausedUntil)}.</>}
              {push.liftedAt && <> You lifted the pause {whenText(push.liftedAt)}; it would have run until {whenText(push.pausedUntil)}.</>}
              {!push.active && !push.liftedAt && push.pausedUntil && <> The pause ended {whenText(push.pausedUntil)}.</>}
              {u.searchesSincePushback > 0 && <> {plural(u.searchesSincePushback, 'search', 'searches')} since.</>}
            </>}
        </Row>
        <Row label="Auto scan">
          However high your budget is set, Auto scan keeps under its own limits: {AUTO.day} searches in any 24 hours,
          {' '}{AUTO.week} in any 7 days, only from {hoursText(AUTO.hours)} on this computer&rsquo;s clock,
          {' '}{AUTO.sittingRest === 3600 ? 'an hour’s rest' : `a ${AUTO.sittingRest / 60}-minute rest`} after every {AUTO.sitting} searches,
          {' '}and {AUTO.pushbackRest / 86400} days off after a security check or being signed out.
        </Row>
      </div>

      <div style={{ ...small, marginTop: 14, paddingTop: 12, borderTop: LINE }}>
        Where these numbers come from: Six Degrees writes down every search and profile view it makes on your
        LinkedIn account, on this computer, and counts them here. Searches you make yourself on linkedin.com
        aren&rsquo;t in it, and LinkedIn shows no count of its own. The {RESTRICTED_AT} searches and the 20 to 25
        profile views are what happened to one real account, not safe limits. Change the budget on the
        {' '}<Link href="/setup" style={link}>Scan page</Link>, under Fine-tune the scanner. Nothing here is sent anywhere.
        {' '}Counted {whenText(now)}.
      </div>
    </Section>
  );
}
