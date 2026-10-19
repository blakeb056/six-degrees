'use client';

// Settings → Help (lib/help.js): Replay the tour, the switch for every hint,
// short how-tos each with a link to the place it happens, what scanning's pace
// and limits mean (said plainly: LinkedIn can restrict an account, slow is
// safer, nothing is a guarantee), the keyboard shortcuts, and where your data
// lives. Only reads and writes this window's storage; the data folder's path
// is the page's own answer from GET /api/settings (`about`).

import { useId, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Section, Body, Mono, Btn, LINE } from '../ui';
import { track } from '../../../lib/learning-client';
import {
  TOUR_REPLAY_HREF, HOW_TOS, PACING_NOTES, SHORTCUTS, readHints, setHintsOff, resetHints, withKeys, isMac,
  watchHelp, hintsRawNow, nothingStored,
} from '../../../lib/help';

const noWindow = () => () => {};
const H3 = { fontSize: 14, fontWeight: 700, margin: '24px 0 4px', color: 'var(--sd-fg-1, #fff)' };
const LINK = { color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 };
const KBD = {
  display: 'inline-block', minWidth: 22, padding: '1px 7px', borderRadius: 6, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
  textAlign: 'center', color: 'var(--sd-fg-1, #fff)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.16)', borderBottomWidth: 2, whiteSpace: 'nowrap',
};

/** @param {{ about?: { dataDir?: string } | null }} props */
export default function HelpSection({ about }) {
  const router = useRouter();
  const switchId = useId();
  const raw = useSyncExternalStore(watchHelp, hintsRawNow, nothingStored);
  const hints = readHints({ getItem: () => raw });
  const mac = useSyncExternalStore(noWindow, () => isMac(), () => true);
  const hidden = hints.dismissed.length;

  return (
    <Section id="help" title="Help" intro="The tour, short how-tos, what scanning’s pace and limits mean, the keyboard shortcuts, and where your data lives.">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        <Btn primary onClick={() => router.push(TOUR_REPLAY_HREF)}>Replay the tour</Btn>
        <span style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)' }}>Opens the map and walks through it again, a minute or so.</span>
      </div>

      <div data-hints-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 18 }}>
        <input id={switchId} type="checkbox" checked={!hints.off} onChange={(e) => setHintsOff(!e.target.checked)}
          onClick={(e) => track('settings', 'change', { key: 'hintsOff', old: Boolean(hints.off), new: !e.target.checked })}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
        <div style={{ minWidth: 0 }}>
          <label htmlFor={switchId} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Show hints</label>
          <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
            A small card the first times you open a place, one at a time, until you press Got it. Never during a scan.
            {hints.off ? ' Off: no hints anywhere.' : ''}
          </div>
          {hidden > 0 && (
            <button type="button" onClick={() => resetHints()} style={{
              marginTop: 6, padding: 0, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, ...LINK,
            }}>
              Show the {hidden === 1 ? 'one' : hidden} you dismissed again
            </button>
          )}
        </div>
      </div>

      <h3 style={H3}>How to</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 10, marginTop: 8 }}>
        {HOW_TOS.map((h) => (
          <div key={h.key} data-how-to={h.key} style={{ padding: '12px 14px', borderRadius: 10, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{h.title}</div>
            <Body style={{ fontSize: 13 }}>{withKeys(h.text, mac)}</Body>
            <Link href={h.href} style={{ ...LINK, fontSize: 13, display: 'inline-block', marginTop: 6 }}>{h.go} &rarr;</Link>
          </div>
        ))}
      </div>

      <h3 id="help-pacing" style={H3}>Scanning: pace and limits</h3>
      {PACING_NOTES.map((note) => <Body key={note}>{note}</Body>)}
      <Body>
        <Link href="/setup#usage" style={LINK}>See your LinkedIn usage &rarr;</Link>
      </Body>

      <h3 style={H3}>Keyboard shortcuts</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '8px 16px', margin: '8px 0 0', alignItems: 'baseline' }}>
        {SHORTCUTS.map((s) => (
          <div key={s.keys} style={{ display: 'contents' }}>
            <dt style={{ margin: 0 }}>
              {withKeys(s.keys, mac).split(' and ').map((k, i) => (
                <span key={k}>{i > 0 && <span style={{ fontSize: 12, color: 'var(--sd-fg-4, #667)', margin: '0 4px' }}>and</span>}<kbd style={KBD}>{k}</kbd></span>
              ))}
            </dt>
            <dd style={{ margin: 0, fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>{s.what}</dd>
          </div>
        ))}
      </dl>

      <h3 style={H3}>Where your data lives</h3>
      <Body>
        On this computer. Your network, its settings, the photos and the backups are in your data folder
        {about?.dataDir ? <>: <Mono>{about.dataDir}</Mono>.</> : '.'} Nothing about your network is uploaded: scans
        run in your own Chrome and save here.
      </Body>
      <Body>
        <a href="#data" style={LINK}>Your data</a> shows the folder, the backups, and how to move your network to another
        computer. The tour and the hints are remembered in this window only.
      </Body>
    </Section>
  );
}
