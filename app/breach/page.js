'use client';

// Breach (Blake, 2026-10-15): "a breach mode ... to breach open sectors and
// companies, getting their foot in the door, having mutuals to build your way
// up to the top of the company". Pick a company, map its people in small
// rounds, add the likeliest doors first (by hand: the profile opens and you
// press Connect), and watch the breach climb as acceptances give everyone
// else there a mutual. Companies for now; sectors later.
//
// Everything is worked out in lib/breach.js from data already saved: scans,
// "Check for new" and the request-sent marks. Nothing here polls LinkedIn or
// sends a request.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppHeader from '../components/AppHeader';
import OnboardingGate from '../components/OnboardingGate';
import OpenProfile from '../components/OpenProfile';
import InlineNote, { useFadingNote } from '../components/InlineNote';
import BreachOrb, { BreachMeter, Milestones, BAND_COLORS } from '../components/BreachOrb';
import useNotchTabs from '../components/useNotchTabs';
import useRequests from '../components/useRequests';
import useScanner, { useScanShows, useCircleMode } from '../components/useScanner';
import { useUser } from '../components/UserProvider';
import { loadNetwork } from '../../lib/network';
import { loadCsvNetwork } from '../../lib/csv';
import { IS_DEMO } from '../../lib/demo';
import { localPhoto } from '../../lib/photos';
import { saveSettings } from '../../lib/settings-client';
import { hasRequest, markRequested, undoRequest } from '../../lib/requests-client';
import { runScrape, scraperStatus, notReadyMessage, busyReason, startHere } from '../../lib/scraper-client';
import {
  BANDS, BREACH_WEEKLY, BREACH_ROUNDS, BREACH_ROUND, BREACH_DEGREES, BREACH_DEGREES_DEFAULT,
  breachPeople, breachScore, weeklyPlan, acceptances, compareCompanies, breachKey, mapSpread,
  companyName, companyKey, homeCity,
} from '../../lib/breach';

const TABS = [['company', 'Company'], ['companies', 'Companies']];
const DEGREE_WORDS = { 1: '1st', 2: '2nd', 3: '3rd+' };
const NO_BREACH = { targets: [], city: '', school: '' };

const PANEL = {
  padding: 16, borderRadius: 12, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.035)',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
};
const H2 = { fontSize: 13, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--sd-fg-2, #ccc)', margin: '0 0 10px' };
const SMALL = { fontSize: 12, color: 'var(--sd-fg-3, #888)', lineHeight: 1.5 };
const BUTTON = {
  padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
  background: 'rgba(0,255,136,0.15)', color: 'var(--sd-green, #00ff88)',
};
const QUIET = {
  padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'transparent',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)', color: 'var(--sd-fg-2, #ccc)',
};
const INPUT = {
  padding: '7px 10px', borderRadius: 8, fontSize: 13, minWidth: 0,
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: 'var(--sd-fg-1, #fff)',
};

export default function BreachPage() {
  // Suspense because the page reads ?company= (useSearchParams).
  return <OnboardingGate><Suspense><BreachInner /></Suspense></OnboardingGate>;
}

function BreachInner() {
  const { userId } = useUser();
  const asked = useSearchParams().get('company');
  const [network, setNetwork] = useState(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [settings, setSettings] = useState(NO_BREACH);
  const [notes, setNotes] = useState({});
  const [linkedin, setLinkedin] = useState(null);
  const [company, setCompany] = useState(() => companyName(asked) || '');
  const [tab, setTab] = useState('company');
  const [reload, setReload] = useState(0);
  const requests = useRequests();

  useNotchTabs(useMemo(() => ({ items: TABS.map(([key, label]) => ({ key, label })), current: tab, onPick: setTab }), [tab]));

  useEffect(() => {
    if (IS_DEMO || !userId) return;
    let gone = false;
    (async () => {
      const csv = await loadCsvNetwork().catch(() => null);
      if (gone) return;
      if (csv) { setLocalOnly(true); setNetwork({ degree1: csv.degree1 || [], degree2: csv.degree2 || [], degree3: [] }); return; }
      const net = await loadNetwork(userId).catch(() => ({ degree1: [], degree2: [], degree3: [] }));
      if (!gone) setNetwork(net);
    })();
    return () => { gone = true; };
  }, [userId, reload]);

  // The breach choices (lib/settings.js), and how far each company's search got (the scanner's notes).
  useEffect(() => {
    if (IS_DEMO) return;
    fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      const b = d?.settings?.breach || NO_BREACH;
      setSettings(b);
      setCompany((now) => now || b.targets?.[0] || '');
    }).catch(() => {});
  }, []);
  const lookAgain = useCallback(() => {
    scraperStatus().then((s) => { setNotes(s?.breach || {}); setLinkedin(s?.linkedin || null); }).catch(() => {});
  }, []);
  useEffect(() => { if (!IS_DEMO) lookAgain(); }, [lookAgain, reload]);

  const save = useCallback(async (next) => {
    setSettings(next);
    const { settings: saved } = await saveSettings({ breach: next });
    if (saved?.breach) setSettings(saved.breach);
  }, []);

  const guessedCity = useMemo(() => homeCity(network?.degree1 || []), [network]);
  const you = useMemo(() => ({ city: settings.city || guessedCity, school: settings.school }), [settings.city, settings.school, guessedCity]);
  const asks = useCallback((row) => hasRequest(row, requests), [requests]);

  const companies = useMemo(() => (network ? compareCompanies(network, { targets: settings.targets, you, hasRequest: asks }) : []),
    [network, settings.targets, you, asks]);

  function pick(name) {
    const clean = companyName(name);
    if (!clean) return;
    setCompany(clean);
    setTab('company');
    if (!settings.targets.some((t) => companyKey(t) === companyKey(clean))) {
      save({ ...settings, targets: [clean, ...settings.targets].slice(0, 25) }).catch(() => {});
    }
  }

  if (IS_DEMO) return <Plain title="Not part of the demo" text="The public demo includes the Network Circle and Degrees views only." />;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
      <AppHeader active="breach" csvMode={localOnly} />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '16px clamp(12px, 3vw, 28px) 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {localOnly ? (
          <div style={PANEL}><p style={{ ...SMALL, margin: 0 }}>Breach needs your own network: it maps companies with scans and follows the requests you send. A CSV import has neither.</p></div>
        ) : !network ? (
          <div style={{ ...SMALL, padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            <Targets settings={settings} company={company} companies={companies} onPick={pick}
              onDrop={(t) => {
                const targets = settings.targets.filter((x) => companyKey(x) !== companyKey(t));
                save({ ...settings, targets }).catch(() => {});
                if (companyKey(t) === companyKey(company)) setCompany(targets[0] || '');
              }} />
            {tab === 'companies' ? (
              <Compare companies={companies} onPick={pick} />
            ) : company ? (
              <CompanyView key={companyKey(company)} company={company} network={network} you={you} asks={asks}
                note={notes} linkedin={linkedin} settings={settings} guessedCity={guessedCity}
                onSettings={save} onScanned={() => { setReload((n) => n + 1); }} onLook={lookAgain} />
            ) : (
              <Intro />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Plain({ title, text }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--sd-page)', color: 'var(--sd-fg-2, #ccc)', fontFamily: 'var(--sd-font)' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--sd-fg-1, #fff)' }}>{title}</h1>
      <p style={{ fontSize: 13, margin: 0 }}>{text}</p>
      <Link href="/" style={{ fontSize: 13, color: 'var(--sd-fg-3, #888)', textDecoration: 'none' }}>&larr; Back to the network</Link>
    </div>
  );
}

function Intro() {
  return (
    <div style={PANEL}>
      <h2 style={H2}>Breach a company</h2>
      <p style={{ ...SMALL, margin: 0, maxWidth: 720 }}>
        Pick a company you have no way into. Breach maps its people in small rounds, then suggests the doors: people likeliest
        to accept, with a mutual, a lower seat, a recruiter&apos;s job, or your city or school. You open each profile and press
        Connect yourself. Once one door opens, everyone else there has a mutual with you, and the climb to the top seats begins.
      </p>
    </div>
  );
}

// ── Picking a company ────────────────────────────────────────────────────────

function Targets({ settings, company, companies, onPick, onDrop }) {
  const [typed, setTyped] = useState('');
  return (
    <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <form onSubmit={(e) => { e.preventDefault(); onPick(typed); setTyped(''); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="breach-company" style={{ fontSize: 13, fontWeight: 700 }}>Company to breach</label>
        <input id="breach-company" list="breach-companies" value={typed} onChange={(e) => setTyped(e.target.value)}
          placeholder="Type a company" style={{ ...INPUT, flex: '1 1 220px', maxWidth: 360 }} />
        <datalist id="breach-companies">{companies.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        <button type="submit" disabled={!companyName(typed)} style={{ ...BUTTON, opacity: companyName(typed) ? 1 : 0.5 }}>Breach it</button>
      </form>
      {settings.targets.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {settings.targets.map((t) => {
            const on = companyKey(t) === companyKey(company);
            return (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 20, border: `1px solid ${on ? 'rgba(0,255,136,0.5)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.16)'}`, background: on ? 'rgba(0,255,136,0.08)' : 'transparent' }}>
                <button type="button" onClick={() => onPick(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 4px 4px 11px', fontSize: 12, fontWeight: 700, color: on ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-2, #ccc)' }}>{t}</button>
                <button type="button" aria-label={`Stop breaching ${t}`} title="Take it off the list (nothing scanned is deleted)" onClick={() => onDrop(t)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px 4px 4px', fontSize: 12, color: 'var(--sd-fg-4, #6f7a88)' }}>×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── One company ──────────────────────────────────────────────────────────────

function CompanyView({ company, network, you, asks, note, linkedin, settings, guessedCity, onSettings, onScanned, onLook }) {
  const [askedNow, setAskedNow] = useState(() => new Set());
  const people = useMemo(() => breachPeople(network, company, { you, hasRequest: asks }), [network, company, you, asks]);
  const s = useMemo(() => breachScore(people), [people]);
  // Asked here this visit stay in the plan, said as asked, so the list doesn't jump under you.
  const plan = useMemo(() => weeklyPlan(people.map((p) => (askedNow.has(p.key) ? { ...p, requested: false } : p))), [people, askedNow]);
  const { accepted, pending } = useMemo(() => acceptances(people), [people]);
  const now = people.filter((p) => p.employment === 'current');
  const others = people.length - now.length;
  const bands = useMemo(() => {
    const out = { doors: [], climb: [], summit: [] };
    for (const p of now) if (!p.inside && !p.requested && p.degree !== 1) out[p.band].push(p);
    for (const k of Object.keys(out)) out[k].sort((a, b) => b.odds - a.odds || b.power - a.power);
    return out;
  }, [now]);
  const inside = now.filter((p) => p.inside);

  return (
    <>
      <div style={{ ...PANEL, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{company}</h1>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, padding: '3px 9px', borderRadius: 20, border: `1px solid ${s.inside ? 'rgba(0,255,136,0.5)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.2)'}`, color: s.inside ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-3, #888)' }}>
            {s.inside ? 'OPEN' : 'COLD'}
          </span>
          <span style={SMALL}>{now.length} work there now{others ? ` · ${others} alumni or mentions` : ''}</span>
        </div>
        <BreachMeter s={s} />
        <Milestones list={s.milestones} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
        <div style={PANEL}>
          <h2 style={H2}>The company</h2>
          {now.length ? <BreachOrb people={people} company={company} score={s.score} /> : (
            <p style={{ ...SMALL, margin: 0 }}>No one at {company} is known yet. Map a round below to see its people by seat.</p>
          )}
          <Legend />
        </div>
        <Plan plan={plan} pending={pending} company={company} askedNow={askedNow} setAskedNow={setAskedNow} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        {BANDS.map((b) => <Band key={b.key} band={b} people={bands[b.key]} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
        <Inside inside={inside} accepted={accepted} company={company} />
        <Scan company={company} notes={note} linkedin={linkedin} onScanned={onScanned} onLook={onLook} />
      </div>

      <You settings={settings} guessedCity={guessedCity} onSettings={onSettings} />
    </>
  );
}

function Legend() {
  const item = (color, text, ring) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: ring ? 'transparent' : color, border: ring ? `1.5px dashed ${color}` : 'none' }} />{text}
    </span>
  );
  return (
    <div style={{ ...SMALL, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
      {item(BAND_COLORS.doors, 'Inside (a line into the orb)')}
      {item(BAND_COLORS.summit, 'Request out', true)}
      {item(BAND_COLORS.doors, 'Door')}
      {item(BAND_COLORS.climb, 'Climb')}
      {item(BAND_COLORS.summit, 'Summit')}
    </div>
  );
}

function Face({ p, size = 30 }) {
  const photo = localPhoto(p.profile_image_url);
  return photo ? (
    <img src={photo} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
  ) : (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--sd-fg-3, #888)' }}>{p.name?.charAt(0)}</span>
  );
}

function Who({ p, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.05)' }}>
      <Face p={p} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.headline}</div>
      </div>
      {children}
    </div>
  );
}

function Why({ p }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 190 }}>
      {p.why.slice(0, 3).map((w) => (
        <span key={w} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', color: 'var(--sd-fg-2, #ccc)' }}>{w}</span>
      ))}
    </div>
  );
}

function Plan({ plan, pending, company, askedNow, setAskedNow }) {
  const [note, say] = useFadingNote(6000);
  const heavy = pending.length >= BREACH_WEEKLY;
  return (
    <div style={PANEL}>
      <h2 style={H2}>This week&apos;s doors</h2>
      <p style={{ ...SMALL, margin: '0 0 8px' }}>
        {BREACH_WEEKLY} requests a week, sent by hand: Open opens their profile, you press Connect there, and it&apos;s marked as
        asked here. Never automated. {pending.length ? `${pending.length} request${pending.length === 1 ? ' is' : 's are'} out at ${company} now.` : ''}
      </p>
      {heavy && (
        <p style={{ ...SMALL, margin: '0 0 8px', color: 'var(--sd-gold, #FFD700)' }}>
          Many requests are still waiting. Unaccepted requests weigh on an account, so let some be accepted before sending more.
        </p>
      )}
      {plan.length === 0 ? (
        <p style={{ ...SMALL, margin: 0 }}>No doors yet. Map a round of {company}&apos;s people, or rescan for mutual counts.</p>
      ) : plan.map((p) => {
        const asked = askedNow.has(p.key);
        return (
          <Who key={p.key} p={p}>
            <Why p={p} />
            {asked ? (
              <button type="button" style={{ ...QUIET, padding: '4px 9px' }} title="Take the asked mark back"
                onClick={() => { undoRequest(p.row).catch((e) => say(e.message)); setAskedNow((s) => { const n = new Set(s); n.delete(p.key); return n; }); }}>
                Asked · Undo
              </button>
            ) : (
              <OpenProfile person={p.row} stopPropagation
                title="Opens their profile so you can press Connect, and marks it asked here"
                onOpen={() => {
                  setAskedNow((s) => new Set(s).add(p.key));
                  markRequested(p.row, { bridgeId: p.degree === 2 ? p.source_connection_id : undefined }).catch((e) => say(e.message));
                }}
                style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#0077B5', color: '#fff', textDecoration: 'none', flexShrink: 0 }}>
                Open
              </OpenProfile>
            )}
          </Who>
        );
      })}
      <InlineNote note={note} />
    </div>
  );
}

function Band({ band, people }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, 6);
  return (
    <div style={{ ...PANEL, borderTop: `3px solid ${BAND_COLORS[band.key]}` }}>
      <h2 style={{ ...H2, color: BAND_COLORS[band.key] }}>{band.label} · {people.length}</h2>
      <p style={{ ...SMALL, margin: '0 0 6px' }}>{band.about}</p>
      {shown.map((p) => (
        <Who key={p.key} p={p}>
          <span style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)', flexShrink: 0 }}>{p.mutuals ? `${p.mutuals} mutual${p.mutuals === 1 ? '' : 's'}` : p.lifted ? 'lifted' : ''}</span>
        </Who>
      ))}
      {people.length > 6 && (
        <button type="button" onClick={() => setAll(!all)} style={{ ...QUIET, marginTop: 8 }}>{all ? 'Show fewer' : `Show all ${people.length}`}</button>
      )}
    </div>
  );
}

function Inside({ inside, accepted, company }) {
  const scanShows = useScanShows();
  const [note, say] = useFadingNote(9000);
  return (
    <div style={PANEL}>
      <h2 style={H2}>Inside · {inside.length}</h2>
      <p style={{ ...SMALL, margin: '0 0 8px' }}>
        Your connections who work at {company} now. {accepted.length ? `${accepted.length} accepted a request you sent.` : ''} Acceptances arrive with
        Check for new, which brings in your newest connections: no other polling.
      </p>
      {scanShows.auto ? (
        <span style={{ position: 'relative', display: 'inline-flex', marginBottom: 6 }}>
          <button type="button" style={QUIET} onClick={async () => { const why = await startHere('refresh'); if (why) say(why); }}>Check for new</button>
          <InlineNote note={note} float />
        </span>
      ) : (
        <p style={{ ...SMALL, margin: '0 0 6px' }}>Check for new is on the <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)' }}>Scan page</Link>.</p>
      )}
      {inside.length === 0 ? <p style={{ ...SMALL, margin: 0 }}>No one yet. The first door is worth more than any one person.</p>
        : inside.map((p) => (
          <Who key={p.key} p={p}>
            <span style={{ fontSize: 11, fontWeight: 700, color: p.accepted ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-3, #888)', flexShrink: 0 }}>
              {p.seat.title}{p.accepted ? ' · accepted' : ''}
            </span>
          </Who>
        ))}
    </div>
  );
}

// ── Mapping the company ──────────────────────────────────────────────────────

function Scan({ company, notes, linkedin, onScanned, onLook }) {
  const shows = useScanShows();
  const mode = useCircleMode();
  const job = useScanner();
  const [degrees, setDegrees] = useState([...BREACH_DEGREES_DEFAULT]);
  const [round, setRound] = useState(BREACH_ROUND);
  const [log, setLog] = useState([]);
  const [mine, setMine] = useState(false);
  const [note, say] = useFadingNote(9000);
  const n = notes?.[breachKey(company, degrees)] || null;
  const spread = mapSpread(n, round);
  const busy = !mine && job.running ? busyReason(job) : null;
  const left = linkedin?.leftToday;
  const daily = linkedin?.limits?.daily;

  async function go() {
    say(null);
    const blocked = notReadyMessage(await scraperStatus().catch(() => null));
    if (blocked) { say(blocked); return; }
    setMine(true);
    setLog([]);
    try {
      const end = await runScrape('breach', { name: company, pages: round, degrees, onLog: setLog });
      if (end?.failure) say(end.failure);
      onScanned();
    } catch (e) {
      say(e.message || 'The round could not start.');
    } finally {
      setMine(false);
      onLook();
    }
  }

  const toggle = (d) => setDegrees((now) => {
    const next = now.includes(d) ? now.filter((x) => x !== d) : [...now, d].sort();
    return next.length ? next : now;
  });

  return (
    <div style={PANEL}>
      <h2 style={H2}>Map {company}</h2>
      <p style={{ ...SMALL, margin: '0 0 8px' }}>
        Searches LinkedIn for &ldquo;{company}&rdquo; with the People filter, {degrees.map((d) => DEGREE_WORDS[d]).join(' and ')}. A keyword also
        finds alumni and people who only mention it; Breach marks who works there now from each headline.
      </p>
      <p style={{ ...SMALL, margin: '0 0 8px', color: 'var(--sd-gold, #FFD700)' }}>
        Mapping a company is search pages, and LinkedIn restricts accounts that read too much at once. So it goes in small rounds,
        spread over days: each page is a search counted in your daily limit{Number.isFinite(left) && Number.isFinite(daily) ? ` (${left} of ${daily} left today)` : ''}.
      </p>
      <p style={{ ...SMALL, margin: '0 0 10px' }}>
        {!n ? 'Not mapped yet with these filters. The first round reads LinkedIn’s count of people, and the plan for the rest follows.'
          : `Pages 1 to ${n.pages} read${spread ? ` of ${spread.pages} (about ${n.total.toLocaleString('en-US')} people${n.total > 1000 ? '; LinkedIn shows the first 1,000' : ''})` : ''}. `
            + (n.more ? `The next round carries on at page ${n.pages + 1}${spread?.days ? `; one round a day maps the rest in about ${spread.days} day${spread.days === 1 ? '' : 's'}` : ''}.`
              : 'Every page is read: the next round reads it again from page 1, for new mutual counts.')}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {BREACH_DEGREES.map((d) => (
          <button key={d} type="button" aria-pressed={degrees.includes(d)} onClick={() => toggle(d)}
            style={{ ...QUIET, padding: '4px 10px', ...(degrees.includes(d) ? { borderColor: 'rgba(0,255,136,0.5)', color: 'var(--sd-green, #00ff88)' } : null) }}>
            {DEGREE_WORDS[d]}
          </button>
        ))}
        <label style={{ ...SMALL, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Round
          <select value={round} onChange={(e) => setRound(Number(e.target.value))} style={{ ...INPUT, padding: '4px 6px' }}>
            {BREACH_ROUNDS.map((r) => <option key={r} value={r}>{r} pages</option>)}
          </select>
        </label>
      </div>
      {!shows.scan ? (
        <p style={{ ...SMALL, margin: 0 }}>Mapping needs a scanner plugin: add one in Settings → Plugins.</p>
      ) : (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
          <button type="button" onClick={go} disabled={mine || Boolean(busy)}
            title={busy ? `${busy}. One scan at a time.` : undefined}
            style={{ ...BUTTON, opacity: mine || busy ? 0.55 : 1, cursor: mine || busy ? 'not-allowed' : 'pointer' }}>
            {mine ? 'Mapping…' : busy ? 'Scanner busy' : `Map a round (${round} pages)`}
          </button>
          <span style={SMALL}>{mode === 'manual' ? 'By hand: you page through, and each page is read at its foot.' : mode === 'auto' ? 'Automatic: paced, with breaks, and it stops at any push-back.' : ''}</span>
          <InlineNote note={note} float />
        </div>
      )}
      {mine && log.length > 0 && (
        <div style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 11, color: 'var(--sd-fg-4, #777)', maxHeight: 90, overflow: 'auto' }}>
          {log.slice(-6).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

function You({ settings, guessedCity, onSettings }) {
  const [city, setCity] = useState(settings.city);
  const [school, setSchool] = useState(settings.school);
  const changed = city !== settings.city || school !== settings.school;
  return (
    <div style={PANEL}>
      <h2 style={H2}>You</h2>
      <p style={{ ...SMALL, margin: '0 0 8px' }}>Your city and school make someone a door. Only what their card shows is compared: their place and headline.</p>
      <form onSubmit={(e) => { e.preventDefault(); onSettings({ ...settings, city, school }).catch(() => {}); }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Your city" value={city} onChange={(e) => setCity(e.target.value)}
          placeholder={guessedCity ? `${guessedCity} (where most of your connections are)` : 'Your city'} style={{ ...INPUT, flex: '1 1 220px' }} />
        <input aria-label="Your school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Your school, as people write it" style={{ ...INPUT, flex: '1 1 220px' }} />
        <button type="submit" disabled={!changed} style={{ ...QUIET, opacity: changed ? 1 : 0.5 }}>Save</button>
      </form>
    </div>
  );
}

// ── Every company ────────────────────────────────────────────────────────────

function Compare({ companies, onPick }) {
  return (
    <div style={PANEL}>
      <h2 style={H2}>Companies</h2>
      <p style={{ ...SMALL, margin: '0 0 10px' }}>
        From what&apos;s saved: open companies have your connections inside, cold ones don&apos;t yet, and a door waiting is someone likely to
        accept with no request out. Your breach list comes first.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--sd-fg-3, #888)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <th style={{ padding: '6px 8px' }}>Company</th><th style={{ padding: '6px 8px' }}>Status</th><th style={{ padding: '6px 8px' }}>Breach</th>
              <th style={{ padding: '6px 8px' }}>Inside</th><th style={{ padding: '6px 8px' }}>Highest seat</th><th style={{ padding: '6px 8px' }}>Doors waiting</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.name} onClick={() => onPick(c.name)} style={{ cursor: 'pointer', borderTop: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.06)' }}>
                <td style={{ padding: '7px 8px', fontWeight: 700 }}>{c.target ? '◎ ' : ''}{c.name}</td>
                <td style={{ padding: '7px 8px', color: c.status === 'open' ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-3, #888)', fontWeight: 700 }}>{c.status === 'open' ? 'Open' : 'Cold'}</td>
                <td style={{ padding: '7px 8px' }}>{c.score}</td>
                <td style={{ padding: '7px 8px' }}>{c.inside}</td>
                <td style={{ padding: '7px 8px', color: 'var(--sd-fg-2, #ccc)' }}>{c.highestSeat || '·'}</td>
                <td style={{ padding: '7px 8px', color: c.doors ? 'var(--sd-gold, #FFD700)' : 'var(--sd-fg-4, #6f7a88)' }}>{c.doors || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
