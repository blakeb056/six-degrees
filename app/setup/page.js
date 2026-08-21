'use client';

import { useState, useEffect, useCallback } from 'react';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';

const SCRAPER_URL = 'http://localhost:5555';

export default function SetupPage() {
  return <OnboardingGate><SetupInner /></OnboardingGate>;
}

function SetupInner() {
  const { userId, userName } = useUser();
  const [copied, setCopied] = useState(null);
  const [serverOnline, setServerOnline] = useState(false);

  const checkServer = useCallback(async () => {
    try {
      const r = await fetch(`${SCRAPER_URL}/ping`, { signal: AbortSignal.timeout(2000) });
      const data = await r.json();
      setServerOnline(data.ok === true);
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    checkServer();
    const interval = setInterval(checkServer, 3000);
    return () => clearInterval(interval);
  }, [checkServer]);

  function copyCmd(cmd, label) {
    navigator.clipboard.writeText(cmd);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div style={{
      height: '100vh', background: '#0a0a1a', color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <header style={{
        padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
      }}>
        <a href="/" style={{
          display: 'flex', alignItems: 'center', gap: 6, color: '#888', textDecoration: 'none',
          fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ fontSize: 16 }}>&larr;</span> Back to Map
        </a>
        <h1 style={{
          fontSize: 22, fontWeight: 700, margin: 0,
          background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Setup</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: serverOnline ? '#00ff88' : '#ff5050',
            boxShadow: serverOnline ? '0 0 6px #00ff88' : 'none',
          }} />
          <span style={{ fontSize: 11, color: serverOnline ? '#00ff88' : '#ff5050' }}>
            {serverOnline ? 'Scraper Online' : 'Scraper Offline'}
          </span>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 60px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>

          {/* Step 1: Install */}
          {/* Account info */}
          <div style={{
            background: 'rgba(255,215,0,0.06)', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
            border: '1px solid rgba(255,215,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#FFD700' }}>{userName || 'User'}</div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>Logged in</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Your ID</div>
              <div
                onClick={() => copyCmd(userId, 'uid')}
                style={{
                  fontFamily: 'monospace', fontSize: 10, color: '#888', cursor: 'pointer',
                  padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                }}
                title="Click to copy"
              >
                {copied === 'uid' ? 'Copied!' : (userId?.substring(0, 18) + '...')}
              </div>
            </div>
          </div>

          <Section title="1. Install (one time)" collapsed>
            <div style={{
              background: 'rgba(52,152,219,0.08)', borderRadius: 8, padding: '12px 14px', marginBottom: 14,
              border: '1px solid rgba(52,152,219,0.2)', fontSize: 13, color: '#3498DB',
            }}>
              <strong>How to open Terminal:</strong> Press <strong>Cmd+Space</strong>, type <strong>Terminal</strong>, hit <strong>Enter</strong>.
            </div>
            <OsTabs>
              {(os) => os === 'mac' ? (
                <>
                  <CopyBlock cmd="pip3 install playwright requests" label="pip" copied={copied} onCopy={copyCmd} />
                  <CopyBlock cmd="python3 -m playwright install chromium" label="chromium" copied={copied} onCopy={copyCmd} />
                </>
              ) : (
                <>
                  <CopyBlock cmd="pip install playwright requests" label="pip" copied={copied} onCopy={copyCmd} />
                  <CopyBlock cmd="python -m playwright install chromium" label="chromium" copied={copied} onCopy={copyCmd} />
                </>
              )}
            </OsTabs>
          </Section>

          {/* Step 2: Start Server */}
          <Section title="2. Start Scraper">
            <p style={{ color: '#aaa', fontSize: 13, marginBottom: 10 }}>
              Double-click <strong>Start Scraper.command</strong> on your Desktop, or run:
            </p>
            <OsTabs>
              {(os) => (
                <CopyBlock
                  cmd={os === 'mac' ? "cd ~/six-degrees-linkedin && python3 scripts/scrape.py --server" : "cd six-degrees-linkedin && python scripts/scrape.py --server"}
                  label="server"
                  copied={copied}
                  onCopy={copyCmd}
                />
              )}
            </OsTabs>
            <p style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
              Once the server is running, use the buttons in the app:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#aaa' }}>
                <span style={{ color: '#3498DB' }}>Profile →</span> Set Up Account (first-time full scrape)
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#aaa' }}>
                <span style={{ color: '#9B59B6' }}>Profile →</span> Auto-Bridge All (map every cluster)
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#aaa' }}>
                <span style={{ color: '#FFD700' }}>Header →</span> ↻ Refresh (check for new connections + bridges)
              </div>
            </div>
          </Section>

          <div style={{
            background: 'rgba(255,215,0,0.04)', borderRadius: 10, padding: 20, marginTop: 16,
            border: '1px solid rgba(255,215,0,0.15)', fontSize: 12, color: '#666',
          }}>
            <strong style={{ color: '#FFD700' }}>Privacy:</strong> Uses your Chrome session. Only reads YOUR connections. All data stays in your database.
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 16,
      border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '14px 20px', background: 'none', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: '#fff',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
        <span style={{ color: '#555', fontSize: 18 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  );
}

function OsTabs({ children }) {
  const [os, setOs] = useState(() => {
    if (typeof navigator !== 'undefined' && navigator.platform) {
      return navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'windows';
    }
    return 'mac';
  });
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {['mac', 'windows'].map(o => (
          <button key={o} onClick={() => setOs(o)} style={{
            padding: '3px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
            background: os === o ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
            color: os === o ? '#fff' : '#555', textTransform: 'capitalize',
          }}>{o}</button>
        ))}
      </div>
      {children(os)}
    </div>
  );
}

function CopyBlock({ cmd, label, copied, onCopy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      background: 'rgba(0,0,0,0.4)', borderRadius: 6, padding: '8px 12px',
      fontFamily: 'monospace', fontSize: 12,
    }}>
      <code style={{ flex: 1, color: '#3498DB', wordBreak: 'break-all' }}>{cmd}</code>
      <button onClick={() => onCopy(cmd, label)} style={{
        padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
        background: copied === label ? '#00ff88' : 'rgba(255,255,255,0.12)',
        color: copied === label ? '#000' : '#fff', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      }}>{copied === label ? 'Copied!' : 'Copy'}</button>
    </div>
  );
}
