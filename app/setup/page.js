'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import OnboardingGate from '../components/OnboardingGate';
import Link from 'next/link';
import { stopScrape, pickedPerson, scanRequest, HIDE_CHROME_KEY } from '../../lib/scraper-client';
import { setupStep, askForField } from '../../lib/scanner-setup';
import { IS_DEMO } from '../../lib/demo';
import { circleScanCost } from '../../lib/reach';
import ScanRadar from '../components/ScanRadar';
import AppHeader from '../components/AppHeader';
import { paceOf } from '../../lib/scan-pace';
import { BudgetBox, CooldownBanner, PausedList } from '../components/LinkedInLimits';
import FieldStep, { FieldAnswer } from '../components/FieldStep';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';

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
};

export default function SetupPage() {
  // Suspense because SetupInner reads the address's ?scan= (useSearchParams),
  // which Next requires to sit inside one for the page to build.
  return <OnboardingGate><Suspense><SetupInner /></Suspense></OnboardingGate>;
}

function SetupInner() {
  // Updates moved to Settings; an old menu item or bookmark still lands there.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('check') === 'updates') {
      window.location.replace('/settings?check=updates');
    }
  }, []);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
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
  // Scanning with no Chrome window (scripts/scrape.py --headless); lib/scraper-client.js reads it for every scan.
  const [hideChrome, setHideChrome] = useRemembered(HIDE_CHROME_KEY, false);
  const [error, setError] = useState(null);
  const logRef = useRef(null);
  // What's saved, for the question about your field: undefined while it
  // loads, null when it couldn't be read. And the answer given here, if any.
  const [settings, setSettings] = useState(undefined);
  const [field, setField] = useState(null);
  // Someone sent here to have their circle scanned (Bridge Chains, the Degrees
  // panel's Ready to scan): /setup?scan=<id>. Nothing starts until it's confirmed.
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

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/scraper');
      setS(await r.json());
    } catch {
      setS((prev) => prev || { ready: false, checks: {}, log: [] });
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (IS_DEMO) return;
    let off = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off) setSettings(d?.settings || null); })
      .catch(() => { if (!off) setSettings(null); });
    return () => { off = true; };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [s?.log?.length]);

  async function stop() {
    setError(null);
    await stopScrape().catch((e) => setError(e.message));
    poll();
  }

  // The question is answered: the steps take its place, from the top, since
  // it may have been answered from far down the picker.
  function answered(sectors) {
    setField({ sectors });
    window.scrollTo(0, 0);
  }

  async function run(action, extra = {}) {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // With "Hide the Chrome window" from the switch below; this page's own
        // buttons used to leave it out, so it never hid anything started here.
        body: JSON.stringify(scanRequest(action, extra, hideChrome)),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || 'Could not start.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      poll();
    }
  }

  const c = s?.checks || {};
  const running = s?.running;
  // Step 1 (lib/scanner-setup.js): ready (the Mac app's own Python, or one
  // installed), Install, Set up the scanner (download a Python first), or neither;
  // and a line of its own when the Python inside the app didn't work.
  const step1 = setupStep(s);
  const needsDeps = s && !c.dependencies;
  const needsChrome = s && !c.chrome;
  const notFound = s && !c.scriptsFound;
  const canScrape = s?.ready && !running;
  // Anything that searches LinkedIn waits out a cooldown (TRAPS §35).
  const li = s?.linkedin;
  const cooling = Boolean(li?.cooldown);
  const canSearch = canScrape && !cooling;
  // By degree, because one total reads as "connections" and is not: the people
  // you know, then the people found through them, then company scans.
  const net = s?.network || { first: 0, second: 0, third: 0 };
  const mapped = net.first;
  // The step you're on: the first not done. Any other opens from the rail.
  const current = !s || !step1.done ? 1 : !c.signedIn ? 2 : mapped === 0 ? 3 : 4;
  // Each step: done, the one you're on (now), or still to come (next).
  const stateOf = (n, done) => (done && n !== current ? 'done' : n === current ? 'now' : n < current ? 'done' : 'next');
  // Your field, asked once before the first scan (lib/scanner-setup.js
  // askForField). The steps wait while that isn't known yet (null).
  const askField = IS_DEMO || field ? false : askForField(s, settings);
  // A run that ended badly, and the line that says why — the last thing it
  // printed before stopping. Shown as a box, not left for someone to find in the log.
  const failed = s && !running && s.exitCode != null && s.exitCode !== 0;
  // The server keeps the end of stderr for exactly this; older servers did not,
  // so fall back to the last line the log shows.
  const failReason = failed
    ? (s.failure?.length ? s.failure.join('\n')
      : [...(s.log || [])].reverse().find((l) => !/^Stopped \(exit/.test(l) && !/Warning|warnings\.warn/.test(l)))
    : null;

  return (
    <div style={{
      minHeight: '100vh', background: BG, color: 'var(--sd-fg-1, #fff)',
      fontFamily: 'var(--sd-font)',
    }}>
      {/* The same header as every page, Scan lit (Blake, 2026-10-02: continuity) */}
      <AppHeader active="scan" brand="span" />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* What the scanner is, in one breath, and what it never does */}
        <div style={{
          padding: '26px 26px 22px', borderRadius: 16, marginBottom: 22, position: 'relative', overflow: 'hidden',
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(0,255,136,0.10), rgba(52,152,219,0.06) 45%, rgba(var(--sd-ink, 255, 255, 255), 0.02) 75%)',
          border: '1px solid rgba(0,255,136,0.22)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: 'var(--sd-green, #00ff88)' }}>YOUR SCANNER</div>
          <h1 style={{ fontSize: 27, fontWeight: 800, margin: '6px 0 8px', lineHeight: 1.2 }}>
            {mapped > 0 ? 'Your network is mapped. Send the scanner further.' : 'Map your network in four steps.'}
          </h1>
          <div style={{ fontSize: 14.5, color: 'var(--sd-fg-2, #aab7c4)', lineHeight: 1.6, maxWidth: 560 }}>
            It works in your own Chrome on this Mac, slowly and in the open, and keeps everything here.
            You launch it; it does the reading; you watch it go.
          </div>
          <div style={{ display: 'flex', gap: '8px 18px', flexWrap: 'wrap', marginTop: 16 }}>
            {['Never posts or messages anyone', 'Never sees your password', 'Nothing leaves this Mac', 'Stops the moment you say'].map((t) => (
              <span key={t} style={{ fontSize: 12.5, color: 'var(--sd-fg-1, #cfe8dc)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--sd-green, #00ff88)', fontWeight: 900 }}>✓</span>{t}
              </span>
            ))}
          </div>
        </div>

        {/* The first look at the scanner can take a while (it looks for Python): say so, never a blank page. */}
        {askField === null && <p style={{ color: 'var(--sd-fg-4, #778)', fontSize: 13 }}>Checking your setup…</p>}
        {askField && <FieldStep onDone={answered} />}
        {field && <FieldAnswer sectors={field.sectors} />}

        {askField === false && <>
          {/* By id: the server finds them by their profile, since two connections can share a name. */}
          {pick?.person.id === pickId && (
            <ScanOne
              pick={pick} pages={pages} setPages={setPages} li={li} running={running} s={s}
              canSearch={canSearch} busy={busy} onUnpick={unpick}
              onStart={() => run('bridge', { id: pick.person.id, maxPages: pages })}
            />
          )}

          {mapped > 0 && !running && (
            <Box>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <b>{mapped.toLocaleString()} connections</b>
                  {net.second > 0 && <>, plus {net.second.toLocaleString()} people in their circles</>}
                  {net.third > 0 && <> and {net.third.toLocaleString()} from company scans</>}
                  .{' '}
                  <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>Your galaxy is ready.</span>
                </div>
                <Link href="/" style={{
                  padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 700,
                  color: '#0a0a1a', textDecoration: 'none',
                  background: 'linear-gradient(135deg, #FFD700, #FF6B35)',
                }}>See your network →</Link>
              </div>
            </Box>
          )}

          {/* Photos an older version kept as links to LinkedIn. The app shows
              only photos saved here (lib/photos.js), so until then those people
              show initials. Every scan saves them at its end; this is the way
              without scanning. */}
          {s?.photosWaiting > 0 && !running && (
            <Box>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <b>{s.photosWaiting.toLocaleString()} {s.photosWaiting === 1 ? 'photo isn’t' : 'photos aren’t'} saved on this computer yet.</b>{' '}
                  <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>
                    An older version kept them as links to LinkedIn. The app doesn’t load
                    photos from LinkedIn while you browse, so those people show initials until
                    the photos are saved here: now, or at the end of your next scan. An expired
                    link can’t be saved; that person’s photo comes back when they’re next scanned.
                  </span>
                  {s && !c.dependencies && (
                    <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5, marginTop: 6 }}>Set up the scanner first (step 1 below): it saves them.</div>
                  )}
                </div>
                <Btn onClick={() => run('photos')} disabled={busy || !c.dependencies}>Save photos</Btn>
              </div>
            </Box>
          )}

          {failed && (
            <Box tone="bad">
              <b>The last run stopped before it finished.</b>
              {failReason && (
                <div style={{
                  marginTop: 6, color: 'var(--sd-fg-2, #e8c4c4)', whiteSpace: 'pre-wrap',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5,
                }}>{failReason}</div>
              )}
              <div style={{ color: 'var(--sd-fg-3, #9aa)', marginTop: 6 }}>The full log is below.</div>
            </Box>
          )}

          {notFound && (
            <Box tone="bad">
              <b>Can’t find the scanner files.</b><br />
              <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>
                Expected <code style={code}>scripts/scrape.py</code> next to the app. If you
                downloaded a zip, run the app from inside the project folder.
              </span>
            </Box>
          )}

          {needsChrome && (
            <Box tone="bad">
              <b>Google Chrome isn’t installed.</b><br />
              <span style={{ color: 'var(--sd-fg-3, #9aa)' }}>
                The scanner drives your real Chrome. Install it from{' '}
                <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer"
                   style={{ color: 'var(--sd-blue, #3498DB)' }}>google.com/chrome</a>, then reload this page.
              </span>
            </Box>
          )}

          {/* The Python inside the app didn't work: what happened, and what to do instead.
              Red only while there is something to do; once another Python runs the
              scanner it is just news. */}
          {s && step1.note && (
            <Box tone={step1.done ? undefined : 'bad'}>{step1.note}</Box>
          )}

          {/* ---- the steps (Blake, 2026-10-02: "simple and easy to understand … like they are
               launching an agent"; then "the label and them to be displayed … the dots vertically
               displayed with the line following"): every step shown at once, down a line that turns
               green as each is done, the one you're on lit, one button each. Everything else waits
               in Fine-tune. ---- */}
          <div role="list" aria-label="Scanning, step by step" style={{ margin: '4px 0 8px' }}>
          <style>{JOURNEY_CSS}</style>
          <StepRow n={1} label="Get ready" state={stateOf(1, step1.done)}>
            <Mission title="Get your scanner ready" time="A minute or two, once" done={step1.done} body={s ? step1.text : 'Checking…'}
              launch={s && step1.button && (
                <Launch onClick={() => run(step1.button.action)} disabled={busy || running}>{step1.button.label}</Launch>
              )} />
          </StepRow>
          <StepRow n={2} label="Sign in" state={stateOf(2, !!c.signedIn)}>
            <Mission title="Sign in to LinkedIn, once" time="You do this part" done={!!c.signedIn}
              body={c.signedIn
                ? 'Signed in on this Mac. If LinkedIn ever asks for a security check, or a scan says you were signed out, open LinkedIn here and finish it by hand.'
                : 'A Chrome window opens. Sign in with your email and password there: the scanner never sees them. (“Continue with Google” can’t work in it, because Google blocks its sign-in in automated browsers.)'}
              launch={c.dependencies && (
                // Shown after sign-in too: a security check survives the session cookie (TRAPS §35).
                <Launch onClick={() => run('login')} disabled={busy || running || current < 2} quiet={!!c.signedIn}>
                  {running && s.action === 'login' ? 'Waiting for you…' : c.signedIn ? 'Open LinkedIn again' : 'Open LinkedIn'}
                </Launch>
              )} />
          </StepRow>
          <StepRow n={3} label="Who you know" state={stateOf(3, mapped > 0)}>
            <Mission title="Map the people you know" time="About a minute and a half for 750 people" done={mapped > 0}
              body={mapped > 0
                ? `${mapped.toLocaleString()} connections saved. Check for new picks up anyone you've added since; Scan it all again reads the whole list.`
                : 'It reads your connections list and saves everyone here. After the first time, Check for new only looks at who you\'ve added since.'}
              launch={(
                <Launch onClick={() => run('full')} disabled={!canSearch || current < 3} quiet={mapped > 0}>
                  {running && s.action === 'full' ? 'Scanning…' : mapped > 0 ? 'Scan it all again' : 'Scan my network'}
                </Launch>
              )}
              more={mapped > 0 && (
                <Btn onClick={() => run('refresh')} disabled={!canSearch || current < 3} primary>
                  {running && s.action === 'refresh' ? 'Checking…' : '↻ Check for new'}
                </Btn>
              )} />
          </StepRow>
          <StepRow n={4} label="Who they know" state={stateOf(4, false)} last>
            <Mission title="Map who they know" time="A small batch a day, slowly"
              body={<>It opens your connections one at a time and reads who <i>they</i> know: that fills Degrees, Separation and Outlink. Every round picks up where the last one stopped.</>}>
              <CooldownBanner
                cooldown={li?.cooldown}
                disabled={busy}
                onLift={() => run('lift-cooldown')}
              />
              {/* The radar: Scan in the middle, today's budget round it, the speed beside it */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                <ScanRadar
                  li={li}
                  running={Boolean(running)}
                  scanning={Boolean(running && s?.action?.startsWith('auto-bridge'))}
                  disabled={!canSearch || (order === 'score' && !tiers.length)}
                  label={running && s?.action === 'auto-bridge' ? 'Mapping…' : 'Map 2nd degree'}
                  sublabel={batch ? `${batch} people` : 'everyone'}
                  onScan={() => run('auto-bridge', { maxBridges: batch, tiers: order === 'score' ? tiers : [], order, maxPages: pages, deeper: finish, experimental })}
                  onPace={busy ? undefined : (pace) => run('set-limits', { ...(li?.limits || {}), pace })}
                />
                <div style={{ flex: '1 1 230px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--sd-fg-2, #cfd8d8)' }}>
                    This round
                    <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} disabled={running} style={selectStyle}>
                      <option value={5}>5 people</option>
                      <option value={10}>10 people</option>
                      <option value={25}>25 people</option>
                      <option value={0}>everyone — not advised</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'var(--sd-fg-2, #cfd8d8)' }}>
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
                    Goes by the date you connected, newest first, across every tier. Run
                    {' '}<b>Check for new</b> first so your latest connections are in the list.
                  </div>
                )}
                  <WhySlow />
                </div>
              </div>
            </Mission>
          </StepRow>
          </div>

          {/* ---- the scanner at work: what it's doing, and Stop, right under the step ---- */}
          {running && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 20,
              padding: '14px 16px', borderRadius: 8,
              background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.3)',
            }}>
              <Spinner />
              <div style={{ flex: 1, fontSize: 13.5 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'var(--sd-green, #00ff88)', marginBottom: 2 }}>YOUR SCANNER IS WORKING</div>
                <b>{ACTION_LABELS[s.action] || 'Working'}</b>
                {s.progress && <Progress p={s.progress} action={s.action} />}
                <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5, marginTop: 2 }}>
                  Stopping closes the browser cleanly and keeps everything found so far.
                </div>
              </div>
              <Btn onClick={stop} tone="bad">Stop</Btn>
            </div>
          )}

          {/* Everything you might want to change, out of the way until you do */}
          <details style={{ margin: '18px 0 4px', borderRadius: 10, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.02)' }}>
            <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 13.5, fontWeight: 650, color: 'var(--sd-fg-2, #cfd8d8)' }}>
              Fine-tune the scanner
              <span style={{ fontWeight: 500, color: 'var(--sd-fg-4, #778)', marginLeft: 8 }}>daily budget, how much of each list, the hidden window, paused lists</span>
            </summary>
            <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <BudgetBox li={li} disabled={busy} onSetLimits={(l) => run('set-limits', l)} />
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, color: 'var(--sd-fg-2, #cfd8d8)' }}>
                Read up to
                <select value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={running} style={selectStyle}>
                  <option value={100}>every page, to the end of their list</option>
                  <option value={50}>50 pages each</option>
                  <option value={25}>25 pages each</option>
                  <option value={10}>10 pages (~100 people) each</option>
                </select>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--sd-fg-2, #cfd8d8)', cursor: running ? 'not-allowed' : 'pointer' }}>
                <input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} disabled={running} />
                Also finish people already mapped, from the page each one stopped at
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', cursor: running ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={experimental} disabled={running} style={{ marginTop: 3 }}
                  onChange={(e) => { setExperimental(e.target.checked); window.dispatchEvent(new Event('six-degrees:experimental')); }} />
                <span>
                  <b style={{ color: 'var(--sd-gold, #FFD700)' }}>Experimental:</b> all-day pacing. Up to 8 pages in a sitting,
                  then an hour&rsquo;s rest; searches only from 9:00 to 18:00; never more than 40 searches in a day
                  or 200 in a week, however high your budget; two days&rsquo; rest after any check from LinkedIn; at
                  the budget it waits instead of stopping; and it saves every page. It also reads LinkedIn&rsquo;s own data beside
                  the page text, to fill gaps and measure how the two compare. It keeps running while the app is open.
                </span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', cursor: running ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={hideChrome} disabled={running} style={{ marginTop: 3 }}
                  onChange={(e) => setHideChrome(e.target.checked)} />
                <span>
                  <b style={{ color: 'var(--sd-gold, #FFD700)' }}>Hide the Chrome window while scanning.</b> Every scan runs with no
                  window popping up; the status bar still shows what it&rsquo;s doing, and Stop still works. Signing
                  in always opens the window.
                  <span style={{ display: 'block', marginTop: 4, color: '#e0a080' }}>
                    The risks: a hidden Chrome is easier for LinkedIn to tell apart from a person, so it may make a
                    warning or restriction more likely. If LinkedIn asks you to check it&rsquo;s you (a code, a
                    puzzle, signing in again) you won&rsquo;t see it, and the scan will stop instead of waiting for
                    you. Untick this and scan again to see what LinkedIn wants. It changes nothing about pacing or
                    your daily budget.
                  </span>
                </span>
              </label>
              <div style={{ fontSize: 12, color: 'var(--sd-gold, #FFD700)', lineHeight: 1.6 }}>
                Every page is a LinkedIn search, so at {paceOf(li?.limits?.pace).label} it rests{' '}
                {paceOf(li?.limits?.pace).pagePause} seconds before each one and{' '}
                {paceOf(li?.limits?.pace).chunkCooldown / 60 === 1 ? 'a minute' : `${paceOf(li?.limits?.pace).chunkCooldown / 60} minutes`} after every 10, and a long list can take
                {' '}about {circleScanCost(pages, li?.limits?.pace).minutes} minutes a person.
                LinkedIn shows 100 pages of anyone&rsquo;s connections at most. Free accounts
                have a monthly search limit: if LinkedIn says it has been reached, the scan saves
                what it read and stops, and carries on from that page next time. Keep batches small.
              </div>
              <div>
                <Btn onClick={() => run('auto-bridge-retry', { maxBridges: batch, tiers: order === 'score' ? tiers : [], order, maxPages: pages, deeper: finish })} disabled={!canSearch || (order === 'score' && !tiers.length)}>
                  Retry hidden ones
                </Btn>
                <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', marginLeft: 10 }}>People whose list was hidden last time, in case they&rsquo;ve opened it.</span>
              </div>
              <PausedList
                paused={s?.paused || []}
                disabled={!canSearch}
                onResume={(p) => run('resume', { id: p.id })}
                onResumeAll={() => run('resume-all', { maxBridges: batch })}
              />
            </div>
          </details>

          {error && <Box tone="bad">{error}</Box>}

          {/* The scanner's own words, for when you want them: open by itself when a run stopped badly. */}
          {(s?.log?.length > 0) && (
            <details open={failed} style={{ marginTop: 20 }}>
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
        </>}

        <div style={{ marginTop: 32, paddingTop: 20, borderTop: LINE, fontSize: 13.5, color: 'var(--sd-fg-3, #8b9a9a)' }}>
          Checking for updates has moved to{' '}
          <Link href="/settings#updates" style={{ color: 'var(--sd-blue, #3498DB)' }}>Settings →</Link>
        </div>

        <p style={{ color: 'var(--sd-fg-4, #667)', fontSize: 12.5, lineHeight: 1.7, marginTop: 32 }}>
          Automating LinkedIn may go against its User Agreement, and accounts have been
          restricted for it. This runs locally against your own account, at your own risk.
          LinkedIn’s own CSV export is the supported route and needs none of this —{' '}
          <Link href="/import" style={{ color: 'var(--sd-blue, #3498DB)' }}>import a CSV instead</Link>.
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }
        @keyframes slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }`}</style>
    </div>
  );
}

// One person's circle, picked elsewhere and scanned only once it's confirmed
// here, beside what it costs and what the budget has left (backlog 2.4). Their
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
              from where a read stopped, use Resume on their card or in the Paused list below.
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

const code = { background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', padding: '1px 5px', borderRadius: 4 };
const selectStyle = {
  padding: '9px 10px', borderRadius: 7, fontSize: 13.5, fontWeight: 600,
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)', border: LINE,
};

const JOURNEY_CSS = `
@keyframes stepPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,255,136,.45); } 50% { box-shadow: 0 0 0 7px rgba(0,255,136,0); } }
.journey-now { animation: stepPulse 2.2s ease-in-out infinite; }
.launch-go { transition: transform .15s ease, box-shadow .2s ease, filter .2s ease; }
.launch-go:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 8px 30px rgba(0,255,136,.35); filter: brightness(1.08); }
.launch-go:not(:disabled):active { transform: translateY(0) scale(.98); }
@media (prefers-reduced-motion: reduce) { .journey-now { animation: none; } }
`;

/**
 * One step down the line: its dot (a tick once done, pulsing while it's the one
 * you're on), the line on to the next step (green once this one is done), its
 * label, and what it does.
 */
function StepRow({ n, label, state, last = false, children }) {
  const done = state === 'done';
  const now = state === 'now';
  return (
    <div role="listitem" aria-label={`Step ${n}, ${label}: ${done ? 'done' : now ? 'the one to do now' : 'still to come'}`}
      style={{ display: 'grid', gridTemplateColumns: '40px 1fr', columnGap: 14 }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <span className={now ? 'journey-now' : undefined} aria-hidden="true" style={{
          position: 'relative', zIndex: 1, width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
          fontSize: 15, fontWeight: 800,
          background: done ? 'rgba(0,255,136,0.16)' : now ? 'linear-gradient(135deg, #00ff88, #1abc9c)' : 'var(--sd-card, #12142a)',
          color: done ? 'var(--sd-green, #00ff88)' : now ? '#04140c' : 'var(--sd-fg-4, #778)',
          border: `2px solid ${done ? 'rgba(0,255,136,0.55)' : now ? 'transparent' : 'rgba(var(--sd-ink, 255, 255, 255), 0.14)'}`,
        }}>{done ? '✓' : n}</span>
        {!last && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: 40, bottom: 0, left: '50%', width: 2, marginLeft: -1, borderRadius: 1,
            background: done ? 'linear-gradient(rgba(0,255,136,0.75), rgba(0,255,136,0.3))' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)',
          }} />
        )}
      </div>
      <div style={{ minWidth: 0, paddingBottom: last ? 0 : 16, opacity: state === 'next' ? 0.75 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 38, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: done ? 'var(--sd-green, #00ff88)' : now ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-3, #889)' }}>
            Step {n} · {label}
          </span>
          <span style={{
            fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
            color: done ? 'var(--sd-green, #00ff88)' : now ? '#04140c' : 'var(--sd-fg-3, #889)',
            background: done ? 'rgba(0,255,136,0.12)' : now ? '#00ff88' : 'rgba(var(--sd-ink, 255, 255, 255), 0.06)',
          }}>{done ? 'Done' : now ? 'Now' : 'Next'}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A step's card: what it does, how long, and the one button that does it. Once done, a quieter card. */
function Mission({ title, time, body, launch, more, done = false, children }) {
  return (
    <div style={{
      padding: done ? '14px 18px' : '18px 20px', borderRadius: 14,
      background: done ? 'rgba(0,255,136,0.03)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.035)',
      border: `1px solid ${done ? 'rgba(0,255,136,0.18)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: done ? 16 : 19, fontWeight: 800 }}>{title}</span>
        {time && !done && <span style={{ fontSize: 12, color: '#8fd9b6', marginLeft: 'auto' }}>⏱ {time}</span>}
      </div>
      <div style={{ fontSize: done ? 13 : 14, color: 'var(--sd-fg-3, #9fb0bb)', lineHeight: 1.6, margin: done ? '6px 0 10px' : '8px 0 14px', maxWidth: 600 }}>{body}</div>
      {children}
      {(launch || more) && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{launch}{more}</div>}
    </div>
  );
}

/** The big go button. `quiet` once that step is done, so the next thing to do stands out. */
function Launch({ children, onClick, disabled, quiet = false }) {
  return (
    <button type="button" className="launch-go" onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 10, padding: quiet ? '10px 18px' : '13px 26px', borderRadius: 12,
      fontSize: quiet ? 14 : 16, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? 'var(--sd-fg-4, #667)' : quiet ? 'var(--sd-fg-1, #cfe8dc)' : '#04140c', border: quiet ? '1px solid rgba(0,255,136,0.35)' : 'none',
      background: disabled ? 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' : quiet ? 'rgba(0,255,136,0.08)' : 'linear-gradient(135deg, #00ff88, #1abc9c)',
      boxShadow: disabled || quiet ? 'none' : '0 4px 22px rgba(0,255,136,0.25)',
    }}>
      <span aria-hidden="true" style={{ fontSize: quiet ? 11 : 13 }}>▶</span>{children}
    </button>
  );
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

function Btn({ children, onClick, disabled, primary, tone }) {
  const bg = tone === 'bad' ? 'rgba(255,80,80,0.15)'
    : primary ? 'linear-gradient(135deg, #9B59B6, #3498DB)'
    : 'rgba(var(--sd-ink, 255, 255, 255), 0.08)';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 650,
      color: disabled ? 'var(--sd-fg-4, #667)' : 'var(--sd-fg-1, #fff)', background: disabled ? 'rgba(var(--sd-ink, 255, 255, 255), 0.05)' : bg,
      border: LINE, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
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
          Saving to your network and fetching photos — this can take a minute or two.
        </div>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
  let text;
  if (p.kind === 'download') text = `Downloading Python: ${p.done.toFixed(1)} of ${p.total.toFixed(1)} MB · ${pct}%`;
  else if (p.kind === 'batch') text = `Person ${p.current} of ${p.total}`;
  else if (action === 'refresh') text = `Looked at ${p.done.toLocaleString()} so far — stops once it reaches people already saved`;
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
