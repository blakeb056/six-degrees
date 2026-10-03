'use client';

import { useState, useRef, useEffect } from 'react';
import {
  parseConnectionsCsv, saveCsvNetwork, ConnectionsCsvError, CSV_USER, keptBehindScan, closeCsvNetwork, REMOVE_CSV_QUESTION,
} from '../../lib/csv';
import { setUser } from '../../lib/user';
import Link from 'next/link';
import { TIER_COLORS } from '../../lib/themes';


const card = {
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
  borderRadius: 16,
  padding: 24,
};

export default function ImportPage() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  // A CSV kept here that the map doesn't show, because you have scanned your
  // own connections (lib/csv.js openNetworkSource).
  const [behindScan, setBehindScan] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let off = false;
    keptBehindScan().then((k) => { if (!off) setBehindScan(k); });
    return () => { off = true; };
  }, []);

  async function handleText(text) {
    setBusy(true);
    setError('');
    try {
      const { connections, skipped } = parseConnectionsCsv(text);
      // Kept in the data folder (lib/csv-store.js), so it's still here after
      // the window closes. If it can't be kept, nothing opens: a map that
      // vanished on the next start would look kept when it wasn't.
      const saved = await saveCsvNetwork(connections);
      if (!saved.ok) {
        setError(saved.error);
        setBusy(false);
        return;
      }
      const behind = await keptBehindScan();
      setBehindScan(behind);
      // Local-only identity so the app opens without creating an account,
      // unless the map opens on your scanned network instead.
      if (!behind) setUser(CSV_USER.id, CSV_USER.name);
      const tiers = {};
      connections.forEach((c) => { tiers[c.tier] = (tiers[c.tier] || 0) + 1; });
      setResult({ count: connections.length, skipped, tiers });
    } catch (err) {
      setError(err instanceof ConnectionsCsvError ? err.message : 'Could not read that file. Make sure it is Connections.csv from your LinkedIn export.');
    }
    setBusy(false);
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => handleText(String(e.target.result || ''));
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  }

  if (result) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 560, width: '100%' }}>
          <div style={{ fontSize: 13, color: '#2ecc71', fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>IMPORTED</div>
          <h1 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 8px' }}>
            {result.count.toLocaleString()} connections mapped
          </h1>
          <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', margin: '0 0 28px', lineHeight: 1.6 }}>
            Scored on seniority and company, sorted into tiers.
            {result.skipped > 0 && ` ${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped (blank or duplicate).`}
          </p>

          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-4, #666)', letterSpacing: 2, marginBottom: 14 }}>YOUR TIERS</div>
            {['S', 'A', 'B', 'C', 'D'].map((t) => {
              const n = result.tiers[t] || 0;
              const pct = result.count ? (n / result.count) * 100 : 0;
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 16, color: TIER_COLORS[t], fontWeight: 800 }}>{t}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: TIER_COLORS[t], borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 46, textAlign: 'right', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.6)', fontSize: 13 }}>{n}</span>
                </div>
              );
            })}
          </div>

          {behindScan && <BehindScan onRemoved={() => { setBehindScan(null); setResult(null); }} />}
          <Link href="/" style={primaryBtn}>See your galaxy →</Link>
          {!behindScan && (
            <p style={{ color: 'var(--sd-fg-5, #555)', fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
              Kept on this computer, in your data folder, so it&rsquo;s still here after you close the window. Nothing was
              sent anywhere. To remove it, click &times; next to Your CSV at the top of the map.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 620, width: '100%' }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 10px', letterSpacing: -1 }}>
          Map <span style={{ background: 'linear-gradient(135deg,#FFD700,#9B59B6,#3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>your</span> network
        </h1>
        <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', margin: '0 0 30px', lineHeight: 1.6, fontSize: 16 }}>
          Drop LinkedIn&rsquo;s official <code style={code}>Connections.csv</code> below. It is read on this computer,
          scored, drawn as a galaxy, and kept in your data folder. No account, and nothing leaves this computer.
        </p>

        {behindScan && <BehindScan onRemoved={() => setBehindScan(null)} />}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
          style={{
            ...card,
            padding: '48px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 16,
            borderStyle: 'dashed',
            borderColor: dragging ? '#FFD700' : 'rgba(var(--sd-ink, 255, 255, 255), 0.12)',
            background: dragging ? 'rgba(255,215,0,0.05)' : card.background,
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
            {busy ? 'Reading…' : 'Drop Connections.csv here'}
          </div>
          <div style={{ color: 'var(--sd-fg-4, #666)', fontSize: 13 }}>or click to choose the file</div>
          <input
            ref={inputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.25)', borderRadius: 12, padding: 16, color: '#ff8080', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-4, #666)', letterSpacing: 2, marginBottom: 14 }}>HOW TO GET THE FILE</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.6)', fontSize: 14, lineHeight: 2 }}>
            <li>LinkedIn → <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Settings &amp; Privacy → Data privacy → Get a copy of your data</strong></li>
            <li>Pick <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Connections</strong> and request the archive</li>
            <li>LinkedIn emails a download link, usually within ~10 minutes</li>
            <li>Unzip it and drop <code style={code}>Connections.csv</code> above</li>
          </ol>
        </div>

        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71', letterSpacing: 2, marginBottom: 10 }}>PRIVATE BY DESIGN</div>
          <p style={{ margin: 0, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.55)', fontSize: 14, lineHeight: 1.7 }}>
            Your file never leaves this computer. It is read here, and only what the map needs (names, positions,
            companies, profile links and when you connected) is kept, in your data folder, apart from any network you
            scan. The <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Email Address column is ignored entirely</strong>.
          </p>
        </div>

        <div style={{ ...card, borderColor: 'rgba(255,215,0,0.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-gold, #FFD700)', letterSpacing: 2, marginBottom: 10 }}>HONEST CAVEAT</div>
          <p style={{ margin: '0 0 12px', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.55)', fontSize: 14, lineHeight: 1.7 }}>
            LinkedIn&rsquo;s export contains no profile photos, so everyone renders as initials on a tier-colored circle.
            It also only covers people you are <em>already</em> connected to, so <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Degrees</strong> and
            the <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Outlink queue</strong> stay empty, because those map the people you
            haven&rsquo;t met yet.
          </p>
          <p style={{ margin: 0, color: 'var(--sd-fg-4, #666)', fontSize: 13, lineHeight: 1.7 }}>
            Want those? Run the local scanner: it captures 2nd-degree circles and real photos.{' '}
            <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>See setup →</Link>
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <Link href="/" style={{ color: 'var(--sd-fg-5, #555)', fontSize: 13, textDecoration: 'none' }}>← Back</Link>
        </div>
      </div>
    </div>
  );
}

// A CSV kept here that the map doesn't show: your scan wins (lib/csv.js
// openNetworkSource). The file is never deleted for you, so this says it's
// there and offers to remove it.
function BehindScan({ onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (!window.confirm(REMOVE_CSV_QUESTION)) return;
    setBusy(true);
    setError('');
    const closed = await closeCsvNetwork('csv');
    setBusy(false);
    if (closed.ok) onRemoved();
    else setError(closed.error);
  }
  return (
    <div style={{ ...card, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 260px', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.65)', fontSize: 14, lineHeight: 1.6 }}>
        Your map shows the network you scanned. A CSV import is still kept on this computer.
      </span>
      <button onClick={remove} disabled={busy} style={{
        padding: '8px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.2)', background: 'transparent', color: 'var(--sd-fg-1, #fff)',
      }}>
        {busy ? 'Removing…' : 'Remove it'}
      </button>
      {error && <div style={{ width: '100%', color: '#ff8080', fontSize: 13, lineHeight: 1.6 }}>{error}</div>}
    </div>
  );
}

const wrap = {
  minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', padding: '56px 24px',
  fontFamily: 'var(--sd-font)',
  display: 'flex', justifyContent: 'center',
};

const code = {
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', padding: '2px 6px', borderRadius: 5,
  fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const primaryBtn = {
  display: 'block', textAlign: 'center', padding: '15px 20px', borderRadius: 12,
  background: 'linear-gradient(135deg,#FFD700,#9B59B6)', color: '#0a0a1a',
  fontWeight: 800, fontSize: 15, textDecoration: 'none',
};
