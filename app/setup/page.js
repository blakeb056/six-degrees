'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import OnboardingGate from '../components/OnboardingGate';
import Link from 'next/link';
import { stopScrape, pickedPerson } from '../../lib/scraper-client';
import { setupStep, askForField } from '../../lib/scanner-setup';
import { IS_DEMO } from '../../lib/demo';
import { circleScanCost } from '../../lib/reach';
import { BudgetBox, CooldownBanner, PausedList } from '../components/LinkedInLimits';
import FieldStep, { FieldAnswer } from '../components/FieldStep';

// Everything here runs through /api/scraper. There is deliberately no second
// server and no command to copy: the step where people gave up was starting a
// Python server in a terminal they had not been told they needed.

const BG = '#0a0a1a';
const LINE = '1px solid rgba(255,255,255,0.1)';

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
  const [hideChrome, setHideChrome] = useRemembered('six-degrees-hide-chrome', false);
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
        body: JSON.stringify({ action, ...extra }),
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
      minHeight: '100vh', background: BG, color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <header style={{ padding: '16px 24px', borderBottom: LINE, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/" style={{
          display: 'flex', alignItems: 'center', gap: 6, color: '#888', textDecoration: 'none',
          fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)', border: LINE,
        }}>← Back to Map</Link>
        <h1 style={{
          fontSize: 22, fontWeight: 700, margin: 0,
          background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Scan your network</h1>
      </header>
      {/* The scan status bar sits here, under the header's buttons (ScanStatusBar.js). */}
      <div id="scan-bar-slot" />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>

        <p style={{ color: '#9aa', fontSize: 15, lineHeight: 1.6, marginTop: 0 }}>
          This reads your own LinkedIn connections in a real Chrome window on this
          machine and saves them here. Nothing leaves your computer, and you will never
          be asked for your password — you sign in yourself, once.
          {!mapped && (askField
            ? ' One optional question, then three steps and your galaxy appears.'
            : ' Three steps and your galaxy appears; each one ticks itself off.')}
        </p>

        {/* The first look at the scanner can take a while (it looks for Python): say so, never a blank page. */}
        {askField === null && <p style={{ color: '#778', fontSize: 13 }}>Checking your setup…</p>}
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
                  <span style={{ color: '#9aa' }}>Your galaxy is ready.</span>
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
                  <span style={{ color: '#9aa' }}>
                    An older version kept them as links to LinkedIn. The app doesn’t load
                    photos from LinkedIn while you browse, so those people show initials until
                    the photos are saved here: now, or at the end of your next scan. An expired
                    link can’t be saved; that person’s photo comes back when they’re next scanned.
                  </span>
                  {s && !c.dependencies && (
                    <div style={{ color: '#8b9a9a', fontSize: 12.5, marginTop: 6 }}>Set up the scanner first (step 1 below): it saves them.</div>
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
                  marginTop: 6, color: '#e8c4c4', whiteSpace: 'pre-wrap',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5,
                }}>{failReason}</div>
              )}
              <div style={{ color: '#9aa', marginTop: 6 }}>The full log is below.</div>
            </Box>
          )}

          {notFound && (
            <Box tone="bad">
              <b>Can’t find the scanner files.</b><br />
              <span style={{ color: '#9aa' }}>
                Expected <code style={code}>scripts/scrape.py</code> next to the app. If you
                downloaded a zip, run the app from inside the project folder.
              </span>
            </Box>
          )}

          {needsChrome && (
            <Box tone="bad">
              <b>Google Chrome isn’t installed.</b><br />
              <span style={{ color: '#9aa' }}>
                The scanner drives your real Chrome. Install it from{' '}
                <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer"
                   style={{ color: '#3498DB' }}>google.com/chrome</a>, then reload this page.
              </span>
            </Box>
          )}

          {/* The Python inside the app didn't work: what happened, and what to do instead.
              Red only while there is something to do; once another Python runs the
              scanner it is just news. */}
          {s && step1.note && (
            <Box tone={step1.done ? undefined : 'bad'}>{step1.note}</Box>
          )}

          {/* ---- step 1 : the scanner itself ---- */}
          <Step
            n={1}
            done={step1.done}
            title="Set up the scanner"
            body={s ? step1.text : ''}
            action={
              s && step1.button && (
                <Btn onClick={() => run(step1.button.action)} disabled={busy || running}>
                  {step1.button.label}
                </Btn>
              )
            }
          />

          {/* ---- step 2 : sign in ---- */}
          <Step
            n={2}
            done={!!c.signedIn}
            title="Sign into LinkedIn"
            body={
              c.signedIn
                ? 'Signed in on this machine. If LinkedIn ever asks for a security check, or a scan says you were signed out, open LinkedIn here and finish it by hand.'
                : 'Opens a Chrome window. Sign in with your email and password — “Continue with Google” cannot work here, because Google blocks its sign-in inside automated browsers.'
            }
            action={
              // Shown after sign-in too: a security check survives the session
              // cookie, so "signed in" can still need a person (TRAPS §35).
              c.dependencies && (
                <Btn onClick={() => run('login')} disabled={busy || running}>
                  {running && s.action === 'login' ? 'Waiting for you…' : 'Open LinkedIn'}
                </Btn>
              )
            }
          />

          {/* ---- step 3 : the people you know ---- */}
          <Step
            n={3}
            done={mapped > 0}
            title="1st degree — the people you know"
            body="The first scan walks your whole connections list, about a minute and a half for 750 people. After that, Check for new only looks at what has been added since."
            action={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Btn onClick={() => run('full')} disabled={!canSearch} primary>
                  {running && s.action === 'full' ? 'Scanning…' : 'Scan my whole network'}
                </Btn>
                <Btn onClick={() => run('refresh')} disabled={!canSearch}>
                  {running && s.action === 'refresh' ? 'Checking…' : 'Check for new'}
                </Btn>
              </div>
            }
          />

          {/* ---- step 4 : who they know ---- */}
          <Step
            n={4}
            done={false}
            title="2nd degree — the people they know"
            body={
              <>
                This is what fills <b>Degrees</b> and <b>Outlink</b>: it opens each of your
                connections in turn and reads who <i>they</i> know. Most people hide their
                connections — those are noted and never tried again.
                <br /><br />
                It is slow on purpose, about two minutes between each person, because
                this is the part LinkedIn notices. During development a real account was
                temporarily restricted after roughly <b>19 people in one sitting</b>.
                Run a batch, leave it for a day, run another — and stop the moment
                LinkedIn mentions unusual activity. It always picks up where it left
                off: anyone still without a mapped circle, in the order you choose below —
                your newest connections first, or highest tier first. Each person&rsquo;s
                list is read to the end, saving every 10 pages, and a read that is stopped
                carries on from the same page next time.
              </>
            }
            action={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <CooldownBanner
                  cooldown={li?.cooldown}
                  disabled={busy}
                  onLift={() => run('lift-cooldown')}
                />
                <BudgetBox li={li} disabled={busy} onSetLimits={(l) => run('set-limits', l)} />
                {order === 'score' && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#8b9a9a' }}>Work through</span>
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
                          background: on ? 'rgba(52,152,219,0.22)' : 'rgba(255,255,255,0.05)',
                          color: on ? '#cfe6f7' : '#667',
                        }}
                      >{t}</button>
                    );
                  })}
                  <span style={{ fontSize: 11.5, color: '#667' }}>
                    {tiers.length ? '' : 'pick at least one'}
                  </span>
                </div>}
                {order === 'newest' && (
                  <div style={{ fontSize: 12, color: '#8b9a9a', lineHeight: 1.6 }}>
                    Goes by the date you connected, newest first, across every tier. Run
                    {' '}<b>Check for new</b> first so your latest connections are in the list.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#8b9a9a' }}>Start with</span>
                  <select value={order} onChange={(e) => setOrder(e.target.value)} disabled={running} style={selectStyle}>
                    <option value="newest">Newest connections first</option>
                    <option value="score">Highest tier first</option>
                  </select>
                  <span style={{ fontSize: 12, color: '#8b9a9a' }}>Read up to</span>
                  <select value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={running} style={selectStyle}>
                    <option value={100}>every page, to the end of their list</option>
                    <option value={50}>50 pages each</option>
                    <option value={25}>25 pages each</option>
                    <option value={10}>10 pages (~100 people) each</option>
                  </select>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: '#cfd8d8', cursor: running ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} disabled={running} />
                  Also finish people already mapped, from the page each one stopped at
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#b8c4c4', cursor: running ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={experimental} disabled={running} style={{ marginTop: 3 }}
                    onChange={(e) => { setExperimental(e.target.checked); window.dispatchEvent(new Event('six-degrees:experimental')); }} />
                  <span>
                    <b style={{ color: '#FFD700' }}>Experimental:</b> all-day pacing. Up to 10 pages in a sitting,
                    then a 45-minute rest; searches only from 9:00 to 19:00; at the daily budget it waits for it to
                    free up instead of stopping; and it saves every page. It also reads LinkedIn&rsquo;s own data beside
                    the page text, to fill gaps and measure how the two compare. It keeps running while the app is open.
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#b8c4c4', cursor: running ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={hideChrome} disabled={running} style={{ marginTop: 3 }}
                    onChange={(e) => setHideChrome(e.target.checked)} />
                  <span>
                    <b style={{ color: '#FFD700' }}>Hide the Chrome window while scanning.</b> Every scan runs with no
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
                <div style={{ fontSize: 12, color: '#FFD700', lineHeight: 1.6 }}>
                  Every page is a LinkedIn search, so it rests 20 seconds before each one and a
                  minute after every 10, and a long list can take
                  {' '}about {circleScanCost(pages).minutes} minutes a person.
                  LinkedIn shows 100 pages of anyone&rsquo;s connections at most. Free accounts
                  have a monthly search limit: if LinkedIn says it has been reached, the scan saves
                  what it read and stops, and carries on from that page next time. Keep batches small.
                </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <Btn onClick={() => run('auto-bridge', { maxBridges: batch, tiers: order === 'score' ? tiers : [], order, maxPages: pages, deeper: finish, experimental })} disabled={!canSearch || (order === 'score' && !tiers.length)} primary>
                  {running && s.action === 'auto-bridge' ? 'Mapping…' : 'Map 2nd degree'}
                </Btn>
                <select
                  value={batch}
                  onChange={(e) => setBatch(Number(e.target.value))}
                  disabled={running}
                  style={selectStyle}
                >
                  <option value={5}>5 people</option>
                  <option value={10}>10 people</option>
                  <option value={25}>25 people</option>
                  <option value={0}>everyone — not advised</option>
                </select>
                <Btn onClick={() => run('auto-bridge-retry', { maxBridges: batch, tiers: order === 'score' ? tiers : [], order, maxPages: pages, deeper: finish })} disabled={!canSearch || (order === 'score' && !tiers.length)}>
                  Retry hidden ones
                </Btn>
              </div>
              <PausedList
                paused={s?.paused || []}
                disabled={!canSearch}
                onResume={(p) => run('resume', { id: p.id })}
                onResumeAll={() => run('resume-all', { maxBridges: batch })}
              />
              </div>
            }
          />

          {/* ---- stop: one control, always where the log is ---- */}
          {running && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 20,
              padding: '14px 16px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: LINE,
            }}>
              <Spinner />
              <div style={{ flex: 1, fontSize: 13.5 }}>
                <b>{ACTION_LABELS[s.action] || 'Working'}</b>
                {s.progress && <Progress p={s.progress} action={s.action} />}
                <div style={{ color: '#8b9a9a', fontSize: 12.5, marginTop: 2 }}>
                  Stopping closes the browser cleanly and keeps everything found so far.
                </div>
              </div>
              <Btn onClick={stop} tone="bad">Stop</Btn>
            </div>
          )}

          {error && <Box tone="bad">{error}</Box>}

          {(s?.log?.length > 0) && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                margin: '28px 0 8px', fontSize: 12, color: '#788',
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>
                {running && <Spinner />}
                {running ? 'Working' : 'Last run'}
              </div>
              <pre ref={logRef} style={{
                background: 'rgba(0,0,0,0.45)', border: LINE, borderRadius: 8,
                padding: 14, maxHeight: 280, overflow: 'auto', margin: 0,
                fontSize: 12.5, lineHeight: 1.7, color: '#b9c6c6',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{s.log.join('\n')}</pre>
            </>
          )}
        </>}

        <div style={{ marginTop: 32, paddingTop: 20, borderTop: LINE, fontSize: 13.5, color: '#8b9a9a' }}>
          Checking for updates has moved to{' '}
          <Link href="/settings#updates" style={{ color: '#3498DB' }}>Settings →</Link>
        </div>

        <p style={{ color: '#667', fontSize: 12.5, lineHeight: 1.7, marginTop: 32 }}>
          Automating LinkedIn may go against its User Agreement, and accounts have been
          restricted for it. This runs locally against your own account, at your own risk.
          LinkedIn’s own CSV export is the supported route and needs none of this —{' '}
          <Link href="/import" style={{ color: '#3498DB' }}>import a CSV instead</Link>.
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
  const cost = circleScanCost(pages);
  const theirs = running && s?.target?.id === person.id;
  const short = li?.leftToday != null && li.leftToday < cost.searches;
  return (
    <div style={{
      margin: '16px 0', padding: '16px 18px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.6,
      background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.3)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#00ff88', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
        Scan one circle
      </div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>
        {person.name} <span style={{ fontSize: 12, color: TIER[person.tier] || '#888' }}>{person.tier}-tier</span>
      </div>
      {person.unlocked_from_name && (
        <div style={{ fontSize: 12.5, color: '#9aa' }}>Was in {person.unlocked_from_name}&rsquo;s circle</div>
      )}
      {theirs ? (
        <div style={{ marginTop: 10 }}>
          <b>Scanning {first}&rsquo;s circle.</b> It saves every 10 pages, and{' '}
          <Link href={`/?chain=${encodeURIComponent(person.id)}`} style={{ color: '#00ff88' }}>Bridge Chains shows it filling in →</Link>
        </div>
      ) : (
        <>
          <div style={{ color: '#b8c4c4', marginTop: 10 }}>
            It costs <b>{cost.profileViews} profile view</b> to find their list, then <b>one LinkedIn search for
            every page</b> of it: up to {cost.searches} {cost.searches === 1 ? 'page' : 'pages'}, about {cost.minutes} minutes.
            {li?.leftToday != null && <> <b>{li.leftToday}</b> of your {li.limits?.daily} searches a day are left{short ? '; the scan stops when they run out, and can carry on from that page later' : ''}.</>}
          </div>
          {circle === 'scanned' && (
            <div style={{ color: '#FFD700', fontSize: 12.5, marginTop: 6 }}>
              Their circle is already scanned. This reads their whole list again from page 1; to carry on
              from where a read stopped, use Resume on their card or in the Paused list below.
            </div>
          )}
          {circle === 'hidden' && (
            <div style={{ color: '#FFD700', fontSize: 12.5, marginTop: 6 }}>
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
            <div style={{ fontSize: 12.5, color: '#8b9a9a', marginTop: 8 }}>
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

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };

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

const code = { background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 };
const selectStyle = {
  padding: '9px 10px', borderRadius: 7, fontSize: 13.5, fontWeight: 600,
  background: 'rgba(255,255,255,0.08)', color: '#fff', border: LINE,
};

function Step({ n, done, title, body, action }) {
  return (
    <div style={{
      display: 'flex', gap: 16, padding: '20px 0', borderBottom: LINE, alignItems: 'flex-start',
    }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
        display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
        background: done ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.08)',
        color: done ? '#00ff88' : '#889', border: `1px solid ${done ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.14)'}`,
      }}>{done ? '✓' : n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 650, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: '#8b9a9a', lineHeight: 1.6, marginBottom: action ? 12 : 0 }}>{body}</div>
        {action}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, primary, tone }) {
  const bg = tone === 'bad' ? 'rgba(255,80,80,0.15)'
    : primary ? 'linear-gradient(135deg, #9B59B6, #3498DB)'
    : 'rgba(255,255,255,0.08)';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 650,
      color: disabled ? '#667' : '#fff', background: disabled ? 'rgba(255,255,255,0.05)' : bg,
      border: LINE, cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );
}

function Box({ children, tone }) {
  return (
    <div style={{
      margin: '16px 0', padding: '14px 16px', borderRadius: 8, fontSize: 13.5, lineHeight: 1.6,
      background: tone === 'bad' ? 'rgba(255,80,80,0.08)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${tone === 'bad' ? 'rgba(255,80,80,0.3)' : 'rgba(255,255,255,0.12)'}`,
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
          height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', marginBottom: 6,
        }}>
          <div style={{
            width: '35%', height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #9B59B6, #3498DB)', animation: 'slide 1.2s ease-in-out infinite',
          }} />
        </div>
        <div style={{ fontSize: 12.5, color: '#cfe6f7' }}>
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
            background: 'rgba(255,255,255,0.08)', marginBottom: 6,
          }}
        >
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #9B59B6, #3498DB)',
            transition: 'width 0.6s ease',
          }} />
        </div>
      )}
      <div style={{ fontSize: 12.5, color: '#cfe6f7' }}>{text}</div>
    </div>
  );
}

function Spinner() {
  return <span style={{
    width: 11, height: 11, borderRadius: '50%', display: 'inline-block',
    border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#3498DB',
    animation: 'spin 0.8s linear infinite',
  }} />;
}
