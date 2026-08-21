'use client';

import { useState } from 'react';
import { useUser } from './UserProvider';

// Shows a simple name prompt for new users.
// Once they enter their name, creates a user record and stores ID.
// Existing users pass straight through.
export default function OnboardingGate({ children }) {
  const { userId, ready, login } = useUser();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Still loading localStorage
  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Loading...</div>
      </div>
    );
  }

  // User exists — show the app
  if (userId) {
    return children;
  }

  // New user — name prompt
  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const resp = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
        setCreating(false);
        return;
      }
      // Store user ID and name in localStorage
      login(data.user.id, data.user.name);
    } catch (err) {
      setError('Failed to create profile. Try again.');
      setCreating(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a1a', color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ maxWidth: 420, width: '100%', padding: '0 24px', textAlign: 'center' }}>
        {/* Logo */}
        <h1 style={{
          fontSize: 32, fontWeight: 800, marginBottom: 8,
          background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          6 Degrees of Separation
        </h1>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 32 }}>
          Map your LinkedIn power network
        </p>

        {/* Name input */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: '32px 28px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Welcome</div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
            Enter your name to get started
          </div>

          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 10, fontSize: 16,
              border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
              color: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 12,
              textAlign: 'center',
            }}
          />

          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            style={{
              width: '100%', padding: '14px', borderRadius: 10, border: 'none',
              fontSize: 15, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer',
              background: name.trim() ? 'linear-gradient(135deg, #FFD700, #FF6B35)' : 'rgba(255,255,255,0.08)',
              color: name.trim() ? '#000' : '#555',
              transition: 'all 0.2s',
            }}
          >
            {creating ? 'Setting up...' : 'Get Started'}
          </button>

          {error && (
            <div style={{ color: '#ff5050', fontSize: 12, marginTop: 8 }}>{error}</div>
          )}
        </div>

        {/* The other way in: map your own network from LinkedIn's official
            export, with no account and nothing stored. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 18px' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ color: '#444', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>

        <a
          href="/import"
          style={{
            display: 'block', padding: '14px', borderRadius: 10, textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)',
            color: '#fff', fontSize: 14, fontWeight: 700,
          }}
        >
          Map your own network &rarr;
        </a>
        <p style={{ color: '#555', fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          Drop LinkedIn&rsquo;s <strong style={{ color: '#888' }}>Connections.csv</strong>{' '}export &mdash; scored in your
          browser, never uploaded.
        </p>

        <p style={{ color: '#444', fontSize: 11, marginTop: 16 }}>
          No account needed. Your data stays on this device.
        </p>
      </div>
    </div>
  );
}
