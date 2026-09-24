'use client';

import { useUser } from './UserProvider';

// Holds a page back until we know whose network to show.
//
// This used to be a "what's your name?" form. On a one-person app that question
// only ever produced duplicate profiles — see lib/profile.js — so the profile is
// now resolved by the server and there is nothing to ask. First-run choices
// (scan, CSV, sample) live on the welcome screen: app/components/EmptyState.js.
export default function OnboardingGate({ children }) {
  const { userId, ready } = useUser();

  if (ready && userId) return children;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a1a', color: '#fff', padding: 24, textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {!ready ? (
        <div style={{ fontSize: 18, fontWeight: 600 }}>Loading…</div>
      ) : (
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Can’t reach 6 Degrees’ local server
          </div>
          <div style={{ color: '#888', fontSize: 14, lineHeight: 1.6 }}>
            The page loaded but the app behind it is not answering. If you started it
            from a terminal, check that window for an error, then reload this page.
          </div>
        </div>
      )}
    </div>
  );
}
