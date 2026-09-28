'use client';

// The Scan page's one question before the first scan: what field you're in.
// The same picks as Scores → Your sector (SectorPicker), saved the same way
// (lib/settings-client.js), so the first scan is already scored with them.
// Optional: Skip for now carries on without one. Either answer is kept
// (`fieldAsked`, lib/sector-focus.js), so it's asked once; when it's asked at
// all is lib/scanner-setup.js askForField.

import { useState } from 'react';
import Link from 'next/link';
import { Body, Btn, Status, LINE } from './ui';
import SectorPicker from './settings/SectorPicker';
import { sectorByKey } from '../../lib/sector-directory';
import { saveSettings } from '../../lib/settings-client';

const link = { color: '#3498DB' };

/** The question. `onDone(sectors)` once it's answered ([] when skipped). */
export default function FieldStep({ onDone }) {
  const [sectors, setSectors] = useState([]);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  async function pick() {
    setSaving('pick');
    setError(null);
    const d = await saveSettings({ sectorFocus: { sectors, strength: 'lean' }, fieldAsked: true });
    // Saved even if the rescore it set off failed: there's no one to rescore
    // yet, and the first scan scores everyone.
    if (d.settings) { onDone(d.settings.sectorFocus.sectors); return; }
    setError(d.error);
    setSaving(null);
  }

  async function skip() {
    setSaving('skip');
    setError(null);
    // Kept so it isn't asked again. If that can't be saved, skipping still
    // skips: the question comes back next time, which is all it costs.
    await saveSettings({ fieldAsked: true });
    onDone([]);
  }

  return (
    <section aria-labelledby="field-question" style={{
      margin: '8px 0 0', padding: '20px 22px', borderRadius: 12, border: LINE, background: 'rgba(255,255,255,0.03)',
    }}>
      <div style={{ fontSize: 12, color: '#788', textTransform: 'uppercase', letterSpacing: 0.6 }}>Before you scan · optional</div>
      <h2 id="field-question" style={{ fontSize: 18, fontWeight: 700, margin: '6px 0 4px' }}>What field are you in?</h2>
      <Body style={{ marginTop: 0, marginBottom: 14 }}>
        Pick up to three. Companies in your field count for more when your network is scored, so the people there rank
        higher. You can change it anytime on the Scores tab.
      </Body>

      <SectorPicker sectors={sectors} onChange={setSectors} disabled={Boolean(saving)} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <Btn primary onClick={pick} disabled={!sectors.length || Boolean(saving)}>
          {saving === 'pick' ? 'Saving…' : 'Continue'}
        </Btn>
        <Btn onClick={skip} disabled={Boolean(saving)}>Skip for now</Btn>
      </div>
      {error && <Status tone="bad">{error}</Status>}
    </section>
  );
}

/** What was answered, above the scan's steps: where it went, and where to change it. */
export function FieldAnswer({ sectors }) {
  if (!sectors.length) {
    return <Status>No field for now. You can pick one anytime on <Link href="/scores#sector" style={link}>Scores</Link>.</Status>;
  }
  // The labels have commas of their own ("Tech, Software & AI"), so a dot separates them.
  return (
    <Status tone="ok">
      Your field: {sectors.map((k) => sectorByKey(k).label).join(' · ')}. Your first scan is scored with it. Change it
      anytime on <Link href="/scores#sector" style={link}>Scores</Link>.
    </Status>
  );
}
