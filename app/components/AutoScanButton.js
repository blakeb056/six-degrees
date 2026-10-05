'use client';

// "Auto scan" in the header, beside Scan, while the Scan page's experimental
// all-day switch is on: starts Auto-Bridge in all-day mode (lib/experimental-client.js).
// Unlit until it runs; lit while it does, and then it opens the Scan page.

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { watchScanner, scannerNow } from '../../lib/scraper-client';
import { watchAllDay, allDayNow, startAutoScan } from '../../lib/experimental-client';
import InlineNote, { useFadingNote } from './InlineNote';

export default function AutoScanButton({ isMobile = false }) {
  const on = useSyncExternalStore(watchAllDay, allDayNow, () => false);
  const [job, setJob] = useState(() => scannerNow());
  const [starting, setStarting] = useState(false);
  const [note, say] = useFadingNote(8000);
  useEffect(() => watchScanner(() => { setJob(scannerNow()); setStarting(false); }), []);
  if (!on) return null;
  const mine = job?.running && String(job.action || '').startsWith('auto-bridge');
  const style = {
    padding: isMobile ? '8px 12px' : '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  };
  if (mine) {
    return (
      <Link href="/setup" title="Auto scan is running: see it on the Scan page" style={{ ...style, background: 'rgba(0,255,136,0.15)', color: 'var(--sd-green, #00ff88)', border: '1px solid rgba(0,255,136,0.45)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00ff88' }} />Auto scan
      </Link>
    );
  }
  const busy = job?.running || starting;
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => {
          say(null);
          setStarting(true);
          // A refusal (a cooldown, the scanner not set up, the one-time "I understand")
          // used to vanish without a word: now it's a line under the button.
          startAutoScan().catch((e) => { setStarting(false); say(e?.message || 'Auto scan could not start.'); });
        }}
        disabled={busy}
        title={busy ? 'The scanner is busy: one scan at a time' : 'Start the all-day Auto-Bridge (experimental). It runs in the background; the notch shows how it’s going.'}
        style={{ ...style, cursor: busy ? 'default' : 'pointer', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', color: busy ? 'var(--sd-fg-5, #555)' : 'var(--sd-fg-3, #8b9a9a)', border: '1px solid rgba(255,215,0,0.25)' }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#556' }} />Auto scan
      </button>
      <InlineNote note={note} float align="left" />
    </div>
  );
}
