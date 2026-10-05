'use client';

// The Scan page's one question, once your connections are in: what field
// you're in. The same picks as Settings → Scores → Your field (SectorPicker),
// saved the same way (lib/settings-client.js), which rescores everyone with
// them (lib/settings-effects.js) and every scan after. It used to be asked
// before the first scan, in the way of it; now it's asked under "Your galaxy
// is ready". Optional: Skip for now carries on without one. Either answer is
// kept (`fieldAsked`, lib/sector-focus.js), so it's asked once; when it's
// asked at all is lib/scanner-setup.js askForField.

import { useState } from 'react';
import Link from 'next/link';
import { Body, Btn, Status, LINE } from './ui';
import SectorPicker from './settings/SectorPicker';
import { sectorByKey } from '../../lib/sector-directory';
import { saveSettings } from '../../lib/settings-client';

const link = { color: 'var(--sd-blue, #3498DB)' };
// The card's own colour (3% white on the page's #0a0a1a), made solid so the
// picks scroll behind the buttons rather than through them.
const FOOT = '#111121';

/**
 * Your field, saved as Scores → Your field saves it, and kept as answered so
 * it's asked once: { sectors } as saved, or { error }. Saved even if the
 * rescore it set off failed: the map rescores a network scored with another
 * focus when it next loads (lib/rpc.js rescoreIfStale). The guided setup asks
 * the same question and saves through here (app/components/onboarding).
 */
export async function saveField(sectors) {
  const d = await saveSettings({ sectorFocus: { sectors, strength: 'lean' }, fieldAsked: true });
  return d.settings ? { sectors: d.settings.sectorFocus.sectors, settings: d.settings } : { error: d.error };
}

/**
 * Skip for now: kept so it isn't asked again. If that can't be saved, skipping
 * still skips: the question comes back next time, which is all it costs.
 * Resolves to the settings as saved, or null.
 */
export async function skipField() {
  return (await saveSettings({ fieldAsked: true })).settings;
}

/** The question. `onDone(sectors)` once it's answered ([] when skipped). */
export default function FieldStep({ onDone }) {
  const [sectors, setSectors] = useState([]);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  async function pick() {
    setSaving('pick');
    setError(null);
    const d = await saveField(sectors);
    if (d.sectors) { onDone(d.sectors); return; }
    setError(d.error);
    setSaving(null);
  }

  async function skip() {
    setSaving('skip');
    setError(null);
    await skipField();
    onDone([]);
  }

  return (
    <section aria-labelledby="field-question" data-field-question style={{
      margin: '8px 0 0', padding: '20px 22px 0', borderRadius: 12, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #788)', textTransform: 'uppercase', letterSpacing: 0.6 }}>One question · optional</div>
      <h2 id="field-question" style={{ fontSize: 18, fontWeight: 700, margin: '6px 0 4px' }}>What field are you in?</h2>
      <Body style={{ marginTop: 0, marginBottom: 14 }}>
        Pick up to three. Companies in your field count for more when your network is scored, so the people there rank
        higher. You can change it anytime in Settings.
      </Body>

      <SectorPicker sectors={sectors} onChange={setSectors} disabled={Boolean(saving)} />

      {/* The twelve industries, and any lists opened, run the card past the
          bottom of the window. So Continue and Skip for now stay at the foot of
          the window while the card is on screen; globals.css keeps a pick
          reached with Tab from stopping behind them. A failed save shows here
          too, beside them. */}
      <div style={{
        position: 'sticky', bottom: 0, margin: '16px -22px 0', padding: '12px 22px 16px',
        borderTop: LINE, borderRadius: '0 0 11px 11px', background: FOOT,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn primary onClick={pick} disabled={!sectors.length || Boolean(saving)}>
            {saving === 'pick' ? 'Saving…' : 'Continue'}
          </Btn>
          <Btn onClick={skip} disabled={Boolean(saving)}>Skip for now</Btn>
        </div>
        {error && <Status tone="bad">{error}</Status>}
      </div>
    </section>
  );
}

/** What was answered, above the scan's steps: where it went, and where to change it. */
export function FieldAnswer({ sectors }) {
  if (!sectors.length) {
    return <Status>No field for now. You can pick one anytime in <Link href="/settings#sector" style={link}>Settings</Link>.</Status>;
  }
  // The labels have commas of their own ("Tech, Software & AI"), so a dot separates them.
  return (
    <Status tone="ok">
      Your field: {sectors.map((k) => sectorByKey(k).label).join(' · ')}. Your network is scored with it now, and
      every scan after. Change it anytime in <Link href="/settings#sector" style={link}>Settings</Link>.
    </Status>
  );
}
