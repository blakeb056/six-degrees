'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import OnboardingGate from '../components/OnboardingGate';
import AppHeader from '../components/AppHeader';
import useNotchTabs from '../components/useNotchTabs';
import { useUser } from '../components/UserProvider';
import UpdatePanel from '../components/UpdatePanel';
import DataSection from '../components/settings/DataSection';
import SectorSection from '../components/settings/SectorSection';
import TierSection from '../components/settings/TierSection';
import TitleSection from '../components/settings/TitleSection';
import AppearanceSection from '../components/settings/AppearanceSection';
import CompanyScores from '../components/CompanyScores';
import UsageSection from '../components/settings/UsageSection';
import { Section, Body, Mono, FONT } from '../components/ui';
import { IS_DEMO } from '../../lib/demo';
import { CSV_USER } from '../../lib/csv';
import { insightsHref } from '../../lib/insights-address';

// Settings: one page for the choices that shape how the app treats your data,
// and the facts about this copy. Each feature adds its own <Section>; what the
// user chooses is saved in the database (lib/settings.js), so it travels with
// their data.
//
// Scores live here again (Blake, 2026-10-02: "moving scores into settings"):
// your field, how tiers are graded and every company's score. They had a tab
// of their own (app/scores), which now forwards here; network health went to
// Profile → ✦ Insights → Health.
//
// The same header as every page, and the sections in the notch under it
// (Blake, 2026-10-04: "make sure all the uis are compliant"): picking one
// scrolls to it, and as you scroll the one you're reading is lit. One long page
// rather than one section at a time, so every /settings#… link still lands
// (the notch's budget goes to #usage, Profile's sectors to #sector).

export default function SettingsPage() {
  return <OnboardingGate><SettingsInner /></OnboardingGate>;
}

// The notch's tabs: the page's sections, top to bottom, by their ids.
const SECTIONS = [
  ['updates', 'Updates'], ['usage', 'LinkedIn usage'], ['appearance', 'Appearance'],
  ['scoring', 'Scores'], ['data', 'Your data'], ['about', 'About'],
];

/** The section you're reading: the last whose top has passed just under the notch, or the last of all at the foot of the page. */
function sectionInView() {
  const line = (document.querySelector('[data-notch]')?.getBoundingClientRect().bottom ?? 0) + 40;
  const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atEnd) return SECTIONS[SECTIONS.length - 1][0];
  let current = SECTIONS[0][0];
  for (const [id] of SECTIONS) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= line) current = id;
  }
  return current;
}

const KIND_LABEL = {
  'mac-app': 'the Mac app',
  'windows-app': 'the Windows app',
  'linux-app': 'the Linux app',
  npm: 'the npm package (npx sixgree)',
  source: 'a copy built from the source code',
  git: 'a git checkout of the source code',
};

function SettingsInner() {
  const { userId } = useUser();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  // Saving your field or tiers rescores everyone; the company list reads its scores again when this changes.
  const [saves, setSaves] = useState(0);
  const saved = () => setSaves((n) => n + 1);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Could not load settings.')))))
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);

  // Which section is lit in the notch: the one you're reading, measured on
  // scroll. A pick lights its own at once and holds it while its scroll runs,
  // so the light doesn't flick through every section on the way.
  const [section, setSection] = useState(SECTIONS[0][0]);
  const held = useRef(0);
  useEffect(() => {
    let queued = 0;
    const spy = () => {
      queued = 0;
      if (performance.now() < held.current) return;
      setSection(sectionInView());
    };
    const later = () => { if (!queued) queued = requestAnimationFrame(spy); };
    const ended = () => { held.current = 0; };
    later();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    window.addEventListener('scrollend', ended);
    return () => {
      cancelAnimationFrame(queued);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      window.removeEventListener('scrollend', ended);
    };
  }, []);
  const pick = useCallback((id) => {
    const el = document.getElementById(id);
    setSection(id);
    if (!el) return;
    // Its heading just under the notch, which waits at the top of the window once the header has scrolled away.
    const notch = document.querySelector('[data-notch]')?.offsetHeight ?? 0;
    const header = document.querySelector('header');
    const below = header ? header.offsetTop + header.offsetHeight : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - notch + 8;
    held.current = performance.now() + 1500;
    window.scrollTo({ top: top <= below ? 0 : top, behavior: 'smooth' });
  }, []);
  useNotchTabs(useMemo(() => (IS_DEMO ? null : {
    items: SECTIONS.map(([key, label]) => ({ key, label })),
    current: section,
    onPick: pick,
  }), [section, pick]));

  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--sd-page)', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.7)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, textAlign: 'center', padding: 24, fontFamily: FONT,
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>Not part of the demo</h2>
        <p style={{ margin: 0, fontSize: 13 }}>The public demo includes the Network Circle and Degrees views only.</p>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.5)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  const about = info?.about;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: FONT }}>
      <AppHeader active="settings" csvMode={userId === CSV_USER.id} />

      {/* Room at the top for the notch, which hangs under the header with the sections in it */}
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 24px 64px' }}>
        {error && <Body style={{ color: 'var(--sd-red, #ff7676)', marginTop: 16 }}>{error}</Body>}

        <UpdatePanel />
        {/* How close the LinkedIn account is to the line; the notch and the Scan page's budget link here (#usage). */}
        <UsageSection />
        <AppearanceSection />
        <Section id="scoring" title="Scores">
          <Body>
            How someone&rsquo;s power score is worked out, and the four things you can change about it:{' '}
            <a href="#sector" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>your field</a>,{' '}
            <a href="#tiers" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>how tiers are graded</a>,{' '}
            <a href="#titles" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>how titles rank</a> and{' '}
            <a href="#companies" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>any company&rsquo;s score</a>.
            A change here rescores everyone. How your network holds together is in{' '}
            <Link href={insightsHref('health')} style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>Profile → Insights → Health</Link>.
          </Body>
          <SectorSection onSaved={saved} />
          <TierSection onSaved={saved} />
          <TitleSection onSaved={saved} />
          <div id="companies" style={{ marginTop: 28 }}>
            <CompanyScores version={saves} />
          </div>
        </Section>
        <DataSection />

        <Section id="about" title="About this copy">
          {about ? (
            <>
              <Body>Version <Mono>{about.version}</Mono>, running as {KIND_LABEL[about.kind] || about.kind}.</Body>
              <Body>
                Your network is kept in <Mono>{about.dataDir}</Mono>
                {about.customDataDir ? ' (a folder you chose).' : '.'}
                {['mac-app', 'windows-app', 'linux-app'].includes(about.kind) && ' Help → Show the Data Folder opens it.'}
              </Body>
              <Body style={{ fontSize: 12, color: 'var(--sd-fg-4, #667)', marginTop: 10 }}>
                Settings are saved with your network, on this computer. Nothing here is sent anywhere.
              </Body>
            </>
          ) : !error && <Body>Loading…</Body>}
        </Section>
      </main>
    </div>
  );
}
