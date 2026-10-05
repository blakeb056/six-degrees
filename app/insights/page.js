'use client';

// Insights was a tab of its own from 0.8.0 to 1.0.0. It lives in your Profile
// now, behind ✦ Insights (Blake, 2026-10-04: "insights that should be in the
// profile where the button already is as that makes more sense and not to add
// a tab"), with its boards in the notch. Old links land on the same board:
// /insights opens People, /insights?view=<board> that board
// (lib/insights-address.js movedInsights).
//
// The address is read with useSearchParams, not window.location: on a click
// from another page the address bar only changes after this page has rendered
// (TRAPS §41), and Next requires the Suspense for the page to build.

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { movedInsights, insightsHref } from '../../lib/insights-address';

export default function InsightsMoved() {
  return <Suspense><Forward /></Suspense>;
}

function Forward() {
  const router = useRouter();
  const to = movedInsights(useSearchParams().toString());
  useEffect(() => { router.replace(to); }, [router, to]);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-3, #aab)', fontFamily: 'var(--sd-font)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Insights is in your <Link href={insightsHref()} style={{ color: 'var(--sd-purple, #c39bd3)', marginLeft: 4 }}>Profile</Link>&nbsp;now.
    </div>
  );
}
