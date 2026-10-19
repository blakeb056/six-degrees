'use client';

// Messages & follow-ups (app/social/SocialHub.js): the CRM, your data export
// and the messages sync, a page of its own again under the app's header.
// Blake, 2026-10-17: the introductions queue it was folded into on 2026-10-02 is
// gone ("Separation is what you want to do anyway"), so it is back here. No tab
// of its own: Profile links to it, and so does the Scan page's messages sync.

import Link from 'next/link';
import AppHeader from '../components/AppHeader';
import OnboardingGate from '../components/OnboardingGate';
import useNotchTabs from '../components/useNotchTabs';
import { IS_DEMO } from '../../lib/demo';
import SocialHub from './SocialHub';

// Its one tab in the notch, as Scan and Import have theirs.
const SOCIAL_TAB = { items: [{ key: 'social', label: 'Messages & follow-ups' }], current: 'social', onPick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };

export default function SocialPage() {
  useNotchTabs(IS_DEMO ? null : SOCIAL_TAB);
  // Demo builds: not part of the public demo, as before.
  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--sd-page)', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.7)',
        fontFamily: 'var(--sd-font)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        textAlign: 'center', padding: 24,
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>Not part of the demo</h1>
        <div style={{ fontSize: 13 }}>The public demo includes the Network Circle and Degrees views only.</div>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.5)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }
  return (
    <OnboardingGate>
      <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
        {/* The same header as every page; no tab is lit, as this page has none. */}
        <AppHeader active="social" />
        <SocialHub />
      </div>
    </OnboardingGate>
  );
}
