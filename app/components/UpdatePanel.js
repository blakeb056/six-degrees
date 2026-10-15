'use client';

import { useState, useEffect, useId, useRef } from 'react';
import { Section, Body, Mono, Status, Btn, LINE } from './ui';
import { saveSettings } from '../../lib/settings-client';
import { CHECK_UPDATES_EVENT, UPDATE_NOTES_SEEN_EVENT } from '../../lib/update-notice';

// Loading the panel only reads the local state. The panel itself goes online
// when someone presses "Check for updates", here or in the Mac app's menu
// (which opens this page at /settings?check=updates, the same click made from
// the menu), or opens the daily check's notification (the bell, or the gear's
// dot), which lands here the same way.
//
// An installed copy also checks once a day by itself, on the server
// (lib/update-check.js): the same one request for the newest version number,
// which only ever leaves a notification, and, with plugins on and one
// installed, a read of the plugin list for newer plugin versions. The switch
// here turns both off.
//
// In the Mac app, installing is a second, separate click ("Install and
// restart"). Nothing is downloaded before it.

export default function UpdatePanel() {
  const [local, setLocal] = useState(null);

  useEffect(() => {
    fetch('/api/update').then((r) => r.json()).then(setLocal).catch(() => {});
  }, []);

  if (!local) return null;
  if (local.installed) return <InstalledUpdates local={local} />;
  return <GitUpdates local={local} />;
}

async function post(body) {
  const r = await fetch('/api/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d };
}

// ── a git checkout ────────────────────────────────────────────────────────────
// `git fetch` and `git pull`, exactly as you would type them.
function GitUpdates({ local }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // The menu's "Check for Updates…" runs its check here too.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('check') !== 'updates') return;
    document.getElementById('updates')?.scrollIntoView({ block: 'center' });
    call('check');
    window.history.replaceState(null, '', window.location.pathname);
    // Runs once, when the panel appears.
  }, []);

  async function call(action) {
    setBusy(action);
    setError(null);
    try {
      const { ok, d } = await post({ action });
      if (!ok) {
        setError(d.error || 'Something went wrong.');
        if (d.dirty) setResult({ dirty: d.dirty });
        return;
      }
      if (action === 'check') setResult(d);
      else { setDone(d); setResult(null); }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section id="updates" title="Updates">
      {done ? (
        <>
          <Body>
            Updated to <Mono>{done.sha}</Mono>: “{done.subject}”.
          </Body>
          <Body style={{ color: done.needsRestart ? 'var(--sd-gold, #FFD700)' : undefined }}>
            {done.needsRestart
              ? 'Stop the app in your terminal and start it again: this update changed how it starts.'
              : 'The page will pick up most changes on its own. Restart the app if anything looks odd.'}
          </Body>
        </>
      ) : (
        <>
          <Body>
            You are on <Mono>{local.sha}</Mono>: “{local.subject}”.
          </Body>

          {result && result.behind === 0 && <Status tone="ok">You&rsquo;re up to date.</Status>}

          {result && result.behind > 0 && (
            <>
              <Body style={{ color: 'var(--sd-green, #00ff88)' }}>
                {result.behind} update{result.behind === 1 ? '' : 's'} available.
              </Body>
              <pre style={pre}>{result.commits.join('\n')}</pre>
            </>
          )}

          {result?.dirty?.length > 0 && (
            <Body>
              Changed files here:{' '}
              <Mono>{result.dirty.join(', ')}</Mono>. Commit or discard them first: this
              will not throw away your work.
            </Body>
          )}

          <Row>
            <Btn onClick={() => call('check')} disabled={!!busy}>
              {busy === 'check' ? 'Checking…' : 'Check for updates'}
            </Btn>
            {result?.behind > 0 && (
              <Btn onClick={() => call('pull')} disabled={!!busy} primary>
                {busy === 'pull' ? 'Updating…' : `Install ${result.behind} update${result.behind === 1 ? '' : 's'}`}
              </Btn>
            )}
          </Row>
        </>
      )}

      {error && <Body style={{ color: 'var(--sd-red, #ff7676)' }}>{error}</Body>}

      <Body style={{ fontSize: 12, color: 'var(--sd-fg-4, #667)', marginTop: 12 }}>
        A copy run from the source code is never checked automatically, and nothing about you is sent:
        this runs the same <Mono>git fetch</Mono> and <Mono>git pull</Mono> you would type yourself.
      </Body>
    </Section>
  );
}

// ── an installed copy ─────────────────────────────────────────────────────────
// The Mac app and the npm package update by installing the newer release over
// the top. "Check for updates" asks GitHub for the newest version number, as
// the daily check does (Check for updates once a day, below). The Mac app can
// then install it itself, on a second click; when
// it can't (or for npm), this hands over the exact line to run instead, saying
// what that line would do for this copy. Where it would do harm (a network
// kept inside the app, which the line deletes with it), it isn't offered.

const ACTIVE = ['checking', 'downloading', 'verifying', 'preparing', 'restarting'];

function InstalledUpdates({ local }) {
  const mac = local.kind === 'mac-app';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [job, setJob] = useState(local.job || null);   // an install, while it runs
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState(null);         // why an install couldn't start
  const [refusedCode, setRefusedCode] = useState(null);
  const [refusedFallback, setRefusedFallback] = useState(undefined); // the Terminal line then (see fallbackText)
  const [gone, setGone] = useState(0);                   // polls that found no server: it is restarting
  const [slow, setSlow] = useState(false);

  const active = Boolean(job && ACTIVE.includes(job.phase));
  const restarting = active && (job.phase === 'restarting' || gone > 0);

  // Opened from the menu's "Check for Updates…": bring the panel into view and
  // run the check that click asked for. After an update the app opens here
  // (#updates), to show how it went.
  useEffect(() => {
    const panel = () => document.getElementById('updates');
    if (window.location.hash === '#updates') panel()?.scrollIntoView({ block: 'start' });
    if (new URLSearchParams(window.location.search).get('check') !== 'updates') return;
    window.history.replaceState(null, '', window.location.pathname);
    if (local.job && ACTIVE.includes(local.job.phase)) return; // an install is already under way
    panel()?.scrollIntoView({ block: 'center' });
    check().then(() => panel()?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  }, [local.job]);

  // The bell or the gear, on this page already: the same as arriving at
  // ?check=updates (lib/update-notice.js openUpdates). Read through a ref, so
  // the listener sees the install's latest state.
  const asked = useRef(null);
  useEffect(() => {
    asked.current = () => {
      const panel = document.getElementById('updates');
      panel?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (!active && !busy) check();
    };
  });
  useEffect(() => {
    const onAsk = () => asked.current?.();
    window.addEventListener(CHECK_UPDATES_EVENT, onAsk);
    return () => window.removeEventListener(CHECK_UPDATES_EVENT, onAsk);
  }, []);

  // Follow an install. Once it restarts, this server goes away. The next one to
  // answer is the new version, or the old one put back; reloading shows which.
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        if (restarting) {
          const r = await fetch('/api/update', { cache: 'no-store' });
          const d = await r.json();
          if (!alive) return;
          if (!d.job || d.job.id !== job.id) {
            window.location.reload();
            return;
          }
          setGone(0);          // the same server, still here: not restarting after all
          setJob(d.job);
        } else {
          const { ok, d } = await post({ action: 'update-status' });
          if (alive && ok && d.job) setJob(d.job);
        }
      } catch {
        if (alive) setGone((n) => n + 1);
      }
    }, restarting ? 1500 : 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [job, gone, active, restarting]);

  // A restart takes a few seconds. After a minute, say what to do.
  useEffect(() => {
    if (!restarting) return undefined;
    const timer = setTimeout(() => setSlow(true), 60000);
    return () => clearTimeout(timer);
  }, [restarting]);

  async function check() {
    setBusy(true);
    setResult(null);
    setError(null);
    // A new check is a new start: an earlier attempt's failure no longer applies.
    setRefused(null);
    setRefusedCode(null);
    setRefusedFallback(undefined);
    setJob((j) => (j && ACTIVE.includes(j.phase) ? j : null));
    try {
      const { ok, d } = await post({ action: 'check-release' });
      if (!ok) setError(d.error || 'Could not check.');
      else {
        setResult(d);
        setCheckedAt(new Date());
        // The server counted the update notifications as read: the bell and the gear follow.
        window.dispatchEvent(new Event(UPDATE_NOTES_SEEN_EVENT));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setStarting(true);
    setRefused(null);
    setRefusedCode(null);
    setRefusedFallback(undefined);
    setGone(0);
    setSlow(false);
    try {
      const { ok, d } = await post({ action: 'install-release' });
      if (d.job) setJob(d.job);
      if (!ok) {
        setRefused(d.error || 'The update could not start.');
        setRefusedCode(d.refusal || null);
        if ('fallback' in d) setRefusedFallback(d.fallback);
      }
    } catch (e) {
      setRefused(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    try {
      const { d } = await post({ action: 'cancel-install' });
      if (d.job) setJob(d.job);
    } catch { /* the next poll shows where it got to */ }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(local.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy. Select the line and copy it by hand.');
    }
  }

  const failed = job?.phase === 'failed';
  const canInstall = mac && result?.install?.possible;
  // The install offered a version, and a newer one has come out since, or it
  // was never offered one on this server: the answer is a new check, not "Try again".
  const needsCheck = (failed && job.code === 'stale-check') || refusedCode === 'not-checked';
  // What the Terminal line would do here (lib/updater.js terminalFallback);
  // null for the Mac app where it must not be offered.
  const fallback = refusedFallback !== undefined ? refusedFallback : result?.fallback;
  // The Terminal line: always for npm and source copies, and for the Mac app
  // whenever it can't install the update itself, or the last time it tried
  // didn't work (so a second try that fails the same way isn't the only way),
  // except where the line would do harm.
  // Windows and Linux (DESKTOP.md D3): no Terminal line, ever; the release page's installer replaces the app.
  const desktop = local.kind === 'windows-app' || local.kind === 'linux-app';
  const showLine = !desktop && result?.newer && (!mac || fallback)
    && (!canInstall || failed || refused || local.lastUpdate?.tone === 'bad');
  const how = fallbackText({ mac, kind: local.kind, canInstall, fallback });

  return (
    <Section id="updates" title="Updates">
      {local.lastUpdate && !active && <LastUpdate report={local.lastUpdate} />}
      <Body>You have version <Mono>{local.version}</Mono>.</Body>

      {active ? (
        <Progress job={job} restarting={restarting} slow={slow} onCancel={cancel} />
      ) : (
        <>
          {failed && (
            <Status tone="bad"><strong>The update didn&rsquo;t finish.</strong> {job.error} Nothing was changed.</Status>
          )}
          {job?.phase === 'cancelled' && <Status>Cancelled. Nothing was changed.</Status>}
          {refused && <Status tone="bad">{refused}</Status>}

          {result && !result.latest && <Status>No release has been published yet.</Status>}
          {result?.latest && !result.newer && (
            <Status tone="ok">
              You&rsquo;re up to date: {result.latest.version} is the newest version.
              {checkedAt && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}> Checked at {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span>}
            </Status>
          )}

          {result?.newer && (
            <>
              <Body style={{ color: 'var(--sd-green, #00ff88)' }}>Version {result.latest.version} is available.</Body>
              {canInstall && (
                <>
                  <Body>
                    It downloads {result.install.size ? `about ${megabytes(result.install.size)} MB` : 'the new version'} from
                    GitHub, checks it, then closes, replaces itself and reopens. Your network isn&rsquo;t touched, and a
                    backup of it is made first.
                  </Body>
                  <Row>
                    {needsCheck ? (
                      <Btn onClick={check} disabled={busy} primary>{busy ? 'Checking…' : 'Check again'}</Btn>
                    ) : (
                      <Btn onClick={install} disabled={starting} primary>
                        {starting ? 'Starting…' : failed || refused ? 'Try again' : 'Install and restart'}
                      </Btn>
                    )}
                    <WhatChanged url={result.latest.url} />
                  </Row>
                </>
              )}
              {mac && !canInstall && result.install?.reason && <Body>{result.install.reason}</Body>}
              {desktop && (
                <>
                  <Body>
                    {local.kind === 'windows-app'
                      ? 'Download its Setup.exe from the release page and run it: it closes this copy, puts the new version in its place and opens it.'
                      : 'Download its .deb (or .tar.gz) from the release page and install it over this one, after quitting Sixgree.'}
                    {' '}Your network stays where it is.
                  </Body>
                  <Row>
                    <a href={(result.download || result.latest).url} target="_blank" rel="noreferrer" style={{
                      display: 'inline-block', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                      background: 'linear-gradient(135deg, #9B59B6, #3498DB)', color: '#fff',
                    }}>Open the release page</a>
                  </Row>
                </>
              )}
              {showLine && (
                <>
                  <Body>{how}</Body>
                  {local.testReleases ? (
                    // The line installs the real release from GitHub, not the
                    // test one, into Applications: over the copy someone uses.
                    <pre style={pre}>Not shown in test mode: it would install the real release from GitHub into Applications.</pre>
                  ) : (
                    <>
                      <pre style={pre}>{local.command}</pre>
                      <Row>
                        <Btn onClick={copy} primary={!canInstall}>{copied ? 'Copied' : 'Copy'}</Btn>
                        {!canInstall && <WhatChanged url={result.latest.url} />}
                      </Row>
                    </>
                  )}
                </>
              )}
              {!canInstall && !showLine && !desktop && <Row><WhatChanged url={result.latest.url} /></Row>}
            </>
          )}

          {!result?.newer && (
            <Row>
              <Btn onClick={check} disabled={busy}>{busy ? 'Checking…' : result ? 'Check again' : 'Check for updates'}</Btn>
            </Row>
          )}
        </>
      )}

      {error && <Body style={{ color: 'var(--sd-red, #ff7676)' }}>{error}</Body>}

      <DailyCheckSwitch />

      <Body style={{ fontSize: 12, color: 'var(--sd-fg-4, #667)', marginTop: 12 }}>
        The button and the daily check ask GitHub for the newest version number and nothing else. Nothing
        about you is sent: GitHub sees an ordinary request from your computer.
        {mac && ' Only a second click, Install and restart, downloads the new version.'}
      </Body>
      {local.testReleases && (
        <Body style={{ fontSize: 12, color: 'var(--sd-gold, #FFD700)', marginTop: 6 }}>
          Test mode: releases are read from <Mono>{local.testReleases}</Mono> on this computer, not from GitHub.
        </Body>
      )}
    </Section>
  );
}

const megabytes = (bytes) => Math.max(1, Math.round(bytes / 1e6));

// Settings → Updates → Check for updates once a day (lib/update-notice.js,
// setting updateCheck): on until it's turned off. Saved with the network, like
// every setting, and read by the server's daily check before each look.
function DailyCheckSwitch() {
  const id = useId();
  const [on, setOn] = useState(null);          // null until the saved choice is in
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json())
      .then((d) => setOn(d.settings ? d.settings.updateCheck !== false : null))
      .catch(() => setError('Could not read this setting. Reload the page to try again.'));
  }, []);

  async function toggle(next) {
    setSaving(true);
    setError(null);
    const { settings, error: failed } = await saveSettings({ updateCheck: next });
    if (failed) setError(failed);
    else if (settings) setOn(settings.updateCheck);
    setSaving(false);
  }

  return (
    <div data-update-check-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 18 }}>
      <input id={id} type="checkbox" checked={Boolean(on)} disabled={on === null || saving} onChange={(e) => toggle(e.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
          Check for updates once a day
        </label>
        <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
          While Sixgree is open, it asks GitHub once a day whether there&rsquo;s a newer version, and tells you in the
          notifications if there is. With plugins on, it reads the plugin list then too, for newer versions of the
          plugins you installed. It never downloads anything by itself.{on === false ? ' Off: it asks only when you press Check for updates.' : ''}
        </div>
        {error && <div style={{ fontSize: 12.5, color: 'var(--sd-red, #ff7676)', marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}

// What the Terminal line does, for this copy. For the Mac app that depends on
// where it is (lib/updater.js terminalFallback): install.sh replaces the app in
// Applications, and anywhere else it installs a second copy there, which only
// opens once this one has quit (one copy runs at a time).
function fallbackText({ mac, kind, canInstall, fallback }) {
  if (!mac) {
    return kind === 'source'
      ? 'A copy built from the source code updates by fetching the code and building it again, which it can\'t do while it runs. Stop it (Ctrl-C), then run this in the six-degrees folder. Your network stays where it is.'
      : 'This copy runs inside the terminal that started it, so it can\'t replace itself while it runs. Stop it first (Ctrl-C), then run this to start the newest version. Your network stays where it is.';
  }
  if (!fallback) return null;
  const data = fallback.dataDir
    ? ` It opens the new version on the usual data folder, not on ${fallback.dataDir}: to use that one, quit it and open it again with --data-dir, as you opened this one.`
    : '';
  if (fallback.mode === 'replace') {
    return `${canInstall ? 'Or paste this into Terminal.' : 'Paste this into Terminal instead.'} It closes this app, puts the new version in its place and opens it. Your network stays where it is.${data}`;
  }
  return `${canInstall ? 'Or copy' : 'Copy'} this line, quit Sixgree, then paste it into Terminal. It installs the new version at ${fallback.installsTo}, not where this copy is, and opens it: use that one from then on. Your network stays where it is.${data}`;
}

function Progress({ job, restarting, slow, onCancel }) {
  const pct = job.total ? Math.min(100, Math.round((job.received / job.total) * 100)) : null;
  const text = restarting ? 'Restarting… Sixgree closes and opens again in a moment.'
    : job.phase === 'checking' ? 'Asking GitHub for the newest version…'
      : job.phase === 'downloading'
        ? `Downloading ${job.version}…${pct !== null ? ` ${pct}% (${megabytes(job.received)} of ${megabytes(job.total)} MB)` : ''}`
        : job.phase === 'verifying' ? 'Checking the download…'
          : 'Preparing the new version…';
  return (
    <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
      <Body style={{ color: 'var(--sd-fg-1, #e8e8ee)' }}>{text}</Body>
      {job.phase === 'downloading' && pct !== null && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Download"
          style={{ height: 6, borderRadius: 3, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', marginTop: 10, overflow: 'hidden', maxWidth: 420 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #9B59B6, #3498DB)', transition: 'width 0.4s ease' }} />
        </div>
      )}
      {slow && (
        <Body>This is taking longer than it should. If Sixgree doesn&rsquo;t open again by itself, open it from your Applications folder.</Body>
      )}
      {!restarting && (
        <Row>
          <Btn onClick={onCancel}>Cancel</Btn>
        </Row>
      )}
    </div>
  );
}

// How the last update went, shown once the app is back (for a week).
function LastUpdate({ report }) {
  const when = new Date(report.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Status tone={report.tone === 'ok' ? 'ok' : 'bad'}>
      {report.text} <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>({when})</span>
      {report.tone === 'ok' && report.previous && (
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4 }}>
          A copy of the version you had is kept in <Mono>{report.previous}</Mono> until the next update.
          To go back to it, open that file and drag the app it gives you into your Applications folder.
        </span>
      )}
    </Status>
  );
}

function WhatChanged({ url }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--sd-blue, #3498DB)', fontSize: 13.5 }}>
      What changed →
    </a>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
  );
}

const pre = {
  background: 'rgba(var(--sd-shade, 0, 0, 0), 0.45)', border: LINE, borderRadius: 8, padding: 12,
  margin: '8px 0 0', fontSize: 12, lineHeight: 1.7, color: 'var(--sd-fg-2, #b9c6c6)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto',
};
