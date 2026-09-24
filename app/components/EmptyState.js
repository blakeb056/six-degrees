'use client';

import { useState } from 'react';
import { loadSampleIntoSession } from '../../lib/demo';

// The first thing a new install shows: there is no network yet, so pick a way in.
//
// It is also what anyone sees whose database is empty, which is why it asks
// nothing about them. Scanning is first because it is the only way to the
// 2nd-degree views; the CSV is the route that touches LinkedIn least; the sample
// is for looking around before deciding either.
export default function EmptyState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadSample() {
    setBusy(true);
    setError('');
    try {
      await loadSampleIntoSession();
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Could not load the sample network.');
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 24, overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <div style={{
          width: 68, height: 68, borderRadius: '50%', margin: '0 auto 22px',
          border: '2px solid rgba(255,215,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 26,
        }}>✦</div>

        <h2 style={{
          fontSize: 28, fontWeight: 800, margin: '0 0 10px',
          background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Welcome to 6 Degrees
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14.5, lineHeight: 1.7, margin: '0 0 28px' }}>
          Your network, drawn as a galaxy. Everything stays on this computer.
          Pick how to bring it in — you can switch later.
        </p>

        <Choice
          href="/setup"
          primary
          badge="Recommended"
          title="Scan my LinkedIn"
          body="A few guided steps: set up the scanner, sign into LinkedIn yourself, and watch your galaxy fill in. The only way to see who your connections know."
        />

        <Choice
          href="/import"
          title="Import my LinkedIn CSV"
          body="LinkedIn’s official export, read in your browser. Takes about ten minutes to arrive by email. Shows the people you know, not who they know."
        />

        <Choice
          onClick={loadSample}
          disabled={busy}
          title={busy ? 'Loading…' : 'Explore a sample network'}
          body="150 invented people, every view working. Nothing about you is used."
        />

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 18 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

function Choice({ href, onClick, disabled, primary, badge, title, body }) {
  const style = {
    display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'left',
    padding: '16px 18px', borderRadius: 12, marginBottom: 12, textDecoration: 'none',
    cursor: disabled ? 'default' : 'pointer', font: 'inherit',
    border: primary ? '1px solid rgba(255,215,0,0.45)' : '1px solid rgba(255,255,255,0.12)',
    background: primary
      ? 'linear-gradient(135deg, rgba(255,215,0,0.12), rgba(155,89,182,0.14))'
      : 'rgba(255,255,255,0.03)',
    color: '#fff',
  };
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        <span style={{ fontSize: 15.5, fontWeight: 750 }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 20, background: '#FFD700', color: '#0a0a1a',
          }}>{badge}</span>
        )}
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.4)' }}>→</span>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{body}</div>
    </>
  );
  return href
    ? <a href={href} style={style}>{inner}</a>
    : <button onClick={onClick} disabled={disabled} style={style}>{inner}</button>;
}
