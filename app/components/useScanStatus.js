'use client';

// What the Scan page and the guided setup (app/components/onboarding) both
// read and do, in one place: the scanner's status (GET /api/scraper, every
// 1.5 s), your saved settings, and the four things they press: start a job
// (run), change a scanner setting (the budget, a cooldown), say "I understand"
// to the scanning risks, and answer the App Management item. Pulled out of
// app/setup/page.js when the setup arrived, so the two never disagree about
// what a click does.
//
// The end of a job must show within a second or two however the window has
// been (Blake, 2026-10-05: the setup sat on "fetching photos" for minutes after
// the scan had ended, and only saw it once he went to another page). So:
//   - the status is brought up to date by the job answer the notch reads
//     (lib/scraper-client.js statusWithJob), and asked again the moment that
//     answer sees a job start or end;
//   - it's asked again the moment the window is shown or focused: a window in
//     the background has its timers held back by the browser, to once a
//     minute after a while, and only a page that had just opened looked at once;
//   - one ask at a time, each given up after a while, and the next one comes
//     1.5 s after the last came back, so a slow or stuck answer can't pile
//     up asks behind it or stop the asking;
//   - an answer that isn't the status (an error page while the app restarts)
//     is never taken for one, and the last status stays until a real one comes.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { stopScrape, beginScrape, statusWithJob } from '../../lib/scraper-client';
import { saveSettings } from '../../lib/settings-client';
import { IS_DEMO } from '../../lib/demo';
import useScanner from './useScanner';

const POLL_MS = 1500;
// An answer that hasn't come in this long isn't coming: ask again.
const GIVE_UP_MS = 10000;

/** A job starting or ending, as the job answer sees it: '' until it has answered. */
function jobMoment(job) {
  if (!job?.known) return '';
  return `${job.running ? 1 : 0}:${job.startedAt ?? ''}:${job.recent?.[0]?.startedAt ?? ''}`;
}

export default function useScanStatus() {
  // GET /api/scraper's answer: null until the first one.
  const [raw, setS] = useState(null);
  // The job answer every Scan button and the notch read (lib/scraper-client.js).
  const job = useScanner();
  const s = useMemo(() => statusWithJob(raw, job), [raw, job]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // What's saved: undefined while it loads, null when it couldn't be read.
  const [settings, setSettings] = useState(undefined);
  // The App Management item, answered here ('done' or 'skipped'), if it was.
  const [appAnswer, setAppAnswer] = useState(null);

  // One ask at a time. Asked for while one is out, another follows it: the one
  // out may have been sent before the change it was asked for.
  const asking = useRef(null);
  const askAgain = useRef(false);
  const poll = useCallback(function ask() {
    if (asking.current) {
      askAgain.current = true;
      return asking.current;
    }
    const ctrl = new AbortController();
    const giveUp = setTimeout(() => ctrl.abort(), GIVE_UP_MS);
    const promise = (async () => {
      try {
        const r = await fetch('/api/scraper', { signal: ctrl.signal, cache: 'no-store' });
        const d = r.ok ? await r.json() : null;
        if (!d || typeof d !== 'object' || !d.checks) throw new Error('not the status');
        setS(d);
      } catch {
        setS((prev) => prev || { ready: false, checks: {}, log: [] });
      } finally {
        clearTimeout(giveUp);
      }
    })().finally(() => {
      asking.current = null;
      if (askAgain.current) {
        askAgain.current = false;
        ask();
      }
    });
    asking.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    let off = false;
    let timer = null;
    const loop = async () => {
      await poll();
      if (!off) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    // Shown again, or focused: ask now, not when the held-back timer comes round.
    const wake = () => { if (document.visibilityState !== 'hidden') poll(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    return () => {
      off = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
    };
  }, [poll]);

  // The job answer saw a job start or end: the rest of the status (the people
  // saved, the photos still to come) is asked for now, not on the next round.
  const moment = jobMoment(job);
  const lastMoment = useRef('');
  useEffect(() => {
    const was = lastMoment.current;
    lastMoment.current = moment;
    if (was && moment && moment !== was) poll();
  }, [moment, poll]);

  useEffect(() => {
    if (IS_DEMO) return undefined;
    let off = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off) setSettings(d?.settings || null); })
      .catch(() => { if (!off) setSettings(null); });
    return () => { off = true; };
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    await stopScrape().catch((e) => setError(e.message));
    poll();
  }, [poll]);

  // Done or Skip on the App Management item: it goes at once, and the answer is
  // kept so it isn't offered again. If that can't be saved it still goes for
  // now and comes back next time, which is all it costs (as Skip for now does,
  // app/components/FieldStep.js).
  const answerAppManagement = useCallback(async (answer) => {
    setAppAnswer(answer);
    const d = await saveSettings({ appManagement: answer });
    if (d.settings) setSettings(d.settings);
  }, []);

  // "I understand": when, kept with your settings so it travels with a copy.
  const acceptRisk = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { scanRiskAccepted: new Date().toISOString() } }),
      });
      if (!r.ok) setError((await r.json().catch(() => null))?.error || 'Could not save that. Try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      poll();
    }
  }, [poll]);

  // The two settings the scanner keeps (the budget, lifting a cooldown) start nothing.
  const setting = useCallback(async (action, extra = {}) => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || 'Could not change that.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      poll();
    }
  }, [poll]);

  // Everything else starts a job, through beginScrape like every other Scan
  // button, so the header's Check for new, the notch and every card react at
  // once: posting straight to the scanner left them up to 5 seconds behind.
  // It adds "Show the scanner's Chrome window" itself (scanRequest).
  const run = useCallback(async (action, extra = {}) => {
    if (action === 'set-limits' || action === 'lift-cooldown') return setting(action, extra);
    setError(null);
    setBusy(true);
    try {
      await beginScrape(action, extra);
    } catch (e) {
      setError(e.message || 'Could not start.');
    } finally {
      setBusy(false);
      poll();
    }
    return undefined;
  }, [poll, setting]);

  return { s, job, settings, setSettings, busy, error, setError, poll, run, setting, stop, acceptRisk, answerAppManagement, appAnswer };
}
