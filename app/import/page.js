'use client';

// Import: LinkedIn's Connections.csv, read on this computer and imported into
// your network (lib/csv.js previewCsvImport, applyCsvImport): first what it
// would do, then Import. The guided setup has the same door for a first
// import (app/components/onboarding); this page is for every one after it.
// Imports only ever add and bring people up to date: nobody is removed.
//
// The same header as every page, and its one tab in the notch under it
// (Blake, 2026-10-04: "make sure all the uis are compliant").

import { useState, useRef, useEffect } from 'react';
import {
  CSV_USER, keptBehindScan, closeCsvNetwork, REMOVE_CSV_QUESTION, importLines,
} from '../../lib/csv';
import Link from 'next/link';
import { TIER_COLORS } from '../../lib/themes';
import AppHeader from '../components/AppHeader';
import useNotchTabs from '../components/useNotchTabs';
import useCsvImport from '../components/useCsvImport';
import { useUser } from '../components/UserProvider';

// The notch's one tab: the page is one thing, so the tab is the page, lit.
const IMPORT_TAB = { items: [{ key: 'import', label: 'Import a CSV' }], current: 'import', onPick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };

/** The page's frame: the header every page has, then the page in the middle. */
function Shell({ children }) {
  const { userId } = useUser();
  return (
    <div style={page}>
      <AppHeader active="import" csvMode={userId === CSV_USER.id} />
      <div style={wrap}>{children}</div>
    </div>
  );
}


const card = {
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
  borderRadius: 16,
  padding: 24,
};

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the import would do, or did: one line each (lib/csv.js importLines). */
function Lines({ of, done }) {
  const lines = importLines(of, { done });
  if (!lines.length) return null;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.7)', fontSize: 14, lineHeight: 1.9 }}>
      {lines.map((l) => (
        <li key={l.key} data-line={l.key} style={l.key === 'noLink' || l.key === 'repeated' ? { color: 'var(--sd-fg-4, #888)' } : undefined}>{l.text}</li>
      ))}
    </ul>
  );
}

function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div role="alert" style={{ background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.25)', borderRadius: 12, padding: 16, color: '#ff8080', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
      {children}
    </div>
  );
}

export default function ImportPage() {
  const [dragging, setDragging] = useState(false);
  const csv = useCsvImport();
  const { userId } = useUser();
  // A CSV an older version kept here that the map doesn't show, because you
  // have scanned your own connections (lib/csv.js openNetworkSource), and the
  // move at the start couldn't take it in.
  const [behindScan, setBehindScan] = useState(null);
  const inputRef = useRef(null);
  useNotchTabs(IMPORT_TAB);

  useEffect(() => {
    let off = false;
    keptBehindScan().then((k) => { if (!off) setBehindScan(k); });
    return () => { off = true; };
  }, []);

  if (csv.step === 'done') {
    const r = csv.result;
    const after = r.tiers?.after || {};
    const before = r.tiers?.before || {};
    const total = Number(r.network) || 0;
    return (
      <Shell>
        <div key="done" style={{ maxWidth: 560, width: '100%' }} data-import="done">
          <div style={{ fontSize: 13, color: '#2ecc71', fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>IMPORTED</div>
          <h1 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 8px' }}>
            {plural(total, 'connection', 'connections')} in your network
          </h1>
          <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', margin: '0 0 18px', lineHeight: 1.6 }}>
            Scored on seniority and company, with your own settings, and sorted into tiers.
            {csv.preview?.skipped > 0 && ` ${plural(csv.preview.skipped, 'row', 'rows')} skipped (blank or duplicate).`}
          </p>
          <div style={{ ...card, marginBottom: 20 }}>
            <Lines of={{ counts: r.counts, leftOut: r.leftOut, repeated: csv.preview?.repeated }} done />
          </div>

          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-4, #666)', letterSpacing: 2, marginBottom: 14 }}>YOUR TIERS</div>
            {['S', 'A', 'B', 'C', 'D'].map((t) => {
              const n = after[t] || 0;
              const more = n - (before[t] || 0);
              const pct = total ? (n / total) * 100 : 0;
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 16, color: TIER_COLORS[t], fontWeight: 800 }}>{t}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: TIER_COLORS[t], borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 46, textAlign: 'right', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.6)', fontSize: 13 }}>{n}</span>
                  <span style={{ width: 44, textAlign: 'right', color: more > 0 ? '#2ecc71' : 'var(--sd-fg-5, #555)', fontSize: 12 }}>{more > 0 ? `+${more}` : more < 0 ? more : ''}</span>
                </div>
              );
            })}
          </div>

          {/* This window was on a CSV an older version kept (its stand-in "You"):
              the map loads again from scratch to find your own profile, the one imported into. */}
          <Link href="/" style={primaryBtn} onClick={(e) => {
            if (userId !== CSV_USER.id) return;
            e.preventDefault();
            // A whole new load on purpose: UserProvider decides who "you" are once per load.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/';
          }}>See your galaxy →</Link>
          <p style={{ color: 'var(--sd-fg-5, #555)', fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
            In your network on this computer. Nothing was sent anywhere, and nobody was removed.
            {r.backup && <> Your network was backed up first ({r.backup.name}), in Settings &rarr; Your data.</>}
          </p>
        </div>
      </Shell>
    );
  }

  if (csv.step === 'preview' || csv.step === 'importing') {
    const p = csv.preview;
    const people = (p.counts?.add || 0) + (p.counts?.update || 0) + (p.counts?.promote || 0);
    const importing = csv.step === 'importing';
    return (
      <Shell>
        <div key="preview" style={{ maxWidth: 560, width: '100%' }} data-import="preview">
          <div style={{ fontSize: 13, color: 'var(--sd-fg-4, #666)', fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>READY TO IMPORT</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: '0 0 8px' }}>{p.fileName}</h1>
          <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', margin: '0 0 22px', lineHeight: 1.6 }}>
            {plural(Number(p.received) || 0, 'person', 'people')} in the file. This is what importing it adds to your network.
            Nothing has changed yet, and nobody already in it is removed.
          </p>
          <div style={{ ...card, marginBottom: 20 }}>
            <Lines of={p} />
          </div>
          <ErrorBox>{csv.error}</ErrorBox>
          <button type="button" onClick={csv.confirm} disabled={importing || people === 0} style={{ ...primaryBtn, width: '100%', border: 'none', cursor: importing ? 'progress' : 'pointer', font: 'inherit', fontWeight: 800, opacity: people === 0 ? 0.5 : 1 }}>
            {importing ? 'Importing…' : people === 0 ? 'Nothing new to import' : `Import ${plural(people, 'person', 'people')}`}
          </button>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button type="button" onClick={csv.again} disabled={importing} style={linkBtn}>Choose another file</button>
          </div>
        </div>
      </Shell>
    );
  }

  const reading = csv.step === 'reading';
  return (
    <Shell>
      {/* Each view keyed, so React never reuses one view's boxes for another's. */}
      <div key="pick" style={{ maxWidth: 620, width: '100%' }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 10px', letterSpacing: -1 }}>
          Map <span style={{ background: 'linear-gradient(135deg,#FFD700,#9B59B6,#3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>your</span> network
        </h1>
        <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', margin: '0 0 30px', lineHeight: 1.6, fontSize: 16 }}>
          Drop the official <code style={code}>Connections.csv</code> below. It is read on this computer, and the people in it
          are added to your network here and scored. You see what it adds before anything changes. No account, and nothing
          leaves this computer.
        </p>

        {behindScan && <BehindScan onRemoved={() => setBehindScan(null)} />}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); csv.choose(e.dataTransfer.files?.[0]); }}
          onClick={() => { if (!reading) inputRef.current?.click(); }}
          data-drop=""
          style={{
            ...card,
            padding: '48px 24px', textAlign: 'center', cursor: reading ? 'progress' : 'pointer', marginBottom: 16,
            // One shorthand: React warns when a shorthand and its parts change together.
            border: `1px dashed ${dragging ? '#FFD700' : 'rgba(var(--sd-ink, 255, 255, 255), 0.12)'}`,
            background: dragging ? 'rgba(255,215,0,0.05)' : card.background,
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
            {reading ? 'Reading…' : 'Drop Connections.csv here'}
          </div>
          <div style={{ color: 'var(--sd-fg-4, #666)', fontSize: 13 }}>or click to choose the file</div>
          <input
            ref={inputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { csv.choose(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        <ErrorBox>{csv.error}</ErrorBox>

        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-4, #666)', letterSpacing: 2, marginBottom: 14 }}>HOW TO GET THE FILE</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.6)', fontSize: 14, lineHeight: 2 }}>
            <li>On the platform: <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Settings &amp; Privacy → Data privacy → Get a copy of your data</strong></li>
            <li>Pick <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Connections</strong> and request the archive</li>
            <li>A download link arrives by email, usually within ~10 minutes</li>
            <li>Unzip it and drop <code style={code}>Connections.csv</code> above</li>
          </ol>
        </div>

        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71', letterSpacing: 2, marginBottom: 10 }}>PRIVATE BY DESIGN</div>
          <p style={{ margin: 0, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.55)', fontSize: 14, lineHeight: 1.7 }}>
            Your file never leaves this computer. It is read here, and only what the map needs (names, positions,
            companies, profile links and when you connected) goes into your network, on this computer. The{' '}
            <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Email Address column is ignored entirely</strong>. Importing
            again later adds anyone new and brings everyone else up to date; it never removes anyone.
          </p>
        </div>

        <div style={{ ...card, border: '1px solid rgba(255,215,0,0.15)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sd-gold, #FFD700)', letterSpacing: 2, marginBottom: 10 }}>HONEST CAVEAT</div>
          <p style={{ margin: '0 0 12px', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.55)', fontSize: 14, lineHeight: 1.7 }}>
            The export contains no profile photos, so everyone renders as initials on a tier-colored circle.
            It also only covers people you are <em>already</em> connected to, so <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Degrees</strong> and
            the <strong style={{ color: 'var(--sd-fg-1, #fff)' }}>Outlink queue</strong> stay empty, because those map the people you
            haven&rsquo;t met yet. A person with no profile link in the file is left out, and the import says how many.
          </p>
          <p style={{ margin: 0, color: 'var(--sd-fg-4, #666)', fontSize: 13, lineHeight: 1.7 }}>
            Want those? The optional scanner adds 2nd-degree circles and real photos. It runs your own account
            automatically, and the platform may restrict accounts that do this.{' '}
            <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>See setup →</Link>
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <Link href="/" style={{ color: 'var(--sd-fg-5, #555)', fontSize: 13, textDecoration: 'none' }}>← Back</Link>
        </div>
      </div>
    </Shell>
  );
}

// A CSV an older version kept here that the map doesn't show: your scan wins
// (lib/csv.js openNetworkSource). The start moves such a file into your
// network; one still here couldn't be moved (the server's log says why), and
// it's never deleted for you, so this says it's there and offers to remove it.
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

const page = {
  minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)',
};

// Room at the top for the notch.
const wrap = {
  padding: '64px 24px 56px', display: 'flex', justifyContent: 'center',
};

const code = {
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', padding: '2px 6px', borderRadius: 5,
  fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13,
  color: 'var(--sd-fg-4, #888)', textDecoration: 'underline', textUnderlineOffset: 3,
};

const primaryBtn = {
  display: 'block', textAlign: 'center', padding: '15px 20px', borderRadius: 12,
  background: 'linear-gradient(135deg,#FFD700,#9B59B6)', color: '#0a0a1a',
  fontWeight: 800, fontSize: 15, textDecoration: 'none',
};
