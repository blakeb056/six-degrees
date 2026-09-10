'use client';

import { useEffect, useState } from 'react';

// "I pulled, so I am up to date" is the right expectation. It was wrong here
// only because a running server keeps serving the code it loaded at startup —
// which is invisible, and looks exactly like the update having failed.
//
// So the app says it. On every page, not buried at the bottom of one.

export default function StaleServerBanner() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/update')
      .then((r) => r.json())
      .then((d) => { if (alive && d?.restartNeeded) setInfo(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!info) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'linear-gradient(90deg, #FFD700, #FF6B35)', color: '#1a1200',
        padding: '9px 16px', fontSize: 13, fontWeight: 600, lineHeight: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        flexWrap: 'wrap', textAlign: 'center',
      }}
    >
      <span>
        You have newer code on disk ({info.sha}) than this server is running ({info.bootSha}).
        Restart it to see the changes — <code style={{
          background: 'rgba(0,0,0,0.16)', padding: '1px 6px', borderRadius: 4,
        }}>Ctrl-C</code> in the terminal, then <code style={{
          background: 'rgba(0,0,0,0.16)', padding: '1px 6px', borderRadius: 4,
        }}>npm run dev</code>.
      </span>
      <button
        onClick={() => setInfo(null)}
        style={{
          border: 'none', background: 'rgba(0,0,0,0.18)', color: '#1a1200',
          borderRadius: 6, padding: '3px 10px', fontWeight: 700, cursor: 'pointer',
        }}
      >Dismiss</button>
    </div>
  );
}
