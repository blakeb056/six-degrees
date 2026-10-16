'use client';

// The LinkedIn tab (the LinkedIn browser plugin; Blake, 2026-10-15: "for the
// actual LinkedIn section tab we can have where the notch will have buttons
// for exact features like the feed and only the feed embedded into the panel,
// same for messaging so it's their actual messaging live, feed, notifications
// and jobs … if they want the whole website they click on the top right").
//
// Its notch buttons, Feed, Messaging, Notifications and Jobs, open Sixgree's
// own browser straight on that LinkedIn section, under the header and the
// notch (desktop/main.mjs showSection). It is your own browsing: nothing is
// read and nothing is counted. Gone somewhere else from there, the bar offers
// the way back to the section (LinkedInPanel.js), beside Back and Forward.
// Only in the desktop app with the plugin on: anywhere else the tab isn't
// shown, and this page says why.

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';
import useNotchTabs from '../components/useNotchTabs';
import useFeature from '../components/useFeature';
import { useLinkedInPanel, openLinkedInSection, LINKEDIN_SECTION_TABS } from '../components/linkedInPanelState';
import { LINKEDIN_BROWSER } from '../../lib/linkedin-browser';

export default function LinkedInPage() {
  const panel = useLinkedInPanel();
  const on = useFeature(LINKEDIN_BROWSER);
  const [section, setSection] = useState('feed');
  const ready = Boolean(panel?.available && on);

  // The section you chose, as soon as the panel is there to show it.
  const available = Boolean(panel?.available);
  useEffect(() => {
    if (ready) openLinkedInSection(section);
  }, [ready, section]);
  // The notch follows the panel when it was opened elsewhere on a section.
  const shown = panel?.visible && panel.mode === 'section' ? panel.section : null;

  useNotchTabs(useMemo(() => (ready ? {
    items: LINKEDIN_SECTION_TABS.map((t) => ({ ...t, title: `LinkedIn’s ${t.label.toLowerCase()}, inside Sixgree` })),
    current: shown || section,
    onPick: (key) => { setSection(key); openLinkedInSection(key); },
  } : null), [ready, shown, section]));

  const label = LINKEDIN_SECTION_TABS.find((t) => t.key === section)?.label || 'Feed';
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)', display: 'flex', flexDirection: 'column' }}>
      <AppHeader active="linkedin" />
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, fontSize: 14 }}>
          {!available ? (
            <p>LinkedIn opens here in the Sixgree desktop app, with the LinkedIn browser plugin on (Settings → Plugins).</p>
          ) : !on ? (
            <p>This tab comes with the LinkedIn browser plugin. Turn it on in Settings → Plugins.</p>
          ) : (
            <>
              <p>LinkedIn is put away. Your own browsing: Sixgree reads nothing here.</p>
              <button type="button" onClick={() => openLinkedInSection(section)} style={{
                marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#0A66C2', color: '#fff', font: 'inherit', fontWeight: 700,
              }}>Show {label}</button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
