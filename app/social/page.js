'use client';

// Social is part of Outlink now (Blake, 2026-10-02): the CRM, your LinkedIn
// export and the messages sit under Outlink → Messages & follow-ups
// (app/social/SocialHub.js). Old links land there.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SocialMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/queue?view=messages'); }, [router]);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-3, #aab)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Social is part of <Link href="/queue?view=messages" style={{ color: 'var(--sd-orange, #FF6B35)', marginLeft: 4 }}>Outlink</Link> now.
    </div>
  );
}
