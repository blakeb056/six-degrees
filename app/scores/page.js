'use client';

// Scores: how a power score is worked out, and everything you can change about
// it, in one place (Blake, 2026-09-28: "maybe this should be its own tab").
// Your field (the sector focus), how tiers are graded, and every company's
// score. The first two used to live in Settings and the company scores in
// Paths → Scores; the old links forward here (app/settings/page.js,
// app/paths/page.js).

import Link from 'next/link';
import OnboardingGate from '../components/OnboardingGate';
import SectorSection from '../components/settings/SectorSection';
import TierSection from '../components/settings/TierSection';
import CompanyScores from '../components/CompanyScores';
import { Body, LINE, FONT } from '../components/ui';
import { IS_DEMO } from '../../lib/demo';

export default function ScoresPage() {
  return <OnboardingGate><ScoresInner /></OnboardingGate>;
}

const jump = { color: '#3498DB', textDecoration: 'none', fontWeight: 600 };

function ScoresInner() {
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
        }}>Scores</h1>
      </header>
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '8px 24px 64px' }}>
        <Body style={{ marginTop: 16 }}>
          How someone&rsquo;s power score is worked out, and the three things you can change about it:{' '}
          <a href="#sector" style={jump}>your field</a>, <a href="#tiers" style={jump}>how tiers are graded</a> and{' '}
          <a href="#companies" style={jump}>any company&rsquo;s score</a>. A change here rescores everyone.
        </Body>
        <SectorSection />
        <TierSection />
        <div id="companies" style={{ marginTop: 28 }}>
          <CompanyScores />
        </div>
      </main>
    </div>
  );
}
