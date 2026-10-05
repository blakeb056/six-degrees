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
  // A tab like the others in the row (app/globals.css .sd-tab): what it's doing
  // is its dot, green while it runs, never tinted words.
  const style = {
    padding: isMobile ? '8px 12px' : '8px 16px', fontSize: 13, textDecoration: 'none',
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  };
  if (mine) {
    return (
      <Link href="/setup" className="sd-tab" title="Auto scan is running: see it on the Scan page" style={style}>
        <span className="notch-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--sd-green, #00ff88)' }} />Auto scan
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
        className="sd-tab"
        style={style}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.3)' }} />Auto scan
      </button>
      <InlineNote note={note} float align="left" />
    </div>
  );
}
