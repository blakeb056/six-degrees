'use client';

// What the Scan page and the guided setup (app/components/onboarding) both
// read and do, in one place: the scanner's status (GET /api/scraper, every
// 1.5 s), your saved settings, and the four things they press: start a job
// (run), change a scanner setting (the budget, a cooldown), say "I understand"
// to the scanning risks, and answer the App Management item. Pulled out of
// app/setup/page.js when the setup arrived, so the two never disagree about
// what a click does.

import { useState, useEffect, useCallback } from 'react';
import { stopScrape, beginScrape } from '../../lib/scraper-client';
import { saveSettings } from '../../lib/settings-client';
import { IS_DEMO } from '../../lib/demo';

const POLL_MS = 1500;

export default function useScanStatus() {
  // GET /api/scraper's answer: null until the first one.
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // What's saved: undefined while it loads, null when it couldn't be read.
  const [settings, setSettings] = useState(undefined);
  // The App Management item, answered here ('done' or 'skipped'), if it was.
  const [appAnswer, setAppAnswer] = useState(null);

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
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

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

  return { s, settings, setSettings, busy, error, setError, poll, run, setting, stop, acceptRisk, answerAppManagement, appAnswer };
}
