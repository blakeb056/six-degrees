'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import OnboardingGate from '../components/OnboardingGate';
import UpdatePanel from '../components/UpdatePanel';
import DataSection from '../components/settings/DataSection';
import { Section, Body, Mono, LINE, FONT } from '../components/ui';
import { IS_DEMO } from '../../lib/demo';

// Settings: one page for the choices that shape how the app treats your data,
// and the facts about this copy. Each feature adds its own <Section>; what the
// user chooses is saved in the database (lib/settings.js), so it travels with
// their data.

export default function SettingsPage() {
  return <OnboardingGate><SettingsInner /></OnboardingGate>;
}

const KIND_LABEL = {
  'mac-app': 'the Mac app',
  npm: 'the npm package (npx six-degrees)',
  source: 'a copy built from the source code',
  git: 'a git checkout of the source code',
};

function SettingsInner() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Could not load settings.')))))
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);

  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a1a', color: 'rgba(255,255,255,0.7)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, textAlign: 'center', padding: 24, fontFamily: FONT,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>Not part of the demo</h2>
        <p style={{ margin: 0, fontSize: 13 }}>The public demo includes the Network Circle and Degrees views only.</p>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  const about = info?.about;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', color: '#fff', fontFamily: FONT }}>
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
        }}>Settings</h1>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '8px 24px 64px' }}>
        {error && <Body style={{ color: '#ff7676', marginTop: 16 }}>{error}</Body>}

        <UpdatePanel />

        <DataSection />

        <Section id="about" title="About this copy">
          {about ? (
            <>
              <Body>Version <Mono>{about.version}</Mono>, running as {KIND_LABEL[about.kind] || about.kind}.</Body>
              <Body>
                Your network is kept in <Mono>{about.dataDir}</Mono>
                {about.customDataDir ? ' (a folder you chose).' : '.'}
                {about.kind === 'mac-app' && ' Help → Show the Data Folder opens it.'}
              </Body>
              <Body style={{ fontSize: 12, color: '#667', marginTop: 10 }}>
                Settings are saved with your network, on this computer. Nothing here is sent anywhere.
              </Body>
            </>
          ) : !error && <Body>Loading…</Body>}
        </Section>
      </main>
    </div>
  );
}
