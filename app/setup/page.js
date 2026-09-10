'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import OnboardingGate from '../components/OnboardingGate';
import Link from 'next/link';
import { stopScrape } from '../../lib/scraper-client';
import UpdatePanel from '../components/UpdatePanel';

// Everything here runs through /api/scraper. There is deliberately no second
// server and no command to copy: the step where people gave up was starting a
// Python server in a terminal they had not been told they needed.

const BG = '#0a0a1a';
const LINE = '1px solid rgba(255,255,255,0.1)';

const ACTION_LABELS = {
  install: 'Installing the scraper',
  login: 'Waiting for you to sign in',
  full: 'Scanning your whole network',
  refresh: 'Checking for new connections',
  'auto-bridge': 'Mapping 2nd-degree connections',
  'auto-bridge-retry': 'Mapping 2nd degree, hidden ones included',
};

export default function SetupPage() {
  return <OnboardingGate><SetupInner /></OnboardingGate>;
}

function SetupInner() {
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
  const [error, setError] = useState(null);
  const logRef = useRef(null);

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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [s?.log?.length]);

  async function stop() {
    setError(null);
    await stopScrape().catch((e) => setError(e.message));
    poll();
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
  const needsDeps = s && !c.dependencies;
  const needsChrome = s && !c.chrome;
  const notFound = s && !c.scriptsFound;
  const canScrape = s?.ready && !running;

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

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>

        <p style={{ color: '#9aa', fontSize: 15, lineHeight: 1.6, marginTop: 0 }}>
          This reads your own LinkedIn connections in a real Chrome window on this
          machine and saves them here. Nothing leaves your computer, and you will never
          be asked for your password — you sign in yourself, once.
        </p>

        {notFound && (
          <Box tone="bad">
            <b>Can’t find the scraper files.</b><br />
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
              The scraper drives your real Chrome. Install it from{' '}
              <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer"
                 style={{ color: '#3498DB' }}>google.com/chrome</a>, then reload this page.
            </span>
          </Box>
        )}

        {/* ---- step 1 : dependencies ---- */}
        <Step
          n={1}
          done={!!c.dependencies}
          title="Install what the scraper needs"
          body={
            c.dependencies
              ? 'Installed.'
              : c.python
                ? 'One-time, about a minute. Downloads the browser-automation packages.'
                : 'Python 3 was not found on this machine. Install it from python.org, then reload.'
          }
          action={
            !c.dependencies && c.python && (
              <Btn onClick={() => run('install')} disabled={busy || running}>
                {running && s.action === 'install' ? 'Installing…' : 'Install'}
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
              ? 'Signed in on this machine. You won’t be asked again.'
              : 'Opens a Chrome window. Sign in with your email and password — “Continue with Google” cannot work here, because Google blocks its sign-in inside automated browsers.'
          }
          action={
            c.dependencies && !c.signedIn && (
              <Btn onClick={() => run('login')} disabled={busy || running}>
                {running && s.action === 'login' ? 'Waiting for you…' : 'Open LinkedIn'}
              </Btn>
            )
          }
        />

        {/* ---- step 3 : the people you know ---- */}
        <Step
          n={3}
          done={false}
          title="1st degree — the people you know"
          body="The first scan walks your whole connections list, about a minute and a half for 750 people. After that, Check for new only looks at what has been added since."
          action={
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Btn onClick={() => run('full')} disabled={!canScrape} primary>
                {running && s.action === 'full' ? 'Scanning…' : 'Scan my whole network'}
              </Btn>
              <Btn onClick={() => run('refresh')} disabled={!canScrape}>
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
              This is what fills <b>Bridges</b> and <b>Outlink</b>: it opens each of your
              connections in turn and reads who <i>they</i> know. Most people hide their
              connections — those are noted and never tried again.
              <br /><br />
              It is slow on purpose, about two minutes between each person, because
              this is the part LinkedIn notices. During development a real account was
              temporarily restricted after roughly <b>19 people in one sitting</b>.
              Run a batch, leave it for a day, run another — and stop the moment
              LinkedIn mentions unusual activity. It always picks up where it left
              off: anyone still without a mapped circle, highest tier first, including
              people you have connected with since.
            </>
          }
          action={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                  {tiers.length ? 'highest first' : 'pick at least one'}
                </span>
              </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn onClick={() => run('auto-bridge', { maxBridges: batch, tiers })} disabled={!canScrape || !tiers.length} primary>
                {running && s.action === 'auto-bridge' ? 'Mapping…' : 'Map 2nd degree'}
              </Btn>
              <select
                value={batch}
                onChange={(e) => setBatch(Number(e.target.value))}
                disabled={running}
                style={{
                  padding: '9px 10px', borderRadius: 7, fontSize: 13.5, fontWeight: 600,
                  background: 'rgba(255,255,255,0.08)', color: '#fff', border: LINE,
                }}
              >
                <option value={5}>5 people</option>
                <option value={10}>10 people</option>
                <option value={25}>25 people</option>
                <option value={0}>everyone — not advised</option>
              </select>
              <Btn onClick={() => run('auto-bridge-retry', { maxBridges: batch, tiers })} disabled={!canScrape || !tiers.length}>
                Retry hidden ones
              </Btn>
            </div>
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

        <UpdatePanel />

        <p style={{ color: '#667', fontSize: 12.5, lineHeight: 1.7, marginTop: 32 }}>
          Automating LinkedIn may go against its User Agreement, and accounts have been
          restricted for it. This runs locally against your own account, at your own risk.
          LinkedIn’s own CSV export is the supported route and needs none of this —{' '}
          <Link href="/import" style={{ color: '#3498DB' }}>import a CSV instead</Link>.
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

const code = { background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 };

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

function Spinner() {
  return <span style={{
    width: 11, height: 11, borderRadius: '50%', display: 'inline-block',
    border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#3498DB',
    animation: 'spin 0.8s linear infinite',
  }} />;
}
