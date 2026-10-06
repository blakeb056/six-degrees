'use client';

// The guided setup a new install opens on, the whole window (Blake,
// 2026-10-04: "how [Wispr] Flow is with its onboarding … i want the same thing
// for the app management setting and also to sign into linkedin"; of the two
// mock-ups, "i like a's approach"). One step a screen, dots for where you are,
// a big title and a sentence or two, one primary button, a live status that
// turns green, and Back. app/page.js shows it while there is no network yet,
// and keeps it up through the end of the first scan, until Open the map.
//
// Which step you start on is the first not done (lib/onboarding.js), so
// someone who left halfway comes back to it. After that, only Continue and
// Back move you: a status that turns green says so, and waits for you.
//
// The step is also kept with your settings (lib/onboarding.js setupStep):
// turning App Management on makes macOS quit and reopen Sixgree, and the setup
// comes back on the step it was on, with the permission asked again.

import { useCallback, useEffect, useRef, useState } from 'react';
import useScanStatus from '../useScanStatus';
import {
  STEPS, STEP_LABELS, onboardingStep, readSetupMemory, rememberSetup, firstScan, followedScan, canOpen, here as hereWord,
  appManagementGate, withSavedStep, startStep,
} from '../../../lib/onboarding';
import { askForField } from '../../../lib/scanner-setup';
import { saveSettings } from '../../../lib/settings-client';
import { loadSampleIntoSession } from '../../../lib/demo';
import { ONBOARDING_CSS } from './styles';
import Wordmark from '../Wordmark';
import { Welcome, GetReady, Connect, Pace, MapPeople, Final } from './steps';

const SCREENS = { welcome: Welcome, ready: GetReady, connect: Connect, pace: Pace, map: MapPeople };
const OUT_MS = 190;
// How often the Get ready step asks macOS about App Management while it's open.
const APP_POLL_MS = 2000;
const NO_ANSWER = 'Sixgree’s own server didn’t answer the check.';

/**
 * Is App Management on? GET /api/scraper?appManagement (lib/app-management.js),
 * every 2 s while `on`, and at once when the window comes back (from System
 * Settings, say). undefined before the first answer. A check that can't run
 * says so ({ granted: null, why }), and that is logged here once.
 */
function useAppManagement(on) {
  const [access, setAccess] = useState(undefined);
  useEffect(() => {
    if (!on) return undefined;
    let off = false;
    let timer = null;
    let asking = false;
    let warned = null;
    const ask = async () => {
      if (asking) return;
      asking = true;
      clearTimeout(timer);
      let next = null;
      try {
        const r = await fetch('/api/scraper?appManagement', { cache: 'no-store' });
        const d = r.ok ? await r.json() : null;
        next = d && typeof d === 'object' && 'granted' in d ? d : { needed: true, granted: null, why: NO_ANSWER };
      } catch {
        next = null; // not reached this once: the last answer stands, or "can't tell" if there is none
      }
      asking = false;
      if (off) return;
      setAccess((prev) => {
        const value = next || prev || { needed: true, granted: null, why: NO_ANSWER };
        if (value.needed !== false && value.granted === null && warned !== value.why) {
          warned = value.why;
          console.warn(`App Management: can't tell whether it's on, so the setup takes the user's word for it. ${value.why}`);
        }
        return prev && prev.needed === value.needed && prev.granted === value.granted && prev.why === value.why ? prev : value;
      });
      timer = setTimeout(ask, APP_POLL_MS);
    };
    ask();
    const wake = () => { if (document.visibilityState !== 'hidden') ask(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      off = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [on]);
  return access;
}

// `again`: back after a first scan that ended before Open the map (lib/onboarding.js
// opensSetup): straight to "Your galaxy is ready", the field question or not.
export default function Onboarding({ onFinish, again = false }) {
  const scan = useScanStatus();
  const { s, settings } = scan;
  // What this browser remembers (lib/onboarding.js SETUP_KEY). Only ever shown
  // after the page has loaded the network, in the browser, so it's read at once.
  const [memory, setMemory] = useState(() => readSetupMemory());
  // The step kept with your settings: what a restart has to go on, since this
  // browser's memory may have gone with the old address.
  const saved = settings?.setupStep ?? null;
  const [view, setView] = useState(null);
  // App Management, on a Mac from macOS 13: asked of macOS while Get ready is
  // open (or the step isn't known yet), and Continue waits for it.
  const mac = s?.checks?.mac;
  const appNeeded = Boolean(mac) && !(mac.version != null && mac.version < 13);
  const access = useAppManagement(appNeeded && (view === null || view === 'ready'));
  const claimed = scan.appAnswer ? scan.appAnswer === 'done' : settings?.appManagement === 'done';
  const gate = appManagementGate(s, access, { claimed });
  const derived = onboardingStep(s, withSavedStep(memory, saved), gate);
  // The step on screen: the kept one if the checks still allow it, else the
  // first not done, once the scanner, your settings and macOS have answered;
  // then wherever Continue and Back take you.
  if (view === null && derived && settings !== undefined && gate.state !== 'checking') setView(startStep(derived, saved));

  // Every step change is kept, so a restart opens on it.
  const kept = useRef(undefined);
  useEffect(() => {
    if (!view || !settings) return;
    if (kept.current === undefined) kept.current = saved;
    if (kept.current === view) return;
    kept.current = view;
    saveSettings({ setupStep: view });
  }, [view, settings, saved]);
  // The first scan this setup has watched (lib/onboarding.js followedScan), so
  // a scan that starts after it can't keep "Your galaxy is ready" back.
  const [follow, setFollow] = useState(null);
  const following = followedScan(follow, s);
  if (following !== follow) setFollow(following);
  const [phase, setPhase] = useState('in');
  const [dir, setDir] = useState(1);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = useCallback((next) => {
    if (!next || next === view) return;
    scan.setError(null);
    setDir(STEPS.indexOf(next) > STEPS.indexOf(view) ? 1 : -1);
    setPhase('out');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setView(next); setPhase('in'); window.scrollTo(0, 0); }, OUT_MS);
  }, [view, scan]);

  const ctx = {
    s,
    settings,
    scan,
    here: hereWord(s),
    follow: following,
    go,
    access,
    gate,
    // Before System Settings: keep this step, since turning App Management on
    // makes macOS quit and reopen Sixgree.
    keepStep: () => { kept.current = 'ready'; return saveSettings({ setupStep: 'ready' }); },
    // Welcome → Scan my LinkedIn.
    start: () => { setMemory(rememberSetup({ started: true })); go('ready'); },
    // Set your pace → Continue: it has no check of its own, so this browser remembers it.
    paced: () => { setMemory(rememberSetup({ paced: true })); go('map'); },
    // Try the sample, from the welcome screen or the way out at the top
    // (the welcome screen did this before the setup). Resolves to
    // why it didn't open, or never, since the page reloads into it.
    openSample: async () => {
      try {
        await loadSampleIntoSession();
        window.location.reload();
        return null;
      } catch (err) {
        return err.message || 'Could not load the sample network.';
      }
    },
  };

  // Your galaxy is ready: the first scan has saved people, and the field
  // question, if it's asked, is answered. `s` already has the job answer the
  // notch reads in it, and is asked again the moment a job ends or the window
  // comes back (useScanStatus), so this follows the end within a second or two.
  const scanDone = firstScan(s, following).state === 'done';
  const fieldOpen = askForField(s, settings, { duringFirstScan: true }) === true;
  const final = scanDone && (again || (view === 'map' && !fieldOpen));
  const Screen = view && SCREENS[view];
  const at = view || 'welcome';

  return (
    <div className="ob" data-onboarding={final ? 'ready' : view || 'loading'}>
      <style>{ONBOARDING_CSS}</style>
      <header className="ob-top">
        <div className="ob-mark"><Wordmark size={20} /></div>
        {!final && (
          <nav className="ob-dots" aria-label="Setup steps">
            {STEPS.map((step) => {
              const i = STEPS.indexOf(step);
              const now = step === at;
              const done = i < STEPS.indexOf(at);
              return (
                <button key={step} type="button" className={now ? 'now' : done ? 'done' : ''} aria-current={now ? 'step' : undefined}
                  aria-label={`Step ${i + 1}, ${STEP_LABELS[step]}${done ? ', done' : ''}`} title={STEP_LABELS[step]}
                  disabled={!view || now || !canOpen(step, at)} onClick={() => go(step)} />
              );
            })}
          </nav>
        )}
        {final || at === 'welcome' ? <span /> : <WayOut openSample={ctx.openSample} />}
      </header>

      {final ? <Final ctx={ctx} onFinish={async () => { kept.current = null; await saveSettings({ setupStep: null }); return onFinish(); }} />
        : Screen ? (
          <section key={view} className={`ob-card ob-step-${phase}`} style={{ '--dir': dir }} data-glass-panel aria-label={`Setup: ${STEP_LABELS[view]}`}>
            <Screen ctx={ctx} />
          </section>
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ob-fg3)', fontSize: 14 }}>Checking your setup…</div>
        )}
    </div>
  );
}

/** Rather not scan: the CSV and the sample, from any step. */
function WayOut({ openSample }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="ob-out">
      <span className="long">Rather not scan? </span>
      <a href="/import">Import a CSV</a>{' or '}
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); if (await openSample()) setBusy(false); }}>
        {busy ? 'opening the sample…' : 'try the sample'}
      </button>
    </div>
  );
}
