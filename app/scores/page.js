'use client';

// Scores had a tab of its own from 2026-09-28 to 2026-10-02. It now lives in
// Settings (Blake, 2026-10-02: "moving scores into settings"), and network
// health in Profile → Insights. Old links land in the right place:
// /scores#sector, #tiers and #companies go to the same place in Settings;
// /scores#health goes to Insights.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FONT } from '../components/ui';

export default function ScoresMoved() {
  const router = useRouter();
  useEffect(() => {
    const at = window.location.hash;
    router.replace(at === '#health' ? '/profile?view=insights' : `/settings${at || '#scoring'}`);
  }, [router]);
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', color: '#aab', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Scores are in <Link href="/settings#scoring" style={{ color: '#3498DB', marginLeft: 4 }}>Settings</Link> now.
    </div>
  );
}
