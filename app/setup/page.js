'use client';

import { Suspense, useState, useEffect, useRef, useId } from 'react';
import { useSearchParams } from 'next/navigation';
import OnboardingGate from '../components/OnboardingGate';
import Link from 'next/link';
import { pickedPerson, SHOW_CHROME_KEY } from '../../lib/scraper-client';
import { setupStep, askForField, appManagementStep } from '../../lib/scanner-setup';
import { RISK_POINTS } from '../../lib/scan-risk';
import { IS_DEMO } from '../../lib/demo';
import { circleScanCost } from '../../lib/reach';
import ScanRadar from '../components/ScanRadar';
import AppHeader from '../components/AppHeader';
import useNotchTabs from '../components/useNotchTabs';
import { paceOf, durationText, firstCircleSeconds } from '../../lib/scan-pace';
import { BudgetBox, CooldownBanner, PausedList } from '../components/LinkedInLimits';
import FieldStep, { FieldAnswer } from '../components/FieldStep';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';
import ClusterSpinner from '../components/ClusterSpinner';
import useScanStatus from '../components/useScanStatus';
import UsageSection from '../components/settings/UsageSection';

// Everything here runs through /api/scraper. There is deliberately no second
// server and no command to copy: the step where people gave up was starting a
// Python server in a terminal they had not been told they needed.

const BG = 'var(--sd-page)';   // clear: the theme shows through (lib/themes.js)
const LINE = '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)';

const ACTION_LABELS = {
  photos: 'Saving profile photos to this computer',
  install: 'Installing the scanner',
  setup: 'Setting up the scanner',
  login: 'Waiting for you to sign in',
  full: 'Scanning your whole network',
  refresh: 'Checking for new connections',
  'auto-bridge': 'Mapping 2nd-degree connections',
  'auto-bridge-retry': 'Mapping 2nd degree, hidden ones included',
  resume: 'Carrying on with one paused list',
  'resume-all': 'Carrying on with every paused list',
  connect: 'Sending a connection request (Auto)',
};

// The notch's one tab (lib/island.js): the tab is the page, lit, and takes you
// to its top, where the scanner and its Setup box are.
const SCAN_TAB = { items: [{ key: 'scan', label: 'Scan' }], current: 'scan', onPick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };

export default function SetupPage() {
  // Suspense because SetupInner reads the address's ?scan= (useSearchParams),
  // which Next requires to sit inside one for the page to build.
  return <OnboardingGate><Suspense><SetupInner /></Suspense></OnboardingGate>;
}

function SetupInner() {
  useNotchTabs(SCAN_TAB);
  // Updates moved to Settings; an old menu item or bookmark still lands there.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('check') === 'updates') {
      window.location.replace('/settings?check=updates');
    }
  }, []);
  // The scanner's status, your settings, and what the buttons do: shared with
  // the guided setup (app/components/useScanStatus.js).
  const { s, settings, busy, error, run, stop, acceptRisk, answerAppManagement, appAnswer } = useScanStatus();
  // Ten, not twenty-five. The only measured number this project has is that
  // roughly nineteen bridges in an hour got a real account restricted, so a
  // default above that is a default that can hurt whoever trusts it.
  const [batch, setBatch] = useState(10);
  // Which tiers to work through. New connections need no separate mode — the
  // outstanding list is recomputed every run, so anyone added since simply
  // appears in it. What is worth choosing is how far down to go.
  const [tiers, setTiers] = useState(['S', 'A']);
  // Which connections to map first. Newest is what people expect after adding
  // someone: the old fixed tier order skipped straight past new connections that
  // were not S-tier.
  const [order, setOrder] = useRemembered('six-degrees-bridge-order', 'newest');
  // How many result pages to read per person. Every page, by default: a list cut
  // off at page 10 was the one thing people noticed missing, and a long read now
  // saves as it goes and carries on where it stopped. A new key, so a 10 that was
  // remembered from before does not quietly keep the old limit.
  const [pages, setPages] = useRemembered('six-degrees-bridge-pages-v2', 100);
  // Also finish people mapped before, from the page each one's read stopped at.
  const [finish, setFinish] = useRemembered('six-degrees-bridge-finish', true);
  // Experimental Auto-Bridge: all-day pacing and LinkedIn's own data (scripts/scrape.py --experimental).
  const [experimental, setExperimental] = useRemembered('six-degrees-experimental-auto', false);
  // Scanning in a normal Chrome window in front, to watch it (scripts/scrape.py
  // --show-window). Off, the window stays out of sight. lib/scraper-client.js
  // reads it for every scan, wherever it starts.
  const [showChrome, setShowChrome] = useRemembered(SHOW_CHROME_KEY, false);
  const logRef = useRef(null);
  // The answer given here to the question about your field, if any.
  const [field, setField] = useState(null);
  // Someone sent here to have their circle scanned (Insights' Scan circle):
  // /setup?scan=<id>, with what it costs and one button that starts it. Bridge
  // Chains and the Degrees panel start theirs in place now.
  // The router's search params rather than window.location: every way here is a
  // click, and the address bar only changes after this page has rendered, so the
  // pick was lost on all of them and only a reload showed it.
  const pickId = useSearchParams().get('scan');
  const [pick, setPick] = useState(null);
  useEffect(() => {
    if (!pickId) return undefined;
    let live = true;
    pickedPerson(pickId).then((d) => { if (live) setPick(d?.person ? d : null); }, () => {});
    return () => { live = false; };
  }, [pickId]);
  // Next's router follows history.replaceState, so pickId drops ?scan= as well.
  function unpick() {
    setPick(null);
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* the link stays */ }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [s?.log?.length]);

  // Setup's steps opened or closed by their chevron: { [key]: true | false }.
  const [openSteps, setOpenSteps] = useState({});
  // The Social tab's once-a-day messages sync, switchable here too once there
  // are messages to sync (GET /api/social; PATCH as app/social/SocialHub.js does).
  const [social, setSocial] = useState(null);
  useEffect(() => {
    if (IS_DEMO) return undefined;
    let live = true;
    fetch('/api/social').then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setSocial(d?.social || null); }, () => {});
    return () => { live = false; };
  }, []);
  async function syncMessages(on) {
    setSocial((v) => (v ? { ...v, autoSync: on } : v));
    const d = await fetch('/api/social', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSync: on }) })
      .then((r) => r.json()).catch(() => null);
    if (d && typeof d.autoSync === 'boolean') setSocial((v) => (v ? { ...v, autoSync: d.autoSync } : v));
  }
  // /setup#usage (the notch's budget, Settings' old address): the section only
  // exists once the status is in, so go to it then, once.
  const toUsage = useRef(true);
  useEffect(() => {
    if (!s || !toUsage.current) return;
    toUsage.current = false;
    // A moment later, once the cards above have their height.
    if (window.location.hash === '#usage') setTimeout(() => document.getElementById('usage')?.scrollIntoView(), 600);
  }, [s]);

  // The question is answered: a line takes its place, and the page goes back
  // to the top, since it may have been answered from far down the picker.
  function answered(sectors) {
    setField({ sectors });
    window.scrollTo(0, 0);
  }

  const c = s?.checks || {};
  const running = s?.running;
  // Step 1 (lib/scanner-setup.js): ready (the Mac app's own Python, or one
  // installed), Install, Set up the scanner (download a Python first), or neither;
  // and a line of its own when the Python inside the app didn't work.
  const step1 = setupStep(s);
  const needsDeps = s && !c.dependencies;
  // Step 1 says so and offers the download (lib/scanner-setup.js); nothing that opens LinkedIn can start.
  const needsChrome = s && c.chrome === false;
  const notFound = s && !c.scriptsFound;
  // The one-time "I understand" before anything opens LinkedIn (lib/scan-risk.js);
  // the server refuses without it too. Unknown (an older server) counts as given.
  const riskOk = c.riskAccepted !== false;
  const canScrape = s?.ready && !running && riskOk;
  // Anything that searches LinkedIn waits out a cooldown (TRAPS §35).
  const li = s?.linkedin;
  const cooling = Boolean(li?.cooldown);
  const canSearch = canScrape && !cooling;
  // By degree, because one total reads as "connections" and is not: the people
  // you know, then the people found through them, then company scans.
  const net = s?.network || { first: 0, second: 0, third: 0 };
  const mapped = net.first;
  // Your field, asked once when your connections are in, before who they know
  // (lib/scanner-setup.js askForField); left out while that isn't known (null).
  const askField = IS_DEMO || field ? false : askForField(s, settings);
  // On a Mac, macOS may ask about App Management when the scanner starts Chrome
  // (lib/scanner-setup.js appManagementStep): offered once, under step 1, and
  // never part of whether step 1 is done.
  const appMgmt = IS_DEMO || appAnswer ? false : appManagementStep(s, settings);
  // Step 4, honestly: the first circle shows in minutes, the rest takes days.
  const pace = li?.limits?.pace;
  const firstCircle = durationText(firstCircleSeconds(pace));
  // A run that ended badly, and the line that says why — the last thing it
  // printed before stopping. Shown as a box, not left for someone to find in the log.
  const failed = s && !running && s.exitCode != null && s.exitCode !== 0;
  // The server keeps the end of stderr for exactly this; older servers did not,
  // so fall back to the last line the log shows.
  const failReason = failed
    ? (s.failure?.length ? s.failure.join('\n')
      : [...(s.log || [])].reverse().find((l) => !/^Stopped \(exit/.test(l) && !/Warning|warnings\.warn/.test(l)))
    : null;

  // ---- Setup, as green lights (Blake, 2026-10-04: "once all the steps are completed they stay
  // green and dont have to all be extended out … if they are red theres arrows to expand it").
  // Each step: done (green), to do (red), optional (amber) or waiting on one above (grey).
  const signInWaits = !step1.done || !riskOk;
  const steps = [
    {
      key: 'scanner', name: 'Scanner and Chrome',
      state: notFound || !step1.done ? 'bad' : 'done',
      summary: notFound ? 'Files missing' : step1.done ? 'Ready' : needsChrome ? 'Needs Google Chrome' : 'Needs setting up',
      body: <>
        {notFound && (
          <Box tone="bad">
              <b>Can’t find the scanner files.</b><br />
              <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>
                This copy of Sixgree is missing part of its scanner. Download it again from
                sixgree.com and put the new copy in place of this one.
              </span>
          </Box>
        )}
        {/* The Python inside the app didn't work: what happened, and what to do instead. */}
        {step1.note && <Box tone={step1.done ? undefined : 'bad'}>{step1.note}</Box>}
        <StepText>{step1.text}</StepText>
        {(step1.button || step1.chrome) && (
          <StepActions>
            {step1.button && <Launch onClick={() => run(step1.button.action)} disabled={busy || running}>{step1.button.label}</Launch>}
            {/* No Chrome: the way to get it. The step turns green by itself once it's installed. */}
            {step1.chrome && <Launch href={step1.chrome.href} quiet={Boolean(step1.button)}>{step1.chrome.label}</Launch>}
          </StepActions>
        )}
      </>,
    },
    // Blake, 2026-10-04: "a button where the user is basically brought to the app management and
    // enables it like Flow does". Optional, so it is amber and never holds anything up.
    appMgmt && {
      key: 'app-management', name: 'App Management', state: 'optional', summary: 'Optional, once',
      body: <AppManagementItem item={appMgmt} onAnswer={answerAppManagement} />,
    },
    {
      key: 'risk', name: 'Scanning risks', state: riskOk ? 'done' : 'bad',
      summary: riskOk ? 'Understood' : 'Read once, then I understand',
      body: riskOk
        ? <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--sd-fg-3, #9fb0bb)', fontSize: 12.5, lineHeight: 1.6 }}>
          {RISK_POINTS.map((p) => <li key={p} style={{ marginBottom: 4 }}>{p}</li>)}
        </ul>
        : <RiskCard onAccept={acceptRisk} busy={busy} />,
    },
    {
      key: 'sign-in', name: 'LinkedIn sign-in',
      state: c.signedIn ? 'done' : signInWaits ? 'wait' : 'bad',
      summary: c.signedIn ? 'Signed in' : signInWaits ? 'After the steps above' : 'Sign in once',
      body: <>
        <StepText>
          {c.signedIn
            ? 'Signed in on this Mac. If LinkedIn asks for a security check, or a scan says you were signed out, open LinkedIn here and finish it by hand.'
            : <>
              A Chrome window opens. Sign in with your email and password there: the scanner never sees them.
              {/* TRAPS §12: Google and Apple block their sign-in in automated browsers, so the fix is a password. */}
              <span style={{ display: 'block', marginTop: 6 }}>
                Use Google or Apple to sign in? That can&rsquo;t work in this window, so set a LinkedIn password
                first: on LinkedIn&rsquo;s sign-in page, <b>Forgot password</b> emails you a link to make one.
              </span>
            </>}
        </StepText>
        {c.dependencies && (
          <StepActions>
            {/* Shown after sign-in too: a security check survives the session cookie (TRAPS §35).
                Never without Chrome: the server would refuse it (lib/scanner-setup.js CHROME_REFUSAL). */}
            <Launch onClick={() => run('login')} disabled={busy || running || !step1.done || !riskOk || needsChrome} quiet={!!c.signedIn}>
              {running && s.action === 'login' ? 'Waiting for you…' : c.signedIn ? 'Open LinkedIn again' : 'Open LinkedIn'}
            </Launch>
          </StepActions>
        )}
      </>,
    },
  ].filter(Boolean);
  const left = steps.filter((x) => x.state === 'bad' || x.state === 'wait').length;
  const allSet = Boolean(s) && left === 0;
  // A step's own pick (its chevron) wins; otherwise one that needs you is open, the rest closed.
  const isOpen = (x) => openSteps[x.key] ?? x.state === 'bad';
  const toggle = (x) => setOpenSteps((o) => ({ ...o, [x.key]: !isOpen(x) }));
  // Scanning your connections needs every step; until then the buttons say why, inline.
  const canScanList = canSearch && step1.done && !!c.signedIn;
  const why = running ? null
    : !s ? null
    : !allSet ? `Finish setup first: ${left} ${left === 1 ? 'step' : 'steps'} left in Setup.`
    : cooling ? 'Scanning is paused for now: the note under Their circles says until when.'
    : null;
  const roundOptions = { maxBridges: batch, tiers: order === 'score' ? tiers : [], order, maxPages: pages, deeper: finish };

  return (
    <div style={{
      minHeight: '100vh', background: BG, color: 'var(--sd-fg-1, #fff)',
      fontFamily: 'var(--sd-font)',
    }}>
      {/* The same header as every page, Scan lit (Blake, 2026-10-02: continuity) */}
      <AppHeader active="scan" brand="span" />
      <style>{PAGE_CSS}</style>

      {/* Room at the top for the notch's Scan tab. Top to bottom (Blake, 2026-10-04): the scanner
          with Setup beside it as green lights, then its settings, then the extras, then LinkedIn usage. */}
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '46px 24px 64px' }}>

        {/* The first look at the scanner can take a while (it looks for Python): say so, never a blank page. */}
        {!s && <p style={{ color: 'var(--sd-fg-4, #778)', fontSize: 13 }}>Checking your setup…</p>}

        {s && <>
          {/* By id: the server finds them by their profile, since two connections can share a name. */}
          {pick?.person.id === pickId && (
            <ScanOne
              pick={pick} pages={pages} setPages={setPages} li={li} running={running} s={s}
              canSearch={canSearch} busy={busy} onUnpick={unpick}
              onStart={() => run('bridge', { id: pick.person.id, maxPages: pages })}
            />
          )}

          {/* Your field, once, now that there are people to rank with it; then a line saying what it did. */}
          {askField && <FieldStep onDone={answered} />}
          {field && <FieldAnswer sectors={field.sectors} />}

          <div id="scan-top" className={`scan-top${allSet ? '' : ' scan-setup-first'}`}>
            {/* ---- The scanner: what it has mapped, what it's doing, and the buttons ---- */}
            <section aria-label="Your scanner" className="scan-card scan-main">
              <Eyebrow>Your scanner</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, lineHeight: 1.2 }}>
                    {mapped > 0 ? `${mapped.toLocaleString()} connections mapped` : 'Map your network'}
                  </h1>
                  <div style={{ fontSize: 14, color: 'var(--sd-fg-2, #aab7c4)', lineHeight: 1.6, marginTop: 4 }}>
                    {mapped > 0
                      ? <>
                        {net.second > 0 ? `Plus ${net.second.toLocaleString()} people in their circles` : 'Next: who they know'}
                        {net.third > 0 && ` and ${net.third.toLocaleString()} from company scans`}.
                      </>
                      // Blake, 2026-10-04: "we want seamlessness … not to have any disruption through pop ups or windows".
                      : 'Your connections first, in a minute or two; who they know fills in over days. It works in your own Chrome, out of sight, and keeps everything on this Mac.'}
                  </div>
                </div>
                {mapped > 0 && (
                  <Link href="/" style={{
                    padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 700,
                    color: '#0a0a1a', textDecoration: 'none',
                    background: 'linear-gradient(135deg, #FFD700, #FF6B35)',
                  }}>See your network →</Link>
                )}
              </div>

              {error && <Box tone="bad">{error}</Box>}

              {/* ---- the scanner at work: what it's doing, and Stop ---- */}
              {running && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginTop: 18,
                  padding: '14px 16px', borderRadius: 10,
                  background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.3)',
                }}>
                  <Spinner />
                  <div style={{ flex: 1, fontSize: 13.5 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'var(--sd-green, #00ff88)', marginBottom: 2 }}>WORKING NOW</div>
                    <b>{ACTION_LABELS[s.action] || 'Working'}</b>
                    {/* The one time its window comes forward (scripts/scrape.py bring_forward). */}
                    {s.needsYou && (
                      <div role="status" style={{ color: 'var(--sd-gold, #FFD700)', fontWeight: 700, marginTop: 4 }}>
                        LinkedIn needs you: {s.needsYou}
                      </div>
                    )}
                    {s.progress && <Progress p={s.progress} action={s.action} />}
                    {/* The circle being read, on the map: Bridge Chains looks again every 20 seconds (app/page.js NetworkRefresh). */}
                    {s.mapping?.id && (
                      <div style={{ marginTop: 4 }}>
                        <Link href={`/?chain=${encodeURIComponent(s.mapping.id)}`} style={{ color: 'var(--sd-green, #00ff88)', fontWeight: 700 }}>
                          Watch it fill in →
                        </Link>
                        <span style={{ color: 'var(--sd-fg-3, #8b9a9a)', marginLeft: 8, fontSize: 12.5 }}>
                          {s.mapping.name ? `${s.mapping.name}’s circle, ` : ''}saved every 10 pages.
                        </span>
                      </div>
                    )}
                    <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5, marginTop: 2 }}>
                      Stop closes the browser cleanly and keeps everything found so far.
                    </div>
                  </div>
                  <Btn onClick={stop} tone="bad">Stop</Btn>
                </div>
              )}

              {/* A run that ended badly, and why: a box, not left for someone to find in the log. */}
              {failed && (
                <Box tone="bad">
                  <b>The last run stopped before it finished.</b>
                  {failReason && (
                    <div style={{
                      marginTop: 6, color: 'var(--sd-fg-2, #e8c4c4)', whiteSpace: 'pre-wrap',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5,
                    }}>{failReason}</div>
                  )}
                  <div style={{ color: 'var(--sd-fg-3, #9aa)', marginTop: 6 }}>The full log is at the foot of this card.</div>
                </Box>
              )}

              {/* ---- Your connections: the first scan, then Check for new ---- */}
              <Part title="Your connections" hint={mapped > 0
                ? 'Check for new picks up anyone you’ve added since. Scan it all again reads the whole list.'
                : 'Reads your connections list and saves everyone here. About a minute and a half for 750 people.'}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {mapped > 0 ? <>
                    <Btn onClick={() => run('refresh')} disabled={!canScanList} primary cluster active={Boolean(running && s.action === 'refresh')}>
                      <ClusterSpinner size={13} live={Boolean(running && s.action === 'refresh')} />
                      {running && s.action === 'refresh' ? 'Checking…' : 'Check for new'}
                    </Btn>
                    <Btn onClick={() => run('full')} disabled={!canScanList}>
                      {running && s.action === 'full' ? 'Scanning…' : 'Scan it all again'}
                    </Btn>
                  </> : (
                    <Launch onClick={() => run('full')} disabled={!canScanList}>
                      {running && s.action === 'full' ? 'Scanning…' : 'Scan my network'}
                    </Launch>
                  )}
                </div>
                {why && <Why>{why}</Why>}
              </Part>

              {/* ---- Their circles: Auto-Bridge, the radar with today's budget round it ---- */}
              <Part title="Their circles" hint={<>
                Reads who your connections know, one at a time, for Degrees, Separation and Outlink. The first
                circle shows in {firstCircle}; the rest fills in over days,{' '}
                {li?.limits?.daily ? `${li.limits.daily} searches a day` : 'a few searches a day'}, each round carrying on where the last stopped.
              </>}>
                <CooldownBanner cooldown={li?.cooldown} disabled={busy} onLift={() => run('lift-cooldown')} />
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
                  <ScanRadar
                    li={li}
                    running={Boolean(running)}
                    scanning={Boolean(running && s?.action?.startsWith('auto-bridge'))}
                    disabled={!canSearch || (order === 'score' && !tiers.length)}
                    label={running && s?.action === 'auto-bridge' ? 'Mapping…' : 'Map 2nd degree'}
                    sublabel={running ? (batch ? `${batch} people` : 'everyone') : `first circle in ${firstCircle}`}
                    onScan={() => run('auto-bridge', { ...roundOptions, experimental })}
                    onPace={busy ? undefined : (pace) => run('set-limits', { ...(li?.limits || {}), pace })}
                  />
                  <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <label style={labelRow}>
                      This round
                      <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} disabled={running} style={selectStyle}>
                        <option value={5}>5 people</option>
                        <option value={10}>10 people</option>
                        <option value={25}>25 people</option>
                        <option value={0}>everyone (not advised)</option>
                      </select>
                    </label>
                    <label style={labelRow}>
                      Start with
                      <select value={order} onChange={(e) => setOrder(e.target.value)} disabled={running} style={selectStyle}>
                        <option value="newest">Newest connections</option>
                        <option value="score">Highest tier</option>
                      </select>
                    </label>
                    {order === 'score' && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)' }}>Work through</span>
                      {['S', 'A', 'B', 'C', 'D'].map((t) => {
                        const on = tiers.includes(t);
                        return (
                          <button
                            key={t}
                            onClick={() => setTiers((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))}
                            disabled={running}
                            style={{
                              width: 30, height: 28, borderRadius: 7, fontSize: 12, fontWeight: 700,
                              cursor: running ? 'not-allowed' : 'pointer', border: LINE,
                              background: on ? 'rgba(52,152,219,0.22)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.05)',
                              color: on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-4, #667)',
                            }}
                          >{t}</button>
                        );
                      })}
                      <span style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #667)' }}>
                        {tiers.length ? '' : 'pick at least one'}
                      </span>
                    </div>}
                    {order === 'newest' && (
                      <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6 }}>
                        Newest first, across every tier. Run <b>Check for new</b> first so your latest connections are in.
                      </div>
                    )}
                    <WhySlow />
                  </div>
                </div>
              </Part>

              {/* ---- In progress: everyone whose read stopped partway, with Resume (Blake, 2026-10-03).
                   Only there while someone is. ---- */}
              <PausedList
                paused={s?.paused || []}
                disabled={!canSearch}
                onResume={(p) => run('resume', { id: p.id })}
                onResumeAll={() => run('resume-all', { maxBridges: batch })}
              />

              {/* Photos an older version kept as links to LinkedIn. The app shows only photos saved here
                  (lib/photos.js); every scan saves them at its end, and this is the way without scanning. */}
              {s?.photosWaiting > 0 && !running && (
                <Box>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <b>{s.photosWaiting.toLocaleString()} {s.photosWaiting === 1 ? 'photo isn’t' : 'photos aren’t'} saved on this computer yet.</b>{' '}
                      <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>
                        Until they are, those people show initials. They save now, or at the end of your next scan;
                        an expired link comes back when that person is next scanned.
                      </span>
                      {!c.dependencies && (
                        <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5, marginTop: 6 }}>Set up the scanner first (in Setup): it saves them.</div>
                      )}
                    </div>
                    <Btn onClick={() => run('photos')} disabled={busy || !c.dependencies}>Save photos</Btn>
                  </div>
                </Box>
              )}

              {/* The scanner's own words, for when you want them: open by itself when a run stopped badly. */}
              {(s?.log?.length > 0) && (
                <details open={failed} style={{ marginTop: 18 }}>
                  <summary style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    margin: '8px 0', fontSize: 12, color: 'var(--sd-fg-3, #788)', textTransform: 'uppercase', letterSpacing: 0.6,
                  }}>
                    {running && <Spinner />}
                    {running ? 'What it’s doing (the log)' : 'The last run’s log'}
                  </summary>
                  <pre ref={logRef} style={{
                    background: 'rgba(var(--sd-shade, 0, 0, 0), 0.45)', border: LINE, borderRadius: 8,
                    padding: 14, maxHeight: 280, overflow: 'auto', margin: 0,
                    fontSize: 12.5, lineHeight: 1.7, color: 'var(--sd-fg-2, #b9c6c6)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{s.log.join('\n')}</pre>
                </details>
              )}
            </section>

            {/* ---- Setup, beside the scanner: one box of green lights ---- */}
            <SetupBox steps={steps} allSet={allSet} left={left} isOpen={isOpen} onToggle={toggle} />
          </div>

          {/* ---- The scanner's settings: each one a line that says what it does ---- */}
          <section aria-labelledby="scan-settings" className="scan-card" style={{ marginTop: 20 }}>
            <h2 id="scan-settings" style={h2}>Scanner settings</h2>
            <div style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', marginBottom: 14 }}>
              How fast it goes, how much it may search, and how much of each list it reads. Speed is beside the Scan button above.
            </div>
            <div className="scan-two">
              <div>
                <SettingTitle title="LinkedIn budget" line="Searches and profile views the scanner may use. It stops at the budget and carries on next time." />
                <BudgetBox li={li} disabled={busy} onSetLimits={(l) => run('set-limits', l)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <SettingTitle title="How much of each list" line="Every page is one LinkedIn search; LinkedIn shows 100 pages at most." />
                  <select value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={running} style={selectStyle} aria-label="Read up to">
                    <option value={100}>Every page, to the end of their list</option>
                    <option value={50}>50 pages each</option>
                    <option value={25}>25 pages each</option>
                    <option value={10}>10 pages (~100 people) each</option>
                  </select>
                </div>
                <Toggle checked={finish} disabled={running} onChange={setFinish}
                  title="Finish lists that stopped partway"
                  line="Each round also carries on with people already mapped, from the page each one stopped at." />
                <div>
                  <SettingTitle title="Hidden lists" line="People whose list was hidden last time, in case they’ve opened it. Costs a profile view each." />
                  <Btn onClick={() => run('auto-bridge-retry', roundOptions)} disabled={!canSearch || (order === 'score' && !tiers.length)}>
                    Retry hidden ones
                  </Btn>
                </div>
                <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6 }}>
                  At {paceOf(li?.limits?.pace).label} it rests {paceOf(li?.limits?.pace).pagePause} seconds before each page and{' '}
                  {paceOf(li?.limits?.pace).chunkCooldown / 60 === 1 ? 'a minute' : `${paceOf(li?.limits?.pace).chunkCooldown / 60} minutes`} after
                  every 10, so a long list takes about {circleScanCost(pages, li?.limits?.pace).minutes} minutes a person.
                  If LinkedIn says a free account&rsquo;s monthly search limit is reached, the scan saves what it read and
                  carries on from that page next time. Keep batches small.
                </div>
              </div>
            </div>
          </section>

          {/* ---- Extras: the switches, each with what it does in a line ---- */}
          <section aria-labelledby="scan-extras" className="scan-card" style={{ marginTop: 20 }}>
            <h2 id="scan-extras" style={h2}>Extras</h2>
            <div className="scan-two" style={{ marginTop: 10 }}>
              <Toggle checked={experimental} disabled={running} tag="Experimental"
                onChange={(on) => { setExperimental(on); window.dispatchEvent(new Event('six-degrees:experimental')); }}
                title="Auto scan, all day"
                line="Adds Auto scan beside Scan in the header: small sittings with rests, 9:00 to 18:00, while the app is open."
                more={<>
                  Up to 8 pages in a sitting, then an hour&rsquo;s rest; searches only from 9:00 to 18:00; never more than 40
                  searches in a day or 200 in a week, however high your budget; two days&rsquo; rest after any check from
                  LinkedIn; at the budget it waits instead of stopping; and it saves every page. It also reads
                  LinkedIn&rsquo;s own data beside the page text, to fill gaps and measure how the two compare.
                </>} />
              {/* Blake, 2026-10-04: seamless, "not to have any disruption through pop ups or windows":
                  every scan runs in a real Chrome window kept out of sight, which comes forward only when
                  LinkedIn needs you. This is for anyone who wants to watch instead. */}
              <Toggle checked={showChrome} disabled={running} onChange={setShowChrome}
                title="Show the scanner’s Chrome window"
                line="Scans run in a Chrome window in front of you, to watch it work. Off, it stays out of sight until LinkedIn needs you."
                more="The notch shows what it’s doing either way, and Stop works the same. It changes nothing about pacing or your daily budget." />
              {social && (
                <Toggle checked={social.autoSync === true} disabled={running} onChange={syncMessages} tag="Experimental"
                  title="Sync messages once a day"
                  line="Brings your LinkedIn conversations up to date for the Social tab, once a day, with the scanner." />
              )}
            </div>
          </section>

          {/* ---- LinkedIn usage, last (Blake, 2026-10-04: "usage should be more at the bottom and should be
               in scanner"). It was Settings → LinkedIn usage; /settings#usage now comes here. ---- */}
          <div className="scan-card" style={{ marginTop: 20, paddingTop: 0, paddingBottom: 0 }}>
            <UsageSection />
          </div>
        </>}

      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }
        @keyframes slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }`}</style>
    </div>
  );
}

// One person's circle, picked in Insights (Scan circle): what it costs beside
// what the budget has left, and one button that starts it (backlog 2.4). Their
// read goes as deep as "Read up to" below says; Bridge Chains shows it filling in.
function ScanOne({ pick, pages, setPages, li, running, s, canSearch, busy, onStart, onUnpick }) {
  const { person, circle } = pick;
  const first = String(person.name || '').trim().split(/\s+/)[0] || 'them';
  const cost = circleScanCost(pages, li?.limits?.pace);
  const theirs = running && s?.target?.id === person.id;
  const short = li?.leftToday != null && li.leftToday < cost.searches;
  return (
    <div style={{
      margin: '16px 0', padding: '16px 18px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.6,
      background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.3)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-green, #00ff88)', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
        Scan one circle
      </div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>
        {person.name} <span style={{ fontSize: 12, color: TIER[person.tier] || '#888' }}>{person.tier}-tier</span>
      </div>
      {person.unlocked_from_name && (
        <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #9aa)' }}>Was in {person.unlocked_from_name}&rsquo;s circle</div>
      )}
      {theirs ? (
        <div style={{ marginTop: 10 }}>
          <b>Scanning {first}&rsquo;s circle.</b> It saves every 10 pages, and{' '}
          <Link href={`/?chain=${encodeURIComponent(person.id)}`} style={{ color: 'var(--sd-green, #00ff88)' }}>Bridge Chains shows it filling in →</Link>
        </div>
      ) : (
        <>
          <div style={{ color: 'var(--sd-fg-2, #b8c4c4)', marginTop: 10 }}>
            It costs <b>{cost.profileViews} profile view</b> to find their list, then <b>one LinkedIn search for
            every page</b> of it: up to {cost.searches} {cost.searches === 1 ? 'page' : 'pages'}, about {cost.minutes} minutes.
            {li?.leftToday != null && <> <b>{li.leftToday}</b> of your {li.limits?.daily} searches a day are left{short ? '; the scan stops when they run out, and can carry on from that page later' : ''}.</>}
          </div>
          {circle === 'scanned' && (
            <div style={{ color: 'var(--sd-gold, #FFD700)', fontSize: 12.5, marginTop: 6 }}>
              Their circle is already scanned. This reads their whole list again from page 1; to carry on
              from where a read stopped, use Resume on their card or under In progress below.
            </div>
          )}
          {circle === 'hidden' && (
            <div style={{ color: 'var(--sd-gold, #FFD700)', fontSize: 12.5, marginTop: 6 }}>
              Their list was hidden last time it was tried. Trying again costs a profile view.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <Btn onClick={onStart} disabled={!canSearch || busy} primary>Scan {first}&rsquo;s circle</Btn>
            <select value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={running} style={selectStyle}
              aria-label="How many pages of their list to read">
              <option value={100}>every page, to the end of their list</option>
              <option value={50}>up to 50 pages</option>
              <option value={25}>up to 25 pages</option>
              <option value={10}>up to 10 pages (~100 people)</option>
            </select>
            <Btn onClick={onUnpick}>Not now</Btn>
          </div>
          {!canSearch && (
            <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 8 }}>
              {running ? 'Something else is running. One scan at a time: this one can start when it finishes.'
                : li?.cooldown ? 'Scanning is paused for now (see below).'
                : 'The scanner isn’t ready yet: finish the steps below first.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)

// A setting this browser remembers between visits: the order and depth someone
// picked should not reset every time the page opens. localStorage can be missing
// or throw (private windows), and then it is simply not remembered.
function useRemembered(key, fallback) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setValue(JSON.parse(saved));
    } catch { /* not remembered */ }
  }, [key]);
  const set = (next) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not remembered */ }
  };
  return [value, set];
}

const selectStyle = {
  padding: '9px 10px', borderRadius: 7, fontSize: 13.5, fontWeight: 600,
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)', border: LINE,
};

const labelRow = { display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--sd-fg-2, #cfd8d8)' };
const h2 = { fontSize: 17, fontWeight: 800, margin: '0 0 4px' };

// The page's grid: the scanner and Setup side by side on a wide window, one
// column on a narrow one (Setup first there while it still has steps to do),
// and the settings and extras in two columns where they fit.
const PAGE_CSS = `
.scan-top { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
.scan-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px 28px; align-items: start; }
.scan-card { padding: 22px 24px; border-radius: 16px; border: ${LINE}; background: rgba(var(--sd-ink, 255, 255, 255), 0.035); min-width: 0; }
.scan-main { background: radial-gradient(120% 90% at 0% 0%, rgba(0,255,136,0.07), rgba(52,152,219,0.04) 45%, rgba(var(--sd-ink, 255, 255, 255), 0.03) 75%); border-color: rgba(0,255,136,0.22); }
.scan-step-head { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; border-radius: 10px; }
.scan-step-head:hover { background: rgba(var(--sd-ink, 255, 255, 255), 0.05); }
.scan-step-head:focus-visible { outline: 2px solid var(--sd-blue, #3498DB); outline-offset: 1px; }
.scan-chev { transition: transform .15s ease; }
.launch-go { transition: transform .15s ease, box-shadow .2s ease, filter .2s ease; }
.launch-go:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 8px 30px rgba(0,255,136,.35); filter: brightness(1.08); }
.launch-go:not(:disabled):active { transform: translateY(0) scale(.98); }
@media (max-width: 940px) {
  .scan-top, .scan-two { grid-template-columns: minmax(0, 1fr); }
  .scan-setup-first .scan-setup { order: -1; }
}
@media (max-width: 520px) { .scan-card { padding: 18px 16px; } }
@media (prefers-reduced-motion: reduce) { .scan-chev, .launch-go { transition: none; } }
`;

const LIGHT = {
  done: { color: 'var(--sd-green, #00ff88)', glow: 'rgba(0,255,136,0.45)', word: 'done' },
  bad: { color: 'var(--sd-red, #ff7676)', glow: 'rgba(255,90,90,0.45)', word: 'needs you' },
  optional: { color: 'var(--sd-gold, #FFD700)', glow: 'rgba(255,215,0,0.35)', word: 'optional' },
  wait: { color: 'rgba(var(--sd-ink, 255, 255, 255), 0.28)', glow: 'transparent', word: 'waiting on a step above' },
};

/**
 * Setup as one box of green lights (Blake, 2026-10-04): a step that's done is
 * one line, a tick and a few words; one that needs you is red and open; each
 * has a chevron to open or close it. "All set" once every step is green.
 */
function SetupBox({ steps, allSet, left, isOpen, onToggle }) {
  return (
    <aside aria-labelledby="scan-setup" className="scan-card scan-setup" style={{
      padding: '16px 12px 12px',
      ...(allSet ? { borderColor: 'rgba(0,255,136,0.25)' } : left ? { borderColor: 'rgba(255,90,90,0.35)' } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 8px' }}>
        <h2 id="scan-setup" style={{ ...h2, margin: 0, flex: 1 }}>Setup</h2>
        <span style={{
          fontSize: 11.5, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
          color: allSet ? 'var(--sd-green, #00ff88)' : 'var(--sd-red, #ff7676)',
          background: allSet ? 'rgba(0,255,136,0.12)' : 'rgba(255,90,90,0.12)',
        }}>{allSet ? '✓ All set' : `${left} to do`}</span>
      </div>
      <div role="list">
        {steps.map((x) => {
          const open = isOpen(x);
          const light = LIGHT[x.state];
          return (
            <div role="listitem" key={x.key} data-step={x.key} data-state={x.state} style={{
              borderRadius: 10, marginTop: 2,
              background: open ? 'rgba(var(--sd-ink, 255, 255, 255), 0.035)' : 'transparent',
            }}>
              <button type="button" className="scan-step-head" aria-expanded={open} onClick={() => onToggle(x)}
                aria-label={`${x.name}: ${light.word}. ${open ? 'Close' : 'Open'} details`}>
                <span aria-hidden="true" style={{
                  width: 18, height: 18, borderRadius: '50%', flex: '0 0 auto', display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 900, color: x.state === 'done' ? '#04140c' : '#fff',
                  background: light.color, boxShadow: `0 0 10px ${light.glow}`,
                }}>{x.state === 'done' ? '✓' : x.state === 'bad' ? '!' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>{x.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: x.state === 'bad' ? 'var(--sd-red, #ff7676)' : 'var(--sd-fg-3, #8b9a9a)' }}>{x.summary}</span>
                </span>
                <span aria-hidden="true" className="scan-chev" style={{
                  fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', transform: open ? 'rotate(90deg)' : 'none',
                }}>▶</span>
              </button>
              {open && <div style={{ padding: '2px 12px 14px 40px' }}>{x.body}</div>}
            </div>
          );
        })}
      </div>
      {/* What it never does, under the steps, in a line each. */}
      <div style={{ borderTop: LINE, margin: '10px 12px 0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {['Never posts or messages anyone; sends a request only when you press Auto', 'Never sees your password', 'Nothing leaves this Mac', 'Stops the moment you say'].map((t) => (
          <span key={t} style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--sd-green, #00ff88)', fontWeight: 900 }}>✓</span>{t}
          </span>
        ))}
      </div>
    </aside>
  );
}

const Eyebrow = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--sd-green, #00ff88)' }}>{children}</div>
);

/** One part of the scanner card: a title, a line on what it does, then its controls. */
function Part({ title, hint, children }) {
  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: LINE }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--sd-fg-3, #9fb0bb)', lineHeight: 1.6, margin: '2px 0 12px', maxWidth: 640 }}>{hint}</div>
      {children}
    </div>
  );
}

/** Why a button can't be pressed yet, under it: never a pop-up. */
const Why = ({ children }) => (
  <div role="note" style={{ fontSize: 12.5, color: 'var(--sd-gold, #FFD700)', marginTop: 8 }}>{children}</div>
);

const StepText = ({ children }) => (
  <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #9fb0bb)', lineHeight: 1.6 }}>{children}</div>
);
const StepActions = ({ children }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>{children}</div>
);

const SettingTitle = ({ title, line }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
    <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>{line}</div>
  </div>
);

/** A switch with its name, what it does in a line, and the rest one tap away. */
function Toggle({ checked, onChange, disabled, title, line, more, tag }) {
  const id = useId();
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: disabled ? 'not-allowed' : 'pointer' }} />
      <div style={{ minWidth: 0 }}>
        <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'default' : 'pointer' }}>
          {title}
          {tag && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--sd-gold, #FFD700)' }}>{tag}</span>}
        </label>
        <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>{line}</div>
        {more && (
          <details style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--sd-fg-2, #aab7c4)', fontWeight: 600 }}>More</summary>
            <div style={{ marginTop: 4 }}>{more}</div>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * Step 1's optional item on a Mac (lib/scanner-setup.js appManagementStep):
 * why macOS may ask about App Management while scanning, the button that opens
 * that pane, and Done or Skip, either of which puts it away for good.
 */
function AppManagementItem({ item, onAnswer }) {
  return (
    <section aria-labelledby="app-management-title" data-app-management style={{
      marginTop: 10, padding: '14px 18px', borderRadius: 14,
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.025)',
      border: '1px dashed rgba(var(--sd-ink, 255, 255, 255), 0.16)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span id="app-management-title" style={{ fontSize: 16, fontWeight: 800 }}>{item.title}</span>
        <span style={{ fontSize: 12, color: 'var(--sd-fg-2, #8fd9b6)', marginLeft: 'auto' }}>Optional, once</span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--sd-fg-3, #9fb0bb)', lineHeight: 1.6, margin: '6px 0 12px', maxWidth: 600 }}>{item.text}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Launch href={item.href} quiet>Open App Management</Launch>
        <Btn onClick={() => onAnswer('done')}>Done</Btn>
        <Btn onClick={() => onAnswer('skipped')}>Skip</Btn>
      </div>
      <div style={{ fontSize: 12, color: 'var(--sd-fg-4, #778)', marginTop: 10 }}>It&rsquo;s in {item.where}.</div>
    </section>
  );
}

/**
 * The big go button. `quiet` once that step is done, so the next thing to do
 * stands out. With `href`, a link that looks the same: a web address (Chrome's
 * download) opens outside the app, which the desktop app sends to the browser.
 * A System Settings address (App Management) opens in place: a browser then
 * asks to open System Settings without leaving an empty tab behind, and the
 * desktop app opens System Settings itself (desktop/main.mjs).
 */
function Launch({ children, onClick, disabled, quiet = false, href }) {
  if (href) {
    const web = /^https?:/i.test(href);
    return (
      <a className="launch-go" href={href} {...(web ? { target: '_blank', rel: 'noreferrer' } : {})} style={{
        ...launchLook(false, quiet), textDecoration: 'none',
      }}>
        <span aria-hidden="true" style={{ fontSize: quiet ? 11 : 13 }}>▶</span>{children}
      </a>
    );
  }
  return (
    <button type="button" className="launch-go" onClick={onClick} disabled={disabled} style={launchLook(disabled, quiet)}>
      <span aria-hidden="true" style={{ fontSize: quiet ? 11 : 13 }}>▶</span>{children}
    </button>
  );
}

function launchLook(disabled, quiet) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 10, padding: quiet ? '10px 18px' : '13px 26px', borderRadius: 12,
    fontSize: quiet ? 14 : 16, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--sd-fg-4, #667)' : quiet ? 'var(--sd-fg-1, #cfe8dc)' : '#04140c', border: quiet ? '1px solid rgba(0,255,136,0.35)' : 'none',
    background: disabled ? 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' : quiet ? 'rgba(0,255,136,0.08)' : 'linear-gradient(135deg, #00ff88, #1abc9c)',
    boxShadow: disabled || quiet ? 'none' : '0 4px 22px rgba(0,255,136,0.25)',
  };
}

/** Why the second degree goes slowly: one tap away, not in the way. */
function WhySlow() {
  return (
    <details style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--sd-fg-2, #aab7c4)', fontWeight: 600 }}>Why so slow?</summary>
      <div style={{ marginTop: 6 }}>
        This is the part LinkedIn notices. While this app was being built, a real account was
        restricted for a while after roughly <b>19 people in one sitting</b>. So: a small batch, a day&rsquo;s
        rest, another batch, and stop the moment LinkedIn mentions unusual activity. Most people hide
        their connections; those are noted and never tried again. A list is read to the end, saving every
        10 pages, and a stopped read carries on from the same page.
      </div>
    </details>
  );
}

// `cluster`: its first child is a ClusterSpinner, built on hover (app/components/ClusterSpinner.js).
// `active`: its own job is running, so it stays lit (and can't be pressed again).
function Btn({ children, onClick, disabled, primary, tone, cluster = false, active = false }) {
  const bg = tone === 'bad' ? 'rgba(255,80,80,0.15)'
    : primary ? 'linear-gradient(135deg, #9B59B6, #3498DB)'
    : 'rgba(var(--sd-ink, 255, 255, 255), 0.08)';
  return (
    <button onClick={onClick} disabled={disabled} className={cluster ? 'cluster-host' : undefined} style={{
      padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 650,
      // White on the purple gradient in every look; the theme's words elsewhere.
      color: disabled && !active ? 'var(--sd-fg-4, #667)' : primary ? '#fff' : 'var(--sd-fg-1, #fff)', background: disabled && !active ? 'rgba(var(--sd-ink, 255, 255, 255), 0.05)' : bg,
      border: LINE, cursor: active ? 'progress' : disabled ? 'not-allowed' : 'pointer',
      ...(cluster ? { display: 'inline-flex', alignItems: 'center', gap: 8 } : {}),
    }}>{children}</button>
  );
}

// Before the first scan, once: what scanning does and risks, and an explicit
// "I understand" (lib/scan-risk.js). The CSV stays one click away for anyone
// who would rather not.
function RiskCard({ onAccept, busy }) {
  return (
    <div role="region" aria-label="Before your first scan" style={{
      margin: '6px 0 18px', padding: '16px 18px', borderRadius: 12,
      border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)',
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sd-fg-1, #fff)', marginBottom: 8 }}>Before your first scan</div>
      <ul style={{ margin: '0 0 14px', paddingLeft: 18, color: 'var(--sd-fg-2, #c8d0d0)', fontSize: 13.5, lineHeight: 1.65 }}>
        {RISK_POINTS.map((p) => <li key={p} style={{ marginBottom: 4 }}>{p}</li>)}
      </ul>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn onClick={onAccept} disabled={busy} primary>I understand</Btn>
        <span style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>
          Rather not? LinkedIn’s own CSV export needs none of this:{' '}
          <Link href="/import" style={{ color: 'var(--sd-blue, #3498DB)' }}>import a CSV instead</Link>.
        </span>
      </div>
    </div>
  );
}

function Box({ children, tone }) {
  return (
    <div style={{
      margin: '16px 0', padding: '14px 16px', borderRadius: 8, fontSize: 13.5, lineHeight: 1.6,
      background: tone === 'bad' ? 'rgba(255,80,80,0.08)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.05)',
      border: `1px solid ${tone === 'bad' ? 'rgba(255,80,80,0.3)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.12)'}`,
    }}>{children}</div>
  );
}

// How far the running scan has got (lib/scan-progress.js reads it from the log).
// "Check for new" gets words, not a bar: it stops as soon as it meets people
// already saved, so a bar measured against the whole list would sit near empty
// and then vanish, which looks like a failure.
function Progress({ p, action }) {
  if (p.kind === 'saving') {
    return (
      <div style={{ margin: '8px 0 6px' }}>
        <div role="progressbar" aria-label="Saving" style={{
          height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', marginBottom: 6,
        }}>
          <div style={{
            width: '35%', height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #9B59B6, #3498DB)', animation: 'slide 1.2s ease-in-out infinite',
          }} />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--sd-fg-1, #cfe6f7)' }}>
          Saving to your network and fetching photos. This can take a minute or two.
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
  let text;
  if (p.kind === 'download') text = `Downloading Python: ${p.done.toFixed(1)} of ${p.total.toFixed(1)} MB · ${pct}%`;
  else if (p.kind === 'batch') text = `Person ${p.current} of ${p.total}`;
  else if (action === 'refresh') text = `Looked at ${p.done.toLocaleString()} so far, and stops once it reaches people already saved`;
  else text = `${p.done.toLocaleString()} of ${p.total.toLocaleString()} connections · ${pct}%`;

  return (
    <div style={{ margin: '8px 0 6px' }}>
      {action !== 'refresh' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={p.total}
          aria-valuenow={p.done}
          aria-label={text}
          style={{
            height: 8, borderRadius: 4, overflow: 'hidden',
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', marginBottom: 6,
          }}
        >
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #9B59B6, #3498DB)',
            transition: 'width 0.6s ease',
          }} />
        </div>
      )}
      <div style={{ fontSize: 12.5, color: 'var(--sd-fg-1, #cfe6f7)' }}>{text}</div>
    </div>
  );
}

function Spinner() {
  return <span style={{
    width: 11, height: 11, borderRadius: '50%', display: 'inline-block',
    border: '2px solid rgba(var(--sd-ink, 255, 255, 255), 0.2)', borderTopColor: '#3498DB',
    animation: 'spin 0.8s linear infinite',
  }} />;
}
