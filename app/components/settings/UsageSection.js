'use client';

// Scan → LinkedIn usage: how close this LinkedIn account is to the line,
// in one look, the way Claude's usage page shows a plan's limits (neo's
// handoff, 2026-10-03; Blake's 1.0 list, item 3). An account was restricted
// once after 373 searches in 24 hours (TRAPS §16). The notch links here.
//
// One limit since 2026-10-05 (Blake: "Just a simple default limit for the day
// and a button to lift restrictions for this session"): one meter, searches in
// the last 24 hours against searches a day, with its number and "Lift limits
// for this session" under it. The month's, the week's and the profile views'
// meters went with their caps.
//
// Every number is counted from the scanner's own record on this computer
// (GET /api/scraper?usage, lib/linkedin-limits.js linkedinUsage) or is a rule
// that says where it came from (lib/usage.js). LinkedIn publishes no limits and
// shows no count of its own, so nothing here claims to be LinkedIn's number.
// What it changes: searches a day, Back to 50 a day, and the lift.

import { useCallback, useEffect, useState } from 'react';
import { Section, Body, LINE } from '../ui';
import {
  AUTO, PEOPLE_PER_SEARCH, DANGER_AT, LEVELS, usageLevel, warningParts, estimate,
  barMax, whenText, untilText, agoText, hoursText, INVITE_CAPS, REPORTED_WEEKLY_INVITES,
} from '../../../lib/usage';
import { RESTRICTED_AT, RISKY_DAILY, SAFE_LIMITS } from '../../../lib/search-risk';
import { paceOf, searchesPerHour } from '../../../lib/scan-pace';
import { LIMITS_CHANGED } from '../../../lib/scraper-client';
import { DailyLimitInput, LiftLimits, LiftedTag } from '../LinkedInLimits';

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

/**
 * Auto's connection requests (lib/auto-connect.js): the last 24 hours and the
 * last 7 days, each against its cap, one bar under the other. Its own caps,
 * not the search budget: a request is the one thing Sixgree sends.
 */
function InviteMeter({ day, week, freesAt, weekFreesAt, now }) {
  const known = Number.isFinite(day) && Number.isFinite(week);
  const bars = [
    { label: 'Last 24 hours', used: day, cap: INVITE_CAPS.day },
    { label: 'Last 7 days', used: week, cap: INVITE_CAPS.week },
  ];
  const left = known ? Math.max(0, Math.min(INVITE_CAPS.day - day, INVITE_CAPS.week - week)) : null;
  return (
    <div style={{ marginTop: 18 }} data-usage="invites">
      <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--sd-fg-1, #e8e8ee)' }}>Connection requests (Auto)</div>
      {bars.map((b) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <span style={{ flex: '0 0 88px', fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)' }}>{b.label}</span>
          <div style={{ position: 'relative', flex: 1, height: 10, borderRadius: 5, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)' }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 5, transition: 'width 0.4s ease',
              width: Number.isFinite(b.used) ? at(b.used, Math.max(b.cap, b.used)) : 0,
              background: b.used >= b.cap ? '#ff6b6b' : 'linear-gradient(90deg, #FFD700, #FF6B35)',
            }} />
          </div>
          <span style={{ flex: '0 0 auto', fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', fontVariantNumeric: 'tabular-nums', minWidth: 58, textAlign: 'right' }}>
            <b style={{ fontSize: 15, color: 'var(--sd-fg-1, #fff)' }}>{count(b.used)}</b> of {b.cap}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, marginTop: 6 }}>
        {!known ? null
          : freesAt ? <>Auto&rsquo;s {INVITE_CAPS.day} a day are used. The next one frees {whenAndUntil(freesAt, now)}.</>
          : weekFreesAt ? <>Auto&rsquo;s {INVITE_CAPS.week} a week are used. The next one frees {whenAndUntil(weekFreesAt, now)}.</>
          : <>{plural(left, 'request')} left for Auto now.</>}
        <div style={small}>
          Each press of Auto sends one request from the scanner&rsquo;s Chrome, without a note, and opens their
          profile once (a profile view). It stops at {INVITE_CAPS.day} in any 24 hours and {INVITE_CAPS.week} in any 7 days,
          whether or not the limits are lifted.
          LinkedIn doesn&rsquo;t publish its invitation limit; people commonly report about {REPORTED_WEEKLY_INVITES} a week.
        </div>
      </div>
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

async function post(body) {
  const r = await fetch('/api/scraper', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That couldn’t be saved.');
}

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
    // The notch, or the Scan page's own box, changed the limit or lifted it.
    window.addEventListener(LIMITS_CHANGED, load);
    return () => { clearInterval(timer); window.removeEventListener(LIMITS_CHANGED, load); };
  }, [load]);

  // Every change here: the number, Back to 50, the lift and putting it back.
  const change = async (body) => {
    setSaving(true);
    setError(null);
    try {
      await post(body);
      window.dispatchEvent(new Event(LIMITS_CHANGED));
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
  const lifted = u.lifted === true;
  const day = u.searchesToday;
  const level = usageLevel({ cooldown: u.cooldown, searchesDay: day, lastPushback: u.lastPushback, searchesSincePushback: u.searchesSincePushback, now });
  // The level's warning, then the limit's own note when it invites trouble whatever has been
  // used; the 373 said once between them (lib/usage.js warningParts).
  const warnings = warningParts(level, { searchesDay: day, cooldown: u.cooldown, lastPushback: u.lastPushback, now }, limits);
  const aboveSafe = limits.daily > SAFE_LIMITS.daily;
  const left = estimate({ leftDay: u.leftToday, paused: Boolean(u.cooldown) });
  const pace = paceOf(limits.pace);
  const push = u.lastPushback;
  // The limits came back by themselves: LinkedIn pushed back after the lift (lib/linkedin-limits.js sessionLift).
  const backAfterPushback = !lifted && u.liftEnded?.why === 'pushback' ? u.liftEnded : null;

  // The 24-hour bar's colour is its count's own level, so a pause elsewhere doesn't redden it.
  const dayLevel = usageLevel({ searchesDay: day });
  const dayTicks = [
    { at: SAFE_LIMITS.daily, label: String(SAFE_LIMITS.daily), title: 'The default limit' },
    { at: RISKY_DAILY, label: String(RISKY_DAILY), title: 'Above this is risky', color: '#FF8C42' },
    { at: RESTRICTED_AT, label: String(RESTRICTED_AT), title: 'A real account was restricted here', color: '#ff6b6b' },
  ];
  if (!lifted && limits.daily && !dayTicks.some((t) => t.at === limits.daily)) {
    dayTicks.push({ at: limits.daily, label: `${limits.daily} yours`, title: 'Your daily limit', color: 'var(--sd-blue, #3498DB)' });
  }
  const dayMax = barMax(day, dayTicks.map((t) => t.at));
  const views = u.profilesToday;

  return (
    <Section id="usage" title="LinkedIn usage">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Pill level={level} />
        {lifted && <LiftedTag />}
        <span style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', flex: '1 1 260px', lineHeight: 1.5 }}>
          What Sixgree has asked of your LinkedIn account from this computer, and how close that is to the line.
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
            <button onClick={() => change({ action: 'set-limits', daily: SAFE_LIMITS.daily })} disabled={saving} style={{
              marginTop: 9, padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 650,
              cursor: saving ? 'not-allowed' : 'pointer', background: 'rgba(255,215,0,0.08)',
              color: 'var(--sd-gold, #FFD700)', border: '1px solid rgba(255,215,0,0.4)',
            }}>{saving ? 'Saving…' : `Back to ${SAFE_LIMITS.daily} a day`}</button>
          )}
        </div>
      )}
      {backAfterPushback && (
        <Body style={{ color: 'var(--sd-gold, #FFD700)' }}>
          The limits came back on by themselves {whenText(backAfterPushback.at)}: LinkedIn pushed back after they were lifted.
        </Body>
      )}
      {error && <Body style={{ color: 'var(--sd-red, #ff7676)' }}>{error}</Body>}

      <Meter title="Searches in the last 24 hours" used={day} of={lifted ? '· no limit for this session' : `of ${limits.daily} a day`}
        max={dayMax} color={(LEVELS[dayLevel] || LEVELS.unknown).color} ticks={dayTicks}>
        {u.unreadable ? null : lifted
          ? <>Lifted for this session: scans don&rsquo;t stop at {limits.daily} until you put the limits back or quit Sixgree.</>
          : u.dayFreesAt
            ? <>Your {limits.daily} a day are used. The next one frees {whenAndUntil(u.dayFreesAt, now)}.</>
            : <>{plural(u.leftToday, 'search', 'searches')} left today{u.cooldown ? ', once the pause ends' : ''}.</>}
        {u.dayClearAt && <> All clear {whenAndUntil(u.dayClearAt, now)}, when the newest of these turns 24 hours old.</>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap', marginTop: 10 }}>
          <label htmlFor="usage-daily" style={{ fontSize: 13, fontWeight: 650, color: 'var(--sd-fg-1, #e8e8ee)' }}>Searches a day</label>
          <DailyLimitInput id="usage-daily" value={limits.daily} onSave={(daily) => change({ action: 'set-limits', daily })} />
          <span style={{ fontSize: 12, color: 'var(--sd-fg-4, #778)' }}>
            {SAFE_LIMITS.daily} is the default{limits.daily > RISKY_DAILY ? `; over ${RISKY_DAILY} is risky` : ''}.
          </span>
        </div>
        <div style={{ marginTop: 10 }}>
          <LiftLimits lifted={lifted} disabled={saving}
            onLift={() => change({ action: 'lift-limits' })} onPutBack={() => change({ action: 'put-limits-back' })} />
          {lifted && u.heldCooldown && (
            <div style={{ ...small, color: 'var(--sd-gold, #FFD700)' }}>
              The pause after LinkedIn pushed back ({u.heldCooldown.reason}, until {whenText(u.heldCooldown.until)}) is off too, and comes back with the limits.
            </div>
          )}
        </div>
        <div style={small}>
          Profile views (each circle scan opens the person&rsquo;s profile once) count against the same number:
          {' '}{Number.isFinite(views) ? <b>{count(views)}</b> : '?'}{lifted ? '' : ` of ${limits.daily}`} in the last 24 hours, never closer
          together than {pace.profileGap} seconds at {pace.label}.
          {' '}{RESTRICTED_AT} searches is where a real account was restricted, on Sep 28, 2026, with searches run back to back;
          {' '}{DANGER_AT} (60% of that) or more shows as too close.
        </div>
      </Meter>

      <InviteMeter day={u.invitesToday} week={u.invitesWeek} freesAt={u.invitesFreeAt} weekFreesAt={u.invitesWeekFreeAt} now={now} />

      <div style={{ marginTop: 22 }}>
        <Row label="Speed">
          {pace.label}: about {searchesPerHour(limits.pace, limits.gentle !== false)} searches an hour at most while a scan runs, lifted or not.
          {Number.isFinite(u.searchesLastHour) && <> In the last hour: {plural(u.searchesLastHour, 'search', 'searches')}.</>}
          {' '}<a href="#scan-top" style={link}>Change it beside the Scan button</a>
        </Row>
        <Row label="Can still map">
          {u.unreadable
            ? <>Can&rsquo;t tell until the record of searches can be read.</>
            : lifted
            ? <>As many as a scan reaches at its pace: there&rsquo;s no daily limit for this session.</>
            : u.cooldown
            ? <>No one until the pause ends.</>
            : !left || left.searches === 0
            ? <>No one for now: today&rsquo;s {limits.daily} are used.</>
            : <>
              About {count(left.people)} people today: {plural(left.searches, 'search', 'searches')} left, at about {PEOPLE_PER_SEARCH} people a search.
              <span style={{ color: 'var(--sd-fg-4, #778)' }}> An estimate: a page of results shows up to 10 people, and the last page of a list is usually short.</span>
            </>}
        </Row>
        <Row label="Last pushback">
          {!push
            ? <>None on record on this computer.</>
            : <>
              {push.at ? <>{whenText(push.at)} ({agoText(push.at, now)}): </> : null}{push.reason}.
              {push.active && !lifted && <> Scanning is paused until {whenText(push.pausedUntil)}.</>}
              {push.active && lifted && <> The pause until {whenText(push.pausedUntil)} is off while the limits are lifted.</>}
              {push.liftedAt && <> You lifted the pause {whenText(push.liftedAt)}; it would have run until {whenText(push.pausedUntil)}.</>}
              {!push.active && !push.liftedAt && push.pausedUntil && <> The pause ended {whenText(push.pausedUntil)}.</>}
              {u.searchesSincePushback > 0 && <> {plural(u.searchesSincePushback, 'search', 'searches')} since.</>}
            </>}
        </Row>
        <Row label="Auto scan">
          Auto scan uses the same searches a day, and waits for it to free up instead of stopping. Its own pacing on top:
          {' '}only from {hoursText(AUTO.hours)} on this computer&rsquo;s clock,
          {' '}{AUTO.sittingRest === 3600 ? 'an hour’s rest' : `a ${AUTO.sittingRest / 60}-minute rest`} after every {AUTO.sitting} searches,
          {' '}and {AUTO.pushbackRest / 86400} days off after any check from LinkedIn.
        </Row>
      </div>

      <div style={{ ...small, marginTop: 14, paddingTop: 12, borderTop: LINE }}>
        Where these numbers come from: Sixgree writes down every search, profile view and Auto request it makes
        on your LinkedIn account, on this computer, and counts them here. Searches you make yourself on linkedin.com
        aren&rsquo;t in it, and LinkedIn shows no count of its own. The {RESTRICTED_AT} searches and the 20 to 25
        profile views are what happened to one real account, not safe limits. Whatever the limit, every scan keeps its
        pace and stops when LinkedIn asks you to check in. Nothing here is sent anywhere.
        {' '}Counted {whenText(now)}.
      </div>
    </Section>
  );
}
