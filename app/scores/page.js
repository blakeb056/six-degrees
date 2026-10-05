'use client';

// Scores had a tab of its own from 2026-09-28 to 2026-10-02. It now lives in
// Settings (Blake, 2026-10-02: "moving scores into settings"), and network
// health in Profile → ✦ Insights → Health. Old links land in the right place:
// /scores#sector, #tiers and #companies go to the same place in Settings;
// /scores#health goes to Health (lib/insights-address.js).

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FONT } from '../components/ui';
import { insightsHref } from '../../lib/insights-address';

export default function ScoresMoved() {
  const router = useRouter();
  useEffect(() => {
    const at = window.location.hash;
    router.replace(at === '#health' ? insightsHref('health') : `/settings${at || '#scoring'}`);
  }, [router]);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-3, #aab)', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Scores are in <Link href="/settings#scoring" style={{ color: 'var(--sd-blue, #3498DB)', marginLeft: 4 }}>Settings</Link> now.
    </div>
  );
}
