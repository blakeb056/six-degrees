'use client';

import { useEffect, useState } from 'react';
import { loadNetwork } from '../../lib/network';
import { IS_DEMO } from '../../lib/demo';
import { hasCsvNetwork, loadCsvNetwork } from '../../lib/csv';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';
import Link from 'next/link';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };

// Merge company name variants
function normalizeCompany(name) {
  const n = (name || '').trim().toLowerCase();
  // Social / Media
  if (n.includes('snap') && (n.includes('inc') || n === 'snap' || n === 'snapchat')) return 'Snap';
  if (n.includes('meta') && (n.includes('platform') || n === 'meta' || n.includes('facebook'))) return 'Meta';
  if (n.includes('tiktok') || n.includes('bytedance')) return 'TikTok';
  if (n.includes('pinterest')) return 'Pinterest';
  // Big Tech
  if (n === 'google' || n.includes('alphabet') || (n.includes('google') && n.includes('llc'))) return 'Google';
  if (n === 'apple' || n === 'apple inc' || n === 'apple inc.') return 'Apple';
  if (n.includes('amazon') && !n.includes('amazon ')) return 'Amazon';
  if (n.includes('microsoft')) return 'Microsoft';
  // AI
  if (n.includes('anthropic')) return 'Anthropic';
  if (n.includes('openai') || n === 'open ai') return 'OpenAI';
  if (n.includes('deepmind')) return 'DeepMind';
  if (n.includes('cohere')) return 'Cohere';
  if (n.includes('mistral')) return 'Mistral';
  if (n.includes('hugging') && n.includes('face')) return 'Hugging Face';
  // Fintech / Crypto
  if (n.includes('stripe')) return 'Stripe';
  if (n.includes('coinbase')) return 'Coinbase';
  if (n.includes('polymarket')) return 'Polymarket';
  if (n.includes('blackrock')) return 'BlackRock';
  if (n.includes('robinhood')) return 'Robinhood';
  // Growth / Commerce
  if (n.includes('whatnot')) return 'Whatnot';
  if (n.includes('shopify')) return 'Shopify';
  if (n.includes('palantir')) return 'Palantir';
  if (n.includes('anduril')) return 'Anduril';
  if (n.includes('netflix')) return 'Netflix';
  if (n.includes('spotify')) return 'Spotify';
  if (n.includes('tesla')) return 'Tesla';
  if (n.includes('spacex')) return 'SpaceX';
  if (n.includes('nvidia')) return 'NVIDIA';
  // Defense / Aerospace
  if (n.includes('lockheed')) return 'Lockheed Martin';
  if (n.includes('northrop')) return 'Northrop Grumman';
  if (n.includes('boeing')) return 'Boeing';
  if (n.includes('l3harris') || n.includes('l3 harris')) return 'L3Harris';
  if (n.includes('leidos')) return 'Leidos';
  if (n.includes('nasa')) return 'NASA';
  if (n.includes('sandia')) return 'Sandia National Labs';
  if (n.includes('blue origin')) return 'Blue Origin';
  if (n.includes('raytheon')) return 'Raytheon';
  if (n.includes('general dynamics')) return 'General Dynamics';
  if (n.includes('bae systems')) return 'BAE Systems';
  // Finance
  if (n.includes('goldman')) return 'Goldman Sachs';
  if (n.includes('jpmorgan') || n.includes('jp morgan')) return 'JPMorgan Chase';
  if (n.includes('wells fargo')) return 'Wells Fargo';
  if (n.includes('citi') && !n.includes('citizen')) return 'Citi';
  if (n.includes('mastercard')) return 'Mastercard';
  if (n.includes('visa') && n.length < 15) return 'Visa';
  if (n.includes('paypal')) return 'PayPal';
  if (n.includes('bny') || n.includes('bank of new york') || n.includes('mellon')) return 'BNY Mellon';
  if (n.includes('deloitte')) return 'Deloitte';
  if (n.includes('bain')) return 'Bain & Company';
  if (n.includes('bloomberg')) return 'Bloomberg';
  if (n.includes('usaa')) return 'USAA';
  if (n.includes('navy federal')) return 'Navy Federal';
  if (n.includes('raymond james')) return 'Raymond James';
  if (n.includes('geico')) return 'GEICO';
  // Enterprise / Industrial
  if (n.includes('oracle')) return 'Oracle';
  if (n.includes('ibm')) return 'IBM';
  if (n.includes('servicenow')) return 'ServiceNow';
  if (n.includes('siemens')) return 'Siemens';
  if (n.includes('texas instruments')) return 'Texas Instruments';
  if (n.includes('qualcomm')) return 'Qualcomm';
  if (n.includes('databricks')) return 'Databricks';
  if (n.includes('together.ai') || n.includes('together ai')) return 'Together AI';
  if (n.includes('zoox')) return 'Zoox';
  // Entertainment
  if (n.includes('nbcuniversal') || n.includes('nbc universal')) return 'NBCUniversal';
  if (n.includes('universal destinations')) return 'Universal Destinations';
  // Other
  if (n.includes('humana')) return 'Humana';
  if (n.includes('booz allen')) return 'Booz Allen Hamilton';
  if (n.includes('abbott')) return 'Abbott';
  if (n.includes('walmart')) return 'Walmart';
  if (n.includes('publix')) return 'Publix';
  if (n.includes('mitsubishi')) return 'Mitsubishi Power';
  if (n.includes('oscar health')) return 'Oscar Health';
  if (n.includes('ford') && n.length < 15) return 'Ford';
  if (n.includes('coca') && n.includes('cola')) return 'Coca-Cola';
  if (n.includes('nike')) return 'Nike';
  if (n.includes('disney')) return 'Disney';
  if (n.includes('ucf') || n.includes('university of central florida')) return 'UCF';
  return (name || '').trim();
}

const SENIORITY_LEVELS = [
  { key: 'csuite', label: 'C-Suite', match: /ceo|chief|founder|president|chairman|co-founder/i, level: 6 },
  { key: 'vp', label: 'VP / SVP', match: /\bvp\b|vice president|svp|evp|managing director/i, level: 5 },
  { key: 'director', label: 'Director / Head', match: /director|head of|senior director/i, level: 4 },
  { key: 'manager', label: 'Manager / Lead', match: /manager|lead|principal|staff/i, level: 3 },
  { key: 'senior', label: 'Senior IC', match: /senior|sr\.|sr /i, level: 2 },
  { key: 'ic', label: 'IC / Entry', match: /./, level: 1 },
];

function getSeniority(headline) {
  const h = (headline || '').toLowerCase();
  if (h.match(/intern|student|aspiring/i)) return { key: 'intern', label: 'Intern / Student', level: 0 };
  for (const s of SENIORITY_LEVELS) if (s.match.test(h)) return s;
  return { key: 'ic', label: 'IC / Entry', level: 1 };
}

export default function PathsPage() {
  return <OnboardingGate><PathsInner /></OnboardingGate>;
}

function PathsInner() {
  const { userId } = useUser();
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companyPeople, setCompanyPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [d1Data, setD1Data] = useState([]);
  const [d2Data, setD2Data] = useState([]);

  useEffect(() => {
    if (IS_DEMO) return;
    if (!userId) return;
    async function load() {
      // A CSV import is 1st-degree only and lives in this tab, not the database.
      const csv = hasCsvNetwork() ? loadCsvNetwork() : null;
      let d1 = [], d2 = [], d3 = [];
      if (csv) {
        d1 = csv.degree1;
      } else {
        const net = await loadNetwork(userId);
        d1 = net.degree1;
        d2 = net.degree2;
        d3 = net.degree3;
      }
      setD1Data(d1);
      setD2Data(d2);

      // Build company index from ALL connections (including company scans)
      const companyMap = {};
      const seenUrls = new Set();
      [...d1, ...d2, ...d3].forEach(c => {
        // Deduplicate by profile URL (same person might be in d1, d2, and d3)
        if (seenUrls.has(c.profile_url)) return;
        seenUrls.add(c.profile_url);

        const hl = c.headline || '';
        const companyFromHeadline = hl.split(/ at | @ /)?.[1]?.split(/[|,]/)?.[0]?.trim();
        const co = normalizeCompany(c.scanned_company || c.company || companyFromHeadline);
        if (!co || co.length < 2) return;
        if (!companyMap[co]) companyMap[co] = { name: co, d1: 0, d2: 0, d3: 0, sCount: 0, aCount: 0, people: [] };
        if (c.degree === 1) companyMap[co].d1++;
        else if (c.degree === 2) companyMap[co].d2++;
        else companyMap[co].d3++;
        if (c.tier === 'S') companyMap[co].sCount++;
        if (c.tier === 'A') companyMap[co].aCount++;
        companyMap[co].people.push(c);
      });

      const sorted = Object.values(companyMap)
        .filter(c => c.d1 + c.d2 + c.d3 >= 3)
        .sort((a, b) => (b.sCount * 3 + b.aCount * 2 + b.d1 + b.d2 + b.d3) - (a.sCount * 3 + a.aCount * 2 + a.d1 + a.d2 + a.d3));
      setCompanies(sorted);
      setLoading(false);
    }
    load();
  }, [userId]);

  const [scanning, setScanning] = useState(false);
  const [scanLog, setScanLog] = useState([]);

  function enrichPeople(people) {
    const d1Urls = new Set(d1Data.map(c => c.profile_url));
    const knownUrls = new Set([...d1Data, ...d2Data].map(c => c.profile_url));
    return people.map(p => ({
      ...p,
      connected: d1Urls.has(p.profile_url || p.profileUrl),
      known: knownUrls.has(p.profile_url || p.profileUrl),
      seniority: getSeniority(p.headline),
      mutualCount: people.filter(op => d1Urls.has(op.profile_url || op.profileUrl) && op.id !== p.id).length,
    }));
  }

  function selectCompany(co) {
    setSelectedCompany(co);
    setCompanyPeople(enrichPeople(co.people));
  }

  async function scanFullCompany() {
    if (IS_DEMO) return;
    if (!selectedCompany) return;
    setScanning(true);
    setScanLog(['Checking scraper server...']);

    try {
      const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
      if (!(await ping.json()).ok) throw new Error();
    } catch {
      setScanLog(['Scraper offline — start it first']);
      setScanning(false);
      return;
    }

    setScanLog([`Scanning "${selectedCompany.name}" on LinkedIn...`]);
    try {
      await fetch('http://localhost:5555/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'company', company: selectedCompany.name, userId }),
      });

      const poll = setInterval(async () => {
        try {
          const r = await fetch('http://localhost:5555/status');
          const d = await r.json();
          setScanLog(d.log || []);
          if (!d.running && d.result) {
            clearInterval(poll);
            if (d.result.people && d.result.people.length > 0) {
              const scrapedPeople = d.result.people;

              // Push to database via API (belt-and-suspenders — scraper may also push)
              setScanLog(prev => [...prev, `Saving ${scrapedPeople.length} people to database...`]);
              try {
                const pushResp = await fetch('/api/ingest', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    connections: scrapedPeople.map(p => ({
                      name: p.name,
                      headline: p.headline,
                      profileUrl: p.profileUrl,
                      imageUrl: p.imageUrl || '',
                    })),
                    type: 'company',
                    companyName: selectedCompany.name,
                    userId: userId,
                  }),
                });
                const pushResult = await pushResp.json();
                setScanLog(prev => [...prev, `Saved to database ✓ (${pushResult.processed || 0} processed)`]);

                // Also push images
                const images = scrapedPeople
                  .filter(p => p.imageUrl && p.profileUrl)
                  .map(p => ({ profileUrl: p.profileUrl, imageUrl: p.imageUrl }));
                if (images.length > 0) {
                  await fetch('/api/update-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ images }),
                  });
                }
              } catch (pushErr) {
                setScanLog(prev => [...prev, `DB save error: ${pushErr.message}`]);
              }

              // Merge into UI state
              const existingUrls = new Set(companyPeople.map(p => p.profile_url || p.profileUrl));
              const newPeople = scrapedPeople
                .filter(p => !existingUrls.has(p.profileUrl))
                .map(p => ({ ...p, profile_url: p.profileUrl, degree: 3, source: 'scraped' }));

              const merged = [...companyPeople, ...enrichPeople(newPeople)];
              setCompanyPeople(merged);
              setScanLog(prev => [...prev, `Added ${newPeople.length} new people to view`]);
            }
            setScanning(false);
          }
        } catch {}
      }, 2000);
    } catch {
      setScanLog(['Failed to start scan']);
      setScanning(false);
    }
  }

  // Build hierarchy for selected company
  const hierarchy = {};
  let connectedCount = 0;
  companyPeople.forEach(p => {
    const key = p.seniority.key;
    if (!hierarchy[key]) hierarchy[key] = { ...p.seniority, people: [] };
    if (p.connected) connectedCount++;

    // Likelihood: more mutuals + lower seniority = higher
    let likelihood = Math.min(90, p.mutualCount * 12);
    if (p.seniority.level <= 1) likelihood += 20;
    else if (p.seniority.level <= 2) likelihood += 10;
    else if (p.seniority.level >= 5) likelihood -= 10;
    likelihood = Math.max(5, Math.min(95, likelihood));
    if (p.connected) likelihood = 100;

    // Find the bridge path for degree-2 people
    let bridgeName = null;
    if (p.degree === 2 && p.source_connection_id) {
      const bridge = d1Data.find(d => d.id === p.source_connection_id);
      if (bridge) bridgeName = bridge.name;
    }

    // XP based on seniority level — higher position = more XP
    const xpByLevel = { 0: 5, 1: 10, 2: 20, 3: 35, 4: 50, 5: 75, 6: 100 };
    const xp = xpByLevel[p.seniority.level] || 10;

    hierarchy[key].people.push({ ...p, likelihood, bridgeName, xp });
  });

  Object.values(hierarchy).forEach(h => h.people.sort((a, b) => b.likelihood - a.likelihood));
  const sortedLevels = Object.values(hierarchy).sort((a, b) => b.level - a.level);

  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, background: '#0a0a1a', color: 'rgba(255,255,255,0.7)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#fff' }}>Not part of the demo</h1>
        <p style={{ fontSize: 13, margin: 0 }}>The public demo includes the Network Circle and Bridges views only.</p>
        <Link href="/" style={{ fontSize: 13, color: '#888', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>Loading...</div>;
  }

  return (
    <div style={{
      height: '100vh', background: '#0a0a1a', color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <header style={{ padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{
            display: 'flex', alignItems: 'center', gap: 6, color: '#888', textDecoration: 'none',
            fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          }}><span style={{ fontSize: 16 }}>&larr;</span> Map</Link>
          <h1 style={{
            fontSize: 20, fontWeight: 700, margin: 0,
            background: 'linear-gradient(135deg, #00ff88, #3498DB)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Paths</h1>
          {selectedCompany && (
            <>
              <button onClick={() => { setSelectedCompany(null); setCompanyPeople([]); }}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12 }}>
                ← Companies
              </button>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedCompany.name}</span>
              <span style={{ fontSize: 11, color: '#888' }}>
                {connectedCount}/{companyPeople.length} connected
              </span>
              <button onClick={scanFullCompany} disabled={scanning}
                style={{
                  marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: 'none', cursor: scanning ? 'not-allowed' : 'pointer',
                  background: scanning ? '#333' : 'rgba(0,255,136,0.15)', color: scanning ? '#555' : '#00ff88',
                  fontSize: 11, fontWeight: 600,
                }}>
                {scanning ? 'Scanning...' : '+ Scan Full Company'}
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>

          {/* Company selection grid */}
          {!selectedCompany && (
            <>
              <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
                Pick a company to see your path to the top. Based on {d1Data.length + d2Data.length} people in your network.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {companies.slice(0, 20).map(co => (
                  <button key={co.name} onClick={() => selectCompany(co)} style={{
                    padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: 'rgba(255,255,255,0.04)', transition: 'background 0.15s',
                    borderLeft: `3px solid ${co.sCount > 0 ? '#FFD700' : co.aCount > 0 ? '#9B59B6' : '#3498DB'}`,
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{co.name}</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#888' }}>
                      <span style={{ color: '#00ff88' }}>{co.d1} connected</span>
                      <span>{co.d2 + co.d3} locked</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 9 }}>
                      {co.sCount > 0 && <span style={{ color: '#FFD700', fontWeight: 600 }}>{co.sCount}S</span>}
                      {co.aCount > 0 && <span style={{ color: '#9B59B6', fontWeight: 600 }}>{co.aCount}A</span>}
                      <span style={{ color: '#555' }}>{co.d1 + co.d2} total</span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 6 }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${(co.d1 / Math.max(co.d1 + co.d2 + co.d3, 1)) * 100}%`,
                        background: co.sCount > 0 ? '#FFD700' : '#00ff88',
                      }} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Scan progress */}
          {scanning && (
            <div style={{
              padding: '10px', borderRadius: 8, background: 'rgba(0,255,136,0.06)',
              border: '1px solid rgba(0,255,136,0.2)', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff88', animation: 'pulse 1s infinite' }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: '#00ff88' }}>Scanning LinkedIn...</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#777', maxHeight: 60, overflow: 'auto' }}>
                {scanLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          )}

          {/* Hierarchy tree */}
          {selectedCompany && sortedLevels.map(level => (
            <div key={level.key} style={{ marginBottom: 16 }}>
              <div style={{
                padding: '8px 12px', borderRadius: 6, marginBottom: 4,
                background: level.level >= 5 ? 'rgba(255,215,0,0.08)' : level.level >= 3 ? 'rgba(155,89,182,0.08)' : 'rgba(52,152,219,0.08)',
                borderLeft: `3px solid ${level.level >= 5 ? '#FFD700' : level.level >= 3 ? '#9B59B6' : '#3498DB'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: level.level >= 5 ? '#FFD700' : level.level >= 3 ? '#9B59B6' : '#3498DB',
                  }}>{level.label}</span>
                  {level.level >= 5 && <span style={{ fontSize: 9, color: '#FF6B35', marginLeft: 8, fontWeight: 700 }}>TARGET</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: '#FF6B35', fontWeight: 600 }}>
                    +{level.people.filter(p => !p.connected).reduce((s, p) => s + (p.xp || 0), 0)} XP
                  </span>
                  <span style={{ fontSize: 10, color: '#666' }}>
                    {level.people.filter(p => p.connected).length}/{level.people.length}
                  </span>
                </div>
              </div>

              {level.people.map((p, pi) => (
                <PathPersonRow key={p.id || pi} p={p} level={level} companyPeople={companyPeople} d1Data={d1Data} selectedCompany={selectedCompany} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PathPersonRow({ p, level, companyPeople, d1Data, selectedCompany }) {
  const [expanded, setExpanded] = useState(false);

  // Calculate strategic insights
  const d1Urls = new Set(d1Data.map(c => c.profile_url));
  const connectedAtCompany = companyPeople.filter(op => d1Urls.has(op.profile_url || op.profileUrl));
  const aboveMe = companyPeople.filter(op => {
    const s = getSeniority(op.headline);
    return s.level > p.seniority.level && !d1Urls.has(op.profile_url || op.profileUrl);
  });
  const sameLevel = companyPeople.filter(op => {
    const s = getSeniority(op.headline);
    return s.level === p.seniority.level && op.id !== p.id;
  });

  // What happens if you add this person
  const unlockInsights = [];
  if (!p.connected) {
    // How many people above would gain a mutual
    const aboveCount = aboveMe.length;
    if (aboveCount > 0) {
      unlockInsights.push({ icon: '⬆️', text: `Adding them gives you a mutual with ${aboveCount} people above in the hierarchy`, color: '#00ff88' });
    }

    // Same level connections help with social proof
    const sameLevelConnected = sameLevel.filter(op => d1Urls.has(op.profile_url || op.profileUrl)).length;
    if (sameLevelConnected > 0) {
      unlockInsights.push({ icon: '🤝', text: `${sameLevelConnected} people at their level already connected — high social proof`, color: '#FFD700' });
    } else {
      unlockInsights.push({ icon: '🎯', text: `First connection at this level — opens a new layer`, color: '#3498DB' });
    }

    // Bridge path value
    if (p.bridgeName) {
      unlockInsights.push({ icon: '🔗', text: `Reachable through ${p.bridgeName} — warm intro possible`, color: '#FF6B35' });
    }

    // Role-specific value
    if (p.seniority.level >= 5) {
      unlockInsights.push({ icon: '👑', text: `${p.seniority.label} — decision maker, high strategic value but low accept rate`, color: '#FFD700' });
    } else if (p.seniority.level >= 3) {
      unlockInsights.push({ icon: '📊', text: `${p.seniority.label} — middle management, good balance of access and accept rate`, color: '#9B59B6' });
    } else {
      unlockInsights.push({ icon: '✅', text: `${p.seniority.label} — highest accept rate, builds mutual foundation for people above`, color: '#00ff88' });
    }

    // Likelihood explanation
    if (p.likelihood >= 60) {
      unlockInsights.push({ icon: '🔥', text: `${p.likelihood}% likely to accept — strong mutual overlap + approachable role`, color: '#00ff88' });
    } else if (p.likelihood >= 30) {
      unlockInsights.push({ icon: '⚡', text: `${p.likelihood}% likely — moderate chance, add more people at their level first`, color: '#FFD700' });
    } else {
      unlockInsights.push({ icon: '🔒', text: `${p.likelihood}% likely — low chance right now, build more connections below them first`, color: '#ff5050' });
    }
  }

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      {/* Main row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          cursor: 'pointer', opacity: p.connected ? 0.7 : 1,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Expand arrow */}
        <span style={{ fontSize: 8, color: '#555', flexShrink: 0, width: 10 }}>
          {expanded ? '▾' : '▸'}
        </span>

        {/* Connected indicator */}
        <div style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0, fontSize: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: p.connected ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.05)',
          color: p.connected ? '#00ff88' : '#555',
          border: `1px solid ${p.connected ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>{p.connected ? '✓' : '🔒'}</div>

        {/* Photo */}
        {(p.profile_image_url || p.imageUrl) ? (
          <img src={p.profile_image_url || p.imageUrl} alt="" style={{
            width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
          }} onError={e => e.target.style.display = 'none'} />
        ) : (
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0, fontSize: 10, fontWeight: 700,
            background: '#333', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{p.name?.charAt(0)}</div>
        )}

        {/* Name + headline */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
          <div style={{ fontSize: 8, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.headline?.substring(0, 45)}
          </div>
        </div>

        {/* Bridge */}
        {!p.connected && p.bridgeName && (
          <span style={{ fontSize: 8, color: '#FF6B35', flexShrink: 0, maxWidth: 55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            via {p.bridgeName.split(' ')[0]}
          </span>
        )}

        {/* XP + Likelihood */}
        {!p.connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: '#FF6B35' }}>+{p.xp}</span>
            <div style={{
              fontSize: 9, fontWeight: 700, minWidth: 30, textAlign: 'right',
              color: p.likelihood >= 60 ? '#00ff88' : p.likelihood >= 30 ? '#FFD700' : '#ff5050',
            }}>{p.likelihood}%</div>
          </div>
        )}

        {/* Add button */}
        {!p.connected && (
          <a href={p.profile_url || p.profileUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            style={{
              padding: '3px 7px', borderRadius: 4, fontSize: 8, fontWeight: 700,
              background: '#0077B5', color: '#fff', textDecoration: 'none', flexShrink: 0,
            }}>Add</a>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          padding: '8px 12px 10px 44px',
          background: 'rgba(255,255,255,0.02)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          {/* Full role */}
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>
            {p.headline || 'No headline available'}
          </div>

          {/* Position level + XP */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
              background: p.seniority.level >= 5 ? 'rgba(255,215,0,0.1)' : p.seniority.level >= 3 ? 'rgba(155,89,182,0.1)' : 'rgba(52,152,219,0.1)',
              color: p.seniority.level >= 5 ? '#FFD700' : p.seniority.level >= 3 ? '#9B59B6' : '#3498DB',
              border: `1px solid ${p.seniority.level >= 5 ? 'rgba(255,215,0,0.2)' : p.seniority.level >= 3 ? 'rgba(155,89,182,0.2)' : 'rgba(52,152,219,0.2)'}`,
            }}>
              {p.seniority.label} · Level {p.seniority.level}
            </div>
            {!p.connected && (
              <div style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                background: 'rgba(255,107,53,0.1)', color: '#FF6B35',
                border: '1px solid rgba(255,107,53,0.2)',
              }}>
                +{p.xp} XP
              </div>
            )}
          </div>

          {/* Strategic insights */}
          {!p.connected && unlockInsights.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: 0.5, marginBottom: 4 }}>
                STRATEGIC VALUE
              </div>
              {unlockInsights.map((ins, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '2px 0', fontSize: 10, color: '#bbb' }}>
                  <span style={{ fontSize: 11, lineHeight: 1 }}>{ins.icon}</span>
                  <span style={{ color: ins.color }}>{ins.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Connected state */}
          {p.connected && (
            <div style={{ fontSize: 10, color: '#00ff88', fontWeight: 600 }}>
              ✓ Already connected — contributes as mutual for others at {selectedCompany?.name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
