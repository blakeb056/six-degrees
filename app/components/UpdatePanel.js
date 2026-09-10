'use client';

import { useState, useEffect } from 'react';

// Nothing here runs on its own. The spec forbids a silent update check, and
// this respects that: the first network call happens when someone presses
// "Check for updates". Loading the panel only reads the local git state.

const LINE = '1px solid rgba(255,255,255,0.1)';

export default function UpdatePanel() {
  const [local, setLocal] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    fetch('/api/update').then((r) => r.json()).then(setLocal).catch(() => {});
  }, []);

  async function call(action) {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) {
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

  if (!local) return null;

  if (local.supported === false) {
    return (
      <Wrap>
        <Title>Updates</Title>
        <Body>{local.reason}</Body>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Title>Updates</Title>

      {done ? (
        <>
          <Body>
            Updated to <Mono>{done.sha}</Mono> — “{done.subject}”.
          </Body>
          <Body style={{ color: done.needsRestart ? '#FFD700' : undefined }}>
            {done.needsRestart
              ? 'Stop the app in your terminal and start it again — this update changed how it starts.'
              : 'The page will pick up most changes on its own. Restart the app if anything looks odd.'}
          </Body>
        </>
      ) : (
        <>
          <Body>
            You are on <Mono>{local.sha}</Mono> — “{local.subject}”.
          </Body>

          {result && result.behind === 0 && <Body>Up to date.</Body>}

          {result && result.behind > 0 && (
            <>
              <Body style={{ color: '#00ff88' }}>
                {result.behind} update{result.behind === 1 ? '' : 's'} available.
              </Body>
              <pre style={pre}>{result.commits.join('\n')}</pre>
            </>
          )}

          {result?.dirty?.length > 0 && (
            <Body>
              Changed files here:{' '}
              <Mono>{result.dirty.join(', ')}</Mono>. Commit or discard them first — this
              will not throw away your work.
            </Body>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <Btn onClick={() => call('check')} disabled={!!busy}>
              {busy === 'check' ? 'Checking…' : 'Check for updates'}
            </Btn>
            {result?.behind > 0 && (
              <Btn onClick={() => call('pull')} disabled={!!busy} primary>
                {busy === 'pull' ? 'Updating…' : `Install ${result.behind} update${result.behind === 1 ? '' : 's'}`}
              </Btn>
            )}
          </div>
        </>
      )}

      {error && <Body style={{ color: '#ff7676' }}>{error}</Body>}

      <Body style={{ fontSize: 12, color: '#667', marginTop: 12 }}>
        Nothing is checked automatically and nothing about you is sent — this runs the
        same <Mono>git fetch</Mono> and <Mono>git pull</Mono> you would type yourself.
      </Body>
    </Wrap>
  );
}

const pre = {
  background: 'rgba(0,0,0,0.45)', border: LINE, borderRadius: 8, padding: 12,
  margin: '8px 0 0', fontSize: 12, lineHeight: 1.7, color: '#b9c6c6',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto',
};

function Wrap({ children }) {
  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: LINE }}>{children}</div>
  );
}
function Title({ children }) {
  return <div style={{ fontSize: 15.5, fontWeight: 650, marginBottom: 6 }}>{children}</div>;
}
function Body({ children, style }) {
  return (
    <div style={{ fontSize: 13.5, color: '#8b9a9a', lineHeight: 1.6, marginTop: 4, ...style }}>
      {children}
    </div>
  );
}
function Mono({ children }) {
  return (
    <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>
      {children}
    </code>
  );
}
function Btn({ children, onClick, disabled, primary }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 18px', borderRadius: 7, fontSize: 13.5, fontWeight: 650,
      color: disabled ? '#667' : '#fff', border: LINE,
      background: disabled ? 'rgba(255,255,255,0.05)'
        : primary ? 'linear-gradient(135deg, #9B59B6, #3498DB)' : 'rgba(255,255,255,0.08)',
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}>{children}</button>
  );
}
