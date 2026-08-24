'use client';

import { useState } from 'react';
import { loadSampleIntoSession } from '../../lib/demo';

// Shown when there is no network to draw yet. Without this a first run is a
// black screen, which reads as a broken app rather than an empty one.
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
      justifyContent: 'center', padding: 24,
    }}>
      <div style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
        <div style={{
          width: 68, height: 68, borderRadius: '50%', margin: '0 auto 22px',
          border: '2px solid rgba(255,215,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 26,
        }}>✦</div>

        <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px', color: '#fff' }}>
          Nothing mapped yet
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.7, margin: '0 0 28px' }}>
          Your galaxy is empty because there are no connections in it. Pick a way in.
        </p>

        <a href="/import" style={{
          display: 'block', padding: '15px 18px', borderRadius: 12, marginBottom: 10,
          background: 'linear-gradient(135deg,#FFD700,#9B59B6)', color: '#0a0a1a',
          fontWeight: 800, fontSize: 15, textDecoration: 'none',
        }}>
          Import your LinkedIn CSV
        </a>
        <p style={{ color: '#555', fontSize: 12, margin: '0 0 22px', lineHeight: 1.6 }}>
          LinkedIn&rsquo;s official export, read in your browser. Takes about a minute.
        </p>

        <button
          onClick={loadSample}
          disabled={busy}
          style={{
            width: '100%', padding: '13px 18px', borderRadius: 12, marginBottom: 10,
            border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)',
            color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Loading…' : 'Explore a sample network'}
        </button>
        <p style={{ color: '#555', fontSize: 12, margin: '0 0 22px', lineHeight: 1.6 }}>
          150 invented people with mapped bridge circles &mdash; nobody real, just something to click.
        </p>

        <a href="/setup" style={{ color: '#3498DB', fontSize: 13, textDecoration: 'none' }}>
          Or run the local scraper for 2nd-degree data &rarr;
        </a>

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 18 }}>{error}</div>
        )}
      </div>
    </div>
  );
}
