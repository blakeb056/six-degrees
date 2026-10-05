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

import { useCallback, useEffect, useRef, useState } from 'react';
import useScanStatus from '../useScanStatus';
import { STEPS, STEP_LABELS, onboardingStep, readSetupMemory, rememberSetup, firstScan, canOpen, here as hereWord } from '../../../lib/onboarding';
import { askForField } from '../../../lib/scanner-setup';
import { loadSampleIntoSession } from '../../../lib/demo';
import { ONBOARDING_CSS } from './styles';
import { Welcome, GetReady, Connect, Pace, MapPeople, Final } from './steps';

const SCREENS = { welcome: Welcome, ready: GetReady, connect: Connect, pace: Pace, map: MapPeople };
const OUT_MS = 190;

export default function Onboarding({ onFinish }) {
  const scan = useScanStatus();
  const { s, settings } = scan;
  // What this browser remembers (lib/onboarding.js SETUP_KEY). Only ever shown
  // after the page has loaded the network, in the browser, so it's read at once.
  const [memory, setMemory] = useState(() => readSetupMemory());
  const derived = onboardingStep(s, memory);
  // The step on screen: the first not done, once the scanner has answered;
  // then wherever Continue and Back take you.
  const [view, setView] = useState(null);
  if (view === null && derived) setView(derived);
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
    go,
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
  // question, if it's asked, is answered.
  const scanDone = firstScan(s).state === 'done';
  const fieldOpen = askForField(s, settings, { duringFirstScan: true }) === true;
  const final = view === 'map' && scanDone && !fieldOpen;
  const Screen = view && SCREENS[view];
  const at = view || 'welcome';

  return (
    <div className="ob" data-onboarding={final ? 'ready' : view || 'loading'}>
      <style>{ONBOARDING_CSS}</style>
      <header className="ob-top">
        <div className="ob-mark">Six Degrees</div>
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

      {final ? <Final ctx={ctx} onFinish={onFinish} />
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
